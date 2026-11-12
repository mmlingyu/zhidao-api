/* 浏览器离线语音 · 真实 Edge 端到端回归
 *
 * 断言：知岛页面能按需加载离线语音引擎包 → 从本站读模型与音色 → 完成一次真实合成，
 *       期间不请求任何外部域名、不调用本地 8880 语音服务；英语学科用英语音色；
 *       引擎失败时自动回退到本地服务再回退到浏览器语音。
 * 前置：3100 MOCK 服务已启动（模型与音色已就位）。
 * 运行： npm run test:tts:browser
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.TTS_TEST_URL || 'http://127.0.0.1:3100';
const SHOT = path.join(__dirname, 'cache', 'shots', 'tts-offline.png');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 600000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required',
      '--enable-unsafe-webgpu', '--use-angle=default']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    // 屏蔽 Service Worker：升级版本会触发页面刷新，打断测试里的 evaluate。
    await page.evaluateOnNewDocument(() => {
      const stub = {
        controller: null,
        register: () => Promise.resolve({ addEventListener() {}, installing: null }),
        addEventListener() {}, removeEventListener() {}, ready: Promise.resolve({})
      };
      try { Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: stub }); } catch { /* 忽略 */ }
    });
    const pageErrors = [];
    const requests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    page.on('console', message => {
      if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`);
    });

    console.log('\n【一】页面加载与引擎包可达');
    await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.ZhidaoVoice && window.ZhidaoVoice.status, { timeout: 20000 });
    const mode = await page.evaluate(() => window.ZhidaoVoice.status().mode);
    check('默认朗读通道是离线合成', mode === 'offline', mode);

    const engineHead = await page.evaluate(async () => {
      const response = await fetch('/tts/kokoro-tts.js');
      return { ok: response.ok, type: response.headers.get('content-type') };
    });
    check('引擎包可从本站取到', engineHead.ok === true, JSON.stringify(engineHead));
    check('引擎包 MIME 是 JS', /javascript/.test(engineHead.type || ''), engineHead.type);

    console.log('\n【二】加载模型并完成一次真实合成（可能需要几分钟）');
    const started = Date.now();
    const loaded = await page.evaluate(async () => {
      const startedAt = Date.now();
      try {
        const status = await window.ZhidaoVoice.ensureOfflineEngine();
        return { ok: true, status, ms: Date.now() - startedAt };
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error), ms: Date.now() - startedAt };
      }
    });
    console.log(`    加载耗时 ${(loaded.ms / 1000).toFixed(1)}s`);
    check('离线引擎加载成功', loaded.ok === true, loaded.error);
    const engineStatus = await page.evaluate(() => window.ZhidaoVoice.status().offline);
    check('引擎状态为就绪', engineStatus.state === 'ready', JSON.stringify(engineStatus));
    check('引擎报告了运行设备', Boolean(engineStatus.device), JSON.stringify(engineStatus));

    // 模型必须来自本站，而不是 Hugging Face。
    const modelRequests = requests.filter(url => url.includes('model.onnx') || url.includes('huggingface'));
    const localModel = modelRequests.find(url => url.includes('/tts/models/'));
    check('模型从本站 /tts/models/ 读取', Boolean(localModel), modelRequests.slice(0, 3).join(' | '));
    check('没有访问外部模型站点', !modelRequests.some(url => /huggingface|hf\.co/.test(url)), modelRequests.slice(0, 3).join(' | '));

    console.log('\n【三】真实朗读：离线合成 + 口型 + 学科音色');
    const spoken = await page.evaluate(async () => {
      // 包一层 synthesize，记录实际使用的音色。
      const engine = await window.ZhidaoVoice.ensureOfflineEngine();
      const original = engine.synthesize.bind(engine);
      engine.synthesize = async (text, options) => {
        window.__lastOfflineVoice = (options || {}).voice;
        return original(text, options);
      };
      const before = { posts: 0 };
      const originalFetch = window.fetch;
      window.fetch = function (input, init) {
        const url = String(typeof input === 'string' ? input : input.url);
        if (url.includes('/v1/audio/speech')) before.posts += 1;
        return originalFetch.apply(this, arguments);
      };
      window.ZhidaoVoice.setSubject('english');
      await window.ZhidaoVoice.speak('Let us play football');
      const english = window.__lastOfflineVoice || '';
      window.ZhidaoVoice.setSubject('chinese');
      await window.ZhidaoVoice.speak('床前明月光，疑是地上霜');
      const chinese = window.__lastOfflineVoice || '';
      window.fetch = originalFetch;
      return { posts: before.posts, english, chinese, status: window.ZhidaoVoice.status().offline };
    });
    check('朗读没有走本地 8880 服务', spoken.posts === 0, String(spoken.posts));
    check('英语课读英文用英语音色', spoken.english === 'af_maple', spoken.english);
    check('语文课读中文用中文音色', spoken.chinese === 'zf_001', spoken.chinese);
    check('离线合成后引擎仍就绪', spoken.status.state === 'ready', JSON.stringify(spoken.status));
    await page.evaluate(() => window.ZhidaoVoice.stop());

    console.log('\n【四】界面与截图');
    const ui = await page.evaluate(async () => {
      window.ZhidaoMascot.openEditor();
      await new Promise(resolve => setTimeout(resolve, 400));
      return {
        modes: [...document.querySelectorAll('[data-zd-voice-mode]')].map(node => node.textContent.trim()),
        active: [...document.querySelectorAll('[data-zd-voice-mode]')].filter(node => node.classList.contains('on')).map(node => node.textContent.trim()),
        state: (document.getElementById('zd-voice-state') || {}).textContent,
        hint: (document.getElementById('zd-voice-hint') || {}).textContent,
        subjectRows: document.querySelectorAll('[data-zd-subject-voice]').length,
        preload: !!document.querySelector('[data-zd-action="preload-offline"]')
      };
    });
    check('工坊提供三种朗读通道', ui.modes.length === 3, ui.modes.join('|'));
    check('离线语音为当前通道', ui.active.join('|').includes('离线语音'), ui.active.join('|'));
    check('状态行显示离线引擎已就绪', /离线引擎/.test(ui.state || ''), ui.state);
    check('提示文案解释离线合成', /离线|浏览器里/.test(ui.hint || ''), ui.hint);
    check('学科音色行齐备', ui.subjectRows === 3, String(ui.subjectRows));
    check('有预加载模型按钮', ui.preload === true);
    const shot = await page.$('#zd-voice-field');
    if (shot) await shot.screenshot({ path: SHOT });
    check('离线语音工坊截图已输出', fs.existsSync(SHOT), SHOT);
    check('页面无脚本错误', pageErrors.length === 0, pageErrors.join(' | '));

    console.log(`\n离线语音浏览器回归：${passed} 通过 / ${failed} 失败\n`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error('浏览器回归异常：', error);
  process.exitCode = 1;
});
