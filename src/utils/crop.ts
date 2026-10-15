/**
 * 主题图片裁剪的**几何计算**（纯函数，不依赖 React Native，可在 Node 下单测）
 *
 * 设计取舍（为什么不做像素级裁剪）：
 * 1. 本项目坚持「零额外原生模块」——加 `expo-image-manipulator` 会引入新的原生依赖与
 *    构建风险（本机无 Android SDK，只能 EAS 云构建，失败代价高），且 Web 端行为不一致；
 * 2. 存「裁剪矩形 + 原图尺寸」而非裁剪后的像素文件，带来三个好处：
 *    - **原图不被破坏**，随时可重新裁剪，且反复裁剪不累积画质损失（JPG 每次重编码都会掉画质）；
 *    - 换设备/横竖屏时按容器比例重新等比铺满，不会出现「裁好的图在别的屏幕上被二次裁掉」；
 *    - 不需要读回图片像素，Web 与 Android 行为完全一致，可被无头浏览器验证。
 *
 * 坐标系约定：
 * - `CropRect` 用**归一化**坐标（0~1），相对原图左上角；
 * - 变换 `Transform` 描述图片在**预览框**（frame）里的显示：图片左上角相对预览框左上角的
 *   偏移（offsetX/offsetY，通常为负）+ 显示缩放比 scale（显示像素 / 原图像素）。
 */
import { CropRect } from '../types';

export interface SourceSize {
  width: number;
  height: number;
}

/** 预览框内的图片变换 */
export interface CropTransform {
  /** 显示缩放比：显示像素 / 原图像素 */
  scale: number;
  /** 图片左上角相对预览框左上角的偏移（px，通常 ≤ 0） */
  offsetX: number;
  offsetY: number;
}

/** 未裁剪（整图） */
export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

/** 相对最小缩放的最大放大倍数 */
export const MAX_ZOOM = 6;

/** 裁剪矩形的最小边长占比（防止裁成一条线） */
export const MIN_CROP_SPAN = 0.02;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 原图尺寸是否可用于计算（宽高都必须是正数） */
export function isUsableSource(src?: SourceSize | null): src is SourceSize {
  return !!src && isNum(src.width) && isNum(src.height) && src.width > 0 && src.height > 0;
}

/** 校验并规整裁剪矩形：非法/不可用返回 null */
export function normalizeCropRect(input?: Partial<CropRect> | null): CropRect | null {
  if (!input) return null;
  const { x, y, w, h } = input;
  if (!isNum(x) || !isNum(y) || !isNum(w) || !isNum(h)) return null;
  const nx = clamp(x, 0, 1);
  const ny = clamp(y, 0, 1);
  const nw = clamp(w, MIN_CROP_SPAN, 1 - nx);
  const nh = clamp(h, MIN_CROP_SPAN, 1 - ny);
  if (nw <= 0 || nh <= 0) return null;
  return { x: nx, y: ny, w: nw, h: nh };
}

/** 裁剪矩形是否等同于整图（无需裁剪） */
export function isFullCrop(rect?: CropRect | null): boolean {
  if (!rect) return true;
  const r = normalizeCropRect(rect);
  if (!r) return true;
  return r.x <= 0.001 && r.y <= 0.001 && r.w >= 0.999 && r.h >= 0.999;
}

/** 裁剪后的有效像素尺寸（用于「裁剪后 1080×1920」提示与规格校验） */
export function croppedSize(rect: CropRect, src: SourceSize): SourceSize {
  const r = normalizeCropRect(rect) ?? FULL_CROP;
  return { width: Math.round(r.w * src.width), height: Math.round(r.h * src.height) };
}

/** 图片以 cover 方式铺满预览框所需的缩放（scale 的下限） */
export function minScale(src: SourceSize, frameW: number, frameH: number): number {
  return Math.max(frameW / src.width, frameH / src.height);
}

