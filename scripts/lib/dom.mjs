/**
 * 验证脚本共用的 DOM 辅助（v1.7.0 起抽出，供 verify-v160 / verify-v170 复用）
 *
 * 这里固化了本项目踩过的两个坑：
 *  1. RN Web 的 `Modal` 关闭后**仍留在 DOM 里**（只是隐藏）→ 定位元素必须叠加**可见性过滤**，
 *     否则会点到"已经关掉的弹层"里的同名按钮，点击静默失效；
 *  2. CDP 求值必须包 IIFE（在 browser.mjs 的 evalJs 调用处体现）。
 */

/** 可见性判定表达式片段（展开后即为一个函数） */
export const VISIBLE = `(e => {
  let el = e;
  for (let i = 0; i < 12 && el; i++) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    el = el.parentElement;
  }
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
})`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeHelpers(browser) {
  const { evalJs } = browser;

  /** 精确定位某段文字中**可见**的一个（可附加 rect 过滤条件）；先滚入视口保证可点 */
  const locate = async (text, filter = 'true') =>
    evalJs(`(() => {
      const visible = ${VISIBLE};
      const all = [...document.querySelectorAll('div,span')];
      const hits = all.filter(e => (e.textContent || '').trim() === ${JSON.stringify(text)} && visible(e));
      if (!hits.length) return 'null';
      const el = hits[hits.length - 1];
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      if (!(${filter})) return 'filtered';
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), left: +r.left.toFixed(1), top: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) });
    })()`);

  const clickText = async (text, filter = 'true') => {
    const raw = await locate(text, filter);
    if (!raw || raw === 'null' || raw === 'filtered') return false;
    const p = JSON.parse(raw);
    await browser.clickAt(p.x, p.y);
    return true;
  };

  /** 某段文字所在元素（或最近祖先）的背景色 */
  const bgOfText = async (text) =>
    evalJs(`(() => {
      const all = [...document.querySelectorAll('div,span')];
      const hits = all.filter(e => (e.textContent || '').trim() === ${JSON.stringify(text)});
      if (!hits.length) return 'no-text';
      let el = hits[hits.length - 1];
      for (let i = 0; i < 6 && el; i++) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg.replace(/\\s+/g, '');
        el = el.parentElement;
      }
      return 'none';
    })()`);

  /**
   * 底部标签「高亮条」颜色。
   * 注意：高亮条是标签文字的**兄弟节点**（不是祖先），不能靠向上遍历取色。
   */
  const tabIndicatorColor = async (label) =>
    evalJs(`(() => {
      const all = [...document.querySelectorAll('div,span')];
      const hits = all.filter(e => (e.textContent || '').trim() === ${JSON.stringify(label)});
      if (!hits.length) return 'no-text';
      let el = hits[hits.length - 1];
      for (let up = 0; up < 4 && el; up++) {
        const cands = [...el.querySelectorAll('div')].filter(d => {
          const r = d.getBoundingClientRect();
          return r.width > 8 && r.width < 26 && r.height > 1 && r.height < 6;
        });
        if (cands.length) return getComputedStyle(cands[cands.length - 1]).backgroundColor.replace(/\\s+/g, '');
        el = el.parentElement;
      }
      return 'none';
    })()`);

  const readStore = async (key) => {
    const raw = await evalJs(`localStorage.getItem(${JSON.stringify(key)})`);
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  /** 以 React 兼容方式写入输入框（受控组件必须走原生 value setter + input 事件） */
  const setInput = async (idx, text) =>
    evalJs(`(() => {
      const els = [...document.querySelectorAll('input,textarea')].filter(e => e.getClientRects().length);
      const el = els[${idx}];
      if (!el) return 'no-el:' + els.length;
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);

  /** 读「裁剪后 W × H」 */
  const readCropSize = async () => {
    const t = await evalJs(`(() => {
      const m = document.body.innerText.match(/裁剪后\\s*(\\d+)\\s*×\\s*(\\d+)/);
      return m ? m[1] + 'x' + m[2] : 'none';
    })()`);
    if (!t || t === 'none') return null;
    const [w, h] = t.split('x').map(Number);
    return { w, h };
  };

  /** 裁剪弹层是否可见（RN Web 的 Modal 关闭后可能仍在 DOM，必须查可见性） */
  const cropModalVisible = async () =>
    evalJs(`(() => {
      const visible = ${VISIBLE};
      const all = [...document.querySelectorAll('div,span')];
      return all.some(e => (e.textContent || '').trim() === '裁剪背景图' && visible(e))
        || all.some(e => (e.textContent || '').trim().startsWith('裁剪图标') && visible(e));
    })()`);

  /** 用 CDP 拦截文件选择框并注入一个真实文件（无头环境唯一稳定的做法） */
  const injectFile = async (clickFn, filePath) => {
    await browser.send('Page.setInterceptFileChooserDialog', { enabled: true });
    const chooser = browser.waitForEvent('Page.fileChooserOpened', 8000);
    const clicked = await clickFn();
    const ev = await chooser;
    if (!ev?.backendNodeId) return { clicked, injected: false, chooser: ev };
    await browser.send('DOM.enable');
    await browser.send('DOM.setFileInputFiles', { backendNodeId: ev.backendNodeId, files: [filePath] });
    return { clicked, injected: true, chooser: ev };
  };

  return {
    locate,
    clickText,
    bgOfText,
    tabIndicatorColor,
    readStore,
    setInput,
    readCropSize,
    cropModalVisible,
    injectFile,
    sleep,
  };
}
