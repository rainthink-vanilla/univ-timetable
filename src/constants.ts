import { AIProvider, AppSettings, Period } from './types';

/** 默认节次时间表（可按学校在设置中修改） */
export const DEFAULT_PERIODS: Period[] = [
  { index: 1, start: '08:00', end: '08:45' },
  { index: 2, start: '08:55', end: '09:40' },
  { index: 3, start: '10:00', end: '10:45' },
  { index: 4, start: '10:55', end: '11:40' },
  { index: 5, start: '14:00', end: '14:45' },
  { index: 6, start: '14:55', end: '15:40' },
  { index: 7, start: '16:00', end: '16:45' },
  { index: 8, start: '16:55', end: '17:40' },
  { index: 9, start: '19:00', end: '19:45' },
  { index: 10, start: '19:55', end: '20:40' },
  { index: 11, start: '20:50', end: '21:35' },
  { index: 12, start: '21:45', end: '22:30' },
];

/** 课程卡片配色 */
export const COURSE_COLORS = [
  '#6366F1',
  '#8B5CF6',
  '#0EA5E9',
  '#06B6D4',
  '#10B981',
  '#84CC16',
  '#F59E0B',
  '#F97316',
  '#EF4444',
  '#EC4899',
];

/** 强调色选项（用于设置页） */
export const ACCENT_COLORS = [
  '#6366F1',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#EC4899',
];

export const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const DAY_LABELS_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

/** 底部三个标签的 key（自定义图标按 key 存储，v1.7.0） */
export const TAB_KEYS = ['timetable', 'import', 'settings'] as const;

/** AI 服务预设 */
export const AI_PRESETS: { name: string; baseURL: string; model: string; visionModel: string }[] = [
  { name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', visionModel: '' },
  { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', visionModel: 'gpt-4o' },
  { name: 'Moonshot', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', visionModel: 'moonshot-v1-8k-vision-preview' },
  { name: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', visionModel: 'qwen-vl-plus' },
  { name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', visionModel: 'glm-4v-flash' },
];

export const DEFAULT_AI: AIProvider = {
  baseURL: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  visionModel: '',
};

export const DEFAULT_SETTINGS: AppSettings = {
  ai: DEFAULT_AI,
  semesterStart: '',
  totalWeeks: 20,
  periods: DEFAULT_PERIODS,
  accentColor: '#6366F1',
  backgroundImage: null,
  dynamicIsland: true,
  glassEnabled: false,
  jwc: {
    loginURL: '',
    timetableURL: '',
    note: '',
  },
  meta: {},
};
