/**
 * 统一课表文件（.md）解析 / 生成
 *
 * 契约见 docs/01-用户信息表与爬取引导.md：
 *   1. 优先读取 ```json 代码块（univ-timetable/v1）
 *   2. 否则读取「课程明细」Markdown 表格
 *   3. 最后兜底扫描文中出现的 JSON 对象
 *
 * 除课程外还会读取**节次时间表**（各校作息不同：有的 8:00 上课、有的 8:30）。
 *
 * 本文件为纯函数模块：不依赖 React Native / Node API，可直接用 node 跑单测。
 */
import { ParsedCourseInput, Period, TimetableMeta } from '../types';
import { parseWeekString, toNumber, toWeeksArray } from './parse';

export const CONTRACT_VERSION = 'univ-timetable/v1';

/** 文件里携带的主题信息（分享场景：让对方一键套用同一套外观） */
export interface FileTheme {
  accentColor?: string;
  backgroundOverlay?: number;
  iconEmoji?: string | null;
}

/** 结果里额外带上文件中的节次时间表（有则 App 会同步到设置） */
export interface ParsedTimetableFile {
  meta: TimetableMeta;
  courses: ParsedCourseInput[];
  /** 文件里给出的节次时间表；没有则为空数组 */
  periods: Period[];
  /** 文件里给出的主题信息（分享文件才有） */
  theme?: FileTheme;
  /** 实际生效的解析层，便于向用户解释 */
  via: 'json' | 'table' | 'raw-json' | 'none';
  /** 格式层面的警告（不影响导入，但要提示用户） */
  warnings: string[];
}

/** 从 JSON 负载里读主题（字段名做了别名容忍） */
export function parseFileTheme(raw: unknown): FileTheme | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const t = (r.theme && typeof r.theme === 'object' ? r.theme : r) as Record<string, unknown>;
  const theme: FileTheme = {};
  const accent = t.accentColor ?? t.accent ?? r.accentColor;
  if (typeof accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(accent)) theme.accentColor = accent;
  const ov = toNumber(t.backgroundOverlay ?? t.overlay);
  if (ov != null && ov >= 0 && ov <= 1) theme.backgroundOverlay = ov;
  const emoji = t.iconEmoji ?? r.iconEmoji;
  if (typeof emoji === 'string' && emoji.trim()) theme.iconEmoji = emoji.trim();
  return Object.keys(theme).length ? theme : undefined;
}

/* ------------------------------------------------------------------ */
/* 节次时间表                                                          */
/* ------------------------------------------------------------------ */

/** "8:00" / "08:00" / "8：00" / "8点10分" → "08:00"；无法识别返回 null */
export function normalizeClockTime(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[：]/g, ':').replace(/[．。]/g, '.');
  if (!s) return null;

  // "8:00" / "8:0" / "0800"
  let m = s.match(/^(\d{1,2})\s*[:.]\s*(\d{1,2})$/);
  if (!m) m = s.match(/^(\d{3,4})$/); // 0800 / 830
  if (m) {
    let h: number;
    let mi: number;
    if (m[1].length >= 3) {
      const t = m[1];
      h = parseInt(t.slice(0, t.length - 2), 10);
      mi = parseInt(t.slice(-2), 10);
    } else {
      h = parseInt(m[1], 10);
      mi = parseInt(m[2], 10);
    }
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
      return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    }
    return null;
  }

  // "8点" / "8点10分" / "8时10分"
  m = s.match(/^(\d{1,2})\s*[点时](?:\s*(\d{1,2})\s*分?)?$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const mi = m[2] ? parseInt(m[2], 10) : 0;
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
      return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    }
  }
  return null;
}

const inRange = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;
const seq = (a: number, b: number): number[] => {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
};

/**
 * 解析文件里的节次时间表。支持三种写法：
 *
 * 1. `periods: [{ index, start, end }, ...]`          —— 最规范
 * 2. `periodTimes: [{ period: 1, start: "08:00", end: "08:45" }, ...]`
 * 3. `periodTimes: { start: "08:00", duration: 45, break: 10, count: 12 }` —— 最省事
 *    （从第一节开始时间 + 每节时长 + 课间，自动推算全部节次）
 *
 * 返回按 index 升序、去重后的节次表；解析不出内容时返回空数组。
 */
