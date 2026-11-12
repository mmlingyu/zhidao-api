/* 游戏化关卡交互演示采集 + 可交互单页交付
 *
 * 运行： node test-a2ui-play-shots.js
 * 产出： cache/shots/play-*.png（真实点击后的状态截图）
 *       cache/shots/a2ui-play.html（自包含：内嵌截图 + 可真实点击的关卡）
 *
 * 与 test-a2ui-gallery.js 的区别：画廊拍的是「组件长什么样」，
 * 这里拍的是「点下去会发生什么」——填空、提交庆祝、向知知求助逐级解锁、
 * 语音引导朗读、切换年级后的克制主题，都是浏览器里真实触发的。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = path.join(__dirname, 'cache', 'shots');
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const JS_FILES = ['grade-profile.js', 'a2ui-catalog.js', 'a2ui-render.js', 'a2ui-play.js'];

/* ---------- 可交互演示页（内联全部依赖，单文件即可运行） ---------- */
function buildDemoPage() {
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const sprite = (indexHtml.match(/<svg class="svg-sprite"[\s\S]*?<\/svg>/) || [''])[0];
  const js = JS_FILES.map(name => {
    const src = fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/<\/script>/gi, '<\\/script>');
    return `<script>/* ${name} */\n${src}\n</script>`;
  }).join('\n');
  const css = fs.readFileSync(path.join(__dirname, 'knowledge.css'), 'utf8');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>知岛 · 游戏化关卡交互演示</title>
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;background:#f4f1fb;color:#2b2740;
  font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
