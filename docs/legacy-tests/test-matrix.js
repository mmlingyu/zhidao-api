/* 知识组件矩阵回归（纯 Node，不依赖浏览器与服务）
 * 运行：node test-matrix.js
 *
 * 覆盖「学科 × 学习过程 × 认知阶段」60 组配方：组件白名单、renderer 实现、
 * 协议消息合法性、能力协商、年级/学科/过程差异，以及两个真实缺陷的回归：
 *   ① 认知负荷裁剪不能把正确答案裁掉；
 *   ② 线性分步不能把步骤内容藏起来。
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const matrix = require('./a2ui-matrix');
const catalog = require('./a2ui-catalog');
const { compileKnowledgeToA2UI, compileLessonToA2UI, applyCapabilities } = require('./a2ui-compiler');

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

const GRADES = {
  early: 'grade1', primary: 'grade3', upper: 'grade5', teen: 'grade8', senior: 'senior2'
};
const SUBJECTS = ['chinese', 'english', 'math'];
const PHASES = ['learn', 'practice', 'reinforce', 'transfer'];

/* 正确答案故意放在最后，用来验证低年级裁剪后仍选得到对的那一项。 */
const ANSWER = 'D. 云朵像棉花';
const SAMPLE = {
  poems: [{ text: '春眠不觉晓，处处闻啼鸟', source: '孟浩然《春晓》', tag: '春景' }],
  words: ['开心', '晴朗', '活泼'],
  speech: '春眠不觉晓，处处闻啼鸟',
  note: '比喻重在「像」，拟人重在把物当人写。',
  question: '下面哪一句用了比喻？',
  options: ['A. 月亮弯弯', 'B. 风儿轻轻唱着歌', 'C. 天很蓝', ANSWER],
  answer: ANSWER,
  steps: ['读题，圈出关键词', '找本体和喻体', '对照选项排除', '写出判断依据'],
  formula: 'ax + b = 0 → x = -b/a',
  formulaNote: 'a ≠ 0 时成立',
  prompt: '按提示完成一次练习'
};

function compile(subject, phase, grade, extra = {}) {
  const payload = { subject, phase, grade, point: '测试知识点', data: { ...SAMPLE, ...extra } };
  const capabilities = matrix.capabilitiesFor(subject, phase, grade);
  const messages = compileKnowledgeToA2UI(payload, { capabilities });
  return { messages, capabilities, recipe: matrix.recipeFor(subject, phase, grade) };
}

