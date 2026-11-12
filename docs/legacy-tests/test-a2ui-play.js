/* 游戏化关卡 / 语音引导 / 知知求助 回归（纯 Node，不依赖浏览器与服务）
 * 运行：node test-a2ui-play.js
 *
 * 覆盖五条底线：
 *   ① 6 个新组件全部登记、全部有 renderer 实现、消息在各年级都过协议校验；
 *   ② 年级差异真实存在（文案 / 求助按钮 / 星星 / 紧凑模式 / 主题），不是同一套 UI 换个标题；
 *   ③ 求助不直接给答案：初始 0 级，逐级解锁，最后一级才揭晓；
 *   ④ 整条交互链路（填 → 提交 → 庆祝 → 求助 → 提示 → 语音）可由控制器驱动且状态可验证；
 *   ⑤ 能力降级后仍保留 children，主区/侧栏不会渲染成空白。
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = require('./a2ui-catalog');
const play = require('./a2ui-play');

const RENDER_SRC = fs.readFileSync(path.join(__dirname, 'a2ui-render.js'), 'utf8');
const CSS_SRC = fs.readFileSync(path.join(__dirname, 'knowledge.css'), 'utf8');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.log(`  ✗ ${name}\n      ${err.message}`); }
}
const ok = (value, msg) => assert.ok(value, msg);
const eq = (a, b, msg) => assert.deepStrictEqual(a, b, msg);

const GRADES = ['grade1', 'grade3', 'grade5', 'grade8', 'senior1', ''];

/** 不依赖 DOM 的 surface 替身：让控制器逻辑可以在 Node 里完整跑一遍。 */
function mockSurface(grade) {
  const messages = play.compilePlayStageToA2UI({ grade });
  let model = JSON.parse(JSON.stringify(messages[0].createSurface.dataModel));
  let handler = null;
  const calls = [];
  const surface = {
    get model() { return model; },
    setData(p, value) { catalog.pointerSet(model, p, value); return surface; },
    render() { return surface; },
    callFunction(name, args) { calls.push({ name, args }); return true; },
    onAction(fn) { handler = fn; return () => { handler = null; }; },
    fire(name, context = {}) {
      if (!handler) throw new Error('控制器未注册');
      return handler({ action: { event: { name, context } } });
    },
    calls
  };
  return surface;
}
const dm = (surface, key) => surface.model.play[key];