button{font-family:inherit;cursor:pointer}
.svg-sprite{position:absolute;width:0;height:0;overflow:hidden}
svg{width:1em;height:1em}
.wrap{max-width:900px;margin:0 auto;padding:18px 16px 40px}
.bar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:12px}
.bar h1{font-size:17px;margin:0 auto 0 0}
.bar button{padding:7px 13px;border:1px solid #d9d1ef;border-radius:8px;background:#fff;
  color:#5b3fa8;font-size:12px;font-weight:600}
.bar button.on{background:#5b3fa8;color:#fff;border-color:#5b3fa8}
#stage{border-radius:16px}
.gallery-root{display:block}
.content-card{margin:0}
.practice-feedback{display:none;margin:6px 0 0;font-size:12px;line-height:1.6}
.practice-feedback.show{display:block}
.practice-feedback.good{color:#2e9e6b}.practice-feedback.warn{color:#b26a1d}
.practice-feedback.info{color:#8b6fe0}
.status{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.status article{background:#fff;border:1px solid #e8e1f6;border-radius:11px;padding:11px 13px;min-width:0}
.status h3{margin:0 0 6px;font-size:12px;color:#5b3fa8}
.status p{margin:0;font-size:12px;line-height:1.6;color:#4a4360;word-break:break-word}
#log{margin:10px 0 0;padding:9px 12px;background:#241653;color:#e9e2ff;border-radius:11px;
  font:11px/1.7 ui-monospace,Consolas,monospace;max-height:132px;overflow:auto;white-space:pre-wrap}
.tip{margin:12px 0 0;font-size:12px;line-height:1.8;color:#7a7192}
.tip b{color:#5b3fa8}
</style>
<style>${css}</style>
</head><body>
${sprite}
<div class="wrap">
  <div class="bar">
    <h1>知岛 · 游戏化知识关卡（可真实点击）</h1>
    <button type="button" id="grade-early" class="on" data-grade="grade1">一年级</button>
    <button type="button" id="grade-teen" data-grade="grade8">初二</button>
  </div>
  <div id="stage"><div id="surface"></div></div>
  <div class="status">
    <article><h3>语音引导 / 知知动作</h3><p id="voice-line">还没开始，点左下角的小喇叭试试。</p></article>
    <article><h3>当前提示状态</h3><p id="hint-line">提示尚未解锁，点「我不会，找知知」。</p></article>
  </div>
  <div id="log">等待交互…</div>
  <p class="tip">点<b>候选数字块</b>填入空格 → <b>提交</b>触发庆祝与掌握证据 → <b>找知知</b>逐级解锁提示（不会一点就给答案）→ <b>语音胶囊</b>朗读题目与做法（自动联动知知口型）。切换到初二，同一组件树会换成克制的浅色工具界面。</p>
</div>
${js}
<script>
(function () {
  const logEl = document.getElementById('log');
  const voiceEl = document.getElementById('voice-line');
  const hintEl = document.getElementById('hint-line');
  const lines = [];
  function push(text) {
    lines.unshift(text);
    if (lines.length > 14) lines.length = 14;
    logEl.textContent = lines.join('\\n');
  }
  // 演示环境里的语音 / IP / 反馈替身：真实页面由 app.js、mascot.js、feedback.js 提供。
  window.speakText = function (value) {
    const text = String(value || '');
    if (!text.trim()) return false;
    voiceEl.textContent = '朗读：' + text;
    push('🔊 speak：' + text.slice(0, 30));
    return true;
  };
  window.ZhidaoMascot = {
    play(intent) { push('知知动作：' + intent); return this; },
    say(line) { if (line) push('知知说：' + String(line).slice(0, 26)); return this; }
  };
  const feedback = (kind) => function () { push('反馈：' + kind); return true; };
  window.ZHIDAO_FEEDBACK = {
    correct: feedback('答对'), wrong: feedback('答错'), effort: feedback('努力'),
    mastered: feedback('已掌握'), flip: feedback('翻卡')
  };
  window.KNOWLEDGE = { record(ev) { push('掌握证据：' + JSON.stringify(ev)); return true; } };

  let surface = null;
  let controller = null;
  function mount(grade) {
    if (controller) controller.destroy();
    const stage = window.ZHIDAO_GRADE.stageForGrade(grade).id;
    document.documentElement.dataset.stage = stage;
    document.documentElement.dataset.tone = stage === 'early' || stage === 'primary' ? 'child' : 'teen';
    document.documentElement.style.setProperty('--zd-stage-font',
      String(stage === 'early' ? 1.18 : stage === 'primary' ? 1.08 : stage === 'upper' ? 1 : 0.96));
    const host = document.getElementById('surface');
    host.replaceChildren();
    surface = window.ZHIDAO_A2UI.createSurface(host);
    surface.feed(window.ZHIDAO_PLAY.compilePlayStageToA2UI({ grade: grade }));
    controller = window.ZHIDAO_PLAY.createPlayController(surface, {
      stage: stage, subject: 'math',
      onEvent: function (event) {
        push('动作：' + event.name + (event.detail && event.detail.result ? ' → ' + event.detail.result : ''));
      }
    });
    // 把提示解锁状态镜像到状态条，方便截图看到「求助真的发生」。
    const render = surface.render.bind(surface);
    surface.render = function () {
      const out = render();
      const model = surface.model.play;
      hintEl.textContent = '已解锁 ' + model.hintUnlocked + ' / ' + model.hints.length +
        ' 条提示 · ' + (model.hintUnlocked ? model.hints[model.hintUnlocked - 1] : '点「我不会，找知知」开始');
      return out;
    };
    surface.render();
    voiceEl.textContent = '已切换到' + (stage === 'early' ? '一年级' : stage === 'teen' ? '初二' : stage) + '画像，等待语音引导。';
    push('挂载关卡：' + grade + ' / ' + stage);
  }
  document.querySelectorAll('[data-grade]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-grade]').forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      mount(btn.dataset.grade);
    });
  });
  mount('grade1');
  window.__DEMO_READY = true;
  window.__mount = mount;
})();
</script></body></html>`;
}

/* ---------- 采集真实点击状态 ---------- */
const STEPS = [
  { id: '01', file: 'play-01-initial.png', title: '① 一年级 · 关卡初始状态',
    desc: '深紫游戏化主题。空格未填、星星 1 颗、提示 0 级、知知在线待命，左下语音胶囊可听题目与做法。', actions: [] },
  { id: '02', file: 'play-02-filled.png', title: '② 点选候选块，填入两个空格',
    desc: '依次点「5」「6」，fillGap 动作把值写回 dataModel，填好的格子亮起黄绿边框；再点格子可取回。',
    actions: ['[data-a2ui-id="gap_bank_0"]', '[data-a2ui-id="gap_bank_1"]'] },
  { id: '03', file: 'play-03-correct.png', title: '③ 提交正确 · 星星与庆祝联动',
    desc: '点「我填好啦」：反馈变为鼓励、星星 +1、连对 +1、进度条前进，并触发 celebrate、知知开心动作与掌握证据记录。',
    actions: ['[data-a2ui-id="gap_submitGaps"]'] },
  { id: '04', file: 'play-04-help.png', title: '④ 向知知求助 · 只给第一级提示',
    desc: '重新进入关卡后点「我不会，找知知」：知知先说一句话并解锁第 1 条提示，绝不直接给答案；三级提示逐级展开。',
    actions: ['RESET', '[data-a2ui-id="gap_askIP"]'] },
  { id: '05', file: 'play-05-voice.png', title: '⑤ 语音引导 · 朗读题目并联动知知',
    desc: '点左下语音胶囊的播放按钮：readGuide 动作触发 speak 朗读题目，知知进入说话意图并同步口型（真实页面由 mascot.js 驱动）。',
    actions: ['[data-a2ui-id="voice_play"]'] },
  { id: '06', file: 'play-06-teen.png', title: '⑥ 同一关卡切到初二 · 游戏化退场',
    desc: '组件树一个没改，只换年级画像：浅色克制主题、星星收起、按钮变小、求助改名「查看思路提示」、题干要求写出判断依据。',
    actions: ['GRADE_TEEN'] }
];

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const pageHtml = buildDemoPage();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(pageHtml);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 180000,
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 980, height: 960, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(req.url())) req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__DEMO_READY === true, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    for (const step of STEPS) {
      for (const action of step.actions) {
        if (action === 'RESET') { await page.evaluate(() => window.__mount('grade1')); continue; }
        if (action === 'GRADE_TEEN') { await page.click('#grade-teen'); continue; }
        await page.click(action);
      }
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(SHOTS, step.file), fullPage: false });
      console.log(`  ✓ ${step.id}  ${step.title}`);
    }
    if (errors.length) throw new Error('页面脚本报错：\n' + errors.join('\n'));
    await page.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  /* ---------- 自包含交付页：截图 + 可交互演示区 ---------- */
  const img = file => `data:image/png;base64,${fs.readFileSync(path.join(SHOTS, file)).toString('base64')}`;
  const cards = STEPS.map(step => `
    <article class="shot-card">
      <h2>${esc(step.title)}</h2>
      <p>${esc(step.desc)}</p>
      <img src="${img(step.file)}" alt="${esc(step.title)}">
    </article>`).join('\n');
  const out = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>知岛 · 游戏化知识组件与 IP 求助交互案例</title>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:#f4f1fb;color:#2b2740;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.page{max-width:980px;margin:0 auto;padding:26px 18px 60px}
header h1{font-size:24px;margin:0 0 8px;color:#3b2a70}
header p{margin:0;font-size:13px;line-height:1.8;color:#7a7192}
.summary{margin:20px 0 26px;padding:16px 18px;background:#fff;border:1px solid #e8e1f6;border-radius:14px;font-size:13px;line-height:1.9}
.summary b{color:#5b3fa8}
.summary ul{margin:8px 0 0;padding-left:20px}
.shot-card{margin:0 0 26px;background:#fff;border:1px solid #e8e1f6;border-radius:14px;overflow:hidden}
.shot-card h2{margin:0;padding:14px 18px 6px;font-size:15px;color:#3b2a70}
.shot-card p{margin:0;padding:0 18px 12px;font-size:12px;line-height:1.75;color:#7a7192}
.shot-card img{display:block;width:100%;height:auto;border-top:1px solid #eee9f8}
.live{margin-top:30px;padding:18px;background:#fff;border:1px solid #e8e1f6;border-radius:14px}
.live h2{margin:0 0 8px;font-size:17px;color:#3b2a70}
.live>p{margin:0 0 14px;font-size:12px;color:#7a7192;line-height:1.8}
.frame{width:100%;height:900px;border:1px solid #e8e1f6;border-radius:12px;background:#f4f1fb}
footer{margin-top:26px;font-size:11px;color:#9a92b5;text-align:center}
</style></head><body><div class="page">
<header><h1>知岛 · 游戏化知识组件与「向知知求助」交互案例</h1>
<p>真实 Edge 渲染与真实点击采集 · ${new Date().toLocaleString('zh-CN')} · 6 个状态</p></header>
<div class="summary"><b>本轮新增 6 个组件</b>：NumberGaps（缺数填空）、QuestHUD（关卡星星）、VoiceGuide（语音引导）、AskIP（知知求助）、QuickQuestions（快捷提问）、HintLadder（分级提示）。catalog 现共 <b>32 个组件，32 个全部实现渲染器</b>。
<ul>
  <li><b>年级适配</b>：一年级是深紫游戏化、大数字块、口语提示、星星与强庆祝；初二同一组件树切换为浅色克制界面、收起星星、求助改名「查看思路提示」、题干要求写依据。</li>
  <li><b>语音引导</b>：题目与做法走 speak renderer function，真实页面自动联动知知的朗读口型同步；不会打字的孩子点小喇叭即可。</li>
  <li><b>IP 求助</b>：三级提示逐级解锁，前两级只给思路，第三级才揭晓答案；快捷提问用预设问题 + 预设答案，不交给模型即兴发挥。</li>
  <li><b>安全底线</b>：模型只提供 slots / bank / answers，组件名、文案、动作与样式全部由确定性编译器生成；所有字符串只进 textContent。</li>
</ul></div>
${cards}
<div class="live"><h2>自己动手试一试</h2>
<p>下面是一个<b>真实可交互</b>的关卡：点候选数字块、提交、找知知求助、点语音胶囊、切换年级。不是静态截图。</p>
<iframe class="frame" srcdoc="${esc(pageHtml)}" title="可交互关卡演示"></iframe></div>
<footer>知岛 · A2UI 游戏化组件 P3 · 截图内嵌 base64、演示区用 srcdoc 内联，单文件即可离线打开</footer>
</div></body></html>`;

  fs.writeFileSync(path.join(SHOTS, 'a2ui-play-demo.html'), pageHtml, 'utf8');
  fs.writeFileSync(path.join(SHOTS, 'a2ui-play.html'), out, 'utf8');
  console.log(`\n完成：${STEPS.length} 张交互截图 → ${path.join(SHOTS, 'a2ui-play.html')}`);
  console.log(`      可交互演示页 → ${path.join(SHOTS, 'a2ui-play-demo.html')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
