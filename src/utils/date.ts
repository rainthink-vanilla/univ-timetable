/** 把 "YYYY-MM-DD" 解析为本地时区的 Date */
export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 格式化为 "YYYY-MM-DD" */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 星期几：1=周一 … 7=周日（JS getDay() 的 0=周日 映射为 7） */
export function dayOfWeekNumber(d: Date): number {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** 所在周的周一 */
export function mondayOfWeek(d: Date): Date {
  const s = startOfDay(d);
  return addDays(s, -(dayOfWeekNumber(s) - 1));
}

/** 当前是第几周（相对学期开始日期） */
export function currentWeekNumber(semesterStart: string, now: Date = new Date()): number {
  if (!semesterStart) return 1;
  const startMonday = mondayOfWeek(parseISODate(semesterStart));
  const curMonday = mondayOfWeek(now);
  const diffDays = Math.round((curMonday.getTime() - startMonday.getTime()) / 86400000);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

/** 第 week 周、星期 dayOfWeek 对应的具体日期 */
export function dateForWeekday(semesterStart: string, week: number, dayOfWeek: number): Date {
  const startMonday = mondayOfWeek(parseISODate(semesterStart));
  const monday = addDays(startMonday, (week - 1) * 7);
  return addDays(monday, dayOfWeek - 1);
}

/** 是否为今天 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "M/D" 短日期 */
export function shortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** "MM/DD 周X" 中文 */
export function cnDate(d: Date, dayLabel: string): string {
  return `${d.getMonth() + 1}月${d.getDate()}日 周${dayLabel}`;
}

/** 第 week 周（周一 ~ 周日）的起止日期 */
export function weekDateRange(semesterStart: string, week: number): { start: Date; end: Date } {
  const base = semesterStart || toISODate(mondayOfWeek(new Date()));
  const startMonday = mondayOfWeek(parseISODate(base));
  const monday = addDays(startMonday, (Math.max(1, week) - 1) * 7);
  return { start: monday, end: addDays(monday, 6) };
}

/**
 * 学期要展示多少周（「按周次列表」用）。
 * 取「设置的总周数」与「课表实际用到的最大周次」的较大值——
 * 否则设置 16 周、课表却排到 18 周时后面几周会被截掉。
 */
export function semesterWeekCount(totalWeeks: number, maxUsedWeek: number): number {
  const a = Number.isFinite(totalWeeks) ? Math.round(totalWeeks) : 20;
  const b = Number.isFinite(maxUsedWeek) ? Math.round(maxUsedWeek) : 1;
  return Math.min(60, Math.max(1, a, b));
}

/** "9/8 - 9/14" */
export function weekRangeLabel(semesterStart: string, week: number): string {
  const { start, end } = weekDateRange(semesterStart, week);
  return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
}
