/* 19 个游戏组件（P4a–P4d）全量验收 · 纯 Node，不依赖服务与浏览器
 *
 * 覆盖四批的完成门槛（docs/A2UI-COMPONENT-ROADMAP.md §六）：
 *   P4a 每个组件 1 条 validateMessage 断言；
 *   P4b 共用 /assembly/* 契约、固定种子乱序、撤销回退任意一步；
 *   P4c 开放题绝不写 correct、朗读可中断、青少年无幼态奖励；
 *   P4d 图形只用固定 CSS 形状、低龄禁真实倒计时、错误不扣分不排名。
 * 另覆盖：20 类真实提问 → 主组件 → 合法消息流，以及「未命中时 60 组配方零变化」。
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = require('./a2ui-catalog');
const matrix = require('./a2ui-matrix');
const compiler = require('./a2ui-compiler');
const bridge = require('./a2ui-bridge');
const games = require('./a2ui-games');
const map = require('./a2ui-question-map');
const RENDER_SRC = fs.readFileSync(path.join(__dirname, 'a2ui-render.js'), 'utf8');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.log(`  ✗ ${name}\n      ${err.message}`); }
}
const ok = (value, msg) => assert.ok(value, msg);
const eq = (a, b, msg) => assert.deepStrictEqual(a, b, msg);

/* 与 server.js 的 mockLesson 同构的三科真实数据；游戏数据必须只从这些字段派生。 */
const MOCK = {
  chinese: {
    title: '弄懂「开心」',
    practicePrompt: '请围绕「开心」写一句有画面的话。',
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

function compileFor(type, grade = 'grade1') {
  const raw = MOCK[type.subject];
  const phase = type.subject === 'math' ? 'reinforce' : 'practice';
  const knowledge = bridge.knowledgeFromLesson({ subject: type.subject, input: type.examples[0], data: raw });
  const capabilities = matrix.capabilitiesFor(type.subject, phase, grade);
  const messages = compiler.compileKnowledgeToA2UI({
    subject: type.subject, phase, grade, point: type.examples[0], data: knowledge.data
  }, { capabilities });
  return { messages, capabilities, knowledge, phase };
}

function validateAll(messages, capabilities) {
  for (const message of messages) {
    const check = catalog.validateMessage(message, capabilities);
    ok(check.ok, `消息校验：${check.errors.join('；')}`);
  }
}

console.log('\n一、19 个组件全部落地（协议 / 渲染 / 降级 / 动作）');
test('catalog = 基础 32 + 19 个游戏组件，四批清单齐全', () => {
  eq(Object.keys(catalog.COMPONENTS).length, 32 + catalog.GAME_COMPONENTS.length);
  eq(catalog.GAME_COMPONENTS.length, 19);
  eq(games.COMPONENTS.length, 19);
  eq(new Set(games.BATCHES.map(b => b.BATCH)).size, 4, '四批实现模块都要加载');
  for (const spec of map.COMPONENT_SPECS) {
    ok(catalog.COMPONENTS[spec.name], `${spec.name} 未登记 schema`);
    eq(spec.status, 'implemented', `${spec.name} 状态`);
  }
});
test('51 个组件全部有 renderer 分派实现', () => {
  for (const name of Object.keys(catalog.COMPONENTS)) {
    ok(new RegExp(`^\\s*${name}:`, 'm').test(RENDER_SRC), `renderer 未实现 ${name}`);
  }
});
test('19 个组件的降级链、动作清单与实体规格一致', () => {
  for (const spec of map.COMPONENT_SPECS) {
    eq(catalog.FALLBACKS[spec.name], spec.fallback, `${spec.name} 降级链`);
    ok(catalog.COMPONENTS[spec.fallback], `${spec.name} 降级目标未实现`);
  }
  for (const action of games.GAME_ACTIONS) {
    ok(catalog.ACTION_EVENTS.includes(action), `动作 ${action} 未登记`);
  }
  ok(games.GAME_ACTIONS.length >= 30, '动作清单应覆盖四批');
});
test('19 个组件在五个年级的能力集中都开放（不按年龄删组件）', () => {
  for (const grade of ['grade1', 'grade3', 'grade5', 'grade8', 'grade10']) {
    const caps = catalog.rendererCapabilities(grade);
    for (const name of catalog.GAME_COMPONENTS) {
      ok(caps.components.includes(name), `${grade} 缺少 ${name}`);
      ok(caps.implemented.includes(name), `${grade} implemented 缺少 ${name}`);
    }
  }
});

console.log('\n二、20 类真实提问 → 主组件 → 合法消息流');
for (const type of map.QUESTION_TYPES) {
  test(`${type.id} → ${type.primary}`, () => {
    if (type.batch === 'done') {
      const { messages, capabilities } = compileFor(type);
      validateAll(messages, capabilities);
      eq(messages.meta.game, null, '已覆盖题型不该追加新组件');
      return;
    }
    const { messages, capabilities } = compileFor(type);
    validateAll(messages, capabilities);
    eq(messages.meta.game?.name, type.primary, '主组件');
    ok(messages[0].createSurface.components.some(item => item.component === type.primary),
      '组件表里要有该游戏组件');
    const key = games.KEY_BY_COMPONENT[type.primary];
    ok(messages[0].createSurface.dataModel.game[key], `/game/${key} 数据模型缺失`);
    ok(messages.meta.game.source === 'derived' || messages.meta.game.source === 'provided', '数据来源');
  });
}
test('未命中题型（「开心」）时 60 组配方一字不动', () => {
  const raw = MOCK.chinese;
  const k = bridge.knowledgeFromLesson({ subject: 'chinese', input: '开心', data: raw });
  const caps = matrix.capabilitiesFor('chinese', 'practice', 'grade1');
  const messages = compiler.compileKnowledgeToA2UI(
    { subject: 'chinese', phase: 'practice', grade: 'grade1', point: '开心', data: k.data }, { capabilities: caps });
  eq(messages.meta.game, null);
  const recipe = matrix.recipeFor('chinese', 'practice', 'grade1');
  const names = messages[0].createSurface.components.map(item => item.component);
  for (const name of recipe.components) ok(names.includes(name), `原配方组件 ${name} 被弄丢`);
  ok(!names.some(name => catalog.GAME_COMPONENTS.includes(name)), '不该追加游戏组件');
  validateAll(messages, caps);
});
test('能力集裁掉游戏组件时不挂卡（降级由协议层统一处理）', () => {
  const type = map.QUESTION_TYPES.find(item => item.id === 'poem.complete');
  const raw = MOCK.chinese;
  const k = bridge.knowledgeFromLesson({ subject: 'chinese', input: type.examples[0], data: raw });
  const caps = matrix.capabilitiesFor('chinese', 'practice', 'grade1');
  caps.components = caps.components.filter(name => !catalog.GAME_COMPONENTS.includes(name));
  const messages = compiler.compileKnowledgeToA2UI(
    { subject: 'chinese', phase: 'practice', grade: 'grade1', point: type.examples[0], data: k.data },
    { capabilities: caps });
  eq(messages.meta.game, null, '能力不允许时必须整卡不挂');
  validateAll(messages, caps);
});
test('同一份课程编译两次逐字节一致（纯函数、可 memo）', () => {
  const type = map.QUESTION_TYPES.find(item => item.id === 'calc.arithmetic');
  const a = compileFor(type).messages;
  const b = compileFor(type).messages;
  eq(JSON.stringify(a), JSON.stringify(b));
  ok(a[0].createSurface.dataModel.game.columnArithmetic.assembly.bank.length >= 2);
});

console.log('\n三、P4a 门槛：每个组件都过协议闸且答案可判定');
for (const name of catalog.P4A_COMPONENTS) {
  test(`${name}：validateMessage + 正确动作记 correct`, () => {
    const type = map.QUESTION_TYPES.find(item => item.primary === name);
    const { messages, capabilities } = compileFor(type);
    validateAll(messages, capabilities);
    const key = games.KEY_BY_COMPONENT[name];
    const model = messages[0].createSurface.dataModel.game[key];
    const def = games.componentFor(name, `t_${key}`, p => ({ '@path': p }), key);
    ok(def, '组件实例');
    const pick = Object.entries(def).find(([field]) => field.endsWith('Action') && /pick|pair|check/i.test(field));
    ok(pick, '存在作答动作');
    const actionName = pick[1].event.name;
    const answer = model.current?.answer || model.answer || model.correctOrder?.[0] || '';
    const out = games.applyAction(name, actionName,
      { choice: answer, answer, index: 0, side: 'right', label: answer,
        order: model.correctOrder || model.state?.order || [],
        correctOrder: model.correctOrder || [] }, model, 'early');
    ok(out, '动作应有返回');
    ok(out.evidence && typeof out.evidence.correct === 'boolean', 'P4a 应记 correct/wrong');
  });
}

console.log('\n四、P4b 门槛：共用装配契约 / 固定种子 / 撤销任意一步');
test('6 个组件都绑定同一个 /game/<key>/assembly/* 数据契约', () => {
  for (const name of catalog.P4B_COMPONENTS) {
    const key = games.KEY_BY_COMPONENT[name];
    const def = games.componentFor(name, `t_${key}`, p => ({ '@path': p }), key);
    for (const field of ['slots', 'bank', 'placed', 'history', 'answer']) {
      eq(def[field]['@path'], `/game/${key}/assembly/${field}`, `${name}.${field} 路径`);
    }
    const type = map.QUESTION_TYPES.find(item => item.primary === name);
    const { messages } = compileFor(type);
    ok(messages[0].createSurface.dataModel.game[key].assembly.history.length === 0);
  }
});
test('乱序使用固定种子，同一课程反复派生结果一致', () => {
  const p4b = games.batchFor('PoemTiles');
  const a = p4b.deriveGames('chinese', MOCK.chinese).poemTiles;
  const b = p4b.deriveGames('chinese', MOCK.chinese).poemTiles;
  eq(a.bank.map(item => item.id), b.bank.map(item => item.id));
  ok(a.bank.map(item => item.id).join(',') !== a.slots.map(item => item.expected).join(','), '必须真的乱序');
});
test('撤销可回退到第 0 步 / 任意中间步', () => {
  const p4b = games.batchFor('PoemTiles');
  const game = p4b.deriveGames('chinese', MOCK.chinese).poemTiles;
  let model = p4b.createModel('PoemTiles', game, 'early');
  let out = p4b.applyAction('PoemTiles', 'placeTile',
    { slotId: model.assembly.slots[0].id, tileId: model.assembly.bank[0].id }, model, 'early');
  model = { ...model, ...out.updates };
  out = p4b.applyAction('PoemTiles', 'placeTile',
    { slotId: model.assembly.slots[1].id, tileId: model.assembly.bank[1].id }, model, 'early');
  model = { ...model, ...out.updates };
  eq(model.assembly.history.length, 2, '两步快照');
  out = p4b.applyAction('PoemTiles', 'undoAssembly', { step: 0 }, model, 'early');
  eq(out.updates.assembly.placed, {}, '回到第 0 步应清空');
  eq(out.updates.assembly.history.length, 0);
});
test('检查顺序时答案来自原始顺序，不依赖点击先后', () => {
  const p4b = games.batchFor('LetterTiles');
  const game = p4b.deriveGames('english', MOCK.english).letterTiles;
  const model = p4b.createModel('LetterTiles', game, 'early');
  const placed = {};
  model.assembly.slots.forEach((slot, i) => { placed[slot.id] = model.assembly.answer[i]; });
  const out = p4b.applyAction('LetterTiles', 'checkAssembly',
    { placed, answer: model.assembly.answer, slots: model.assembly.slots }, model, 'early');
  eq(out.evidence.correct, true);
});

console.log('\n五、P4c 门槛：开放题不判对错 / 朗读可中断 / 青少年无幼态奖励');
test('4 个组件所有动作的证据只含 created / asked / recited', () => {
  for (const name of catalog.P4C_COMPONENTS) {
    const key = games.KEY_BY_COMPONENT[name];
    const batch = games.batchFor(name);
    for (const grade of ['grade1', 'grade8']) {
      const game = batch.deriveGames(name === 'TenseTimeline' ? 'english' : 'chinese',
        name === 'TenseTimeline' ? MOCK.english : MOCK.chinese)[key];
      ok(game, `${name} 派生数据`);
      const model = batch.createModel(name, game, grade === 'grade1' ? 'early' : 'teen');
      for (const action of batch.GAME_ACTIONS) {
        const out = batch.applyAction(name, action,
          { id: model.choices?.[0]?.id, index: 0, lines: model.lines, text: '测试文本', step: 0 },
          model, grade === 'grade1' ? 'early' : 'teen');
        if (!out) continue;
        if (out.evidence) {
          ok(typeof out.evidence.correct === 'undefined', `${name}.${action} 不应写 correct`);
          ok(['created', 'asked', 'recited'].includes(out.evidence.type),
            `${name}.${action} 证据类型 ${out.evidence.type}`);
        }
      }
    }
  }
});
test('stopVoice 中断朗读并复位状态（口型复位由桥接层执行）', () => {
  const batch = games.batchFor('RoleVoice');
  const game = batch.deriveGames('chinese', MOCK.chinese).roleVoice;
  const model = batch.createModel('RoleVoice', game, 'early');
  const reading = batch.applyAction('RoleVoice', 'readVoice', { index: 0, text: model.lines[0].text }, model, 'early');
  eq(reading.updates.state.reading, true);
  ok(reading.speak, '应产生朗读文本');
  const stopped = batch.applyAction('RoleVoice', 'stopVoice', {}, { ...model, ...reading.updates }, 'early');
  eq(stopped.stop, true, '必须向桥接层发出中断信号');
  eq(stopped.updates.state.reading, false);
});
test('青少年 / 高中期 reward=false，低龄才有幼态奖励', () => {
  const batch = games.batchFor('StoryBranch');
  const game = batch.deriveGames('chinese', MOCK.chinese).storyBranch;
  eq(batch.createModel('StoryBranch', game, 'early').reward, true);
  eq(batch.createModel('StoryBranch', game, 'teen').reward, false);
  eq(batch.createModel('StoryBranch', game, 'senior').reward, false);
});

console.log('\n六、P4d 门槛：固定 CSS 形状 / 低龄禁倒计时 / 错误不扣分');
test('3 个组件的图形数据是数字或固定 shape-N，没有 SVG / HTML 字段', () => {
  for (const name of catalog.P4D_COMPONENTS) {
    const key = games.KEY_BY_COMPONENT[name];
    const batch = games.batchFor(name);
    const game = batch.deriveGames('math', MOCK.math)[key];
    ok(game, `${name} 派生数据`);
    const model = batch.createModel(name, game, 'early');
    const serialized = JSON.stringify(model);
    ok(!/<svg|innerHTML|style=|onclick/i.test(serialized), `${name} 含可疑标记`);
    for (const shape of model.shapes || []) ok(/^shape-[0-3]$/.test(shape.kind), `${name} 形状非法`);
    for (const unit of model.units || []) ok(unit.value >= 0 && unit.value <= 10, '条形长度需钳制');
  }
});
test('低龄 allowTimer=false 且任何年级都不启动真实计时', () => {
  const batch = games.batchFor('SpeedRound');
  const game = batch.deriveGames('math', MOCK.math).speedRound;
  eq(batch.createModel('SpeedRound', game, 'early').allowTimer, false);
  const def = games.componentFor('SpeedRound', 't_speed', p => ({ '@path': p }), 'speedRound');
  ok(!('timer' in def) && !('countdown' in def), '组件不该有计时器字段');
});
test('答错不写证据、不扣分、不排名；答对才记 correct', () => {
  const batch = games.batchFor('ShapeSplit');
  const game = batch.deriveGames('math', MOCK.math).shapeSplit;
  const model = batch.createModel('ShapeSplit', game, 'early');
  const wrong = batch.applyAction('ShapeSplit', 'pickGraphic',
    { choice: String(Number(model.answer) + 1), answer: model.answer }, model, 'early');
  eq(wrong.evidence, null, '答错不能有证据');
  ok(!/扣|排名|分数/.test(wrong.updates.state.feedback));
  const right = batch.applyAction('ShapeSplit', 'pickGraphic',
    { choice: model.answer, answer: model.answer }, model, 'early');
  eq(right.evidence.correct, true);
});

console.log('\n七、内容安全与知识不删');
test('注入串只作文本，永不进入组件 props 的 html/className 之外', () => {
  const evil = { ...MOCK.chinese, poems: [{ text: '<script>alert(1)</script>，下一句。', source: '' }] };
  const k = bridge.knowledgeFromLesson({ subject: 'chinese', input: '下一句是什么', data: evil });
  const caps = matrix.capabilitiesFor('chinese', 'practice', 'grade1');
  const messages = compiler.compileKnowledgeToA2UI({
    subject: 'chinese', phase: 'practice', grade: 'grade1', point: '下一句是什么', data: k.data
  }, { capabilities: caps });
  validateAll(messages, caps);
  const json = JSON.stringify(messages[0].createSurface.components);
  ok(!json.includes('<script'), '组件实例不该含脚本标签');
  ok(JSON.stringify(messages[0].createSurface.dataModel).includes('alert(1)'), '文本要作为数据保留');
});
test('挂游戏卡不会删掉原配方的知识组件', () => {
  for (const type of map.QUESTION_TYPES.filter(item => item.batch !== 'done')) {
    const { messages, phase } = compileFor(type);
    const recipe = matrix.recipeFor(type.subject, phase, 'grade1');
    const names = messages[0].createSurface.components.map(item => item.component);
    for (const name of recipe.components) ok(names.includes(name), `${type.id} 弄丢了 ${name}`);
  }
});

console.log(`\n19 个游戏组件回归：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
