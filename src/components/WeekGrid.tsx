import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Course, Period } from '../types';
import { DAY_LABELS } from '../constants';
import { font, palette } from '../theme';
import { coursesForDay } from '../utils/select';
import { lanePercent, packDayLanes, Placement } from '../utils/layout';

const ROW_HEIGHT = 56;
/** 时间轴（边栏）宽度：要容得下 08:00 与 08:45 两行时间 */
const GUTTER_W = 48;
const PAD = 12;
/** 同一列里上下相邻课程块之间的留白（上下各留 ROW_GAP，合计 4px） */
const ROW_GAP = 2;
/** 同一天重叠课程并排时，列与列之间的留白 */
const LANE_GAP = 2;
/** 地点文字的每行高度（fontSize 8 / lineHeight 10），用于按块高算行数 */
const LOC_LINE_H = 10;
/** 课程名占用的高度（最多两行，9px 字号 + 11 行高） */
const NAME_BLOCK_H = 23;
/** 窄块（重叠分列后）用更小的字号，换取每行更多字、显示更全 */
const NARROW_W = 34;
const NARROW_LOC_LINE_H = 9;
const NARROW_NAME_BLOCK_H = 21;

/**
 * 表头 + 网格主体，**自己不带滚动**，便于内嵌到「全」视图的周次列表里。
 * 主视图请用下面的 WeekGrid（外面套了 ScrollView）。
 *
 * v1.7.2 的关键改动 —— **列宽不再手算像素**：
 * 之前是「算出一个 colW，再给七列各写 width: colW，块也按 colW 定位」，
 * 一旦实际容器宽度与算出来的不一致（弹层内边距、负边距、机型差异、字体缩放……），
 * 就会出现列被挤出可视区、块跑到相邻列等**跨列错乱**。
 * 现在改为：
 *   - 七列 `flex: 1` —— 由布局引擎把可用宽度**均分**，永远精确填满容器，不存在"总宽超出"；
 *   - 课程块的横向位置与宽度用**百分比**（相对本列），数学上不可能越出自己那一列；
 *   - 列与列、块与块之间的空隙用内层 View 的 margin/padding 表达，不参与外层几何。
 * 竖直方向仍用像素（行高固定，与节次一一对应）。
 *
 * v1.7.0/v1.7.1 保留的行为：重叠课程分列并排、地点自动换行（窄块用更小字号）。
 */
