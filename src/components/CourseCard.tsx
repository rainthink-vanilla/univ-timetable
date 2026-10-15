import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Course } from '../types';
import { font, palette, radius } from '../theme';
import { useAccent } from '../store/AccentContext';
import { weeksLabel } from '../utils/select';

export function CourseCard({
  course,
  startLabel,
  endLabel,
  active,
  onPress,
  onLongPress,
}: {
  course: Course;
  startLabel: string;
  endLabel: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { accent, accentTint } = useAccent();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.card, active && { borderColor: accent, backgroundColor: accentTint }]}
    >
      <View style={[styles.bar, { backgroundColor: course.color }]} />
      <View style={styles.body}>
        <Text style={styles.name}>{course.name}</Text>
        <Text style={[styles.time, { color: accent }]}>
          {startLabel} - {endLabel} · 第{course.startPeriod}-{course.endPeriod}节
        </Text>
        <Text style={styles.meta}>{[course.teacher, course.location].filter(Boolean).join(' · ')}</Text>
        <Text style={styles.weeks}>{weeksLabel(course.weeks)}</Text>
      </View>
      {active ? (
        <View style={styles.liveWrap}>
          <View style={styles.live} />
          <Text style={styles.liveText}>进行中</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    overflow: 'hidden',
  },
  bar: { width: 5 },
  body: { flex: 1, padding: 14 },
  name: { color: palette.text, fontSize: font.h3, fontWeight: '700' },
  time: { fontSize: font.small, marginTop: 3, fontWeight: '600' },
  meta: { color: palette.textDim, fontSize: font.small, marginTop: 3 },
  weeks: { color: palette.textFaint, fontSize: font.tiny, marginTop: 3 },
  liveWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 12, paddingTop: 14 },
  live: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22C55E' },
  liveText: { color: '#22C55E', fontSize: font.tiny, fontWeight: '700' },
});
