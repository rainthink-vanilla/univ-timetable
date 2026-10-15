/**
 * 课表文件契约解析器测试
 *
 * 运行：npm run test:parser
 * 原理：先用 tsc 把 src 编译到 .test-build/，再用 node:test 跑断言。
 * 这样测试的就是 App 里实际使用的那份代码，而不是复制粘贴的副本。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTimetableMarkdown,
  normalizeClockTime,
  normalizeDay,
  normalizeDays,
  parseCourseTable,
  parseFileTheme,
  parsePeriodRange,
  parsePeriodTimes,
  parseTimetableFile,
  weekRangeText,
} from '../.test-build/utils/timetableFile.js';
import { validateImage, IMAGE_SPEC, gradeImageSize, targetSizeForAspect } from '../.test-build/utils/imageSpec.js';

/* ---------- 契约样例：agent 应该产出的文件 ---------- */
const SAMPLE = `# 大学课表数据文件

> 契约版本：\`univ-timetable/v1\`

## 一、课表元信息

| 项目 | 内容 |
| --- | --- |
| 学校 | 示例大学 |
| 教务系统地址 | https://jwc.example.edu.cn/timetable |
| 学期 | 2025-2026 学年第一学期 |
| 学期开始日期 | 2025-09-01 |
| 学期总周数 | 20 |
| 覆盖周次 | 1-16 |
| 爬取范围 | all |
| 学生 | 张三 |
| 学号 | 20250001 |
| 爬取时间 | 2025-09-10T08:00:00.000Z |

## 二、课程明细

| 课程名称 | 教师 | 地点 | 星期 | 节次 | 周次 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 高等数学A | 张三 | 教一101 | 周一 | 第1-2节 | 1-16 | - |
| 大学英语 | 李四 | 教二203 | 周三 | 第3-4节 | 1-16周(单) | 带教材 |
| 体育（篮球） | 王五 | 体育馆 | 周五 | 第5-6节 | 1-8,10-12 | - |

## 三、机器可读数据

\`\`\`json
{
  "contract": "univ-timetable/v1",
  "meta": {
    "school": "示例大学",
    "jwcURL": "https://jwc.example.edu.cn/timetable",
    "semester": "2025-2026 学年第一学期",
    "semesterStart": "2025-09-01",
    "totalWeeks": 20,
    "weekRange": "1-16",
    "scope": "all",
    "student": "张三",
    "studentId": "20250001",
    "scrapedAt": "2025-09-10T08:00:00.000Z"
  },
  "courses": [
    { "name": "高等数学A", "teacher": "张三", "location": "教一101", "dayOfWeek": 1, "startPeriod": 1, "endPeriod": 2, "weeks": [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16] },
    { "name": "大学英语", "teacher": "李四", "location": "教二203", "dayOfWeek": 3, "startPeriod": 3, "endPeriod": 4, "weeks": [1,3,5,7,9,11,13,15] },
    { "name": "体育（篮球）", "teacher": "王五", "location": "体育馆", "dayOfWeek": 5, "startPeriod": 5, "endPeriod": 6, "weeks": [1,2,3,4,5,6,7,8,10,11,12] }
  ]
}
\`\`\`
`;

test('解析标准文件：走 JSON 层，元信息与课程都完整', () => {
  const r = parseTimetableFile(SAMPLE);
  assert.equal(r.via, 'json');
  assert.equal(r.courses.length, 3);
  assert.equal(r.meta.school, '示例大学');
  assert.equal(r.meta.semesterStart, '2025-09-01');
  assert.equal(r.meta.totalWeeks, 20);
  assert.equal(r.meta.scope, 'all');

  const math = r.courses[0];
  assert.equal(math.name, '高等数学A');
  assert.equal(math.dayOfWeek, 1);
  assert.equal(math.startPeriod, 1);
  assert.equal(math.endPeriod, 2);
  assert.equal(math.weeks.length, 16);

  const english = r.courses[1];
  assert.equal(english.dayOfWeek, 3);
  assert.deepEqual(english.weeks, [1, 3, 5, 7, 9, 11, 13, 15]);
});

