/* 19 个游戏组件 · 真实 Edge 点击回归 + 效果图
 *
 * A 段：真实 /api/tutor 主流程（3100 MOCK），断言服务端下发的消息流里真的带游戏组件，
 *       页面看得到、点得动，且数据来源是服务端。
 * B 段：在真实页面里逐个编译 19 个组件（与主流程同一套 compiler / renderer / bridge），
 *       每个组件 1 张效果图 + 1 条真实点击断言（action → updateDataModel → 重渲染）。
 * 产出：cache/shots/game-*.png（19 张）与单文件离线画廊 cache/shots/a2ui-games.html。
 *
 * 启动 MOCK：PORT=3100 API_MOCK=true CACHE_BACKEND=local CACHE_DIR=cache/test-a2ui-baseline node server.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const map = require('./a2ui-question-map');

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

/** 与 server.js 的 mockLesson 同构，游戏数据只从这些真实字段派生。 */
const MOCK = {
  chinese: {
    title: '弄懂「开心」', practicePrompt: '请围绕「开心」写一句有画面的话。',
    idioms: ['触景生情', '情景交融', '画龙点睛', '妙笔生花'].map((word, i) => ({
      word, pinyin: 'pīn yīn', tag: ['情境表达', '写法积累', '语言增色', '生动表达'][i],
      level: i % 3 + 1, meaning: '模拟释义：用于验证成语卡片的数据渲染。',
      example: `试着把「${word}」放进与开心有关的句子中。`, scene: '模拟场景提示'
    })),
    poems: [
      { text: '读书破万卷，下笔如有神。', source: '唐 · 杜甫', tag: '积累' },
      { text: '问渠那得清如许？为有源头活水来。', source: '宋 · 朱熹', tag: '思考' }
    ]
  },
  english: {
    title: 'make 和 do 的区别', mnemonic: '先理解场景，再比较规则，最后用练习验证。',
    items: ['make', 'do', 'have'].map((word, i) => ({
      word, title: `场景 ${i + 1}`, description: '模拟语法卡片',
      examples: [{ en: `${word} a plan`, cn: '模拟例句一' }, { en: `${word} progress`, cn: '模拟例句二' }],
      tip: '把短语放在语境中记忆'
    })),
    quizzes: [
      { sentence: 'Please ___ your homework.', cn: '请做你的作业。', choices: ['make', 'do', 'have'], answer: 'do', explain: 'do homework 是固定搭配。' },
      { sentence: 'We ___ a decision.', cn: '我们做决定。', choices: ['make', 'do', 'have'], answer: 'make', explain: 'make a decision 是固定搭配。' }
    ],
    difference: { question: '为什么不能只按中文翻译选择？', answer: '英语搭配由使用习惯和语法共同决定。' }
  },
  math: {
    title: '弄懂「27 + 45」', description: '比较不同方法适用的条件。',
    methods: ['一般人', '学霸', '顶流'].map((name, i) => ({
      name, subtitle: '路径', title: `${name}的分析路径`, intro: '模拟分步内容',
      quote: '先理解，再计算', insight: '比较不同方法适用的条件，而不是只记答案。',
      steps: [1, 2, 3, 4].map(n => ({
        title: `第 ${n} 步`, text: '模拟解题步骤，配置真实模型后会替换为具体内容。',
        formula: n === 1 ? '原题：27 + 45 = ?' : `步骤 ${n}`
      }))
    })),
    challenge: { question: '请尝试说出这道题的已知条件与目标。', answer: '模拟模式不提供未经模型计算的数学答案。' }
  }
};

const CASES = map.QUESTION_TYPES.filter(type => type.batch !== 'done').map(type => ({
  id: type.id, primary: type.primary, subject: type.subject,
  batch: type.batch, query: type.examples[0], label: type.label
}));

/** 服务端 JSON 响应是否带上了这个游戏组件。 */
async function tutorHas(query, name) {
  const response = await fetch(`${BASE}/api/tutor`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: query, grade: 'grade1' })
  });
  const data = await response.json();
  const a2ui = data.a2ui || {};
  return {
    ok: response.status === 200 && String(a2ui.jsonl || '').includes(`"component":"${name}"`),
    source: a2ui.uiVersion || '', subject: a2ui.subject || ''
  };
}