(async () => {
  console.log('知识组件矩阵回归：\n');

  await test('矩阵规模为 3 学科 × 4 过程 × 5 阶段 = 60 组且键唯一', () => {
    const rows = matrix.matrixRows();
    eq(rows.length, 60);
    eq(new Set(rows.map(r => `${r.subject}.${r.phase}.${r.stage}`)).size, 60);
    eq(new Set(rows.map(r => r.subject)).size, 3);
    eq(new Set(rows.map(r => r.phase)).size, 4);
  });

  await test('60 组配方组件全部登记在 catalog 白名单', () => {
    for (const row of matrix.matrixRows()) {
      for (const name of row.components) {
        ok(catalog.COMPONENTS[name], `${row.subject}.${row.phase}.${row.stage} 用了未登记组件 ${name}`);
      }
    }
  });

  await test('60 组配方组件全部有 renderer 实现（不会静默跳过）', () => {
    const src = fs.readFileSync(path.join(__dirname, 'a2ui-render.js'), 'utf8');
    for (const row of matrix.matrixRows()) {
      for (const name of row.components) {
        ok(new RegExp(`^\\s*${name}:`, 'm').test(src),
          `renderer 未实现 ${name}（${row.subject}.${row.phase}.${row.stage}）`);
      }
    }
  });

  await test('60 组 capabilitiesFor 覆盖配方组件且容量充足', () => {
    for (const row of matrix.matrixRows()) {
      const caps = matrix.capabilitiesFor(row.subject, row.phase, row.grade);
      for (const name of row.components) {
        ok(caps.components.includes(name), `${name} 未进入能力集`);
      }
      ok(caps.maxComponents >= row.components.length + 2, 'maxComponents 过小');
    }
  });

  await test('60 组编译产物共 180 条消息全部通过协议校验', () => {
    let checked = 0;
    for (const subject of SUBJECTS) for (const phase of PHASES) for (const grade of Object.values(GRADES)) {
      const { messages, capabilities } = compile(subject, phase, grade);
      eq(messages.length, 3, `${subject}.${phase}.${grade} 消息数不对`);
      for (const message of messages) {
        const result = catalog.validateMessage(message, capabilities);
        ok(result.ok, `${subject}.${phase}.${grade}: ${result.errors.join('；')}`);
        checked++;
      }
    }
    eq(checked, 180);
  });

  await test('消息流顺序为 createSurface → updateComponents → updateDataModel', () => {
    const { messages } = compile('math', 'reinforce', 'grade8');
    ok(messages[0].createSurface, '首条应为 createSurface');
    ok(messages[1].updateComponents, '第二条应为 updateComponents');
    ok(messages[2].updateDataModel, '第三条应为 updateDataModel');
    eq(messages[2].updateDataModel.path, '/knowledge/poems');
    const meta = messages[0].createSurface.meta;
    eq(meta.subject, 'math'); eq(meta.phase, 'reinforce'); eq(meta.stage, 'teen');
    ok(meta.recipeKey === 'math.reinforce.teen', 'recipeKey 应写入 surface meta');
  });

  await test('surfaceId 按学科 / 过程 / 认知阶段区分', () => {
    const ids = new Set();
    for (const subject of SUBJECTS) for (const phase of PHASES) for (const stage of Object.keys(GRADES)) {
      const { messages } = compile(subject, phase, GRADES[stage]);
      ids.add(messages[0].createSurface.surfaceId);
    }
    eq(ids.size, 60);
  });

  await test('认知阶段规则：启蒙期 2 选项 / 线性 / 无公式与抽象组件', () => {
    const r = matrix.recipeFor('math', 'reinforce', 'grade1');
    eq(r.optionCount, 2); eq(r.stepMode, 'linear'); eq(r.stage, 'early');
    ok(!r.components.includes('FormulaBlock'), '低年级不应出现公式块');
    ok(!r.components.includes('Text'), '低年级不应出现抽象说明');
    ok(r.components.includes('HintBar'), '抽象说明应降级为提示条而不是删除');
  });

  await test('认知阶段规则：青少年 4 选项 / 全展开 / 允许公式', () => {
    const r = matrix.recipeFor('math', 'reinforce', 'grade8');
    eq(r.optionCount, 4); eq(r.stepMode, 'all'); eq(r.stage, 'teen');
    ok(r.components.includes('FormulaBlock'), '初中应允许公式块');
  });

  await test('学科差异：同一「初识」过程三学科组件配方各不相同', () => {
    const learn = sub => matrix.recipeFor(sub, 'learn', 'grade5').components.join('/');
    eq(new Set(SUBJECTS.map(learn)).size, 3);
    ok(matrix.recipeFor('chinese', 'learn', 'grade5').components.includes('PoemLine'));
    ok(matrix.recipeFor('english', 'learn', 'grade5').components.includes('SpeakButton'));
    ok(matrix.recipeFor('math', 'learn', 'grade5').components.includes('StepReveal'));
  });

  await test('过程差异：同一学科四个过程的组件与提示都不同', () => {
    for (const subject of SUBJECTS) {
      const recipes = PHASES.map(phase => matrix.recipeFor(subject, phase, 'grade5'));
      eq(new Set(recipes.map(r => r.components.join('/'))).size, 4, `${subject} 过程配方重复`);
      eq(new Set(recipes.map(r => r.hint)).size, 4, `${subject} 过程提示重复`);
      eq(new Set(recipes.map(r => r.prompt)).size, 4, `${subject} 生成侧约束重复`);
    }
  });

  await test('【缺陷回归】裁剪选项时正确答案必须保留（答案排在最后）', () => {
    for (const subject of SUBJECTS) {
      const { messages } = compile(subject, 'practice', 'grade1');
      const model = messages[0].createSurface.dataModel;
      const options = model.knowledge.options;
      eq(options.length, 2, `${subject} 启蒙期应只呈现 2 个选项`);
      ok(options.includes(ANSWER), `${subject} 启蒙期把正确答案裁掉了`);
      eq(model.knowledge.answer, ANSWER);
    }
    // 高年级不裁剪
    const teen = compile('english', 'practice', 'grade8');
    eq(teen.messages[0].createSurface.dataModel.knowledge.options.length, 4);
  });

  await test('【缺陷回归】线性分步保留全部步骤正文，不隐藏知识', () => {
    const { messages } = compile('math', 'practice', 'grade1');
    const model = messages[0].createSurface.dataModel;
    eq(model.knowledge.steps.length, 4);
    eq(model.knowledge.steps[3], '写出判断依据');
    eq(model.knowledge.stepCurrent, 0, '线性模式应高亮第一步');
    const src = fs.readFileSync(path.join(__dirname, 'a2ui-render.js'), 'utf8');
    ok(!src.includes('点下一步展开'), 'renderer 不应以占位文字替换步骤正文');
    ok(src.includes('全部步骤始终显示真实内容'), '步骤正文必须始终可见');
  });

  await test('高年级分步一次看全且按钮禁用文案正确', () => {
    const { messages } = compile('math', 'practice', 'grade8');
    const model = messages[0].createSurface.dataModel;
    eq(model.knowledge.stepCurrent, model.knowledge.steps.length);
    const src = fs.readFileSync(path.join(__dirname, 'a2ui-render.js'), 'utf8');
    ok(src.includes("allShown ? '步骤已全部展开'"), '全展开时按钮文案应明确');
  });

  await test('年级操作提示随阶段变化，青少年不含幼态化措辞', () => {
    const r1 = matrix.recipeFor('chinese', 'practice', 'grade1');
    const r8 = matrix.recipeFor('chinese', 'practice', 'grade8');
    ok(r1.hint !== r8.hint, '不同年级提示应不同');
    for (const stage of ['teen', 'senior']) {
      const r = matrix.recipeFor('english', 'transfer', GRADES[stage]);
      for (const word of ['小朋友', '宝贝', '太棒啦', '爸爸妈妈']) {
        ok(!r.hint.includes(word), `${stage} 提示含幼态词「${word}」`);
      }
    }
  });

  await test('能力降级：不支持的组件降级后组件名确实改变且消息仍合法', () => {
    const caps = matrix.capabilitiesFor('chinese', 'learn', 'grade5');
    const limited = { ...caps, components: caps.components.filter(n => n !== 'PoemLine' && n !== 'ChoiceQuiz') };
    const warnings = [];
    const raw = [
      { id: 'root', component: 'Column', children: ['p', 'q'] },
      { id: 'p', component: 'PoemLine', text: '春眠不觉晓' },
      { id: 'q', component: 'ChoiceQuiz', question: '选一个', options: ['A', 'B'] }
    ];
    const out = applyCapabilities(raw, limited, warnings);
    const byId = Object.fromEntries(out.map(item => [item.id, item]));
    ok(byId.p.component !== 'PoemLine', 'PoemLine 未降级');
    ok(byId.q.component !== 'ChoiceQuiz', 'ChoiceQuiz 未降级');
    ok(limited.components.includes(byId.p.component), '降级目标不在能力集内');
    ok(warnings.length >= 2, '降级应产生可观测告警');
  });

  await test('降级后知识正文不丢失', () => {
    const caps = matrix.capabilitiesFor('chinese', 'learn', 'grade1');
    const limited = { ...caps, components: caps.components.filter(n => n !== 'PoemLine') };
    const warnings = [];
    const out = applyCapabilities([
      { id: 'root', component: 'Column', children: ['p'] },
      { id: 'p', component: 'PoemLine', text: '春眠不觉晓', source: '孟浩然', tag: '春景' }
    ], limited, warnings);
    const p = out.find(item => item.id === 'p');
    ok(p.text === '春眠不觉晓', '降级把诗句正文丢了');
  });

  await test('XSS 载荷只作为字符串进入 dataModel，不生成 HTML', () => {
    const evil = '<img src=x onerror=alert(9)><script>alert(1)</script>';
    const { messages } = compile('chinese', 'transfer', 'grade8', { note: evil, prompt: evil });
    const model = messages[0].createSurface.dataModel;
    eq(model.knowledge.note, evil);
    eq(model.practice.prompt, evil);
    // 载荷留在数据模型里是允许的（会被当纯文本渲染），关键是 renderer 不解析 HTML。
    const renderer = fs.readFileSync(path.join(__dirname, 'a2ui-render.js'), 'utf8');
    ok(!/\.innerHTML\s*=/.test(renderer), 'renderer 不应使用 innerHTML 写入模型字符串');
    ok(renderer.includes('node.textContent = text(content)'), 'renderer 必须经 textContent 落地');
  });

  await test('无效年级与学科安全回落到默认阶段 / chinese', () => {
    eq(matrix.stageOf('nope'), 'upper', '未知年级应回落到 grade-profile 的默认阶段');
    ok(matrix.STAGE_RULES[matrix.stageOf('nope')], '回落阶段必须在规则表内');
    const r = matrix.recipeFor('physics', 'exam', 'grade8');
    eq(r.subject, 'chinese'); eq(r.phase, 'learn');
    const { messages, capabilities } = compile('physics', 'exam', 'grade8');
    for (const m of messages) ok(catalog.validateMessage(m, capabilities).ok);
  });

  await test('矩阵资源已登记到 index.html / server.js / sw.js', () => {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
    for (const [name, src] of [['index.html', html], ['server.js', server], ['sw.js', sw]]) {
      ok(src.includes('a2ui-matrix.js'), `${name} 未登记 a2ui-matrix.js`);
    }
    ok(html.indexOf('a2ui-matrix.js') < html.indexOf('a2ui-compiler.js'), '矩阵必须先于编译器加载');
  });

  await test('矩阵扩展不改动 P0 的 compileLessonToA2UI', () => {
    const lesson = { idioms: [{ word: '开心' }], poems: SAMPLE.poems, practicePrompt: '写一句' };
    const caps = catalog.rendererCapabilities('grade1');
    const messages = compileLessonToA2UI(lesson, { grade: 'grade1', capabilities: caps });
    eq(messages.length, 3);
    ok(messages[0].createSurface.meta.uiVersion === 'p0');
    for (const m of messages) ok(catalog.validateMessage(m, caps).ok);
  });

  console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
  if (failed) process.exitCode = 1;
})();
