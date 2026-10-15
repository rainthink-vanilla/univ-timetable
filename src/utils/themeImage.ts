/**
 * 自定义主题：背景图 / 应用内图标 的持久化与主题读写
 *
 * 设计要点：
 * 1. **图片必须复制进应用目录**。相册返回的 URI（尤其 Android 的 content:// 或缓存路径）
 *    可能在用户清理相册/缓存后失效，直接把 URI 存进设置会导致背景图某天突然消失。
 *    这里统一复制到 Paths.document，并把副本 URI 写入设置。
 * 2. **规格校验在 imageSpec.ts**（纯函数、可单测），这里只做持久化与读写。
 * 3. expo-file-system 用**运行时 require + 能力检测**：SDK 54 的根入口是新 API
 *    （File/Directory/Paths），legacy 入口调用即抛错，因此不能用 legacy 方法。
 */
import { Platform } from 'react-native';
import { AppSettings, CropEntry, TabIconSetting, ThemeImage } from '../types';
import { TAB_KEYS } from '../constants';
import { resolveExt, type PickedAsset } from './imageSpec';
import { isUsableSource, normalizeCropRect } from './crop';

// 规格与校验从纯模块再导出，调用方只需 import 本文件
export { IMAGE_SPEC, validateImage, resolveExt } from './imageSpec';
export type { PickedAsset, ImageValidation } from './imageSpec';

/* ------------------------------------------------------------------ */
/* 持久化                                                              */
/* ------------------------------------------------------------------ */

interface FsModule {
  Paths?: { document?: unknown; cache?: unknown };
  File?: new (...args: unknown[]) => {
    uri: string;
    exists?: boolean;
    create?: (o?: { overwrite?: boolean; intermediates?: boolean }) => void;
    copy?: (dest: unknown) => void;
    delete?: () => void;
  };
  Directory?: new (...args: unknown[]) => {
    uri: string;
    exists?: boolean;
    create?: (o?: { intermediates?: boolean; idempotent?: boolean }) => void;
  };
}

function loadFs(): FsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('expo-file-system');
    if (m && typeof m === 'object' && m.File && m.Paths) return m as FsModule;
  } catch {
    /* 模块缺失：Web 或旧包 */
  }
  return null;
}

/** 应用内主题图片目录 */
const THEME_DIR = 'theme';

/**
 * 把选中的图片复制进应用目录并返回持久 URI。
 * 失败时回退为原 URI（至少本次会话可用），并给出提示由调用方决定是否展示。
 *
 * @param prefix 文件名前缀（background / icon-<标签>），仅用于区分文件用途
 *
 * ⚠️ 所有 fs 访问都必须在 try 内（v1.6.0 修复）：
 * Web 上 `require('expo-file-system')` 会返回"不支持"的存根，而 **读取 `Paths.document`
 * 这个 getter 本身就会抛异常**。原先这句写在 try 外面，异常一路冒泡到调用方，
 * 导致「用户确认了裁剪，但图片与裁剪记录都没写进设置」——静默丢结果。
 */
export async function persistThemeImage(
  asset: PickedAsset,
  prefix: string,
): Promise<{ uri: string; persisted: boolean; message?: string }> {
  /** 平台差异的提示文案（Web 不复制是正常行为，不是错误） */
  const fallbackMessage =
    Platform.OS === 'web'
      ? '网页版不会复制图片，将直接引用所选图片（手机上会复制保存，避免相册清理后失效）。'
      : '当前环境不支持复制图片，将直接引用原图。';

  try {
    const fs = loadFs();
    if (!fs) return { uri: asset.uri, persisted: false, message: fallbackMessage };
    // 注意：Paths.document 在 Web 上是会抛错的 getter，必须放在 try 内
    const documentDir = fs.Paths?.document;
    if (!documentDir || !fs.File || !fs.Directory) {
      return { uri: asset.uri, persisted: false, message: fallbackMessage };
    }

    const dir = new fs.Directory(documentDir, THEME_DIR);
    try {
      dir.create?.({ intermediates: true, idempotent: true });
    } catch {
      /* 已存在 */
    }
    const stamp = Date.now().toString(36);
    const target = new fs.File(dir, `${prefix}-${stamp}.${resolveExt(asset)}`);
    const src = new fs.File(asset.uri);
    if (typeof src.copy !== 'function') {
      return { uri: asset.uri, persisted: false, message: '当前版本不支持复制图片，将直接引用原图。' };
    }
    src.copy(target);
    return { uri: target.uri, persisted: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      uri: asset.uri,
      persisted: false,
      message: Platform.OS === 'web' ? fallbackMessage : `图片复制失败（${msg}），将直接引用原图。`,
    };
  }
}

/** 删除主题图片文件（换图/重置时清理，避免目录里堆垃圾） */
export function removeThemeImage(uri?: string | null): void {
  if (!uri) return;
  try {
    const fs = loadFs();
    if (!fs || !fs.File) return;
    const f = new fs.File(uri);
    if (f.exists && typeof f.delete === 'function') f.delete();
  } catch {
    /* 文件不存在或不可删，忽略 */
  }
}

