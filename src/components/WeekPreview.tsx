import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Course, Period } from '../types';
import { SheetModal } from '../components/SheetModal';
import { WeekGridBody } from '../components/WeekGrid';
import { Button } from '../components/ui';
import { semesterWeekCount, weekDateRange } from '../utils/date';
import { coursesInWeek, maxUsedWeek } from '../utils/select';
import { font, palette, radius, spacing } from '../theme';
import { useAccent } from '../store/AccentContext';

/**
 * 周次预览：以**正常课表形式**（7 天 × 节次网格）查看指定周的课程。
 *
 * 与「全」视图的区别：那里是整学期平铺列表，这里是聚焦某一周的完整课表，
 * 可自由前后切换周次，用于提前查看未来某周的课。
 */
export function WeekPreview({
  visible,
  courses,
  periods,
  semesterStart,
  totalWeeks,
  currentWeek,
  initialWeek,
  onClose,
  onPressCourse,
}: {
  visible: boolean;
  courses: Course[];
  periods: Period[];
  semesterStart: string;
  totalWeeks: number;
  /** 真实当前周，用于标出「本周」 */
  currentWeek: number;
  /** 打开时定位到哪一周 */
  initialWeek: number;
  onClose: () => void;
  onPressCourse: (c: Course) => void;
}) {
  const weekCount = useMemo(
    () => semesterWeekCount(totalWeeks, maxUsedWeek(courses)),
    [totalWeeks, courses],
  );
  const { accent } = useAccent();
  const [week, setWeek] = useState(initialWeek);
  // 每次打开都同步到传入的周次（组件常驻，不能只在首次初始化）
  const [lastInitial, setLastInitial] = useState(initialWeek);
  if (visible && initialWeek !== lastInitial) {
    setLastInitial(initialWeek);
    setWeek(initialWeek);
  }

  const clamped = Math.min(Math.max(1, week), weekCount);
  const list = useMemo(() => coursesInWeek(courses, clamped), [courses, clamped]);
  const { start, end } = weekDateRange(semesterStart, clamped);
  const isCurrent = clamped === currentWeek;

  const go = (delta: number) => setWeek((w) => Math.min(Math.max(1, w + delta), weekCount));

  return (
    <SheetModal visible={visible} onClose={onClose} title="周次预览">
      {/* 周次导航 */}
      <View style={styles.navRow}>
        <Button
          title="‹ 上一周"
          variant="ghost"
          onPress={() => go(-1)}
          disabled={clamped <= 1}
          style={styles.navBtn}
        />
        <View style={styles.navCenter}>
          <View style={styles.weekTitleRow}>
            <Text style={styles.weekTitle}>第 {clamped} 周</Text>
            {isCurrent ? (
              <View style={[styles.badge, { backgroundColor: accent }]}>
                <Text style={styles.badgeText}>本周</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.weekRange}>
            {start.getMonth() + 1}/{start.getDate()} - {end.getMonth() + 1}/{end.getDate()} ·{' '}
            {list.length} 门课
          </Text>
        </View>
        <Button
          title="下一周 ›"
          variant="ghost"
          onPress={() => go(1)}
          disabled={clamped >= weekCount}
          style={styles.navBtn}
        />
      </View>

      {/* 快速跳周：全部周次列出，没有课的周淡显 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
      >
        {Array.from({ length: weekCount }, (_, i) => i + 1).map((w) => {
          const on = w === clamped;
          const has = coursesInWeek(courses, w).length > 0;
          return (
            <Pressable
              key={w}
              onPress={() => setWeek(w)}
              style={[
                styles.chip,
                on && { backgroundColor: accent, borderColor: accent },
                !has && styles.chipEmpty,
              ]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{w}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 正常课表形式呈现 */}
      <View style={styles.gridWrap}>
        <WeekGridBody
          courses={courses}
          week={clamped}
          periods={periods}
          onPressCourse={onPressCourse}
          pad={0}
        />
      </View>

      {list.length === 0 ? (
        <Text style={styles.emptyHint}>这一周没有课</Text>
      ) : null}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  navBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  navCenter: { flex: 1, alignItems: 'center' },
  weekTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  weekTitle: { color: palette.text, fontSize: font.h2, fontWeight: '800' },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  badgeText: { color: '#fff', fontSize: font.tiny, fontWeight: '700' },
  weekRange: { color: palette.textDim, fontSize: font.tiny, marginTop: 2 },
  chipScroll: { maxHeight: 40, marginBottom: spacing.md },
  chipRow: { gap: 6, paddingHorizontal: 2 },
  chip: {
    minWidth: 30,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  chipEmpty: { opacity: 0.45 },
  chipText: { color: palette.textDim, fontSize: font.tiny, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  gridWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
  },
  emptyHint: { color: palette.textFaint, fontSize: font.small, textAlign: 'center', marginTop: spacing.md },
});
