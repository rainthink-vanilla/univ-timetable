import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './ui';
import { font, palette, spacing } from '../theme';
import { useAccent } from '../store/AccentContext';

/**
 * 设置里的「分类抽屉」（v1.7.1）。
 *
 * 设计要点：
 * 1. **标题行即摘要**：收起时也能一眼看到这一类当前是什么状态（如「开学 2025-09-01 · 20 周」），
 *    不必展开找；
 * 2. `collapsible=false` 时退化为普通分组卡片（标题不可点），
 *    供「关掉抽屉样式」的平铺模式复用同一套排版；
 * 3. 收起时**不渲染内容**（不是仅隐藏），避免长表单在收起状态下仍然参与布局与测量。
 */
export function SectionDrawer({
  title,
  summary,
  open,
  collapsible = true,
  onToggle,
  children,
}: {
  title: string;
  /** 收起状态下显示的当前状态摘要 */
  summary?: string;
  open: boolean;
  /** 是否可折叠（平铺模式传 false） */
  collapsible?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  const { accent } = useAccent();
  return (
    <Card style={styles.card}>
      <Pressable
        onPress={collapsible ? onToggle : undefined}
        disabled={!collapsible}
        style={styles.head}
        accessibilityRole={collapsible ? 'button' : undefined}
        accessibilityLabel={collapsible ? `${title}，${open ? '收起' : '展开'}` : title}
      >
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{title}</Text>
          {summary ? (
            <Text style={styles.summary} numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
        </View>
        {collapsible ? (
          <Text style={[styles.chevron, { color: accent }]}>{open ? '收起 ▾' : '展开 ▸'}</Text>
        ) : null}
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md, paddingVertical: spacing.md },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 34,
  },
  titleWrap: { flex: 1 },
  title: { color: palette.text, fontSize: font.h3, fontWeight: '700' },
  summary: { color: palette.textFaint, fontSize: font.tiny, marginTop: 2 },
  chevron: { fontSize: font.tiny, fontWeight: '700' },
  body: { marginTop: spacing.md },
});
