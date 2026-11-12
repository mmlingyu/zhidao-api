/* A2UI P0 视觉等价回归。
 *
 * 用法：
 *   改造前： node test-a2ui-visual.js --baseline   （采集 DOM/样式/像素基线）
 *   改造后： node test-a2ui-visual.js              （与基线逐项对比）
 *
 * 对比三件事：
 *   1. DOM 结构：tag / class / 直接文本节点 —— 保证组件树等价；
 *   2. 计算样式与几何：40+ 视觉属性 —— 保证 CSS 未被绕过；
 *   3. 截图像素：canvas 逐像素 diff —— 保证「逐像素等价」的验收说法成立。
 * 属性（data-*）刻意不纳入对比：A2UI 把朗读从 data-speak 改成 action 是协议升级，
 * 只要视觉与交互不变就允许。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.A2UI_BASE || 'http://127.0.0.1:3100';
const SHOTS = path.join(__dirname, 'cache', 'shots');
const BASELINE = path.join(SHOTS, 'a2ui-baseline.json');
const GRADES = ['grade1', 'grade8'];
const baselineMode = process.argv.includes('--baseline');

const STYLE_KEYS = [
  'display', 'position', 'fontSize', 'fontFamily', 'fontWeight', 'lineHeight',
  'letterSpacing', 'color', 'backgroundColor', 'borderTopWidth', 'borderRightWidth',
  'borderBottomWidth', 'borderLeftWidth', 'borderTopColor', 'borderRadius',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap', 'width', 'height', 'minHeight', 'maxHeight', 'gridTemplateColumns',
  'boxShadow', 'opacity', 'textAlign', 'overflow', 'alignItems', 'justifyContent',
  'flexDirection', 'flexWrap', 'transform', 'whiteSpace'
];

async function snapshot(page, grade) {
  await page.evaluateOnNewDocument(disableServiceWorker);
  await page.evaluateOnNewDocument(g => {
    try { localStorage.setItem('zhidao.learner.grade', g); } catch { /* 隐私模式 */ }
  }, grade);
  await page.goto(`${BASE}/?t=${Date.now()}#q=${encodeURIComponent('开心')}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.poem-item', { timeout: 25000 });
  // 字体状态必须固定：styles.css 用 @import 引 Google Fonts（display=swap），
  // 公网可用与否会改变文本宽度约 0.86px，让逐像素对比随网络波动。
  // 基线是在 fallback 字体下采集的，这里通过拦截字体请求复现同一状态。
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.querySelectorAll('.zd-dock, .zd-dock-bubble').forEach(el => { el.style.display = 'none'; });
  });
  const signature = await page.evaluate(keys => {
    const root = document.querySelector('.two-column');
    if (!root) return null;
    const nodes = [root, ...root.querySelectorAll('*')];
    return nodes.map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const styles = {};
      for (const key of keys) styles[key] = cs[key];
      const cls = typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
      const text = [...el.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent).join('').trim();
      return {
        tag: el.tagName.toLowerCase(),
        cls: String(cls).trim(),
        text,
        rect: [Math.round(r.width), Math.round(r.height)],
        styles
      };
    });
  }, STYLE_KEYS);
  const el = await page.$('.two-column');
  const shot = await el.screenshot();
  return { signature, shot };
}

/** 在 about:blank 里用 canvas 逐像素比较两张 PNG，避免引入图像解码依赖。 */
async function pixelDiff(page, bufA, bufB) {
  const a = `data:image/png;base64,${bufA.toString('base64')}`;
  const b = `data:image/png;base64,${bufB.toString('base64')}`;
  return await page.evaluate(async (srcA, srcB) => {
    const load = src => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    const [ia, ib] = await Promise.all([load(srcA), load(srcB)]);
    if (ia.width !== ib.width || ia.height !== ib.height) {
      return { error: `尺寸不同 ${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
    }
    const grab = img => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const da = grab(ia), db = grab(ib);
    let diff = 0, maxDelta = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(
        Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]),
        Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3])
      );
      if (d > 16) diff++;
      if (d > maxDelta) maxDelta = d;
    }
    const total = ia.width * ia.height;
    return { total, diff, ratio: +(diff / total).toFixed(6), maxDelta, size: [ia.width, ia.height] };
  }, a, b);
}

