/* 知识展示 ↔ A2UI 主流程端到端回归（真实 Edge + MOCK 服务）
 *
 * 与画廊/演示页不同：这里直接打开 index.html 的真实 /api/tutor 主流程，
 * 验证语文 / 英语 / 数学三科课程渲染后，桥接层确实把 A2UI 组件挂进了知识展示，
 * 且组件交互能回写数据模型与知识卡片证据。
 *
 * 启动 MOCK： PORT=3100 API_MOCK=true CACHE_BACKEND=local CACHE_DIR=cache/test-a2ui-baseline node server.js
 * 运行：      npm run test:a2ui:bridge:browser
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.A2UI_BASE || 'http://127.0.0.1:3100';
const SHOTS = path.join(__dirname, 'cache', 'shots');

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
}

function disableServiceWorker() {
  const stub = {
    controller: null,
    register: () => Promise.resolve({ addEventListener() {}, installing: null }),
    addEventListener() {}, removeEventListener() {}, ready: Promise.resolve({})
  };
  try { Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: stub }); }
  catch { /* 忽略 */ }
}

/** 固定测试环境：语音与证据上报走 stub，避免真实朗读 / 网络请求干扰断言。 */
async function stubPage(page) {
  await page.evaluate(() => {
    window.__spoken = [];
    window.__evidence = [];
    window.speakText = t => { window.__spoken.push(String(t)); return true; };
    if (window.KNOWLEDGE) {
      window.KNOWLEDGE.practice = (correct, opts) => {
        window.__evidence.push({ correct, subject: opts?.subject, detail: opts?.detail });
      };
      window.KNOWLEDGE.record = payload => { window.__evidence.push({ record: payload?.type }); };
    }
    document.documentElement.style.scrollBehavior = 'auto';
    document.querySelectorAll('.zd-dock, .zd-dock-bubble').forEach(el => { el.style.display = 'none'; });
  });
}

