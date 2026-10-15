/**
 * 课表自检（纯函数，可单测）
 *
 * 起因：用户报「周六与周日的课都挤进周六那一列」，但自动化在多种宽度下都测不出列错位，
 * 说明真凶很可能在**数据**里（星期写法没被识别、或历史数据把两天压成一天）。
 * 与其反复猜，不如给用户一个能自己跑、并把结论说清楚的自检：
 *   1. 按天统计课程数（一眼看出周日是不是空的）；
 *   2. 列出"同一天、同一时段、同名同地点"的多条（多半是"一格多天"被压平的痕迹）；
 *   3. 列出星期字段异常/无法识别的课程（渲染会落到错列或消失）；
 *   4. 针对"周六有、周日空，且两边的课看起来是同一门"给出**具体修复建议**。
 */
import { Course, Period } from '../types';
import { DAY_LABELS } from '../constants';
import { coerceDayOfWeek } from './select';
import { weeksLabel } from './select';

export type Severity = 'info' | 'warn' | 'error';

export interface CheckItem {
  severity: Severity;
  title: string;
  detail?: string;
}

export interface CourseCheckReport {
  /** 供界面直接逐行展示 */
  items: CheckItem[];
  /** 每天课程数（下标 0 = 周一 … 6 = 周日） */
  perDay: number[];
  total: number;
  /** 是否存在需要注意的问题 */
  hasProblem: boolean;
}

/** 课程的关键指纹（用于找出"看起来是同一门课"的多条） */
function fingerprint(c: Course): string {
  return [c.name, c.teacher || '', c.location || '', c.startPeriod, c.endPeriod, (c.weeks || []).join(',')].join('|');
}

