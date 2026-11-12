/* A2UI 三项收尾回归 · Node 层
 *
 * 覆盖：
 *   ① 阶段口径收敛：catalog 只管实现、matrix 是阶段准入唯一来源，
 *      两套口径不再互相污染（含「单独 require catalog」的惰性注入路径）。
 *   ② P3 关卡服务端化：触发条件共用、消息逐条过闸、takeServerPlay 全部拒绝路径、
 *      服务端产物与浏览器本地编译同构、掌握度随请求传递、静态资源登记。
 *   ③ 渐进式 updateComponents：骨架 → 分块组件 → 数据，语义与完整流等价、
 *      逐条合法、诗句一条不丢、SSE 事件与前端消费点都已接线。
 *
 * 运行： npm run test:a2ui:progressive
 */
'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const catalog = require('./a2ui-catalog');
const matrix = require('./a2ui-matrix');
const compiler = require('./a2ui-compiler');
const play = require('./a2ui-play');
const stream = require('./a2ui-stream');
const bridge = require('./a2ui-bridge');

let passed = 0;
let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch(error => { failed++; console.log(`  ✗ ${name} → ${error.message}`); });
}
function eq(actual, expected, label = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label || '值'} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}
function ok(value, label = '条件') { if (!value) throw new Error(`${label} 不成立`); }
const read = file => fs.readFileSync(require('node:path').join(__dirname, file), 'utf8');

const LESSONS = [
  { subject: 'chinese', phase: 'practice', grade: 'grade1',
    data: { poems: ['春眠不觉晓', '处处闻啼鸟'], speech: '春眠不觉晓',
      idiom: { word: '春暖花开', pinyin: 'chūn nuǎn huā kāi', meaning: '春天气候温暖' },
      steps: [], question: '把诗句排好', words: [{ word: '春暖花开' }] } },
  { subject: 'english', phase: 'learn', grade: 'grade3',
    data: { wordCard: { word: 'apple', phonetic: '/ˈæpl/' }, pairs: [{ left: 'apple', right: '苹果' }],
      steps: [], options: ['a', 'b'], answer: 'a', question: 'apple 是什么意思' } },
  { subject: 'math', phase: 'reinforce', grade: 'grade8',
    data: { question: '12 + 7 等于多少', steps: ['先算 12 + 7', '得到 19'],
      formula: '12 + 7 = 19', answer: '19', challenge: { question: '再算 19 + 1' } } }
];

function compileFull(item) {
  return compiler.compileKnowledgeToA2UI(
    { subject: item.subject, phase: item.phase, grade: item.grade,
      point: `${item.subject} 例题`, data: item.data },
    { capabilities: matrix.capabilitiesFor(item.subject, item.phase, item.grade),
      surfaceId: `zhidao_lesson_${item.subject}_${matrix.stageOf(item.grade)}` }
  );
}

const MATH = {
  subject: 'math', input: '12 + 7 等于多少？',
  data: { question: '12 + 7 等于多少？', steps: ['先算 12 + 7 = 19'],
    formula: '12 + 7 = 19', answer: '19',
    puzzle: { slots: ['1', '_', '7'], answers: ['9'] } }
};

