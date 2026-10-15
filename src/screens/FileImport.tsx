import React, { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ParsedCourseInput } from '../types';
import { useApp, CourseImportMode } from '../store/AppStore';
import { exportTimetableFile, pickTimetableFile } from '../utils/fileImporter';
import { ParsedTimetableFile } from '../utils/timetableFile';
import { Button, Card, Segmented, SectionTitle } from '../components/ui';
import { COURSE_COLORS, DAY_LABELS } from '../constants';
import { toCourse } from '../utils/parse';
import { weeksLabel } from '../utils/select';
import { font, palette, radius, spacing } from '../theme';
import { useAccent } from '../store/AccentContext';

/** 导入完成后弹出的安全提醒（第 4 条需求：提醒用户改密码） */
function securityAlert(school: string, jwcURL: string, updated: boolean) {
  const where = school || jwcURL || '学校教务系统';
  Alert.alert(
    updated ? '课表已更新 ✅' : '课表已导入 ✅',
    `数据来自 ${where}。\n\n` +
      '安全提醒：agent 刚才用你的账号密码登录过教务系统，密码可能留在浏览记录、日志或对话中。\n' +
      '建议现在就去教务系统修改密码，改完不影响已经导入的课表。',
    [
      {
        text: '去改密码',
        onPress: () => {
          if (jwcURL) Linking.openURL(jwcURL).catch(() => {});
          else Alert.alert('提示', '请在浏览器打开学校教务系统，进入「个人设置 → 修改密码」。');
        },
      },
      { text: '稍后再说', style: 'cancel' },
    ],
  );
}

