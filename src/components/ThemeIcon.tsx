import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { CropEntry } from '../types';
import { CroppedImage } from './CroppedImage';
import { palette } from '../theme';

/**
 * 应用内图标：优先用自定义图片，其次自定义 emoji，最后回退到默认 emoji。
 *
 * 图片可带裁剪记录（v1.6.0）：图标框固定正方形，裁剪结果按 cover 铺满。
 *
 * 注意：这里渲染的是**应用内**的图标（底部标签栏、标题等）。
 * 手机桌面上的启动器图标由安装包决定，运行期无法更换。
 */
export function ThemeIcon({
  uri,
  emoji,
  fallback,
  size = 18,
  crop,
}: {
  uri?: string | null;
  emoji?: string | null;
  fallback: string;
  size?: number;
  /** 图标裁剪记录（v1.6.0） */
  crop?: CropEntry | null;
}) {
  if (uri) {
    return (
      <CroppedImage
        uri={uri}
        crop={crop}
        style={{ width: size, height: size, borderRadius: size / 6 }}
      />
    );
  }
  return (
    <Text style={[styles.emoji, { fontSize: size, lineHeight: size + 4 }]}>{emoji || fallback}</Text>
  );
}

const styles = StyleSheet.create({
  emoji: { color: palette.text, textAlign: 'center' },
});