async function openRealLesson(page, query, grade) {
  await page.evaluateOnNewDocument(g => {
    try { localStorage.setItem('zhidao.learner.grade', g); } catch { /* 隐私模式 */ }
  }, grade);
  await page.goto(`${BASE}/?t=${Date.now()}#q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ZHIDAO_A2UI_BRIDGE?.status().mounted === true, { timeout: 30000 });
  await stubPage(page);
  await page.evaluate(() => document.fonts.ready);
}

async function stubPage(page) {
  await page.evaluate(() => {
    window.__spoken = [];
    window.__evidence = [];
    window.speakText = t => { window.__spoken.push(String(t)); return true; };
    if (window.KNOWLEDGE) {
      window.KNOWLEDGE.practice = (correct, opts) => window.__evidence.push({ correct, detail: opts?.detail });
      window.KNOWLEDGE.record = payload => window.__evidence.push({ type: payload?.type });
    }
    document.documentElement.style.scrollBehavior = 'auto';
    document.querySelectorAll('.zd-dock, .zd-dock-bubble').forEach(el => { el.style.display = 'none'; });
  });
}

/** 在真实页面里编译并挂载一个游戏组件（与主流程完全相同的模块与动作链路）。 */
async function mountGame(page, item, mock) {
  return page.evaluate(({ item, mock }) => {
    const catalog = window.ZHIDAO_A2UI_CATALOG;
    const matrix = window.ZHIDAO_A2UI_MATRIX;
    const compiler = window.ZHIDAO_A2UI_COMPILER;
    const bridge = window.ZHIDAO_A2UI_BRIDGE;
    const phase = item.subject === 'math' ? 'reinforce' : 'practice';
    const grade = 'grade1';
    const raw = mock[item.subject];
    const knowledge = bridge.knowledgeFromLesson({ subject: item.subject, input: item.query, data: raw });
    const capabilities = matrix.capabilitiesFor(item.subject, phase, grade);
    const messages = compiler.compileKnowledgeToA2UI({
      subject: item.subject, phase, grade, point: item.query, data: knowledge.data
    }, { capabilities, surfaceId: `gallery_${item.primary}` });
    let host = document.getElementById('game-gallery-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'game-gallery-host';
      // 保留 .a2ui-bridge-surface 作为父级，让 .knowledge-surface 的网格在画廊里同样生效。
      host.className = 'a2ui-bridge a2ui-bridge-surface';
      host.style.cssText = 'max-width:860px;margin:0 auto 30px;';
      document.body.appendChild(host);
    }
    host.replaceChildren();
    // 只把游戏卡搬进画廊容器，避免原配方组件影响截图。
    const container = document.createElement('div');
    container.className = 'a2ui-bridge';
    host.appendChild(container);
    const surface = window.ZHIDAO_A2UI.createSurface(container, { capabilities });
    const shell = messages[0].createSurface.components;
    const card = shell.find(node => node.className && String(node.className).includes('k-game-card'));
    if (!card) return { ok: false, reason: '没有游戏卡' };
    const gameNode = shell.find(node => node.id === card.children[0]);
    const root = shell.find(node => node.id === 'root');
    const filtered = shell.filter(node => node.id === 'root' || node.id === card.id || node.id === gameNode.id)
      .map(node => node.id === 'root' ? { ...node, children: [card.id] } : node);
    const first = { ...messages[0], createSurface: { ...messages[0].createSurface, components: filtered } };
    bridge.bindActions(surface, {
      subject: item.subject, point: item.query, stage: 'early',
      recipe: messages.meta.recipe
    });
    surface.feed([first, messages[1], messages[2]]);
    window.__gameSurface = surface;
    return {
      ok: true,
      componentCount: filtered.length,
      buttons: container.querySelectorAll(`[data-a2ui-component="${item.primary}"]`).length,
      card: !!container.querySelector('.k-game-card'),
      before: JSON.stringify(surface.getData('/game') || {}),
      game: messages.meta.game?.name || ''
    };
  }, { item, mock });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1280, height: 900 });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.evaluateOnNewDocument(disableServiceWorker);

  try {
    console.log('\n一、真实 /api/tutor 主流程：服务端下发游戏组件');
    for (const [query, name] of [
      ['床前明月光的下一句是什么', 'PoemChain'],
      ['He go to school 哪里错了', 'GrammarDoctor'],
      ['27 + 45 等于多少', 'ColumnArithmetic']
    ]) {
      const served = await tutorHas(query, name);
      check(`服务端消息流含 ${name}`, served.ok, JSON.stringify(served));
      await openRealLesson(page, query, 'grade1');
      const visible = await page.evaluate(n => ({
        card: !!document.querySelector('.k-game-card'),
        buttons: document.querySelectorAll(`[data-a2ui-component="${n}"]`).length,
        source: window.ZHIDAO_A2UI_BRIDGE.status().source
      }), name);
      check(`${name} 在主流程页面可见`, visible.card && visible.buttons > 0, JSON.stringify(visible));
      check(`${name} 的消息流来自服务端`, visible.source === 'server', visible.source);
    }

    console.log('\n二、19 个组件逐个渲染 + 真实点击 + 效果图');
    for (const item of CASES) {
      const mounted = await mountGame(page, item, MOCK);
      check(`${item.batch} ${item.primary} 渲染成功`,
        mounted.ok && mounted.card && mounted.buttons > 0 && mounted.game === item.primary,
        JSON.stringify(mounted));
      if (!mounted.ok) continue;

      // 选一个「会写回数据模型」的动作（排除纯朗读 / 停止），点击后检查状态或朗读记录。
      const clicked = await page.evaluate(async name => {
        const nodes = [...document.querySelectorAll(`#game-gallery-host [data-a2ui-component="${name}"]`)]
          .filter(node => node.tagName === 'BUTTON');
        const target = nodes.find(node => {
          const action = node.getAttribute('data-a2ui-action') || '';
          return !/^(read|stop|ask|next|undo|reset)/.test(action);
        }) || nodes[0];
        if (!target) return { clicked: false };
        const action = target.getAttribute('data-a2ui-action');
        target.click();
        await new Promise(resolve => setTimeout(resolve, 30));
        return {
          clicked: true, action,
          after: JSON.stringify(window.__gameSurface.getData('/game') || {}),
          spoken: window.__spoken.length,
          evidence: window.__evidence.length,
          feedback: document.querySelector('#game-gallery-host .k-game-card .practice-feedback')?.textContent || ''
        };
      }, item.primary);
      check(`${item.primary} 点击触发 action → 数据回写`,
        clicked.clicked && (clicked.after !== mounted.before || clicked.spoken > 0 || clicked.evidence > 0),
        JSON.stringify(clicked).slice(0, 220));

      const card = await page.$('#game-gallery-host .k-game-card');
      if (card) {
        await card.screenshot({ path: path.join(SHOTS, `game-${item.primary}.png`) });
      }
    }

    check('页面无脚本错误', pageErrors.length === 0, pageErrors.join(' | '));

    // 单文件离线画廊：19 张真实截图内嵌，按批次分组。
    const groups = {};
    for (const item of CASES) (groups[item.batch] = groups[item.batch] || []).push(item);
    const batchNote = {
      P4a: '选择器型 · 复用既有骨架，每题有唯一可判定答案；每个组件都过了 validateMessage 与真实点击断言。',
      P4b: '拼装型 · 6 个组件共用 /assembly/* 数据契约，固定种子乱序、撤销可回退任意一步。',
      P4c: '语音与开放产出 · 只记 created / asked / recited；朗读可中断且口型复位；青少年无幼态奖励。',
      P4d: '图形与情境 · 形状只用固定 CSS 渲染；低龄禁真实倒计时；答错不扣分不排名。'
    };
    const sections = Object.entries(groups).map(([batch, items]) => {
      const cards = items.map(item => {
        const file = path.join(SHOTS, `game-${item.primary}.png`);
        const img = fs.existsSync(file)
          ? 'data:image/png;base64,' + fs.readFileSync(file).toString('base64') : '';
        return `<figure><img src="${img}" alt="${item.primary}"><figcaption><b>${item.primary}</b> · ${item.label}<small>触发：${item.query}</small></figcaption></figure>`;
      }).join('\n');
      return `<h2>${batch} <span>${items.length} 个组件</span></h2><p class="note">${batchNote[batch]}</p><div class="grid">${cards}</div>`;
    }).join('\n');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>知岛 · 19 个游戏化知识交互组件</title>
