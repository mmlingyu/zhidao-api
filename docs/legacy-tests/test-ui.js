/* 前端端到端回归（真实浏览器 + 真实服务端）
 *
 * 覆盖：
 *  - 用户体系：注册家长 → 添加孩子 → 顶栏身份 → 成员管理 → 登录态恢复
 *  - 移动端：390px 无横向溢出、顶栏不换行、触控尺寸达标
 *  - PWA：manifest 可读、Service Worker 已注册、安装提示条存在
 *
 * 运行：node test-ui.js（需先启动 node server.js）
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(ROOT, 'cache', 'shots');
const BASE = process.env.UI_TEST_URL || 'http://127.0.0.1:3000';
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ' · ' + detail : ''}`);
  }
}
function section(title) {
  console.log(`\n[${title}]`);
}

/** 造一个可区分不同人的单位特征向量（仅用于接口连通性验证） */
function makeDescriptor(seed) {
  const v = new Array(128).fill(0);
  const off = (seed % 16) * 8;
  for (let k = 0; k < 8; k++) v[off + k] = 1;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map(x => x / n);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text());
  });

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1000));

  // ---------- 1. 用户体系：建号并注入会话 ----------
  section('用户体系');
  const api = await page.evaluate(async (seedBase) => {
    const mk = (seed) => {
      const v = new Array(128).fill(0);
      const off = (seed % 16) * 8;
      for (let k = 0; k < 8; k++) v[off + k] = 1;
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      return v.map(x => x / n);
    };
    const stamp = Date.now().toString().slice(-6);
    const reg = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '王妈妈', grade: 'grade3', secret: 'zhidao2026', descriptor: [mk(seedBase + 1)] })
    }).then(r => r.json());
    const member = await fetch('/api/family/members', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reg.token}` },
      body: JSON.stringify({ name: '王小明', grade: 'grade4', descriptor: [mk(seedBase + 2)] })
    }).then(r => r.json());
    return {
      token: reg.token,
      members: member.family?.members?.length ?? 0,
      stamp
    };
  }, Math.floor(Math.random() * 8) + 8);
  check('家长注册成功', Boolean(api.token));
  check('成员添加成功', api.members >= 2, `成员数 ${api.members}`);

  await page.evaluate(token => localStorage.setItem('zhidao.session.token', token), api.token);
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));

  const entryName = await page.evaluate(() => document.getElementById('id-entry-name')?.textContent);
  const profileSub = await page.evaluate(() => document.getElementById('profile-sub')?.textContent);
  check('顶栏恢复登录态', entryName === '王妈妈', `顶栏显示「${entryName}」`);
  check('侧栏显示家长身份', /家长/.test(profileSub || ''), profileSub);
  await page.screenshot({ path: path.join(OUT, 'ui-1-logged-in.png') });

  // ---------- 2. 成员管理 ----------
  section('成员管理');
  await page.evaluate(() => document.getElementById('id-entry').click());
  await new Promise(r => setTimeout(r, 700));
  const dialogTitle = await page.evaluate(() => document.getElementById('modal-title')?.textContent);
  const memberNames = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.id-member-info strong')).map(el => el.textContent));
  check('成员管理弹窗打开', dialogTitle === '家庭成员', `标题「${dialogTitle}」`);
  check('列出家长与孩子', memberNames.includes('王妈妈') && memberNames.includes('王小明'), memberNames.join('/'));
  await page.screenshot({ path: path.join(OUT, 'ui-2-members.png') });

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.id-btn')).find(b => b.textContent.includes('添加孩子'));
    btn?.click();
  });
  await new Promise(r => setTimeout(r, 600));
  const addHasGrade = await page.evaluate(() => Boolean(document.getElementById('id-member-grade')));
  const gradeCount = await page.evaluate(() => document.getElementById('id-member-grade')?.options.length ?? 0);
  check('添加成员含年级选择', addHasGrade);
  check('年级选项充足', gradeCount >= 4, `${gradeCount} 个年级`);
  await page.screenshot({ path: path.join(OUT, 'ui-3-add-member.png') });

  await page.evaluate(() => document.getElementById('modal-close').click());
  await new Promise(r => setTimeout(r, 300));

  // ---------- 3. 移动端布局 ----------
  section('移动端 390px');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await new Promise(r => setTimeout(r, 700));

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  check('首页无横向溢出', overflow.scrollWidth <= overflow.innerWidth + 1,
    `scrollWidth=${overflow.scrollWidth} innerWidth=${overflow.innerWidth}`);

  // 顶栏标题不应换行（换行会导致高度撑高、文字折成两行）
  const topbar = await page.evaluate(() => {
    const strong = document.querySelector('.topbar-left strong');
    const bar = document.querySelector('.topbar');
    if (!strong) return null;
    const lineHeight = parseFloat(getComputedStyle(strong).lineHeight) || 18;
    return {
      text: strong.textContent,
      height: strong.getBoundingClientRect().height,
      lineHeight,
      barHeight: bar.getBoundingClientRect().height,
      lines: Math.round(strong.getBoundingClientRect().height / lineHeight)
    };
  });
  check('顶栏标题单行显示', topbar && topbar.lines <= 1,
    topbar ? `「${topbar.text}」占 ${topbar.lines} 行` : '未找到标题');

  // 触控尺寸：主要可点元素触达区不小于 40px
  const touch = await page.evaluate(() => {
    const sels = ['.start-button', '.id-entry', '.soft-button', '.icon-button', '.quick-row button'];
    const bad = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.height < 40) bad.push(`${sel} 高度 ${Math.round(r.height)}px`);
      }
    }
    return bad;
  });
  check('主要按钮触控区 ≥ 40px', touch.length === 0, touch.slice(0, 4).join('; '));

  // 输入框字号 ≥16px，避免 iOS 自动缩放页面
  const inputSize = await page.evaluate(() => {
    const el = document.getElementById('topic-input');
    return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
  });
  check('输入框字号 ≥16px（iOS 不缩放）', inputSize >= 16, `${inputSize}px`);

  await page.screenshot({ path: path.join(OUT, 'ui-4-mobile-home.png') });

  await page.evaluate(() => document.getElementById('id-entry').click());
  await new Promise(r => setTimeout(r, 700));
  const dialogOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  check('成员弹窗无横向溢出', dialogOverflow.scrollWidth <= dialogOverflow.innerWidth + 1,
    `scrollWidth=${dialogOverflow.scrollWidth}`);
  await page.screenshot({ path: path.join(OUT, 'ui-5-mobile-members.png') });
  await page.evaluate(() => document.getElementById('modal-close').click());
  await new Promise(r => setTimeout(r, 300));

  // ---------- 4. PWA ----------
  section('PWA');
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const res = await fetch(link.href);
    const json = await res.json();
    return { status: res.status, name: json.name, display: json.display, icons: json.icons?.length ?? 0 };
  });
  check('manifest 可读取', manifest?.status === 200, manifest ? `状态 ${manifest.status}` : '未找到');
  check('manifest 为独立窗口模式', manifest?.display === 'standalone', manifest?.display);
  check('manifest 含图标', manifest?.icons > 0, `${manifest?.icons} 个`);

  const swReg = await page.evaluate(() =>
    navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length > 0) : false);
  check('Service Worker 已注册', swReg === true);

  const pwaAssets = await page.evaluate(async () => {
    const out = {};
    for (const url of ['/pwa.js', '/pwa.css']) {
      const res = await fetch(url);
      out[url] = res.status;
    }
    return out;
  });
  check('pwa.js 可访问', pwaAssets['/pwa.js'] === 200, `状态 ${pwaAssets['/pwa.js']}`);
  check('pwa.css 可访问', pwaAssets['/pwa.css'] === 200, `状态 ${pwaAssets['/pwa.css']}`);

  const installUi = await page.evaluate(() => {
    const host = document.getElementById('pwa-hint');
    return { exists: Boolean(host), hasAction: Boolean(host?.querySelector('.pwa-hint-action')) };
  });
  check('安装提示条已挂载', installUi.exists);

  // 移动端：提示条应在顶部，不与右下角 IP 挂件重叠
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await new Promise(r => setTimeout(r, 600));
  const mobileHint = await page.evaluate(() => {
    const host = document.getElementById('pwa-hint');
    const hint = host?.getBoundingClientRect();
    const dock = document.getElementById('zd-dock')?.getBoundingClientRect();
    if (!hint) return null;
    return {
      visible: host.classList.contains('show'),
      hasAction: Boolean(host.querySelector('.pwa-hint-action')),
      top: hint.top,
      bottom: hint.bottom,
      dockTop: dock?.top ?? null,
      inViewport: hint.top >= -1 && hint.bottom <= window.innerHeight + 1
    };
  });
  check('移动端出现安装引导', mobileHint?.visible === true);
  check('安装引导含操作按钮', mobileHint?.hasAction === true);
  check('安装引导在视口内', mobileHint?.inViewport !== false,
    mobileHint ? `top ${Math.round(mobileHint.top)} bottom ${Math.round(mobileHint.bottom)}` : '');
  check('安装引导不与 IP 挂件重叠',
    !mobileHint?.visible || mobileHint.dockTop === null || mobileHint.bottom <= mobileHint.dockTop,
    mobileHint?.visible ? `引导底 ${Math.round(mobileHint.bottom)} / 挂件顶 ${Math.round(mobileHint.dockTop ?? 0)}` : '');

  // 安装引导是 fixed 定位，绝不能压住顶栏的身份入口 ——
  // 一旦遮住，手机上就再也点不到「登录 / 注册」了。
  const entryBlocked = await page.evaluate(() => {
    const entry = document.getElementById('id-entry');
    if (!entry) return { blocked: true, reason: '找不到身份入口' };
    const rect = entry.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      blocked: Boolean(top) && top !== entry && !entry.contains(top),
      reason: top ? (top.id || top.className || top.tagName) : 'null'
    };
  });
  check('安装引导不遮挡身份入口', entryBlocked.blocked === false,
    entryBlocked.blocked ? `被「${entryBlocked.reason}」挡住` : '');

  // 弹窗打开时提示条要自动让位（否则会盖住弹窗标题与按钮）
  await page.evaluate(() => document.getElementById('id-entry').click());
  await new Promise(r => setTimeout(r, 700));
  const hintDuringModal = await page.evaluate(() =>
    document.getElementById('pwa-hint')?.classList.contains('show') ?? false);
  check('弹窗打开时隐藏安装引导', hintDuringModal === false);
  await page.evaluate(() => document.getElementById('modal-close').click());
  await new Promise(r => setTimeout(r, 500));

  // 桌面端（宽屏）不应弹出安装引导 —— 桌面浏览器自带安装入口
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise(r => setTimeout(r, 600));
  const desktopHint = await page.evaluate(() => {
    const host = document.getElementById('pwa-hint');
    return { visible: host?.classList.contains('show') ?? false };
  });
  check('桌面端不弹安装引导', desktopHint.visible === false);

  // ---------- 5. 无 JS 错误 ----------
  section('运行期');
  check('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();

  console.log(`\n全部通过：${passed} 项断言，失败 ${failed} 项。`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => {
  console.error('失败:', e.message);
  process.exit(1);
});