test('表格兜底：删掉 JSON 代码块后仍能解析出课程', () => {
  const tableOnly = SAMPLE.split('## 三、机器可读数据')[0];
  const r = parseTimetableFile(tableOnly);
  assert.equal(r.via, 'table');
  assert.equal(r.courses.length, 3);
  assert.equal(r.courses[0].name, '高等数学A');
  assert.equal(r.courses[0].dayOfWeek, 1);
  assert.equal(r.courses[0].endPeriod, 2);
  assert.deepEqual(r.courses[1].weeks, [1, 3, 5, 7, 9, 11, 13, 15]);
  assert.deepEqual(r.courses[2].weeks, [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12]);
  // 元信息从正文表格里抓取
  assert.equal(r.meta.school, '示例大学');
  assert.equal(r.meta.studentId, '20250001');
});

test('星期/节次解析：覆盖中文、数字、英文、单节', () => {
  assert.equal(normalizeDay('周一'), 1);
  assert.equal(normalizeDay('星期日'), 7);
  assert.equal(normalizeDay('星期天'), 7);
  assert.equal(normalizeDay('3'), 3);
  assert.equal(normalizeDay('Fri'), 5);
  assert.equal(normalizeDay('monday'), 1);
  assert.equal(normalizeDay(''), null);
  assert.equal(normalizeDay('不知道'), null);

  assert.deepEqual(parsePeriodRange('第1-2节'), { start: 1, end: 2 });
  assert.deepEqual(parsePeriodRange('3'), { start: 3, end: 3 });
  assert.deepEqual(parsePeriodRange('2-1'), { start: 1, end: 2 });
  assert.deepEqual(parsePeriodRange('第 11-12 节'), { start: 11, end: 12 });
  assert.equal(parsePeriodRange('无'), null);
});

test('表头别名：列顺序打乱也能认出来', () => {
  const md = [
    '| 教师 | 课程 | 上课地点 | 周次 | 节次 | 星期 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 李四 | 线性代数 | 教三305 | 1-12 | 3-4 | 周二 |',
  ].join('\n');
  const list = parseCourseTable(md);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, '线性代数');
  assert.equal(list[0].teacher, '李四');
  assert.equal(list[0].location, '教三305');
  assert.equal(list[0].dayOfWeek, 2);
  assert.equal(list[0].startPeriod, 3);
  assert.equal(list[0].weeks.length, 12);
});

test('容错：空文件、乱文本、缺字段都不崩', () => {
  assert.equal(parseTimetableFile('').courses.length, 0);
  assert.equal(parseTimetableFile('   ').via, 'none');
  assert.equal(parseTimetableFile('这是一段随便写的文字').courses.length, 0);
  assert.equal(parseTimetableFile('```json\n{broken\n```').courses.length, 0);
  // 缺少星期/节次的课程应被丢弃而不是产生脏数据
  const bad = parseTimetableFile('```json\n{"courses":[{"name":"没星期"}]}\n```');
  assert.equal(bad.courses.length, 0);
});

test('裸 JSON 数组：能导入但给出警告', () => {
  const raw = JSON.stringify([
    { name: '离散数学', dayOfWeek: 2, startPeriod: 5, endPeriod: 6, weeks: '1-16' },
  ]);
  const r = parseTimetableFile(raw);
  assert.equal(r.courses.length, 1);
  assert.equal(r.courses[0].weeks.length, 16);
  assert.equal(r.via, 'raw-json');
  assert.ok(r.warnings.length > 0);
});

test('导出 → 再导入，数据不丢（往返一致性）', () => {
  const original = parseTimetableFile(SAMPLE);
  const md = buildTimetableMarkdown({ meta: original.meta, courses: original.courses });
  const again = parseTimetableFile(md);
  assert.equal(again.courses.length, original.courses.length);
  for (let i = 0; i < original.courses.length; i++) {
    assert.deepEqual(again.courses[i], original.courses[i]);
  }
  assert.equal(again.meta.school, original.meta.school);
  assert.equal(again.meta.totalWeeks, original.meta.totalWeeks);
});

test('周次压缩：1-8,10,12-16 形式正确', () => {
  assert.equal(weekRangeText([1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16]), '1-8,10,12-16');
  assert.equal(weekRangeText([3]), '3');
  assert.equal(weekRangeText([]), '');
  assert.equal(weekRangeText([2, 1, 2]), '1-2');
});

/* ================= 节次时间表（各校作息不同） ================= */