export function WeekGridBody({
  courses,
  week,
  periods,
  onPressCourse,
  pad = PAD,
}: {
  courses: Course[];
  week: number;
  periods: Period[];
  onPressCourse: (c: Course) => void;
  /** 左右留白：主视图用默认 12；内嵌到周次列表时传 0（外层已有缩进） */
  pad?: number;
}) {
  const { width: winW } = useWindowDimensions();
  const maxPeriod = useMemo(
    () => (periods.length ? Math.max(...periods.map((p) => p.index)) : 12),
    [periods],
  );
  const gridH = maxPeriod * ROW_HEIGHT;
  const hourLines = useMemo(() => Array.from({ length: maxPeriod }, (_, i) => i + 1), [maxPeriod]);
  /** 仅用于选字号（"窄块"判定），不参与任何定位计算 —— 所以用窗口宽近似没有风险 */
  const approxColW = Math.max(1, (winW - GUTTER_W - pad * 2) / 7);

  /** 每天的课程与分列结果（互不重叠的课仍占满整列） */
  const perDay = useMemo(() => {
    return DAY_LABELS.map((_, i) => {
      const list = coursesForDay(courses, i + 1, week);
      return { list, lanes: packDayLanes(list) };
    });
  }, [courses, week]);

  return (
    <View style={styles.root}>
      {/* 表头：与主体用同一套 flex 分配 + 同样的左右留白，保证逐列对齐 */}
      <View style={[styles.headerRow, { paddingHorizontal: pad }]}>
        <View style={styles.gutterCell} />
        {DAY_LABELS.map((d) => (
          <View key={d} style={styles.headerCell}>
            <Text style={styles.headerText}>{d}</Text>
          </View>
        ))}
      </View>

      {/* 主体 */}
      <View style={[styles.bodyRow, { paddingHorizontal: pad }]}>
        {/* 时间轴：每节标出**开始与结束**两个时间（v1.6.0） */}
        <View style={[styles.gutterCell, { height: gridH }]}>
          {periods.map((p) => (
            <View key={p.index} style={[styles.timeCell, { height: ROW_HEIGHT }]}>
              <Text style={styles.timeIdx}>{p.index}</Text>
              <Text style={styles.timeText}>{p.start}</Text>
              <Text style={styles.timeTextEnd}>{p.end}</Text>
            </View>
          ))}
        </View>

        {/* 七天列：flex:1 均分，位置由布局引擎保证 */}
        {perDay.map(({ list, lanes }, di) => (
          <View key={di} style={[styles.col, { height: gridH }]}>
            {hourLines.map((i) => (
              <View key={i} style={[styles.gridLine, { top: i * ROW_HEIGHT }]} />
            ))}
            {list.map((c) => {
              const span = c.endPeriod - c.startPeriod + 1;
              const place: Placement = lanes.get(c.id) ?? { lane: 0, lanes: 1 };
              const lanes_ = Math.max(1, place.lanes);
              const laneIdx = Math.min(Math.max(0, place.lane), lanes_ - 1);
              /** 百分比定位：永远落在本列内，块不可能越出自己那一列 */
              const { leftPct, widthPct, isLast } = lanePercent(laneIdx, lanes_);
              const top = (c.startPeriod - 1) * ROW_HEIGHT + ROW_GAP;
              const h = span * ROW_HEIGHT - ROW_GAP * 2;
              // 并排后变窄的块换小字号：同样宽度能放更多字，地点显示更全
              const narrow = approxColW / lanes_ < NARROW_W;
              const locLineH = narrow ? NARROW_LOC_LINE_H : LOC_LINE_H;
              const nameBlockH = narrow ? NARROW_NAME_BLOCK_H : NAME_BLOCK_H;
              // 按块高换算地点可显示的行数：先扣掉课程名占用的高度与内边距
              const locLines = Math.max(1, Math.min(12, Math.floor((h - nameBlockH - 6) / locLineH)));
              const isLastLane = isLast;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => onPressCourse(c)}
                  style={[styles.blockWrap, { top, height: h, left: `${leftPct}%`, width: `${widthPct}%` }]}
                >
                  <View
                    style={[
                      styles.block,
                      { backgroundColor: c.color },
                      // 并排时给非最后一列留出空隙（用内层 margin，不影响外层几何）
                      !isLastLane && { marginRight: LANE_GAP },
                    ]}
                  >
                    <Text numberOfLines={2} style={narrow ? styles.blockNameNarrow : styles.blockName}>
                      {c.name}
                    </Text>
                    {c.location ? (
                      <Text numberOfLines={locLines} style={narrow ? styles.blockLocNarrow : styles.blockLoc}>
                        {c.location}
                      </Text>
                    ) : null}
                    {c.teacher && span >= 3 ? (
                      <Text numberOfLines={1} style={styles.blockTeacher}>
                        {c.teacher}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

/** 课表页「周」视图：自带滚动的整周网格 */
export function WeekGrid({
  courses,
  week,
  periods,
  onPressCourse,
}: {
  courses: Course[];
  week: number;
  periods: Period[];
  onPressCourse: (c: Course) => void;
}) {
  return (
    <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
      <WeekGridBody courses={courses} week={week} periods={periods} onPressCourse={onPressCourse} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  root: { alignSelf: 'stretch' },
  headerRow: { flexDirection: 'row', paddingVertical: 8 },
  /** 时间轴占位：宽度固定且**不允许被压缩**，否则七列会整体错位 */
  gutterCell: { width: GUTTER_W, flexGrow: 0, flexShrink: 0 },
  /** 表头单元格：flex:1 与主体列一一对应 */
  headerCell: { flex: 1, alignItems: 'center' },
  headerText: { color: palette.textDim, fontSize: font.tiny, fontWeight: '700' },
  bodyRow: { flexDirection: 'row' },
  timeCell: {
    alignItems: 'flex-end',
    paddingRight: 6,
    justifyContent: 'flex-start',
  },
  timeIdx: { color: palette.textFaint, fontSize: 10, fontWeight: '700' },
  /** 开始时间 */
  timeText: { color: palette.textDim, fontSize: 9, marginTop: 1 },
  /** 结束时间（比开始时间更淡，避免两行抢视觉） */
  timeTextEnd: { color: palette.textFaint, fontSize: 9, marginTop: 0 },
  col: {
    position: 'relative',
    /** 关键：flex:1 均分剩余宽度 —— 不再手算像素，天然不会溢出或错位 */
    flex: 1,
    minWidth: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: palette.border,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
  },
  /** 横向定位壳：只用百分比，负责位置与尺寸 */
  blockWrap: { position: 'absolute' },
  /** 可见的课程卡片 */
  block: {
    flex: 1,
    borderRadius: 6,
    padding: 3,
    overflow: 'hidden',
    /** 与背景拉开层次，重叠分列后更容易分辨 */
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  blockName: { color: '#fff', fontSize: 9, fontWeight: '700', lineHeight: 11 },
  /** 窄块（并排显示）用更小字号：同样空间能放下更多字 */
  blockNameNarrow: { color: '#fff', fontSize: 8, fontWeight: '700', lineHeight: 10 },
  /** 地点：自动换行，按块高给足行数（v1.7.0） */
  blockLoc: { color: 'rgba(255,255,255,0.92)', fontSize: 8, lineHeight: LOC_LINE_H, marginTop: 1 },
  blockLocNarrow: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 7,
    lineHeight: NARROW_LOC_LINE_H,
    marginTop: 1,
  },
  blockTeacher: { color: 'rgba(255,255,255,0.75)', fontSize: 8, lineHeight: LOC_LINE_H },
});
