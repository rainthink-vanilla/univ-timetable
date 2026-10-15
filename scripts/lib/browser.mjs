/**
 * 无头 Chrome + CDP 会话封装（供各验证脚本复用）
 *
 * 起静态服务器 + 启动 headless Chrome + 打开 CDP 连接，返回 send/evalJs 等工具。
 * 各 verify-*.mjs 脚本复用本模块，避免重复维护 Chrome 启动与 CDP 细节。
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.png': 'image/png',
};

/**
 * @param {object} opts
 * @param {string} opts.dist            静态目录（通常是 .webcheck）
 * @param {number} opts.port            静态服务器端口
 * @param {number} opts.cdpPort         Chrome 调试端口
 * @param {number} [opts.width]         逻辑宽度
 * @param {number} [opts.height]        逻辑高度
 * @param {number} [opts.scale]         设备像素比
 * @param {object} [opts.seed]          { courses, settings } 注入 localStorage
 */
export async function withBrowser(opts) {
  const { dist, port, cdpPort, width = 393, height = 850, scale = 2, seed } = opts;
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error('缺少 Web 构建产物，请先： npx expo export --platform web --output-dir .webcheck');
  }

  const server = createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    const file = join(dist, url === '/' ? 'index.html' : url);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('nope');
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));

  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chromePath) throw new Error('未找到 Chrome / Edge');

  // profile 放系统临时目录，避免污染构建目录
  const profileDir = join(tmpdir(), `dsh-verify-${cdpPort}`);
  rmSync(profileDir, { recursive: true, force: true });

  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' });

  let cdpReady = false;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (r.ok) { cdpReady = true; break; }
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!cdpReady) {
    chromeProc.kill();
    server.close();
    throw new Error('Chrome 调试端口未就绪');
  }

  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let msgId = 0;
  const pending = new Map();
  /** CDP 事件监听（v1.6.0 新增：上传文件需要 Page.fileChooserOpened 事件） */
  const eventWaiters = new Map();
  const seenEvents = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      return;
    }
    if (m.method) {
      seenEvents.push(m);
      const waiters = eventWaiters.get(m.method);
      if (waiters && waiters.length) waiters.shift()(m.params);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile: true,
  });

  // 种子数据必须在每次导航前注入：App 启动后会把自身 state 写回存储，
  // 在当前文档里改 localStorage 会被它覆盖。
  if (seed) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try{
        localStorage.setItem('univtimetable/courses/v1', ${JSON.stringify(JSON.stringify(seed.courses))});
        localStorage.setItem('univtimetable/settings/v1', ${JSON.stringify(JSON.stringify(seed.settings))});
      }catch(e){}`,
    });
  }

  /**
   * 求值一个表达式。
   * 注意必须包成 IIFE——CDP 把字符串 expression 当函数声明编译，直接传语句会静默失效。
   */
  const evalJs = async (expr) =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;

  const navigate = async (path = '/') => {
    await send('Page.navigate', { url: `http://127.0.0.1:${port}${path}` });
  };

  /** 用 CDP 派发真实鼠标点击（合成 dispatchEvent 驱动不了 RN Web 的 Pressable） */
  const clickAt = async (x, y) => {
    const base = { x, y, button: 'left', clickCount: 1, buttons: 1 };
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, buttons: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await new Promise((r) => setTimeout(r, 40));
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 });
  };

  const waitFor = async (jsBoolExpr, timeoutMs = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await evalJs(`(() => { try { return !!(${jsBoolExpr}); } catch(e) { return false; } })()`)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };

  /**
   * 等待一个 CDP 事件（超时返回 null）。
   * 用于拦截文件选择框：`Page.fileChooserOpened` 会带回 input 的 backendNodeId，
   * 再用 `DOM.setFileInputFiles({ backendNodeId })` 注入文件——
   * 这是无头环境下唯一稳定的做法：直接 DOM.querySelector 常常慢一步（input 已被移除）。
   */
  const waitForEvent = (method, timeoutMs = 10000) =>
    new Promise((resolve) => {
      const waiters = eventWaiters.get(method) ?? [];
      waiters.push(resolve);
      eventWaiters.set(method, waiters);
      setTimeout(() => resolve(null), timeoutMs);
    });

  const close = () => {
    try { ws.close(); } catch {}
    try { chromeProc.kill(); } catch {}
    try { server.close(); } catch {}
    try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
  };

  return { send, evalJs, navigate, clickAt, waitFor, waitForEvent, seenEvents, close, chromePath };
}

/* ------------------------------------------------------------------ */
/* DOM 查询辅助（RN Web 把文本渲染成带子节点的 div，不能用“叶子节点”判断） */
/* ------------------------------------------------------------------ */

/**
 * 生成一段可复用的 JS：精确匹配某段文本的最深元素。
 * RN Web 的文本节点自身可能还有子节点，故用「文本相等且无子元素含相同文本」筛选。
 */
export const findTextExpr = (text) => `(() => {
  const all = [...document.querySelectorAll('div,span')];
  const hits = all.filter(e => (e.textContent || '').trim() === ${JSON.stringify(text)});
  return hits.length ? hits[hits.length - 1] : null;
})()`;

/** 打包成一段工具函数源码，注入后续表达式使用 */
export const DOM_HELPERS = `
  const __findText = (t) => {
    const all = [...document.querySelectorAll('div,span')];
    const hits = all.filter(e => (e.textContent || '').trim() === t);
    return hits.length ? hits[hits.length - 1] : null;
  };
  const __rect = (el) => { const r = el.getBoundingClientRect(); return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
`;
