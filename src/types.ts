/** 一节课的时间段 */
export interface Period {
  /** 节次序号，从 1 开始 */
  index: number;
  /** 开始时间，如 "08:00" */
  start: string;
  /** 结束时间，如 "08:45" */
  end: string;
}

/** 一门课程（一次上课安排） */
export interface Course {
  id: string;
  /** 课程名称 */
  name: string;
  /** 教师 */
  teacher: string;
  /** 上课地点 */
  location: string;
  /** 星期几：1=周一 … 7=周日 */
  dayOfWeek: number;
  /** 开始节次（从 1 开始） */
  startPeriod: number;
  /** 结束节次（含） */
  endPeriod: number;
  /** 上课周次（升序、去重的周数字数组） */
  weeks: number[];
  /** 卡片颜色（hex） */
  color: string;
  /** 备注 */
  note?: string;
}

/**
 * 课表来源元信息（由 agent 爬取后写入文件，App 导入时一并接收）
 * 全部字段可选，缺失时不影响导入。
 */
export interface TimetableMeta {
  /** 学校名称 */
  school?: string;
  /** 教务系统地址 */
  jwcURL?: string;
  /** 学期名称，如 "2025-2026 学年第一学期" */
  semester?: string;
  /** 学期开始日期 ISO "YYYY-MM-DD" */
  semesterStart?: string;
  /** 学期总周数 */
  totalWeeks?: number;
  /** 本次爬取覆盖的周次范围，如 "1-16" */
  weekRange?: string;
  /** 爬取时间 ISO */
  scrapedAt?: string;
  /** 学生姓名 */
  student?: string;
  /** 学号 */
  studentId?: string;
  /** 爬取范围：day / week / month / all / term */
  scope?: string;
}

/** AI 服务配置（OpenAI 兼容接口） */
export interface AIProvider {
  /** 服务地址，如 https://api.deepseek.com 或 https://api.openai.com/v1 */
  baseURL: string;
  apiKey: string;
  /** 文本模型 */
  model: string;
  /** 视觉模型（用于截图识别，可留空则回退到文本模型） */
  visionModel: string;
}

/**
 * 裁剪矩形：相对原图的**归一化**坐标（0~1）。
 * 不直接改像素文件，因此原图始终保留、可随时重新裁剪且不损失画质。
 */
export interface CropRect {
  /** 左边界（0~1） */
  x: number;
  /** 上边界（0~1） */
  y: number;
  /** 宽度占比（0~1） */
  w: number;
  /** 高度占比（0~1） */
  h: number;
}

/** 一条裁剪记录：裁剪矩形 + 原图尺寸（渲染时按比例换算，无需保留原图也能算） */
export interface CropEntry {
  rect: CropRect;
  /** 原图像素尺寸（像素级裁剪提示与等比换算用） */
  source: { width: number; height: number };
}

/**
 * 单个底部标签的自定义图标（v1.7.0：三个标签都能单独换）
 * - `uri` 优先，其次 `emoji`，都没有则用标签自带的默认 emoji
 */
export interface TabIconSetting {
  /** 图标图片 URI（已复制到应用目录） */
  uri?: string | null;
  /** emoji 图标（uri 为空时使用） */
  emoji?: string | null;
  /** 图标图片的裁剪记录 */
  crop?: CropEntry | null;
}

/** 自定义主题（背景图 / 应用内图标） */
export interface ThemeImage {
  /** 背景图持久 URI（已复制到应用目录） */
  backgroundImage: string | null;
  /** 背景遮罩浓度 0~1：越大越暗、文字越清晰 */
  backgroundOverlay: number;
  /** 背景图裁剪（未裁剪为 null） */
  backgroundCrop: CropEntry | null;
  /** 自定义应用内图标（图片 URI），优先于 iconEmoji —— 旧字段，等价于第一个标签 */
  icon: string | null;
  /** 图标裁剪（未裁剪为 null） */
  iconCrop: CropEntry | null;
  /** 自定义应用内图标（emoji），icon 为空时使用 */
  iconEmoji: string | null;
  /** 底部三个标签各自的图标（key = 标签 key：timetable / import / settings） */
  tabIcons: Record<string, TabIconSetting>;
}

/** 应用设置 */
export interface AppSettings {
  ai: AIProvider;
  /** 学期开始日期（ISO "YYYY-MM-DD"），用于计算当前是第几周 */
  semesterStart: string;
  /** 学期总周数 */
  totalWeeks: number;
  /** 节次时间表 */
  periods: Period[];
  /** 强调色 */
  accentColor: string;
  /** 背景图本地 URI */
  backgroundImage: string | null;
  /** 背景遮罩浓度（自定义主题） */
  backgroundOverlay?: number;
  /** 自定义应用内图标（图片 URI） */
  themeIcon?: string | null;
  /** 自定义应用内图标（emoji） */
  themeIconEmoji?: string | null;
  /** 主题图片裁剪记录（v1.6.0）：key = background / icon */
  themeCrop?: { background?: CropEntry | null; icon?: CropEntry | null } | null;
  /** 底部三个标签各自的图标（v1.7.0，key = timetable / import / settings） */
  themeTabIcons?: Record<string, TabIconSetting> | null;
  /** 设置页是否用「分类抽屉」样式（v1.7.1）：true/undefined = 分组可折叠；false = 全部平铺展开 */
  settingsDrawer?: boolean;
  /** 是否显示灵动岛 */
  dynamicIsland: boolean;
  /** 是否启用毛玻璃效果（预留，后续视觉模型版本实现） */
  glassEnabled: boolean;
  /** 教务系统适配配置（预留，用于后续自动抓取） */
  jwc: {
    loginURL: string;
    timetableURL: string;
    note: string;
  };
  /** 最近一次由 agent 文件导入的课表来源信息 */
  meta: TimetableMeta;
}

/** 解析得到的课程（未分配 id/颜色） */
export interface ParsedCourseInput {
  name: string;
  teacher: string;
  location: string;
  dayOfWeek: number;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
  note?: string;
}
