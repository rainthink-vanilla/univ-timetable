import { Course, ParsedCourseInput } from '../types';
import { genId } from './id';

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function rangeWeeks(a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: number[] = [];
  for (let w = lo; w <= hi; w++) out.push(w);
  return out;
}

/** 解析周次字符串，如 "1-16"、"1,3,5-8"、"1-16周(单)" */
export function parseWeekString(s: string, fallback = 16): number[] {
  let str = s.trim();
  let type: 'all' | 'odd' | 'even' = 'all';
  if (/[（(]\s*单\s*[)）]/.test(str) || /单周?$/.test(str)) {
    type = 'odd';
    str = str.replace(/[（(]\s*单\s*[)）]|单周?/g, '');
  } else if (/[（(]\s*双\s*[)）]/.test(str) || /双周?$/.test(str)) {
    type = 'even';
    str = str.replace(/[（(]\s*双\s*[)）]|双周?/g, '');
  }
  str = str.replace(/周/g, '').trim();

  const out: number[] = [];
  const parts = str.split(/[,，、;；\s]+/).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*[-—~至]\s*(\d+)$/);
    if (m) {
      out.push(...rangeWeeks(parseInt(m[1], 10), parseInt(m[2], 10)));
    } else if (/^\d+$/.test(part)) {
      out.push(parseInt(part, 10));
    }
  }
  if (!out.length) return rangeWeeks(1, fallback);
  const uniq = [...new Set(out)].sort((a, b) => a - b);
  if (type === 'odd') return uniq.filter((w) => w % 2 === 1);
  if (type === 'even') return uniq.filter((w) => w % 2 === 0);
  return uniq;
}

/** 把任意值规整为周次数组 */
export function toWeeksArray(v: unknown, fallback = 16): number[] {
  if (Array.isArray(v)) {
    const nums = v
      .map(toNumber)
      .filter((n): n is number => n !== null)
      .map((n) => Math.round(n))
      .filter((n) => n >= 1);
    const uniq = [...new Set(nums)].sort((a, b) => a - b);
    return uniq.length ? uniq : rangeWeeks(1, fallback);
  }
  if (typeof v === 'string') return parseWeekString(v, fallback);
  if (typeof v === 'number') return rangeWeeks(1, Math.round(v));
  return rangeWeeks(1, fallback);
}

/** 把 AI 返回的原始对象校验为结构化课程；不合法返回 null */
export function coerceCourse(raw: unknown): ParsedCourseInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = String(r.name ?? '').trim();
  if (!name) return null;
  const day = toNumber(r.dayOfWeek ?? r.day);
  const sp = toNumber(r.startPeriod ?? r.start);
  const ep = toNumber(r.endPeriod ?? r.end);
  if (day == null || sp == null || ep == null) return null;

  let dayOfWeek = clamp(Math.round(day), 1, 7);
  let startPeriod = clamp(Math.round(sp), 1, 20);
  let endPeriod = clamp(Math.round(ep), 1, 20);
  if (endPeriod < startPeriod) {
    const t = startPeriod;
    startPeriod = endPeriod;
    endPeriod = t;
  }
  return {
    name,
    teacher: String(r.teacher ?? '').trim(),
    location: String(r.location ?? r.place ?? '').trim(),
    dayOfWeek,
    startPeriod,
    endPeriod,
    weeks: toWeeksArray(r.weeks, 16),
    note: r.note != null ? String(r.note).trim() : undefined,
  };
}

/** 把解析结果转成完整 Course */
export function toCourse(p: ParsedCourseInput, color: string, id?: string): Course {
  return {
    ...p,
    id: id ?? genId(),
    color,
    weeks: [...new Set(p.weeks)].sort((a, b) => a - b),
  };
}