test('时间归一化：兼容多种写法', () => {
  assert.equal(normalizeClockTime('08:00'), '08:00');
  assert.equal(normalizeClockTime('8:00'), '08:00');
  assert.equal(normalizeClockTime('8：00'), '08:00'); // 全角冒号
  assert.equal(normalizeClockTime('0800'), '08:00');
  assert.equal(normalizeClockTime('830'), '08:30');
  assert.equal(normalizeClockTime('8点'), '08:00');
  assert.equal(normalizeClockTime('8点10分'), '08:10');
  assert.equal(normalizeClockTime('13:45'), '13:45');
  assert.equal(normalizeClockTime('25:00'), null);
  assert.equal(normalizeClockTime('abc'), null);
  assert.equal(normalizeClockTime(''), null);
  assert.equal(normalizeClockTime(null), null);
});

test('节次时间：periods 数组写法', () => {
  const p = parsePeriodTimes([
    { index: 1, start: '08:30', end: '09:15' },
    { index: 2, start: '09:25', end: '10:10' },
  ]);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], { index: 1, start: '08:30', end: '09:15' });
  assert.deepEqual(p[1], { index: 2, start: '09:25', end: '10:10' });
});

test('节次时间：只给 start/duration/break/count 也能推算（最省事）', () => {
  const p = parsePeriodTimes({ start: '08:30', duration: 45, break: 10, count: 3 });
  assert.equal(p.length, 3);
  assert.deepEqual(p[0], { index: 1, start: '08:30', end: '09:15' });
  assert.deepEqual(p[1], { index: 2, start: '09:25', end: '10:10' });
  assert.deepEqual(p[2], { index: 3, start: '10:20', end: '11:05' });
});

test('节次时间：字段别名与组合字段都能识别', () => {
  // period / time 字段 + "08:00-08:45" 组合
  const a = parsePeriodTimes([
    { period: 1, time: '08:00-08:45' },
    { period: 2, time: '08:55-09:40' },
  ]);
  assert.equal(a.length, 2);
  assert.deepEqual(a[1], { index: 2, start: '08:55', end: '09:40' });

  // 无序号时按数组位置补
  const b = parsePeriodTimes([{ start: '08:00', end: '08:45' }]);
  assert.deepEqual(b[0], { index: 1, start: '08:00', end: '08:45' });

  // 中文字段名
  const c = parsePeriodTimes([{ 节次: 3, 开始时间: '10:00', 结束时间: '10:45' }]);
  assert.deepEqual(c[0], { index: 3, start: '10:00', end: '10:45' });
});

test('节次时间：乱数据不崩、非法项被丢弃', () => {
  assert.deepEqual(parsePeriodTimes(null), []);
  assert.deepEqual(parsePeriodTimes(undefined), []);
  assert.deepEqual(parsePeriodTimes('08:00'), []);
  assert.deepEqual(parsePeriodTimes({ foo: 'bar' }), []);
  assert.deepEqual(parsePeriodTimes([{ index: 1 }]), []); // 缺时间
  assert.deepEqual(parsePeriodTimes([{ index: 99, start: '08:00', end: '08:45' }]), []); // 超范围
  assert.deepEqual(parsePeriodTimes([{ index: 1, start: '99:99', end: '08:45' }]), []); // 非法时间
  // 重复序号只保留第一个
  const dup = parsePeriodTimes([
    { index: 1, start: '08:00', end: '08:45' },
    { index: 1, start: '09:00', end: '09:45' },
  ]);
  assert.equal(dup.length, 1);
  assert.equal(dup[0].start, '08:00');
});

test('节次时间：从文件 JSON 的 periods 字段读入', () => {
  const md = [
    '```json',
    JSON.stringify({
      contract: 'univ-timetable/v1',
      periods: [
        { index: 1, start: '08:30', end: '09:15' },
        { index: 2, start: '09:25', end: '10:10' },
      ],
      courses: [{ name: '高等数学A', dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2] }],
    }),
    '```',
  ].join('\n');
  const r = parseTimetableFile(md);
  assert.equal(r.courses.length, 1);
  assert.equal(r.periods.length, 2);
  assert.equal(r.periods[0].start, '08:30'); // 8:30 上课的学校
});

test('节次时间：从「节次时间表」Markdown 表格兜底读取', () => {
  const md = [
    '## 二、节次时间表',
    '',
    '| 节次 | 时间 |',
    '| --- | --- |',
    '| 第1节 | 08:00 - 08:45 |',
    '| 第2节 | 08:55 - 09:40 |',
    '',
    '## 三、课程明细',
    '',
    '| 课程名称 | 教师 | 地点 | 星期 | 节次 | 周次 | 备注 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| 大学英语 | 李四 | 教二203 | 周三 | 第3-4节 | 1-16 | - |',
  ].join('\n');
  const r = parseTimetableFile(md);
  assert.equal(r.via, 'table');
  assert.equal(r.courses.length, 1);
  assert.equal(r.periods.length, 2);
  assert.deepEqual(r.periods[1], { index: 2, start: '08:55', end: '09:40' });
});

