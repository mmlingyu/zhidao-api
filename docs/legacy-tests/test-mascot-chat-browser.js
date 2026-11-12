/* 点一点知知 · 真实 Edge 端到端回归
 *
 * 断言：点击首页顶栏 / 右下角 IP 形象立即用当前全局音色朗读随机问句并弹框；
 *       换一句 / 再听一遍 / 快捷需求 / 输入需求提交到 /api/tutor；
 *       键盘可达；语音服务不存在时自动回退浏览器默认音色，弹框照常可用。
 * 前置：3100 MOCK 服务已启动、8880 语音服务在线。
 * 运行： npm run test:mascot-chat:browser
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.MASCOT_CHAT_TEST_URL || 'http://127.0.0.1:3100';
const SHOT_DIR = path.join(__dirname, 'cache', 'shots');
const SHOT = path.join(SHOT_DIR, 'mascot-chat.png');
const OFFLINE_SHOT = path.join(SHOT_DIR, 'mascot-chat-offline.png');
const LESSON_SHOT = path.join(SHOT_DIR, 'mascot-chat-lesson.png');
const NEED = '帮我讲讲《春晓》里「处处闻啼鸟」的画面感';

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
    const tutorPosts = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const url = request.url();
      if (request.method() === 'POST' && url.includes('/v1/audio/speech')) {
        ttsPosts.push({ url, body: request.postData() });
      }
      if (request.method() === 'POST' && url.includes('/api/tutor')) {
        tutorPosts.push({ url, body: request.postData() });
      }
    });

    const waitFor = (list, minCount, label, timeout = 20000) => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (list.length >= minCount) return resolve(list[minCount - 1]);
        if (Date.now() - started > timeout) return reject(new Error(`等待${label}超时`));
        setTimeout(tick, 40);
      };
      tick();
    });
    const waitForTts = count => waitFor(ttsPosts, count, ' TTS 请求');
    const waitForTutor = count => waitFor(tutorPosts, count, ' /api/tutor 请求');
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    console.log('\n【一】首页 IP 形象已可点，语音服务在线');
    await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.ZhidaoMascotChat && window.ZhidaoVoice &&
      window.ZhidaoVoice.status().available === true, { timeout: 20000 });
    await page.evaluate(async () => {
      const V = window.ZhidaoVoice;
      V.configure({ mode: 'tts', voice: 'zm_009', base: V.DEFAULT_BASE });
      await V.refresh();
    });
    const initial = await page.evaluate(() => ({
      hosts: [...document.querySelectorAll('[data-zd-chat]')].map(el => ({
        size: el.dataset.zdSize, role: el.getAttribute('role'), tab: el.getAttribute('tabindex')
      })),
      effective: window.ZhidaoVoice.status().effective,
      modalHidden: document.getElementById('modal-backdrop').hidden,
      pool: [...window.ZhidaoMascotChat.GREETINGS,
        ...Object.values(window.ZhidaoMascotChat.STAGE_GREETINGS).flat()]
    }));
    check('顶栏与右下角两个形象都可点', initial.hosts.length === 2, JSON.stringify(initial.hosts));
    check('两个形象都有键盘可达属性', initial.hosts.every(h => h.role === 'button' && h.tab === '0'));
    check('当前生效音色为语音服务', initial.effective === 'tts', initial.effective);
    check('初始没有提问弹框', initial.modalHidden === true);

    console.log('\n【二】点顶栏知知 → 随机 TTS 提问 + 弹框');
    const p1 = waitForTts(1);
    await page.click('.zd-brand-mark [data-zd-chat]');
    const post1 = await p1;
    const body1 = JSON.parse(post1.body || '{}');
    const opened = await page.evaluate(() => ({
      hidden: document.getElementById('modal-backdrop').hidden,
      line: (document.getElementById('zd-chat-line') || {}).textContent,
      voice: (document.getElementById('zd-chat-voice') || {}).textContent,
      hasInput: !!document.getElementById('zd-chat-input'),
      actions: document.querySelectorAll('[data-zd-chat-action]').length,
      chips: document.querySelectorAll('[data-zd-chat-suggestion]').length,
      mascot: !!document.querySelector('#zd-chat [data-zd-host] svg')
    }));
    check('弹框已打开', opened.hidden === false);
    check('问句来自随机文案池', initial.pool.includes(opened.line), opened.line);
    check('弹框显示当前音色', opened.voice.includes('zm_009'), opened.voice);
    check('弹框有输入框 / 4 个动作 / 4 个快捷需求',
      opened.hasInput && opened.actions === 4 && opened.chips === 4,
      `${opened.hasInput}/${opened.actions}/${opened.chips}`);
    check('弹框里的知知形象已渲染', opened.mascot === true);
    check('TTS 请求使用选中音色', body1.voice === 'zm_009', JSON.stringify(body1));
    check('TTS 朗读的正是弹框里那句', body1.input === opened.line, `${body1.input} | ${opened.line}`);
    check('请求关闭流式', body1.stream === false);
    // modalIn 动画带 scale(.98)，动画期间截元素会裁掉左侧几个像素，等它结束再截整张弹框。
    await new Promise(resolve => setTimeout(resolve, 400));
    const chatModal = await page.$('#modal-backdrop .modal');
    await chatModal.screenshot({ path: SHOT });
    check('提问弹框截图已输出', fs.existsSync(SHOT), SHOT);

    console.log('\n【三】换一句 / 再听一遍 / 快捷需求');
    const p2 = waitForTts(2);
    await page.click('[data-zd-chat-action="another"]');
    const post2 = await p2;
    const changed = await page.evaluate(() => (document.getElementById('zd-chat-line') || {}).textContent);
    check('换一句后问句变化', changed !== opened.line, `${opened.line} → ${changed}`);
    check('换一句也重新朗读新问句', JSON.parse(post2.body || '{}').input === changed);
    const p3 = waitForTts(3);
    await page.click('[data-zd-chat-action="again"]');
    const post3 = await p3;
    check('再听一遍朗读同一句', JSON.parse(post3.body || '{}').input === changed);
    await page.click('.zd-chat-suggestions button');
    const chipValue = await page.evaluate(() => document.getElementById('zd-chat-input').value);
    check('快捷需求填入输入框但不自动提交', chipValue.length > 0 && tutorPosts.length === 0, chipValue);

    console.log('\n【四】弹框输入需求 → 直接发起讲解');
    await page.evaluate(need => {
      const field = document.getElementById('zd-chat-input');
      field.value = need;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, NEED);
    const pTutor = waitForTutor(1);
    await page.click('[data-zd-chat-action="submit"]');
    await pTutor;
    const submitted = await page.evaluate(() => ({
      hidden: document.getElementById('modal-backdrop').hidden,
      topic: document.getElementById('topic-input').value
    }));
    check('提交后弹框关闭', submitted.hidden === true);
    check('首页输入框已更新', submitted.topic.length > 0, submitted.topic);
    check('需求与输入一致', submitted.topic === NEED, submitted.topic);
    check('确实请求了 /api/tutor', tutorPosts.length >= 1, String(tutorPosts.length));
    const tutorBody = JSON.parse(tutorPosts[0].body || '{}');
    check('请求体带用户输入', tutorBody.input === NEED, JSON.stringify(tutorBody).slice(0, 220));
    await page.waitForFunction(() => {
      const btn = document.getElementById('start-button');
      const content = document.getElementById('lesson-content');
      return btn && !btn.disabled && content && content.textContent.trim().length > 60;
    }, { timeout: 30000 }).catch(() => {});
    const lesson = await page.evaluate(() => ({
      heading: (document.getElementById('lesson-heading') || {}).textContent,
      length: (document.getElementById('lesson-content') || {}).textContent.trim().length
    }));
    check('主流程生成了讲解内容', lesson.length > 60, JSON.stringify(lesson));
    await page.screenshot({ path: LESSON_SHOT, fullPage: false });
    check('讲解页截图已输出', fs.existsSync(LESSON_SHOT), LESSON_SHOT);

    console.log('\n【五】右下角形象 / 键盘也能唤起');
    const p4 = waitForTts(4);
    await page.click('#zd-dock [data-zd-chat]');
    await p4;
    check('点右下角知知同样打开弹框',
      await page.evaluate(() => document.getElementById('modal-backdrop').hidden === false));
    await page.click('#modal-close');
    await page.evaluate(() => document.querySelector('.zd-brand-mark [data-zd-chat]').focus());
    const p5 = waitForTts(5);
    await page.keyboard.press('Enter');
    await p5;
    check('键盘 Enter 也能唤起提问',
      await page.evaluate(() => document.getElementById('modal-backdrop').hidden === false));
    await page.click('#modal-close');

    console.log('\n【六】语音服务不存在 → 自动回退浏览器默认');
    await page.evaluate(async () => {
      const V = window.ZhidaoVoice;
      V.configure({ base: 'http://127.0.0.1:8899' });
      await Promise.resolve(V.refresh()).catch(() => {});
      window.__utterances = 0;
      const Orig = window.SpeechSynthesisUtterance;
      window.SpeechSynthesisUtterance = function (text) { window.__utterances += 1; return new Orig(text); };
    });
    await page.waitForFunction(() => window.ZhidaoVoice.status().available === false, { timeout: 15000 });
    const beforeOffline = ttsPosts.length;
    await page.click('#zd-dock [data-zd-chat]');
    await page.waitForFunction(() => window.__utterances >= 1, { timeout: 10000 }).catch(() => {});
    const offline = await page.evaluate(() => ({
      hidden: document.getElementById('modal-backdrop').hidden,
      line: (document.getElementById('zd-chat-line') || {}).textContent,
      voice: (document.getElementById('zd-chat-voice') || {}).textContent,
      utterances: window.__utterances,
      effective: window.ZhidaoVoice.status().effective
    }));
    check('服务离线时弹框照常打开', offline.hidden === false);
    check('弹框如实显示浏览器默认音色', /浏览器默认/.test(offline.voice || ''), offline.voice);
    check('朗读改走 SpeechSynthesisUtterance', offline.utterances >= 1, String(offline.utterances));
    check('离线后不再请求语音服务', ttsPosts.length === beforeOffline, `${beforeOffline} → ${ttsPosts.length}`);
    check('生效模式回退 browser', offline.effective === 'browser', offline.effective);
    await new Promise(resolve => setTimeout(resolve, 400));
    const offlineModal = await page.$('#modal-backdrop .modal');
    await offlineModal.screenshot({ path: OFFLINE_SHOT });
    check('离线弹框截图已输出', fs.existsSync(OFFLINE_SHOT), OFFLINE_SHOT);

    check('页面无脚本错误', pageErrors.length === 0, pageErrors.join(' | '));
    await page.evaluate(() => window.ZhidaoVoice.configure({ mode: 'browser', base: window.ZhidaoVoice.DEFAULT_BASE }));

    console.log(`\n点知知浏览器回归：${passed} 通过 / ${failed} 失败\n`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error('浏览器回归异常：', error);
  process.exitCode = 1;
});
