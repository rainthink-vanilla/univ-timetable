import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Course, Period } from '../types';
import { DAY_LABELS, DAY_LABELS_SHORT } from '../constants';
import { CourseCard } from '../components/CourseCard';
import { cnDate, dateForWeekday, dayOfWeekNumber } from '../utils/date';
import { coursesForDay, isCourseActive } from '../utils/select';
import { font, palette, spacing } from '../theme';
import { useAccent } from '../store/AccentContext';

export function DayView({
  courses,
  week,
  periods,
  semesterStart,
  now,
  onPressCourse,
  onLongPressCourse,
}: {
  courses: Course[];
  week: number;
  periods: Period[];
  semesterStart: string;
  now: Date;
  onPressCourse: (c: Course) => void;
  onLongPressCourse: (c: Course) => void;
}) {
  const { width } = useWindowDimensions();
  const { accent } = useAccent();
  const todayIndex = dayOfWeekNumber(now) - 1;
  const [index, setIndex] = useState(todayIndex);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ x: todayIndex * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const date = dateForWeekday(semesterStart, week, index + 1);
  const isToday = index === todayIndex;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.topBar}>
        <Text style={styles.dateText}>
          {cnDate(date, DAY_LABELS_SHORT[index] ?? '')}
        </Text>
        {isToday ? (
          <View style={[styles.todayBadge, { backgroundColor: accent }]}>
            <Text style={styles.todayBadgeText}>今天</Text>
          </View>
        ) : null}
        <Text style={styles.swipeHint}>← 左右滑动 →</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {DAY_LABELS.map((_, di) => {
          const list = coursesForDay(courses, di + 1, week);
          return (
            <ScrollView
              key={di}
              style={{ width }}
              contentContainerStyle={styles.pageContent}
              showsVerticalScrollIndicator={false}
            >
              {list.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyEmoji}>🍃</Text>
                  <Text style={styles.emptyText}>这一天没有课</Text>
                </View>
              ) : (
                list.map((c) => {
                  const s = periods.find((p) => p.index === c.startPeriod);
                  const e = periods.find((p) => p.index === c.endPeriod);
                  return (
                    <CourseCard
                      key={c.id}
                      course={c}
                      startLabel={s?.start ?? ''}
                      endLabel={e?.end ?? ''}
                      active={isCourseActive(c, now, periods, week)}
                      onPress={() => onPressCourse(c)}
                      onLongPress={() => onLongPressCourse(c)}
                    />
                  );
                })
              )}
            </ScrollView>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  dateText: { color: palette.text, fontSize: font.h3, fontWeight: '700' },
  todayBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  todayBadgeText: { color: '#fff', fontSize: font.tiny, fontWeight: '700' },
  swipeHint: { marginLeft: 'auto', color: palette.textFaint, fontSize: font.tiny },
  pageContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  empty: { alignItems: 'center', paddingTop: 72 },
  emptyEmoji: { fontSize: 40 },
  emptyText: { color: palette.textFaint, fontSize: font.body, marginTop: 8 },
});
