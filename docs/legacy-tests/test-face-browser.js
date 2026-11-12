/* 人脸模型加载的真实浏览器回归
 *
 * 覆盖四类真实故障：
 *  1. 正常加载（wasm/webgl/cpu 任一后端成功）；
 *  2. Service Worker 里残留历史 404 缓存，仍要能加载成功（网络优先 + 自动清缓存重试）；
 *  3. wasm 资源 404，自动降级到 webgl/cpu；
 *  4. 模型文件 404，报出可定位、可操作的错误，并把「口令登录」顶到显眼位置。
 *
 * 运行：node test-face-browser.js（需先启动 node server.js）
 *       UI_TEST_URL=http://127.0.0.1:3100 node test-face-browser.js
 */
'use strict';

const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
// SW 缓存名不写死：跟着 sw.js 的版本走，升级 SW 不会让测试误判。
const SW_CACHE = (fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8').match(/zhidao-shell-v(\d+)/) || [])[0] || 'zhidao-shell-v1';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.UI_TEST_URL || 'http://127.0.0.1:3000';
const SHOTS = path.join(ROOT, 'cache', 'shots');
const PROFILE = path.join(ROOT, 'cache', 'face-browser-profile');
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${detail ? ' · ' + detail : ''}`); }
}
function section(title) { console.log(`\n[${title}]`); }

async function settleServiceWorker(page) {
  // 新 SW 接管时 pwa.js 会 reload 一次，等它稳定下来再执行页面内断言。
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 30000 }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 900));
}

async function loadState(page) {
  const evaluate = () => page.evaluate(async () => {
    const out = { ok: false, error: null };
    try {
      out.ok = await window.FACE.load();
    } catch (error) {
      out.error = {
        code: error.code, message: error.message, stage: error.stage,
        url: error.url, status: error.status, hint: error.hint
      };
    }
    out.status = window.FACE.status();
    return out;
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await evaluate(); }
    catch (error) {
      if (!/Execution context was destroyed/.test(error.message) || attempt === 2) throw error;
      await settleServiceWorker(page);
    }
  }
}

function swStub(page) {
  return page.evaluateOnNewDocument(() => {
    const stub = {
      controller: null,
      register: () => Promise.resolve({ addEventListener() {}, installing: null }),
      addEventListener() {}, removeEventListener() {}, ready: Promise.resolve({})
    };
    try { Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: stub }); } catch (e) { /* 忽略 */ }
  });
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 180000,
    userDataDir: PROFILE,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  try {
    /* ---------- 场景 1：正常加载（带真实 Service Worker） ---------- */
    section('正常加载');
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    await settleServiceWorker(page);
    const assets = await page.evaluate(async () => (await (await fetch('/api/face-assets')).json()));
    check('服务端自检 ready=true', assets.ready === true && assets.missing.length === 0);
    const first = await loadState(page);
    check('FACE.load() 成功', first.ok === true, JSON.stringify(first.error));
    check('状态显示已加载且有计算后端', first.status.loaded === true
      && ['wasm', 'webgl', 'cpu'].includes(first.status.backend), first.status.backend);
    check('无残留错误', first.status.lastError === null);
    check('必需资源清单 8 项', first.status.requiredAssets.length === 8);
    check('Service Worker 已接管页面', await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));

    /* ---------- 场景 2：SW 里有历史脏缓存 ---------- */
    section('历史脏缓存自愈');
    await page.evaluate(async cacheName => {
      const cache = await caches.open(cacheName);
      const stale = () => new Response('{"error":"文件不存在"}', {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
      await cache.put('/vendor/tfjs-backend-wasm-simd.wasm', stale());
      await cache.put('/model/face_recognition_model.bin', stale());
      await cache.put('/vendor/face-api.esm.js', stale());
    }, SW_CACHE);
    await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
    await settleServiceWorker(page);
    const healed = await loadState(page);
    check('缓存了 404 仍能加载成功', healed.ok === true, JSON.stringify(healed.error));
    check('自愈后状态无错误', healed.status.lastError === null);
    const cacheOk = await page.evaluate(async cacheName => {
      const cache = await caches.open(cacheName);
      const entries = await cache.keys();
      const assetKeys = entries.filter(item => {
        const target = new URL(item.url);
        return target.origin === location.origin
          && (target.pathname.startsWith('/model/') || target.pathname.startsWith('/vendor/'));
      });
      const states = await Promise.all(assetKeys.map(async item => (await cache.match(item))?.ok));
      return { count: assetKeys.length, bad: states.filter(ok => ok !== true).length };
    }, SW_CACHE);
    check('缓存中不再残留 404 响应', cacheOk.count > 0 && cacheOk.bad === 0, JSON.stringify(cacheOk));

    /* ---------- 场景 3：wasm 资源 404 → 自动降级 ---------- */
    section('wasm 不可用时的后端降级');
    const context = await browser.createBrowserContext();
    const degradedPage = await context.newPage();
    await swStub(degradedPage);
    await degradedPage.setRequestInterception(true);
    degradedPage.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.includes('tfjs-backend-wasm') && url.pathname.endsWith('.wasm')) {
        return request.respond({ status: 404, contentType: 'application/wasm', body: '' });
      }
      return request.continue();
    });
    await degradedPage.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await degradedPage.waitForFunction(() => Boolean(window.FACE), { timeout: 20000 });
    const degraded = await loadState(degradedPage);
    check('wasm 404 时仍能加载模型', degraded.ok === true, JSON.stringify(degraded.error));
    check('已切换到 webgl / cpu 后端', degraded.status.backend === 'webgl' || degraded.status.backend === 'cpu',
      degraded.status.backend);
    await context.close();

    /* ---------- 场景 4：模型文件 404 → 可定位错误 + 界面降级 ---------- */
    section('模型缺失时的报错与降级路径');
    const failContext = await browser.createBrowserContext();
    const failPage = await failContext.newPage();
    await swStub(failPage);
    await failPage.setRequestInterception(true);
    failPage.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/model/face_recognition_model')) {
        return request.respond({ status: 404, contentType: 'application/json', body: '{"error":"文件不存在"}' });
      }
      return request.continue();
    });
    await failPage.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await failPage.waitForFunction(() => Boolean(window.FACE), { timeout: 20000 });
    const broken = await loadState(failPage);
    check('加载失败但抛出结构化错误', broken.ok === false && broken.error?.code === 'FACE_MODEL',
      JSON.stringify(broken.error));
    check('错误消息指出具体资源', Boolean(broken.error?.url?.includes('face_recognition_model')),
      broken.error?.url);
    check('错误消息给出下一步动作', Boolean(broken.error?.message) && Boolean(broken.error?.hint),
      broken.error?.message);
    check('status().lastError 保留诊断信息', broken.status.lastError?.stage === 'model');

    // 走真实弹窗链路：点击身份入口 → 开启摄像头 → 触发模型加载失败
    await failPage.click('#id-entry');
    await failPage.waitForFunction(() => Boolean(document.getElementById('id-camera-toggle')), { timeout: 15000 });
    await failPage.click('#id-camera-toggle');
    await failPage.waitForFunction(() => {
      const node = document.getElementById('id-face-hint');
      return node && node.classList.contains('warn') && node.textContent.length > 10;
    }, { timeout: 30000 }).catch(() => {});
    const ui = await failPage.evaluate(() => {
      const hint = document.getElementById('id-face-hint')?.textContent || '';
      return {
        hint,
        retry: document.getElementById('id-camera-toggle')?.textContent || '',
        secret: document.getElementById('id-tab-secret')?.textContent || '',
        highlighted: document.getElementById('id-tab-secret')?.classList.contains('highlight'),
        submitEnabled: document.querySelector('.id-form button.wide')?.disabled === false,
        submitHtml: document.querySelector('.id-form button.wide')?.outerHTML?.slice(0, 160) || 'missing',
        captureDisabled: document.getElementById('id-capture')?.disabled === true,
        hintRepeat: (hint.match(/build:face/g) || []).length
      };
    });
    check('界面展示具体原因而非「检查网络」', ui.hint.length > 12 && !ui.hint.includes('正在加载'), ui.hint);
    check('操作指引不重复出现', ui.hintRepeat <= 1, `出现 ${ui.hintRepeat} 次`);
    check('模型未就绪时采集按钮禁用', ui.captureDisabled === true);
    check('提供「重试加载模型」按钮', ui.retry.includes('重试'), ui.retry);
    check('口令登录入口被顶到显眼位置', ui.secret.includes('口令') && ui.highlighted === true, ui.secret);
    check('注册主按钮仍可用（不被模型失败阻断）', ui.submitEnabled === true, ui.submitHtml);
    await failPage.evaluate(() => { document.getElementById('modal-body').scrollTop = 0; });
    await failPage.setViewport({ width: 1280, height: 1100 });
    const modal = await failPage.$('#modal-backdrop .modal');
    if (modal) await modal.screenshot({ path: path.join(SHOTS, 'face-error-fallback.png') });
    const facePanel = await failPage.$('.id-face-panel');
    if (facePanel) await facePanel.screenshot({ path: path.join(SHOTS, 'face-error-hint.png') });
    await failContext.close();

    /* ---------- 场景 5：离线回退 ---------- */
    section('离线（PWA）可用性');
    const offlinePage = await browser.newPage();
    await offlinePage.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    await settleServiceWorker(offlinePage);
    // 等预缓存把所有模型/wasm 收齐，避免把「还没缓存完」误判成离线不可用。
    await offlinePage.waitForFunction(async cacheName => {
      const cache = await caches.open(cacheName);
      const keys = (await cache.keys()).map(item => new URL(item.url).pathname);
      return ['/vendor/face-api.esm.js', '/vendor/tfjs-backend-wasm.wasm',
        '/vendor/tfjs-backend-wasm-simd.wasm', '/model/face_recognition_model.bin']
        .every(item => keys.includes(item));
    }, { timeout: 30000 }, SW_CACHE).catch(() => {});
    await offlinePage.setOfflineMode(true);
    await offlinePage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const offline = await loadState(offlinePage);
    check('断网时仍从缓存加载模型', offline.ok === true, JSON.stringify(offline.error));
    await offlinePage.setOfflineMode(false);
    await offlinePage.close();
    await page.close();
  } finally {
    await browser.close();
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败${failed ? `（服务地址 ${BASE}）` : ''}`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('测试异常：', e); process.exitCode = 1; });