test('节次时间：导出 → 再导入，时间不丢（往返一致）', () => {
  const periods = [
    { index: 1, start: '08:30', end: '09:15' },
    { index: 2, start: '09:25', end: '10:10' },
  ];
  const md = buildTimetableMarkdown({
    meta: { school: '晚起大学' },
    courses: [{ name: '高等数学A', teacher: '张三', location: '教一101', dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3] }],
    periods,
  });
  // 表格里能看到时间
  assert.ok(md.includes('| 第1节 | 08:30 - 09:15 |'));
  const again = parseTimetableFile(md);
  assert.deepEqual(again.periods, periods);
  assert.equal(again.courses.length, 1);
});

test('节次时间：文件没给节次时间时不报错、periods 为空', () => {
  const r = parseTimetableFile(SAMPLE);
  // SAMPLE 里没有节次时间表
  assert.ok(Array.isArray(r.periods));
});

/* ================= 分享文件里的主题 ================= */

test('主题解析：字段别名与非法值都被正确处理', () => {
  assert.deepEqual(parseFileTheme({ theme: { accentColor: '#6366F1' } }), { accentColor: '#6366F1' });
  // 也接受直接写在顶层
  assert.deepEqual(parseFileTheme({ accentColor: '#0EA5E9' }), { accentColor: '#0EA5E9' });
  // overlay 别名 + 范围校验
  assert.deepEqual(parseFileTheme({ theme: { overlay: 0.7 } }), { backgroundOverlay: 0.7 });
  assert.equal(parseFileTheme({ theme: { backgroundOverlay: 1.5 } }), undefined);
  // 非法颜色被丢弃
  assert.equal(parseFileTheme({ theme: { accentColor: 'red' } }), undefined);
  assert.equal(parseFileTheme({ theme: { accentColor: '#fff' } }), undefined);
  // emoji
  assert.deepEqual(parseFileTheme({ theme: { iconEmoji: '🐳' } }), { iconEmoji: '🐳' });
  // 空/异常输入
  assert.equal(parseFileTheme(null), undefined);
  assert.equal(parseFileTheme([]), undefined);
  assert.equal(parseFileTheme({ theme: {} }), undefined);
});

test('分享文件往返：主题能导出并被正确读回', () => {
  const md = buildTimetableMarkdown({
    meta: { school: '示例大学', semesterStart: '2025-09-01' },
    courses: [{ name: '大学英语', teacher: '李四', location: '教二203', dayOfWeek: 3, startPeriod: 3, endPeriod: 4, weeks: [1, 2] }],
    periods: [{ index: 1, start: '08:30', end: '09:15' }],
    theme: { accentColor: '#10B981', backgroundOverlay: 0.92, iconEmoji: '🍀' },
  });
  // 人可读段
  assert.ok(md.includes('## 四、主题'), '应写出主题小节');
  assert.ok(md.includes('#10B981'));
  assert.ok(md.includes('92%'));
  // 机器段
  assert.ok(md.includes('"theme"'));

  const back = parseTimetableFile(md);
  assert.deepEqual(back.theme, { accentColor: '#10B981', backgroundOverlay: 0.92, iconEmoji: '🍀' });
  assert.equal(back.courses.length, 1);
  assert.equal(back.periods.length, 1);
  // 带主题时「机器可读数据」顺延为第五节
  assert.ok(md.includes('## 五、机器可读数据'));
});

test('分享文件：不带主题时不产生空主题段', () => {
  const md = buildTimetableMarkdown({
    meta: {},
    courses: [{ name: '体育', dayOfWeek: 5, startPeriod: 5, endPeriod: 6, weeks: [1] }],
  });
  assert.ok(!md.includes('## 四、主题'));
  assert.ok(md.includes('## 四、机器可读数据'));
  assert.equal(parseTimetableFile(md).theme, undefined);
});

/* ================= 主题图片规格校验 ================= */

