'use strict';
const assert = require('assert');
const path = require('path');
const validate = require('./a2ui-validate');
const compiler = require('./a2ui-compiler');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('  ok  ' + name); }
  catch (error) { failed += 1; console.log('  FAIL  ' + name + ' — ' + error.message); }
}

function P(path) { return { '@path': path }; }

function goldLesson() {
  return {
    subject: 'english',
    phase: 'practice',
    grade: 'grade3',
    point: 'gold is a girl',
    data: {
      question: "在 'gold is a girl' 中, 'gold' 的意思是什么?",
      options: ['金钱', '美丽和魅力', '石头', '花朵'],
      answer: '美丽和魅力',
      speech: '',
      note: "在这里 gold 不是金币，而是形容人如金一样美丽或有价值的比喻。",
      quizzes: [
        {
          sentence: "在 'gold is a girl' 中, 'gold' 的意思是什么?",
          choices: ['金钱', '美丽和魅力', '石头', '花朵'],
          answer: '美丽和魅力'
        },
        {
          sentence: "She's a gold friend 里的 gold 更接近哪一种意思？",
          choices: ['金色的', '珍贵的', '沉重的'],
          answer: '珍贵的'
        }
      ],
      items: [
        { word: 'gold', examples: [] },
        { word: 'girl', examples: [{ en: 'She is gold.', cn: '她像金子一样珍贵。' }] }
      ]
    }
  };
}

test('空白朗读卡：从本课例句补齐', () => {
  const result = validate.optimize({
    components: [
      { id: 'root', component: 'Column', children: ['card0'] },
      { id: 'card0', component: 'Card', children: ['speak'] },
      { id: 'speak', component: 'SpeakButton', label: '朗读', text: P('/knowledge/speech') }
    ],
    dataModel: { knowledge: { speech: '' } },
    extras: { data: { items: [{ examples: [{ en: 'She is gold.' }] }] } }
  });
  assert.equal(result.dataModel.knowledge.speech, 'She is gold.');
  assert.equal(result.empty, false);
  assert.ok(result.components.some(c => c.id === 'speak'));
  assert.ok(result.report.some(r => r.action === 'fill'));
});

test('补不齐的空白朗读卡会被裁掉，不留下只有「朗读」的空壳', () => {
  const result = validate.optimize({
    components: [
      { id: 'root', component: 'Column', children: ['card0'] },
      { id: 'card0', component: 'Card', children: ['speak'] },
      { id: 'speak', component: 'SpeakButton', label: '朗读', text: P('/knowledge/speech') }
    ],
    dataModel: { knowledge: { speech: '' } },
    extras: { data: {} }
  });
  assert.equal(result.empty, true);
  assert.ok(!result.components.some(c => c.component === 'SpeakButton' || c.component === 'Card'));
  assert.ok(result.report.some(r => r.action === 'drop' && r.reason === '内容为空' || r.message.includes('内容为空')));
});

test('空的 Feedback 在作答前被裁掉，不留空白卡', () => {
  const result = validate.optimize({
    components: [
      { id: 'root', component: 'Column', children: ['card0'] },
      { id: 'card0', component: 'Card', children: ['fb'] },
      { id: 'fb', component: 'Feedback', text: P('/practice/feedback') }
    ],
    dataModel: { knowledge: {}, practice: { feedback: '' } }
  });
  assert.ok(!result.components.some(c => c.component === 'Feedback'));
  assert.equal(result.empty, true);
});

