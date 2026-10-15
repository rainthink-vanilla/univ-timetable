import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Course } from '../types';
import { useApp } from '../store/AppStore';
import { useNow } from '../hooks/useNow';
import { DynamicIsland, IslandInfo } from '../components/DynamicIsland';
import { Button, Segmented } from '../components/ui';
import { SheetModal } from '../components/SheetModal';
import { WeekGrid } from '../components/WeekGrid';
import { WeekPreview } from '../components/WeekPreview';
import { DayView } from './DayView';
import { SemesterList } from './SemesterList';
import { CourseForm } from './CourseForm';
import { currentWeekNumber, dayOfWeekNumber, shortDate } from '../utils/date';
import { isCourseActive, nextCourseToday } from '../utils/select';
import { DAY_LABELS } from '../constants';
import { font, palette, radius, spacing } from '../theme';
import { useAccent } from '../store/AccentContext';

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || '—'}</Text>
    </View>
  );
}

export function TimetableScreen() {
  const { courses, settings, addCourse, updateCourse, deleteCourse } = useApp();
  const insets = useSafeAreaInsets();
  const { accent } = useAccent();
  const now = useNow();
  const week = currentWeekNumber(settings.semesterStart, now);

  const [mode, setMode] = useState<'day' | 'week' | 'all'>('day');
  // 标题栏实测高度，供「按周次列表」计算滚动定位（否则当前周会被标题挡住）
  const [headerH, setHeaderH] = useState(0);
  const [selected, setSelected] = useState<Course | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  /** 周次预览：打开的周次（null = 关闭） */
  const [previewWeek, setPreviewWeek] = useState<number | null>(null);

  // 日/周切换时的轻微淡入，保证流畅
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [mode, fade]);

  const next = nextCourseToday(courses, week, settings.periods, now);
  const active = next ? isCourseActive(next, now, settings.periods, week) : false;
  const ns = next ? settings.periods.find((p) => p.index === next.startPeriod) : null;
  const ne = next ? settings.periods.find((p) => p.index === next.endPeriod) : null;

  const islandInfo: IslandInfo = {
    week,
    todayLabel: DAY_LABELS[dayOfWeekNumber(now) - 1] ?? '',
    dateLabel: shortDate(now),
    next,
    nextTime: next ? `${ns?.start ?? ''} - ${ne?.end ?? ''}` : '',
    active,
  };

  const openAdd = () => {
    setEditing(null);
    setFormVisible(true);
  };
  const openEdit = (c: Course) => {
    setSelected(null);
    setEditing(c);
    setFormVisible(true);
  };
  /**
   * 提交课程表单（v1.6.0：星期可多选）。
   *
   * 一种「课程」在数据模型里仍是「一天一条」，所以多选的结果是**生成多条课程**：
   * - 新增：选中的每一天各生成一条；
   * - 编辑：原来那一天优先沿用原 id（保持"编辑"语义），其余选中的天作为新课程追加；
   *   若原星期被取消勾选，则原课程被"移动"到剩余的第一天（不会再残留旧星期）。
   */
  const handleSubmit = (drafts: Omit<Course, 'id'>[]) => {
    if (!drafts.length) return;
    if (editing) {
      const ordered = [...drafts].sort(
        (a, b) => (a.dayOfWeek === editing.dayOfWeek ? -1 : 0) - (b.dayOfWeek === editing.dayOfWeek ? -1 : 0),
      );
      const [first, ...rest] = ordered;
      updateCourse({ ...first, id: editing.id });
      for (const d of rest) addCourse(d);
    } else {
      for (const d of drafts) addCourse(d);
    }
    setFormVisible(false);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {settings.dynamicIsland ? (
        <View style={styles.islandWrap}>
          <DynamicIsland info={islandInfo} />
        </View>
      ) : null}

      <View
        style={styles.header}
        onLayout={(e) => {
          const h = Math.ceil(e.nativeEvent.layout.height);
          if (h > 0 && h !== headerH) setHeaderH(h);
        }}
      >
        <View>
          <Text style={styles.title}>大学课表</Text>
          <Text style={styles.subtitle}>
            第 {week} 周 · {courses.length} 门课
          </Text>
        </View>
        <Segmented
          options={[
            { key: 'day', label: '日' },
            { key: 'week', label: '周' },
            { key: 'all', label: '全' },
          ]}
          value={mode}
          onChange={setMode}
          style={{ width: 168 }}
        />
      </View>

      {/* 周次预览入口：以正常课表形式提前查看任意一周 */}
      <View style={styles.previewBar}>
        <Pressable style={styles.previewBtn} onPress={() => setPreviewWeek(week)}>
          <Text style={styles.previewBtnText}>🔍 周次预览</Text>
          <Text style={styles.previewBtnHint}>按周查看 · 可前后切换</Text>
        </Pressable>
      </View>

      <Animated.View style={{ flex: 1, opacity: fade }}>
        {mode === 'day' ? (
          <DayView
            courses={courses}
            week={week}
            periods={settings.periods}
            semesterStart={settings.semesterStart}
            now={now}
            onPressCourse={setSelected}
            onLongPressCourse={openEdit}
          />
        ) : null}
        {mode === 'week' ? (
          <WeekGrid
            courses={courses}
            week={week}
            periods={settings.periods}
            onPressCourse={setSelected}
          />
        ) : null}
        {mode === 'all' ? (
          <SemesterList
            courses={courses}
            periods={settings.periods}
            semesterStart={settings.semesterStart}
            totalWeeks={settings.totalWeeks}
            currentWeek={week}
            topOffset={headerH}
            onPressCourse={setSelected}
          />
        ) : null}
      </Animated.View>

      <Pressable style={[styles.fab, { backgroundColor: accent, shadowColor: accent }]} onPress={openAdd}>
        <Text style={styles.fabText}>＋</Text>
      </Pressable>

      {/* 课程详情 */}
      {/* 周次预览：正常课表形式查看任意周 */}
      <WeekPreview
        visible={previewWeek !== null}
        courses={courses}
        periods={settings.periods}
        semesterStart={settings.semesterStart}
        totalWeeks={settings.totalWeeks}
        currentWeek={week}
        initialWeek={previewWeek ?? week}
        onClose={() => setPreviewWeek(null)}
        onPressCourse={setSelected}
      />

      <SheetModal visible={selected !== null} onClose={() => setSelected(null)} title="课程详情">
        {selected ? (
          <View>
            <DetailRow label="课程" value={selected.name} />
            <DetailRow label="时间" value={`${DAY_LABELS[selected.dayOfWeek - 1]} · 第${selected.startPeriod}-${selected.endPeriod}节`} />
            <DetailRow label="教师" value={selected.teacher} />
            <DetailRow label="地点" value={selected.location} />
            <DetailRow label="周次" value={selected.weeks.map(String).join('、')} />
            {selected.note ? <DetailRow label="备注" value={selected.note} /> : null}
            <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
              <Button title="编辑" onPress={() => openEdit(selected)} />
              <Button
                title="删除课程"
                variant="danger"
                onPress={() => {
                  deleteCourse(selected.id);
                  setSelected(null);
                }}
              />
            </View>
          </View>
        ) : null}
      </SheetModal>

      {/* 添加/编辑表单 */}
      <CourseForm
        visible={formVisible}
        initial={editing}
        periods={settings.periods}
        totalWeeks={settings.totalWeeks}
        accentColor={settings.accentColor}
        onClose={() => setFormVisible(false)}
        onSubmit={handleSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  islandWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  /** 周次预览入口条 */
  previewBar: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  previewBtnText: { color: palette.text, fontSize: font.small, fontWeight: '600' },
  previewBtnHint: { color: palette.textFaint, fontSize: font.tiny },
  title: { color: palette.text, fontSize: font.title, fontWeight: '800' },
  subtitle: { color: palette.textDim, fontSize: font.small, marginTop: 2 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  fabText: { color: '#fff', fontSize: 30, lineHeight: 34, marginTop: -2 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
    gap: spacing.lg,
  },
  detailLabel: { color: palette.textDim, fontSize: font.small },
  detailValue: { color: palette.text, fontSize: font.body, flexShrink: 1, textAlign: 'right' },
});