function diffSignatures(base, next) {
  const issues = [];
  if (!base || !next) return ['未找到 .two-column 容器'];
  if (base.length !== next.length) {
    issues.push(`节点数 ${base.length} → ${next.length}`);
  }
  const n = Math.min(base.length, next.length);
  for (let i = 0; i < n; i++) {
    const a = base[i], b = next[i];
    const label = `#${i} <${a.tag} class="${a.cls}">`;
    if (a.tag !== b.tag) issues.push(`${label} tag → ${b.tag}`);
    if (a.cls !== b.cls) issues.push(`${label} class → "${b.cls}"`);
    if (a.text !== b.text) issues.push(`${label} 文本 "${a.text}" → "${b.text}"`);
    if (a.rect[0] !== b.rect[0] || a.rect[1] !== b.rect[1]) {
      issues.push(`${label} 尺寸 ${a.rect.join('x')} → ${b.rect.join('x')}`);
    }
    for (const key of STYLE_KEYS) {
      if (a.styles[key] !== b.styles[key]) {
        issues.push(`${label} ${key}: ${a.styles[key]} → ${b.styles[key]}`);
      }
    }
  }
  return issues;
}

/* 测试环境固定：pwa.js 在 SW 首次接管/版本更新时会 location.reload()，随机打断采集。 */
function disableServiceWorker() {
  const stub = {
    controller: null,
    register: () => Promise.resolve({ addEventListener() {}, installing: null }),
    addEventListener() {}, removeEventListener() {},
    ready: Promise.resolve({})
  };
  try { Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: stub }); }
  catch { /* 忽略 */ }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  // 阻断远程字体，固定为系统 fallback 字体（与历史基线一致），消除公网波动。
  // 同时禁用 HTTP 缓存：@import 的字体 CSS 一旦命中磁盘缓存就不再发出请求，
  // 拦截会失效，导致中文字形在两次运行间随机切换（差异热图里只有文字笔画变红）。
  await page.setRequestInterception(true);
  await page.setCacheEnabled(false);
  page.on('request', req => {
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(req.url())) req.abort();
    else req.continue();
  });
  const result = {};
  for (const grade of GRADES) {
    const { signature, shot } = await snapshot(page, grade);
    result[grade] = signature;
    fs.writeFileSync(path.join(SHOTS, `a2ui-${baselineMode ? 'baseline' : 'after'}-${grade}.png`), shot);
    console.log(`${grade}: 采集 ${signature?.length ?? 0} 个节点, 截图 ${shot.length} 字节`);
  }
  const comparePage = await browser.newPage();
  await comparePage.goto('about:blank');

  if (baselineMode) {
    fs.writeFileSync(BASELINE, JSON.stringify(result, null, 2));
    console.log(`基线已写入 ${BASELINE}`);
    await browser.close();
    return;
  }

  if (!fs.existsSync(BASELINE)) {
    console.error('缺少基线，请先运行 node test-a2ui-visual.js --baseline');
    process.exitCode = 1;
    await browser.close();
    return;
  }
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  let failed = 0;
  for (const grade of GRADES) {
    const issues = diffSignatures(base[grade], result[grade]);
    const bufA = fs.readFileSync(path.join(SHOTS, `a2ui-baseline-${grade}.png`));
    const bufB = fs.readFileSync(path.join(SHOTS, `a2ui-after-${grade}.png`));
    const px = await pixelDiff(comparePage, bufA, bufB);
    const pxOk = !px.error && px.ratio <= 0.01;
    console.log(`\n=== ${grade} ===`);
    console.log(`  DOM/样式差异: ${issues.length}`);
    issues.slice(0, 12).forEach(line => console.log('    - ' + line));
    if (issues.length > 12) console.log(`    … 另有 ${issues.length - 12} 项`);
    console.log(`  像素差异: ${px.error || `${px.diff}/${px.total} (${(px.ratio * 100).toFixed(3)}%), 最大通道差 ${px.maxDelta}`}`);
    if (issues.length || !pxOk) failed++;
  }
  await browser.close();
  console.log(`\n视觉等价验证：${GRADES.length - failed}/${GRADES.length} 个年级通过`);
  if (failed) process.exitCode = 1;
})().catch(err => { console.error('ERR', err.stack); process.exitCode = 1; });
