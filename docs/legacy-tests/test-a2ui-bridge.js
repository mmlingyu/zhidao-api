/* 知识展示 ↔ A2UI 桥接层 · Node 专项回归
 *
 * 覆盖：课程 JSON 归一、学习过程判定、年级画像、游戏化关卡触发条件、
 *       三学科 × 三阶段 × 三年级的编译产物合法性、正确答案不丢、消息流可 JSONL 往返。
 * 运行： npm run test:a2ui:bridge
 */
'use strict';

const bridge = require('./a2ui-bridge');
const compiler = require('./a2ui-compiler');
const catalog = require('./a2ui-catalog');
const matrix = require('./a2ui-matrix');
const play = require('./a2ui-play');

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

const LESSONS = {
  chinese: {
    subject: 'chinese', input: '开心',
    data: {
      idioms: [
        { word: '触景生情', pinyin: 'chù jǐng shēng qíng', tag: '情境表达', level: 1,
          meaning: '看到景物引发感情', example: '看到花开就想起春天', scene: '春游' },
        { word: '情景交融', pinyin: 'qíng jǐng jiāo róng', tag: '写法积累', level: 2,
          meaning: '情与景互相融合', example: '写景时带着心情', scene: '写作' },
        { word: '妙笔生花', pinyin: 'miào bǐ shēng huā', tag: '生动表达', level: 3,
          meaning: '文笔出色', example: '一段话写活了春天', scene: '写作' }
      ],
      poems: [{ text: '春眠不觉晓，处处闻啼鸟', source: '孟浩然《春晓》', tag: '春景' }],
      practicePrompt: '用上「触景生情」写一句话。'
    }
  },
  english: {
    subject: 'english', input: 'play / do / go',
    data: {
      mnemonic: '先看场景，再比较规则',
      items: [
        { word: 'make', title: '场景 1', description: '制作、产生', examples: [{ en: 'make a plan', cn: '制定计划' }], tip: '搭配记忆' },
        { word: 'do', title: '场景 2', description: '做、执行', examples: [{ en: 'do homework', cn: '做作业' }], tip: '固定搭配' },
        { word: 'have', title: '场景 3', description: '拥有', examples: [{ en: 'have a rest', cn: '休息一下' }], tip: '整体积累' }
      ],
      quizzes: [{ sentence: 'Please ___ your homework.', choices: ['make', 'do', 'have'], answer: 'do', explain: 'do homework 是固定搭配' }],
      difference: { question: '为什么不能只按中文翻译选？', answer: '搭配由习惯和语法共同决定' }
    }
  },
  math: {
    subject: 'math', input: 'x² - 5x + 6 = 0',
    data: {
      methods: [{ name: '一般人', title: '通法', insight: '先因式分解再求根', quote: '先理解，再计算',
        steps: [
          { title: '第 1 步', text: '整理方程', formula: 'x² - 5x + 6 = 0' },
          { title: '第 2 步', text: '分解因式', formula: '(x-2)(x-3)=0' }
        ] }],
      challenge: { question: '说出已知条件与目标', answer: '求 x 的值' }
    }
  }
};

console.log('\n一、学习过程与年级画像');
test('三科默认学习过程：语文练习 / 英语练习 / 数学强化', () => {
  eq(bridge.phaseFor(LESSONS.chinese), 'practice');
  eq(bridge.phaseFor(LESSONS.english), 'practice');
  eq(bridge.phaseFor(LESSONS.math), 'reinforce');
});
test('显式 phase 优先，非法 phase 回退到合法值', () => {
  eq(bridge.phaseFor(LESSONS.math, { phase: 'transfer' }), 'transfer');
  eq(bridge.phaseFor(LESSONS.chinese, { phase: 'not-a-phase' }), 'practice');
});
test('英语作答后推进到强化', () => {
  eq(bridge.phaseFor(LESSONS.english, { quizAnswered: true }), 'reinforce');
});
test('stageOf 覆盖 5 个认知阶段，未指定年级走项目默认画像', () => {
  eq(bridge.stageOf('grade1'), 'early');
  eq(bridge.stageOf('grade3'), 'primary');
  eq(bridge.stageOf('grade5'), 'upper');
  eq(bridge.stageOf('grade8'), 'teen');
  eq(bridge.stageOf('senior1'), 'senior');
  // grade-profile.DEFAULT_STAGE = upper；桥接层必须与矩阵用同一把标尺，
  // 否则 status.stage 会和实际配方不一致。
  eq(bridge.stageOf(''), matrix.stageOf(''));
  eq(bridge.stageOf(''), 'upper');
});

