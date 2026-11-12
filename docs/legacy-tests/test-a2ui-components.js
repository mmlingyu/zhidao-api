/* P2 知识组件回归（纯 Node，不依赖浏览器与服务）
 * 运行：node test-a2ui-components.js
 *
 * 覆盖补齐 8 个预留组件后的四条底线：
 *   ① catalog 登记的全部组件都有 renderer 实现，不会静默跳过；
 *   ② 8 个新组件真的进入 60 组配方，且每组只追加 1 个（认知负荷可控）；
 *   ③ 编译出的实例属性全在 schema 白名单内，被能力禁用时都有可用降级；
 *   ④ 数据缺失时组件仍有内容，且渲染器绝不把模型字符串当 HTML/JS 执行。
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalog = require('./a2ui-catalog');
const matrix = require('./a2ui-matrix');
const { compileKnowledgeToA2UI, compileLessonToA2UI } = require('./a2ui-compiler');

const RENDER_SRC = fs.readFileSync(path.join(__dirname, 'a2ui-render.js'), 'utf8');
const GALLERY_SRC = fs.readFileSync(path.join(__dirname, 'test-a2ui-gallery.js'), 'utf8');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.log(`  ✗ ${name}\n      ${err.message}`); }
}
const ok = (value, msg) => assert.ok(value, msg);
const eq = (a, b, msg) => assert.deepStrictEqual(a, b, msg);

const ROWS = matrix.matrixRows();
const MIN_DATA = {
  note: '移项的本质是等式两边同减一个数。',
  prompt: '写出每一步的依据。',
  options: ['A. 3', 'B. 7', 'C. 10', 'D. 4'],
  answer: 'D. 4',
  steps: ['读题，找出未知数', '两边同时减 3', '算出 x = 4'],
  words: ['甲', '乙', '丙']
};

function compileRow(row, data = MIN_DATA) {
  const payload = { subject: row.subject, phase: row.phase, grade: row.grade, point: '测试知识点', data };
  return compileKnowledgeToA2UI(payload, {
    capabilities: matrix.capabilitiesFor(row.subject, row.phase, row.grade)
  });
}

(async () => {
  console.log('P2 知识组件回归：\n');

  await test('catalog 基础 32 个 + 19 个游戏组件，P2 清单恰好 8 个且互不重复', () => {
    eq(Object.keys(catalog.COMPONENTS).length, 32 + catalog.GAME_COMPONENTS.length);
    eq(catalog.P2_COMPONENTS.length, 8);
    eq(new Set(catalog.P2_COMPONENTS).size, 8);
    for (const name of catalog.P2_COMPONENTS) ok(catalog.COMPONENTS[name], `${name} 未登记`);
  });

  await test(`${Object.keys(catalog.COMPONENTS).length} 个组件全部有 renderer 分派实现`, () => {
    for (const name of Object.keys(catalog.COMPONENTS)) {
      ok(new RegExp(`^\\s*${name}:`, 'm').test(RENDER_SRC), `renderer 未实现 ${name}`);
    }
  });

  await test('8 个 P2 组件全部出现在 60 组配方中', () => {
    const used = new Set(ROWS.flatMap(row => row.components));
    for (const name of catalog.P2_COMPONENTS) ok(used.has(name), `${name} 没有进入任何配方`);
  });

  await test('每组配方恰好追加 1 个 P2 组件，且不超过阶段组件上限', () => {
    for (const row of ROWS) {
      const count = row.components.filter(name => catalog.P2_COMPONENTS.includes(name)).length;
      eq(count, 1, `${row.subject}.${row.phase}.${row.stage} 追加了 ${count} 个 P2 组件`);
      ok(row.components.length <= matrix.STAGE_RULES[row.stage].maxComponents,
        `${row.key} 超出阶段组件上限`);
    }
  });

  await test('60 组编译均生成 8 类新组件实例，属性全在 schema 白名单内', () => {
    const seen = new Set();
    for (const row of ROWS) {
      const messages = compileRow(row);
      ok(!messages.warnings.some(w => w.includes('未实现')), `${row.key} 有未实现组件`);
      for (const item of messages[0].createSurface.components) {
        if (!catalog.P2_COMPONENTS.includes(item.component)) continue;
        seen.add(item.component);
        const allowed = new Set(['id', 'component', ...catalog.COMPONENTS[item.component].props]);
        for (const key of Object.keys(item)) {
          ok(allowed.has(key), `${item.component}.${key} 不在 schema 白名单内`);
        }
      }
    }
    eq(seen.size, 8, `只生成了 ${[...seen].join('/')}`);
  });

  await test('启蒙期能力集不含抽象自检组件，青少年期全部放开', () => {
    const early = catalog.rendererCapabilities('grade1').components;
    const teen = catalog.rendererCapabilities('grade8').components;
    for (const name of ['Tabs', 'MethodNote', 'MasteryRing', 'FormulaBlock']) {
      ok(!early.includes(name), `启蒙期误放出 ${name}`);
      ok(teen.includes(name), `青少年期缺少 ${name}`);
    }
    for (const name of ['PictureChoice', 'NumberLine', 'IdiomCard']) {
      ok(early.includes(name), `启蒙期缺少适龄组件 ${name}`);
    }
  });

  await test('8 个 P2 组件被能力禁用时都能降级到 BASE 组件', () => {
    const caps = { stage: 'early', components: [...catalog.BASE_COMPONENTS],
      maxComponents: 16, textMaxLength: 12, version: '1.0' };
    for (const name of catalog.P2_COMPONENTS) {
      const target = catalog.fallbackFor(name, caps);
      ok(target && target !== name, `${name} 没有可用降级`);
      ok(caps.components.includes(target), `${name} 降级目标 ${target} 不在能力集内`);
    }
  });

  await test('扩展字段缺失时 P2 组件仍有内容，不会渲染成空白', () => {
    const messages = compileRow(ROWS[0], MIN_DATA);
    const k = messages[0].createSurface.dataModel.knowledge;
    ok(k.idiom.word && k.idiom.meaning, '成语卡兜底为空');
    ok(k.wordCard.word && k.wordCard.examples.length, '单词卡兜底为空');
    ok(k.numberLine.marks.length >= 2, '数轴刻度兜底为空');
    ok(k.pairs.length >= 1 && k.pairs[0].left, '配对兜底为空');
    ok(k.tabs.length >= 1 && k.activeTab, '分栏兜底为空');
    ok(k.methodNote.text, '方法笔记兜底为空');
    eq(k.mastery.value, 0, '掌握度默认应为 0（尚未练习）');
  });

  await test('调用方提供扩展字段时原样进入 dataModel，不被改写', () => {
    const custom = {
      ...MIN_DATA,
      idiom: { word: '画蛇添足', pinyin: 'huà shé tiān zú', meaning: '多此一举', example: '别再添了',
        tag: '寓言', level: '三年级', speech: '画蛇添足' },
      mastery: { value: 68, status: '连续做对 2 次', point: '等式性质', label: '掌握度' }
    };
    const k = compileRow(ROWS[0], custom)[0].createSurface.dataModel.knowledge;
    eq(k.idiom.word, '画蛇添足');
    eq(k.idiom.pinyin, 'huà shé tiān zú');
    eq(k.mastery.value, 68);
    eq(k.mastery.point, '等式性质');
  });

  await test('新组件不写 innerHTML / eval / new Function，形状与配色来自固定白名单', () => {
    ok(!/\.innerHTML\s*=/.test(RENDER_SRC), 'renderer 不应写 innerHTML');
    ok(!/\beval\(|new Function\b/.test(RENDER_SRC), 'renderer 不应执行字符串代码');
    ok(RENDER_SRC.includes('const SHAPE_COLORS'), '缺少固定配色白名单');
    ok(RENDER_SRC.includes('SHAPE_COLORS[index % SHAPE_COLORS.length]'), '配色未走白名单索引');
  });

  await test('P0 语文编译不受 P2 扩展影响', () => {
    const caps = catalog.rendererCapabilities('grade1');
    const messages = compileLessonToA2UI({
      idioms: [{ word: '开心' }], poems: [{ text: '春眠不觉晓', source: '孟浩然', tag: '春景' }],
      practicePrompt: '写一句'
    }, { grade: 'grade1', capabilities: caps });
    eq(messages.length, 3);
    eq(messages[0].createSurface.meta.uiVersion, 'p0');
    for (const message of messages) ok(catalog.validateMessage(message, caps).ok);
  });

  await test('8 个 P2 组件各有一张真实浏览器效果图定义', () => {
    for (const name of catalog.P2_COMPONENTS) {
      ok(GALLERY_SRC.includes(`component: '${name}'`), `${name} 缺少效果图`);
    }
  });

  console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
  if (failed) process.exitCode = 1;
})();
