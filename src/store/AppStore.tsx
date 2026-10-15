import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppSettings, Course } from '../types';
import * as storage from '../storage/storage';
import { DEFAULT_SETTINGS } from '../constants';
import { genId } from '../utils/id';
import { mondayOfWeek, toISODate } from '../utils/date';
import { normalizeStoredCourses } from '../utils/select';

export type CourseDraft = Omit<Course, 'id'>;

/**
 * 导入策略：
 * - append：追加（旧行为，可能产生重复）
 * - merge：按「课程名 + 星期 + 开始节次」去重，已存在的课程原地更新（推荐用于更新课表）
 * - replace：清空后整体替换（用于换学期 / 完整重新爬取）
 */
export type CourseImportMode = 'append' | 'merge' | 'replace';

export interface ImportOutcome {
  /** 新增课程数 */
  added: number;
  /** 更新（覆盖）的课程数 */
  updated: number;
  /** 导入后的课程总数 */
  total: number;
}

interface AppContextValue {
  ready: boolean;
  courses: Course[];
  settings: AppSettings;
  /** 启动时自动修正过的课程条数（脏星期数据，v1.7.2）；0 表示无需修正 */
  autoFixedDays: number;
  addCourse: (c: CourseDraft) => void;
  updateCourse: (c: Course) => void;
  deleteCourse: (id: string) => void;
  importCourses: (list: CourseDraft[], mode?: CourseImportMode) => ImportOutcome;
  clearCourses: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function sameCourse(a: Course | CourseDraft, b: CourseDraft): boolean {
  const key = (x: CourseDraft) => `${x.name}||${x.dayOfWeek}||${x.startPeriod}`;
  if (key(a) === key(b)) return true;
  // 节次被调整过（如学校改时间）时，用「课程名 + 星期」再兜一层
  return a.name === b.name && a.dayOfWeek === b.dayOfWeek;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  /**
   * 启动时自动修正过的课程条数（v1.7.2）。
   * 历史数据里可能存着 `0` / `"7"` / `"周日"` 这类星期写法，
   * 渲染按 `=== 天数` 精确匹配，脏值会让课程落到错列甚至消失 —— 这里一次性规整掉。
   */
  const [autoFixedDays, setAutoFixedDays] = useState(0);

  // 首次加载
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [c, s] = await Promise.all([storage.loadCourses(), storage.loadSettings()]);
      if (!mounted) return;
      if (!s.semesterStart) {
        s.semesterStart = toISODate(mondayOfWeek(new Date()));
      }
      // 规整存量的脏星期数据（0=周日 / 字符串 / 中文），避免历史数据落到错误的列
      const { courses: fixedCourses, fixed } = normalizeStoredCourses(c);
      if (fixed > 0) {
        console.warn(`[timetable] 已自动修正 ${fixed} 门课程的星期字段（历史数据兼容）`);
        setAutoFixedDays(fixed);
      }
      setCourses(fixedCourses);
      setSettings(s);
      setReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // 持久化（ready 之后才写，避免覆盖）
  useEffect(() => {
    if (!ready) return;
    storage.saveCourses(courses);
  }, [courses, ready]);

  useEffect(() => {
    if (!ready) return;
    storage.saveSettings(settings);
  }, [settings, ready]);

  const addCourse = useCallback((c: CourseDraft) => {
    setCourses((prev) => [...prev, { ...c, id: genId() }]);
  }, []);

  const updateCourse = useCallback((c: Course) => {
    setCourses((prev) => prev.map((x) => (x.id === c.id ? c : x)));
  }, []);

  const deleteCourse = useCallback((id: string) => {
    setCourses((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const importCourses = useCallback(
    (list: CourseDraft[], mode: CourseImportMode = 'append'): ImportOutcome => {
      const incoming = list.map((c) => ({ ...c, id: genId() }));
      let outcome: ImportOutcome = { added: incoming.length, updated: 0, total: incoming.length };

      setCourses((prev) => {
        if (mode === 'replace') {
          outcome = { added: incoming.length, updated: 0, total: incoming.length };
          return incoming;
        }
        if (mode === 'append') {
          const next = [...prev, ...incoming];
          outcome = { added: incoming.length, updated: 0, total: next.length };
          return next;
        }
        // merge：已存在的课程原地更新，其余追加
        const next = [...prev];
        let added = 0;
        let updated = 0;
        for (const item of incoming) {
          const idx = next.findIndex((x) => sameCourse(x, item));
          if (idx >= 0) {
            next[idx] = { ...item, id: next[idx].id };
            updated += 1;
          } else {
            next.push(item);
            added += 1;
          }
        }
        outcome = { added, updated, total: next.length };
        return next;
      });

      return outcome;
    },
    [],
  );

  const clearCourses = useCallback(() => {
    setCourses([]);
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      courses,
      settings,
      autoFixedDays,
      addCourse,
      updateCourse,
      deleteCourse,
      importCourses,
      clearCourses,
      updateSettings,
    }),
    [ready, courses, settings, autoFixedDays, addCourse, updateCourse, deleteCourse, importCourses, clearCourses, updateSettings],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
