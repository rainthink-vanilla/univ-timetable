import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Course, Period } from '../types';
import { DAY_LABELS } from '../constants';
import { WeekGridBody } from '../components/WeekGrid';
import { semesterWeekCount, weekDateRange } from '../utils/date';
import { coursesInWeek, maxUsedWeek, weeksLabel } from '../utils/select';
import { font, palette, radius, spacing } from '../theme';
import { useAccent } from '../store/AccentContext';

/**
 * 一周区块的「预估」高度，只用于打开时把当前周滚到可视区。
 * 真实高度随该周课程数浮动，因此这里只做定位、不参与布局。
 */
const ROW_H = 268;

/**
 * 按周次查看整个学期的课程。
 *
 * 布局要点（此前踩过的坑）：
 * 标题栏在滚动容器之外，这里用 `paddingTop = topOffset` 让**滚动视口本身**
 * 从标题栏下方开始——滚上来的内容会被视口边界裁掉，不会压到标题文字上。
 * 比调 z-index 可靠（RN Web 与 Android 的层叠表现并不一致）。
 *
 * 交互：点某周块头可**展开该周的课表网格**（7 天 × 节次），用于单独查看某一周
 * 具体每天的课；同一时刻只展开一周，避免列表过长。
 */
export function SemesterList({
  courses,
  periods,
  semesterStart,
  totalWeeks,
  currentWeek,
  topOffset = 0,
  onPressCourse,
}: {
  courses: Course[];
  /** 节次时间表：展开的网格需要用它显示每节时间 */
  periods: Period[];
  semesterStart: string;
  totalWeeks: number;
  currentWeek: number;
  /** 标题栏实测高度：滚动定位需要让开，否则当前周会被标题挡住 */
  topOffset?: number;
  onPressCourse: (c: Course) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const didScroll = useRef(false);
  const { accent, accentSoft } = useAccent();
  /** 当前展开查看课表网格的周次 */
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);

  const weekCount = useMemo(
    () => semesterWeekCount(totalWeeks, maxUsedWeek(courses)),
    [totalWeeks, courses],
  );

  const byWeek = useMemo(() => {
    const map: Record<number, Course[]> = {};
    for (let w = 1; w <= weekCount; w++) map[w] = coursesInWeek(courses, w);
    return map;
  }, [courses, weekCount]);

  /**
   * 滚动定位到当前周。
   *
   * 只用「预估行高 × 周次」不保险：ROW_H 是估的，算大了会把当前周块头推到视口上方，
   * 用户就看不到也点不到「第 N 周 / 课表 ▸」那一行。因此滚完之后用**实测**块头位置校正一次。
   */
  const currentHeadTop = useRef<number | null>(null);

  const computeY = () => {
    const byEstimate = topOffset + (currentWeek - 1) * ROW_H - spacing.md;
    const byMeasured =
      currentHeadTop.current != null
        ? topOffset + currentHeadTop.current - spacing.xs
        : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(byEstimate, byMeasured));
  };

  // 在 onContentSizeChange 里先滚一次：内容还没撑开时调 scrollTo 会被忽略
  const scrollToCurrent = () => {
    if (didScroll.current) return;
    didScroll.current = true;
    scrollRef.current?.scrollTo({ y: computeY(), animated: false });
    // 子块 onLayout 通常晚于 onContentSizeChange，下一帧用实测值再校正一次
    setTimeout(() => {
      if (currentHeadTop.current != null) {
        scrollRef.current?.scrollTo({ y: computeY(), animated: false });
      }
    }, 60);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, paddingTop: topOffset }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={scrollToCurrent}
      >
        <View style={{ paddingBottom: 96 }}>
          {Array.from({ length: weekCount }, (_, i) => i + 1).map((w) => {
            const list = byWeek[w] ?? [];
            const isCurrent = w === currentWeek;
            const isPast = w < currentWeek;
            const isOpen = expandedWeek === w;
            const { start, end } = weekDateRange(semesterStart, w);
            return (
              <View
                key={w}
                style={[styles.weekBlock, isCurrent && { backgroundColor: accentSoft }]}
                onLayout={
                  isCurrent
                    ? (e) => {
                        // 记录当前周块头相对内容顶部的偏移，供滚动定位兜底
                        currentHeadTop.current = e.nativeEvent.layout.y;
                      }
                    : undefined
                }
              >
                {/* 块头可点：展开 / 收起该周的课表网格 */}
                <Pressable
                  style={styles.weekHead}
                  onPress={() => setExpandedWeek(isOpen ? null : w)}
                  accessibilityRole="button"
                  accessibilityLabel={`第${w}周，${isOpen ? '收起' : '展开'}课表`}
                >
                  <View style={styles.weekLeft}>
                    <Text style={[styles.weekNo, isPast && !isCurrent && styles.weekNoPast]}>
                      第 {w} 周
                    </Text>
                    {isCurrent ? (
                      <View style={[styles.badge, { backgroundColor: accent }]}>
                        <Text style={styles.badgeText}>本周</Text>
                      </View>
                    ) : null}
                    {/* 角标紧跟在周次后面，没有间距会连成「第2周本周9/7」 */}
                    <View style={{ width: spacing.sm }} />
                    <Text style={styles.weekRange}>
                      {start.getMonth() + 1}/{start.getDate()} - {end.getMonth() + 1}/{end.getDate()}
                    </Text>
                  </View>
                  <Text style={styles.expandHint}>{isOpen ? '收起 ▾' : '课表 ▸'}</Text>
                </Pressable>

                {isOpen ? (
                  <View style={styles.gridWrap}>
                    <WeekGridBody
                      courses={courses}
                      week={w}
                      periods={periods}
                      onPressCourse={onPressCourse}
                      pad={0}
                    />
                  </View>
                ) : list.length === 0 ? (
                  <Text style={styles.emptyWeek}>这一周没有课</Text>
                ) : (
                  <View style={{ gap: 6 }}>
                    {list.map((c) => (
                      <Pressable
                        key={`${c.id}-${w}`}
                        onPress={() => onPressCourse(c)}
                        style={styles.courseRow}
                      >
                        <View style={[styles.colorBar, { backgroundColor: c.color }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.courseName} numberOfLines={1}>
                            {c.name}
                          </Text>
                          <Text style={styles.courseMeta} numberOfLines={2}>
                            {DAY_LABELS[c.dayOfWeek - 1]} 第{c.startPeriod}-{c.endPeriod}节
                            {c.location ? ` · ${c.location}` : ''}
                            {c.teacher ? ` · ${c.teacher}` : ''}
                          </Text>
                        </View>
                        <Text style={styles.courseWeeks}>{weeksLabel(c.weeks)}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
          <Text style={styles.footer}>
            共 {weekCount} 周 · {courses.length} 门课
          </Text>
        </View>
      </ScrollView>

      {/* 滑远了可以一键回到本周 */}
      {currentWeek > 1 ? (
        <Pressable
          style={styles.jumpBtn}
          onPress={() => scrollRef.current?.scrollTo({ y: computeY(), animated: true })}
        >
          <Text style={styles.jumpText}>回到本周</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  weekBlock: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  /** 当前周高亮底由 useAccent() 内联给出（强调色可配置） */
  weekHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  expandHint: { color: palette.textFaint, fontSize: font.tiny },
  /** 内嵌课表网格：抵消周块左右 padding，让网格铺满 */
  gridWrap: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    marginHorizontal: -spacing.lg,
  },
  weekLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  weekNo: { color: palette.text, fontSize: font.h3, fontWeight: '800' },
  weekNoPast: { color: palette.textFaint },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  badgeText: { color: '#fff', fontSize: font.tiny, fontWeight: '700' },
  weekRange: { color: palette.textFaint, fontSize: font.tiny },
  emptyWeek: { color: palette.textFaint, fontSize: font.small, paddingVertical: 6 },
  courseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  colorBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  courseName: { color: palette.text, fontSize: font.body, fontWeight: '600' },
  courseMeta: { color: palette.textDim, fontSize: font.tiny, marginTop: 2 },
  courseWeeks: { color: palette.textFaint, fontSize: 10 },
  footer: {
    color: palette.textFaint,
    fontSize: font.tiny,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  jumpBtn: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 96, // 让开右下角的 ＋ 按钮
    backgroundColor: palette.surfaceStrong,
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  jumpText: { color: palette.text, fontSize: font.small, fontWeight: '600' },
});