export function buildCourseCheckReport(
  courses: Course[],
  opts: { periods?: Period[]; autoFixedDays?: number } = {},
): CourseCheckReport {
  const items: CheckItem[] = [];
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  let hasProblem = false;

  // ① 总数
  items.push({ severity: 'info', title: `课程总数：${courses.length} 门` });

  if (!courses.length) {
    items.push({ severity: 'warn', title: '当前没有课程', detail: '请先用「导入课表」或右下角 ＋ 添加课程。' });
    return { items, perDay, total: 0, hasProblem: true };
  }

  // ② 按天统计
  const badDay: Course[] = [];
  for (const c of courses) {
    const d = coerceDayOfWeek(c.dayOfWeek);
    if (d == null) {
      badDay.push(c);
      continue;
    }
    perDay[d - 1] += 1;
    if (d !== c.dayOfWeek) badDay.push(c);
  }
  items.push({
    severity: 'info',
    title: '按星期分布',
    detail: DAY_LABELS.map((d, i) => `${d} ${perDay[i]}`).join(' · '),
  });

  // ③ 星期字段异常
  if (badDay.length) {
    hasProblem = true;
    items.push({
      severity: 'warn',
      title: `有 ${badDay.length} 门课程的星期字段不规范（已自动按最接近的星期显示）`,
      detail: badDay
        .slice(0, 10)
        .map((c) => `${c.name}（原值 ${JSON.stringify(c.dayOfWeek)}）`)
        .join('；') + (badDay.length > 10 ? ` … 等 ${badDay.length} 门` : ''),
    });
  }

  if (opts.autoFixedDays) {
    items.push({
      severity: 'info',
      title: `本次启动已自动修正 ${opts.autoFixedDays} 门课程的星期字段`,
      detail: '历史数据里的 0 / 字符串 / 中文星期已统一成 1~7，显示位置以此为准。',
    });
  }

  // ④ 同一天、同一时段、指纹相同的多条 → 很可能是"一格多天被压平"
  const groups = new Map<string, Course[]>();
  for (const c of courses) {
    const d = coerceDayOfWeek(c.dayOfWeek) ?? 1;
    const key = `${d}#${fingerprint(c)}`;
    const arr = groups.get(key) || [];
    arr.push(c);
    groups.set(key, arr);
  }
  const dupGroups = Array.from(groups.values()).filter((g) => g.length > 1);
  if (dupGroups.length) {
    hasProblem = true;
    items.push({
      severity: 'error',
      title: `发现 ${dupGroups.length} 组「同一天 + 同一时段 + 同名同地点」的重复课程`,
      detail:
        dupGroups
          .slice(0, 5)
          .map((g) => `${DAY_LABELS[(coerceDayOfWeek(g[0].dayOfWeek) ?? 1) - 1]} 第${g[0].startPeriod}-${g[0].endPeriod}节 ${g[0].name} ×${g.length}`)
          .join('；') +
        `\n这类重复通常来自"一门课写了两天、但解析时只认了第一个星期"。` +
        `请用原始课表文件**重新导入**一次（v1.7.1 起支持「周六、周日」等写法），或删掉多余的那条。`,
    });
  }

  // ⑤ 周六有课、周日为空 → 针对性提示（正是用户报的现象）
  if (perDay[5] > 0 && perDay[6] === 0) {
    hasProblem = true;
    const satFp = new Set(
      courses.filter((c) => coerceDayOfWeek(c.dayOfWeek) === 6).map((c) => fingerprint(c)),
    );
    const suspicious = courses.filter((c) => coerceDayOfWeek(c.dayOfWeek) === 6);
    items.push({
      severity: 'warn',
      title: '周六有课、周日没有任何课程',
      detail:
        suspicious.length
          ? `周六现有：${suspicious
              .slice(0, 6)
              .map((c) => `${c.name}(第${c.startPeriod}-${c.endPeriod}节)`)
              .join('、')}\n` +
            `如果这些课**周日也上**，说明原始文件里那门课只写了周六（或"周六、周日"没被识别）。\n` +
            `建议：① 用原始 .md 文件重新导入一次；② 或在课表页点该课程 → 编辑 → 勾上「周日」再保存。`
          : '周日没有课程。如果课表上应该有，请重新导入或手动添加。',
    });
    void satFp;
  }

  // ⑥ 周次为空 / 异常
  const noWeeks = courses.filter((c) => !c.weeks || !c.weeks.length);
  if (noWeeks.length) {
    hasProblem = true;
    items.push({
      severity: 'warn',
      title: `有 ${noWeeks.length} 门课程没有周次信息`,
      detail: noWeeks.slice(0, 6).map((c) => c.name).join('、') + '（不会出现在任何一周里）',
    });
  }

  // ⑦ 重复 id
  const ids = new Map<string, number>();
  for (const c of courses) ids.set(c.id, (ids.get(c.id) || 0) + 1);
  const dupIds = Array.from(ids.entries()).filter(([, n]) => n > 1);
  if (dupIds.length) {
    hasProblem = true;
    items.push({
      severity: 'error',
      title: `有 ${dupIds.length} 个重复的课程 id`,
      detail: dupIds.slice(0, 5).map(([id, n]) => `${id} ×${n}`).join('；') + '（可能导致列表渲染异常，建议重新导入）',
    });
  }

  // ⑧ 节次超出现有作息表
  if (opts.periods?.length) {
    const maxIdx = Math.max(...opts.periods.map((p) => p.index));
    const over = courses.filter((c) => c.startPeriod > maxIdx || c.endPeriod > maxIdx);
    if (over.length) {
      items.push({
        severity: 'warn',
        title: `有 ${over.length} 门课程的节次超出了当前作息表（共 ${maxIdx} 节）`,
        detail: over.slice(0, 6).map((c) => `${c.name} 第${c.startPeriod}-${c.endPeriod}节`).join('、') + '，建议在「学期与作息」里补全节次时间表。',
      });
    }
  }

  if (!hasProblem) {
    items.push({ severity: 'info', title: '未发现异常', detail: '星期分布与课程字段都正常。' });
  }

  return { items, perDay, total: courses.length, hasProblem };
}

/** 把报告转成可直接分享的纯文本 */
export function reportToText(report: CourseCheckReport): string {
  const head = `大学课表 · 课表自检报告\n生成时间：${new Date().toLocaleString()}\n共 ${report.total} 门课程\n`;
  const body = report.items
    .map((it) => `[${it.severity === 'error' ? '问题' : it.severity === 'warn' ? '注意' : '信息'}] ${it.title}${it.detail ? `\n    ${it.detail}` : ''}`)
    .join('\n');
  return `${head}\n${body}\n`;
}

/** 供界面显示"某天有哪些课"的简短标签 */
export function daySummary(courses: Course[], day: number): string {
  const list = courses.filter((c) => coerceDayOfWeek(c.dayOfWeek) === day);
  if (!list.length) return '无课';
  return list
    .slice(0, 8)
    .map((c) => `${c.name} ${weeksLabel(c.weeks || [])} 第${c.startPeriod}-${c.endPeriod}节`)
    .join('；');
}
