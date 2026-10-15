import React, { useState } from 'react';
import {
  Image,
  ImageResizeMode,
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { CropEntry } from '../types';
import { layoutForCrop } from '../utils/crop';

/**
 * 按裁剪记录渲染图片（v1.6.0）。
 *
 * 做法：把「裁剪区域」以 cover 方式铺满容器——容器 `overflow:hidden`，
 * 内部图片按 `layoutForCrop()` 算出的绝对定位摆放，等效于「先按用户的裁剪框裁好，再铺满屏幕」。
 * 容器尺寸通过 `onLayout` 实测（不硬编码），因此横竖屏、不同机型都成立。
 *
 * 未提供裁剪记录时退化为普通 `resizeMode="cover"`，与旧版本行为一致。
 */
export function CroppedImage({
  uri,
  crop,
  style,
  resizeMode = 'cover',
}: {
  uri: string;
  /** 裁剪记录（null = 未裁剪，按 cover 处理） */
  crop?: CropEntry | null;
  style?: StyleProp<ViewStyle>;
  resizeMode?: ImageResizeMode;
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== box.w || height !== box.h) setBox({ w: width, h: height });
  };

  const layout = layoutForCrop(crop?.rect, crop?.source, box.w, box.h);

  return (
    <View style={[styles.box, style]} onLayout={onLayout}>
      {layout ? (
        <Image
          source={{ uri }}
          // 尺寸已按原图比例算好，stretch 不会变形（避免 cover 再裁一次）
          resizeMode="stretch"
          style={{
            position: 'absolute',
            left: layout.left,
            top: layout.top,
            width: layout.width,
            height: layout.height,
          }}
        />
      ) : (
        // 尚未实测到容器尺寸：先按 cover 占位，避免闪白
        <Image source={{ uri }} resizeMode={resizeMode} style={StyleSheet.absoluteFill} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
});
