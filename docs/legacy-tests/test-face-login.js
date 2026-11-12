/* 人脸登录全链路的真实浏览器回归
 *
 * 覆盖用户在真实浏览器里会遇到的几件事：
 *  1. 注册：采集人脸 → 创建账号 → 拿到会话；
 *  2. 人脸登录：用同一张脸登录 → 识别到本人；
 *  3. 异人脸登录：距离超过阈值 → 拒绝，不误认；
 *  4. 口令登录：同一条链路里的备选路径仍可用；
 *  5. 口令错误：返回 401，不泄露账号是否存在；
 *  6. 降级：人脸模型不可用时，口令登录仍能走通（不被模型失败挡住）。
 *
 * 摄像头在无头环境里拿不到真实画面，所以这里注入人脸采集替身：
 * 页面里 window.FACE.describe / describeMulti 返回可复现的特征向量，
 * 服务端的欧氏距离匹配、阈值判断、混淆保护都是真实实现。
 *
 * 运行：node test-face-login.js（需先启动 node server.js）
 *       UI_TEST_URL=http://127.0.0.1:3100 node test-face-login.js
 */
'use strict';

const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.UI_TEST_URL || 'http://127.0.0.1:3000';
const SHOTS = path.join(ROOT, 'cache', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${detail ? ' · ' + detail : ''}`); }
}
function section(title) { console.log(`\n[${title}]`); }
/* 安全截断：JSON.stringify(undefined) 返回 undefined，直接 .slice 会抛。 */
function brief(value, max = 180) {
  const text = JSON.stringify(value);
  return text === undefined ? String(value) : text.slice(0, max);
}

/* 128 维人脸特征：同一个人（seed 相同）特征相同，换个人基向量整体不同，
 * 欧氏距离必然远超匹配阈值（0.5），可稳定地测出「认对人 / 拒绝陌生人」。 */
function descriptorFor(seed) {
  return Array.from({ length: 128 }, (_, i) => {
    const base = Math.sin((i + 1) * (seed + 1) * 0.37) * 0.35;
    return Number(base.toFixed(6));
  });
}

/* 在页面里注入人脸采集替身：window.FACE.describe / describeMulti。
 * window.__faceSeed 决定「当前这张脸是谁」，window.__faceModelFailed 模拟模型不可用。
 *
 * 注意：必须在页面脚本（face.js）加载完之后调用 —— face.js 结尾会执行
 * `window.FACE = FACE` 覆盖掉先注入的替身。 */
async function injectFaceStub(page) {
  // face.js 必须已经执行完（它结尾会写 window.FACE），替身才有东西可改。
  await page.waitForFunction(() => Boolean(window.FACE && window.FACE.load), { timeout: 20000 });
  await page.evaluate(() => {
    window.__faceSeed = 1;
    window.__faceModelFailed = false;
    const build = seed => Array.from({ length: 128 }, (_, i) => {
      const base = Math.sin((i + 1) * (seed + 1) * 0.37) * 0.35;
      return Number(base.toFixed(6));
    });
    const stub = () => ({
      descriptor: build(window.__faceSeed),
      score: 0.92,
      box: { x: 10, y: 10, width: 100, height: 100 }
    });
    const faceStub = {
      load: async () => {
        if (window.__faceModelFailed) {
          const error = new Error('人脸模型加载失败');
          error.code = 'FACE_MODEL';
          throw error;
        }
        return true;
      },
      isLoaded: () => !window.__faceModelFailed,
      getError: () => (window.__faceModelFailed ? { code: 'FACE_MODEL', message: '人脸模型加载失败' } : null),
      status: () => ({ loaded: !window.__faceModelFailed, backend: 'stub', lastError: null, requiredAssets: [] }),
      checkAssets: async () => ({ ok: !window.__faceModelFailed, missing: [] }),
      purgeAssetCache: async () => true,
      describe: async () => stub(),
      describeImage: async () => stub(),
      describeMulti: async () => ({
        descriptors: [build(window.__faceSeed), build(window.__faceSeed + 0.1), build(window.__faceSeed + 0.2)],
        best: stub()
      }),
      captureLive: async () => ({ ...stub(), liveness: 1.2 }),
      // 摄像头替身：直接把 video 标记为「已就绪」，不碰 srcObject
      // （无头环境没有真实 MediaStream，赋 srcObject 会抛类型错误）。
      openCamera: async (video) => {
        if (video) {
          video.dataset.stubReady = '1';
          video.setAttribute('data-stub-ready', '1');
        }
        // identity.js 的 stopCamera() 会调 camera.stop()，替身必须提供。
        return { stub: true, stop() {} };
      },
      // face.js 的 cameraSupport 是同步函数（返回 {ok, reason}），
      // identity.js 里直接读 support.ok —— 写成 async 会让 support.ok 变成 undefined，
      // 从而被误判成「摄像头不可用」。
      cameraSupport: () => ({ ok: true, reason: '' })
    };
    // 必须改原对象的属性，而不是替换 window.FACE：
    // face.js 结尾的 `window.FACE = FACE` 会把替换掉的对象覆盖回去。
    Object.keys(faceStub).forEach(key => { window.FACE[key] = faceStub[key]; });
  });
}

/* 打开身份弹窗。 */
async function openIdentity(page) {
  // 用真实点击而不是 element.click()：入口按钮可能绑的是 pointer 事件。
  await page.click('#id-entry');
  await page.waitForFunction(() => {
    const node = document.getElementById('modal-backdrop');
    return node && !node.hidden;
  }, { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 350));
}

/* 开摄像头 → 点采集。
 * 注意：不要点 id-tab-face —— 弹窗默认就停在人脸页签，再点一次会触发
 * renderFace() 重渲染整个表单，把已填的称呼/口令清空。 */
async function captureFace(page) {
  await page.waitForFunction(() => Boolean(document.getElementById('id-capture')), { timeout: 15000 });
  await page.click('#id-camera-toggle');
  await new Promise(resolve => setTimeout(resolve, 300));
  await page.click('#id-capture');
  await new Promise(resolve => setTimeout(resolve, 450));
}

/* 页面内直接调接口（走真实服务端实现）。 */
async function apiCall(page, path, body) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    return { status: response.status, data };
  }, { path, body });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 180000,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000 });
    await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => Boolean(document.getElementById('id-entry')), { timeout: 20000 });
    await injectFaceStub(page);

    /* ---------- 场景 1：注册（人脸采集 → 创建账号） ---------- */
    section('注册：采集人脸并创建账号');
    const stamp = Date.now().toString().slice(-6);
    const parentName = `小知${stamp}`;
    const parentSecret = 'zd' + stamp;
    await openIdentity(page);
    await page.evaluate(({ name, secret }) => {
      const set = (id, value) => {
        const node = document.getElementById(id);
        if (!node) return;
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('id-name', name);
      set('id-secret', secret);
      set('id-secret2', secret);
    }, { name: parentName, secret: parentSecret });
    await captureFace(page);
    const faceReady = await page.evaluate(() => {
      const hint = document.getElementById('id-face-hint')?.textContent || '';
      const capture = document.getElementById('id-capture');
      return { hint, captured: capture ? capture.textContent.includes('已采集') : false };
    });
    check('人脸采集完成并提示可创建账号', faceReady.captured === true, faceReady.hint);

    await page.evaluate(() => {
      const submit = document.querySelector('.id-form button.wide');
      if (submit) submit.click();
    });
    await page.waitForFunction((name) => {
      const entry = document.getElementById('id-entry');
      return entry && entry.textContent.includes(name);
    }, { timeout: 20000 }, parentName).catch(() => {});
    const afterRegister = await page.evaluate(() => ({
      entry: document.getElementById('id-entry')?.textContent || '',
      token: localStorage.getItem('zhidao.session.token') || '',
      user: localStorage.getItem('zhidao.session.user') || '',
      family: localStorage.getItem('zhidao.session.family') || ''
    }));
    check('注册后顶栏显示称呼', afterRegister.entry.includes(parentName), afterRegister.entry);
    check('注册后写入会话令牌', afterRegister.token.length > 10, afterRegister.token.slice(0, 24));
    check('注册后写入用户信息', afterRegister.user.includes(parentName), afterRegister.user.slice(0, 140));

    const family = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('zhidao.session.family') || 'null'); }
      catch { return null; }
    });
    check('会话里有家庭成员列表',
      Boolean(family && Array.isArray(family.members) && family.members.length >= 1),
      JSON.stringify(family && family.members && family.members.map(m => m.name)));
    check('家长标记为已录人脸',
      Boolean(family && family.members && family.members.some(m => m.role === 'parent' && m.hasFace === true)),
      JSON.stringify(family && family.members));

    const familyId = family && family.id;
    const userId = family && family.members && family.members[0] && family.members[0].id;
    check('会话里有家庭 ID 与用户 ID', Boolean(familyId) && Boolean(userId), `${familyId} / ${userId}`);

    /* ---------- 场景 2：人脸登录（同一个人） ---------- */
    section('人脸登录：同一人识别成功');
    const faceLogin = await apiCall(page, '/api/auth/login/face', {
      familyId,
      // descriptor 是「特征集合」：二维数组，每项 128 维。
      descriptor: [descriptorFor(1)]
    });
    check('人脸登录接口返回 200', faceLogin.status === 200, brief(faceLogin.data, 180));
    check('人脸登录识别到本人',
      Boolean(faceLogin.data && faceLogin.data.user && faceLogin.data.user.name === parentName),
      JSON.stringify(faceLogin.data && faceLogin.data.user).slice(0, 140));
    check('人脸登录返回会话令牌', Boolean(faceLogin.data && faceLogin.data.token));
    check('人脸登录返回匹配距离', typeof (faceLogin.data && faceLogin.data.distance) === 'number',
      String(faceLogin.data && faceLogin.data.distance));

    /* ---------- 场景 3：异人脸应被拒绝 ---------- */
    section('人脸登录：陌生人应被拒绝');
    const stranger = await apiCall(page, '/api/auth/login/face', {
      familyId,
      descriptor: [descriptorFor(9)]
    });
    check('陌生人脸被拒绝（不返回令牌）',
      stranger.status === 401 && !(stranger.data && stranger.data.token),
      brief(stranger.data, 180));

    /* ---------- 场景 4：口令登录 ---------- */
    section('口令登录：备选路径可用');
    const secretLogin = await apiCall(page, '/api/auth/login/secret', {
      account: parentName,
      secret: parentSecret
    });
    check('口令登录返回 200', secretLogin.status === 200, brief(secretLogin.data, 180));
    check('口令登录识别到本人',
      Boolean(secretLogin.data && secretLogin.data.user && secretLogin.data.user.name === parentName),
      JSON.stringify(secretLogin.data && secretLogin.data.user).slice(0, 140));

    const byId = await apiCall(page, '/api/auth/login/secret', {
      userId,
      secret: parentSecret
    });
    check('口令登录也接受用户 ID', byId.status === 200 && Boolean(byId.data && byId.data.token),
      brief(byId.data, 140));

    /* ---------- 场景 5：口令错误 ---------- */
    section('口令错误：拒绝且不泄露账号');
    const wrong = await apiCall(page, '/api/auth/login/secret', {
      account: parentName,
      secret: 'wrong-' + stamp
    });
    check('口令错误返回 401', wrong.status === 401, brief(wrong.data, 140));
    check('口令错误不返回令牌', !(wrong.data && wrong.data.token));

    /* ---------- 场景 6：人脸模型不可用时口令登录仍可走通 ---------- */
    section('降级：人脸模型失败不挡口令登录');
    const failPage = await browser.newPage();
    await failPage.setViewport({ width: 1280, height: 1000 });
    await failPage.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await failPage.waitForFunction(() => Boolean(document.getElementById('id-entry')), { timeout: 20000 });
    await injectFaceStub(failPage);
    await failPage.evaluate(() => { window.__faceModelFailed = true; });
    const degrade = await apiCall(failPage, '/api/auth/login/secret', {
      account: parentName,
      secret: parentSecret
    });
    check('模型失败时口令登录依然可用',
      degrade.status === 200 && Boolean(degrade.data && degrade.data.token),
      brief(degrade.data, 140));
    await failPage.close();

    /* ---------- 场景 7：模型失败时界面给出降级路径 ---------- */
    section('界面：模型失败时给出重试与口令入口');
    // 独立上下文：同一 browser 的页面共享 localStorage，
    // 已登录后弹窗会变成「成员管理」而不是注册表单，拿不到人脸采集面板。
    const failContext = await browser.createBrowserContext();
    const failUi = await failContext.newPage();
    await failUi.setViewport({ width: 1280, height: 1000 });
    await failUi.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await failUi.waitForFunction(() => Boolean(window.FACE && window.FACE.load), { timeout: 20000 });
    await failUi.waitForFunction(() => Boolean(document.getElementById('id-entry')), { timeout: 20000 });
    await injectFaceStub(failUi);
    await failUi.evaluate(() => { window.__faceModelFailed = true; });
    await openIdentity(failUi);
    // 不点 id-tab-face（会触发 renderFace 重渲染）；直接走「开启摄像头」，
    // 让模型失败路径真实触发一次。
    await failUi.waitForFunction(() => Boolean(document.getElementById('id-capture')), { timeout: 15000 });
    await failUi.click('#id-camera-toggle');
    await new Promise(resolve => setTimeout(resolve, 500));
    const uiState = await failUi.evaluate(() => {
      const capture = document.getElementById('id-capture');
      const toggle = document.getElementById('id-camera-toggle');
      const secretTab = document.getElementById('id-tab-secret');
      return {
        hint: document.getElementById('id-face-hint')?.textContent || '',
        captureDisabled: capture ? capture.disabled === true : null,
        captureText: capture ? capture.textContent : '',
        // 「重试加载模型」落在摄像头按钮上（identity.js 的模型失败分支改的是它）。
        toggleText: toggle ? toggle.textContent : '',
        secretText: secretTab ? secretTab.textContent : '',
        secretHighlighted: secretTab ? secretTab.classList.contains('highlight') : false
      };
    });
    check('模型未就绪时采集按钮禁用', uiState.captureDisabled === true, brief(uiState));
    check('提供重试加载模型入口', uiState.toggleText.includes('重试'), uiState.toggleText);
    check('提示文案说明具体原因', /模型|人脸/.test(uiState.hint || ''), uiState.hint);
    check('口令登录入口被顶到显眼位置',
      uiState.secretText.includes('口令') && uiState.secretHighlighted === true, uiState.secretText);
    const shot = await failUi.$('#modal-backdrop .modal');
    if (shot) await shot.screenshot({ path: path.join(SHOTS, 'face-login-fallback.png') });
    check('降级界面截图已输出', fs.existsSync(path.join(SHOTS, 'face-login-fallback.png')));
    await failContext.close();
  } finally {
    await browser.close();
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败${failed ? `（服务地址 ${BASE}）` : ''}`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('测试异常：', e); process.exitCode = 1; });
