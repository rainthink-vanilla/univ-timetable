import React, { useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../store/AppStore';
import { Button, Card, SectionTitle } from '../components/ui';
import { pickTimetableFile } from '../utils/fileImporter';
import { buildTimetableMarkdown, parseTimetableFile, ParsedTimetableFile } from '../utils/timetableFile';
import { readTheme } from '../utils/themeImage';
import { COURSE_COLORS } from '../constants';
import { toCourse } from '../utils/parse';
import { font, palette, radius, spacing } from '../theme';

/**
 * 分享中心：面向「课表在同学之间传递」的场景。
 *
 * 与「导入 → 文件导入」的分工：
 * - 那里是本机导入 agent 生成的课表；
 * - 这里是**把课表分享给别人 / 接收别人的课表**，因此：
 *   1. 导出文件默认带上「分享」段（学校/学期/节次时间/主题），对方导入即可还原；
 *   2. 提供「复制分享文本」，可直接粘贴到聊天窗口，对方粘回 App 即可导入；
 *   3. 导入他人分享时，**明确区分**「课表」与「主题」，让用户选择应用哪些。
 */
export function ShareCenter() {
  const { courses, settings, importCourses, updateSettings } = useApp();
  const theme = readTheme(settings);
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState<ParsedTimetableFile | null>(null);

  /** 组装当前课表的分享文件文本（含主题与节次时间） */
  const buildShareText = () =>
    buildTimetableMarkdown({
      meta: {
        ...settings.meta,
        semesterStart: settings.semesterStart,
        totalWeeks: settings.totalWeeks,
        scrapedAt: new Date().toISOString(),
      },
      courses: courses.map((c) => ({
        name: c.name,
        teacher: c.teacher,
        location: c.location,
        dayOfWeek: c.dayOfWeek,
        startPeriod: c.startPeriod,
        endPeriod: c.endPeriod,
        weeks: c.weeks,
        note: c.note,
      })),
      periods: settings.periods,
      theme: {
        accentColor: settings.accentColor,
        backgroundOverlay: theme.backgroundOverlay,
        iconEmoji: theme.iconEmoji,
      },
    });

  /** 分享为文件（系统分享面板：微信 / QQ / 邮件…） */
  const shareAsFile = async () => {
    if (!courses.length) {
      Alert.alert('没有可分享的课表', '请先导入或添加课程。');
      return;
    }
    setBusy(true);
    try {
      const md = buildShareText();
      await Share.share({
        title: '我的课表',
        message: md,
      });
    } catch (e) {
      Alert.alert('分享失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 发送课表文本。
   * 用 RN 内置 Share：系统分享面板本身带「复制」动作，无需额外剪贴板依赖；
   * `compact` 用于在聊天窗口里更短更好读的版本。
   */
  const shareText = async (compact: boolean) => {
    if (!courses.length) {
      Alert.alert('没有可分享的课表', '请先导入或添加课程。');
      return;
    }
    setBusy(true);
    try {
      const message = compact ? buildCompactText() : buildShareText();
      await Share.share({
        title: compact ? '我的课表（简版）' : '我的课表',
        message,
      });
    } catch (e) {
      Alert.alert('分享失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 简版文本：一周一行课，适合直接发聊天窗口 */
  const buildCompactText = () => {
    const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const lines: string[] = [];
    lines.push(`📚 我的课表${settings.meta.school ? ` · ${settings.meta.school}` : ''}`);
    if (settings.meta.semester) lines.push(`🗓️ ${settings.meta.semester}`);
    lines.push('');
    for (let d = 1; d <= 7; d++) {
      const ofDay = courses
        .filter((c) => c.dayOfWeek === d)
        .sort((a, b) => a.startPeriod - b.startPeriod);
      if (!ofDay.length) continue;
      lines.push(`【${dayNames[d - 1]}】`);
      for (const c of ofDay) {
        const p1 = settings.periods.find((p) => p.index === c.startPeriod);
        const p2 = settings.periods.find((p) => p.index === c.endPeriod);
        const time = p1 && p2 ? `${p1.start}-${p2.end} ` : '';
        lines.push(`  ${time}第${c.startPeriod}-${c.endPeriod}节 ${c.name}${c.location ? ` @${c.location}` : ''}`);
      }
      lines.push('');
    }
    // 附机器可读段：对方把整段粘回 App 的「粘贴导入」即可还原
    lines.push('—— 以下内容可直接粘贴到 App「设置 → 导入课表 (JSON)」还原 ——');
    lines.push(buildShareText());
    return lines.join('\n');
  };

  /** 接收别人的课表文件 */
  const receiveFile = async () => {
    setBusy(true);
    const res = await pickTimetableFile();
    setBusy(false);
    if (res.canceled) return;
    if (!res.ok) {
      Alert.alert('读取失败', res.message || '无法读取文件');
      return;
    }
    const p = res.parsed!;
    if (!p.courses.length) {
      Alert.alert('没有解析到课程', p.warnings.join('\n') || '文件格式不正确');
      return;
    }
    setReceived(p);
  };

  /** 应用收到的课表（课表与主题分开处理） */
  const applyReceived = (withTheme: boolean) => {
    if (!received) return;
    const drafts = received.courses.map((c, i) => toCourse(c, COURSE_COLORS[i % COURSE_COLORS.length]));
    const outcome = importCourses(drafts, courses.length ? 'merge' : 'replace');

    const patch: Record<string, unknown> = {};
    if (received.meta.semesterStart && /^\d{4}-\d{1,2}-\d{1,2}$/.test(received.meta.semesterStart)) {
      patch.semesterStart = received.meta.semesterStart;
    }
    if (received.periods.length) patch.periods = received.periods;
    if (withTheme && received.theme) {
      if (received.theme.accentColor) patch.accentColor = received.theme.accentColor;
      if (typeof received.theme.backgroundOverlay === 'number') {
        patch.backgroundOverlay = received.theme.backgroundOverlay;
      }
    }
    if (Object.keys(patch).length) updateSettings(patch);

    const themeNote = received.theme
      ? withTheme
        ? '\n已一并应用对方的主题配色。'
        : '\n（未应用对方的主题，保留你自己的外观设置）'
      : '';
    setReceived(null);
    Alert.alert(
      '已导入同学的课表',
      `新增 ${outcome.added} 门${outcome.updated ? `，更新 ${outcome.updated} 门` : ''}，当前共 ${outcome.total} 门课程。${themeNote}`,
    );
  };

  return (
    <Card style={{ marginBottom: spacing.lg }}>
      <SectionTitle>分享与接收课表</SectionTitle>
      <Text style={styles.desc}>
        把课表发给同学，或接收同学的课表。分享内容包含课程、节次时间与学期信息，对方导入即可使用；
        节次时间会一并同步，作息不同的学校也能对上。
      </Text>

      <View style={{ gap: spacing.sm }}>
        <Button title="分享课表（系统分享面板）" onPress={shareAsFile} disabled={busy} />
        <Button
          title="分享简版文本（适合发聊天窗口）"
          variant="ghost"
          onPress={() => shareText(true)}
          disabled={busy}
        />
        <Button
          title={busy ? '处理中…' : '接收同学的课表文件'}
          variant="ghost"
          onPress={receiveFile}
          disabled={busy}
        />
      </View>
      <Text style={styles.tip}>
        提示：系统分享面板里可直接选「复制」，把课表粘到聊天窗口；对方把内容整段粘回
        「设置 → 导入课表 (JSON)」即可还原。
      </Text>

      {/* 收到文件后的确认区：课表与主题分开选择 */}
      {received ? (
        <View style={styles.receivedBox}>
          <Text style={styles.receivedTitle}>
            收到 {received.courses.length} 门课
            {received.meta.school ? ` · ${received.meta.school}` : ''}
          </Text>
          <Text style={styles.receivedMeta}>
            {[
              received.meta.semester,
              received.meta.semesterStart ? `开学 ${received.meta.semesterStart}` : '',
              received.periods.length ? `节次 ${received.periods.length} 节` : '',
              received.theme ? '含主题' : '',
            ]
              .filter(Boolean)
              .join(' · ') || '无附加信息'}
          </Text>

          <ScrollView style={styles.preview} nestedScrollEnabled>
            {received.courses.slice(0, 30).map((c, i) => (
              <Text key={i} style={styles.previewLine} numberOfLines={1}>
                {['周一', '周二', '周三', '周四', '周五', '周六', '周日'][c.dayOfWeek - 1]} 第
                {c.startPeriod}-{c.endPeriod}节 · {c.name}
              </Text>
            ))}
            {received.courses.length > 30 ? (
              <Text style={styles.previewLine}>… 还有 {received.courses.length - 30} 门</Text>
            ) : null}
          </ScrollView>

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <Button title="导入课表（用我自己的主题）" onPress={() => applyReceived(false)} />
            {received.theme ? (
              <Button
                title="导入课表 + 应用对方主题"
                variant="ghost"
                onPress={() => applyReceived(true)}
              />
            ) : null}
            <Button title="取消" variant="danger" onPress={() => setReceived(null)} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  desc: { color: palette.textDim, fontSize: font.small, lineHeight: 20, marginBottom: spacing.md },
  tip: { color: palette.textFaint, fontSize: font.tiny, lineHeight: 17, marginTop: spacing.md },
  receivedBox: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  receivedTitle: { color: palette.text, fontSize: font.body, fontWeight: '700' },
  receivedMeta: { color: palette.textDim, fontSize: font.tiny, marginTop: 4, lineHeight: 16 },
  preview: {
    maxHeight: 150,
    marginTop: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  previewLine: { color: palette.textDim, fontSize: font.tiny, lineHeight: 18 },
});