console.log('\n二、课程 JSON → 知识数据归一（不编造知识点）');
test('语文：诗句 / 词语 / 成语卡 / 例句全部来自 data', () => {
  const k = bridge.knowledgeFromLesson(LESSONS.chinese);
  eq(k.point, '开心');
  eq(k.data.poems.length, 1);
  eq(k.data.words.join(','), '触景生情,情景交融,妙笔生花');
  eq(k.data.answer, '触景生情');
  eq(k.data.idiom.pinyin, 'chù jǐng shēng qíng');
  eq(k.data.tabs.length, 3);
  ok(k.data.speech.includes('春眠不觉晓'), '朗读串包含诗句');
});
test('英语：选项与正确答案来自 quizzes，单词卡来自 items', () => {
  const k = bridge.knowledgeFromLesson(LESSONS.english);
  eq(k.data.options.join(','), 'make,do,have');
  eq(k.data.answer, 'do');
  eq(k.data.wordCard.word, 'make');
  ok(k.data.wordCard.examples[0].includes('make a plan'), '例句来自课程');
  ok(k.data.note.includes('搭配'), '辨析说明来自课程');
});
test('数学：步骤 / 公式 / 数轴 / 掌握度都绑定到本课知识点', () => {
  const k = bridge.knowledgeFromLesson(LESSONS.math);
  eq(k.point, 'x² - 5x + 6 = 0');
  eq(k.data.steps.length, 2);
  eq(k.data.formula, 'x² - 5x + 6 = 0');
  eq(k.data.numberLine.marks.length, 4);
  eq(k.data.mastery.point, k.point);
  ok(k.data.tabs.length > 0, '至少有一个思路分栏');
});
test('空课程不产生空白知识点，也不抛异常', () => {
  const k = bridge.knowledgeFromLesson({ subject: 'chinese', input: '测试', data: {} });
  eq(k.data.words.length, 0);
  eq(k.data.options.length, 0);
  ok(typeof k.data.prompt === 'string' && k.data.prompt.length > 0, '练习提示有兜底');
});

test('未作答的反馈区注入真实空态文案，不靠 CSS 隐藏', () => {
  const k = bridge.knowledgeFromLesson(LESSONS.chinese);
  const messages = compiler.compileKnowledgeToA2UI({ subject: 'chinese', phase: 'practice', grade: 'grade1', data: k.data },
    { capabilities: matrix.capabilitiesFor('chinese', 'practice', 'grade1') });
  eq(messages[0].createSurface.dataModel.practice.feedback, '');
  eq(bridge.primeEmptyFeedback(messages, messages.meta.recipe), 1);
  ok(messages[0].createSurface.dataModel.practice.feedback.length > 0, '空态有文字');
  eq(messages[0].createSurface.dataModel.practice.tone, 'hint');
  eq(bridge.primeEmptyFeedback(messages, messages.meta.recipe), 0, '重复调用幂等');
  for (const message of messages) {
    ok(catalog.validateMessage(message, matrix.capabilitiesFor('chinese', 'practice', 'grade1')).ok, '注入后仍合法');
  }
});

console.log('\n三、游戏化关卡触发条件');
test('数学 + 强化 + 题目含数字 → 触发', () => {
  ok(bridge.shouldShowPlay({ subject: 'math', phase: 'reinforce', grade: 'grade1', point: 'x² - 5x + 6 = 0', data: {} }));
});
test('数学 + 练习 + 找规律关键词 → 触发', () => {
  ok(bridge.shouldShowPlay({ subject: 'math', phase: 'practice', grade: 'grade3', point: '找规律填数', data: {} }));
});
test('非数学 / 初识阶段 / 已掌握 → 不触发', () => {
  ok(!bridge.shouldShowPlay({ subject: 'chinese', phase: 'practice', grade: 'grade1', point: '开心', data: {} }));
  ok(!bridge.shouldShowPlay({ subject: 'math', phase: 'learn', grade: 'grade1', point: 'x+3=7', data: {} }));
  ok(!bridge.shouldShowPlay({ subject: 'math', phase: 'reinforce', grade: 'grade5', point: 'x+3=7', data: {}, mastery: 90 }));
});
test('模型显式给出 puzzle 或调用方 force 时开启（不误突破初识阶段）', () => {
  ok(bridge.shouldShowPlay({ subject: 'math', phase: 'reinforce', point: '证明', data: { puzzle: { slots: [], answers: [] } } }));
  ok(!bridge.shouldShowPlay({ subject: 'math', phase: 'learn', data: { puzzle: { slots: [], answers: [] } } }));
  ok(bridge.shouldShowPlay({ subject: 'chinese', phase: 'learn', force: true }));
});
test('无数字、无关键词、无 puzzle 时不误触发', () => {
  ok(!bridge.shouldShowPlay({ subject: 'math', phase: 'reinforce', grade: 'grade8', point: '证明', data: {} }));
});
test('puzzleFor 保留模型数据，否则只绑定本课知识点', () => {
  const custom = bridge.puzzleFor({ input: '数列', data: { puzzle: { slots: [1, '', 3], answers: ['2'] } } });
  eq(custom.slots.length, 3);
  eq(custom.point, '数列');
  const fallback = bridge.puzzleFor(LESSONS.math);
  eq(fallback.point, 'x² - 5x + 6 = 0');
  ok(!Array.isArray(fallback.slots), '未编造格子数据');
});