(async () => {
  console.log('游戏化关卡与 IP 求助回归：\n');

  await test('P3 清单恰好 6 个组件，且全部登记在 catalog', () => {
    eq(catalog.P3_COMPONENTS.length, 6);
    eq(new Set(catalog.P3_COMPONENTS).size, 6);
    for (const name of catalog.P3_COMPONENTS) ok(catalog.COMPONENTS[name], `缺少 ${name}`);
    eq(Object.keys(catalog.COMPONENTS).length, 32 + catalog.GAME_COMPONENTS.length, '基础 32 + 游戏组件');
  });

  await test('6 个新组件都有 renderer 分派实现，且都有 CSS 样式', () => {
    for (const name of catalog.P3_COMPONENTS) {
      ok(new RegExp(`\\b${name}:\\s*\\(`).test(RENDER_SRC) ||
         new RegExp(`\\b${name}:\\s*def\\s*=>`).test(RENDER_SRC),
        `${name} 未进入 RENDERERS`);
    }
    for (const cls of ['.k-gaps', '.k-quest', '.k-voice', '.k-ip', '.k-questions', '.k-hints']) {
      ok(CSS_SRC.includes(cls), `缺少样式 ${cls}`);
    }
  });

  await test('新增动作事件与 renderer function 都已登记', () => {
    for (const name of ['fillGap', 'clearGap', 'resetGaps', 'submitGaps', 'askIP',
      'readGuide', 'askQuestion', 'revealHint']) {
      ok(catalog.ACTION_EVENTS.includes(name), `缺少事件 ${name}`);
    }
    ok(catalog.RENDERER_FUNCTIONS.includes('ipIntent'), '缺少 ipIntent');
  });

  await test('六个年级的关卡消息全部通过协议校验，且无降级告警', () => {
    for (const grade of GRADES) {
      const messages = play.compilePlayStageToA2UI({ grade });
      const capabilities = catalog.rendererCapabilities(grade);
      for (const message of messages) {
        const result = catalog.validateMessage(message, capabilities);
        ok(result.ok, `${grade || '无年级'}: ${result.errors.join('；')}`);
      }
      eq(messages.warnings.length, 0, `${grade} 出现降级`);
      eq(messages.meta.componentCount, 10);
    }
  });

  await test('每个年级的能力白名单都开放 P3 组件', () => {
    for (const grade of GRADES) {
      const caps = catalog.rendererCapabilities(grade);
      for (const name of catalog.P3_COMPONENTS) {
        ok(caps.components.includes(name), `${caps.stage} 未开放 ${name}`);
      }
    }
  });

  await test('年级差异：求助按钮、星星、紧凑模式与文案确实不同', () => {
    const early = play.compilePlayStageToA2UI({ grade: 'grade1' });
    const senior = play.compilePlayStageToA2UI({ grade: 'senior1' });
    const find = (msgs, id) => msgs[0].createSurface.components.find(item => item.id === id);
    ok(find(early, 'gaps').askLabel.includes('知知'), '低龄求助按钮应指向 IP');
    ok(!find(senior, 'gaps').askLabel.includes('知知'), '高龄不应被幼态化');
    eq(find(senior, 'ip').compact, true);
    eq(find(early, 'ip').compact, false);
    eq(early[0].createSurface.dataModel.play.stars, 1);
    eq(senior[0].createSurface.dataModel.play.stars, 0);
    ok(early[0].createSurface.dataModel.play.guide.includes('小喇叭'));
    ok(senior[0].createSurface.dataModel.play.guide.includes('约束'));
  });

  await test('青少年/成熟期的浅色克制主题由 data-stage 驱动', () => {
    ok(/html\[data-stage="teen"\] \.k-play-scene/.test(CSS_SRC));
    ok(/html\[data-stage="senior"\] \.k-play-scene/.test(CSS_SRC));
    ok(/html\[data-stage="teen"\] \.k-quest-stars/.test(CSS_SRC), '高龄应收起星星');
  });

  await test('求助分级：初始 0 级、答案只在最后一条、前两级不含结论', () => {
    for (const grade of GRADES) {
      const model = play.compilePlayStageToA2UI({ grade })[0].createSurface.dataModel.play;
      eq(model.hintUnlocked, 0);
      ok(model.hints.length >= 3, '至少三级提示');
      const reveal = model.hints.filter(line => /答案揭晓|结论：/.test(line));
      eq(reveal.length, 1, `${grade} 应只有一条揭晓`);
      ok(model.hints.indexOf(reveal[0]) === model.hints.length - 1, '揭晓必须排最后');
      ok(!/答案揭晓|结论：/.test(model.hints[0]), '第一级不能给答案');
    }
  });

  await test('关卡数据缺省兜底：slots/bank/answers 恒有值，空格位与答案数一致', () => {
    const model = play.compilePlayStageToA2UI({})[0].createSurface.dataModel.play;
    ok(model.slots.length >= 4);
    ok(model.bank.length >= 3);
    const holes = model.slots.filter(slot => String(slot) === '').length;
    eq(holes, model.answers.length);
    eq(model.gaps.length, model.slots.length);
  });

  await test('填空 → 提交正确 → 星星/连对/庆祝与掌握证据联动', () => {
    const surface = mockSurface('grade1');
    const controller = play.createPlayController(surface, { stage: 'early', subject: 'math' });
    surface.fire('fillGap', { value: '5', index: 0 });
    surface.fire('fillGap', { value: '6', index: 1 });
    eq(dm(surface, 'gaps')[1], '5');
    eq(dm(surface, 'gaps')[2], '6');
    surface.fire('submitGaps', {});
    eq(dm(surface, 'tone'), 'good');
    eq(dm(surface, 'stars'), 2);
    eq(dm(surface, 'combo'), 1);
    ok(surface.calls.some(c => c.name === 'celebrate' && c.args.level === 'correct'));
    ok(surface.calls.some(c => c.name === 'ipIntent' && c.args.intent === 'happy'));
    ok(surface.calls.some(c => c.name === 'recordEvidence'));
    ok(controller.log.some(item => item.name === 'submit' && item.detail.result === 'correct'));
    controller.destroy();
  });

  await test('提交错误：只给鼓励与提示入口，不把答案写进反馈', () => {
    const surface = mockSurface('grade1');
    const controller = play.createPlayController(surface, { stage: 'early' });
    surface.fire('fillGap', { value: '3', index: 0 });
    surface.fire('fillGap', { value: '4', index: 1 });
    surface.fire('submitGaps', {});
    eq(dm(surface, 'tone'), 'warn');
    eq(dm(surface, 'combo'), 0);
    ok(!/答案揭晓|4、5、6/.test(dm(surface, 'feedback')), '错误反馈不能泄题');
    ok(surface.calls.some(c => c.name === 'ipIntent' && c.args.intent === 'think'));
    controller.destroy();
  });

  await test('未填满时提交只提示补空，不误判为错', () => {
    const surface = mockSurface('grade1');
    const controller = play.createPlayController(surface, { stage: 'early' });
    surface.fire('fillGap', { value: '5', index: 0 });
    surface.fire('submitGaps', {});
    ok(!/correct|wrong/.test(JSON.stringify(controller.log.filter(i => i.name === 'submit'))));
    eq(dm(surface, 'tone'), 'warn');
    controller.destroy();
  });

  await test('取回与重置：状态干净，重置同时收起已解锁提示', () => {
    const surface = mockSurface('grade1');
    const controller = play.createPlayController(surface, { stage: 'early' });
    surface.fire('fillGap', { value: '5', index: 0 });
    surface.fire('clearGap', { index: 1 });
    eq(dm(surface, 'gaps')[1], null);
    surface.fire('revealHint', {});
    eq(dm(surface, 'hintUnlocked'), 1);
    surface.fire('resetGaps', {});
    eq(dm(surface, 'hintUnlocked'), 0);
    eq(dm(surface, 'gaps').filter(Boolean).length, 0);
    controller.destroy();
  });

  await test('向知知求助：先给第一级提示，三次才揭晓答案，且每级都读出来', () => {
    const surface = mockSurface('grade1');
    const controller = play.createPlayController(surface, { stage: 'early' });
    surface.fire('askIP', { mode: 'call' });
    eq(dm(surface, 'hintUnlocked'), 1);
    ok(!/答案揭晓/.test(dm(surface, 'feedback')), '第一次求助不能直接给答案');
    ok(surface.calls.some(c => c.name === 'ipIntent'));
    surface.fire('revealHint', {});
    eq(dm(surface, 'hintUnlocked'), 2);
    ok(!/答案揭晓/.test(dm(surface, 'feedback')));
    surface.fire('revealHint', {});
    eq(dm(surface, 'hintUnlocked'), 3);
    ok(/答案揭晓/.test(dm(surface, 'feedback')));
    ok(surface.calls.filter(c => c.name === 'speak').length >= 3, '每级提示都要语音播报');
    controller.destroy();
  });

  await test('快捷提问：语音模式只朗读，气泡模式返回对应提示并高亮', () => {
    const surface = mockSurface('grade8');
    const controller = play.createPlayController(surface, { stage: 'teen' });
    surface.fire('askQuestion', { mode: 'speak', id: 'q1', speak: '相邻项的差是否恒定？' });
    eq(dm(surface, 'activeQuestion'), '');
    surface.fire('askQuestion', { mode: 'ask', id: 'q2', text: '缺项是否唯一确定？' });
    eq(dm(surface, 'activeQuestion'), 'q2');
    ok(dm(surface, 'feedback').includes('等差'), '回答应来自预设提示而非模型即兴生成');
    ok(surface.calls.some(c => c.name === 'speak'));
    controller.destroy();
  });

  await test('语音引导：题目/引导/提示/静音四种模式都不误朗读空文本', () => {
    const surface = mockSurface('grade1');
    const controller = play.createPlayController(surface, { stage: 'early' });
    surface.fire('readGuide', { mode: 'question' });
    surface.fire('readGuide', { mode: 'guide' });
    surface.fire('readGuide', { mode: 'hint' });
    eq(dm(surface, 'muted'), false);
    surface.fire('readGuide', { mode: 'mute' });
    eq(dm(surface, 'muted'), true);
    ok(surface.calls.filter(c => c.name === 'ipIntent').length >= 3);
    controller.destroy();
  });

  await test('能力裁剪降级后保留 children，主区与侧栏不会变空白', () => {
    const narrow = {
      stage: 'early', catalogId: catalog.CATALOG_ID, version: catalog.VERSION,
      components: [...catalog.BASE_COMPONENTS], maxComponents: 48, textMaxLength: 12
    };
    const messages = play.compilePlayStageToA2UI({ grade: 'grade1' }, { capabilities: narrow });
    const components = messages[0].createSurface.components;
    const scene = components.find(item => item.id === 'scene');
    ok(scene && Array.isArray(scene.children) && scene.children.length === 2, 'scene 降级后仍有两个子区');
    ok(messages.warnings.length > 0, '应记录降级告警');
    const result = catalog.validateMessage(messages[0], narrow);
    ok(result.ok, `降级后消息仍需合法：${result.errors.join('；')}`);
  });

  await test('JSONL 可序列化且不含 undefined，适合未来 SSE 流式', () => {
    const line = play.toJSONL({ grade: 'grade8' });
    ok(line.split('\n').length === 1);
    ok(!line.includes('undefined'));
    const parsed = JSON.parse(line);
    ok(parsed.createSurface.components.length === 10);
  });

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed) process.exit(1);
})();