export function parsePeriodTimes(raw: unknown): Period[] {
  if (raw == null) return [];

  // ---------- 写法 3：start + duration 推算 ----------
  if (!Array.isArray(raw) && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const startTime = normalizeClockTime(o.start != null ? o.start : o.firstStart);
    if (startTime) {
      const duration = toNumber(o.duration) ?? toNumber(o.lessonMinutes) ?? 45;
      const brk = toNumber(o.break) ?? toNumber(o.breakMinutes) ?? 10;
      const count = Math.round(toNumber(o.count) ?? toNumber(o.periods) ?? 12);
      if (inRange(count, 1, 20) && duration > 0 && brk >= 0) {
        const [h0, m0] = startTime.split(':').map((x) => parseInt(x, 10));
        let cursor = h0 * 60 + m0;
        const out: Period[] = [];
        for (let i = 1; i <= count; i++) {
          const s = cursor;
          const e = cursor + duration;
          const hh = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
          out.push({ index: i, start: hh(s), end: hh(e) });
          cursor = e + brk;
        }
        return out;
      }
    }
    return [];
  }

  if (!Array.isArray(raw)) return [];

  const out: Period[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item) continue;

    let index: number | null = null;
    let start: string | null = null;
    let end: string | null = null;

    if (typeof item === 'string') {
      // "08:00-08:45" 这种，序号按数组位置推断
      const m = item.match(/^(.+?)\s*[-~—到至]\s*(.+)$/);
      if (m) {
        start = normalizeClockTime(m[1]);
        end = normalizeClockTime(m[2]);
      }
      index = i + 1;
    } else if (typeof item === 'object') {
      const r = item as Record<string, unknown>;
      const idx = toNumber(r.index ?? r.period ?? r.no ?? r.seq ?? r['节次']);
      index = idx != null ? Math.round(idx) : i + 1;
      start = normalizeClockTime(r.start ?? r.begin ?? r.from ?? r['开始'] ?? r['开始时间']);
      end = normalizeClockTime(r.end ?? r.finish ?? r.to ?? r['结束'] ?? r['结束时间']);

      // "08:00-08:45" 放在单个字段里
      if (!start || !end) {
        const span = r.time ?? r.range ?? r['时间'];
        if (typeof span === 'string') {
          const m = span.match(/^(.+?)\s*[-~—到至]\s*(.+)$/);
          if (m) {
            start = start ?? normalizeClockTime(m[1]);
            end = end ?? normalizeClockTime(m[2]);
          }
        }
      }
      // single "start" field containing "08:00-08:45"
      if ((!start || !end) && typeof r.start === 'string') {
        const m = (r.start as string).match(/^(.+?)\s*[-~—到至]\s*(.+)$/);
        if (m) {
          start = normalizeClockTime(m[1]);
          end = normalizeClockTime(m[2]);
        }
      }
    }

    if (index == null || !inRange(index, 1, 20)) continue;
    if (!start || !end) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    out.push({ index, start, end });
  }

  return out.sort((a, b) => a.index - b.index);
}