test('主题图片：格式不合规被拒绝并给出原因', () => {
  const bad = validateImage({ uri: 'file://x.gif', mimeType: 'image/gif', width: 1080, height: 1920 });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /格式不支持/);
  assert.ok(bad.reason.includes('JPG'));
});

test('主题图片：体积超上限被拒绝（v1.7.0：上限放宽到 20MB）', () => {
  const tooBig = validateImage({
    uri: 'file://x.jpg', mimeType: 'image/jpeg', width: 2000, height: 3000,
    fileSize: IMAGE_SPEC.maxBytes + 1,
  });
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.reason, /超过上限/);
});

test('主题图片：v1.7.0 起"偏小的图"不再被拒绝，只给提示', () => {
  // 旧策略：最短边 <600 直接拒绝；新策略：只有低于硬下限才拒绝
  const small = validateImage({ uri: 'file://x.jpg', mimeType: 'image/jpeg', width: 320, height: 480 });
  assert.equal(small.ok, true, '320×480 应当可用（只提示偏小）');
  assert.match(small.warning, /偏小/);

  // 8MB 以上、20MB 以内：通过 + 载入提示
  const big = validateImage({
    uri: 'file://x.jpg', mimeType: 'image/jpeg', width: 3000, height: 4000,
    fileSize: 12 * 1024 * 1024,
  });
  assert.equal(big.ok, true);
  assert.match(big.warning, /载入可能稍慢/);

  // 低于硬下限：仍然拒绝，并说明要求
  const tiny = validateImage({ uri: 'file://x.jpg', mimeType: 'image/jpeg', width: 80, height: 100 });
  assert.equal(tiny.ok, false);
  assert.match(tiny.reason, /太小/);
});

test('主题图片：尺寸分级按"裁剪后"的尺寸判定', () => {
  assert.equal(gradeImageSize({ width: 1200, height: 1600 }).level, 'recommended');
  assert.equal(gradeImageSize({ width: 700, height: 1200 }).level, 'good');
  assert.equal(gradeImageSize({ width: 320, height: 480 }).level, 'small');
  assert.equal(gradeImageSize({ width: 90, height: 200 }).level, 'tiny');
  // 全部"可用"——分级只影响提示，不否决
  for (const s of [{ width: 1200, height: 1600 }, { width: 90, height: 200 }]) {
    assert.equal(gradeImageSize(s).usable, true);
  }
});

test('主题图片：按比例给出建议目标尺寸（短边取推荐值）', () => {
  assert.deepEqual(targetSizeForAspect(1), { width: 1080, height: 1080 });
  const portrait = targetSizeForAspect(9 / 16);
  assert.equal(portrait.width, 1080);
  assert.equal(portrait.height, 1920);
  const wide = targetSizeForAspect(16 / 9);
  assert.equal(wide.height, 1080);
  assert.ok(wide.width > 1080);
});

/* ================= v1.7.1：一格多天（修周六/周日串列） ================= */

test('星期：单值写法保持兼容，0 视为周日', () => {
  assert.equal(normalizeDay('周六'), 6);
  assert.equal(normalizeDay('周日'), 7);
  assert.equal(normalizeDay('星期日'), 7);
  assert.equal(normalizeDay('星期天'), 7);
  assert.equal(normalizeDay('7'), 7);
  assert.equal(normalizeDay(7), 7);
  assert.equal(normalizeDay(0), 7, '0 应视为周日');
  assert.equal(normalizeDay('0'), 7);
  assert.equal(normalizeDay('周日'), 7);
});

