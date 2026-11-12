/* A2UI P0 浏览器交互回归（真实 Edge，需要 MOCK 服务在 3100 端口）
 * 启动： PORT=3100 API_MOCK=true CACHE_BACKEND=local CACHE_DIR=cache/test-a2ui-baseline node server.js
 * 运行： node test-a2ui-browser.js
 */
'use strict';

const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.A2UI_BASE || 'http://127.0.0.1:3100';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
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
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.evaluateOnNewDocument(disableServiceWorker);
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('zhidao.learner.grade', 'grade1'); } catch { /* 隐私模式 */ }
  });
  await page.goto(`${BASE}/?t=${Date.now()}#q=${encodeURIComponent('开心')}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.poem-item', { timeout: 25000 });
  // 测试环境固定：关掉平滑滚动（否则坐标点击会在滚动动画中落空），
  // 并隐藏悬浮吉祥物（真实用户可绕开，但自动化点按会被它挡住）。
  await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });

  // 用 stub 拦住真实语音与网络上报，只验证协议链路是否走通。
  await page.evaluate(() => {
    window.__spoken = [];
    window.speakText = t => { window.__spoken.push(String(t)); return true; };
    window.__practice = null;
    if (window.KNOWLEDGE) window.KNOWLEDGE.practice = (correct, opts) => { window.__practice = { correct, ...opts }; };
    document.querySelectorAll('.zd-dock, .zd-dock-bubble').forEach(el => { el.style.display = 'none'; });
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  console.log('\n一、surface 已接管两个模块');
  const initial = await page.evaluate(() => {
    const s = window.ZHIDAO_A2UI_SURFACE;
    return {
      hasSurface: !!s,
      surfaceId: s?.surfaceId,
      componentCount: s?.componentCount,
      poemCount: document.querySelectorAll('.poem-item').length,
      readButtons: document.querySelectorAll('.poem-read').length,
      chips: document.querySelectorAll('[data-ai-practice]').length,
      hint: document.querySelector('.two-column .stage-hint')?.textContent.trim(),
      title: [...document.querySelectorAll('.practice-card .card-title h4')].map(n => n.textContent.trim())[0],
      button: document.querySelector('#check-ai-writing')?.textContent.trim(),
      minLength: s?.getData('/practice/minLength'),
      poemSpeech: s?.getData('/lesson/poemSpeech')
    };
  });
  check('surface 存在且组件表完整', initial.hasSurface && initial.componentCount >= 10, `count=${initial.componentCount}`);
  check('surfaceId 符合协议命名', /^zhidao_chinese_early$/.test(initial.surfaceId || ''), initial.surfaceId);
  check('诗句与单句朗读按钮一一对应', initial.poemCount > 0 && initial.readButtons === initial.poemCount);
  check('词芯片已渲染', initial.chips > 0, `chips=${initial.chips}`);
  check('一年级栏目提示正确', (initial.hint || '').includes('听一句'), initial.hint);
  check('一年级练习标题为「说一句」', (initial.title || '').includes('说一句'), initial.title);
  check('一年级门槛为 1 字', initial.minLength === 1, String(initial.minLength));
  check('朗读串接无双重句号', !(initial.poemSpeech || '').includes('。。'), initial.poemSpeech);

  console.log('\n二、朗读 action → renderer function speak');
  await page.click('.text-button[data-a2ui-action="readAll"]');
  await page.click('.poem-read');
  const spoken = await page.evaluate(() => window.__spoken.slice());
  check('朗读全部触发一次 speak', spoken[0] === initial.poemSpeech, spoken[0]);
  check('单句朗读文本与可见诗句同源', spoken[1] && (await page.$eval('.poem-item blockquote', n => n.textContent.trim())) === spoken[1], spoken[1]);

  console.log('\n三、选词 / 输入 / 提交 → updateDataModel 与证据');
  const chips = await page.$$('[data-ai-practice]');
  if (chips.length > 1) await chips[1].click();
  const chipState = await page.evaluate(() => ({
    word: window.ZHIDAO_A2UI_SURFACE.getData('/practice/word'),
    active: [...document.querySelectorAll('[data-ai-practice]')].findIndex(n => n.classList.contains('active'))
  }));
  check('选词写入 dataModel', typeof chipState.word === 'string' && chipState.word.length > 0, chipState.word);
  check('选中项高亮同步', chipState.active === 1, String(chipState.active));

  await page.type('#practice-input', `今天${chipState.word}地跑回家`);
  const typed = await page.evaluate(() => window.ZHIDAO_A2UI_SURFACE.getData('/practice/text'));
  check('输入实时写回 dataModel', typed === `今天${chipState.word}地跑回家`, typed);

  await page.click('#check-ai-writing');
  const afterSubmit = await page.evaluate(() => ({
    feedback: document.querySelector('#practice-feedback')?.textContent.trim(),
    cls: document.querySelector('#practice-feedback')?.className,
    tone: window.ZHIDAO_A2UI_SURFACE.getData('/practice/tone'),
    practice: window.__practice,
    text: document.querySelector('#practice-input')?.value
  }));
  check('反馈通过 updateDataModel 渲染', (afterSubmit.feedback || '').includes('已记录这次练习'), afterSubmit.feedback);
  check('反馈样式为 show good', (afterSubmit.cls || '').includes('show') && (afterSubmit.cls || '').includes('good'), afterSubmit.cls);
  check('达标后上报练习证据', afterSubmit.practice && afterSubmit.practice.correct === true);
  check('重渲染后输入内容不丢失', afterSubmit.text === typed, afterSubmit.text);

  console.log('\n四、切换年级（不刷新）→ 重新编译');
  await page.select('#learner-grade', 'grade8');
  await page.waitForFunction(() => {
    const hint = document.querySelector('.two-column .stage-hint');
    return hint && hint.textContent.includes('表达手法');
  }, { timeout: 20000 });
  const teen = await page.evaluate(() => {
    const s = window.ZHIDAO_A2UI_SURFACE;
    return {
      hint: document.querySelector('.two-column .stage-hint')?.textContent.trim(),
      title: document.querySelector('.practice-card .card-title h4')?.textContent.trim(),
      button: document.querySelector('#check-ai-writing')?.textContent.trim(),
      minLength: s?.getData('/practice/minLength'),
      surfaceId: s?.surfaceId,
      poemsVisible: getComputedStyle(document.querySelector('.poem-list')).display !== 'none',
      poemCount: document.querySelectorAll('.poem-item').length
    };
  });
  check('提示切换为手法分析', (teen.hint || '').includes('表达手法'), teen.hint);
  check('标题切换为迁移仿写', (teen.title || '').includes('迁移仿写'), teen.title);
  check('按钮切换为提交并自检', (teen.button || '').includes('提交并自检'), teen.button);
  check('门槛升到 20 字', teen.minLength === 20, String(teen.minLength));
  check('surfaceId 随阶段变化', teen.surfaceId === 'zhidao_chinese_teen', teen.surfaceId);
  check('切换后诗句仍可见', teen.poemsVisible && teen.poemCount > 0);

  console.log('\n五、安全与协议边界');
  const safety = await page.evaluate(() => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const evil = {
      idioms: [{ word: '开心' }],
      practicePrompt: '<img src=x onerror=alert(9)>',
      poems: [{ text: '<script>alert(1)</script>', source: '<b>出处</b>', tag: '"><i>x</i>' }]
    };
    const caps = window.ZHIDAO_A2UI_CATALOG.rendererCapabilities('grade1');
    const msgs = window.ZHIDAO_A2UI_COMPILER.compileLessonToA2UI(evil, { grade: 'grade1', capabilities: caps });
    const surface = window.ZHIDAO_A2UI.createSurface(div, { capabilities: caps });
    surface.feed(msgs);
    const result = {
      scripts: div.querySelectorAll('script, img, b, i').length,
      hasEvilText: div.textContent.includes('<script>alert(1)</script>'),
      renderCount: surface.componentCount
    };
    // renderer function 白名单
    let illegalRejected = false;
    try { surface.feed({ version: '1.0', callRendererFunction: { name: 'openUrl', args: {} } }); }
    catch { illegalRejected = true; }
    surface.feed({ version: '1.0', callRendererFunction: { name: 'speak', args: { text: '协议朗读' } } });
    result.speakCalled = window.__spoken[window.__spoken.length - 1] === '协议朗读';
    result.illegalRejected = illegalRejected;
    // deleteSurface
    surface.feed({ version: '1.0', deleteSurface: { surfaceId: surface.surfaceId } });
    result.cleared = div.children.length === 0;
    // 能力裁剪：禁用 PoemLine 后知识仍以 Text 呈现
    const limited = { ...caps, components: caps.components.filter(n => n !== 'PoemLine') };
    const limitedMsgs = window.ZHIDAO_A2UI_COMPILER.compileLessonToA2UI(evil, { grade: 'grade1', capabilities: limited });
    const div2 = document.createElement('div');
    document.body.appendChild(div2);
    window.ZHIDAO_A2UI.createSurface(div2, { capabilities: limited }).feed(limitedMsgs);
    result.noPoemLine = div2.querySelectorAll('.poem-item').length === 0;
    result.knowledgeStillVisible = div2.textContent.includes('<script>alert(1)</script>');
    div.remove(); div2.remove();
    return result;
  });
  check('XSS 载荷全部作为文本落地', safety.scripts === 0 && safety.hasEvilText, JSON.stringify(safety));
  check('非法 renderer function 被拒绝', safety.illegalRejected);
  check('合法 renderer function 生效', safety.speakCalled);
  check('deleteSurface 清空容器', safety.cleared);
  check('能力裁剪后不生成 PoemLine', safety.noPoemLine);
  check('能力裁剪后知识仍可见（不隐藏）', safety.knowledgeStillVisible);

  check('页面无未捕获 JS 异常', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  console.log(`\n浏览器交互验证：${passed} 通过 / ${failed} 失败\n`);
  if (failed) process.exitCode = 1;
})().catch(err => { console.error('ERR', err.stack); process.exitCode = 1; });
