/**
 * 统一的配色与间距，保证界面风格一致、切换流畅。
 *
 * 关于强调色（v1.6.0 修复）：
 * 这里的 `palette.accent` 只是**默认值**。用户可在「设置 → 外观 → 强调色」里改，
 * 界面上的强调色必须走 `useAccent()`（`src/store/AccentContext.tsx`）动态取值。
 * 原因：`StyleSheet.create` 在模块加载时就固化了颜色字面量，
 * 把 palette.accent 写进 StyleSheet 会导致**改设置后界面毫无变化**（v1.5.0 的 BUG）。
 */

/** 强调色默认值（与 COURSE_COLORS[0] 保持一致） */
export const DEFAULT_ACCENT = '#6366F1';

/** 归一化 hex 颜色（#RGB / #RRGGBB，可省略 #，大小写均可）；非法输入返回 null */
export function normalizeHex(input: string): string | null {
  const m = String(input ?? '').trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  const h = m[1];
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return `#${full.toUpperCase()}`;
}

/** hex → rgba(...)；非法输入回退到默认强调色，alpha 会被钳制到 0~1 */
export function withAlpha(hex: string, alpha: number): string {
  const norm = normalizeHex(hex) ?? DEFAULT_ACCENT;
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  return `rgba(${r},${g},${b},${a})`;
}

/** 强调色令牌：accent 主色 / accentSoft 胶囊选中底 / accentTint 卡片高亮底 */
export interface AccentTokens {
  accent: string;
  accentSoft: string;
  accentTint: string;
}

/** 由用户设置的颜色派生整套强调色令牌（非法颜色自动回退默认色） */
export function accentTokens(color?: string | null): AccentTokens {
  const accent = normalizeHex(color ?? '') ?? DEFAULT_ACCENT;
  return { accent, accentSoft: withAlpha(accent, 0.22), accentTint: withAlpha(accent, 0.14) };
}

/** 默认强调色令牌（Provider 缺省值 / 组件兜底） */
export const DEFAULT_ACCENT_TOKENS: AccentTokens = accentTokens(DEFAULT_ACCENT);

export const palette = {
  bg: '#0B1220',
  bgDeep: '#070C18',
  surface: 'rgba(255,255,255,0.06)',
  surfaceStrong: 'rgba(255,255,255,0.10)',
  border: 'rgba(255,255,255,0.12)',
  text: '#F1F5F9',
  textDim: '#94A3B8',
  textFaint: '#64748B',
  accent: DEFAULT_ACCENT,
  accentSoft: withAlpha(DEFAULT_ACCENT, 0.22),
  danger: '#F43F5E',
  island: '#000000',
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const font = {
  title: 26,
  h2: 20,
  h3: 17,
  body: 15,
  small: 13,
  tiny: 11,
};