async function openLesson(page, query, grade) {
  await page.evaluateOnNewDocument(g => {
    try { localStorage.setItem('zhidao.learner.grade', g); } catch { /* 隐私模式 */ }
  }, grade);
  await page.goto(`${BASE}/?t=${Date.now()}#q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ZHIDAO_A2UI_BRIDGE?.status().mounted === true, { timeout: 30000 });
  await stubPage(page);
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => ({
    status: window.ZHIDAO_A2UI_BRIDGE.status(),
    bridgeCount: document.querySelectorAll('.a2ui-bridge').length,
    bridgeInsideTwoColumn: !!document.querySelector('.two-column .a2ui-bridge'),
    p0Surface: !!window.ZHIDAO_A2UI_SURFACE,
    poemCount: document.querySelectorAll('.two-column .poem-item').length,
    label: document.querySelector('.a2ui-bridge-label')?.textContent.trim() || ''
  }));
}

async function shot(page, name) {
  const el = await page.$('.a2ui-bridge');
  if (!el) return;
  await el.screenshot({ path: path.join(SHOTS, name) });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1440, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.evaluateOnNewDocument(disableServiceWorker);

  try {
    console.log('\n一、语文：P0 展示保持原样，桥接组件区挂在其外');
    const cn = await openLesson(page, '开心', 'grade1');
    check('桥接层已挂载且只有一个组件区', cn.bridgeCount === 1, String(cn.bridgeCount));
    check('桥接区不在 .two-column 内（像素基线不受影响）', !cn.bridgeInsideTwoColumn);
    check('语文 P0 surface 仍在，诗句仍可见', cn.p0Surface && cn.poemCount > 0, `poem=${cn.poemCount}`);
    check('语文配方 = chinese.practice.early', cn.status.recipeKey === 'chinese.practice.early', cn.status.recipeKey);
    check('消息流 3 条、组件表非空', cn.status.messageCount === 3 && cn.status.componentCount > 0,
      `msg=${cn.status.messageCount} comp=${cn.status.componentCount}`);
    check('标题标注学科 / 过程 / 年级 / 组件数', cn.label.includes('语文') && cn.label.includes('低龄'), cn.label);
    // P1 服务端化：消息流由服务端编译下发，浏览器只 feed；标题对家长可见来源。
    check('消息流来自服务端（P1）', cn.status.source === 'server', cn.status.source);
    check('携带服务端 uiVersion', /^p1-/.test(cn.status.uiVersion), cn.status.uiVersion);
    check('标题标注消息流来源', cn.label.includes('消息流来自服务端'), cn.label);
    check('语文不触发数学游戏化关卡', cn.status.play === false);
    const blankCards = await page.$$eval('.a2ui-bridge-surface .content-card',
      cards => cards.filter(card => !card.textContent.trim()).length);
    check('组件区没有完全空白的卡片（空态有真实文案）', blankCards === 0, String(blankCards));
    await shot(page, 'bridge-chinese.png');

    console.log('\n二、英语：选项判断 → updateDataModel → 知识卡片证据');
    const en = await openLesson(page, 'play / do / go', 'grade1');
    check('英语配方 = english.practice.early', en.status.recipeKey === 'english.practice.early', en.status.recipeKey);
    check('组件区包含选择/练习类组件', en.status.components.some(n => /ChoiceQuiz|WordChips|WritingPad|PictureChoice/.test(n)),
      en.status.components.join(','));
    const clicked = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.a2ui-bridge .k-choice-button')];
      const target = buttons.find(btn => btn.textContent.trim().startsWith('do')) || buttons[0];
      if (target) target.click();
      return { count: buttons.length, text: target?.textContent.trim() || '' };
    });
    check('桥接区渲染出可选按钮', clicked.count > 0, JSON.stringify(clicked));
    await page.waitForFunction(() => {
      const s = window.ZHIDAO_A2UI_BRIDGE_SURFACE;
      return s && String(s.getData('/practice/feedback') || '').length > 0;
    }, { timeout: 8000 });
    const enAfter = await page.evaluate(() => ({
      feedback: window.ZHIDAO_A2UI_BRIDGE_SURFACE.getData('/practice/feedback'),
      tone: window.ZHIDAO_A2UI_BRIDGE_SURFACE.getData('/practice/tone'),
      evidence: window.__evidence.slice()
    }));
    check('答对后反馈写回数据模型', String(enAfter.feedback).includes('答对'), String(enAfter.feedback));
    check('反馈语气为 good', enAfter.tone === 'good', String(enAfter.tone));
    check('练习证据回写知识卡片', enAfter.evidence.some(e => e.correct === true && e.subject === 'english'),
      JSON.stringify(enAfter.evidence));
    await shot(page, 'bridge-english.png');

    console.log('\n三、数学：按条件触发游戏化关卡，真实点击可用');
    const math = await openLesson(page, 'x² - 5x + 6 = 0', 'grade1');
    check('数学配方 = math.reinforce.early', math.status.recipeKey === 'math.reinforce.early', math.status.recipeKey);
    check('触发条件命中：游戏化关卡已开启', math.status.play === true);
    check('关卡 6 个 P3 组件都已渲染', math.status.playComponentCount >= 6, String(math.status.playComponentCount));
    check('关卡场景容器存在', !!(await page.$('.a2ui-bridge .k-play-scene')));
    await page.click('.a2ui-bridge [data-a2ui-id="gap_bank_0"]');
    await page.click('.a2ui-bridge [data-a2ui-id="gap_bank_1"]');
    const filled = await page.$$eval('.a2ui-bridge .k-gap-slot.is-filled', nodes => nodes.length);
    check('点候选块 → 两个空格被填满', filled === 2, String(filled));
    await page.click('.a2ui-bridge [data-a2ui-id="gap_submitGaps"]');
    const submitted = await page.evaluate(() => ({
      feedback: window.ZHIDAO_A2UI_BRIDGE_PLAY_SURFACE?.model?.play?.feedback || '',
      stars: window.ZHIDAO_A2UI_BRIDGE_PLAY_SURFACE?.model?.play?.stars,
      events: window.ZHIDAO_A2UI_BRIDGE.status().lastEvent
    }));
    check('提交正确后给出鼓励反馈', String(submitted.feedback).length > 0, String(submitted.feedback));
    check('星星数增加', Number(submitted.stars) >= 2, String(submitted.stars));
    await page.click('.a2ui-bridge [data-a2ui-id="gap_askIP"]');
    const helped = await page.evaluate(() => ({
      unlocked: window.ZHIDAO_A2UI_BRIDGE_PLAY_SURFACE?.model?.play?.hintUnlocked,
      hintVoice: window.ZHIDAO_A2UI_BRIDGE_PLAY_SURFACE?.model?.play?.hintVoice || ''
    }));
    check('向知知求助只解锁第 1 级提示', Number(helped.unlocked) === 1, String(helped.unlocked));
    check('提示是真实文字而非直接给答案', String(helped.hintVoice).length > 0, String(helped.hintVoice));
    await page.click('.a2ui-bridge [data-a2ui-id="voice_play"]');
    const spoken = await page.evaluate(() => window.__spoken.slice());
    check('语音引导触发朗读', spoken.length > 0, JSON.stringify(spoken.slice(0, 2)));
    await shot(page, 'bridge-math.png');

    console.log('\n四、年级切换：同一份课程重新编译');
    await page.select('#learner-grade', 'grade8');
    // 切年级会连续触发 learnerchange / learnerrefresh（重渲染 + 重新请求课程），
    // 等最终一致态：状态、DOM 容器数量、标题都同步完成。
    await page.waitForFunction(() => {
      const label = document.querySelector('.a2ui-bridge-label');
      return window.ZHIDAO_A2UI_BRIDGE?.status().stage === 'teen'
        && document.querySelectorAll('.a2ui-bridge').length === 1
        && label && label.textContent.includes('初中');
    }, { timeout: 30000 });
    const teen = await page.evaluate(() => ({
      status: window.ZHIDAO_A2UI_BRIDGE.status(),
      htmlStage: document.documentElement.dataset.stage,
      containerCount: document.querySelectorAll('.a2ui-bridge').length,
      label: document.querySelector('.a2ui-bridge-label')?.textContent.trim() || ''
    }));
    check('年级切换后只有一个组件区（无重复残留）', teen.containerCount === 1, String(teen.containerCount));
    check('认知阶段切到 teen', teen.status.stage === 'teen' && teen.htmlStage === 'teen',
      `${teen.status.stage}/${teen.htmlStage}`);
    check('配方 key 随年级变化', teen.status.recipeKey === 'math.reinforce.teen', teen.status.recipeKey);
    check('组件组合重新编译', teen.status.components.join(',') !== math.status.components.join(','));
    check('标题年级标注同步更新', teen.label.includes('初中'), teen.label);
    // 切年级会重新请求课程，服务端按新年级重编消息流（不是浏览器本地重编）。
    check('切换年级后仍是服务端消息流', teen.status.source === 'server', teen.status.source);
    await shot(page, 'bridge-math-teen.png');

    console.log('\n五、页面无脚本错误');
    check('主流程未抛出 pageerror', pageErrors.length === 0, pageErrors.join(' | '));
  } finally {
    await browser.close();
  }

  console.log(`\n主流程桥接回归：${passed}/${passed + failed} 通过`);
  console.log(`截图：${['bridge-chinese.png', 'bridge-english.png', 'bridge-math.png', 'bridge-math-teen.png'].join(', ')}`);
  if (failed) process.exit(1);
})().catch(error => { console.error(error); process.exit(1); });
