import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ParsedCourseInput } from '../types';
import { useApp } from '../store/AppStore';
import { parseCoursesFromImage, parseCoursesFromText, AIError } from '../ai/client';
import { toCourse } from '../utils/parse';
import { Button, TextField } from '../components/ui';
import { COURSE_COLORS, DAY_LABELS } from '../constants';
import { weeksLabel } from '../utils/select';
import { font, palette, radius, spacing } from '../theme';
import { useAccent } from '../store/AccentContext';

function errMsg(e: unknown): string {
  if (e instanceof AIError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

export function AIImport({ onImported }: { onImported: (count: number) => void }) {
  const { settings, importCourses } = useApp();
  const { accent, accentSoft } = useAccent();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<ParsedCourseInput[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  const setParsedList = (list: ParsedCourseInput[]) => {
    setParsed(list);
    setSelected(Object.fromEntries(list.map((_, i) => [i, true])));
  };

  const runText = async () => {
    if (!text.trim()) {
      setError('请先粘贴课表文本');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const list = await parseCoursesFromText(settings.ai, text);
      setParsedList(list);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const runImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('需要相册权限才能上传课表截图');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.85,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (!asset.base64) {
      setError('无法读取图片数据');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const list = await parseCoursesFromImage(settings.ai, asset.base64, asset.mimeType || 'image/png');
      setParsedList(list);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (i: number) => {
    setSelected((prev) => ({ ...prev, [i]: !prev[i] }));
  };

  const confirm = () => {
    const chosen = parsed.filter((_, i) => selected[i]);
    if (!chosen.length) return;
    importCourses(chosen.map((p, idx) => toCourse(p, COURSE_COLORS[idx % COURSE_COLORS.length])));
    onImported(chosen.length);
    setParsed([]);
    setText('');
  };

  return (
    <View style={{ flex: 1 }}>
      <TextField
        label="粘贴课表文本"
        value={text}
        onChangeText={setText}
        placeholder={'例如：\n高等数学 张三 教一101 周一 第1-2节 1-16周\n大学英语 李四 教二203 周三 第3-4节 1-16周(单)'}
        multiline
        style={{ minHeight: 110, textAlignVertical: 'top' }}
      />
      <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
        <Button title="AI 解析文本" onPress={runText} disabled={loading} />
        <Button title="上传课表截图识别" variant="ghost" onPress={runImage} disabled={loading} />
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={accent} size="large" />
          <Text style={styles.loadingText}>AI 正在解析课表…</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {parsed.length > 0 ? (
        <View style={{ flex: 1 }}>
          <View style={styles.previewHead}>
            <Text style={styles.previewTitle}>识别结果（{parsed.length}）</Text>
            <Text style={styles.previewHint}>点选要导入的课程</Text>
          </View>
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            <View style={{ gap: spacing.sm, paddingBottom: spacing.lg }}>
              {parsed.map((p, i) => (
                <Pressable
                  key={i}
                  onPress={() => toggle(i)}
                  style={[styles.previewItem, selected[i] && { borderColor: accent, backgroundColor: accentSoft }]}
                >
                  <View style={[styles.check, selected[i] && { backgroundColor: accent, borderColor: accent }]}>
                    {selected[i] ? <Text style={styles.checkMark}>✓</Text> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.previewName}>{p.name}</Text>
                    <Text style={styles.previewMeta}>
                      {DAY_LABELS[p.dayOfWeek - 1]} · 第{p.startPeriod}-{p.endPeriod}节 · {weeksLabel(p.weeks)}
                    </Text>
                    {p.teacher || p.location ? (
                      <Text style={styles.previewMeta}>{[p.teacher, p.location].filter(Boolean).join(' · ')}</Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Button title={`导入已选课程（${Object.values(selected).filter(Boolean).length}）`} onPress={confirm} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
  loadingText: { color: palette.textDim, fontSize: font.small },
  errorBox: {
    backgroundColor: 'rgba(244,63,94,0.12)',
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { color: palette.danger, fontSize: font.small, lineHeight: 18 },
  previewHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  previewTitle: { color: palette.text, fontSize: font.h3, fontWeight: '700' },
  previewHint: { color: palette.textFaint, fontSize: font.tiny },
  previewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: spacing.md,
  },
  /** 选中态由 useAccent() 内联给出（强调色可配置） */
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: palette.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '800' },
  previewName: { color: palette.text, fontSize: font.body, fontWeight: '700' },
  previewMeta: { color: palette.textDim, fontSize: font.small, marginTop: 2 },
});