/** 从 markdown 正文的「节次时间」表格里取节次时间（JSON 层缺失时的兜底） */
function periodsFromText(md: string): Period[] {
  const lines = md.split(/\r?\n/);
  let header: { idx: number; start: number; end: number; span: number } | null = null;
  const out: Period[] = [];
  const seen = new Set<number>();

  for (const line of lines) {
    if (line.indexOf('|') < 0) {
      header = null;
      continue;
    }
    if (isSeparatorRow(line)) continue;
    const cells = splitRow(line).map((c) => c.toLowerCase());

    if (!header) {
      const idx = cells.findIndex((c) => c.indexOf('节次') >= 0 || c === 'index' || c === 'period');
      const span = cells.findIndex((c) => c.indexOf('时间') >= 0 && c.indexOf('节次') < 0);
      const start = cells.findIndex((c) => c.indexOf('开始') >= 0 || c === 'start');
      const end = cells.findIndex((c) => c.indexOf('结束') >= 0 || c === 'end');
      if (idx >= 0 && (span >= 0 || (start >= 0 && end >= 0))) {
        header = { idx, start, end, span };
      }
      continue;
    }

    const cells2 = splitRow(line);
    const rawIdx = cells2[header.idx] ?? '';
    const idxNum = toNumber(String(rawIdx).replace(/[^\d]/g, ''));
    if (idxNum == null) continue;
    const index = Math.round(idxNum);
    if (!inRange(index, 1, 20) || seen.has(index)) continue;

    let start: string | null = null;
    let end: string | null = null;
    if (header.span >= 0) {
      const spanText = cells2[header.span] ?? '';
      const m = spanText.match(/^(.+?)\s*[-~—到至]\s*(.+)$/);
      if (m) {
        start = normalizeClockTime(m[1]);
        end = normalizeClockTime(m[2]);
      }
    }
    if ((!start || !end) && header.start >= 0 && header.end >= 0) {
      start = start ?? normalizeClockTime(cells2[header.start]);
      end = end ?? normalizeClockTime(cells2[header.end]);
    }
    if (!start || !end) continue;

    seen.add(index);
    out.push({ index, start, end });
  }

  return out.sort((a, b) => a.index - b.index);
}

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 去掉 markdown 行内标记，规整空白 */
export function cleanCell(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 把各种写法归一到星期几：1=周一 … 7=周日；无法识别返回 null */
export function normalizeDay(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.round(raw);
    // 0 视为周日（很多教务系统/JSON 用 0=周日）
    if (n === 0) return 7;
    return n >= 1 && n <= 7 ? n : null;
  }
  const s = cleanCell(String(raw));
  if (!s) return null;

  const direct = s.match(/^([0-7])$/);
  if (direct) return Number(direct[1]) === 0 ? 7 : Number(direct[1]);

  if (s.indexOf('一') >= 0 || s.indexOf('1') >= 0) return 1;
  if (s.indexOf('二') >= 0 || s.indexOf('2') >= 0) return 2;
  if (s.indexOf('三') >= 0 || s.indexOf('3') >= 0) return 3;
  if (s.indexOf('四') >= 0 || s.indexOf('4') >= 0) return 4;
  if (s.indexOf('五') >= 0 || s.indexOf('5') >= 0) return 5;
  if (s.indexOf('六') >= 0 || s.indexOf('6') >= 0) return 6;
  if (s.indexOf('日') >= 0 || s.indexOf('天') >= 0 || s.indexOf('7') >= 0) return 7;

  const lower = s.toLowerCase();
  const en: [number, string[]][] = [
    [1, ['mon', 'monday']],
    [2, ['tue', 'tuesday']],
    [3, ['wed', 'wednesday']],
    [4, ['thu', 'thursday']],
    [5, ['fri', 'friday']],
    [6, ['sat', 'saturday']],
    [7, ['sun', 'sunday']],
  ];
  for (let i = 0; i < en.length; i++) {
    const words = en[i][1];
    for (let j = 0; j < words.length; j++) {
      if (lower.indexOf(words[j]) >= 0) return en[i][0];
    }
  }
  return null;
}

/** 解析节次，支持 "第1-2节"、"1-2"、"3"、"1,2"、"1-2节" */
export function parsePeriodRange(raw: unknown): { start: number; end: number } | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = clampInt(raw, 1, 20);
    return { start: n, end: n };
  }
  const s = cleanCell(String(raw));
  if (!s) return null;
  const nums = s.match(/\d+/g);
  if (!nums || !nums.length) return null;
  const a = clampInt(parseInt(nums[0], 10), 1, 20);
  const b = nums.length > 1 ? clampInt(parseInt(nums[1], 10), 1, 20) : a;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/* ------------------------------------------------------------------ */
/* 表格解析                                                            */
/* ------------------------------------------------------------------ */

