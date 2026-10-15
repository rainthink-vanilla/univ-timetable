import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, useApp } from './src/store/AppStore';
import { AccentProvider } from './src/store/AccentContext';
import { BottomTabs } from './src/components/BottomTabs';
import { CroppedImage } from './src/components/CroppedImage';
import { TimetableScreen } from './src/screens/TimetableScreen';
import { ImportScreen } from './src/screens/ImportScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { palette } from './src/theme';
import { readTheme } from './src/utils/themeImage';

const TABS = [
  { key: 'timetable', label: '课表', icon: '📚' },
  { key: 'import', label: '导入', icon: '✨' },
  { key: 'settings', label: '设置', icon: '⚙️' },
];

function Shell() {
  const { ready, settings } = useApp();
  const [tab, setTab] = useState('timetable');

  if (!ready) {
    return (
      <View style={styles.loading}>
        <StatusBar style="light" />
      </View>
    );
  }

  const theme = readTheme(settings);
  // 遮罩浓度可调：背景图越花，越需要加深遮罩才能看清文字
  const overlay = { backgroundColor: `rgba(7,12,24,${theme.backgroundOverlay ?? 0.86})` };

  return (
    /**
     * 强调色在这里注入（v1.6.0）：
     * 之前界面里的强调色全部写死在 StyleSheet 里，改「设置 → 外观 → 强调色」不会生效。
     * 现在由 AccentProvider 统一下发，各组件渲染期取色，改设置即刻生效。
     */
    <AccentProvider color={settings.accentColor}>
      <View style={styles.root}>
        {theme.backgroundImage ? (
          <CroppedImage
            uri={theme.backgroundImage}
            crop={theme.backgroundCrop}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {theme.backgroundImage ? <View style={[StyleSheet.absoluteFill, overlay]} /> : null}
        <View style={{ flex: 1 }}>
          {tab === 'timetable' ? <TimetableScreen /> : null}
          {tab === 'import' ? <ImportScreen /> : null}
          {tab === 'settings' ? <SettingsScreen /> : null}
        </View>
        <BottomTabs
          tabs={TABS}
          active={tab}
          onChange={setTab}
          icons={theme.tabIcons}
        />
        <StatusBar style="light" />
      </View>
    </AccentProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: palette.bg },
  root: { flex: 1, backgroundColor: palette.bg },
});
