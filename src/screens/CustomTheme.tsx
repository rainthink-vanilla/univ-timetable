import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../store/AppStore';
import { Button, Card, SectionTitle } from '../components/ui';
import { CroppedImage } from '../components/CroppedImage';
import { CropModal, type AspectOption } from '../components/CropModal';
import { ThemeIcon } from '../components/ThemeIcon';
import { CropEntry, TabIconSetting } from '../types';
import {
  IMAGE_SPEC,
  LAUNCHER_ICON_NOTE,
  cropPatch,
  readTheme,
  removeThemeImage,
  persistThemeImage,
  tabIconPatch,
  validateImage,
  type PickedAsset,
} from '../utils/themeImage';
import { TAB_KEYS } from '../constants';
import { font, palette, radius, spacing } from '../theme';
import { useAccent } from '../store/AccentContext';

/** 可选的 emoji 图标 */
const EMOJI_CHOICES = ['📚', '✨', '⚙️', '🎓', '🗓️', '⏰', '📝', '🧭', '🌟', '🐳', '🍀', '🎈', '🔍', '📤'];

/** 遮罩浓度档位 */
const OVERLAY_STEPS = [0.6, 0.7, 0.78, 0.86, 0.92];

type Kind = 'background' | 'icon';

/** 底部三个标签（自定义图标按 key 存，v1.7.0 起三个都能换） */
const TAB_SLOTS: { key: string; label: string; fallback: string }[] = [
  { key: TAB_KEYS[0], label: '课表', fallback: '📚' },
  { key: TAB_KEYS[1], label: '导入', fallback: '✨' },
  { key: TAB_KEYS[2], label: '设置', fallback: '⚙️' },
];

/** 背景图可选比例：全屏（跟随屏幕比例，推荐）/ 9:16 / 1:1 */
const BACKGROUND_ASPECTS: AspectOption[] = [
  { key: 'screen', label: '全屏（推荐）', value: null },
  { key: 'p916', label: '9:16', value: 9 / 16 },
  { key: 'square', label: '1:1', value: 1 },
];

/** 正在裁剪的任务：既用于「新选图」，也用于「重新裁剪已有图」 */
interface CropTask {
  kind: Kind;
  /** 图标任务对应的标签 key（背景任务为 null） */
  tabKey: string | null;
  /** 预览用 URI（新选图 = 相册原图；重新裁剪 = 应用目录里的图） */
  uri: string;
  /** 原图像素尺寸（读不到则为 null） */
  source: { width: number; height: number } | null;
  /** 已有裁剪（重新裁剪时作为起点） */
  initialCrop: CropEntry | null;
  /** 新选图时要持久化的资源；重新裁剪时为 null（文件已在应用目录） */
  asset: PickedAsset | null;
  /** 图片格式/尺寸的说明（成功提示里回显） */
  note?: string;
}