/** 把一行 markdown 表格拆成单元格（首尾的 | 会被忽略） */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.charAt(0) === '|') s = s.slice(1);
  if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
  return s.split('|').map((c) => cleanCell(c));
}

/** 是否是 markdown 表格分隔行，如 |---|:--:|---| */
export function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line);
  if (!cells.length) return false;
  for (let i = 0; i < cells.length; i++) {
    if (!/^:?-{2,}:?$/.test(cells[i])) return false;
  }
  return true;
}

type ColKey = 'name' | 'teacher' | 'location' | 'day' | 'period' | 'weeks' | 'note' | 'color';

/** 表头单元格 → 语义列 */
function matchColumn(header: string): ColKey | null {
  const h = cleanCell(header).toLowerCase().replace(/[\s()（）]/g, '');
  if (!h) return null;
  if (h.indexOf('课程名称') >= 0 || h.indexOf('课程') >= 0 || h.indexOf('名称') >= 0) return 'name';
  if (h.indexOf('教师') >= 0 || h.indexOf('老师') >= 0 || h === 'teacher') return 'teacher';
  if (h.indexOf('地点') >= 0 || h.indexOf('教室') >= 0 || h === 'location' || h === 'place') return 'location';
  if (h.indexOf('星期') >= 0 || h.indexOf('周几') >= 0 || h.indexOf('星期几') >= 0 || h === 'day' || h === 'dayofweek') return 'day';
  if (h.indexOf('节次') >= 0 || h.indexOf('时间') >= 0 || h.indexOf('时段') >= 0 || h === 'period') return 'period';
  if (h.indexOf('周次') >= 0 || h.indexOf('周数') >= 0 || h === 'weeks' || h === 'week') return 'weeks';
  if (h.indexOf('备注') >= 0 || h === 'note') return 'note';
  if (h.indexOf('颜色') >= 0 || h === 'color') return 'color';
  return null;
}

/** 从 markdown 表格文本中解析课程 */
export function parseCourseTable(md: string): ParsedCourseInput[] {
  const lines = md.split(/\r?\n/);
  let header: (ColKey | null)[] | null = null;
  const out: ParsedCourseInput[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.indexOf('|') < 0) {
      // 表格被空行/普通文本打断后，允许再次出现新的表头
      header = null;
      continue;
    }
    if (isSeparatorRow(line)) continue;

    const cells = splitRow(line);
    if (!header) {
      const mapped = cells.map(matchColumn);
      const hitCount = mapped.filter(Boolean).length;
      // 至少要认出「课程」+「星期」+「节次」才算表头
      if (mapped.indexOf('name') >= 0 && mapped.indexOf('day') >= 0 && mapped.indexOf('period') >= 0 && hitCount >= 3) {
        header = mapped;
      }
      continue;
    }

    const row: Record<string, string> = {};
    for (let c = 0; c < header.length && c < cells.length; c++) {
      const key = header[c];
      if (key) row[key] = cells[c];
    }

    const name = (row.name || '').trim();
    if (!name || /^-+$/.test(name)) continue;

    // v1.7.1：一格写了多天（周六、周日 / 6,7 / 周末）→ **每天各生成一条**
    const days = normalizeDays(row.day);
    const period = parsePeriodRange(row.period);
    if (!days.length || !period) continue;

    for (const day of days) {
      out.push({
        name,
        teacher: (row.teacher || '').trim(),
        location: (row.location || '').trim(),
        dayOfWeek: day,
        startPeriod: period.start,
        endPeriod: period.end,
        weeks: row.weeks ? toWeeksArray(row.weeks, 20) : parseWeekString('1-20', 20),
        note: (row.note || '').trim() || undefined,
      });
    }
  }
  return out;
}

/**
 * 把「可能写了多天」的单元格归一成星期数组（升序去重）。
 *
 * 为什么需要它（v1.7.1 BUG 修复）：
 * 课表里常见**一门课一周上两天**，爬取结果写成 `周六、周日` / `周六/周日` / `六日` / `6,7`。
 * 原先只取第一个匹配到的星期（`周六、周日` → 6），
 * 于是"两天的课都落进周六那一列"、周日整列空着 —— 用户看到的就是课程被挤进周六列。
 * 现在按分隔符拆开逐段识别，**一门课几天就生成几条**（与手动添加的"星期多选"语义一致）。
 */