test('选择题与上方题目重复时，换成另一道未展示的题', () => {
  const presented = { questions: ["在 'gold is a girl' 中, 'gold' 的意思是什么?"] };
  const result = validate.optimize({
    components: [
      { id: 'root', component: 'Column', children: ['card0'] },
      { id: 'card0', component: 'Card', children: ['quiz'] },
      { id: 'quiz', component: 'ChoiceQuiz', question: P('/knowledge/question'), options: P('/knowledge/options') }
    ],
    dataModel: {
      knowledge: {
        question: "在 'gold is a girl' 中, 'gold' 的意思是什么?",
        options: ['金钱', '美丽和魅力', '石头'],
        answer: '美丽和魅力'
      }
    },
    presented,
    extras: { quizzes: goldLesson().data.quizzes }
  });
  assert.ok(result.components.some(c => c.component === 'ChoiceQuiz'));
  assert.match(result.dataModel.knowledge.question, /She's a gold friend/);
  assert.ok(result.report.some(r => r.action === 'replace'));
});

test('所有题目都已在上方展示时，丢掉重复的选择题', () => {
  const quizzes = goldLesson().data.quizzes;
  const result = validate.optimize({
    components: [
      { id: 'root', component: 'Column', children: ['card0'] },
      { id: 'card0', component: 'Card', children: ['quiz'] },
      { id: 'quiz', component: 'ChoiceQuiz', question: P('/knowledge/question'), options: P('/knowledge/options') }
    ],
    dataModel: {
      knowledge: { question: quizzes[0].sentence, options: quizzes[0].choices, answer: quizzes[0].answer }
    },
    presented: { questions: quizzes.map(q => q.sentence) },
    extras: { quizzes }
  });
  assert.ok(!result.components.some(c => c.component === 'ChoiceQuiz'));
  assert.ok(result.report.some(r => r.action === 'drop' && /重复/.test(r.message)));
});

test('同组两张卡片内容相同，只保留一张', () => {
  const result = validate.optimize({
    components: [
      { id: 'root', component: 'Column', children: ['c1', 'c2'] },
      { id: 'c1', component: 'Card', children: ['t1'] },
      { id: 't1', component: 'Text', text: P('/knowledge/note') },
      { id: 'c2', component: 'Card', children: ['t2'] },
      { id: 't2', component: 'Text', text: P('/knowledge/note') }
    ],
    dataModel: { knowledge: { note: '同一段说明' } }
  });
  const texts = result.components.filter(c => c.component === 'Text');
  assert.equal(texts.length, 1);
});

test('截图场景：完整编译后不再出现与「你来判一判」相同的题，也不留空白朗读卡', () => {
  const lesson = goldLesson();
  const presented = { questions: [lesson.data.question], texts: [lesson.data.note] };
  const messages = compiler.compileKnowledgeToA2UI(lesson, { presented });
  const names = messages[0].createSurface.components.map(c => c.component);
  const question = messages[0].createSurface.dataModel.knowledge.question;
  assert.ok(names.includes('ChoiceQuiz'), '应保留一道与上方不同的选择题，不能整区裁空');
  assert.notEqual(question, lesson.data.question, '不应再使用与上方相同的题干');
  assert.match(question, /She's a gold friend/);
  assert.ok(!names.includes('Feedback'), '不应留下空白反馈卡');
  const speech = messages[0].createSurface.dataModel.knowledge.speech;
  if (names.includes('SpeakButton')) {
    assert.ok(String(speech).trim(), '朗读卡必须有文本');
  }
  assert.ok(messages.meta.validation.length >= 1);
  assert.equal(messages.meta.empty, false);
});

test('没有重复也没有空白时，原配方保持不变', () => {
  const components = [
    { id: 'root', component: 'Column', children: ['card0'] },
    { id: 'card0', component: 'Card', children: ['quiz'] },
    { id: 'quiz', component: 'ChoiceQuiz', question: P('/knowledge/question'), options: P('/knowledge/options') }
  ];
  const dataModel = {
    knowledge: { question: 'What does make mean here?', options: ['做', '制造'], answer: '做', speech: 'hello' }
  };
  const result = validate.optimize({
    components: JSON.parse(JSON.stringify(components)),
    dataModel: JSON.parse(JSON.stringify(dataModel)),
    presented: { questions: ['另一道完全不同的题'] }
  });
  assert.equal(result.components.filter(c => c.component === 'ChoiceQuiz').length, 1);
  assert.equal(result.dataModel.knowledge.question, 'What does make mean here?');
  assert.equal(result.report.filter(r => r.action === 'drop' || r.action === 'replace').length, 0);
});


test('占位反馈文案视为空白，独立反馈卡被裁掉', () => {
  const result = validate.optimize({
    components: [
      { id: 'root', component: 'Column', children: ['card0'] },
      { id: 'card0', component: 'Card', children: ['fb'] },
      { id: 'fb', component: 'Feedback', text: P('/practice/feedback') }
    ],
    dataModel: { knowledge: {}, practice: { feedback: '先自己试一次，做完知知会告诉你结果。' } }
  });
  assert.ok(!result.components.some(c => c.component === 'Feedback'));
  assert.ok(result.report.some(r => r.action === 'drop'));
});

test('公交截图：只避开当前这道题，年级区换成下一道，不整区裁空', () => {
  const stem = '在公交车上，你应该先做什么？';
  const next = '当司机问你要什么文件时，你应该说什么？';
  const lesson = {
    subject: 'english', phase: 'practice', grade: 'grade5', point: 'bus',
    data: {
      question: stem,
      options: ['A. 找座位', 'B. 看公交牌', 'C. 买票'],
      answer: 'A. 找座位',
      speech: '',
      mnemonic: '先看公交牌，再上车找座位。',
      quizzes: [
        { sentence: stem, choices: ['A. 找座位', 'B. 看公交牌', 'C. 买票'], answer: 'B' },
        { sentence: next, choices: ['A. 我要去哪里吗？', 'B. 请出示我的乘车证。', 'C. 我想坐地铁。'], answer: 'B' }
      ],
      items: [{ word: 'bus', examples: [{ en: 'Look at the bus sign first.' }] }]
    }
  };
  const presented = { questions: [stem], texts: [] };
  const messages = compiler.compileKnowledgeToA2UI(lesson, { presented });
  const names = messages[0].createSurface.components.map(c => c.component);
  const question = messages[0].createSurface.dataModel.knowledge.question;
  assert.ok(names.includes('ChoiceQuiz'), '应留下另一道选择题');
  assert.equal(question, next);
  assert.ok(!names.includes('Feedback'), '不应留下占位反馈卡');
  assert.equal(messages.meta.empty, false);
});

test('只有一道题且与主界面重复时，用朗读或词卡补上，不留空区', () => {
  const stem = '在公交车上，你应该先做什么？';
  const lesson = {
    subject: 'english', phase: 'practice', grade: 'grade5', point: 'bus',
    data: {
      question: stem,
      options: ['A. 找座位', 'B. 看公交牌'],
      answer: 'B. 看公交牌',
      speech: '',
      mnemonic: '先看公交牌，再上车找座位。',
      quizzes: [{ sentence: stem, choices: ['A. 找座位', 'B. 看公交牌'], answer: 'B. 看公交牌' }],
      items: [{ word: 'bus', examples: [] }]
    }
  };
  const presented = { questions: [stem], texts: [] };
  const messages = compiler.compileKnowledgeToA2UI(lesson, { presented });
  const names = messages[0].createSurface.components.map(c => c.component);
  assert.ok(!names.includes('ChoiceQuiz'), '不能再放同一道题');
  assert.ok(names.includes('SpeakButton') || names.includes('WordCard') || names.includes('Text'), '应补上互补练习');
  assert.equal(messages.meta.empty, false);
});

console.log(`\n校验层回归：${passed}/${passed + failed} 通过`);
if (failed) process.exit(1);
