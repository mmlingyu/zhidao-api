/* A2UI 协议 / 编译器 / 渲染器契约回归测试（纯 Node，不依赖浏览器与服务）
 * 运行：node test-a2ui.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = require('./a2ui-catalog');
const { compileLessonToA2UI, compileToJSONL, applyCapabilities } = require('./a2ui-compiler');
const grade = require('./grade-profile');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
const eq = (a, b, msg) => assert.deepStrictEqual(a, b, msg);
const ok = (value, msg) => assert.ok(value, msg);

const lesson = {
  subject: 'chinese',
  title: '一个词，也能写出画面感',
  practicePrompt: '选一个词，写一句有画面的话。',
  idioms: [
    { word: '心花怒放', tag: '喜悦', pinyin: 'xīn huā nù fàng', meaning: '形容非常开心', example: '听到消息，他心花怒放。', scene: '收到礼物时', level: 3 },
    { word: '眉开眼笑', tag: '喜悦', pinyin: 'méi kāi yǎn xiào', meaning: '形容高兴的样子', example: '妹妹眉开眼笑地跑过来。', scene: '被夸奖时', level: 2 },
    { word: '手舞足蹈', tag: '喜悦', pinyin: 'shǒu wǔ zú dǎo', meaning: '高兴得动作起来', example: '他高兴得手舞足蹈。', scene: '赢球时', level: 3 }
  ],
  poems: [
    { text: '读书破万卷，下笔如有神。', source: '唐 · 杜甫', tag: '积累' },
    { text: '问渠那得清如许？为有源头活水来。', source: '宋 · 朱熹', tag: '思考' }
  ]
};

(async () => {
  console.log('\n一、A2UI v1.0 协议契约');

  await test('版本号与 catalogId 固定', () => {
    eq(catalog.VERSION, '1.0');
    eq(catalog.CATALOG_ID, 'urn:zhidao:catalog:knowledge:v1');
  });

  await test('消息名用 v1.0，不含旧版 surfaceUpdate / beginRendering', () => {
    for (const name of ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']) {
      ok(catalog.MESSAGE_TYPES.includes(name), `缺少 ${name}`);
    }
    for (const old of Object.keys(catalog.LEGACY_MESSAGES)) {
      ok(!catalog.MESSAGE_TYPES.includes(old), `不应包含旧名 ${old}`);
    }
  });

  await test('validateMessage 明确拒绝旧版消息名', () => {
    const result = catalog.validateMessage({ version: '1.0', surfaceUpdate: { surfaceId: 's' } });
    eq(result.ok, false);
    ok(result.errors.some(line => line.includes('旧版消息名') && line.includes('updateComponents')));
  });

  await test('每条消息恰好一个消息键（version 是信封字段）', () => {
    const result = catalog.validateMessage({
      version: '1.0', createSurface: { surfaceId: 's', catalogId: catalog.CATALOG_ID, components: [{ id: 'root', component: 'Column' }] },
      updateDataModel: { surfaceId: 's', path: '/a', value: 1 }
    });
    eq(result.ok, false);
    ok(result.errors.some(line => line.includes('恰好一个')));
  });

  await test('拒绝未知消息类型与错误版本', () => {
    ok(!catalog.validateMessage({ version: '1.0', surfaceRender: {} }).ok);
    ok(!catalog.validateMessage({ version: '0.9', deleteSurface: { surfaceId: 's' } }).ok);
  });

  await test('组件 id 遵循 UAX #31，连字符被拒', () => {
    ok(catalog.isValidId('poem_list'));
    ok(!catalog.isValidId('poem-list'));
    ok(!catalog.isValidId('2poem'));
    const result = catalog.validateMessage({
      version: '1.0',
      createSurface: { surfaceId: 's', catalogId: catalog.CATALOG_ID, components: [{ id: 'poem-list', component: 'Text' }] }
    });
    ok(result.errors.some(line => line.includes('UAX #31') || line.includes('id')));
    ok(result.errors.some(line => line.includes('root')));
  });

  await test('拒绝未知组件与 schema 外属性（防 HTML/JS 注入）', () => {
    const base = { surfaceId: 's', catalogId: catalog.CATALOG_ID };
    const a = catalog.validateMessage({ version: '1.0', createSurface: { ...base,
      components: [{ id: 'root', component: 'Script', innerHTML: '<script>alert(1)</script>' }] } });
    ok(a.errors.some(line => line.includes('未知组件')));
    const b = catalog.validateMessage({ version: '1.0', createSurface: { ...base,
      components: [{ id: 'root', component: 'Text', text: '你好', onclick: 'alert(1)' }] } });
    ok(b.errors.some(line => line.includes('onclick') && line.includes('schema')));
  });

  await test('createSurface 必须含 root；updateDataModel.path 必须是 JSON Pointer', () => {
    ok(!catalog.validateMessage({ version: '1.0', createSurface: {
      surfaceId: 's', catalogId: catalog.CATALOG_ID, components: [{ id: 'x', component: 'Text' }] } }).ok);
    ok(!catalog.validateMessage({ version: '1.0', updateDataModel: { surfaceId: 's', path: 'lesson/poems', value: [] } }).ok);
    ok(catalog.validateMessage({ version: '1.0', updateDataModel: { surfaceId: 's', path: '/lesson/poems', value: [] } }).ok);
  });

  await test('callRendererFunction 只允许白名单函数（含 P3 的 ipIntent）', () => {
    eq(catalog.RENDERER_FUNCTIONS,
      ['speak', 'celebrate', 'recordEvidence', 'openPoint', 'ipIntent']);
    ok(catalog.validateMessage({ version: '1.0', callRendererFunction: { name: 'speak', args: { text: '你好' } } }).ok);
    ok(catalog.validateMessage({ version: '1.0', callRendererFunction: { name: 'ipIntent', args: { intent: 'happy' } } }).ok);
    ok(!catalog.validateMessage({ version: '1.0', callRendererFunction: { name: 'openUrl', args: {} } }).ok);
  });

  await test('JSON Pointer 读写支持 ~0 / ~1 转义与删除', () => {
    const model = { lesson: { 'a/b': { text: '诗句' } } };
    eq(catalog.pointerGet(model, '/lesson/a~1b/text'), '诗句');
    catalog.pointerSet(model, '/lesson/a~1b/note', '补充');
    eq(model.lesson['a/b'].note, '补充');
    catalog.pointerSet(model, '/lesson/a~1b/note', null);
    ok(!('note' in model.lesson['a/b']));
  });

  await test('resolveValue 支持绝对/相对 @path、@@ 转义与 @index', () => {
    const model = { lesson: { poems: [{ text: '第一句' }] }, hints: { poems: '听一句读一句' } };
    eq(catalog.resolveValue({ '@path': '/hints/poems' }, model), '听一句读一句');
    eq(catalog.resolveValue({ '@path': 'text' }, model, { base: '/lesson/poems/0' }), '第一句');
    eq(catalog.resolveValue('@@literal', model), '@literal');
    eq(catalog.resolveValue({ '@call': '@index' }, model, { index: 3 }), 3);
    eq(catalog.resolveValue({ text: { '@path': '/hints/poems' } }, model).text, '听一句读一句');
  });

  console.log('\n二、年级能力协商');

  await test('五个阶段都允许内容型组件（不再靠 CSS 隐藏正文）', () => {
    for (const id of ['grade1', 'grade3', 'grade5', 'grade8', 'senior2', '']) {
      const caps = catalog.rendererCapabilities(id);
      for (const name of ['PoemLine', 'WritingPad', 'HintBar', 'List', 'SpeakButton']) {
        ok(caps.components.includes(name), `${id || 'generic'} 缺少 ${name}`);
      }
    }
  });

  await test('低年级不含 Tabs/MethodNote，青少年含', () => {
    const early = catalog.rendererCapabilities('grade1');
    const teen = catalog.rendererCapabilities('grade8');
    eq(early.stage, 'early');
    eq(teen.stage, 'teen');
    ok(!early.components.includes('Tabs'));
    ok(!early.components.includes('MethodNote'));
    ok(teen.components.includes('Tabs'));
    ok(teen.components.includes('MethodNote'));
    ok(early.maxComponents < teen.maxComponents);
    ok(early.textMaxLength < teen.textMaxLength);
  });

  await test('被禁用组件降级为允许的等价组件，而不是静默丢弃知识', () => {
    eq(catalog.fallbackFor('Tabs', { components: ['Column', 'Text'] }), 'Column');
    eq(catalog.fallbackFor('MethodNote', { components: ['Column', 'Text'] }), 'Text');
    eq(catalog.fallbackFor('PoemLine', { components: ['Column', 'Text'] }), 'Text');
    eq(catalog.fallbackFor('WritingPad', { components: ['Text'] }), null);
  });

  await test('applyCapabilities 清理降级后不合法的属性与悬空 children', () => {
    const warnings = [];
    const caps = { stage: 'early', components: ['Column', 'Text'] };
    const out = applyCapabilities([
      { id: 'root', component: 'Column', children: ['tabs', 'poem', 'gone'] },
      { id: 'tabs', component: 'Tabs', tabs: ['a', 'b'], active: 0 },
      { id: 'poem', component: 'PoemLine', text: '春眠不觉晓', source: '唐', tag: '春' },
      { id: 'gone', component: 'WritingPad', task: '写一句', words: [] }
    ], caps, warnings);
    const names = out.map(item => item.component);
    ok(!names.includes('Tabs') && !names.includes('PoemLine') && !names.includes('WritingPad'));
    ok(out.every(item => caps.components.includes(item.component)));
    eq(out[0].children, ['tabs', 'poem']); // gone 被移除，不残留悬空引用
    ok(out.find(item => item.id === 'poem').text === '春眠不觉晓'); // 诗句正文仍在
    ok(warnings.length >= 3);
  });

  console.log('\n三、确定性编译器');

  const msgs1 = compileLessonToA2UI(lesson, { grade: 'grade1' });
  const msgs8 = compileLessonToA2UI(lesson, { grade: 'grade8' });
  const msgsGeneric = compileLessonToA2UI(lesson, {});

  await test('消息顺序：createSurface → updateComponents → updateDataModel', () => {
    eq(Object.keys(msgs1[0]).filter(k => k !== 'version'), ['createSurface']);
    eq(Object.keys(msgs1[1]).filter(k => k !== 'version'), ['updateComponents']);
    eq(Object.keys(msgs1[2]).filter(k => k !== 'version'), ['updateDataModel']);
    eq(msgs1.length, 3);
  });

  await test('createSurface 含 root、合法 surfaceId 与 catalogId', () => {
    const surface = msgs1[0].createSurface;
    eq(surface.catalogId, catalog.CATALOG_ID);
    ok(catalog.isValidId(surface.surfaceId));
    ok(surface.components.some(item => item.id === 'root'));
    ok(surface.dataModel && typeof surface.dataModel === 'object');
  });

  await test('三条消息全部通过协议校验（一年级 / 初二 / 通用）', () => {
    for (const [label, msgs, g] of [['一年级', msgs1, 'grade1'], ['初二', msgs8, 'grade8'], ['通用', msgsGeneric, '']]) {
      const caps = catalog.rendererCapabilities(g);
      for (const message of msgs) {
        const result = catalog.validateMessage(message, caps);
        ok(result.ok, `${label} ${result.errors.join('；')}`);
      }
    }
  });

  await test('组件目录覆盖诗文与写作所需组件', () => {
    const all = [...msgs1[0].createSurface.components, ...msgs1[1].updateComponents.components];
    const names = all.map(item => item.component);
    for (const name of ['Column', 'Card', 'CardHeading', 'HintBar', 'List', 'PoemLine', 'SpeakButton', 'WritingPad']) {
      ok(names.includes(name), `缺少 ${name}`);
    }
  });

  await test('诗句完整进入 updateDataModel，没有被隐藏或截断', () => {
    const value = msgs1[2].updateDataModel.value;
    eq(value.length, 2);
    eq(value[0].text, '读书破万卷，下笔如有神。');
    eq(value[1].source, '宋 · 朱熹');
    for (const item of value) ok(typeof item.text === 'string' && item.text.length > 0);
  });

  await test('朗读串接与可见诗句同源，且无双重句号', () => {
    const speech = msgs1[0].createSurface.dataModel.lesson.poemSpeech;
    ok(speech.includes('读书破万卷，下笔如有神'));
    ok(speech.includes('问渠那得清如许'));
    ok(!speech.includes('。。'));
    ok(speech.endsWith('。'));
  });

  await test('诗句为空时给出兜底态文案，而不是空白容器', () => {
    const msgs = compileLessonToA2UI({ ...lesson, poems: [] }, { grade: 'grade1' });
    const list = msgs[1].updateComponents.components.find(item => item.id === 'poem_list');
    ok(list && typeof list.emptyText === 'string' && list.emptyText.includes('没有配套诗句'));
    eq(msgs[2].updateDataModel.value.length, 0);
    eq(msgs[0].createSurface.dataModel.lesson.poemSpeech, '');
  });

  await test('栏目提示随年级切换：一年级「听一句」→ 初二「表达手法」', () => {
    const h1 = msgs1[0].createSurface.dataModel.hints;
    const h8 = msgs8[0].createSurface.dataModel.hints;
    ok(h1.poems.includes('听一句'));
    ok(h8.poems.includes('表达手法'));
    ok(h1.writing.includes('爸爸妈妈'));
    ok(!h8.writing.includes('爸爸妈妈'));
    ok(h1.poems !== h8.poems);
  });

  await test('完成门槛随年级递进 1 / 12 / 16 / 20', () => {
    const values = ['grade1', 'grade3', 'grade5', 'grade8'].map(g =>
      compileLessonToA2UI(lesson, { grade: g })[0].createSurface.dataModel.practice.minLength);
    eq(values, [1, 12, 16, 20]);
    for (const [g, v] of [['grade1', 1], ['grade3', 12], ['grade5', 16], ['grade8', 20]]) {
      eq(grade.hintForGrade(g, 'writing').minLength, v);
    }
  });

  await test('知识不变、编排随年级：组件树相同，仅 dataModel 文案不同', () => {
    const tree = msgs => JSON.stringify([msgs[0].createSurface.components, msgs[1].updateComponents.components]);
    eq(tree(msgs1), tree(msgs8));
    eq(msgs1[2].updateDataModel.value, msgs8[2].updateDataModel.value);
    ok(msgs1[0].createSurface.dataModel.hints.poems !== msgs8[0].createSurface.dataModel.hints.poems);
    ok(msgs1[0].createSurface.surfaceId !== msgs8[0].createSurface.surfaceId);
  });

  await test('自定义 capabilities 裁剪后消息仍合法，且不留被禁组件', () => {
    const caps = { ...catalog.rendererCapabilities('grade1'), components: ['Column', 'Card', 'Text', 'List', 'WritingPad', 'HintBar', 'CardHeading'] };
    const msgs = compileLessonToA2UI(lesson, { grade: 'grade1', capabilities: caps });
    const all = [...msgs[0].createSurface.components, ...msgs[1].updateComponents.components];
    ok(!all.some(item => item.component === 'PoemLine'));
    ok(all.some(item => item.id === 'poem_tpl' && item.component === 'Text'));
    for (const message of msgs) ok(catalog.validateMessage(message, caps).ok);
    ok(msgs.warnings.length > 0);
  });

  await test('超长诗句只告警、不截断（内容永远可见）', () => {
    const long = { ...lesson, poems: [{ text: '这是一句特别特别长的用于验证年级长度告警的诗句abcdefghijklmnop', source: '测试', tag: '长句' }] };
    const msgs = compileLessonToA2UI(long, { grade: 'grade1' });
    ok(msgs.warnings.some(line => line.includes('建议长度')));
    eq(msgs[2].updateDataModel.value[0].text, long.poems[0].text);
  });

  await test('XSS 载荷只作为纯数据，不产生可执行标签', () => {
    const evil = { ...lesson, poems: [{ text: '<script>alert(1)</script>', source: '<img src=x onerror=alert(2)>', tag: '"><b>x</b>' }] };
    const msgs = compileLessonToA2UI(evil, { grade: 'grade1' });
    const item = msgs[2].updateDataModel.value[0];
    eq(item.text, '<script>alert(1)</script>'); // 保留为字符串，renderer 用 textContent 落地
    ok(!JSON.stringify(msgs).includes('<script>alert(1)</script></'));
    for (const message of msgs) ok(catalog.validateMessage(message, catalog.rendererCapabilities('grade1')).ok);
  });

  await test('编译是纯函数：同输入同输出，无 DOM / window 依赖', () => {
    eq(JSON.stringify(compileLessonToA2UI(lesson, { grade: 'grade1' })), JSON.stringify(msgs1));
    const source = fs.readFileSync(path.join(__dirname, 'a2ui-compiler.js'), 'utf8');
    ok(!/document\.|window\.(?!ZHIDAO)/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')));
  });

  await test('JSONL 每行一个合法 v1.0 消息', () => {
    const lines = compileToJSONL(lesson, { grade: 'grade8' }).split('\n');
    eq(lines.length, 3);
    const caps = catalog.rendererCapabilities('grade8');
    for (const line of lines) ok(catalog.validateMessage(JSON.parse(line), caps).ok);
  });

  await test('renderer 源码不把数据拼进 innerHTML（儿童内容安全底线）', () => {
    const source = fs.readFileSync(path.join(__dirname, 'a2ui-render.js'), 'utf8');
    ok(!/\.innerHTML\s*=/.test(source), 'renderer 不应使用 innerHTML 写入动态内容');
    ok(source.includes('validateMessage'), 'renderer 必须先过协议校验');
    ok(source.includes('textContent'), '动态文本必须走 textContent');
    ok(source.includes('RENDERER_FUNCTIONS'), 'renderer function 必须走白名单');
  });

  await test('静态资源白名单、预缓存与脚本加载顺序都已登记', () => {
    const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    for (const file of ['a2ui-catalog.js', 'a2ui-compiler.js', 'a2ui-render.js']) {
      ok(server.includes(`'/${file}'`), `server.js 未登记 ${file}`);
      ok(sw.includes(`'/${file}'`), `sw.js 未预缓存 ${file}`);
      ok(html.includes(file), `index.html 未加载 ${file}`);
    }
    const iCatalog = html.indexOf('a2ui-catalog.js');
    const iCompiler = html.indexOf('a2ui-compiler.js');
    const iRender = html.indexOf('a2ui-render.js');
    const iDynamic = html.indexOf('dynamic.js');
    ok(iCatalog < iCompiler && iCompiler < iRender && iRender < iDynamic, '脚本顺序错误');
  });

  console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
  if (failed) process.exitCode = 1;
})();
