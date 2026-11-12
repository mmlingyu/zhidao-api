/* 知识交互组件总览 · 映射表回归
 *
 * 覆盖：问题类型信号命中、学科隔离、强信号压制、年级/过程约束、
 *       组件规格完整性、fallback / reuse / 证据类型、批次覆盖、UMD 双端。
 * 运行： npm run test:a2ui:map
 */
'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const map = require('./a2ui-question-map');
const catalog = require('./a2ui-catalog');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.log(`  ✗ ${name} → ${error.message}`); }
}
function eq(actual, expected, label = '') {
  if (actual !== expected) throw new Error(`${label || '值'} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function ok(value, label = '条件') { if (!value) throw new Error(`${label} 不成立`); }

console.log('\n【一】总览数据完整性');

test('19 个组件 / 20 类问题 / 8 个问题域', () => {
  eq(map.COMPONENT_SPECS.length, 19, '组件数');
  eq(map.QUESTION_TYPES.length, 20, '问题类型数');
  eq(Object.keys(map.DOMAINS).length, 8, '问题域数');
});

test('5 个认知阶段与 4 个学习过程与 matrix / grade-profile 对齐', () => {
  eq(map.STAGES.map(s => s.id).join(','), 'early,primary,upper,teen,senior', '阶段');
  eq(map.PHASES.map(p => p.id).join(','), 'learn,practice,reinforce,transfer', '过程');
});

test('audit 自检零问题（含 fallback / reuse / 批次 / 证据）', () => {
  const audit = map.audit();
  eq(audit.issues.length, 0, `问题数：${audit.issues.join('；')}`);
  eq(audit.componentCount, 19, '组件数');
  eq(audit.implementedCount, Object.keys(catalog.COMPONENTS).length, '已实现组件数');
});

test('每个组件规格字段齐全，且模型字段不含 UI 词', () => {
  for (const spec of map.COMPONENT_SPECS) {
    for (const key of ['name', 'label', 'domain', 'summary', 'kind', 'batch', 'status',
      'modelFields', 'derived', 'actions', 'evidence', 'fallback', 'reuse', 'gradeNotes', 'risk']) {
      ok(spec[key] != null && (Array.isArray(spec[key]) ? spec[key].length : String(spec[key]).length),
        `${spec.name} 缺 ${key}`);
    }
    ok(['designed', 'implemented'].includes(spec.status), `${spec.name} 状态非法`);
    // 19 个组件已全部落地：status 必须与 catalog 登记一致，不能出现「文档说实现了、代码没有」。
    eq(Object.keys(catalog.COMPONENTS).includes(spec.name), spec.status === 'implemented',
      `${spec.name} 状态与 catalog 不一致`);
    const fields = spec.modelFields.join(' ').toLowerCase();
    for (const forbidden of ['component', 'classname', 'action', 'style', 'html', 'css']) {
      ok(!fields.includes(forbidden), `${spec.name} 的模型字段不应含 ${forbidden}`);
    }
    ok(/^[A-Z][A-Za-z]+$/.test(spec.name), `${spec.name} 组件名格式`);
  }
});

test('每个组件都有指向已实现组件的降级链', () => {
  const implemented = Object.keys(catalog.COMPONENTS);
  for (const spec of map.COMPONENT_SPECS) {
    ok(implemented.includes(spec.fallback), `${spec.name} → ${spec.fallback} 未实现`);
    // 组件实现后 catalog 会登记降级链；那时必须与总览表保持一致。
    if (catalog.FALLBACKS[spec.name]) {
      eq(catalog.FALLBACKS[spec.name], spec.fallback, `${spec.name} 降级一致性`);
    }
    eq(implemented.includes(spec.name), spec.status === 'implemented',
      `${spec.name} 的实现状态与 catalog 不一致`);
  }
});

test('证据类型只落在掌握度引擎允许的六类', () => {
  const allowed = ['lesson', 'correct', 'wrong', 'created', 'asked', 'recited'];
  for (const spec of map.COMPONENT_SPECS) {
    ok(allowed.includes(spec.evidence), `${spec.name} 证据 ${spec.evidence}`);
  }
  // 开放题（分支选择 / 笔顺 / 句子积木）不能记「答对」
  for (const name of ['StoryBranch', 'StrokeOrder', 'SentenceBlocks']) {
    ok(['created', 'asked', 'recited'].includes(map.specFor(name).evidence), `${name} 是开放产出`);
  }
});

test('19 个组件被 4 个批次完整覆盖且无重复', () => {
  const batched = map.BATCHES.flatMap(b => b.components);
  eq(batched.length, 19, '批次组件总数');
  eq(new Set(batched).size, 19, '去重后');
  for (const b of map.BATCHES) {
    ok(b.goal && b.gate && b.theme && b.risk, `${b.id} 批次字段`);
  }
  eq(map.RULES.length, 10, '硬规则数');
  eq(map.CHECKLIST.length, 7, '实现清单步数');
});

console.log('\n【二】用户问题 → UI 的判定');

test('40 条真实提问样例全部命中自己的题型', () => {
  let count = 0;
  for (const q of map.QUESTION_TYPES) {
    for (const example of q.examples) {
      count++;
      const hit = map.classifyQuestion(example, q.subject);
      ok(hit, `「${example}」未识别`);
      eq(hit.id, q.id, `「${example}」`);
    }
  }
  eq(count, 40, '样例数');
});

test('学科隔离：语文提问不会命中英语 / 数学题型', () => {
  for (const subject of ['chinese', 'english', 'math']) {
    for (const q of map.QUESTION_TYPES) {
      if (q.subject !== subject) continue;
      const hit = map.classifyQuestion(q.examples[0], subject);
      ok(hit && hit.subject === subject, `${q.id} 学科串了`);
    }
  }
  eq(map.classifyQuestion('yesterday 用什么时态', 'chinese'), null, '跨学科时应无匹配');
});

test('强信号压制弱信号（加法口算 / 平均分成）', () => {
  eq(map.classifyQuestion('给我出 5 道加法口算', 'math').id, 'calc.drill');
  eq(map.classifyQuestion('把圆平均分成 4 份怎么切？', 'math').id, 'apply.geometry');
  eq(map.classifyQuestion('用这几个词连成一句话', 'english').id, 'grammar.order');
  eq(map.classifyQuestion('27 + 45 等于多少？', 'math').id, 'calc.arithmetic');
});

test('识别不了就返回 null，让原 60 组配方兜底', () => {
  eq(map.classifyQuestion('', 'chinese'), null, '空输入');
  eq(map.classifyQuestion('今天天气不错', 'chinese'), null, '闲聊');
  eq(map.classifyQuestion('<script>alert(1)</script>', 'math'), null, '注入串');
});

test('题型的主组件与问题域一致', () => {
  for (const q of map.QUESTION_TYPES) {
    ok(map.DOMAINS[q.domain], `${q.id} 域不存在`);
    eq(map.DOMAINS[q.domain].subject, q.subject, `${q.id} 域学科`);
    if (q.batch === 'done') continue;
    const spec = map.specFor(q.primary);
    ok(spec, `${q.id} 主组件未登记`);
    eq(spec.domain, q.domain, `${q.id} 主组件域`);
    eq(spec.batch, q.batch, `${q.id} 批次`);
  }
});

console.log('\n【三】过程 / 年级约束');

test('初识阶段不自动弹游戏组件', () => {
  const hit = map.componentsFor('story.sequence', 'learn', 'grade1');
  eq(hit.allowed, false, 'allowed');
  ok(hit.notes.some(n => n.includes('不自动弹出')), '应给出原因');
  eq(map.componentsFor('story.sequence', 'practice', 'grade1').allowed, true, '练习阶段');
});

test('低龄禁用真实倒计时，青少年要求写依据', () => {
  const young = map.componentsFor('calc.drill', 'reinforce', 'grade1');
  ok(young.notes.some(n => n.includes('真实倒计时')), '低龄倒计时提示');
  const teen = map.componentsFor('grammar.fix', 'practice', 'grade8');
  ok(teen.notes.some(n => n.includes('写出依据')), '青少年依据提示');
  eq(teen.stage, 'teen', '阶段');
});

test('已覆盖题型（找规律）标注无需新组件', () => {
  const hit = map.componentsFor('calc.pattern', 'practice', 'grade4');
  eq(hit.status, 'implemented', '状态');
  ok(hit.notes.some(n => n.includes('NumberGaps')), '覆盖说明');
});

test('年级映射与 grade-profile 五阶段一致', () => {
  eq(map.stageOf('preschool'), 'early');
  eq(map.stageOf('grade1'), 'early');
  eq(map.stageOf('grade3'), 'primary');
  eq(map.stageOf('grade6'), 'upper');
  eq(map.stageOf('grade8'), 'teen');
  eq(map.stageOf('grade11'), 'senior');
  eq(map.stageOf(''), 'generic');
});

test('specFor 精确查找、未知组件返回 null', () => {
  eq(map.specFor('PoemTiles').label, '诗句拼图');
  eq(map.specFor('NotExist'), null);
  eq(map.componentsFor('not-exist', 'practice', 'grade1'), null);
});

console.log('\n【四】UMD 双端可用');

test('浏览器环境无 module 时挂到 window，且不依赖 catalog', () => {
  const source = fs.readFileSync(require.resolve('./a2ui-question-map'), 'utf8');
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'a2ui-question-map.js' });
  const api = sandbox.ZHIDAO_A2UI_QUESTION_MAP;
  ok(api, '全局对象');
  eq(api.VERSION, map.VERSION, '版本');
  eq(api.COMPONENT_SPECS.length, 19, '组件数');
  eq(api.classifyQuestion('「床前明月光」的下一句是什么？', 'chinese').id, 'poem.complete');
  eq(api.audit().issues.length, 0, '无 catalog 时的自检');
});

console.log(`\n全部通过：${passed} 项断言，失败 ${failed} 项。`);
process.exitCode = failed ? 1 : 0;
