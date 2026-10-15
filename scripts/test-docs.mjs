/**
 * 文档契约校验
 *
 * 把 docs/ 下两份引导文件里「agent 应产出的示例文件」抽出来，
 * 用 App 真正的解析器跑一遍，确保文档和代码不会各说各话。
 *
 * 运行：npm run test:docs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseTimetableFile } from '../.test-build/utils/timetableFile.js';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, '..', 'docs');

/**
 * 从文档里抽出最外层的示例文件：
 * 文档用 `````markdown` 包住示例，示例内部又有 ```json。
 */
function extractSample(md) {
  const start = md.indexOf('````markdown');
  if (start < 0) return null;
  const end = md.indexOf('````', start + 12);
  if (end < 0) return null;
  return md.slice(start + 12, end);
}

/** 从示例里取出 JSON 负载（用于渲染节次时间表，避免表格与 JSON 各写一份） */
function extractPayload(sample) {
  const m = sample.match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** 把 periods 渲染成 markdown 表格行 */
function renderPeriodRows(periods) {
  return periods
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((p) => `| 第${p.index}节 | ${p.start} - ${p.end} |`)
    .join('\n');
}

const files = [
  { file: '01-用户信息表与爬取引导.md', minCourses: 3, expectScope: 'all', minPeriods: 1 },
  { file: '02-课表更新爬取引导.md', minCourses: 1, expectScope: 'month', minPeriods: 0 },
];

let checked = 0;
for (const spec of files) {
  const md = readFileSync(join(docsDir, spec.file), 'utf8');
  const sample = extractSample(md);
  assert.ok(sample, `${spec.file}：没找到 \`\`\`\`markdown 示例块`);

  const r = parseTimetableFile(sample);
  assert.equal(r.via, 'json', `${spec.file}：示例应走 JSON 层解析，实际 ${r.via}`);
  assert.ok(
    r.courses.length >= spec.minCourses,
    `${spec.file}：示例课程数 ${r.courses.length} 少于预期 ${spec.minCourses}`,
  );
  assert.equal(r.meta.scope, spec.expectScope, `${spec.file}：meta.scope 应为 ${spec.expectScope}`);

  // 每门课都必须有星期、节次、周次
  for (const c of r.courses) {
    assert.ok(c.dayOfWeek >= 1 && c.dayOfWeek <= 7, `${spec.file}：${c.name} 星期非法`);
    assert.ok(c.startPeriod >= 1 && c.endPeriod >= c.startPeriod, `${spec.file}：${c.name} 节次非法`);
    assert.ok(Array.isArray(c.weeks) && c.weeks.length > 0, `${spec.file}：${c.name} 缺周次`);
    assert.ok(c.name && c.name.trim(), `${spec.file}：存在空课程名`);
  }

  // 节次时间表（01 文档必须示范填写）
  if (spec.minPeriods > 0) {
    assert.ok(
      r.periods.length >= spec.minPeriods,
      `${spec.file}：节次时间表未解析出来（期望 ≥${spec.minPeriods} 条，实际 ${r.periods.length}）`,
    );
    for (const p of r.periods) {
      assert.match(p.start, /^\d{2}:\d{2}$/, `${spec.file}：节次 ${p.index} 开始时间格式非法`);
      assert.match(p.end, /^\d{2}:\d{2}$/, `${spec.file}：节次 ${p.index} 结束时间格式非法`);
    }
  }

  // 表格与 JSON 课程数必须一致（文档里两段不能对不上）
  const tableOnly = sample.split('## 四、机器可读数据')[0].split('## 三、机器可读数据')[0];
  const t = parseTimetableFile(tableOnly);
  assert.equal(
    t.courses.length,
    r.courses.length,
    `${spec.file}：表格课程数(${t.courses.length}) 与 JSON 课程数(${r.courses.length}) 不一致`,
  );

  // 节次时间：表格与 JSON 也必须一致
  if (spec.minPeriods > 0) {
    assert.equal(
      t.periods.length,
      r.periods.length,
      `${spec.file}：表格节次数(${t.periods.length}) 与 JSON 节次数(${r.periods.length}) 不一致`,
    );
    assert.equal(
      t.periods[0].start,
      r.periods[0].start,
      `${spec.file}：表格与 JSON 的第 1 节开始时间不一致`,
    );
  }

  console.log(
    `✔ ${spec.file}：JSON ${r.courses.length} 门 / 表格 ${t.courses.length} 门，` +
      `节次 ${r.periods.length} 条（首节 ${r.periods[0]?.start ?? '-'}），scope=${r.meta.scope}`,
  );
  checked += 1;
}

console.log(`\n文档契约校验通过：${checked}/${files.length} 份`);
