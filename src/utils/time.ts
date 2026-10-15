/** 时间相关工具 */
export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10) || 0);
  return h * 60 + m;
}

export function nowMinutes(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** "08:05" 形式的当前时间 */
export function hhmm(now: Date): string {
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