function CourseRow({
  course,
  selected,
  onToggle,
}: {
  course: ParsedCourseInput;
  selected: boolean;
  onToggle: () => void;
}) {
  const { accent, accentSoft } = useAccent();
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.row, selected && { borderColor: accent, backgroundColor: accentSoft }]}
    >
      <View style={[styles.check, selected && { backgroundColor: accent, borderColor: accent }]}>
        {selected ? <Text style={styles.checkMark}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName}>{course.name}</Text>
        <Text style={styles.rowMeta}>
          {DAY_LABELS[course.dayOfWeek - 1]} · 第{course.startPeriod}-{course.endPeriod}节 · {weeksLabel(course.weeks)}
        </Text>
        {course.teacher || course.location ? (
          <Text style={styles.rowMeta}>{[course.teacher, course.location].filter(Boolean).join(' · ')}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function FileImport() {
  const { settings, importCourses, updateSettings, courses } = useApp();
  const { accent } = useAccent();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedTimetableFile | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [mode, setMode] = useState<CourseImportMode>('merge');
  const [error, setError] = useState('');

  const reset = () => {
    setParsed(null);
    setFileName('');
    setSelected({});
    setError('');
  };

  const doPick = async () => {
    setLoading(true);
    setError('');
    const res = await pickTimetableFile();
    setLoading(false);

    if (res.canceled) return;
    if (!res.ok) {
      reset();
      setError(res.message || '导入失败');
      return;
    }
    const p = res.parsed!;
    if (!p.courses.length) {
      reset();
      setError((res.message ? res.message + '\n' : '') + p.warnings.join('\n'));
      return;
    }
    setFileName(res.fileName || '课表文件');
    setParsed(p);
    setSelected(Object.fromEntries(p.courses.map((_, i) => [i, true])));
    setMode(courses.length ? 'merge' : 'replace');
  };

  const confirm = () => {
    if (!parsed) return;
    const chosen = parsed.courses.filter((_, i) => selected[i]);
    if (!chosen.length) {
      Alert.alert('提示', '请至少选择一门课程');
      return;
    }
    const drafts = chosen.map((c, i) => toCourse(c, COURSE_COLORS[i % COURSE_COLORS.length]));
    const outcome = importCourses(drafts, mode);

    // 同步文件里的学期信息（仅在没有手动改过、或文件明确给出时覆盖）
    const patch: Record<string, unknown> = {};
    if (parsed.meta.semesterStart && /^\d{4}-\d{1,2}-\d{1,2}$/.test(parsed.meta.semesterStart)) {
      patch.semesterStart = parsed.meta.semesterStart;
    }
    if (parsed.meta.totalWeeks) patch.totalWeeks = parsed.meta.totalWeeks;
    if (parsed.meta.jwcURL) patch.jwc = { ...settings.jwc, timetableURL: parsed.meta.jwcURL };
    // 节次时间表：文件里给了就用文件的（各校作息不同，8:00 / 8:30 的差异在这里生效）
    if (parsed.periods.length) patch.periods = parsed.periods;
    patch.meta = { ...settings.meta, ...parsed.meta };
    updateSettings(patch);

    const detail =
      mode === 'replace'
        ? `已用文件中的 ${outcome.total} 门课程替换原有课表`
        : `新增 ${outcome.added} 门${outcome.updated ? `，更新 ${outcome.updated} 门` : ''}，当前共 ${outcome.total} 门`;
    const periodNote = parsed.periods.length
      ? `\n\n节次时间已按文件更新：共 ${parsed.periods.length} 节，第 1 节 ${parsed.periods[0].start} 开始。`
      : '';

    reset();
    securityAlert(parsed.meta.school || '', parsed.meta.jwcURL || settings.jwc.timetableURL, mode !== 'replace');
    setTimeout(() => Alert.alert('导入结果', detail + periodNote), 400);
  };

  const doExport = async () => {
    setExporting(true);
    const res = await exportTimetableFile(
      { ...settings.meta, semesterStart: settings.semesterStart, totalWeeks: settings.totalWeeks, scrapedAt: new Date().toISOString() },
      courses.map((c) => ({
        name: c.name,
        teacher: c.teacher,
        location: c.location,
        dayOfWeek: c.dayOfWeek,
        startPeriod: c.startPeriod,
        endPeriod: c.endPeriod,
        weeks: c.weeks,
        note: c.note,
      })),
      settings.periods,
    );
    setExporting(false);
    if (!res.ok) Alert.alert('导出失败', res.message || '未知错误');
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
      <Card style={{ marginBottom: spacing.lg }}>
        <SectionTitle>选择课表文件</SectionTitle>
        <Text style={styles.desc}>
          选择 agent 生成的课表文件（.md 或 .json）。文件里应包含
          <Text style={styles.code}>```json</Text>
          代码块或「课程明细」表格。
        </Text>
        <Button
          title={loading ? '正在读取…' : '📂 选择文件'}
          onPress={doPick}
          disabled={loading || exporting}
        />
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={accent} />
            <Text style={styles.loadingText}>正在解析文件…</Text>
          </View>
        ) : null}
      </Card>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {parsed ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <SectionTitle>文件内容</SectionTitle>
          <Text style={styles.fileName}>{fileName}</Text>
          <View style={styles.metaGrid}>
            {[
              ['学校', parsed.meta.school],
              ['学期', parsed.meta.semester],
              ['开学日期', parsed.meta.semesterStart],
              ['覆盖周次', parsed.meta.weekRange],
              ['节次时间', parsed.periods.length ? `${parsed.periods.length} 节 · 第1节 ${parsed.periods[0].start}` : undefined],
              ['爬取时间', parsed.meta.scrapedAt ? parsed.meta.scrapedAt.slice(0, 16).replace('T', ' ') : undefined],
              ['解析方式', parsed.via === 'json' ? 'JSON 代码块' : parsed.via === 'table' ? 'Markdown 表格' : '原始 JSON'],
            ]
              .filter((x) => x[1])
              .map(([k, v]) => (
                <View key={String(k)} style={styles.metaItem}>
                  <Text style={styles.metaKey}>{k}</Text>
                  <Text style={styles.metaVal} numberOfLines={1}>
                    {String(v)}
                  </Text>
                </View>
              ))}
          </View>
          {parsed.warnings.length ? (
            <Text style={styles.warnText}>⚠️ {parsed.warnings.join('；')}</Text>
          ) : null}

          <Text style={styles.modeLabel}>导入方式</Text>
          <Segmented
            options={[
              { key: 'merge' as CourseImportMode, label: '更新合并' },
              { key: 'replace' as CourseImportMode, label: '整体替换' },
              { key: 'append' as CourseImportMode, label: '追加' },
            ]}
            value={mode}
            onChange={setMode}
          />
          <Text style={styles.modeHint}>
            {mode === 'merge'
              ? '同一天同一节次的同名课程会被新数据覆盖，其余保留（推荐用于课表更新）'
              : mode === 'replace'
              ? '清空现有全部课程，完全使用文件内容（推荐换学期时使用）'
              : '直接追加，可能产生重复课程'}
          </Text>

          <Text style={styles.modeLabel}>课程（{parsed.courses.length}）· 点选要导入的</Text>
          <View style={{ gap: spacing.sm }}>
            {parsed.courses.map((c, i) => (
              <CourseRow
                key={i}
                course={c}
                selected={!!selected[i]}
                onToggle={() => setSelected((prev) => ({ ...prev, [i]: !prev[i] }))}
              />
            ))}
          </View>

          <Button
            title={`导入已选课程（${selectedCount}）`}
            onPress={confirm}
            disabled={!selectedCount}
            style={{ marginTop: spacing.lg }}
          />
        </Card>
      ) : null}

      <Card>
        <SectionTitle>导出当前课表</SectionTitle>
        <Text style={styles.desc}>把手机上的课表导出成统一格式的 .md 文件，可用于备份或换机迁移。</Text>
        <Button
          title={exporting ? '正在生成…' : '导出为 .md 文件'}
          variant="ghost"
          onPress={doExport}
          disabled={exporting || loading || !courses.length}
        />
        {!courses.length ? <Text style={styles.modeHint}>当前还没有课程，先导入一份课表吧。</Text> : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  desc: { color: palette.textDim, fontSize: font.small, lineHeight: 20, marginBottom: spacing.md },
  code: { color: palette.text, fontFamily: 'monospace' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  loadingText: { color: palette.textDim, fontSize: font.small },
  errorBox: {
    backgroundColor: 'rgba(244,63,94,0.12)',
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: { color: palette.danger, fontSize: font.small, lineHeight: 18 },
  fileName: { color: palette.text, fontSize: font.body, fontWeight: '700', marginBottom: spacing.md },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metaItem: {
    backgroundColor: palette.surfaceStrong,
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    minWidth: '46%',
    flexGrow: 1,
  },
  metaKey: { color: palette.textFaint, fontSize: font.tiny },
  metaVal: { color: palette.text, fontSize: font.small, fontWeight: '600', marginTop: 2 },
  warnText: { color: '#F59E0B', fontSize: font.tiny, lineHeight: 16, marginTop: spacing.md },
  modeLabel: { color: palette.textDim, fontSize: font.small, marginTop: spacing.lg, marginBottom: spacing.sm },
  modeHint: { color: palette.textFaint, fontSize: font.tiny, lineHeight: 16, marginTop: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: spacing.md,
  },
  rowOn: { borderColor: palette.accent },
  /** 选中态（边框/底色/勾选圆点）由 useAccent() 内联给出（强调色可配置） */
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: palette.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '800' },
  rowName: { color: palette.text, fontSize: font.body, fontWeight: '700' },
  rowMeta: { color: palette.textDim, fontSize: font.small, marginTop: 2 },
});