export function normalizeDays(raw: unknown): number[] {
  if (raw == null) return [];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = normalizeDay(raw);
    return n == null ? [] : [n];
  }
  let s = cleanCell(String(raw));
  if (!s) return [];

  const days = new Set<number>();

  // ① 语义词优先（处理后把词从串里剔除，否则"工作日"会残留一个"日"被判成周日）
  const semantic: [RegExp, number[]][] = [
    [/周末|双休|周六日|星期六日|周六和周日/g, [6, 7]],
    [/工作日/g, [1, 2, 3, 4, 5]],
    [/每天|每日|天天|全周|一周七天|周一至周日|周一到周日/g, [1, 2, 3, 4, 5, 6, 7]],
  ];
  for (const [re, ds] of semantic) {
    if (re.test(s)) {
      ds.forEach((d) => days.add(d));
      s = s.replace(re, ' ');
    }
  }

  // ② 区间写法：6-7 / 一至五 / 1~5 / 周一到周五（前缀"周/星期/礼拜"可有可无）
  const rangeRe = /(?:周|星期|礼拜)?\s*([0-7一二三四五六日天])\s*(?:-|~|—|–|至|到)\s*(?:周|星期|礼拜)?\s*([0-7一二三四五六日天])/g;
  s = s.replace(rangeRe, (_all, a: string, b: string) => {
    const da = normalizeDay(a);
    const db = normalizeDay(b);
    if (da != null && db != null) {
      for (let d = Math.min(da, db); d <= Math.max(da, db); d++) days.add(d);
    }
    return ' ';
  });

  // ③ 按分隔符拆段逐段识别
  for (const p of s.split(/[、,，;；/／|｜\\\s]+|和|及|与|以及/).map((x) => x.trim()).filter(Boolean)) {
    const d = normalizeDay(p);
    if (d != null) days.add(d);
  }

  // ④ 字符级兜底：连写形式（六日 / 周六周日 / 一二三四五）
  const compact = s.replace(/周|星期|礼拜/g, '').replace(/[、,，;；/／|｜\\\s]+/g, '');
  if (/^[0-7一二三四五六日天]{2,}$/.test(compact)) {
    for (const ch of compact) {
      const d = normalizeDay(ch);
      if (d != null) days.add(d);
    }
  }

  // ⑤ 最后整串兜底（例如"星期日"被拆分后仍可识别）
  if (!days.size) {
    const d = normalizeDay(s);
    if (d != null) days.add(d);
  }

  return Array.from(days).sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ */
/* 元信息解析                                                          */
/* ------------------------------------------------------------------ */

function pickMeta(payload: Record<string, unknown>): TimetableMeta {
  const meta: TimetableMeta = {};
  const source = (payload.meta && typeof payload.meta === 'object' ? payload.meta : {}) as Record<string, unknown>;
  const get = (k: string): unknown => (source[k] !== undefined ? source[k] : payload[k]);
  const str = (k: string): string | undefined => {
    const v = get(k);
    if (v == null) return undefined;
    const s = String(v).trim();
    return s ? s : undefined;
  };
  meta.school = str('school');
  meta.jwcURL = str('jwcURL') || str('jwcUrl');
  meta.semester = str('semester');
  meta.semesterStart = str('semesterStart');
  meta.weekRange = str('weekRange');
  meta.scrapedAt = str('scrapedAt');
  meta.student = str('student');
  meta.studentId = str('studentId');
  meta.scope = str('scope');
  const tw = toNumber(get('totalWeeks'));
  if (tw != null && tw >= 1 && tw <= 60) meta.totalWeeks = Math.round(tw);
  return meta;
}

