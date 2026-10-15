import React, { createContext, useContext, useMemo } from 'react';
import { AccentTokens, DEFAULT_ACCENT_TOKENS, accentTokens } from '../theme';

/**
 * 强调色上下文（v1.6.0）。
 *
 * 为什么需要它：`StyleSheet.create` 会把颜色字面量固化在模块加载那一刻，
 * 组件里直接写 `palette.accent` 时，用户改「设置 → 外观 → 强调色」后界面**不会变化**
 * ——这正是 v1.5.0 的 BUG。改为渲染期从上下文取色（内联样式），改设置即刻生效。
 *
 * 默认值兜底：没有 Provider 时返回默认强调色，组件不会抛错（便于单测与局部渲染）。
 */
const AccentContext = createContext<AccentTokens>(DEFAULT_ACCENT_TOKENS);

export function AccentProvider({
  color,
  children,
}: {
  /** 用户设置的强调色（settings.accentColor），非法值自动回退默认色 */
  color?: string | null;
  children: React.ReactNode;
}) {
  const value = useMemo(() => accentTokens(color), [color]);
  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>;
}

/** 取当前强调色令牌：{ accent, accentSoft, accentTint } */
export function useAccent(): AccentTokens {
  return useContext(AccentContext);
}
