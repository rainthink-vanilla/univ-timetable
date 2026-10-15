import { AIProvider, ParsedCourseInput } from '../types';
import { SYSTEM_PROMPT, textPrompt, imagePrompt } from './prompt';
import { coerceCourse } from '../utils/parse';

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

/** 归一化服务地址，兼容 OpenAI / DeepSeek / 通义 / Moonshot / GLM 等 */
export function normalizeBaseURL(baseURL: string): string {
  let b = (baseURL || '').trim();
  if (!b) throw new Error('请先在「设置」中配置 AI 服务地址');
  if (!/^https?:\/\//i.test(b)) b = `https://${b}`;
  b = b.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(b)) return b;
  return `${b}/chat/completions`;
}

export class AIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIError';
  }
}

async function requestContent(
  cfg: AIProvider,
  messages: ChatMessage[],
  model: string,
): Promise<string> {
  if (!cfg.apiKey) throw new AIError('请先在「设置」中填写 API Key');
  const url = normalizeBaseURL(cfg.baseURL);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        stream: false,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    throw new AIError(`网络请求失败：${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new AIError(`AI 请求失败 (HTTP ${res.status})：${text.slice(0, 300)}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AIError('AI 返回内容无法解析');
  }
  const content = (data as any)?.choices?.[0]?.message?.content;
  if (!content) throw new AIError('AI 未返回有效内容，请检查模型名与服务地址');
  return String(content);
}

/** 从内容字符串中提取 JSON 对象 */
function extractJSON(content: string): Record<string, unknown> {
  const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new AIError('AI 返回中未找到 JSON 对象');
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new AIError('AI 返回的 JSON 格式有误');
  }
}

function toCourses(content: string): ParsedCourseInput[] {
  const obj = extractJSON(content);
  const list = Array.isArray(obj) ? obj : (obj as any)?.courses;
  if (!Array.isArray(list)) throw new AIError('AI 返回格式不正确（缺少 courses 数组）');
  const out = list.map(coerceCourse).filter((c): c is ParsedCourseInput => c !== null);
  if (!out.length) throw new AIError('未能从结果中解析出有效课程');
  return out;
}

/** 解析课表文本 */
export async function parseCoursesFromText(
  cfg: AIProvider,
  text: string,
): Promise<ParsedCourseInput[]> {
  const content = await requestContent(
    cfg,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: textPrompt(text) },
    ],
    cfg.model,
  );
  return toCourses(content);
}

/** 解析课表截图（使用视觉模型） */
export async function parseCoursesFromImage(
  cfg: AIProvider,
  base64: string,
  mime: string,
  hint?: string,
): Promise<ParsedCourseInput[]> {
  const model = cfg.visionModel || cfg.model;
  const parts: ContentPart[] = [
    { type: 'text', text: imagePrompt(hint) },
    { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
  ];
  const content = await requestContent(
    cfg,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: parts },
    ],
    model,
  );
  return toCourses(content);
}
