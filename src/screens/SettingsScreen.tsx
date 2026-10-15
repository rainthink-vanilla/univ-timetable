import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AIProvider, AppSettings, Course, Period } from '../types';
import { useApp } from '../store/AppStore';
import { Button, Card, SwatchRow, TextField } from '../components/ui';
import { SectionDrawer } from '../components/Drawer';
import { SheetModal } from '../components/SheetModal';
import { CustomTheme } from './CustomTheme';
import { ShareCenter } from './ShareCenter';
import { ACCENT_COLORS, AI_PRESETS, COURSE_COLORS, DEFAULT_PERIODS } from '../constants';
import { toCourse } from '../utils/parse';
import { parseTimetableFile } from '../utils/timetableFile';
import { readTheme } from '../utils/themeImage';
import { mondayOfWeek, toISODate } from '../utils/date';
import { buildCourseCheckReport, reportToText } from '../utils/diagnose';
import { font, palette, radius, spacing } from '../theme';
import { useAccent } from '../store/AccentContext';

/** 分类抽屉的 key（顺序即页面顺序） */
const DRAWERS = ['semester', 'appearance', 'ai', 'source', 'share', 'data'] as const;
type DrawerKey = (typeof DRAWERS)[number];

const DRAWER_TITLES: Record<DrawerKey, string> = {
  semester: '学期与作息',
  appearance: '外观与主题',
  ai: 'AI 服务',
  source: '课表来源（教务系统）',
  share: '分享与接收课表',
  data: '数据管理',
};