(async () => {
  console.log('\n一、阶段口径收敛（catalog 只管实现 / matrix 只管准入）');

  await test('catalog 显式标注准入来源为 matrix', () => {
    eq(catalog.stageSource, 'a2ui-matrix.js');
  });

  await test('rendererCapabilities 是 matrix 注入的只读视图', () => {
    const caps = catalog.rendererCapabilities('grade1');
    eq(caps.delegated, true, 'delegated');
    eq(caps.stage, 'early');
    ok(Array.isArray(caps.components) && caps.components.length > 0);
  });

  await test('BASE_COMPONENTS / STAGE_EXTRAS 与 matrix 是同一份数据', () => {
    eq(catalog.BASE_COMPONENTS, matrix.BASE_COMPONENTS, 'BASE');
    eq(catalog.STAGE_EXTRAS, matrix.STAGE_EXTRAS, 'STAGE_EXTRAS');
    ok(catalog.STAGE_EXTRAS === matrix.STAGE_EXTRAS, '应为同一对象引用，而非两份拷贝');
  });

  await test('stageComponents 六个阶段都含 BASE 且不重复', () => {
    for (const stage of matrix.STAGE_IDS) {
      const list = matrix.stageComponents(stage);
      eq([...new Set(list)].length, list.length, `${stage} 去重`);
      for (const name of matrix.BASE_COMPONENTS) ok(list.includes(name), `${stage} 缺少 ${name}`);
    }
  });

  await test('实现能力与年级无关，准入能力随年级变化', () => {
    const early = catalog.rendererCapabilities('grade1');
    const teen = catalog.rendererCapabilities('grade8');
    eq(early.implemented, teen.implemented, 'implemented');
    eq(early.implemented.length, Object.keys(catalog.COMPONENTS).length);
    ok(!early.components.includes('Tabs') && teen.components.includes('Tabs'), '阶段准入应不同');
    ok(early.maxComponents < teen.maxComponents, '容量上限');
    ok(early.textMaxLength < teen.textMaxLength, '文本长度提示');
  });

  await test('implementationCapabilities 只回答「画得出什么」', () => {
    const impl = catalog.implementationCapabilities();
    eq(impl.implemented, Object.keys(catalog.COMPONENTS));
    eq(impl.version, catalog.VERSION);
    ok(!('components' in impl), '纯实现能力不该带阶段准入字段');
    ok(!('stage' in impl), '纯实现能力不该带年级');
  });

  await test('capabilitiesFor 不再回问 catalog.rendererCapabilities', () => {
    const src = read('a2ui-matrix.js');
    const body = src.slice(src.indexOf('function capabilitiesFor('), src.indexOf('function matrixRows('));
    ok(body.length > 0, '未定位到 capabilitiesFor 函数体');
    ok(!body.includes('catalog.rendererCapabilities'), '能力计算里仍有 catalog.rendererCapabilities 调用');
    const caps = matrix.capabilitiesFor('chinese', 'practice', 'grade1');
    const stage = matrix.stageCapabilities('grade1');
    eq(caps.stage, stage.stage);
    eq(caps.implemented, stage.implemented);
  });

  await test('单独 require catalog 也能惰性拿到正确阶段能力', () => {
    const out = execFileSync(process.execPath, ['-e', `
      const c = require('./a2ui-catalog');
      const a = c.rendererCapabilities('grade1');
      const b = c.rendererCapabilities('grade8');
      console.log(JSON.stringify({
        delegated: a.delegated, earlyTabs: a.components.includes('Tabs'),
        teenTabs: b.components.includes('Tabs'), base: c.BASE_COMPONENTS.length,
        impl: a.implemented.length
      }));
    `], { cwd: __dirname, encoding: 'utf8' });
    const got = JSON.parse(out.trim().split('\n').pop());
    eq(got.delegated, true, '惰性注入');
    eq(got.earlyTabs, false, '启蒙期不该放出 Tabs');
    eq(got.teenTabs, true, '青少年期应放出 Tabs');
    eq(got.base, matrix.BASE_COMPONENTS.length, 'BASE 清单');
    eq(got.impl, Object.keys(catalog.COMPONENTS).length, '实现清单');
  });

  console.log('\n二、P3 游戏化关卡服务端化');

  await test('触发条件由桥接层共用：数学练习 / 强化且未掌握', () => {
    const k = bridge.knowledgeFromLesson(MATH);
    const phase = bridge.phaseFor(MATH);
    ok(bridge.shouldShowPlay({ subject: k.subject, phase, grade: 'grade3',
      point: k.point, data: k.data, mastery: -1 }), '数学题应触发');
    ok(!bridge.shouldShowPlay({ subject: k.subject, phase, grade: 'grade3',
      point: k.point, data: k.data, mastery: 88 }), '已掌握不该再弹关卡');
    ok(!bridge.shouldShowPlay({ subject: 'chinese', phase: 'practice', grade: 'grade3',
      point: k.point, data: k.data, mastery: -1 }), '非数学不该触发');
  });

  await test('服务端编译产物逐条过协议闸', () => {
    const k = bridge.knowledgeFromLesson(MATH);
    const phase = bridge.phaseFor(MATH);
    const caps = matrix.capabilitiesFor(k.subject, phase, 'grade3');
    const messages = play.compilePlayStageToA2UI(
      { grade: 'grade3', puzzle: bridge.puzzleFor(MATH), level: 1, progress: 20 },
      { capabilities: caps, surfaceId: 'zhidao_server_play_primary' });
    ok(messages.length >= 1, '至少要有一条消息');
    eq(messages[0].createSurface.surfaceId, 'zhidao_server_play_primary');
    for (const message of messages) {
      ok(catalog.validateMessage(message, caps).ok, '关卡消息不合法');
    }
  });

  await test('服务端关卡与浏览器本地编译同构（仅 surfaceId 不同）', () => {
    const k = bridge.knowledgeFromLesson(MATH);
    const phase = bridge.phaseFor(MATH);
    const caps = matrix.capabilitiesFor(k.subject, phase, 'grade3');
    const args = { grade: 'grade3', puzzle: bridge.puzzleFor(MATH), level: 1, progress: 20 };
    const server = play.compilePlayStageToA2UI(args,
      { capabilities: caps, surfaceId: 'zhidao_server_play_primary' });
    const local = play.compilePlayStageToA2UI(args,
      { capabilities: caps, surfaceId: 'zhidao_bridge_play_primary' });
    const strip = list => JSON.parse(JSON.stringify(list).replace(/zhidao_(?:server|bridge)_play_primary/g, 'SURFACE'));
    eq(strip(server), strip(local), '消息流');
  });

  await test('takeServerPlay 接受合法关卡', () => {
    const k = bridge.knowledgeFromLesson(MATH);
    const caps = matrix.capabilitiesFor('math', 'reinforce', 'grade3');
    const messages = play.compilePlayStageToA2UI(
      { grade: 'grade3', puzzle: bridge.puzzleFor(MATH), level: 1, progress: 20 },
      { capabilities: caps, surfaceId: 'zhidao_server_play_primary' });
    const payload = {
      jsonl: messages.map(m => JSON.stringify(m)).join('\n'), capabilities: caps,
      surfaceId: 'zhidao_server_play_primary', subject: 'math', stage: 'primary',
      uiVersion: 'p1-play', componentCount: 10
    };
    const ctx = { subject: 'math', stage: 'primary',
      rendererComponents: catalog.implementationCapabilities().implemented };
    const taken = bridge.takeServerPlay(payload, ctx);
    ok(taken, '合法关卡应被接受');
    eq(taken.messages.length, messages.length);
    eq(taken.uiVersion, 'p1-play');
  });

  await test('takeServerPlay 拒绝全部不可信路径', () => {
    const caps = matrix.capabilitiesFor('math', 'reinforce', 'grade3');
    const messages = play.compilePlayStageToA2UI(
      { grade: 'grade3', puzzle: bridge.puzzleFor(MATH), level: 1, progress: 20 },
      { capabilities: caps, surfaceId: 'zhidao_server_play_primary' });
    const jsonl = messages.map(m => JSON.stringify(m)).join('\n');
    const good = {
      jsonl, capabilities: caps, surfaceId: 'zhidao_server_play_primary',
      subject: 'math', stage: 'primary'
    };
    const mine = catalog.implementationCapabilities().implemented;
    const ctx = { subject: 'math', stage: 'primary', rendererComponents: mine };
    const cases = [
      ['空载荷', null, ctx],
      ['缺 jsonl', { ...good, jsonl: '' }, ctx],
      ['缺 capabilities', { ...good, capabilities: null }, ctx],
      ['坏 JSON', { ...good, jsonl: '{oops' }, ctx],
      ['surfaceId 不一致', { ...good, surfaceId: 'other' }, ctx],
      ['学科错位', { ...good, subject: 'chinese' }, ctx],
      ['阶段错位', { ...good, stage: 'teen' }, ctx],
      ['渲染器画不出', good, { ...ctx, rendererComponents: ['Column'] }],
      ['非法消息', { ...good, jsonl: JSON.stringify({ version: '1.0', surfaceUpdate: { surfaceId: 'x' } }) }, ctx]
    ];
    for (const [label, payload, context] of cases) {
      eq(bridge.takeServerPlay(payload, context), null, label);
    }
  });

  await test('关卡与渐进模块已登记到静态白名单 / 页面 / SW', () => {
    ok(read('server.js').includes("require('./a2ui-play')"), '服务端未引入关卡编译器');
    ok(read('server.js').includes("'/a2ui-stream.js'"), '静态白名单缺 a2ui-stream.js');
    ok(read('index.html').includes('a2ui-stream.js'), '页面缺 a2ui-stream.js');
    const swSrc = read('sw.js');
    ok(swSrc.includes("'/a2ui-stream.js'"), 'SW 未预缓存 a2ui-stream.js');
    // 版本只要求「已高于加入 a2ui-stream.js 之前」，后续再加模块升版本不该让断言失效。
    const swVersion = Number((swSrc.match(/zhidao-shell-v(\d+)/) || [])[1] || 0);
    ok(swVersion >= 10, `SW 版本未升级（当前 ${swVersion}）`);
  });

  await test('掌握度随请求带上、关卡事件在前端合回', () => {
    const dyn = read('dynamic.js');
    ok(/mastery:\s*currentMasteryFor\(value\)/.test(dyn), '请求体未带掌握度');
    ok(/mastery:\s*currentMasteryFor\(state\.dynamic/.test(dyn), '桥接层未传同源掌握度');
    ok(/event === 'play'/.test(dyn), 'SSE 未收集 play 事件');
    ok(/result\.play = \{/.test(dyn), 'play 未合回课程结果');
    const srv = read('server.js');
    ok(/function compilePlayForLesson/.test(srv), '服务端缺少关卡编译函数');
    ok(/emit\('play', \{/.test(srv), 'SSE 未推 play 事件');
    ok(/Number\(body\.mastery\)/.test(srv), '服务端未读取掌握度');
  });

  await test('桥接层优先消费服务端关卡并标注 playSource', () => {
    const src = read('a2ui-bridge.js');
    ok(/const servedPlay = takeServerPlay\(result\.play/.test(src), '未优先消费服务端关卡');
    ok(/playSource = servedPlay \? 'server' : 'client'/.test(src), '未标注来源');
    ok(/playSource: state\.playSource/.test(src), 'status 未暴露来源');
    ok(/takeServerPlay,/.test(src), 'API 未导出 takeServerPlay');
  });

  console.log('\n三、渐进式 updateComponents');

  await test('三学科完整流 → 渐进流语义等价且逐条合法', () => {
    for (const item of LESSONS) {
      const full = compileFull(item);
      const caps = matrix.capabilitiesFor(item.subject, item.phase, item.grade);
      const progressive = stream.toProgressiveMessages(full, { chunkSize: 4, surfaceId: 'zhidao_lesson_preview' });
      eq(stream.diff(full, progressive), [], `${item.subject} 语义差异`);
      eq(stream.validate(progressive, caps).ok, true, `${item.subject} 协议校验`);
      ok(progressive.length > full.length, `${item.subject} 应被拆成更多条`);
    }
  });

  await test('只有第一条是 createSurface（renderer 遇到第二条会清空组件表）', () => {
    const full = compileFull(LESSONS[0]);
    const progressive = stream.toProgressiveMessages(full, { chunkSize: 2 });
    eq(progressive.filter(m => m.createSurface).length, 1);
    eq(progressive[0].createSurface.components[0].id, 'root', '骨架必须含 root');
    eq(progressive[0].createSurface.components.length, 2, '骨架只放 root + 提示条');
  });

  await test('分块数 = ceil(组件数 / chunkSize)，root 在首批到达', () => {
    const full = compileFull(LESSONS[0]);
    const count = full[0].createSurface.components.length;
    const progressive = stream.toProgressiveMessages(full, { chunkSize: 3 });
    const batches = progressive.filter(m => m.updateComponents);
    eq(batches.length, Math.ceil(count / 3), '分块数');
    ok(batches[0].updateComponents.components.some(c => c.id === 'root'), '首批必须带 root');
    eq(batches.flatMap(m => m.updateComponents.components).length, count, '组件一条不丢');
  });

  await test('dataModel 与 /knowledge/poems 都保留，正文不删', () => {
    const full = compileFull(LESSONS[0]);
    const progressive = stream.toProgressiveMessages(full, { chunkSize: 3 });
    const paths = progressive.filter(m => m.updateDataModel).map(m => m.updateDataModel.path);
    ok(paths.includes('/knowledge/poems'), '诗句注入消息丢失');
    for (const key of Object.keys(full[0].createSurface.dataModel)) {
      ok(paths.includes(`/${key}`), `dataModel.${key} 未注入`);
    }
    eq(stream.reassemble(progressive).dataModel, stream.reassemble(full).dataModel, '最终 dataModel');
  });

  await test('chunkEvents 逐条可解析、index 连续、首末类型正确', () => {
    const full = compileFull(LESSONS[2]);
    const events = stream.chunkEvents(full, { chunkSize: 2, surfaceId: 'zhidao_lesson_preview' });
    eq(events.map(e => e.index), events.map((_, i) => i), 'index');
    for (const event of events) JSON.parse(event.line);
    eq(events[0].type, 'createSurface');
    eq(events[events.length - 1].type, 'updateDataModel');
    ok(events.every(e => e.total === events.length), 'total');
    ok(events.filter(e => e.type === 'updateComponents').length >= 2, '应有多条 updateComponents');
  });

  await test('骨架 surfaceId 与正式流隔离，不污染正式组件表', () => {
    const full = compileFull(LESSONS[0]);
    const progressive = stream.toProgressiveMessages(full,
      { chunkSize: 3, surfaceId: 'zhidao_lesson_preview' });
    ok(progressive.every(m => {
      const type = Object.keys(m).find(k => k !== 'version');
      return m[type].surfaceId === 'zhidao_lesson_preview';
    }), '所有消息应使用预览 surfaceId');
    eq(stream.skeletonMessage('s1').createSurface.surfaceId, 's1');
  });

  await test('边界：空流 / 非法 chunkSize / 自定义骨架文案', () => {
    eq(stream.toProgressiveMessages([]), []);
    eq(stream.chunkEvents('', {}), []);
    const full = compileFull(LESSONS[0]);
    const weird = stream.toProgressiveMessages(full, { chunkSize: -9, skeletonText: '<b>hi</b>' });
    eq(stream.diff(full, weird), [], '负数 chunkSize 应回退默认值');
    eq(weird[0].createSurface.components[1].text, '<b>hi</b>', '骨架文案按纯文本处理');
  });

  await test('SSE 编排：骨架最先推、分块随后、end 收尾', () => {
    const srv = read('server.js');
    ok(/emit\('a2ui:begin'/.test(srv), '缺 a2ui:begin');
    ok(/a2uiStream\.skeletonMessage\(PREVIEW_SURFACE\)/.test(srv), '骨架未先行');
    ok(/emit\('a2ui:chunk', chunk\)/.test(srv), '未逐块推 updateComponents');
    ok(/emit\('a2ui:end'/.test(srv), '缺 a2ui:end');
    const begin = srv.indexOf("emit('a2ui:begin'");
    const chunks = srv.indexOf("for (const chunk of chunks.slice(1))");
    const end = srv.indexOf("emit('a2ui:end'");
    ok(begin > -1 && chunks > begin && end > chunks, '事件顺序不对');
    ok(/X-Accel-Buffering/.test(srv), 'SSE 头未禁用代理缓冲');
  });

  await test('前端逐块 feed 预览层、result 到达即销毁', () => {
    const dyn = read('dynamic.js');
    ok(/event === 'a2ui:chunk'/.test(dyn), '未收集分块事件');
    ok(/createStreamPreview\(\)/.test(dyn), '未创建预览 surface');
    ok(/preview\.surface\.feed\(message\)/.test(dyn), '未逐条 feed');
    ok(/dropStreamPreview\(preview\)/.test(dyn), '未在 result 前销毁预览层');
    ok(/ZHIDAO_A2UI_STREAM_STATS/.test(dyn), '未暴露渐进统计');
    ok(/progressive:\s*\{/.test(dyn), '未把渐进元数据合回 result.a2ui');
  });

  console.log(`\nA2UI 收尾回归：${passed}/${passed + failed} 通过`);
  if (failed) process.exitCode = 1;
})();
