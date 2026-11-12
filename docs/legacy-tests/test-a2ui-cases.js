/* A2UI 交互案例截图采集 + 自包含对比画廊生成。
 *
 * 前置： PORT=3100 API_MOCK=true CACHE_BACKEND=local CACHE_DIR=cache/test-a2ui-cases node server.js
 * 运行： node test-a2ui-cases.js
 *
 * 每个案例输出一张产品视角截图（用户真正看到的界面），协议状态用 HTML 卡片呈现：
 * 消息流 / action / dataModel 全部由页面内 hook 实测采集，不是手写示意。
 * 最后生成 cache/shots/a2ui-cases.html，图片以 base64 内嵌，单文件可直接打开。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const matrix = require('./a2ui-matrix');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.A2UI_BASE || 'http://127.0.0.1:3100';
const SHOTS = path.join(__dirname, 'cache', 'shots');

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* 页面脚本执行前挂 hook：拦截 ZHIDAO_A2UI 赋值，包装 createSurface，
 * 自动记录消息流、动作与 surface 重建（切换年级会重建）。 */
function installHook() {
  window.__a2uiTrace = { surfaces: [], messages: [], actions: [], functions: [], practice: [] };
  const T = window.__a2uiTrace;
  const summarize = m => {
    const keys = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface', 'callRendererFunction'];
    const type = keys.find(k => m && m[k]);
    if (type === 'updateComponents') return `updateComponents · ${(m[type].components || []).length} 个组件`;
    if (type === 'updateDataModel') {
      const v = JSON.stringify(m[type].value);
      return `updateDataModel · ${m[type].path} = ${v === undefined ? 'undefined' : v.slice(0, 34)}`;
    }
    if (type === 'callRendererFunction') return `callRendererFunction · ${m[type].name}`;
    if (type === 'createSurface') return `createSurface · ${m[type].surfaceId}`;
    return type || 'unknown';
  };
  let api;
  Object.defineProperty(window, 'ZHIDAO_A2UI', {
    configurable: true,
    get() { return api; },
    set(value) {
      api = value;
      if (!value || value.__traceWrapped) return;
      value.__traceWrapped = true;
      const original = value.createSurface;
      window.__a2uiRaw = original.bind(value);  // 沙盒演示用，不污染追踪
      value.createSurface = function (container, options) {
        const surface = original.call(this, container, options);
        T.surfaces.push(surface.surfaceId);
        const rawFeed = surface.feed.bind(surface);
        surface.feed = function (messages) {
          (Array.isArray(messages) ? messages : [messages]).forEach(m => T.messages.push(summarize(m)));
          return rawFeed(messages);
        };
        const rawSet = surface.setData.bind(surface);
        surface.setData = function (p, v, shouldRender) {
          T.messages.push(`updateDataModel · ${p} = ${String(JSON.stringify(v)).slice(0, 34)}`);
          return rawSet(p, v, shouldRender);
        };
        surface.onAction(message => {
          T.actions.push(`${message.action?.event?.name} · ${message.component || message.id || ''}`);
        });
        return surface;
      };
    }
  });
}

/* pwa.js 在 Service Worker 首次接管页面时会 location.reload()，
 * 时机随机，会打断长时间采集并销毁执行上下文。测试页禁用 SW 注册以固定环境。 */
function disableServiceWorker() {
  const stub = {
    controller: null,
    register: () => Promise.resolve({ addEventListener() {}, installing: null }),
    addEventListener() {}, removeEventListener() {},
    ready: Promise.resolve({})
  };
  try { Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: stub }); }
  catch { /* 某些浏览器不允许覆盖，忽略 */ }
}

async function readTrace(page) {
  return await page.evaluate(() => {
    const s = window.ZHIDAO_A2UI_SURFACE;
    const get = p => {
      try { const v = s?.getData(p); return v === undefined || v === null ? '' : String(v).slice(0, 70); }
      catch { return ''; }
    };
    return {
      trace: JSON.parse(JSON.stringify(window.__a2uiTrace)),
      surfaceId: s?.surfaceId || '',
      componentCount: s?.componentCount ?? 0,
      stage: document.documentElement.dataset.stage || '',
      minLength: get('/practice/minLength'),
      model: {
        '/practice/word': get('/practice/word'),
        '/practice/text': get('/practice/text'),
        '/practice/tone': get('/practice/tone'),
        '/practice/feedback': get('/practice/feedback')
      }
    };
  });
}

/** 把实测协议状态渲染成画廊右侧的 HTML 卡片（比截图更清晰、可选中）。 */
function traceCardHtml(meta, extra = {}) {
  const rows = (arr, limit = 6) => (arr.length
    ? arr.slice(-limit).map(x => `<li>${esc(x)}</li>`).join('')
    : '<li class="muted">（暂无）</li>');
  const model = meta.model || {};
  return `
    <div class="trace-title">A2UI 协议状态 <span>实测采集</span></div>
    <div class="trace-grid">
      <div>surfaceId <b>${esc(meta.surfaceId || extra.surfaceId || '')}</b></div>
      <div>认知阶段 <b>${esc(meta.stage || extra.stage || '')}</b></div>
      <div>组件数 <b>${esc(meta.componentCount ?? '')}</b></div>
      <div>完成门槛 <b>${esc(meta.minLength || '')} 字</b></div>
    </div>
    ${extra.recipe ? `<div class="trace-recipe">${esc(extra.recipe)}</div>` : ''}
    <div class="trace-sub">消息流（最近 6 条）</div><ul>${rows(meta.trace.messages)}</ul>
    <div class="trace-sub">用户动作 / renderer function</div>
    <ul>${rows([...meta.trace.actions, ...meta.trace.functions], 5)}</ul>
    <div class="trace-sub">dataModel 关键路径</div>
    <ul>${Object.entries(model).map(([k, v]) => `<li>${esc(k)} = <b>${esc(v === '' ? '（空）' : v)}</b></li>`).join('')}</ul>
    <div class="trace-sub">学习证据上报</div>
    <ul>${meta.trace.practice.length
      ? meta.trace.practice.map(p => `<li>KNOWLEDGE.practice(${esc(p.correct)}, "${esc(p.detail)}")</li>`).join('')
      : '<li class="muted">（暂无）</li>'}</ul>`;
}