function ToggleRow({
  label,
  desc,
  value,
  onChange,
  disabled,
  accent,
}: {
  label: string;
  desc?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** 开启态的颜色（跟随用户强调色） */
  accent: string;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {desc ? <Text style={styles.toggleDesc}>{desc}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: palette.surfaceStrong, true: accent }}
        thumbColor="#fff"
      />
    </View>
  );
}

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { courses, settings, updateSettings, clearCourses, importCourses, autoFixedDays } = useApp();
  const { accent } = useAccent();
  const theme = readTheme(settings);

  const [periodModal, setPeriodModal] = useState(false);
  const [exportModal, setExportModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [checkModal, setCheckModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [periodDraft, setPeriodDraft] = useState<Period[]>(settings.periods);

  /** 抽屉模式（默认开）；关掉后所有分类平铺展开 */
  const drawerMode = settings.settingsDrawer !== false;
  /** 各抽屉的展开状态（抽屉模式下生效） */
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({ semester: true });
  const isOpen = (k: DrawerKey) => !drawerMode || !!openMap[k];
  const toggleDrawer = (k: DrawerKey) => setOpenMap((p) => ({ ...p, [k]: !p[k] }));

  /** 每个分类的"当前状态"摘要：收起时也能一眼看到结果 */
  const summaryOf = (k: DrawerKey): string => {
    switch (k) {
      case 'semester':
        return `${settings.semesterStart || '未设置开学日期'} · ${settings.totalWeeks} 周 · 节次 ${
          settings.periods.length
        } 节`;
      case 'appearance': {
        const custom = [
          theme.backgroundImage ? '背景图' : '',
          theme.tabIcons && Object.values(theme.tabIcons).some((v) => v?.uri || v?.emoji) ? '标签图标' : '',
        ]
          .filter(Boolean)
          .join('+');
        return `强调色 ${settings.accentColor} · 灵动岛 ${settings.dynamicIsland ? '开' : '关'} · 主题${
          custom ? `已自定义（${custom}）` : '默认'
        }`;
      }
      case 'ai':
        return `${settings.ai.model || '未设置模型'} · Key ${settings.ai.apiKey ? '已配置' : '未配置'}`;
      case 'source':
        return settings.meta.school || settings.meta.semester
          ? `${settings.meta.school || '未知学校'} · ${settings.meta.semester || '未注明学期'}`
          : '未填写教务系统信息';
      case 'share':
        return '把课表发给同学 / 接收同学的课表';
      case 'data':
        return `共 ${courses.length} 门课程`;
      default:
        return '';
    }
  };

  const setAI = (patch: Partial<AIProvider>) => {
    updateSettings({ ai: { ...settings.ai, ...patch } });
  };

  const exportJSON = () => {
    setExportModal(true);
  };

  const payload = JSON.stringify(
    {
      app: 'univ-timetable',
      version: 1,
      exportedAt: new Date().toISOString(),
      semesterStart: settings.semesterStart,
      totalWeeks: settings.totalWeeks,
      periods: settings.periods,
      courses,
    },
    null,
    2,
  );

  const doShare = () => {
    Share.share({ message: payload, title: '大学课表导出' }).catch(() => {});
  };

  const doImport = () => {
    // 复用统一文件解析器：既能吃 App 自己导出的 JSON，也能直接粘贴 agent 生成的
    // 课表文件全文（含 ```json 代码块或 Markdown 表格）
    const parsed = parseTimetableFile(importText);
    if (!parsed.courses.length) {
      Alert.alert('导入失败', parsed.warnings.join('\n') || '未能解析出有效课程');
      return;
    }
    const drafts = parsed.courses.map((c, i) => toCourse(c, COURSE_COLORS[i % COURSE_COLORS.length]));
    const outcome = importCourses(drafts, courses.length ? 'merge' : 'replace');

    const patch: Partial<AppSettings> = {};
    if (parsed.meta.semesterStart && /^\d{4}-\d{1,2}-\d{1,2}$/.test(parsed.meta.semesterStart)) {
      patch.semesterStart = parsed.meta.semesterStart;
    }
    if (parsed.meta.totalWeeks) patch.totalWeeks = parsed.meta.totalWeeks;
    if (parsed.periods.length) patch.periods = parsed.periods; // 文件里的节次时间优先
    if (Object.keys(parsed.meta).length) patch.meta = { ...settings.meta, ...parsed.meta };
    if (Object.keys(patch).length) updateSettings(patch);

    setImportText('');
    setImportModal(false);
    Alert.alert(
      '导入成功',
      `新增 ${outcome.added} 门${outcome.updated ? `，更新 ${outcome.updated} 门` : ''}，当前共 ${outcome.total} 门课程。` +
        (parsed.periods.length ? `\n\n节次时间已按文件更新：共 ${parsed.periods.length} 节。` : ''),
    );
  };

  const applyPeriods = () => {
    const valid = periodDraft
      .filter((p) => /^\d{1,2}:\d{2}$/.test(p.start) && /^\d{1,2}:\d{2}$/.test(p.end))
      .sort((a, b) => a.index - b.index);
    if (valid.length) updateSettings({ periods: valid });
    setPeriodModal(false);
  };

  /** 抽屉外壳：抽屉模式下可折叠，平铺模式下只是分组卡片 */
  const Drawer = ({ k, children }: { k: DrawerKey; children: React.ReactNode }) => (
    <SectionDrawer
      title={DRAWER_TITLES[k]}
      summary={summaryOf(k)}
      open={isOpen(k)}
      collapsible={drawerMode}
      onToggle={() => toggleDrawer(k)}
    >
      {children}
    </SectionDrawer>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.title}>设置</Text>
      <Text style={styles.subtitle}>学期 · 外观 · AI · 数据</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        {/* 显示方式：分类抽屉开关 */}
        <Card style={styles.modeCard}>
          <ToggleRow
            label="分类折叠（抽屉）"
            desc="按功能分组，点标题展开 / 收起；关掉后全部分类平铺展开"
            value={drawerMode}
            onChange={(v) => updateSettings({ settingsDrawer: v })}
            accent={accent}
          />
        </Card>

        {/* 1. 学期与作息 */}
        <Drawer k="semester">
          <TextField
            label="学期开始日期 (YYYY-MM-DD)"
            value={settings.semesterStart}
            onChangeText={(v) => updateSettings({ semesterStart: v })}
            placeholder="2025-09-01"
            keyboardType="numbers-and-punctuation"
          />
          <View style={styles.actionRow}>
            <Button
              title="设为本周一"
              variant="ghost"
              onPress={() => updateSettings({ semesterStart: toISODate(mondayOfWeek(new Date())) })}
              style={{ flex: 1 }}
            />
            <Button
              title="节次时间表"
              variant="ghost"
              onPress={() => {
                setPeriodDraft(settings.periods);
                setPeriodModal(true);
              }}
              style={{ flex: 1 }}
            />
          </View>
          <View style={[styles.actionRow, styles.rowSpaced]}>
            <Text style={styles.fieldLabel}>学期总周数</Text>
            <View style={styles.stepperInline}>
              <Button
                title="−"
                variant="ghost"
                onPress={() => updateSettings({ totalWeeks: Math.max(1, settings.totalWeeks - 1) })}
                style={styles.stepBtn}
              />
              <Text style={styles.stepValue}>{settings.totalWeeks}</Text>
              <Button
                title="＋"
                variant="ghost"
                onPress={() => updateSettings({ totalWeeks: Math.min(30, settings.totalWeeks + 1) })}
                style={styles.stepBtn}
              />
            </View>
          </View>
        </Drawer>

        {/* 2. 外观与主题 */}
        <Drawer k="appearance">
          <Text style={styles.fieldLabel}>强调色</Text>
          <SwatchRow
            colors={ACCENT_COLORS}
            value={settings.accentColor}
            onChange={(c) => updateSettings({ accentColor: c })}
          />
          <Text style={styles.hint}>选中后立即生效：按钮、胶囊、底部标签高亮、浮动按钮等都会换成这个颜色。</Text>
          <View style={styles.divider} />
          <ToggleRow
            label="灵动岛"
            desc="顶部胶囊显示当前周与下一节课"
            value={settings.dynamicIsland}
            onChange={(v) => updateSettings({ dynamicIsland: v })}
            accent={accent}
          />
          <ToggleRow
            label="毛玻璃效果"
            desc="敬请期待（视觉模型版本实现）"
            value={settings.glassEnabled}
            onChange={(v) => updateSettings({ glassEnabled: v })}
            disabled
            accent={accent}
          />
          <View style={styles.divider} />
          {/* 自定义主题：背景图 / 三个标签图标 */}
          <CustomTheme />
        </Drawer>

        {/* 3. AI 服务 */}
        <Drawer k="ai">
          <Text style={styles.fieldLabel}>快速套用预设</Text>
          <View style={styles.presetGrid}>
            {AI_PRESETS.map((p) => (
              <Button
                key={p.name}
                title={p.name}
                variant="ghost"
                onPress={() => setAI({ baseURL: p.baseURL, model: p.model, visionModel: p.visionModel })}
                style={styles.presetBtn}
              />
            ))}
          </View>
          <TextField
            label="服务地址 (Base URL)"
            value={settings.ai.baseURL}
            onChangeText={(v) => setAI({ baseURL: v })}
            placeholder="https://api.deepseek.com"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextField
            label="API Key"
            value={settings.ai.apiKey}
            onChangeText={(v) => setAI({ apiKey: v })}
            placeholder="sk-…"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextField
            label="文本模型"
            value={settings.ai.model}
            onChangeText={(v) => setAI({ model: v })}
            placeholder="deepseek-chat"
            autoCapitalize="none"
          />
          <TextField
            label="视觉模型 (截图识别，可留空)"
            value={settings.ai.visionModel}
            onChangeText={(v) => setAI({ visionModel: v })}
            placeholder="可留空"
            autoCapitalize="none"
          />
          <Text style={styles.hint}>
            提示：DeepSeek 无视觉模型，截图识别请配置支持图片的模型（如 qwen-vl-plus、gpt-4o、glm-4v-flash）。
          </Text>
        </Drawer>

        {/* 4. 课表来源 */}
        <Drawer k="source">
          <Text style={styles.hint}>
            各校教务系统差异较大，App 不直接登录抓取。请在 agent 对话里按
            docs/01-用户信息表与爬取引导.md 的引导完成爬取，再把生成的 .md 文件导入 App。
          </Text>
          <View style={styles.divider} />
          <TextField
            label="教务系统登录地址"
            value={settings.jwc.loginURL}
            onChangeText={(v) => updateSettings({ jwc: { ...settings.jwc, loginURL: v } })}
            placeholder="https://jwc.example.edu.cn/login"
            autoCapitalize="none"
          />
          <TextField
            label="课表页地址"
            value={settings.jwc.timetableURL}
            onChangeText={(v) => updateSettings({ jwc: { ...settings.jwc, timetableURL: v } })}
            placeholder="https://jwc.example.edu.cn/timetable"
            autoCapitalize="none"
          />
          <TextField
            label="备注"
            value={settings.jwc.note}
            onChangeText={(v) => updateSettings({ jwc: { ...settings.jwc, note: v } })}
            placeholder="如：需先登录，课表位于「我的课表」菜单"
          />
          {settings.meta.scrapedAt || settings.meta.school ? (
            <Text style={styles.hint}>
              最近一次导入：
              {[
                settings.meta.school,
                settings.meta.semester,
                settings.meta.scrapedAt ? settings.meta.scrapedAt.slice(0, 16).replace('T', ' ') : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
        </Drawer>

        {/* 5. 分享与接收 */}
        <Drawer k="share">
          <ShareCenter />
        </Drawer>

        {/* 6. 数据管理 */}
        <Drawer k="data">
          <View style={styles.dataCol}>
            <Button title="导出课表 (JSON)" onPress={exportJSON} />
            <Button
              title="导入课表 (JSON)"
              variant="ghost"
              onPress={() => {
                setImportText('');
                setImportModal(true);
              }}
            />
            <Button
              title="课表自检"
              variant="ghost"
              onPress={() => setCheckModal(true)}
            />
            <Button
              title="清空所有课程"
              variant="danger"
              onPress={() =>
                Alert.alert('确认清空', `将删除全部 ${courses.length} 门课程，且不可恢复。`, [
                  { text: '取消', style: 'cancel' },
                  { text: '清空', style: 'destructive', onPress: clearCourses },
                ])
              }
            />
          </View>
          <Text style={styles.hint}>
            导出可用于备份或换机迁移；导入支持 App 导出的 JSON，也支持 agent 生成的课表文件全文。
            若课表显示不对（例如某天的课跑到了别的列），先跑一次「课表自检」。
          </Text>
        </Drawer>
      </ScrollView>

      {/* 节次时间表 */}
      <SheetModal visible={periodModal} onClose={() => setPeriodModal(false)} title="节次时间表">
        {periodDraft.map((p) => (
          <View key={p.index} style={styles.periodRow}>
            <Text style={styles.periodIdx}>第{p.index}节</Text>
            <TextInput
              value={p.start}
              onChangeText={(v) =>
                setPeriodDraft((prev) => prev.map((x) => (x.index === p.index ? { ...x, start: v } : x)))
              }
              style={styles.periodInput}
              placeholder="08:00"
            />
            <Text style={styles.periodDash}>-</Text>
            <TextInput
              value={p.end}
              onChangeText={(v) =>
                setPeriodDraft((prev) => prev.map((x) => (x.index === p.index ? { ...x, end: v } : x)))
              }
              style={styles.periodInput}
              placeholder="08:45"
            />
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
          <Button title="重置默认" variant="ghost" onPress={() => setPeriodDraft(DEFAULT_PERIODS)} style={{ flex: 1 }} />
          <Button title="保存" onPress={applyPeriods} style={{ flex: 1 }} />
        </View>
      </SheetModal>

      {/* 课表自检 */}
      <SheetModal visible={checkModal} onClose={() => setCheckModal(false)} title="课表自检">
        {(() => {
          const report = buildCourseCheckReport(courses, { periods: settings.periods, autoFixedDays });
          return (
            <View>
              {report.items.map((it, i) => (
                <View key={i} style={styles.checkItem}>
                  <Text
                    style={[
                      styles.checkTitle,
                      it.severity === 'error' && { color: palette.danger },
                      it.severity === 'warn' && { color: '#F59E0B' },
                    ]}
                  >
                    {it.severity === 'error' ? '❌ ' : it.severity === 'warn' ? '⚠️ ' : 'ℹ️ '}
                    {it.title}
                  </Text>
                  {it.detail ? <Text style={styles.checkDetail}>{it.detail}</Text> : null}
                </View>
              ))}
              <Button
                title="分享自检报告"
                variant="ghost"
                onPress={() => {
                  Share.share({ message: reportToText(report), title: '课表自检报告' }).catch(() => {});
                }}
                style={{ marginTop: spacing.md }}
              />
            </View>
          );
        })()}
      </SheetModal>

      {/* 导出 */}
      <SheetModal visible={exportModal} onClose={() => setExportModal(false)} title="导出 JSON">
        <TextInput value={payload} multiline editable={false} style={styles.jsonBox} />
        <Button title="分享 / 复制" onPress={doShare} style={{ marginTop: spacing.md }} />
      </SheetModal>

      {/* 导入 */}
      <SheetModal visible={importModal} onClose={() => setImportModal(false)} title="导入 JSON">
        <TextInput
          value={importText}
          onChangeText={setImportText}
          multiline
          placeholder='粘贴 App 导出的 JSON，或 agent 生成的课表文件全文（含 ```json 代码块 / 表格）'
          style={styles.jsonBox}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button title="解析并导入" onPress={doImport} style={{ marginTop: spacing.md }} />
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.lg },
  title: { color: palette.text, fontSize: font.title, fontWeight: '800' },
  subtitle: { color: palette.textDim, fontSize: font.small, marginTop: 2, marginBottom: spacing.md },
  modeCard: { marginBottom: spacing.md, paddingVertical: spacing.sm },
  fieldLabel: { color: palette.textDim, fontSize: font.small, marginBottom: spacing.sm },
  hint: { color: palette.textFaint, fontSize: font.tiny, lineHeight: 16, marginTop: spacing.sm },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
    marginVertical: spacing.md,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  toggleLabel: { color: palette.text, fontSize: font.body, fontWeight: '600' },
  toggleDesc: { color: palette.textFaint, fontSize: font.tiny, marginTop: 2 },
  /** 两个按钮一行、等宽等高（"更工整"） */
  actionRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  rowSpaced: { justifyContent: 'space-between', marginTop: spacing.md },
  stepperInline: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: { width: 40, paddingVertical: 6 },
  stepValue: { color: palette.text, fontSize: font.h3, fontWeight: '700', minWidth: 30, textAlign: 'center' },
  /** 预设按钮：两列等宽网格 */
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  presetBtn: { width: '48%', paddingVertical: 8, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  /** 数据管理：整列等宽按钮 */
  dataCol: { gap: spacing.sm },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  periodIdx: { color: palette.textDim, fontSize: font.small, width: 56 },
  periodInput: {
    flex: 1,
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: palette.text,
    fontSize: font.body,
    textAlign: 'center',
  },
  periodDash: { color: palette.textFaint },
  /** 课表自检的条目 */
  checkItem: { marginBottom: spacing.md },
  checkTitle: { color: palette.text, fontSize: font.small, fontWeight: '700', lineHeight: 20 },
  checkDetail: { color: palette.textDim, fontSize: font.tiny, lineHeight: 17, marginTop: 2 },
  jsonBox: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: palette.text,
    fontSize: 12,
    minHeight: 220,
    textAlignVertical: 'top',
    fontFamily: 'monospace',
  },
});
