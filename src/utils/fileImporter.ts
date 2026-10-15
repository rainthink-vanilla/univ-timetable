/**
 * 课表文件导入 / 导出
 *
 * 复用 Expo 已内置的 expo-file-system（SDK 54 起 File.pickFileAsync 提供系统文件选择器），
 * 因此**不需要**额外安装 expo-document-picker 等原生模块。
 *
 * 注意：expo-file-system 是 expo 包的依赖（可能被提升到顶层，也可能嵌套在
 * expo/node_modules 下），所以这里用运行时 require 而不是顶层 import，
 * 避免在未重编译的旧 APK 上因模块缺失导致整个界面白屏。
 */
import { ParsedCourseInput, Period, TimetableMeta } from '../types';
import { buildTimetableMarkdown, parseTimetableFile, ParsedTimetableFile } from './timetableFile';

export type FileImportErrorKind = 'no-picker' | 'canceled' | 'unreadable' | 'empty' | 'unknown';

export interface PickResult {
  ok: boolean;
  canceled?: boolean;
  kind?: FileImportErrorKind;
  message?: string;
  /** 文件名 */
  fileName?: string;
  /** 文件大小（字节） */
  size?: number;
  /** 解析结果 */
  parsed?: ParsedTimetableFile;
}

interface PickedFile {
  name?: string;
  size?: number;
  text: () => Promise<string>;
}

function loadFileSystem(): { File?: { pickFileAsync?: (uri?: string, mime?: string) => Promise<unknown> } } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-file-system');
    if (mod && typeof mod === 'object') return mod as never;
  } catch {
    /* 旧包可能只暴露 legacy 入口 */
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('expo-file-system/legacy');
      if (mod && typeof mod === 'object') return mod as never;
    } catch {
      return null;
    }
  }
  return null;
}

/** 弹出系统文件选择器并解析选中的课表文件 */
export async function pickTimetableFile(): Promise<PickResult> {
  const fs = loadFileSystem();
  const picker = fs && fs.File && fs.File.pickFileAsync;
  if (typeof picker !== 'function') {
    return {
      ok: false,
      kind: 'no-picker',
      message:
        '当前安装的 App 版本还不支持「选择文件」导入（需要重新构建 APK）。\n' +
        '可以先用「粘贴 JSON」方式导入：把 .md 文件里的 ```json 代码块内容复制到设置页的「导入课表 (JSON)」。',
    };
  }

  let picked: unknown;
  try {
    picked = await picker.call(fs!.File, undefined, '*/*');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel|dismiss/i.test(msg)) return { ok: false, canceled: true };
    return { ok: false, kind: 'unknown', message: '打开文件选择器失败：' + msg };
  }
  if (!picked) return { ok: false, canceled: true };

  const file = (Array.isArray(picked) ? picked[0] : picked) as PickedFile | undefined;
  if (!file || typeof file.text !== 'function') return { ok: false, canceled: true };

  let content = '';
  try {
    content = await file.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, kind: 'unreadable', message: '读取文件失败：' + msg };
  }
  if (!content.trim()) {
    return { ok: false, kind: 'empty', message: '文件内容为空' };
  }

  const parsed = parseTimetableFile(content);
  return {
    ok: true,
    fileName: file.name || '未命名文件',
    size: typeof file.size === 'number' ? file.size : undefined,
    parsed,
  };
}

export interface ExportResult {
  ok: boolean;
  message?: string;
  uri?: string;
}

/** 把当前课表导出为 .md 文件并调起系统分享 */
export async function exportTimetableFile(
  meta: TimetableMeta,
  courses: ParsedCourseInput[],
  periods?: Period[],
): Promise<ExportResult> {
  const md = buildTimetableMarkdown({ meta, courses, periods });
  const fs = loadFileSystem() as
    | {
        Paths?: { cache?: unknown };
        File?: new (...args: unknown[]) => {
          uri: string;
          create: (o?: { overwrite?: boolean; intermediates?: boolean }) => void;
          write: (s: string) => void;
        };
      }
    | null;
  if (!fs || !fs.File || !fs.Paths || !fs.Paths.cache) {
    return { ok: false, message: '当前版本不支持写入文件，请改用「导出 JSON」后复制文本。' };
  }
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const file = new fs.File(fs.Paths.cache, `课表-${stamp}.md`);
    try {
      file.create({ overwrite: true, intermediates: true });
    } catch {
      /* 已存在时忽略 */
    }
    file.write(md);
    const { Share } = require('react-native') as { Share: { share: (o: { message?: string; title?: string; url?: string }) => Promise<unknown> } };
    await Share.share({ title: '大学课表导出', url: file.uri, message: md });
    return { ok: true, uri: file.uri };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: '导出失败：' + msg };
  }
}
