/**
 * 主题图片的规格定义与校验（**纯函数，不依赖 React Native**）
 *
 * 单独成文件的原因：校验逻辑需要在 Node 下单测，而持久化要依赖 expo-file-system / react-native。
 * 拆开后 `validateImage` 可被真实调用路径与测试同时复用，不是复制副本。
 *
 * v1.7.0 策略调整（用户要求「扩增图片尺寸的接受范围，按指定尺寸裁剪即可使用该图片」）：
 * - **不再因为"图片小"直接拒绝**。原来最短边 <600px 一律拒绝，很多正常手机截图/裁剪图都被挡在门外；
 *   现在只保留一个"完全不可辨认"的硬下限（`minSide`），比它大的一律**可用**，只在裁剪界面里
 *   按**裁剪后的实际尺寸**给出分级提示（清晰 / 够用 / 偏小 / 很小），由用户自己决定。
 * - 体积上限 8MB → 20MB；超过 8MB 只提示"载入稍慢"。
 * - 判断"是否够用"的依据从"原图尺寸"改为"**按目标比例裁剪后的尺寸**"，
 *   因为裁剪只会变小：原图再大，裁成一条也会糊。
 */
import type { CropRect } from '../types';

export const IMAGE_SPEC = {
  /** 允许的格式（按 MIME 判断） */
  formats: ['image/jpeg', 'image/png', 'image/webp'],
  formatLabels: 'JPG / PNG / WebP',
  /** 单文件体积上限（字节）——超过直接拒绝 */
  maxBytes: 20 * 1024 * 1024,
  maxMB: 20,
  /** 超过此体积仅提示（不拒绝） */
  warnBytes: 8 * 1024 * 1024,
  warnMB: 8,
  /** **硬下限**：最短边低于此值直接拒绝（放大后完全不可辨认） */
  minSide: 120,
  /** 够用线：裁剪后最短边达到它视为"够用" */
  goodSide: 600,
  /** 推荐线：裁剪后最短边达到它视为"清晰" */
  recommendSide: 1080,
  /** 建议长边（仅用于展示"目标尺寸"） */
  recommendLongSide: 1920,
  /** 超过此长边仅提示（超大图载入偏慢） */
  warnLongSide: 8000,
  /** 建议尺寸（仅提示，不强制） */
  recommend: '1080 × 1920 或更高（竖屏）',
} as const;

export interface PickedAsset {
  uri: string;
  width?: number;
  height?: number;
  fileSize?: number;
  mimeType?: string;
  fileName?: string | null;
}

export interface ImageValidation {
  ok: boolean;
  /** 校验失败原因（面向用户） */
  reason?: string;
  /** 校验通过但值得提示的点（多条用换行连接） */
  warning?: string;
  /** 规整后的信息 */
  info?: { width: number; height: number; sizeMB: number; format: string };
}

function extFromMime(mime?: string): string {
  switch ((mime || '').toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    default:
      return '';
  }
}

/**
 * 从文件名或 MIME 推断扩展名。
 * 兜底 jpg：很多 Android 机型不返回 mimeType/fileName，此时不能判失败。
 */
export function resolveExt(asset: PickedAsset): string {
  const byMime = extFromMime(asset.mimeType);
  if (byMime) return byMime;
  const name = asset.fileName || asset.uri || '';
  const m = name.match(/\.([a-z0-9]+)(?:\?|$)/i);
  const e = m ? m[1].toLowerCase() : '';
  if (e === 'png' || e === 'webp' || e === 'jpeg' || e === 'jpg') return e === 'jpeg' ? 'jpg' : e;
  return 'jpg';
}

/** 尺寸分级：给"裁剪后能用吗"一个可读的结论 */
export type SizeGrade = 'recommended' | 'good' | 'small' | 'tiny';

export interface SizeGradeResult {
  level: SizeGrade;
  /** 面向用户的短标签 */
  label: string;
  /** 是否还值得用（tiny 也允许用，只是要明确提醒） */
  usable: boolean;
}

/** 按"裁剪后最短边"给尺寸分级（v1.7.0：判断依据是裁剪结果，不是原图） */
export function gradeImageSize(size: { width: number; height: number }): SizeGradeResult {
  const short = Math.min(size.width, size.height);
  if (short >= IMAGE_SPEC.recommendSide) {
    return { level: 'recommended', label: `清晰（最短边 ${short}px）`, usable: true };
  }
  if (short >= IMAGE_SPEC.goodSide) {
    return { level: 'good', label: `够用（最短边 ${short}px）`, usable: true };
  }
  if (short >= IMAGE_SPEC.minSide) {
    return { level: 'small', label: `偏小（最短边 ${short}px，放大后可能模糊）`, usable: true };
  }
  return { level: 'tiny', label: `很小（最短边 ${short}px，会明显模糊）`, usable: true };
}