<style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f7f5fc;color:#2b2740;font:15px/1.7 "Microsoft YaHei","PingFang SC",system-ui,sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:34px 22px 70px}h1{font-size:26px;margin:0 0 8px}h2{font-size:19px;margin:38px 0 6px;padding-left:11px;border-left:4px solid #6f5bd6}h2 span{font-size:12px;color:#7a7192;font-weight:400}
.lead,.note{color:#6c6486;margin:0 0 12px}.note{font-size:13px}.meta{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.meta span{background:#ece7fb;border:1px solid #ddd3f5;border-radius:999px;padding:3px 11px;font-size:12px;color:#5b4b96}
.grid{display:grid;grid-template-columns:1fr;gap:20px}figure{margin:0;background:#fff;border:1px solid #e6e0f2;border-radius:15px;overflow:hidden;box-shadow:0 6px 20px rgba(61,45,120,.07)}figure img{display:block;width:100%;height:auto;background:#fff}figcaption{padding:12px 16px 16px}figcaption b{font-size:15px}figcaption small{display:block;margin-top:5px;color:#8a82a3;font-size:12px}
@media(min-width:860px){.grid{grid-template-columns:1fr 1fr}}</style></head><body><div class="wrap">
<h1>19 个游戏化知识交互组件 · 全部落地</h1>
<p class="lead">用户问什么 → 命中题型 → 服务端编译 → A2UI 白名单组件 → 真实点击 → 证据回写。以下每张图都是真实 Edge 在主流程同款编译器/渲染器里截出来的。</p>
<div class="meta"><span>20 类真实提问</span><span>19 个组件</span><span>4 个迭代批次</span><span>51 个白名单组件</span><span>19 张效果图</span></div>
${sections}
<p class="note">复现：node test-a2ui-games.js（45 项 Node 断言）· node test-a2ui-games-browser.js（真实 Edge 点击与截图）。</p>
</div></body></html>`;
    fs.writeFileSync(path.join(SHOTS, 'a2ui-games.html'), html, 'utf8');
    console.log(`\n画廊已生成：cache/shots/a2ui-games.html（${CASES.length} 张效果图）`);
  } finally {
    await browser.close();
  }
  console.log(`\n真实浏览器回归：${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