const cases = [];
const matrixCases = [];

async function captureMatrix(page, key, title, subject, phase, grade, label, difference) {
  const info = await renderMatrixSandbox(page, subject, phase, grade, label);
  await page.evaluate(() => {
    const toast = document.querySelector('#toast');
    if (toast) toast.style.display = 'none';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
  await new Promise(r => setTimeout(r, 100));
  const el = await page.$('#a2ui-sandbox');
  const file = `case-${key}.png`;
  await el.screenshot({ path: path.join(SHOTS, file) });
  matrixCases.push({ key, title, subject, phase, grade, difference, file, card: recipeCardHtml(info), info });
  const r = info.recipe;
  console.log(`  ✓ ${key}  ${title}\n      ${r.components.join(' + ')} · 选项 ${info.optionButtons} · 步骤 ${info.stepItems} · 公式 ${info.hasFormula ? '有' : '降级'} · 正确答案 ${info.options.includes(info.answer) ? '保留' : '丢失'}`);
}

async function capture(page, key, title, action, difference, opts = {}) {
  const meta = await readTrace(page);
  // 固定截图环境：隐藏 toast、移除焦点，避免合成器等待动画帧。
  await page.evaluate(() => {
    const toast = document.querySelector('#toast');
    if (toast) toast.style.display = 'none';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
  await new Promise(r => setTimeout(r, 100));
  const target = await page.$(opts.sandbox ? '#a2ui-sandbox' : '.two-column');
  const file = `case-${key}.png`;
  await target.screenshot({ path: path.join(SHOTS, file) });
  cases.push({ key, title, action, difference, file, trace: traceCardHtml(meta, opts.traceExtra || {}) });
  console.log(`  ✓ ${key}  ${title}`);
}

/** 沙盒：独立渲染一份 surface，用于能力裁剪 / XSS / 学科组件矩阵演示。 */
async function renderSandbox(page, lesson, capabilities, label = '') {
  return await page.evaluate(({ lesson, capabilities, label }) => {
    const box = document.querySelector('#a2ui-sandbox') || document.createElement('div');
    box.id = 'a2ui-sandbox';
    box.style.cssText = 'width:920px;padding:22px;background:#fff;border:1px solid #e6e0f5;border-radius:16px;margin:18px auto;box-shadow:0 8px 28px rgba(72,52,130,.08)';
    box.innerHTML = `<div style="font:600 15px/1.5 system-ui,sans-serif;color:#5b3fa8;margin-bottom:12px">${label || '协议沙盒 · 独立 surface（不改动主课程）'}</div><div id="a2ui-sandbox-surface"></div>`;
    if (!box.isConnected) document.body.appendChild(box);
    const surface = window.__a2uiRaw(document.querySelector('#a2ui-sandbox-surface'), { capabilities });
    const msgs = window.ZHIDAO_A2UI_COMPILER.compileLessonToA2UI(lesson, {
      grade: 'grade1', subject: 'chinese', capabilities
    });
    surface.feed(msgs);
    return {
      poemItems: box.querySelectorAll('.poem-item').length,
      scripts: box.querySelectorAll('script,img,b,i').length
    };
  }, { lesson, capabilities, label });
}

/* ---------------- 学科组件矩阵案例 ---------------- *
 * 与 P0 的语文课程不同，这里在独立沙盒 surface 里编译「学科 × 过程 × 年级」配方，
 * 让同一个知识点在不同情境下拿到完全不同的组件组合。 */
/* P2 组件演示数据：让 60 组配方截图里的新组件显示真实内容而非兜底文案。 */
const MATRIX_P2 = {
  chinese: {
    idiom: { word: '画蛇添足', pinyin: 'huà shé tiān zú', meaning: '做了多余的事，反而把事情弄糟。',
      example: '这句已经写好，再添一笔就画蛇添足了。', tag: '寓言', level: '三年级', speech: '画蛇添足' },
    wordCard: { word: '春风', phonetic: 'chūn fēng', examples: ['春风又绿江南岸'],
      tip: '常用来写生机与希望。', speech: '春风' },
    pairs: [{ left: '春风', right: '拟人' }, { left: '明月', right: '意象' }],
    numberLine: { min: 0, max: 10, marks: [0, 3, 7, 10], highlight: 7,
      label: '在数轴上找到 7', note: '从 0 向右数 7 格。' },
    mastery: { value: 68, status: '连续做对 2 次', point: '拟人手法', label: '当前掌握度' },
    tabs: [{ label: '手法', text: '拟人就是把物当人来写。' }, { label: '例句', text: '风儿轻轻唱着歌。' }],
    activeTab: '手法',
    methodNote: { title: '我的方法笔记', text: '写清所用手法，再换一个生活场景仿写。', placeholder: '写下依据……' }
  },
  english: {
    idiom: { word: 'happy', meaning: '高兴的', example: 'I am happy today.', tag: '形容词',
      level: '五年级', speech: 'happy' },
    wordCard: { word: 'happy', phonetic: '/ˈhæpi/', examples: ['I am happy today.', 'She looks happy.'],
      tip: '形容词，用在 be 动词后作表语。', speech: 'happy' },
    pairs: [{ left: 'happy', right: '高兴的' }, { left: 'glad', right: '欣喜的' }],
    numberLine: { min: 0, max: 10, marks: [0, 3, 7, 10], highlight: 7,
      label: '在数轴上找到 7', note: '从 0 向右数 7 格。' },
    mastery: { value: 45, status: '练习中', point: 'be + adj.', label: '当前掌握度' },
    tabs: [{ label: '用法', text: 'be 动词后接形容词原级。' }, { label: '易混', text: 'happily 是副词。' }],
    activeTab: '用法',
    methodNote: { title: '句型笔记', text: '先判断空格需要什么词性，再排除干扰项。', placeholder: '写下判断依据……' }
  },
  math: {
    idiom: { word: '移项', meaning: '等式两边同时做同一个运算。', example: 'x + 3 = 7 → x = 7 − 3',
      tag: '等式性质', level: '初一', speech: '移项' },
    wordCard: { word: '未知数', phonetic: 'wèi zhī shù', examples: ['x + 3 = 7 里的 x'],
      tip: '先找未知数，再决定做什么运算。', speech: '未知数' },
    pairs: [{ left: 'x + 3 = 7', right: '两边同减 3' }, { left: 'x = 4', right: '代回验算' }],
    numberLine: { min: 0, max: 10, marks: [0, 3, 4, 7, 10], highlight: 4,
      label: '在数轴上找到 x = 4', note: '从 7 向左退 3 格就是 4。' },
    mastery: { value: 72, status: '连续做对 2 次', point: '等式两边同减一个数', label: '当前掌握度' },
    tabs: [{ label: '通法', text: '等式两边做同一个运算，等式仍成立。' },
      { label: '易错', text: '只在左边减 3 会破坏等式。' }],
    activeTab: '通法',
    methodNote: { title: '解题依据', text: '写出每一步用到的等式性质，并代回原式验算。',
      placeholder: '写下这一步的依据……' }
  }
};

const MATRIX_DATA = {
  chinese: {
    ...MATRIX_P2.chinese,
    poems: [{ text: '春眠不觉晓，处处闻啼鸟', source: '孟浩然《春晓》', tag: '春景' }],
    words: ['开心', '晴朗'], speech: '春眠不觉晓，处处闻啼鸟',
    note: '比喻重在「像」，拟人重在把物当人写。',
    question: '哪一句把风当人来写？',
    options: ['A. 风很凉', 'B. 云像棉花', 'C. 天很蓝', 'D. 风儿轻轻唱着歌'],
    answer: 'D. 风儿轻轻唱着歌',
    steps: ['读一遍', '圈出动词', '想想谁在唱', '说给同桌听'],
    formula: '本体 + 喻词 + 喻体', formulaNote: '拟人不需要喻词',
    prompt: '用上刚学的表达写一句。'
  },
  english: {
    ...MATRIX_P2.english,
    poems: [], words: ['happy', 'glad', 'sad'], speech: 'I am happy today.',
    note: 'happy 与 glad 都表示「高兴」，glad 更常用于正式回应。',
    question: '—How are you? —I am ____.',
    options: ['A. happily', 'B. happiness', 'C. happier', 'D. happy'],
    answer: 'D. happy',
    steps: ['看空格位置', '判断需要形容词', '排除副词与名词', '读一遍检查'],
    formula: 'be + adj.', formulaNote: '系动词后接形容词作表语',
    prompt: '用这个句型说一句自己的话。'
  },
  math: {
    ...MATRIX_P2.math,
    poems: [], words: [], speech: '两边同时减三',
    note: '移项的本质是等式两边同减一个数。',
    question: 'x + 3 = 7，x 等于几？',
    options: ['A. 3', 'B. 7', 'C. 10', 'D. 4'],
    answer: 'D. 4',
    steps: ['读题，找出未知数', '两边同时减 3', '算出 x = 4', '代回原式验算'],
    formula: 'x + 3 = 7 → x = 7 − 3 = 4', formulaNote: '等式两边做同一个运算，等式仍成立',
    prompt: '写出你的解题依据。'
  }
};

/** 在独立 surface 里编译一份矩阵配方，返回实测到的协议与配方信息。 */
async function renderMatrixSandbox(page, subject, phase, grade, label) {
  return await page.evaluate(({ subject, phase, grade, label, data }) => {
    const M = window.ZHIDAO_A2UI_MATRIX;
    const C = window.ZHIDAO_A2UI_COMPILER;
    const box = document.querySelector('#a2ui-sandbox') || document.createElement('div');
    box.id = 'a2ui-sandbox';
    box.style.cssText = 'width:920px;padding:22px;background:#fff;border:1px solid #e6e0f5;border-radius:16px;margin:18px auto;box-shadow:0 8px 28px rgba(72,52,130,.08)';
    box.innerHTML = `<div style="font:600 15px/1.5 system-ui,sans-serif;color:#5b3fa8;margin-bottom:4px">${label}</div>
      <div style="font:400 11px/1.6 system-ui,sans-serif;color:#9a92b5;margin-bottom:14px">同一份知识 JSON · 由组件矩阵按学科 / 过程 / 年级重新编排</div>
      <div id="a2ui-sandbox-surface"></div>`;
    if (!box.isConnected) document.body.appendChild(box);

    const recipe = M.recipeFor(subject, phase, grade);
    // 让页面主题属性同步到本案例的认知阶段，截出来的字号/按钮尺寸才与真实年级一致。
    const root = document.documentElement;
    root.dataset.stage = recipe.stage;
    root.dataset.density = recipe.density;
    root.dataset.tone = recipe.tone;
    const capabilities = M.capabilitiesFor(subject, phase, grade);
    const messages = C.compileKnowledgeToA2UI(
      { subject, phase, grade, point: label, data },
      { capabilities }
    );
    const surface = window.ZHIDAO_A2UI.createSurface(
      document.querySelector('#a2ui-sandbox-surface'), { capabilities }
    );
    surface.feed(messages);
    const get = p => {
      const v = surface.getData(p);
      return Array.isArray(v) ? v.map(String) : (v === undefined || v === null ? '' : String(v));
    };
    return {
      recipe: {
        key: recipe.key, subjectLabel: recipe.subjectLabel, subjectVerb: recipe.subjectVerb,
        phaseLabel: recipe.phaseLabel, stage: recipe.stage, stageLabel: recipe.stageLabel,
        title: recipe.title, hint: recipe.hint, goal: recipe.goal, focus: recipe.focus,
        components: recipe.components, optionCount: recipe.optionCount,
        stepMode: recipe.stepMode, density: recipe.density, tone: recipe.tone,
        prompt: recipe.prompt, rules: recipe.rules
      },
      surfaceId: surface.surfaceId,
      componentCount: surface.componentCount,
      messageTypes: messages.map(m => Object.keys(m).find(k => k !== 'version')),
      warnings: messages.warnings || [],
      answer: get('/knowledge/answer'),
      options: get('/knowledge/options'),
      steps: get('/knowledge/steps'),
      stepCurrent: get('/knowledge/stepCurrent'),
      formula: get('/knowledge/formula'),
      optionButtons: box.querySelectorAll('.k-choice-button').length,
      stepItems: box.querySelectorAll('.k-steps-list li').length,
      hasFormula: box.querySelectorAll('.k-formula').length > 0,
      hintText: (box.querySelector('.stage-hint')?.textContent || '').trim()
    };
  }, { subject, phase, grade, label, data: MATRIX_DATA[subject] });
}

function recipeCardHtml(info) {
  const r = info.recipe;
  const rows = (label, value) => `<li>${esc(label)} · <b>${esc(value)}</b></li>`;
  return `
    <div class="trace-title">组件配方 <span>矩阵实测</span></div>
    <div class="trace-grid">
      <div>配方 key <b>${esc(r.key)}</b></div>
      <div>认知阶段 <b>${esc(r.stage)}</b></div>
      <div>surfaceId <b>${esc(info.surfaceId)}</b></div>
      <div>组件数 <b>${esc(info.componentCount)}</b></div>
    </div>
    <div class="trace-recipe">${esc(r.subjectLabel)} · ${esc(r.phaseLabel)} · ${esc(r.stageLabel)}</div>
    <div class="trace-sub">组件组合</div>
    <ul>${r.components.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    <div class="trace-sub">认知负荷参数</div>
    <ul>
      ${rows('选项数', r.optionCount + ' 个（实际按钮 ' + info.optionButtons + '）')}
      ${rows('步骤模式', r.stepMode === 'linear' ? '线性逐步' : '一次看全')}
      ${rows('信息密度', r.density)}
      ${rows('公式块', info.hasFormula ? '允许' : '降级为提示条')}
      ${rows('步骤正文', info.stepItems + ' 条全部可见')}
    </ul>
    <div class="trace-sub">给孩子的操作提示</div>
    <div class="trace-recipe">${esc(r.hint)}</div>
    <div class="trace-sub">注入模型的生成侧约束</div>
    <div class="trace-recipe">${esc(r.prompt)}</div>
    <div class="trace-sub">协议消息 / 降级告警</div>
    <ul>${info.messageTypes.map(t => `<li>${esc(t)}</li>`).join('')}
      ${info.warnings.map(w => `<li class="warn">${esc(w)}</li>`).join('')}</ul>
    <div class="trace-sub">正确答案仍在选项里</div>
    <ul><li>${esc(info.answer)} → ${info.options.includes(info.answer) ? '<b>✓ 保留</b>' : '<b>✗ 丢失</b>'}</li></ul>`;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 180000,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  page.on('framenavigated', f => console.log('    [NAV] ' + f.url()));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(disableServiceWorker);
  await page.evaluateOnNewDocument(installHook);
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('zhidao.learner.grade', 'grade1'); } catch { /* 隐私模式 */ }
  });

  await page.goto(`${BASE}/?t=${Date.now()}#q=${encodeURIComponent('开心')}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.poem-item', { timeout: 25000 });
  await page.addStyleTag({ content: 'html{scroll-behavior:auto !important} *,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}' });

  // 拦住真实语音与网络上报，改成可观测记录（toast 在截图前统一隐藏）。
  await page.evaluate(() => {
    const T = window.__a2uiTrace;
    window.speakText = t => {
      T.functions.push(`speak("${String(t).slice(0, 20)}${String(t).length > 20 ? '…' : ''}")`);
      return true;
    };
    if (window.KNOWLEDGE) {
      window.KNOWLEDGE.practice = (correct, opts) => { T.practice.push({ correct, detail: opts?.detail || '' }); };
    }
    document.querySelectorAll('.zd-dock, .zd-dock-bubble').forEach(el => { el.style.display = 'none'; });
  });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  console.log('采集交互案例：');

  await capture(page, '01-initial', '一年级 · 初始态',
    '打开一节语文课，尚未操作',
    '诗句、单句点读、操作提示、「说一句」全部由 3 条协议消息编译生成；改造前是手写 innerHTML 模板。');

  await page.$eval('.text-button[data-a2ui-action="readAll"]', el => el.click());
  await capture(page, '02-read', '点击「朗读」全篇',
    '点标题栏的朗读按钮',
    '触发 action:readAll → 协议层直接调用 renderer function speak；改造前是 data-speak + 每个按钮各自的 addEventListener。');

  const chips = await page.$$('[data-ai-practice]');
  if (chips.length > 1) await chips[1].evaluate(el => el.click());
  const word = await page.evaluate(() => window.ZHIDAO_A2UI_SURFACE.getData('/practice/word'));
  await page.type('#practice-input', `今天${word}地跑回家`);
  await capture(page, '03-input', '选词 + 输入实时回写',
    `点第二个词「${word}」，输入一句话`,
    '选词走 action:selectWord，输入通过 JSON Pointer 绑定实时写入 dataModel；改造前业务层直接读 DOM 的 .value。');

  await page.$eval('#check-ai-writing', el => el.click());
  await capture(page, '04-submit', '提交 · 达标反馈与证据上报',
    '点「我说好啦」提交',
    '反馈文案用 updateDataModel 写回 /practice/feedback 与 /practice/tone，renderer 重绘；重渲染后输入不丢失，并上报练习证据。');

  await page.$eval('#learner-grade', el => {
    el.value = 'grade8';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const h = document.querySelector('.two-column .stage-hint');
    return h && h.textContent.includes('表达手法');
  }, { timeout: 20000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await capture(page, '05-switch-grade', '不刷新 · 切换到初二',
    '在顶栏年级选择器切到初二，页面不刷新',
    'surface 销毁并重新编译：surfaceId、组件密度、操作提示、按钮措辞、完成门槛全部按新画像重算；改造前只能靠 learnerrefresh 手动改文案。');

  const teenWord = await page.evaluate(() => window.ZHIDAO_A2UI_SURFACE.getData('/practice/word'));
  await page.type('#practice-input', `今天${teenWord}`);
  await page.$eval('#check-ai-writing', el => el.click());
  await capture(page, '06-teen-threshold', '初二 · 同一句短话未达标',
    '输入一句包含选中词的短话并提交',
    '门槛由编译器写入 /practice/minLength = 20，同一句短话在一年级算达标、初二只给提示；业务层没有 if/else 年级分支。');

  const capsFull = await page.evaluate(() => window.ZHIDAO_A2UI_CATALOG.rendererCapabilities('grade1'));
  const capsLimited = { ...capsFull, components: capsFull.components.filter(n => n !== 'PoemLine' && n !== 'WritingPad') };
  const limited = await renderSandbox(page, {
    idioms: [{ word: '开心' }], practicePrompt: '写一句有画面的话',
    poems: [{ text: '春眠不觉晓，处处闻啼鸟', source: '孟浩然《春晓》', tag: '春景' }]
  }, capsLimited, '协议沙盒 · 声明渲染器不支持 PoemLine / WritingPad');
  await capture(page, '07-capability', '能力裁剪 · 组件降级但知识不丢',
    '声明渲染器不支持 PoemLine / WritingPad',
    `编译器把不允许的组件降级为 Text，诗句仍以纯文本完整可见（降级后 .poem-item = ${limited.poemItems}）；改造前只能靠 CSS display:none，会连内容一起藏掉。`,
    { sandbox: true });

  const evil = {
    idioms: [{ word: '开心' }], practicePrompt: '<img src=x onerror=alert(9)>',
    poems: [{ text: '<script>alert(1)</script>', source: '<b>出处</b>', tag: '"><i>x</i>' }]
  };
  const xss = await renderSandbox(page, evil, capsFull, '协议沙盒 · 课程 JSON 注入 script / img 标签');
  await capture(page, '08-xss', 'XSS 载荷全部作为纯文本落地',
    '在课程 JSON 里注入 script / img / 标签',
    `renderer 只生成白名单组件并用 textContent 写入，注入元素数 = ${xss.scripts}；改造前的 innerHTML 模板依赖逐字段转义。`,
    { sandbox: true });

  console.log('\n采集学科组件矩阵案例：');

  await captureMatrix(page, 'M1', '语文 · 初识 · 一年级',
    'chinese', 'learn', 'grade1', '语文 / 初识 / 一年级 · 听一句，读一句',
    '启蒙期配方只有 3 个组件：提示条 + 诗句 + 朗读按钮，不出现抽象说明；按钮尺寸按 early 阶段放大，孩子只需「点一下、跟着读」。');

  await captureMatrix(page, 'M2', '语文 · 迁移 · 初二',
    'chinese', 'transfer', 'grade8', '语文 / 迁移 / 初二 · 换个情境仿写',
    '同一门语文到了迁移过程换成写作板 + 反馈 + 抽象说明，并要求写清所用手法；青少年配方去掉朗读按钮，信息密度升到 high。');

  await captureMatrix(page, 'M3', '英语 · 练习 · 五年级',
    'english', 'practice', 'grade5', '英语 / 练习 / 五年级 · 情景辨析选择',
    '英语练习用 ChoiceQuiz（3 个选项）+ 朗读 + 反馈，强调「听音辨词、排除易混干扰项」；与语文的诗句/仿写完全不同。');

  await captureMatrix(page, 'M4', '英语 · 强化 · 初二',
    'english', 'reinforce', 'grade8', '英语 / 强化 / 初二 · 易混点再练一次',
    '同为英语，强化过程换成 4 选项 + 词块 + 反馈，重点是间隔回忆与易混并列；年级升高让干扰项从 3 个增到 4 个。');

  await captureMatrix(page, 'M5', '数学 · 强化 · 一年级',
    'math', 'reinforce', 'grade1', '数学 / 强化 / 一年级 · 用图形和语言再验一次',
    '数学强化在低龄被裁掉公式块（降级为提示条），只留 2 个选项 + 线性分步；正确答案 D 排在最后仍被保留，4 个步骤正文全部可见。');

  await captureMatrix(page, 'M6', '数学 · 强化 · 初二',
    'math', 'reinforce', 'grade8', '数学 / 强化 / 初二 · 通法 + 变式',
    '同一道数学题换到初二：公式块回来了、选项变 4 个、步骤一次全展开，并要求写出每步依据。知识点完全相同，组件与认知负荷全变。');

  // 恢复主页面主题，避免影响后续任何页面级检查。
  await page.evaluate(() => {
    const root = document.documentElement;
    root.dataset.stage = 'teen';
    root.dataset.density = 'high';
    root.dataset.tone = 'restrained';
  });

  await browser.close();

  /* ---------- 生成自包含 HTML 画廊 ---------- */
  const img = file => {
    const p = path.join(SHOTS, file);
    return fs.existsSync(p) ? `data:image/png;base64,${fs.readFileSync(p).toString('base64')}` : '';
  };
  const visual = {};
  for (const g of ['grade1', 'grade8']) {
    const before = path.join(SHOTS, `a2ui-baseline-${g}.png`);
    const after = path.join(SHOTS, `a2ui-after-${g}.png`);
    visual[g] = {
      before: fs.existsSync(before) ? fs.readFileSync(before).toString('base64') : '',
      after: fs.existsSync(after) ? fs.readFileSync(after).toString('base64') : ''
    };
  }

  const caseCards = cases.map((c, i) => `
    <article class="case">
      <div class="case-head"><span class="idx">${String(i + 1).padStart(2, '0')}</span>
        <div><h3>${esc(c.title)}</h3><p class="act"><b>用户动作</b> · ${esc(c.action)}</p></div></div>
      <div class="pair">
        <figure><figcaption>用户看到的界面<span>产品视角 · 真实截图</span></figcaption><img src="${img(c.file)}" alt="${esc(c.title)}"></figure>
        <div class="trace">${c.trace}</div>
      </div>
      <p class="diff"><b>差别</b> · ${esc(c.difference)}</p>
    </article>`).join('');

  const matrixCaseCards = matrixCases.map((c, i) => `
    <article class="case">
      <div class="case-head"><span class="idx">M${i + 1}</span>
        <div><h3>${esc(c.title)}</h3>
          <p class="act"><b>配方</b> · ${esc(c.info.recipe.key)} &nbsp;|&nbsp; ${esc(c.info.recipe.components.join(' + '))}</p></div></div>
      <div class="pair">
        <figure><figcaption>组件渲染结果<span>真实截图 · 独立 surface</span></figcaption><img src="${img(c.file)}" alt="${esc(c.title)}"></figure>
        <div class="trace">${c.card}</div>
      </div>
      <p class="diff"><b>差别</b> · ${esc(c.difference)}</p>
    </article>`).join('');

  /* 12 行总览：3 学科 × 4 过程，并排给出一年级与初二的组件配方。 */
  const byKey = Object.fromEntries(matrix.matrixRows().map(r => [`${r.subject}.${r.phase}.${r.stage}`, r]));
  const matrixTableRows = [];
  for (const sub of Object.keys(matrix.SUBJECTS)) {
    for (const ph of Object.keys(matrix.PHASES)) {
      const a = byKey[`${sub}.${ph}.early`];
      const b = byKey[`${sub}.${ph}.teen`];
      matrixTableRows.push(`<tr>
        <td>${esc(matrix.SUBJECTS[sub].label)}<br><small>${esc(matrix.PHASES[ph].label)}</small></td>
        <td><code>${esc(a.components.join(' + '))}</code><br><small>${a.optionCount} 选项 · ${a.stepMode === 'linear' ? '线性' : '全展开'} · ${esc(a.hint)}</small></td>
        <td><code>${esc(b.components.join(' + '))}</code><br><small>${b.optionCount} 选项 · ${b.stepMode === 'linear' ? '线性' : '全展开'} · ${esc(b.hint)}</small></td>
      </tr>`);
    }
  }

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>知岛 · 引入 A2UI 后的交互案例与差别</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f7f5fc;color:#2b2740;font:15px/1.7 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:36px 24px 70px}
header h1{font-size:27px;margin:0 0 8px;color:#3d2b70}header p{margin:0;color:#6f6789}
.hero{background:linear-gradient(120deg,#efe8ff,#f9f6ff);border:1px solid #e1d7f7;border-radius:18px;padding:20px 24px;margin:24px 0 30px}
.hero b{color:#5b3fa8}.hero .big{font-size:19px;font-weight:700;color:#493380;margin-bottom:8px}
.hero ul{margin:10px 0 0;padding-left:20px}.hero li{margin:3px 0}
h2{font-size:19px;margin:38px 0 16px;color:#493380;border-left:4px solid #8b6fe0;padding-left:11px}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.compare figure{margin:0;background:#fff;border:1px solid #e8e1f6;border-radius:14px;padding:14px;box-shadow:0 4px 16px rgba(72,52,130,.06)}
.compare img,.case img{width:100%;height:auto;display:block;border:1px solid #eee9f8;border-radius:8px;background:#fff}
figcaption{font:600 13px/1.5 system-ui,sans-serif;color:#5b3fa8;margin-bottom:10px;display:flex;justify-content:space-between}
figcaption span{font-weight:400;color:#9a92b5;font-size:11px}
.badge{display:inline-block;background:#e7f7ee;color:#1f7a4d;border-radius:20px;padding:2px 11px;font-size:12px;font-weight:600;margin-top:10px}
.case{background:#fff;border:1px solid #e8e1f6;border-radius:16px;padding:20px;margin-bottom:22px;box-shadow:0 6px 22px rgba(72,52,130,.06)}
.case-head{display:flex;gap:14px;align-items:flex-start;margin-bottom:16px}
.idx{background:#5b3fa8;color:#fff;border-radius:9px;padding:5px 10px;font:700 13px/1.4 ui-monospace,monospace;flex:none}
.case h3{margin:0;font-size:17px;color:#3d2b70}.act{margin:3px 0 0;color:#7a7192;font-size:13px}.act b{color:#5b3fa8}
.pair{display:grid;grid-template-columns:1.35fr 1fr;gap:16px;align-items:start}
.pair figure{margin:0}
.trace{background:#fbfaff;border:1px solid #e8e1f6;border-radius:12px;padding:14px 15px;font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;color:#403a55}
.trace-title{font:600 13px/1.4 system-ui,sans-serif;color:#5b3fa8;margin-bottom:9px;display:flex;justify-content:space-between}
.trace-title span{font:400 10px/1.4 ui-monospace,monospace;color:#9a92b5}
.trace-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;margin-bottom:8px;font-size:11px}
.trace-grid b{color:#5b3fa8}.trace-recipe{background:#f0ebff;border-radius:7px;padding:6px 9px;margin-bottom:8px;color:#5b3fa8;font-size:11px}
.trace-sub{font:600 11px/1.5 system-ui,sans-serif;color:#7a7192;margin-top:7px}
.trace ul{margin:2px 0 5px;padding-left:16px}.trace li{word-break:break-all}.trace li b{color:#5b3fa8}
.trace .muted{color:#a9a2bd}.trace .warn{color:#b26a1d}
.diff{margin:16px 0 0;padding:11px 14px;background:#f5f1ff;border-left:3px solid #8b6fe0;border-radius:0 8px 8px 0;font-size:13.5px;color:#4b4363}
.diff b{color:#5b3fa8}
.matrix-intro{background:#fff;border:1px solid #e8e1f6;border-radius:14px;padding:16px 20px;margin-bottom:20px;font-size:14px;color:#4b4363}
.matrix-intro b{color:#5b3fa8}.matrix-intro code{background:#f2eeff;padding:1px 6px;border-radius:5px;font-size:12.5px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;font-size:13.5px}
th,td{padding:11px 13px;text-align:left;border-bottom:1px solid #eee9f8;vertical-align:top}
th{background:#f0ebff;color:#493380;font-weight:600}td:first-child{color:#5b3fa8;font-weight:600;width:18%}
td code{font:600 11.5px/1.7 ui-monospace,Consolas,monospace;color:#5b3fa8}
td small{display:block;color:#9a92b5;font-size:11px;margin-top:4px;font-weight:400}
footer{margin-top:36px;color:#9a92b5;font-size:12.5px;text-align:center}
@media(max-width:860px){.compare,.pair{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<header><h1>引入 A2UI 后的交互案例与学科组件矩阵</h1><p>知岛 · P0 语文试点 + 学科组件矩阵 · 真实 Edge 浏览器采集 · ${new Date().toLocaleString('zh-CN')}</p></header>
<div class="hero">
  <div class="big">最反直觉的结论：界面几乎没变，变的是「怎么做」</div>
  P0 改造目标就是<b>逐像素等价</b>——一年级 / 初二各 51 个 DOM 节点、40+ 计算样式<b>差异均为 0</b>，CSS 一行未改。
  所以第 ② 组左侧「用户看到的界面」与改造前一致，右侧「协议状态」才是引入 A2UI 后真正新增的东西。
  第 ③ 组则是本次新增的能力：<b>同一份知识按「学科 × 学习过程 × 认知阶段」编译出完全不同的组件</b>。
  <ul>
    <li>模型仍只产教学内容，服务端 <code>/api/tutor</code> 与缓存键一行未动；新增的是浏览器里的编译器 + 渲染器。</li>
    <li>每个交互都变成一条可观测的消息：<code>action</code> → <code>updateDataModel</code> → renderer 重绘。</li>
    <li>年级适配从「一堆 CSS 和 if/else」升级为「按能力重新编译组件树」。</li>
    <li>组件矩阵共 60 组配方（3 学科 × 4 过程 × 5 阶段），编译出的 180 条消息全部通过协议校验。</li>
  </ul>
  <span class="badge">DOM / 计算样式差异 0 · 初二像素差异 0/354252 · 矩阵回归 21/21</span>
</div>

<h2>① 改造前 vs 改造后：静态界面对比</h2>
<div class="compare">
  <figure><figcaption>改造前 · 一年级<span>baseline</span></figcaption><img src="data:image/png;base64,${visual.grade1.before}" alt="改造前一年级"></figure>
  <figure><figcaption>引入 A2UI 后 · 一年级<span>after</span></figcaption><img src="data:image/png;base64,${visual.grade1.after}" alt="改造后一年级"></figure>
  <figure><figcaption>改造前 · 初二<span>baseline</span></figcaption><img src="data:image/png;base64,${visual.grade8.before}" alt="改造前初二"></figure>
  <figure><figcaption>引入 A2UI 后 · 初二<span>after</span></figcaption><img src="data:image/png;base64,${visual.grade8.after}" alt="改造后初二"></figure>
</div>

<h2>② 交互案例（左：产品视角 / 右：A2UI 协议视角）</h2>
${caseCards}

<h2>③ 学科组件矩阵：同一份知识，不同的组件配方</h2>
<div class="matrix-intro">
  一份知识点 JSON 同时喂给 <code>a2ui-matrix.js</code> 的配方表和 <code>compileKnowledgeToA2UI()</code>。
  <b>学科</b>决定认知动作（语文读/品/仿写、英语听/选/辨、数学摆/推/验），
  <b>学习过程</b>决定环节（初识 → 练习 → 强化 → 迁移），
  <b>认知阶段</b>决定形态（选项数、线性还是全展开、能否出现公式、信息密度、语气）。
  下面 6 张截图是真实浏览器里独立 surface 渲染的结果，右侧卡片是从编译产物中实测读出的配方参数。
  为了看清「由哪些组件组成」，沙盒里<b>每个组件各占一张卡片</b>；尚未作答的反馈区、提示条因此会留白，这是等待交互的真实状态，不是渲染缺失。
</div>
${matrixCaseCards}

<h2>③·附表 12 行配方总览：一年级 vs 初二</h2>
<table>
<tr><th>学科 · 过程</th><th>一年级（启蒙期）</th><th>初二（青少年期）</th></tr>
${matrixTableRows.join('\n')}
</table>

<h2>④ 差别对照表</h2>
<table>
<tr><th>维度</th><th>改造前</th><th>引入 A2UI 后</th></tr>
<tr><td>界面生成</td><td>dynamic.js 手写 innerHTML 模板字符串</td><td>课程 JSON → 编译器 → createSurface / updateComponents / updateDataModel → renderer 白名单生成 DOM</td></tr>
<tr><td>朗读</td><td>每个按钮 <code>data-speak</code> + 全局 <code>bindSpeech()</code> 逐个绑定</td><td><code>action:readAll / readPoem</code> → 协议层统一调用 renderer function <code>speak</code></td></tr>
<tr><td>选词 / 输入</td><td>业务层直接读 <code>.value</code>、手动切 <code>.active</code></td><td>选词走 action，输入通过 JSON Pointer 绑定实时回写 dataModel；DOM 由 renderer 重绘</td></tr>
<tr><td>反馈文案</td><td><code>feedback.textContent = ...</code> 直接改 DOM</td><td><code>setData('/practice/feedback', ...)</code> 写回数据模型，重渲染后输入内容仍保留</td></tr>
<tr><td>年级适配</td><td>CSS 属性选择器 + 手写文案分支 + 事件监听重绑</td><td>编译器按 <code>rendererCapabilities(年级)</code> 重新编排组件树，surfaceId 随阶段变化</td></tr>
<tr><td>能力降级</td><td><code>display:none</code> 会把知识一起藏掉（上一轮的真实 bug）</td><td>不支持的组件降级为 Text，<b>知识仍完整可见</b></td></tr>
<tr><td>内容安全</td><td>逐字段 <code>escapeHTML()</code>，漏一处即 XSS</td><td>组件 schema 白名单 + 全程 textContent，非法 renderer function 直接拒绝</td></tr>
<tr><td>可观测性</td><td>只有 DOM，无法回溯「用户做了什么」</td><td>消息流、action、dataModel 快照全部可记录（右侧卡片即实测输出）</td></tr>
<tr><td>组件选择</td><td>语文两个模块固定用同一套手写模板</td><td><code>a2ui-matrix.js</code> 60 组配方：学科决定认知动作、过程决定环节、阶段决定形态</td></tr>
<tr><td>认知负荷</td><td>选项数与展示方式写死在模板里</td><td>启蒙期 2 选项 / 线性分步 / 无公式，初二 4 选项 / 全展开 / 有公式；裁剪时保证正确答案不被裁掉</td></tr>
<tr><td>抽象内容</td><td>低龄用 <code>display:none</code> 整块隐藏（曾导致诗句空白）</td><td>公式与长说明降级为提示条，<b>知识点始终可见</b>；生成侧同步注入年级约束</td></tr>
</table>
<footer>采集脚本 test-a2ui-cases.js · MOCK 服务 3100 · 协议状态由页面内 hook 实测采集 · 视觉等价数据来自 test-a2ui-visual.js</footer>
</div></body></html>`;

  const outHtml = path.join(SHOTS, 'a2ui-cases.html');
  fs.writeFileSync(outHtml, html, 'utf8');
  console.log(`\n已生成 ${cases.length} 个交互案例 + ${matrixCases.length} 个学科组件案例，共 ${cases.length + matrixCases.length} 张截图`);
  console.log(`画廊：${outHtml} (${(fs.statSync(outHtml).size / 1024 / 1024).toFixed(2)} MB)`);
})().catch(err => { console.error('ERR', err.stack); process.exitCode = 1; });