/** 从 markdown 正文的「表格 / 列表」中提取元信息（JSON 层缺失时的兜底） */
function metaFromText(md: string): TimetableMeta {
  const kv: Record<string, string> = {};
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.indexOf('|') >= 0 && !isSeparatorRow(line)) {
      const cells = splitRow(line);
      if (cells.length >= 2 && cells[0] && cells[1] && cells[0] !== cells[1]) {
        const k = cells[0].replace(/[\s:*]/g, '');
        if (k && !kv[k]) kv[k] = cells[1];
      }
    }
    const m = line.match(/^\s*[-*]?\s*([^:：|\n]{1,12})\s*[:：]\s*(.+?)\s*$/);
    if (m) {
      const k = cleanCell(m[1]).replace(/\*\*/g, '').replace(/[\s:*]/g, '');
      if (k && !kv[k]) kv[k] = cleanCell(m[2]);
    }
  }
  const grab = (labels: string[]): string | undefined => {
    for (let i = 0; i < labels.length; i++) {
      const v = kv[labels[i]];
      if (v && v !== '-') return v;
    }
    return undefined;
  };

  const meta: TimetableMeta = {};
  meta.school = grab(['学校', '学校名称']);
  meta.semester = grab(['学期', '学期名称']);
  meta.student = grab(['姓名', '学生']);
  meta.studentId = grab(['学号']);
  meta.weekRange = grab(['覆盖周次', '周次范围']);
  meta.scrapedAt = grab(['爬取时间', '生成时间']);
  meta.jwcURL = grab(['教务系统地址', '教务系统', '系统地址']);
  meta.scope = grab(['爬取范围']);
  const start = grab(['学期开始日期', '开学日期']);
  if (start && /^\d{4}-\d{1,2}-\d{1,2}$/.test(start)) meta.semesterStart = start;
  const tw = grab(['学期总周数', '总周数']);
  if (tw) {
    const n = toNumber(tw);
    if (n != null && n >= 1 && n <= 60) meta.totalWeeks = Math.round(n);
  }
  return meta;
}

function coerceCourseList(raw: unknown, loose = false): ParsedCourseInput[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedCourseInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const name = String(r.name != null ? r.name : r.course != null ? r.course : r.title != null ? r.title : '').trim();
    if (!name) continue;

    let days = normalizeDays(r.dayOfWeek != null ? r.dayOfWeek : r.day);
    if (!days.length && loose) {
      const dayText = r.dayName != null ? r.dayName : r.weekday != null ? r.weekday : r.week != null && typeof r.week === 'string' ? r.week : undefined;
      if (dayText != null) {
        const t = String(dayText);
        const idx = t.lastIndexOf('周');
        days = normalizeDays(idx >= 0 ? t.slice(idx + 1) : t);
      }
    }

    let period = parsePeriodRange(
      r.period != null
        ? r.period
        : r.startPeriod != null
        ? `${r.startPeriod}-${r.endPeriod != null ? r.endPeriod : r.startPeriod}`
        : r.start != null
        ? `${r.start}-${r.end != null ? r.end : r.start}`
        : undefined,
    );
    if (!period && loose && r.time != null) period = parsePeriodRange(r.time);
    if (!days.length || !period) continue;

    // v1.7.1：JSON 里若给的是多天（数组或"周六、周日"）→ 每天各生成一条
    for (const day of days) {
      out.push({
        name,
        teacher: String(r.teacher != null ? r.teacher : r.tutor != null ? r.tutor : '').trim(),
        location:
          String(r.location != null ? r.location : r.place != null ? r.place : r.room != null ? r.room : '').trim(),
        dayOfWeek: day,
        startPeriod: period.start,
        endPeriod: period.end,
        weeks: toWeeksArray(r.weeks != null ? r.weeks : r.weekList, 20),
        note: r.note != null ? String(r.note).trim() || undefined : undefined,
      });
    }
  }
  return out;
}

