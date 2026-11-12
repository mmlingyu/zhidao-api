/* 音色配置 · 真实 Edge 端到端回归
 *
 * 断言：形象工坊列出服务文档的全部男女音色；选中音色后全局 speakText 真的
 *       带着该音色请求 /v1/audio/speech；服务地址不可达时自动回退浏览器默认；
 *       页面无脚本错误。输出一张工坊截图。
 * 前置：3100 MOCK 服务已启动、8880 语音服务在线。
 * 运行： npm run test:voice:browser
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.VOICE_TEST_URL || 'http://127.0.0.1:3100';
const SHOT = path.join(__dirname, 'cache', 'shots', 'voice-editor.png');
const ONLINE_SHOT = path.join(__dirname, 'cache', 'shots', 'voice-editor-online.png');
const SUBJECT_SHOT = path.join(__dirname, 'cache', 'shots', 'voice-subject-voices.png');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 180000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => {
      const stub = {
        controller: null,
        register: () => Promise.resolve({ addEventListener() {}, installing: null }),
        addEventListener() {}, removeEventListener() {}, ready: Promise.resolve({})
      };
      try { Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: stub }); } catch { /* 忽略 */ }
    });

    const pageErrors = [];
    const ttsPosts = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/v1/audio/speech')) {
        ttsPosts.push({ url: request.url(), body: request.postData() });
      }
    });
    const waitForPost = (fromIndex) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待 TTS 请求超时')), 20000);
      const handler = request => {
        if (request.method() !== 'POST' || !request.url().includes('/v1/audio/speech')) return;
        if (ttsPosts.length <= fromIndex) return;
        clearTimeout(timer);
        page.off('request', handler);
        resolve(ttsPosts[ttsPosts.length - 1]);
      };
      page.on('request', handler);
    });

    console.log('\n【一】形象工坊 · 音色清单');
    await page.goto(`${BASE}/?t=${Date.now()}#zd-editor`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.ZhidaoVoice && window.ZhidaoVoice.status().available === true, { timeout: 20000 });
    const initial = await page.evaluate(() => ({
      status: window.ZhidaoVoice.status(),
      field: !!document.getElementById('zd-voice-field'),
      options: document.querySelectorAll('#zd-voice-select option').length,
      groups: [...document.querySelectorAll('#zd-voice-select optgroup')].map(g => g.label),
      state: (document.getElementById('zd-voice-state') || {}).textContent,
      modalShown: document.getElementById('modal-backdrop') && !document.getElementById('modal-backdrop').hidden
    }));
    check('语音模块已加载且服务在线', initial.status.available === true, JSON.stringify(initial.status.error));
    check('读到服务文档的 103 个音色', initial.status.count === 103, String(initial.status.count));
    check('工坊已打开且有音色字段', initial.field && initial.modalShown);
    check('下拉列出全部 103 个音色', initial.options === 103, String(initial.options));
    check('按男女 / 语言分成 4 组', initial.groups.length === 4, initial.groups.join(','));
    check('女声与男声分组都存在', initial.groups.some(g => g.includes('女声')) && initial.groups.some(g => g.includes('男声')), initial.groups.join(','));
    check('状态行显示已连接', /已连接/.test(initial.state || ''), initial.state);
    fs.mkdirSync(path.dirname(SHOT), { recursive: true });

    console.log('\n【二】选中男声音色 → 全局朗读立即生效');
    await page.click('[data-zd-voice-mode="tts"]');
    await page.waitForFunction(() => !document.getElementById('zd-voice-select').disabled, { timeout: 10000 });
    await page.select('#zd-voice-select', 'zm_009');
    const saved = await page.evaluate(() => ({
      raw: JSON.parse(localStorage.getItem('zhidao-voice-settings-v1') || '{}'),
      status: window.ZhidaoVoice.status()
    }));
    check('配置写入 localStorage', saved.raw.mode === 'tts' && saved.raw.voice === 'zm_009', JSON.stringify(saved.raw));
    check('生效模式切到 tts', saved.status.effective === 'tts', saved.status.effective);
    const voiceField = await page.$('#zd-voice-field');
    await voiceField.screenshot({ path: ONLINE_SHOT });
    check('服务在线截图已输出', fs.existsSync(ONLINE_SHOT), ONLINE_SHOT);

    const beforeMain = ttsPosts.length;
    const mainPost = waitForPost(beforeMain);
    await page.evaluate(() => window.speakText('床前明月光，疑是地上霜'));
    const main = await mainPost;
    const mainBody = JSON.parse(main.body || '{}');
    check('全局 speakText 走语音服务', /\/v1\/audio\/speech$/.test(main.url), main.url);
    check('请求体用的是选中音色 zm_009', mainBody.voice === 'zm_009', JSON.stringify(mainBody));
    check('请求体带原文', mainBody.input === '床前明月光，疑是地上霜', mainBody.input);
    check('关闭流式 / 时间戳', mainBody.stream === false && mainBody.return_timestamps === false);

    const beforePreview = ttsPosts.length;
    const previewPost = waitForPost(beforePreview);
    await page.click('[data-zd-action="preview-voice"]');
    const preview = await previewPost;
    check('试听按钮也走同一音色', JSON.parse(preview.body || '{}').voice === 'zm_009', preview.body);

    console.log('\n【三】按学科配色：英语课用英语音色');
    const subjectState = await page.evaluate(() => ({
      voices: window.ZhidaoVoice.status().subjectVoices,
      englishOptions: [...document.querySelectorAll('#zd-subject-voice-english option')].map(o => o.value),
      chineseOptions: [...document.querySelectorAll('#zd-subject-voice-chinese option')].map(o => o.value),
      mathOptions: [...document.querySelectorAll('#zd-subject-voice-math option')].map(o => o.value),
      englishGroups: [...document.querySelectorAll('#zd-subject-voice-english optgroup')].map(g => g.label),
      rows: document.querySelectorAll('[data-zd-subject-voice]').length
    }));
    check('工坊有三个学科音色行', subjectState.rows === 3, String(subjectState.rows));
    check('英语槽位默认英文音色 af_maple', subjectState.voices.english === 'af_maple', JSON.stringify(subjectState.voices));
    check('语文与数学槽位默认跟随主音色',
      subjectState.voices.chinese === 'auto' && subjectState.voices.math === 'auto', JSON.stringify(subjectState.voices));
    check('英语下拉只有英文音色', subjectState.englishOptions.length === 3
      && subjectState.englishOptions.every(v => /^(af|bf)_/.test(v)), subjectState.englishOptions.join(','));
    check('语文下拉只有中文音色且带「跟随默认」',
      subjectState.chineseOptions.includes('auto')
      && subjectState.chineseOptions.filter(v => v !== 'auto').every(v => /^(zf|zm)_/.test(v)), subjectState.chineseOptions.join(','));
    check('数学下拉只有中文音色且带「跟随默认」',
      subjectState.mathOptions.includes('auto')
      && subjectState.mathOptions.filter(v => v !== 'auto').every(v => /^(zf|zm)_/.test(v)), subjectState.mathOptions.join(','));
    const subjectShot = await page.$('.zd-subject-voices');
    if (subjectShot) await subjectShot.screenshot({ path: SUBJECT_SHOT });
    check('学科音色区截图已输出', fs.existsSync(SUBJECT_SHOT), SUBJECT_SHOT);

    // 英语课读英文 → 英语音色；读中文 → 回落到主音色（zm_009）。
    await page.evaluate(() => window.ZhidaoVoice.setSubject('english'));
    const beforeEn = ttsPosts.length;
    const enPost = waitForPost(beforeEn);
    await page.evaluate(() => window.speakText('Let us play football'));
    const en = await enPost;
    check('英语课读英文用英语音色', JSON.parse(en.body || '{}').voice === 'af_maple', en.body);
    const beforeZh = ttsPosts.length;
    const zhPost = waitForPost(beforeZh);
    await page.evaluate(() => window.speakText('我们今天学英语'));
    const zh = await zhPost;
    check('英语课读中文回落中文主音色', JSON.parse(zh.body || '{}').voice === 'zm_009', zh.body);

    // 在工坊里改英语槽位 → 立刻生效。
    await page.select('#zd-subject-voice-english', 'bf_vale');
    const subjectSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('zhidao-voice-settings-v1') || '{}'));
    check('英语槽位写入配置', subjectSaved.subjectVoices && subjectSaved.subjectVoices.english === 'bf_vale',
      JSON.stringify(subjectSaved.subjectVoices));
    const beforeVale = ttsPosts.length;
    const valePost = waitForPost(beforeVale);
    await page.evaluate(() => window.speakText('Which one is right?'));
    const vale = await valePost;
    check('改完英语槽位立即生效', JSON.parse(vale.body || '{}').voice === 'bf_vale', vale.body);
    await page.evaluate(() => window.ZhidaoVoice.stop());

    console.log('\n【四】服务不存在 → 自动切回浏览器默认');
    await page.evaluate(() => {
      const input = document.getElementById('zd-voice-base');
      input.value = 'http://127.0.0.1:8899';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => window.ZhidaoVoice.status().available === false, { timeout: 15000 });
    const offline = await page.evaluate(() => ({
      status: window.ZhidaoVoice.status(),
      hint: (document.getElementById('zd-voice-hint') || {}).textContent,
      state: (document.getElementById('zd-voice-state') || {}).textContent
    }));
    check('标记为服务不可用', offline.status.available === false);
    check('生效模式回退 browser', offline.status.effective === 'browser', offline.status.effective);
    check('界面明确提示已回退', /回退|默认/.test(offline.hint || '') && /未连接/.test(offline.state || ''), `${offline.hint} | ${offline.state}`);

    await page.evaluate(() => {
      window.__utterances = 0;
      const Orig = window.SpeechSynthesisUtterance;
      window.SpeechSynthesisUtterance = function (text) { window.__utterances += 1; return new Orig(text); };
    });
    const beforeOffline = ttsPosts.length;
    await page.evaluate(() => window.speakText('服务断开也要能读'));
    const fallback = await page.evaluate(() => ({ count: window.__utterances, ret: true }));
    check('离线朗读改走浏览器 SpeechSynthesisUtterance', fallback.count === 1, String(fallback.count));
    check('离线不再请求语音服务', ttsPosts.length === beforeOffline, `${beforeOffline} → ${ttsPosts.length}`);
    await page.evaluate(() => window.ZhidaoVoice.stop());

    console.log('\n【五】页面完整性');
    const offlineField = await page.$('#zd-voice-field');
    await offlineField.screenshot({ path: SHOT });
    check('服务离线回退截图已输出', fs.existsSync(SHOT), SHOT);
    check('页面无脚本错误', pageErrors.length === 0, pageErrors.join(' | '));
    // 恢复默认，避免把测试地址留在当前页面的配置里。
    await page.evaluate(() => window.ZhidaoVoice.configure({ mode: 'browser', base: window.ZhidaoVoice.DEFAULT_BASE }));

    console.log(`\n音色浏览器回归：${passed} 通过 / ${failed} 失败\n`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error('浏览器回归异常：', error);
  process.exitCode = 1;
});