test('星期：一格多天要全部识别（BUG：原先只取第一个 → 周日的课被塞进周六列）', () => {
  assert.deepEqual(normalizeDays('周六、周日'), [6, 7]);
  assert.deepEqual(normalizeDays('周六/周日'), [6, 7]);
  assert.deepEqual(normalizeDays('周六和周日'), [6, 7]);
  assert.deepEqual(normalizeDays('周六 周日'), [6, 7]);
  assert.deepEqual(normalizeDays('六日'), [6, 7]);
  assert.deepEqual(normalizeDays('周六周日'), [6, 7]);
  assert.deepEqual(normalizeDays('6,7'), [6, 7]);
  assert.deepEqual(normalizeDays('6-7'), [6, 7]);
  assert.deepEqual(normalizeDays('周六-周日'), [6, 7]);
  assert.deepEqual(normalizeDays('周末'), [6, 7]);
  assert.deepEqual(normalizeDays('工作日'), [1, 2, 3, 4, 5]);
  assert.deepEqual(normalizeDays('每天'), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(normalizeDays('一至五'), [1, 2, 3, 4, 5]);
  assert.deepEqual(normalizeDays('周一到周五'), [1, 2, 3, 4, 5]);
  assert.deepEqual(normalizeDays('周一、周三'), [1, 3]);
  assert.deepEqual(normalizeDays('周六 周日 周一'), [1, 6, 7], '结果应升序去重');
  assert.deepEqual(normalizeDays([6, 7]), [6, 7], '数组写法也要支持');
  assert.deepEqual(normalizeDays(''), []);
  assert.deepEqual(normalizeDays(null), []);
});

test('星期：多天单元格在表格解析里生成多条课程（周六/周日各一条）', () => {
  const md = [
    '# 课表',
    '',
    '## 一、课表元信息',
    '',
    '| 项目 | 内容 |',
    '| --- | --- |',
    '| 学期开始日期 | 2025-09-01 |',
    '| 学期总周数 | 20 |',
    '',
    '## 二、课程明细',
    '',
    '| 课程名称 | 教师 | 地点 | 星期 | 节次 | 周次 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 周末实验 | 甲 | 实验楼 | 周六、周日 | 1-2 | 1-16 |',
    '| 单日课 | 乙 | 教一 | 周三 | 3-4 | 1-16 |',
    '',
  ].join('\n');
  const p = parseTimetableFile(md);
  assert.equal(p.via, 'table');
  const weekend = p.courses.filter((c) => c.name === '周末实验');
  assert.equal(weekend.length, 2, `周六/周日应各生成一条，实际 ${weekend.length} 条`);
  assert.deepEqual(weekend.map((c) => c.dayOfWeek).sort((a, b) => a - b), [6, 7]);
  // 两条除星期外完全一致
  assert.equal(weekend[0].startPeriod, weekend[1].startPeriod);
  assert.equal(weekend[0].location, weekend[1].location);
  assert.equal(p.courses.filter((c) => c.name === '单日课').length, 1, '单日课不应被复制');
});

test('星期：JSON 里给多天同样生成多条（数组与字符串都支持）', () => {
  const json = JSON.stringify({
    contract: 'univ-timetable/v1',
    courses: [
      { name: '周末课A', dayOfWeek: [6, 7], startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3] },
      { name: '周末课B', dayOfWeek: '周六、周日', startPeriod: 3, endPeriod: 4, weeks: [1, 2, 3] },
    ],
  });
  const p = parseTimetableFile('```json\n' + json + '\n```');
  assert.equal(p.via, 'json');
  for (const n of ['周末课A', '周末课B']) {
    const list = p.courses.filter((c) => c.name === n);
    assert.equal(list.length, 2, `${n} 应生成 2 条，实际 ${list.length}`);
    assert.deepEqual(list.map((c) => c.dayOfWeek).sort((a, b) => a - b), [6, 7]);
  }
});

test('主题图片：合规图片通过，并识别横图提示', () => {
  const good = validateImage({
    uri: 'file://x.png', mimeType: 'image/png', width: 1080, height: 1920, fileSize: 1024 * 500,
  });
  assert.equal(good.ok, true);
  assert.equal(good.warning, undefined, '竖图不应有横图警告');
  assert.deepEqual(good.info, { width: 1080, height: 1920, sizeMB: 1024 * 500 / 1048576, format: 'PNG' });

  const landscape = validateImage({
    uri: 'file://y.jpg', mimeType: 'image/jpeg', width: 1920, height: 1080,
  });
  assert.equal(landscape.ok, true);
  assert.match(landscape.warning, /横图/);
});

test('主题图片：机型不返回 mimeType 时按扩展名兜底', () => {
  // 很多 Android 机型 fileSize/mimeType 缺省，此时不能误判为格式错误
  const noMime = validateImage({ uri: 'file://a/b/photo.jpg', width: 1080, height: 1920 });
  assert.equal(noMime.ok, true);
  assert.equal(noMime.info.format, 'JPG');

  const noMimePng = validateImage({ uri: 'file://a/b/pic.PNG', width: 800, height: 1200 });
  assert.equal(noMimePng.ok, true);
  assert.equal(noMimePng.info.format, 'PNG');

  // 无法识别扩展名时兜底为 jpg，而不是判失败
  const unknown = validateImage({ uri: 'file://a/b/blob', width: 800, height: 1200 });
  assert.equal(unknown.ok, true);
});