/** 依次尝试 ```json 代码块 → 首个 JSON 对象 */
function extractJsonPayloads(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    const body = m[1].trim();
    if (body.charAt(0) !== '{' && body.charAt(0) !== '[') continue;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object') out.push(parsed as Record<string, unknown>);
    } catch {
      /* 跳过非法代码块 */
    }
  }
  if (!out.length) {
    // 兜底：截取第一段看起来像 JSON 的文本（对象或数组）
    const objStart = text.indexOf('{');
    const arrStart = text.indexOf('[');
    let start = -1;
    if (objStart >= 0 && arrStart >= 0) start = Math.min(objStart, arrStart);
    else start = Math.max(objStart, arrStart);
    const objEnd = text.lastIndexOf('}');
    const arrEnd = text.lastIndexOf(']');
    const end = Math.max(objEnd, arrEnd);
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (parsed && typeof parsed === 'object') out.push(parsed as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

/** 解析一份课表文件内容（.md / .json / 纯文本） */
export function parseTimetableFile(text: string): ParsedTimetableFile {
  const warnings: string[] = [];
  const src = text.replace(/^\uFEFF/, '');
  if (!src.trim()) {
    return { meta: {}, courses: [], periods: [], via: 'none', warnings: ['文件内容为空'] };
  }

  /** 节次时间：JSON 的 periods/periodTimes 优先，其次正文「节次时间」表格 */
  const periodsOf = (payload: Record<string, unknown> | null): Period[] => {
    if (payload && !Array.isArray(payload)) {
      const fromJson = parsePeriodTimes(
        payload.periods != null ? payload.periods : payload.periodTimes != null ? payload.periodTimes : payload.meta && typeof payload.meta === 'object' ? (payload.meta as Record<string, unknown>).periods : undefined,
      );
      if (fromJson.length) return fromJson;
    }
    return periodsFromText(src);
  };

  const payloads = extractJsonPayloads(src);
  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    const rawList = Array.isArray(payload) ? payload : (payload.courses as unknown);
    const courses = coerceCourseList(rawList);
    if (courses.length) {
      const meta = Array.isArray(payload) ? metaFromText(src) : { ...metaFromText(src), ...pickMeta(payload) };
      const via = Array.isArray(payload) ? 'raw-json' : 'json';
      if (via === 'raw-json') warnings.push('文件里是裸 JSON 数组，缺少 meta 信息（学期/学校），建议使用标准模板。');
      return {
        meta,
        courses,
        periods: periodsOf(Array.isArray(payload) ? null : payload),
        theme: Array.isArray(payload) ? undefined : parseFileTheme(payload),
        via,
        warnings,
      };
    }
  }

  const tableCourses = parseCourseTable(src);
  if (tableCourses.length) {
    return { meta: metaFromText(src), courses: tableCourses, periods: periodsOf(null), via: 'table', warnings };
  }

  // 兜底：JSON 里课程字段名不规范（例如 "course"/"day"），逐条宽松识别
  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    const rawList = Array.isArray(payload) ? payload : (payload.courses as unknown);
    const loose = coerceCourseList(rawList, true);
    if (loose.length) {
      warnings.push('课程字段命名不标准，已按宽松规则识别，建议改用标准模板。');
      const meta = Array.isArray(payload) ? metaFromText(src) : { ...metaFromText(src), ...pickMeta(payload) };
      return {
        meta,
        courses: loose,
        periods: periodsOf(Array.isArray(payload) ? null : payload),
        theme: Array.isArray(payload) ? undefined : parseFileTheme(payload),
        via: Array.isArray(payload) ? 'raw-json' : 'json',
        warnings,
      };
    }
  }

  warnings.push('未能从文件中解析出任何课程。请确认文件包含 ```json 代码块或「课程明细」表格。');
  return { meta: metaFromText(src), courses: [], periods: periodsOf(null), via: 'none', warnings };
}