/**
 * 按目标比例算出"建议目标尺寸"：把**短边**定在推荐值上，长边按比例推出。
 * 例如竖屏 9:19.5 → 1080 × 2340；1:1 → 1080 × 1080。
 */
export function targetSizeForAspect(aspect: number, barSide: number = IMAGE_SPEC.recommendSide): {
  width: number;
  height: number;
} {
  const a = aspect > 0 ? aspect : 9 / 16;
  const round = (n: number) => Math.max(1, Math.round(n / 2) * 2); // 取偶数更好看
  return a <= 1
    ? { width: round(barSide), height: round(barSide / a) }
    : { width: round(barSide * a), height: round(barSide) };
}

/**
 * 校验选中的图片是否符合规格；不满足时给出**具体原因**而不是静默失败。
 *
 * 拒绝只有三种情况：格式不支持、体积超上限、最短边低于硬下限。
 * 其余（偏小 / 偏大 / 横图 / 超大体积）一律**通过 + 提示**，把决定权留给用户。
 */
export function validateImage(asset: PickedAsset): ImageValidation {
  const w = asset.width ?? 0;
  const h = asset.height ?? 0;
  const bytes = asset.fileSize ?? 0;

  const ext = resolveExt(asset);
  const mime = (asset.mimeType || '').toLowerCase();
  const extOk = ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
  const mimeOk = !mime || (IMAGE_SPEC.formats as readonly string[]).includes(mime);
  if (!extOk || !mimeOk) {
    return {
      ok: false,
      reason: `格式不支持：${asset.mimeType || ext || '未知'}。请用 ${IMAGE_SPEC.formatLabels}。`,
    };
  }

  if (bytes > IMAGE_SPEC.maxBytes) {
    return {
      ok: false,
      reason: `图片 ${(bytes / 1048576).toFixed(1)}MB，超过上限 ${IMAGE_SPEC.maxMB}MB。请先压缩或裁剪。`,
    };
  }

  // 硬下限：小到这个程度放大后完全不可辨认，直接拒绝并说清要求
  if (w > 0 && h > 0 && (w < IMAGE_SPEC.minSide || h < IMAGE_SPEC.minSide)) {
    return {
      ok: false,
      reason: `图片 ${w}×${h} 太小（最短边需 ≥ ${IMAGE_SPEC.minSide}px），放大后无法辨认。`,
    };
  }

  const notes: string[] = [];
  if (bytes > IMAGE_SPEC.warnBytes) {
    notes.push(`图片 ${(bytes / 1048576).toFixed(1)}MB，较大，载入可能稍慢。`);
  }
  if (w > 0 && h > 0) {
    const short = Math.min(w, h);
    const long = Math.max(w, h);
    if (short < IMAGE_SPEC.goodSide) {
      notes.push(
        `原图最短边 ${short}px 偏小：裁剪后请尽量保留更大范围（建议 ≥ ${IMAGE_SPEC.goodSide}px），否则放大后可能模糊。`,
      );
    }
    if (w >= h) {
      notes.push('当前是横图，用作竖屏背景需要裁剪成竖图，建议先在裁剪界面选「全屏（推荐）」。');
    }
    if (long > IMAGE_SPEC.warnLongSide) {
      notes.push(`图片长边 ${long}px 很大，处理与显示可能变慢。`);
    }
  } else {
    notes.push('未能读取图片尺寸，若显示模糊请换用更大的图片。');
  }

  return {
    ok: true,
    warning: notes.length ? notes.join('\n') : undefined,
    info: { width: w, height: h, sizeMB: bytes / 1048576, format: ext.toUpperCase() },
  };
}

/**
 * 从「原图尺寸 + 已选裁剪矩形」直接算出裁剪后的像素尺寸。
 * （与 `utils/crop.ts` 的 `croppedSize` 同义，放在这里是为了让规格相关的判断
 *   全部集中在本文件，便于单测与阅读。）
 */
export function croppedPixelSize(
  rect: CropRect | null | undefined,
  source: { width: number; height: number },
): { width: number; height: number } {
  const r = rect ?? { x: 0, y: 0, w: 1, h: 1 };
  return {
    width: Math.max(1, Math.round(r.w * source.width)),
    height: Math.max(1, Math.round(r.h * source.height)),
  };
}
