import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CropEntry, CropRect } from '../types';
import {
  CropTransform,
  FULL_CROP,
  clampTransform,
  croppedSize,
  fitBox,
  isFullCrop,
  isUsableSource,
  rectFromTransform,
  transformForCrop,
} from '../utils/crop';
import { IMAGE_SPEC, gradeImageSize, targetSizeForAspect } from '../utils/imageSpec';
import { Button } from './ui';
import { font, palette, radius, spacing } from '../theme';
import { useAccent } from '../store/AccentContext';

/**
 * 图片裁剪弹层（v1.6.0）。
 *
 * 交互：图片在**固定比例的裁剪框**里拖动 / 缩放，框内所见即为结果，
 * 与系统相册的裁剪体验一致；不同之处是**不破坏原图**——只记录裁剪矩形，
 * 因此随时可以「重新裁剪」，反复裁剪也不会像 JPG 重编码那样累积画质损失。
 *
 * 硬约束：`clampTransform()` 保证裁剪框内**始终被图片完全覆盖**，不会裁出黑边。
 */
export interface AspectOption {
  key: string;
  label: string;
  /** 宽高比 w/h；`null` 表示跟随屏幕比例（背景图推荐） */
  value: number | null;
}

export function CropModal({
  visible,
  uri,
  source,
  initialCrop,
  kind,
  aspects,
  titleOverride,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  uri: string;
  /** 原图像素尺寸；不可用时裁剪器会提示并直接按原图使用 */
  source: { width: number; height: number } | null;
  initialCrop?: CropEntry | null;
  kind: 'background' | 'icon';
  /** 可选比例；为空时固定 1:1（图标） */
  aspects?: AspectOption[];
  /** 自定义标题（按标签裁剪图标时用「裁剪图标 · 课表」这类文案） */
  titleOverride?: string;
  onCancel: () => void;
  onConfirm: (entry: CropEntry) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { accent } = useAccent();

  const options: AspectOption[] = useMemo(
    () => (aspects?.length ? aspects : [{ key: 'square', label: '1:1', value: 1 }]),
    [aspects],
  );

  /** 预览可用区域（实测） */
  const [area, setArea] = useState({ w: 0, h: 0 });
  /** 当前比例选项 */
  const [aspectKey, setAspectKey] = useState(options[0].key);

  const aspect = useMemo(() => {
    const opt = options.find((o) => o.key === aspectKey) ?? options[0];
    if (opt.value != null) return opt.value;
    // 跟随屏幕比例（背景图铺满屏幕时最合理）
    return winW > 0 && winH > 0 ? winW / winH : 9 / 16;
  }, [aspectKey, winW, winH, options]);

  const frame = useMemo(() => fitBox(area.w, area.h, aspect), [area.w, area.h, aspect]);

  const [tf, setTf] = useState<CropTransform | null>(null);
  /** 当前裁剪矩形（唯一真源：只在交互里更新，避免与渲染派生值互相打架） */
  const rectRef = useRef<CropRect>(initialCrop?.rect ?? FULL_CROP);
  const tfRef = useRef<CropTransform | null>(null);
  const frameRef = useRef(frame);
  const startRef = useRef<{
    tf: CropTransform | null;
    pinch: number | null;
    /** 双指中点（用于"捏合的同时拖动"） */
    mid: { x: number; y: number } | null;
  }>({ tf: null, pinch: null, mid: null });
  const applyRef = useRef<(t: CropTransform) => void>(() => {});
  /**
   * 缩放上限：默认 = 最小缩放 × MAX_ZOOM，但重新裁剪一个很小的旧区域时，
   * 初始缩放可能已经超过该上限，故取两者较大值（否则打开就被压回去，所见与已存裁剪不符）。
   */
  const scaleLimitRef = useRef(0);

  // 打开或预览框尺寸变化（含切换比例）时，按当前裁剪矩形重新铺满
  useEffect(() => {
    if (!visible) return;
    if (!(frame.width > 0) || !(frame.height > 0) || !isUsableSource(source)) return;
    const next = transformForCrop(rectRef.current, source, frame.width, frame.height);
    scaleLimitRef.current = next.scale; // 允许缩放上限至少覆盖"当前所见"，避免打开即被压缩
    setTf(next);
    tfRef.current = next;
    // 依赖项故意只取尺寸与开关：中途拖动不应触发重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, frame.width, frame.height, source?.width, source?.height]);

  // 每次重新打开都从已有裁剪（或整图）开始
  useEffect(() => {
    if (visible) rectRef.current = initialCrop?.rect ?? FULL_CROP;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  frameRef.current = frame;
  tfRef.current = tf;

  /** 应用一次变换（自动钳制：图片始终盖住裁剪框，不会露出黑边） */
  const apply = (next: CropTransform) => {
    if (!isUsableSource(source)) return;
    const f = frameRef.current;
    const clamped = clampTransform(next, source, f.width, f.height, scaleLimitRef.current);
    setTf(clamped);
    tfRef.current = clamped;
    rectRef.current = rectFromTransform(clamped, source, f.width, f.height);
  };
  applyRef.current = apply;

  /** 以裁剪框中心为基准缩放 */
  const zoomBy = (ratio: number) => {
    const cur = tfRef.current;
    const f = frameRef.current;
    if (!cur || !(f.width > 0)) return;
    const cx = f.width / 2;
    const cy = f.height / 2;
    apply({
      scale: cur.scale * ratio,
      offsetX: cx - (cx - cur.offsetX) * ratio,
      offsetY: cy - (cy - cur.offsetY) * ratio,
    });
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // 裁剪手势一旦开始就不让父级抢走（否则双指缩放会被上层滚动/返回手势打断）
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = { tf: tfRef.current, pinch: null, mid: null };
      },
      onPanResponderMove: (evt, g) => {
        const cur = tfRef.current;
        if (!cur) return;
        const touches = (evt.nativeEvent as {
          touches?: { pageX: number; pageY: number; clientX?: number; clientY?: number }[];
        }).touches;
        if (touches && touches.length >= 2) {
          // 双指捏合缩放（v1.7.0：同时支持"捏合 + 拖动"）
          const d = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
          const mid = {
            x: (touches[0].pageX + touches[1].pageX) / 2,
            y: (touches[0].pageY + touches[1].pageY) / 2,
          };
          const st = startRef.current;
          if (st.pinch == null || st.tf == null || st.mid == null) {
            startRef.current = { tf: cur, pinch: d, mid };
            return;
          }
          const ratio = d / st.pinch;
          // 以裁剪框中心为锚点缩放，再把"两指中点的位移"叠加为平移
          const f = frameRef.current;
          const cx = f.width / 2;
          const cy = f.height / 2;
          applyRef.current({
            scale: st.tf.scale * ratio,
            offsetX: cx - (cx - st.tf.offsetX) * ratio + (mid.x - st.mid.x),
            offsetY: cy - (cy - st.tf.offsetY) * ratio + (mid.y - st.mid.y),
          });
          return;
        }
        // 单指拖动（以手势开始时的位置为基准，避免抖动累积）
        const base = startRef.current.tf ?? cur;
        applyRef.current({
          scale: base.scale,
          offsetX: base.offsetX + g.dx,
          offsetY: base.offsetY + g.dy,
        });
      },
    }),
  ).current;

  const canCrop = isUsableSource(source) && frame.width > 0;
  const rect: CropRect = canCrop && tf ? rectFromTransform(tf, source, frame.width, frame.height) : rectRef.current;
  const outSize = isUsableSource(source) ? croppedSize(rect, source) : null;
  /** 尺寸分级（v1.7.0：按"裁剪后"的实际尺寸判定，不再因为原图小就拒绝） */
  const grade = outSize ? gradeImageSize(outSize) : null;
  /** 当前比例下的建议目标尺寸 */
  const target = targetSizeForAspect(aspect);

  const confirm = () => {
    if (!isUsableSource(source)) {
      onConfirm({ rect: FULL_CROP, source: { width: 0, height: 0 } });
      return;
    }
    onConfirm({ rect, source: { width: source.width, height: source.height } });
  };

  const resetCrop = () => {
    rectRef.current = initialCrop?.rect ?? FULL_CROP;
    const f = frameRef.current;
    if (isUsableSource(source)) apply(transformForCrop(rectRef.current, source, f.width, f.height));
  };

  const onAreaLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== area.w || height !== area.h) setArea({ w: width, h: height });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View
        style={[
          styles.root,
          { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md },
        ]}
      >
        {/* 顶部标题 */}
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {titleOverride ?? (kind === 'background' ? '裁剪背景图' : '裁剪图标')}
            </Text>
            <Text style={styles.subtitle}>拖动移动，双指捏合缩放（可同时拖动），或用 ＋ / － 按钮</Text>
          </View>
          <Pressable onPress={onCancel} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        {/* 预览区：图片在裁剪框内平移缩放 */}
        <View style={styles.stage} onLayout={onAreaLayout}>
          {frame.width > 0 ? (
            <View
              style={[styles.frame, { width: frame.width, height: frame.height }]}
              {...pan.panHandlers}
              accessibilityLabel="裁剪预览框"
            >
              {tf && isUsableSource(source) ? (
                <Image
                  source={{ uri }}
                  resizeMode="stretch"
                  style={{
                    position: 'absolute',
                    left: tf.offsetX,
                    top: tf.offsetY,
                    width: source.width * tf.scale,
                    height: source.height * tf.scale,
                  }}
                />
              ) : (
                <Image source={{ uri }} resizeMode="cover" style={StyleSheet.absoluteFill} />
              )}
              {/* 三分构图参考线（纯视觉，不参与计算） */}
              <View style={[styles.guide, { left: '33.33%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
              <View style={[styles.guide, { left: '66.66%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
              <View style={[styles.guide, { top: '33.33%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
              <View style={[styles.guide, { top: '66.66%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
              <View style={[styles.corner, styles.cornerTL, { borderColor: accent }]} />
              <View style={[styles.corner, styles.cornerTR, { borderColor: accent }]} />
              <View style={[styles.corner, styles.cornerBL, { borderColor: accent }]} />
              <View style={[styles.corner, styles.cornerBR, { borderColor: accent }]} />
            </View>
          ) : null}
        </View>

        {/* 比例选择（背景图；图标固定 1:1 时不显示） */}
        {options.length > 1 ? (
          <View style={styles.aspectRow}>
            {options.map((o) => {
              const on = o.key === aspectKey;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => setAspectKey(o.key)}
                  style={[styles.aspectChip, on && { backgroundColor: accent, borderColor: accent }]}
                >
                  <Text style={[styles.aspectText, on && styles.aspectTextOn]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* 缩放控制 + 结果信息 */}
        <View style={styles.zoomRow}>
          <Pressable onPress={() => zoomBy(1 / 1.2)} style={styles.zoomBtn} accessibilityLabel="缩小">
            <Text style={styles.zoomText}>－</Text>
          </Pressable>
          <Pressable onPress={() => zoomBy(1.2)} style={styles.zoomBtn} accessibilityLabel="放大">
            <Text style={styles.zoomText}>＋</Text>
          </Pressable>
          <Pressable onPress={resetCrop} style={styles.resetBtn}>
            <Text style={styles.resetText}>重置</Text>
          </Pressable>
          {outSize ? (
            <Text style={styles.info}>
              裁剪后 {outSize.width} × {outSize.height}
            </Text>
          ) : null}
        </View>

        {/* 规格提示：目标尺寸 + 裁剪后分级评价（v1.7.0） */}
        {!isUsableSource(source) ? (
          <Text style={styles.warn}>⚠️ 未能读取图片尺寸，无法裁剪，将按原图使用。</Text>
        ) : (
          <>
            <Text style={styles.target}>
              该比例建议 ≥ {target.width} × {target.height}
              {outSize ? `　|　当前裁剪后 ${outSize.width} × ${outSize.height}` : ''}
            </Text>
            {grade && grade.level !== 'recommended' ? (
              <Text style={styles.warn}>
                {grade.level === 'good' ? 'ℹ️ ' : '⚠️ '}
                {grade.label}
                {grade.level === 'good'
                  ? '，正常使用没问题。'
                  : '。可点「重置」或缩小裁剪范围（往外拉）来保留更多像素。'}
              </Text>
            ) : isFullCrop(rect) ? (
              <Text style={styles.hint}>
                ✅ {grade?.label ?? ''}　当前未裁剪（使用整张图）。拖动或缩放即可只保留想要的部分。
              </Text>
            ) : (
              <Text style={styles.hint}>
                ✅ {grade?.label ?? ''}　结果会立即应用到
                {kind === 'background' ? '背景' : '图标'}，且不破坏原图，可随时重新裁剪。
              </Text>
            )}
          </>
        )}

        <View style={styles.actions}>
          <Button title="取消" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
          <Button title="使用这张" onPress={confirm} style={{ flex: 1 }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#05080F',
    paddingHorizontal: spacing.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  title: { color: palette.text, fontSize: font.h2, fontWeight: '800' },
  subtitle: { color: palette.textFaint, fontSize: font.tiny, marginTop: 2 },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  close: { color: palette.textDim, fontSize: 14 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md },
  frame: { overflow: 'hidden', borderRadius: radius.sm, backgroundColor: '#000' },
  guide: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.22)' },
  corner: { position: 'absolute', width: 16, height: 16, borderWidth: 3 },
  cornerTL: { left: 0, top: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: radius.sm },
  cornerTR: { right: 0, top: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: radius.sm },
  cornerBL: { left: 0, bottom: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: radius.sm },
  cornerBR: { right: 0, bottom: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: radius.sm },
  aspectRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.sm },
  aspectChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  aspectText: { color: palette.textDim, fontSize: font.tiny, fontWeight: '600' },
  aspectTextOn: { color: '#fff' },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  zoomBtn: {
    width: 40,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: palette.surfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomText: { color: palette.text, fontSize: 20, lineHeight: 22 },
  resetBtn: {
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetText: { color: palette.textDim, fontSize: font.small, fontWeight: '600' },
  info: { color: palette.textDim, fontSize: font.tiny, marginLeft: 'auto' },
  target: { color: palette.textDim, fontSize: font.tiny, lineHeight: 16, marginTop: spacing.sm },
  warn: { color: '#F59E0B', fontSize: font.tiny, lineHeight: 16, marginTop: spacing.xs },
  hint: { color: palette.textFaint, fontSize: font.tiny, lineHeight: 16, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
});
