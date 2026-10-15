import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Course, Period } from '../types';
import { COURSE_COLORS, DAY_LABELS } from '../constants';
import { Button, Chip, SwatchRow, TextField, Stepper } from '../components/ui';
import { SheetModal } from '../components/SheetModal';
import { buildWeeks } from '../utils/select';
import { font, palette, spacing } from '../theme';

type WeekType = 'all' | 'odd' | 'even';

function detectWeekType(weeks: number[]): WeekType {
  if (!weeks.length) return 'all';
  const allOdd = weeks.every((w) => w % 2 === 1);
  const allEven = weeks.every((w) => w % 2 === 0);
  if (allOdd) return 'odd';
  if (allEven) return 'even';
  return 'all';
}

export function CourseForm({
  visible,
  initial,
  periods,
  totalWeeks,
  accentColor,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initial: Course | null;
  periods: Period[];
  totalWeeks: number;
  accentColor: string;
  onClose: () => void;
  /** 提交草稿：星期可多选，**选中的每一天各一条** */
  onSubmit: (drafts: Omit<Course, 'id'>[]) => void;
}) {
  const maxPeriod = Math.max(12, ...periods.map((p) => p.index));
  const [name, setName] = useState('');
  const [teacher, setTeacher] = useState('');
  const [location, setLocation] = useState('');
  /** 星期（可多选，升序保存） */
  const [days, setDays] = useState<number[]>([1]);
  const [startPeriod, setStartPeriod] = useState(1);
  const [endPeriod, setEndPeriod] = useState(2);
  const [weekStart, setWeekStart] = useState(1);
  const [weekEnd, setWeekEnd] = useState(totalWeeks);
  const [weekType, setWeekType] = useState<WeekType>('all');
  const [color, setColor] = useState(accentColor);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!visible) return;
    if (initial) {
      setName(initial.name);
      setTeacher(initial.teacher);
      setLocation(initial.location);
      setDays([initial.dayOfWeek]);
      setStartPeriod(initial.startPeriod);
      setEndPeriod(initial.endPeriod);
      setWeekStart(initial.weeks[0] ?? 1);
      setWeekEnd(initial.weeks[initial.weeks.length - 1] ?? totalWeeks);
      setWeekType(detectWeekType(initial.weeks));
      setColor(initial.color);
      setNote(initial.note ?? '');
    } else {
      setName('');
      setTeacher('');
      setLocation('');
      setDays([1]);
      setStartPeriod(1);
      setEndPeriod(2);
      setWeekStart(1);
      setWeekEnd(totalWeeks);
      setWeekType('all');
      setColor(accentColor);
      setNote('');
    }
  }, [visible, initial, totalWeeks, accentColor]);

  /** 勾选/取消某一天（至少保留一天，最后一天不可取消） */
  const toggleDay = (d: number) => {
    setDays((prev) => {
      if (prev.includes(d)) return prev.length > 1 ? prev.filter((x) => x !== d) : prev;
      return [...prev, d].sort((a, b) => a - b);
    });
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || !days.length) return;
    const weeks = buildWeeks(weekStart, weekEnd, weekType);
    // 多选星期 = 多条课程（数据模型仍是「一天一条」），字段完全一致，只有星期不同
    onSubmit(
      [...days]
        .sort((a, b) => a - b)
        .map((day) => ({
          name: trimmed,
          teacher: teacher.trim(),
          location: location.trim(),
          dayOfWeek: day,
          startPeriod: Math.min(startPeriod, endPeriod),
          endPeriod: Math.max(startPeriod, endPeriod),
          weeks,
          color,
          note: note.trim() || undefined,
        })),
    );
  };

  return (
    <SheetModal visible={visible} onClose={onClose} title={initial ? '编辑课程' : '添加课程'}>
      <TextField label="课程名称 *" value={name} onChangeText={setName} placeholder="如：高等数学" />
      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <TextField label="教师" value={teacher} onChangeText={setTeacher} placeholder="教师姓名" />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label="地点" value={location} onChangeText={setLocation} placeholder="如：教一101" />
        </View>
      </View>

      <Text style={styles.label}>
        星期（可多选{initial ? '；除本课程所在的那天外，新勾选的天会各新增一条课程' : '；选几天就生成几条课程'}）
      </Text>
      <View style={styles.chips}>
        {DAY_LABELS.map((d, i) => (
          <Chip key={d} label={d} selected={days.includes(i + 1)} onPress={() => toggleDay(i + 1)} />
        ))}
      </View>

      <View style={styles.row2}>
        <Stepper label="开始节" value={startPeriod} min={1} max={maxPeriod} onChange={setStartPeriod} />
        <Stepper label="结束节" value={endPeriod} min={1} max={maxPeriod} onChange={setEndPeriod} />
      </View>

      <Text style={styles.label}>上课周次</Text>
      <View style={styles.row2}>
        <Stepper label="起始周" value={weekStart} min={1} max={totalWeeks} onChange={setWeekStart} />
        <Stepper label="结束周" value={weekEnd} min={1} max={totalWeeks} onChange={setWeekEnd} />
      </View>
      <View style={styles.chips}>
        {(
          [
            ['all', '全部'],
            ['odd', '单周'],
            ['even', '双周'],
          ] as [WeekType, string][]
        ).map(([k, label]) => (
          <Chip key={k} label={label} selected={weekType === k} onPress={() => setWeekType(k)} />
        ))}
      </View>

      <Text style={styles.label}>卡片颜色</Text>
      <SwatchRow colors={COURSE_COLORS} value={color} onChange={setColor} />

      <TextField
        label="备注（可选）"
        value={note}
        onChangeText={setNote}
        placeholder="如：教材、考试安排等"
        multiline
      />

      <View style={{ marginTop: spacing.lg }}>
        <Button
          title={
            initial
              ? '保存修改'
              : days.length > 1
              ? `添加到课表（${days.length} 天各一条）`
              : '添加到课表'
          }
          onPress={submit}
          disabled={!name.trim() || !days.length}
        />
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  row2: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  label: { color: palette.textDim, fontSize: font.small, marginBottom: spacing.sm, marginTop: spacing.xs },
});