console.log('\n四、编译产物与协议合法性');
const GRADES = ['grade1', 'grade5', 'grade8'];
let compiled = 0;
for (const subject of ['chinese', 'english', 'math']) {
  for (const grade of GRADES) {
    test(`${subject} · ${grade}：消息全部合法且组件树非空`, () => {
      const lesson = LESSONS[subject];
      const phase = bridge.phaseFor(lesson);
      const knowledge = bridge.knowledgeFromLesson(lesson);
      const capabilities = matrix.capabilitiesFor(subject, phase, grade);
      const messages = compiler.compileKnowledgeToA2UI(
        { subject, phase, grade, point: knowledge.point, data: knowledge.data },
        { capabilities, surfaceId: `zhidao_bridge_${subject}_${phase}` }
      );
      eq(messages.length, 3, '消息条数');
      ok(messages.meta.componentCount > 0, '组件表非空');
      for (const message of messages) {
        const result = catalog.validateMessage(message, capabilities);
        ok(result.ok, `validateMessage: ${(result.errors || []).join('；')}`);
      }
      // JSONL 往返后仍合法（与 SSE 推流同构）
      for (const line of messages.map(m => JSON.stringify(m)).join('\n').split('\n')) {
        ok(catalog.validateMessage(JSON.parse(line), capabilities).ok, 'JSONL 往返');
      }
      compiled++;
    });
  }
}
test('九组配方都成功编译', () => eq(compiled, 9));

test('同一学科换年级：配方 key、认知阶段、组件数都变', () => {
  const k = bridge.knowledgeFromLesson(LESSONS.math);
  const early = compiler.compileKnowledgeToA2UI({ subject: 'math', phase: 'reinforce', grade: 'grade1', data: k.data }, { capabilities: matrix.capabilitiesFor('math', 'reinforce', 'grade1') });
  const teen = compiler.compileKnowledgeToA2UI({ subject: 'math', phase: 'reinforce', grade: 'grade8', data: k.data }, { capabilities: matrix.capabilitiesFor('math', 'reinforce', 'grade8') });
  ok(early.meta.recipe.key !== teen.meta.recipe.key, '配方 key');
  eq(early.meta.stage, 'early');
  eq(teen.meta.stage, 'teen');
  ok(teen.meta.recipe.optionCount > early.meta.recipe.optionCount, '高龄选项更多');
});
test('同一年级换学科：组件组合不同', () => {
  const make = subject => {
    const k = bridge.knowledgeFromLesson(LESSONS[subject]);
    const phase = bridge.phaseFor(LESSONS[subject]);
    return compiler.compileKnowledgeToA2UI({ subject, phase, grade: 'grade8', data: k.data },
      { capabilities: matrix.capabilitiesFor(subject, phase, 'grade8') }).meta.recipe.components.join(',');
  };
  ok(make('chinese') !== make('english') && make('english') !== make('math'), '三科配方互不相同');
});
test('低龄裁选项时正确答案仍在（不把知识点裁掉）', () => {
  const k = bridge.knowledgeFromLesson(LESSONS.english);
  k.data.options = ['make', 'do', 'have', 'take'];
  k.data.answer = 'take';
  const messages = compiler.compileKnowledgeToA2UI({ subject: 'english', phase: 'practice', grade: 'grade1', data: k.data },
    { capabilities: matrix.capabilitiesFor('english', 'practice', 'grade1') });
  const options = messages[0].createSurface.dataModel.knowledge.options;
  ok(options.includes('take'), `正确答案被裁掉：${options.join(',')}`);
});
test('游戏化关卡消息合法且包含 6 个 P3 组件', () => {
  const messages = play.compilePlayStageToA2UI({ grade: 'grade1', puzzle: bridge.puzzleFor(LESSONS.math) });
  const capabilities = catalog.rendererCapabilities('grade1');
  for (const message of messages) ok(catalog.validateMessage(message, capabilities).ok, '关卡消息校验');
  const names = messages[0].createSurface.components.map(item => item.component);
  for (const name of ['NumberGaps', 'QuestHUD', 'VoiceGuide', 'AskIP', 'QuickQuestions', 'HintLadder']) {
    ok(names.includes(name), `${name} 缺失`);
  }
});
test('Node 环境不触碰 DOM：mount 返回 null，status 表示未挂载', () => {
  eq(bridge.mount(LESSONS.chinese), null);
  eq(bridge.status().mounted, false);
});

console.log(`\n桥接层回归：${passed}/${passed + failed} 通过`);
if (failed) process.exit(1);