/* ------------------------------------------------------------------ */
/* 主题读写                                                            */
/* ------------------------------------------------------------------ */

export const DEFAULT_THEME: ThemeImage = {
  backgroundImage: null,
  backgroundOverlay: 0.86,
  backgroundCrop: null,
  icon: null,
  iconCrop: null,
  iconEmoji: null,
  tabIcons: {},
};

/**
 * 规整一条裁剪记录：矩形非法或原图尺寸不可用一律丢弃（返回 null）。
 * 兼容旧版本设置（没有 themeCrop 字段）与手工改坏的设置。
 */
export function readCropEntry(value: unknown): CropEntry | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { rect?: unknown; source?: unknown };
  const rect = normalizeCropRect(v.rect as never);
  const src = v.source as { width?: number; height?: number } | undefined;
  if (!rect || !isUsableSource(src ? { width: src.width ?? 0, height: src.height ?? 0 } : null)) return null;
  return { rect, source: { width: (src as { width: number }).width, height: (src as { height: number }).height } };
}

/** 规整单个标签的图标设置（空对象也算合法 = 用默认图标） */
function readTabIcon(value: unknown): TabIconSetting {
  if (!value || typeof value !== 'object') return { uri: null, emoji: null, crop: null };
  const v = value as { uri?: unknown; emoji?: unknown; crop?: unknown };
  return {
    uri: typeof v.uri === 'string' && v.uri ? v.uri : null,
    emoji: typeof v.emoji === 'string' && v.emoji ? v.emoji : null,
    crop: readCropEntry(v.crop),
  };
}

/**
 * 底部三个标签各自的图标（v1.7.0）。
 * 向后兼容：旧版本只有一个图标（themeIcon / themeIconEmoji），它等价于**第一个标签**，
 * 因此这里把它作为第一个标签的初值，其余两个标签为空（用默认 emoji）。
 */
export function readTabIcons(settings: AppSettings): Record<string, TabIconSetting> {
  const legacy: TabIconSetting = {
    uri: settings.themeIcon ?? null,
    emoji: settings.themeIconEmoji ?? null,
    crop: readCropEntry(settings.themeCrop?.icon),
  };
  const out: Record<string, TabIconSetting> = {};
  TAB_KEYS.forEach((k, i) => {
    out[k] = i === 0 ? legacy : { uri: null, emoji: null, crop: null };
  });

  const stored = settings.themeTabIcons;
  if (stored && typeof stored === 'object') {
    for (const k of TAB_KEYS) {
      if (stored[k] === undefined) continue;
      out[k] = readTabIcon(stored[k]);
    }
  }
  return out;
}

/** 把设置里的主题字段规整为完整 ThemeImage（兼容缺失字段） */
export function readTheme(settings: AppSettings): ThemeImage {
  return {
    backgroundImage: settings.backgroundImage ?? null,
    backgroundOverlay:
      typeof settings.backgroundOverlay === 'number'
        ? settings.backgroundOverlay
        : DEFAULT_THEME.backgroundOverlay,
    backgroundCrop: readCropEntry(settings.themeCrop?.background),
    icon: settings.themeIcon ?? null,
    iconCrop: readCropEntry(settings.themeCrop?.icon),
    iconEmoji: settings.themeIconEmoji ?? null,
    tabIcons: readTabIcons(settings),
  };
}

/**
 * 生成「更新某个标签图标」的设置补丁。
 * 第一个标签会**同步写回旧字段**（themeIcon / themeIconEmoji），
 * 这样旧版本 App、分享导出的主题信息都还能读到它。
 */
export function tabIconPatch(
  settings: AppSettings,
  key: string,
  entry: TabIconSetting,
): Partial<AppSettings> {
  const current = settings.themeTabIcons ?? {};
  const next: Record<string, TabIconSetting> = { ...current, [key]: entry };
  const patch: Partial<AppSettings> = { themeTabIcons: next };
  if (key === TAB_KEYS[0]) {
    patch.themeIcon = entry.uri ?? null;
    patch.themeIconEmoji = entry.uri ? null : entry.emoji ?? null;
  }
  return patch;
}

/**
 * 生成「更新裁剪记录」的设置补丁。
 * 单独成函数的原因：`themeCrop` 是嵌套对象，直接展开覆盖容易把另一种图（背景/图标）
 * 的裁剪记录一起抹掉；这里显式合并，调用方不必重复这段易错逻辑。
 */
export function cropPatch(
  settings: AppSettings,
  kind: 'background' | 'icon',
  entry: CropEntry | null,
): Partial<AppSettings> {
  return {
    themeCrop: {
      background: kind === 'background' ? entry : readCropEntry(settings.themeCrop?.background),
      icon: kind === 'icon' ? entry : readCropEntry(settings.themeCrop?.icon),
    },
  };
}

/** 平台提示：启动器图标无法在运行时更换 */
export const LAUNCHER_ICON_NOTE = Platform.select({
  android:
    '手机桌面上的应用图标由安装包决定，无法在应用内更换（需重新打包 APK）。这里自定义的是应用内的图标与背景。',
  default: '桌面应用图标由安装包决定，无法在应用内更换。这里自定义的是应用内的图标与背景。',
}) as string;