export function CustomTheme() {
  const { settings, updateSettings } = useApp();
  const theme = readTheme(settings);
  const { accent } = useAccent();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [task, setTask] = useState<CropTask | null>(null);
  /** 当前正在编辑哪个标签的图标 */
  const [slot, setSlot] = useState<string>(TAB_KEYS[0]);

  const slotInfo = TAB_SLOTS.find((s) => s.key === slot) ?? TAB_SLOTS[0];
  const slotIcon: TabIconSetting = theme.tabIcons[slot] ?? { uri: null, emoji: null, crop: null };

  /** 复制进应用目录并写入设置（含裁剪记录） */
  const persist = async (t: CropTask, entry: CropEntry | null) => {
    // 重新裁剪：文件没变，只更新裁剪记录
    if (!t.asset) {
      if (t.tabKey) {
        // 从设置里现取该标签的现有设置（不要用渲染闭包里的 slotIcon，避免选中的槽已切换）
        const cur = settings.themeTabIcons?.[t.tabKey] ?? {};
        updateSettings(tabIconPatch(settings, t.tabKey, { ...cur, crop: entry }));
      } else {
        updateSettings(cropPatch(settings, t.kind, entry));
      }
      Alert.alert(
        '已重新裁剪',
        entry
          ? `裁剪后 ${Math.round(entry.rect.w * entry.source.width)} × ${Math.round(
              entry.rect.h * entry.source.height,
            )}，原图未改动。`
          : '已恢复为整张图。',
      );
      return;
    }

    setBusy(t.kind);
    try {
      /**
       * 持久化失败也必须把结果写进设置（v1.6.0 修复）。
       * 原实现里 `await persistThemeImage()` 一旦抛错就会跳过 updateSettings，
       * 用户看到的是「弹层关了、什么都没生效」。这里改成：先兜住异常，
       * 至少把「原图 URI + 裁剪记录」写进去，再把提示展示出来。
       */
      const prev = t.tabKey
        ? theme.tabIcons[t.tabKey]?.uri ?? null
        : t.kind === 'background'
        ? theme.backgroundImage
        : null;

      let uri = t.asset.uri;
      let persisted = false;
      let message: string | undefined;
      try {
        const res = await persistThemeImage(
          t.asset,
          t.tabKey ? `icon-${t.tabKey}` : t.kind,
        );
        uri = res.uri;
        persisted = res.persisted;
        message = res.message;
      } catch (e) {
        message = `图片保存失败（${e instanceof Error ? e.message : String(e)}），已直接引用所选图片。`;
      }

      if (t.tabKey) {
        updateSettings(
          tabIconPatch(settings, t.tabKey, { uri, emoji: null, crop: entry }),
        );
      } else if (t.kind === 'background') {
        updateSettings({ backgroundImage: uri, ...cropPatch(settings, 'background', entry) });
      } else {
        updateSettings({ themeIcon: uri, themeIconEmoji: null, ...cropPatch(settings, 'icon', entry) });
      }
      // 换图后清理旧文件（避免应用目录堆积）
      if (persisted && prev && prev !== uri) removeThemeImage(prev);

      const sizeNote = entry
        ? `${Math.round(entry.rect.w * entry.source.width)}×${Math.round(
            entry.rect.h * entry.source.height,
          )}（已裁剪）`
        : t.note || '已选择';
      Alert.alert('已应用', sizeNote + (message ? `\n\n${message}` : ''));
    } finally {
      setBusy(null);
    }
  };

  /** 选图 → 校验规格 → 进入裁剪 → 复制进应用目录 → 写入设置 */
  const pick = async (kind: Kind, tabKey: string | null = null) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('需要相册权限', '自定义主题需要读取你选择的图片。');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // 不用系统裁剪：App 内有自己的裁剪环节（可调比例、可重新裁剪）
      allowsEditing: false,
      quality: 1,
      exif: false,
    });
    if (res.canceled || !res.assets?.length) return;

    const a = res.assets[0];
    const asset: PickedAsset = {
      uri: a.uri,
      width: a.width,
      height: a.height,
      fileSize: a.fileSize,
      mimeType: a.mimeType,
      fileName: a.fileName,
    };

    // 规格校验：只有格式不支持 / 体积超上限 / 小于硬下限才拒绝，其余给提示
    const v = validateImage(asset);
    if (!v.ok) {
      Alert.alert(
        '图片不符合规格',
        `${v.reason}\n\n要求：${IMAGE_SPEC.formatLabels}，≤ ${IMAGE_SPEC.maxMB}MB，最短边 ≥ ${IMAGE_SPEC.minSide}px。\n建议：${IMAGE_SPEC.recommend}`,
      );
      return;
    }

    const sizeNote =
      v.info && v.info.width
        ? `${v.info.width}×${v.info.height} · ${v.info.format}${
            v.info.sizeMB ? ` · ${v.info.sizeMB.toFixed(1)}MB` : ''
          }`
        : '已选择';
    const note = [sizeNote, v.warning].filter(Boolean).join('\n');
    const source =
      typeof asset.width === 'number' && typeof asset.height === 'number' && asset.width > 0 && asset.height > 0
        ? { width: asset.width, height: asset.height }
        : null;

    // 读不到尺寸（极少数机型）：跳过裁剪，按原图直接用
    if (!source) {
      await persist({ kind, tabKey, uri: asset.uri, source: null, initialCrop: null, asset, note }, null);
      return;
    }

    setTask({ kind, tabKey, uri: asset.uri, source, initialCrop: null, asset, note });
  };

  /** 对已有图片重新裁剪（原图保留在应用目录，不会因反复裁剪掉画质） */
  const recrop = (kind: Kind, tabKey: string | null = null) => {
    const entry = tabKey
      ? theme.tabIcons[tabKey]?.crop ?? null
      : kind === 'background'
      ? theme.backgroundCrop
      : theme.iconCrop;
    const uri = tabKey
      ? theme.tabIcons[tabKey]?.uri ?? null
      : kind === 'background'
      ? theme.backgroundImage
      : theme.icon;
    if (!uri) return;
    if (!entry) {
      Alert.alert('无法重新裁剪', '这张图没有记录原始尺寸（可能是旧版本设置的），请重新选择图片。');
      return;
    }
    setTask({ kind, tabKey, uri, source: entry.source, initialCrop: entry, asset: null });
  };

  /** 清除某个标签的自定义图标（恢复默认 emoji） */
  const clearTabIcon = (key: string) => {
    const cur = theme.tabIcons[key];
    if (cur?.uri) removeThemeImage(cur.uri);
    updateSettings(tabIconPatch(settings, key, { uri: null, emoji: null, crop: null }));
  };

  const resetTheme = () => {
    Alert.alert('重置主题', '将清除自定义背景图与三个标签的图标，恢复默认外观。', [
      { text: '取消', style: 'cancel' },
      {
        text: '重置',
        style: 'destructive',
        onPress: () => {
          removeThemeImage(theme.backgroundImage);
          for (const s of TAB_SLOTS) removeThemeImage(theme.tabIcons[s.key]?.uri);
          updateSettings({
            backgroundImage: null,
            themeIcon: null,
            themeIconEmoji: null,
            themeCrop: { background: null, icon: null },
            themeTabIcons: null,
          });
        },
      },
    ]);
  };

  return (
    <Card style={{ marginBottom: spacing.lg }}>
      <SectionTitle>自定义主题</SectionTitle>

      {/* 背景图 */}
      <Text style={styles.label}>背景图</Text>
      <View style={styles.previewRow}>
        {theme.backgroundImage ? (
          <CroppedImage uri={theme.backgroundImage} crop={theme.backgroundCrop} style={styles.bgPreview} />
        ) : (
          <View style={[styles.bgPreview, styles.bgEmpty]}>
            <Text style={styles.bgEmptyText}>未设置</Text>
          </View>
        )}
        <View style={{ flex: 1, gap: spacing.sm }}>
          <Button
            title={busy === 'background' ? '处理中…' : '选择背景图'}
            onPress={() => pick('background')}
            disabled={busy !== null}
          />
          {theme.backgroundImage ? (
            <>
              {theme.backgroundCrop ? (
                <Button title="重新裁剪" variant="ghost" onPress={() => recrop('background')} />
              ) : null}
              <Button
                title="清除背景图"
                variant="danger"
                onPress={() => {
                  removeThemeImage(theme.backgroundImage);
                  updateSettings({ backgroundImage: null, ...cropPatch(settings, 'background', null) });
                }}
              />
            </>
          ) : null}
        </View>
      </View>
      {busy === 'background' ? (
        <View style={styles.busyRow}>
          <ActivityIndicator color={accent} size="small" />
          <Text style={styles.hint}>正在校验并复制图片…</Text>
        </View>
      ) : null}

      {/* 遮罩浓度：背景图越花，越需要加深遮罩才能看清字 */}
      <Text style={styles.label}>背景遮罩（越深越清晰）</Text>
      <View style={styles.overlayRow}>
        {OVERLAY_STEPS.map((v) => {
          const on = Math.abs((theme.backgroundOverlay ?? 0.86) - v) < 0.01;
          return (
            <Pressable
              key={v}
              onPress={() => updateSettings({ backgroundOverlay: v })}
              style={[styles.overlayChip, on && { backgroundColor: accent, borderColor: accent }]}
            >
              <Text style={[styles.overlayText, on && styles.overlayTextOn]}>{Math.round(v * 100)}%</Text>
            </Pressable>
          );
        })}
      </View>

      {/* 应用内图标：底部三个标签可分别更换（v1.7.0） */}
      <Text style={styles.label}>应用内图标（底部标签栏 · 三个都可单独更换）</Text>
      <View style={styles.slotRow}>
        {TAB_SLOTS.map((s) => {
          const ic = theme.tabIcons[s.key];
          const on = s.key === slot;
          const custom = !!(ic?.uri || ic?.emoji);
          return (
            <Pressable
              key={s.key}
              onPress={() => setSlot(s.key)}
              style={[styles.slot, on && { borderColor: accent, backgroundColor: palette.surfaceStrong }]}
            >
              <View style={styles.slotIcon}>
                <ThemeIcon uri={ic?.uri} crop={ic?.crop} emoji={ic?.emoji} fallback={s.fallback} size={24} />
              </View>
              <Text style={[styles.slotLabel, on && styles.slotLabelOn]}>{s.label}</Text>
              <Text style={styles.slotState}>{custom ? '自定义' : '默认'}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
        <Button
          title={busy === 'icon' ? '处理中…' : `为「${slotInfo.label}」上传图标图片`}
          variant="ghost"
          onPress={() => pick('icon', slot)}
          disabled={busy !== null}
        />
        {slotIcon.uri && slotIcon.crop ? (
          <Button title={`重新裁剪「${slotInfo.label}」图标`} variant="ghost" onPress={() => recrop('icon', slot)} />
        ) : null}
        {slotIcon.uri || slotIcon.emoji ? (
          <Button title={`恢复「${slotInfo.label}」默认图标`} variant="danger" onPress={() => clearTabIcon(slot)} />
        ) : null}
      </View>

      <Text style={styles.emojiHint}>或直接为「{slotInfo.label}」选一个 emoji：</Text>
      <View style={styles.emojiRow}>
        {EMOJI_CHOICES.map((e) => {
          const on = slotIcon.emoji === e && !slotIcon.uri;
          return (
            <Pressable
              key={e}
              onPress={() => {
                // 换成 emoji 时清掉该标签的图片文件
                if (slotIcon.uri) removeThemeImage(slotIcon.uri);
                updateSettings(tabIconPatch(settings, slot, { uri: null, emoji: e, crop: null }));
              }}
              style={[styles.emojiChip, on && { borderColor: accent, backgroundColor: palette.surfaceStrong }]}
            >
              <Text style={styles.emojiText}>{e}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.spec}>
        图片规格：{IMAGE_SPEC.formatLabels}　≤ {IMAGE_SPEC.maxMB}MB　最短边 ≥ {IMAGE_SPEC.minSide}px
        {'\n'}只要不低于 {IMAGE_SPEC.minSide}px 就可用：偏小的图不会被拒绝，只会在裁剪界面提示；
        清晰度按裁剪后的实际尺寸评价（建议 ≥ {IMAGE_SPEC.recommendSide}px，够用 ≥ {IMAGE_SPEC.goodSide}px）。
        {'\n'}选图后进入裁剪：拖动移动、双指捏合缩放、可选全屏 / 9:16 / 1:1，实时显示裁剪后尺寸与建议目标尺寸。
        裁剪只记录范围、不破坏原图，因此随时能「重新裁剪」且不会掉画质。
      </Text>
      <Text style={styles.note}>ℹ️ {LAUNCHER_ICON_NOTE}</Text>

      <Button title="重置主题" variant="ghost" onPress={resetTheme} style={{ marginTop: spacing.md }} />

      {/* 裁剪弹层：新选图与重新裁剪共用 */}
      {task ? (
        <CropModal
          visible
          uri={task.uri}
          source={task.source}
          initialCrop={task.initialCrop}
          kind={task.kind}
          aspects={task.kind === 'background' ? BACKGROUND_ASPECTS : undefined}
          titleOverride={
            task.tabKey
              ? `裁剪图标 · ${TAB_SLOTS.find((s) => s.key === task.tabKey)?.label ?? ''}`
              : undefined
          }
          onCancel={() => setTask(null)}
          onConfirm={(entry) => {
            const t = task;
            setTask(null);
            void persist(t, entry);
          }}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  label: { color: palette.textDim, fontSize: font.small, marginTop: spacing.md, marginBottom: spacing.sm },
  previewRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  bgPreview: {
    width: 96,
    height: 128,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  bgEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface },
  bgEmptyText: { color: palette.textFaint, fontSize: font.tiny },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  hint: { color: palette.textDim, fontSize: font.tiny },
  overlayRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  overlayChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  overlayText: { color: palette.textDim, fontSize: font.tiny, fontWeight: '600' },
  overlayTextOn: { color: '#fff' },
  /** 三个标签槽：点选后下方按钮作用于该标签 */
  slotRow: { flexDirection: 'row', gap: spacing.sm },
  slot: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  slotIcon: { height: 28, alignItems: 'center', justifyContent: 'center' },
  slotLabel: { color: palette.textDim, fontSize: font.tiny, fontWeight: '600' },
  slotLabelOn: { color: palette.text },
  slotState: { color: palette.textFaint, fontSize: 9 },
  emojiHint: { color: palette.textFaint, fontSize: font.tiny, marginTop: spacing.md, marginBottom: spacing.sm },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  emojiChip: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  emojiText: { fontSize: 18 },
  spec: { color: palette.textFaint, fontSize: font.tiny, lineHeight: 17, marginTop: spacing.md },
  note: { color: palette.textFaint, fontSize: font.tiny, lineHeight: 17, marginTop: spacing.sm },
});
