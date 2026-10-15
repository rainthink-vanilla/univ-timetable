import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../store/AppStore';
import { Button, Card, SectionTitle, Segmented } from '../components/ui';
import { AIImport } from './AIImport';
import { CourseForm } from './CourseForm';
import { FileImport } from './FileImport';
import { font, palette, spacing } from '../theme';

export function ImportScreen() {
  const insets = useSafeAreaInsets();
  const { settings, addCourse } = useApp();
  const [tab, setTab] = useState<'file' | 'ai' | 'manual'>('file');
  const [formVisible, setFormVisible] = useState(false);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.title}>导入课程</Text>
      <Text style={styles.subtitle}>选择 agent 生成的课表文件 · 或手动添加</Text>
      <Segmented
        options={[
          { key: 'file', label: '文件导入' },
          { key: 'ai', label: 'AI 导入' },
          { key: 'manual', label: '手动添加' },
        ]}
        value={tab}
        onChange={setTab}
        style={{ marginVertical: spacing.md }}
      />

      {tab === 'file' ? <FileImport /> : null}

      {tab === 'ai' ? (
        <AIImport
          onImported={(n) => Alert.alert('导入成功', `已导入 ${n} 门课程，快去课表看看吧`)}
        />
      ) : null}

      {tab === 'manual' ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          showsVerticalScrollIndicator={false}
        >
          <Card>
            <SectionTitle>手动添加课程</SectionTitle>
            <Text style={styles.desc}>
              填写课程名称、教师、地点、星期、节次与上课周次，即可加入课表。也可以直接在「课表」页点右下角 ＋ 快速添加。
            </Text>
            <Button title="打开添加表单" onPress={() => setFormVisible(true)} />
          </Card>
        </ScrollView>
      ) : null}

      <CourseForm
        visible={formVisible}
        initial={null}
        periods={settings.periods}
        totalWeeks={settings.totalWeeks}
        accentColor={settings.accentColor}
        onClose={() => setFormVisible(false)}
        onSubmit={(drafts) => {
          // 星期可多选：可能一次提交多条（每天一条）
          for (const d of drafts) addCourse(d);
          setFormVisible(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.lg },
  title: { color: palette.text, fontSize: font.title, fontWeight: '800' },
  subtitle: { color: palette.textDim, fontSize: font.small, marginTop: 2 },
  desc: { color: palette.textDim, fontSize: font.body, lineHeight: 22, marginBottom: spacing.lg },
});