/** 生成一份符合契约的课表文件（App 导出 / 分享时使用） */
export function buildTimetableMarkdown(input: {
  meta: TimetableMeta;
  courses: ParsedCourseInput[];
  /** 节次时间表；有则写入文件，便于换机/给 agent 参考 */
  periods?: Period[];
  /** 主题信息；分享给他人的文件带上后，对方可一键套用同一套外观 */
  theme?: FileTheme;
}): string {
  const meta = input.meta || {};
  const periods = (input.periods || []).slice().sort((a, b) => a.index - b.index);
  const theme = input.theme;
  const hasTheme = !!theme && Object.keys(theme).length > 0;
  const rows = input.courses.map((c) => {
    const weeks = c.weeks && c.weeks.length ? weekRangeText(c.weeks) : '1-20';
    const period = c.startPeriod === c.endPeriod ? `第${c.startPeriod}节` : `第${c.startPeriod}-${c.endPeriod}节`;
    return `| ${c.name} | ${c.teacher || '-'} | ${c.location || '-'} | 周${'一二三四五六日'.charAt(c.dayOfWeek - 1)} | ${period} | ${weeks} | ${c.note || '-'} |`;
  });
  const periodRows = periods.map((p) => `| 第${p.index}节 | ${p.start} - ${p.end} |`);
  const payload = {
    contract: CONTRACT_VERSION,
    meta,
    // 节次时间表：各校作息不同（有的 8:00 上课，有的 8:30）
    ...(periods.length ? { periods } : {}),
    // 主题：分享场景下让对方还原同一套外观（背景图不内嵌，仅传配色与遮罩）
    ...(hasTheme ? { theme } : {}),
    courses: input.courses.map((c) => ({
      name: c.name,
      teacher: c.teacher,
      location: c.location,
      dayOfWeek: c.dayOfWeek,
      startPeriod: c.startPeriod,
      endPeriod: c.endPeriod,
      weeks: c.weeks,
      note: c.note,
    })),
  };
  const themeSection = hasTheme
    ? [
        '## 四、主题（可选，导入时可选择是否应用）',
        '',
        '| 项目 | 值 |',
        '| --- | --- |',
        `| 强调色 | ${theme.accentColor || '-'} |`,
        `| 背景遮罩 | ${typeof theme.backgroundOverlay === 'number' ? Math.round(theme.backgroundOverlay * 100) + '%' : '-'} |`,
        `| 图标 | ${theme.iconEmoji || '-'} |`,
        '',
      ]
    : [];
  return [
    '# 大学课表数据文件',
    '',
    `> 契约版本：\`${CONTRACT_VERSION}\`　生成时间：${meta.scrapedAt || new Date().toISOString()}`,
    '',
    '## 一、课表元信息',
    '',
    '| 项目 | 内容 |',
    '| --- | --- |',
    `| 学校 | ${meta.school || '-'} |`,
    `| 教务系统地址 | ${meta.jwcURL || '-'} |`,
    `| 学期 | ${meta.semester || '-'} |`,
    `| 学期开始日期 | ${meta.semesterStart || '-'} |`,
    `| 学期总周数 | ${meta.totalWeeks != null ? meta.totalWeeks : '-'} |`,
    `| 覆盖周次 | ${meta.weekRange || '-'} |`,
    `| 爬取范围 | ${meta.scope || '-'} |`,
    `| 学生 | ${meta.student || '-'} |`,
    `| 学号 | ${meta.studentId || '-'} |`,
    `| 爬取时间 | ${meta.scrapedAt || '-'} |`,
    '',
    '## 二、节次时间表（各校作息不同，请按学校实际填写）',
    '',
    '| 节次 | 时间 |',
    '| --- | --- |',
    ...(periodRows.length ? periodRows : ['| 第1节 | 08:00 - 08:45 |']),
    '',
    '## 三、课程明细',
    '',
    '| 课程名称 | 教师 | 地点 | 星期 | 节次 | 周次 | 备注 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...(rows.length ? rows : ['| - | - | - | - | - | - | - |']),
    '',
    ...themeSection,
    `## ${hasTheme ? '五' : '四'}、机器可读数据（App 直接读取这一段）`,
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
  ].join('\n');
}

/** 把周次数组压缩成 "1-8,10,12-16" 形式 */
export function weekRangeText(weeks: number[]): string {
  const sorted = Array.from(new Set(weeks)).sort((a, b) => a - b);
  if (!sorted.length) return '';
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(',');
}

/** 生成 UTF-8 字节，用于写入文件（RN 与 Node 都支持 TextEncoder） */
export function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
