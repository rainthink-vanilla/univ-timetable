import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, palette } from '../theme';
import { useAccent } from '../store/AccentContext';
import { TabIconSetting } from '../types';
import { ThemeIcon } from './ThemeIcon';

export interface TabItem {
  key: string;
  label: string;
  icon: string;
}

/**
 * 底部标签栏。v1.7.0：**三个标签都可以单独换图标**（此前只有第一个能换）。
 * 每个标签的图标来源优先级：`icons[key].uri`（图片）→ `icons[key].emoji` → 标签自带 emoji。
 */
export function BottomTabs({
  tabs,
  active,
  onChange,
  icons,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  /** 各标签的自定义图标（key = 标签 key） */
  icons?: Record<string, TabIconSetting> | null;
}) {
  const insets = useSafeAreaInsets();
  const { accent } = useAccent();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {tabs.map((t) => {
        const on = t.key === active;
        const custom = icons?.[t.key];
        const hasCustom = !!(custom?.uri || custom?.emoji);
        return (
          <Pressable key={t.key} onPress={() => onChange(t.key)} style={styles.item}>
            {hasCustom ? (
              <View style={[styles.iconSlot, on ? null : styles.iconDim]}>
                <ThemeIcon
                  uri={custom?.uri}
                  crop={custom?.crop}
                  emoji={custom?.emoji}
                  fallback={t.icon}
                  size={20}
                />
              </View>
            ) : (
              <Text style={[styles.icon, on && styles.iconOn]}>{t.icon}</Text>
            )}
            <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
            {on ? <View style={[styles.indicator, { backgroundColor: accent }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(7,12,24,0.92)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    paddingTop: 8,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  icon: { fontSize: 20, opacity: 0.55 },
  iconOn: { opacity: 1 },
  iconSlot: { height: 24, alignItems: 'center', justifyContent: 'center' },
  iconDim: { opacity: 0.55 },
  label: { color: palette.textFaint, fontSize: font.tiny, fontWeight: '600' },
  labelOn: { color: palette.text },
  indicator: {
    marginTop: 3,
    width: 16,
    height: 3,
    borderRadius: 2,
  },
});
