import { Course, Period } from '../types';
import { dayOfWeekNumber } from './date';
import { hhmmToMin, nowMinutes } from './time';

/**
 * 把**存量的脏 dayOfWeek** 规整为 1~7（无法识别返回 null）—— v1.7.2 新增。
 *
 * 为什么需要：老版本导入的数据里可能留着各种写法（`0`、`"7"`、`"周日"`、`"星期六"`…），
 * 而渲染是按 `c.dayOfWeek === 天数` 精确匹配的 —— 这些值会让课程**落到错误的列**或者干脆消失。
 * 现在渲染与统计一律先过这个函数，配合启动时的自动规整（`normalizeStoredCourses`），
 * 历史数据的星期不再影响显示位置。
 */
export function coerceDayOfWeek(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.round(raw);
    if (n === 0) return 7; // 0 = 周日（常见约定）
    return n >= 1 && n <= 7 ? n : null;
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const num = s.match(/^([0-7])$/);
  if (num) {
    const n = Number(num[1]);
    return n === 0 ? 7 : n;
  }
  const lower = s.toLowerCase();
  // 英文
  if (/^sun/.test(lower)) return 7;
  if (/^mon/.test(lower)) return 1;
  if (/^tue/.test(lower)) return 2;
  if (/^wed/.test(lower)) return 3;
  if (/^thu/.test(lower)) return 4;
  if (/^fri/.test(lower)) return 5;
  if (/^sat/.test(lower)) return 6;
  // 中文：先看"周日/周天/日"这类明确写法，再看"周六"
  if (/日|天/.test(s)) return 7;
  if (/六/.test(s)) return 6;
  if (/一/.test(s)) return 1;
  if (/二/.test(s)) return 2;
  if (/三/.test(s)) return 3;
  if (/四/.test(s)) return 4;
  if (/五/.test(s)) return 5;
  return null;
}

/**
 * 规整一整份课程列表的星期字段（启动时调用一次）。
 * 返回是否发生了修改，便于提示用户"已自动修正 N 门"。
 */
export function normalizeStoredCourses(courses: Course[]): { courses: Course[]; fixed: number } {
  let fixed = 0;
  const out = courses.map((c) => {
    const day = coerceDayOfWeek(c.dayOfWeek);
    if (day != null && day !== c.dayOfWeek) {
      fixed += 1;
      return { ...c, dayOfWeek: day };
    }
    if (day == null) {
      // 完全无法识别的值：落到周一，避免整条课程消失（同时计入修正数，便于用户自查）
      fixed += 1;
      return { ...c, dayOfWeek: 1 };
    }
    return c;
  });
  return { courses: out, fixed };
}

/** 某天某周的课程 */
export function coursesForDay(courses: Course[], dayOfWeek: number, week: number): Course[] {
  return courses
    .filter((c) => coerceDayOfWeek(c.dayOfWeek) === dayOfWeek && c.weeks.includes(week))
    .sort((a, b) => a.startPeriod - b.startPeriod || a.endPeriod - b.endPeriod);
}

/** 生成周次数组（按 单/双/全部） */
export function buildWeeks(start: number, end: number, type: 'all' | 'odd' | 'even'): number[] {
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  const out: number[] = [];
  for (let w = a; w <= b; w++) {
    if (type === 'odd' && w % 2 === 0) continue;
    if (type === 'even' && w % 2 === 1) continue;
    out.push(w);
  }
  return out;
}

/** 把周次数组压缩成可读标签 */
export function weeksLabel(weeks: number[]): string {
  if (!weeks.length) return '未设置周次';
  const min = weeks[0];
  const max = weeks[weeks.length - 1];
  const full = max - min + 1 === weeks.length;
  if (full) return `${min}-${max}周`;
  if (weeks.length >= 2) {
    const step = weeks[1] - weeks[0];
    const arithmetic = weeks.every((w, i) => i === 0 || w - weeks[i - 1] === step);
    if (arithmetic && step === 2) {
      return weeks[0] % 2 === 1 ? `${min}-${max}周(单)` : `${min}-${max}周(双)`;
    }
  }
  return `${compressRanges(weeks)}周`;
}

function compressRanges(weeks: number[]): string {
  const sorted = Array.from(new Set(weeks)).sort((a, b) => a - b);
  if (!sorted.length) return '';
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i];
    if (w === prev + 1) {
      prev = w;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = w;
    prev = w;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(',');
}

/** 某一周的全部课程，按 星期 → 开始节次 排序 */
export function coursesInWeek(courses: Course[], week: number): Course[] {
  return courses
    .filter((c) => c.weeks.includes(week))
    .sort(
      (a, b) =>
        (coerceDayOfWeek(a.dayOfWeek) ?? 1) - (coerceDayOfWeek(b.dayOfWeek) ?? 1) ||
        a.startPeriod - b.startPeriod,
    );
}

/** 所有课程里用到的最大周次（无课程时为 0） */
export function maxUsedWeek(courses: Course[]): number {
  let max = 0;
  for (const c of courses) {
    for (const w of c.weeks) {
      if (w > max) max = w;
    }
  }
  return max;
}

/** 该课程此刻是否正在上课 */
export function isCourseActive(course: Course, now: Date, periods: Period[], week: number): boolean {
  if (coerceDayOfWeek(course.dayOfWeek) !== dayOfWeekNumber(now)) return false;
  if (!course.weeks.includes(week)) return false;
  const s = periods.find((p) => p.index === course.startPeriod);
  const e = periods.find((p) => p.index === course.endPeriod);
  if (!s || !e) return false;
  const m = nowMinutes(now);
  return m >= hhmmToMin(s.start) && m < hhmmToMin(e.end);
}

/** 今天正在上或下一节要上的课 */
export function nextCourseToday(courses: Course[], week: number, periods: Period[], now: Date): Course | null {
  const day = dayOfWeekNumber(now);
  const m = nowMinutes(now);
  const todays = courses
    .filter((c) => coerceDayOfWeek(c.dayOfWeek) === day && c.weeks.includes(week))
    .map((c) => {
      const s = periods.find((p) => p.index === c.startPeriod);
      const e = periods.find((p) => p.index === c.endPeriod);
      return { c, s, e };
    })
    .filter((x) => x.s && x.e)
    .sort((a, b) => hhmmToMin((a.s as Period).start) - hhmmToMin((b.s as Period).start));

  const ongoing = todays.find((x) => m >= hhmmToMin((x.s as Period).start) && m < hhmmToMin((x.e as Period).end));
  if (ongoing) return ongoing.c;
  const next = todays.find((x) => hhmmToMin((x.s as Period).start) > m);
  return next ? next.c : null;
}
