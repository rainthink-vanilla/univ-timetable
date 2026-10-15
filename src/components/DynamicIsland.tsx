import React, { useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Course } from '../types';
import { font, palette, radius } from '../theme';

export interface IslandInfo {
  week: number;
  todayLabel: string; // "周三"
  dateLabel: string; // "3/10"
  next: Course | null;
  nextTime: string; // "10:00 - 11:40"
  active: boolean; // 正在上课
}

/**
 * 顶部灵动岛：可点击展开显示下一节课
 *
 * 高度策略（BUG-001 / BUG-002 修复要点）：
 * 1. 收起高度不写死，由收起态 onLayout 实测 —— Android 中文字体默认
 *    `includeFontPadding: true`，每行比 fontSize 高 4-6pt，写死高度会把第二行裁掉。
 * 2. 展开高度单独测量（展开面板只在展开时渲染，量到的才是它自己的高度），
 *    与收起高度相加后作为动画终值，避免两个 onLayout 互相覆盖（BUG-002）。
 * 3. 两个高度都未测出前不设 height，让内容自然撑开，避免首帧先裁一次再跳变。
 */
export function DynamicIsland({ info }: { info: IslandInfo }) {
  const [expanded, setExpanded] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  /** 收起态实测高度 */
  const [collapsedH, setCollapsedH] = useState(0);
  /** 展开面板实测高度（不含收起态那一行） */
  const [expandedPanelH, setExpandedPanelH] = useState(0);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    Animated.timing(anim, {
      toValue: next ? 1 : 0,
      duration: 340,
      easing: Easing.bezier(0.22, 0.8, 0.24, 1),
      useNativeDriver: false,
    }).start();
  };

  const ready = collapsedH > 0;
  // 展开时若面板还没量出来，先用收起高度兜底（此时内容会自然撑开，不会裁切）
  const openH = expandedPanelH > 0 ? collapsedH + expandedPanelH : collapsedH;
  const height = ready
    ? anim.interpolate({ inputRange: [0, 1], outputRange: [collapsedH, Math.max(openH, collapsedH)] })
    : undefined;
  const br = ready
    ? anim.interpolate({ inputRange: [0, 1], outputRange: [radius.pill, 26] })
    : radius.pill;

  return (
    <Animated.View style={[styles.island, { height, borderRadius: br }]}>
      <Pressable onPress={toggle} style={styles.touch}>
        {/* 收起态：始终参与布局（锚在左上角），保证收起高度能被量到且居中不留偏 */}
        <Animated.View
          style={[
            styles.collapsedLayer,
            ready ? { opacity: anim.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0] }) } : null,
          ]}
          pointerEvents="none"
        >
          <View
            style={styles.collapsed}
            onLayout={(e) => {
              const h = Math.ceil(e.nativeEvent.layout.height);
              if (h > 0 && h !== collapsedH) setCollapsedH(h);
            }}
          >
            <View style={styles.live} />
            <Text style={styles.mainText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              第{info.week}周 · {info.todayLabel} {info.dateLabel}
            </Text>
            {info.next ? (
              <View style={styles.nextRow}>
                <View style={[styles.dot, { backgroundColor: info.next.color }]} />
                <Text numberOfLines={1} style={styles.nextText} maxFontSizeMultiplier={1.3}>
                  {info.active ? '进行中 · ' : ''}
                  {info.next.name}
                </Text>
              </View>
            ) : null}
          </View>
        </Animated.View>

        {/* 展开态：仅在展开时渲染，这样量到的是面板自身高度，而不是被收起高度干扰 */}
        {expanded ? (
          <Animated.View style={[styles.expanded, { opacity: anim }]}>
            <View
              onLayout={(e) => {
                const h = Math.ceil(e.nativeEvent.layout.height);
                if (h > 0 && h !== expandedPanelH) setExpandedPanelH(h);
              }}
            >
              <View style={styles.expHead}>
                <View style={styles.live} />
                <Text style={styles.expTitle} maxFontSizeMultiplier={1.3}>
                  第{info.week}周 · {info.todayLabel} {info.dateLabel}
                </Text>
              </View>
              {info.next ? (
                <View style={styles.expBody}>
                  <View style={[styles.expBar, { backgroundColor: info.next.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.expName} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                      {info.next.name}
                    </Text>
                    <Text style={styles.expMeta} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                      {info.active ? '正在上课' : '下一节'} · {info.nextTime}
                      {info.next.teacher ? ` · ${info.next.teacher}` : ''}
                      {info.next.location ? ` · ${info.next.location}` : ''}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.expEmpty} maxFontSizeMultiplier={1.3}>
                  今天没有课，好好休息 🎉
                </Text>
              )}
            </View>
          </Animated.View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  island: {
    alignSelf: 'center',
    width: '88%',
    backgroundColor: palette.island,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  touch: { flex: 1 },
  /**
   * 收起态锚在左上角：外层高度由动画接管，此时不能用 alignItems: 'center'
   * （会依赖父容器高度，父高未定时会裁切/偏移）。
   */
  collapsedLayer: { position: 'absolute', left: 0, right: 0, top: 0 },
  collapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  live: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  // 显式 lineHeight + 关闭 Android 字体额外内边距：中文两行才算得准、不被裁
  mainText: {
    color: '#fff',
    fontSize: font.small,
    lineHeight: 18,
    fontWeight: '700',
    flexShrink: 0,
    includeFontPadding: false,
  },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1, justifyContent: 'flex-end' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  nextText: {
    color: '#CBD5E1',
    fontSize: font.tiny,
    lineHeight: 16,
    flexShrink: 1,
    includeFontPadding: false,
  },
  expanded: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  expHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  expTitle: {
    color: '#fff',
    fontSize: font.small,
    lineHeight: 18,
    fontWeight: '700',
    flexShrink: 1,
    includeFontPadding: false,
  },
  expBody: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  expBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  expName: {
    color: '#fff',
    fontSize: font.body,
    lineHeight: 21,
    fontWeight: '700',
    includeFontPadding: false,
  },
  expMeta: {
    color: '#CBD5E1',
    fontSize: font.small,
    lineHeight: 19,
    marginTop: 2,
    includeFontPadding: false,
  },
  expEmpty: { color: '#CBD5E1', fontSize: font.small, lineHeight: 19, includeFontPadding: false },
});