/**
 * 把变换钳制到合法范围。
 *
 * 约束只有一条：**图片必须始终盖住裁剪框**（`offsetX ∈ [frameW - 图宽, 0]`）。
 * 注意这里约束的是**整张原图**，不是"当前裁剪框"——
 * 若按后者约束，缩小后裁剪框正好铺满预览框，可拖动余量恒为 0，
 * 表现为「放大后怎么拖都不动」（v1.6.0 实现过程中实际踩到的坑）。
 * 放宽到整图还有一个好处：原图始终保留，用户可以反向把裁剪范围拉大。
 *
 * @param maxScale 自定义缩放上限（默认 = 最小缩放 × MAX_ZOOM）；
 *                 重新裁剪一张很小的旧裁剪区域时，初始缩放可能已超过默认上限，需要放宽。
 */
export function clampTransform(
  t: CropTransform,
  src: SourceSize,
  frameW: number,
  frameH: number,
  maxScale?: number,
): CropTransform {
  const sMin = minScale(src, frameW, frameH);
  const sMax = Math.max(maxScale ?? 0, sMin * MAX_ZOOM);
  const scale = clamp(t.scale, sMin, sMax);
  const offsetX = clamp(t.offsetX, frameW - src.width * scale, 0);
  const offsetY = clamp(t.offsetY, frameH - src.height * scale, 0);
  return { scale, offsetX, offsetY };
}

/** 初始变换：让给定裁剪区域**正好**铺满预览框（用于打开/重开裁剪器） */
export function transformForCrop(
  rect: CropRect,
  src: SourceSize,
  frameW: number,
  frameH: number,
): CropTransform {
  const r = normalizeCropRect(rect) ?? FULL_CROP;
  const s = Math.max(frameW / (r.w * src.width), frameH / (r.h * src.height));
  const cx = (r.x + r.w / 2) * src.width * s;
  const cy = (r.y + r.h / 2) * src.height * s;
  return clampTransform({ scale: s, offsetX: frameW / 2 - cx, offsetY: frameH / 2 - cy }, src, frameW, frameH, s);
}

/** 由当前变换反算「预览框里实际可见的原图区域」——即用户最终得到的裁剪结果 */
export function rectFromTransform(
  t: CropTransform,
  src: SourceSize,
  frameW: number,
  frameH: number,
): CropRect {
  const s = t.scale > 0 ? t.scale : 1;
  const x = -t.offsetX / (src.width * s);
  const y = -t.offsetY / (src.height * s);
  const w = frameW / (src.width * s);
  const h = frameH / (src.height * s);
  return normalizeCropRect({ x, y, w, h }) ?? FULL_CROP;
}

/** 渲染布局：把裁剪区域以 cover 方式铺满容器时，图片的定位与尺寸 */
export interface CropLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 计算「裁剪区域铺满容器」时图片的绝对定位（供 CroppedImage 渲染）。
 * 容器宽高比与裁剪区域宽高比不一致时按 cover 处理（多出来的部分裁掉），
 * 因此同一张裁剪图在不同屏幕上都表现为「填满且不变形」。
 */
export function layoutForCrop(
  rect: CropRect | null | undefined,
  src: SourceSize | null | undefined,
  boxW: number,
  boxH: number,
): CropLayout | null {
  if (!isUsableSource(src) || !(boxW > 0) || !(boxH > 0)) return null;
  const r = normalizeCropRect(rect) ?? FULL_CROP;
  const cropW = r.w * src.width;
  const cropH = r.h * src.height;
  const scale = Math.max(boxW / cropW, boxH / cropH);
  const width = src.width * scale;
  const height = src.height * scale;
  return {
    left: boxW / 2 - (r.x * src.width + cropW / 2) * scale,
    top: boxH / 2 - (r.y * src.height + cropH / 2) * scale,
    width,
    height,
  };
}

/** 裁剪结果是否仍满足「最短边 ≥ minSide」的规格要求 */
export function cropMeetsMinSide(cropped: SourceSize, minSide: number): boolean {
  return Math.min(cropped.width, cropped.height) >= minSide;
}

/** 在给定区域内取一个指定宽高比（w/h）的最大居中矩形——即预览框尺寸 */
export function fitBox(areaW: number, areaH: number, aspect: number): SourceSize {
  if (!(areaW > 0) || !(areaH > 0) || !(aspect > 0)) return { width: 0, height: 0 };
  const byWidth = { width: areaW, height: areaW / aspect };
  return byWidth.height <= areaH ? byWidth : { width: areaH * aspect, height: areaH };
}
