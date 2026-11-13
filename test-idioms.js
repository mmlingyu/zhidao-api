/* 成语质量回归：真实词表校验 + 数量归一化 + 拼音释义校正
 *
 * 运行：node test-idioms.js
 */
'use strict';

const path = require('node:path');
const assert = require('node:assert');

const idioms = require(path.join(__dirname, 'idioms.js'));
const { validateLesson, buildLessonPrompt, parseModelJson, resolveGeneration } = require(path.join(__dirname, 'models.js'));

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name} · ${error.message}`);
  }
}
/** 构造一份合法的语文课数据 */
function chineseLesson(overrides = {}) {
  return {
    title: '标题', bannerTitle: '横幅', subtitle: '副标题', description: '说明',
    practicePrompt: '仿写任务',
    idioms: [
      { word: '晴空万里', pinyin: 'qíng kōng wàn lǐ', tag: '景色', level: 1, meaning: '原拼音', example: '例子', scene: '场景' },
      { word: '碧空如洗', pinyin: 'bì kōng rú xǐ', tag: '景色', level: 2, meaning: '原释义', example: '例子', scene: '场景' },
      { word: '海阔天空', pinyin: 'hǎi kuò tiān kōng', tag: '心情', level: 3, meaning: '原释义', example: '例子', scene: '场景' },
      { word: '风和日丽', pinyin: 'fēng hé rì lì', tag: '天气', level: 1, meaning: '原释义', example: '例子', scene: '场景' }
    ],
    poems: [{ text: '诗句', source: '出处', tag: '景色' }],
    ...overrides
  };
}

console.log('\n[词库]');
check('词库已加载且规模足够', () => {
  assert.ok(idioms.size() > 20000, `仅 ${idioms.size()} 条`);
});
check('真实成语可识别', () => {
  assert.ok(idioms.isIdiom('晴空万里'));
  assert.ok(idioms.isIdiom('海阔天空'));
});
check('自造短语/术语被拒绝', () => {
  assert.ok(!idioms.isIdiom('蔚蓝天空'));
  assert.ok(!idioms.isIdiom('卡尔文循环'));
  assert.ok(!idioms.isIdiom('光合作用'));
  assert.ok(!idioms.isIdiom('开心洋洋'));
});
check('查询返回权威拼音与释义', () => {
  const info = idioms.lookup('海阔天空');
  assert.ok(info && info.pinyin.includes('hǎi'), info?.pinyin);
  assert.ok(info && info.meaning.length > 4);
});

const { preserveTopicIdioms } = require(path.join(__dirname, 'models.js'));

console.log('\n[校验规则]');
check('自造的一项会被替换，其余真成语保留', () => {
  const data = chineseLesson();
  data.idioms[2].word = '蔚蓝天空';
  const out = validateLesson('chinese', data, '天空');
  const words = out.idioms.map(item => item.word);
  assert.strictEqual(words.length, 4);
  assert.ok(!words.includes('蔚蓝天空'), words.join(','));
  assert.ok(words.includes('晴空万里'));
  assert.ok(words.includes('碧空如洗'));
});
check('4 项重复同一词时保留一条并用主题候选补齐', () => {
  const data = chineseLesson();
  for (const item of data.idioms) item.word = '风和日丽';
  const out = validateLesson('chinese', data, '天空');
  const words = out.idioms.map(item => item.word);
  assert.strictEqual(new Set(words).size, 4);
  assert.ok(words.includes('风和日丽'));
});
check('输入词本身不会留在素材库里，主题能补齐则补齐', () => {
  const data = chineseLesson();
  data.idioms[0].word = '光合作用';
  data.idioms[1].word = '光合作用';
  data.idioms[2].word = '光合作用';
  data.idioms[3].word = '光合作用';
  // 「光合作用」不是成语；若主题候选不足 4 项则报错，够则补齐且不含输入词本身。
  let out;
  try {
    out = validateLesson('chinese', data, '光合作用');
  } catch (error) {
    assert.match(error.reason, /恰好 4 项|光合作用/);
    return;
  }
  const words = out.idioms.map(item => item.word);
  assert.strictEqual(words.length, 4);
  assert.ok(!words.includes('光合作用'));
});
check('词库外但匹配主题的表达会保留（如善解人意）', () => {
  const data = chineseLesson();
  data.idioms = [
    { word: '推心置腹', pinyin: '', tag: '沟通', level: 1, meaning: '', example: '跟妈妈说实话', scene: '谈心' },
    { word: '心平气和', pinyin: '', tag: '沟通', level: 1, meaning: '', example: '慢慢说', scene: '情绪' },
    { word: '善解人意', pinyin: '', tag: '沟通', level: 1, meaning: '能体贴别人的心意', example: '先理解妈妈', scene: '体谅' },
    { word: '娓娓道来', pinyin: '', tag: '沟通', level: 1, meaning: '把话慢慢说清楚', example: '把想法讲给妈妈听', scene: '表达' }
  ];
  const out = validateLesson('chinese', data, '如何和妈妈沟通');
  const words = out.idioms.map(item => item.word);
  assert.ok(words.includes('推心置腹'));
  assert.ok(words.includes('心平气和'));
  assert.ok(words.includes('善解人意'));
  assert.ok(words.includes('娓娓道来'));
  assert.ok(!words.includes('海阔天空'), words.join(','));
});
check('自愈若改成默认「海阔天空」，会恢复原稿里匹配的表达', () => {
  const original = JSON.stringify(chineseLesson({
    idioms: [
      { word: '推心置腹', pinyin: '', tag: '沟通', level: 1, meaning: '真心交流', example: '', scene: '' },
      { word: '心平气和', pinyin: '', tag: '沟通', level: 1, meaning: '态度平和', example: '', scene: '' },
      { word: '开诚布公', pinyin: '', tag: '沟通', level: 1, meaning: '坦诚', example: '', scene: '' },
      { word: '将心比心', pinyin: '', tag: '沟通', level: 1, meaning: '换位思考', example: '', scene: '' }
    ]
  }));
  const repaired = chineseLesson({
    idioms: [
      { word: '水天一色', pinyin: '', tag: '景色', level: 1, meaning: '', example: '', scene: '' },
      { word: '海阔天空', pinyin: '', tag: '景色', level: 1, meaning: '', example: '', scene: '' },
      { word: '风和日丽', pinyin: '', tag: '景色', level: 1, meaning: '', example: '', scene: '' },
      { word: '春暖花开', pinyin: '', tag: '景色', level: 1, meaning: '', example: '', scene: '' }
    ]
  });
  const out = preserveTopicIdioms(repaired, original, '如何和妈妈沟通', 'chinese');
  const words = out.idioms.map(item => item.word);
  assert.ok(words.includes('推心置腹'), words.join(','));
  assert.ok(words.includes('心平气和'));
  assert.ok(!words.includes('海阔天空'), words.join(','));
});
check('合格数据通过校验', () => {
  const data = validateLesson('chinese', chineseLesson(), '天空');
  assert.strictEqual(data.idioms.length, 4);
});
check('模型拼音被权威拼音覆盖', () => {
  const data = chineseLesson();
  data.idioms[0].pinyin = 'qing kong wan li'; // 无声调错误
  const out = validateLesson('chinese', data, '天空');
  assert.ok(out.idioms[0].pinyin.includes('qíng'), out.idioms[0].pinyin);
});
check('模型释义被权威释义覆盖', () => {
  const data = chineseLesson();
  data.idioms[1].meaning = '模型瞎写的释义';
  const out = validateLesson('chinese', data, '天空');
  assert.notStrictEqual(out.idioms[1].meaning, '模型瞎写的释义');
});

console.log('\n[数量归一化]');
check('idioms 多给一项时裁剪到 4 项', () => {
  const data = chineseLesson();
  data.idioms.push({ ...data.idioms[0], word: '天高云淡' });
  const out = validateLesson('chinese', data, '天空');
  assert.strictEqual(out.idioms.length, 4);
});
check('idioms 少一项时用主题候选补齐到 4 项', () => {
  const data = chineseLesson();
  data.idioms.pop();
  const out = validateLesson('chinese', data, '天空');
  assert.strictEqual(out.idioms.length, 4);
});
check('完全没有可用表达且主题也补不齐时仍报错', () => {
  const data = chineseLesson();
  data.idioms = [];
  // 「xyz」没有主题命中，也不允许用海阔天空这类通用兜底来 silently 填满
  const weird = { ...data, idioms: [] };
  // 主题「天空」能补齐，所以用一个几乎无意义的输入来验证失败路径
  let threw = false;
  try {
    // 先用空数组 + 无主题输入；candidates(allowGeneric:false) 为空则应失败
    validateLesson('chinese', chineseLesson({ idioms: [] }), 'xyznotatheme123');
  } catch (error) {
    threw = /恰好 4 项/.test(error.reason || error.message);
  }
  assert.ok(threw);
});
check('英语 items 多给时裁剪到 3 项', () => {
  const data = {
    title: 't', bannerTitle: 'b', description: 'd', mnemonic: 'm',
    items: [1, 2, 3, 4].map(n => ({ word: `w${n}`, title: 't', description: 'd', examples: [{ en: 'a', cn: 'b' }], tip: 'x', extra: 'e' })),
    quizzes: [{ sentence: 'a ___ b', cn: 'c', choices: ['x', 'y', 'z'], answer: 'x', explain: 'e' }],
    difference: { question: 'q', answer: 'a' }, advancedTip: 'tip'
  };
  const out = validateLesson('english', data, 'test');
  assert.strictEqual(out.items.length, 3);
});
check('数学 steps 多给时裁剪到 4 步', () => {
  const data = {
    title: 't', bannerTitle: 'b', description: 'd',
    methods: [
      { name: '一般人', subtitle: 's', title: 't', intro: 'i', quote: 'q', insight: 'n',
        steps: Array.from({ length: 6 }, (_, k) => ({ title: `s${k}`, text: 'x', formula: 'y' })) },
      { name: '学霸', subtitle: 's', title: 't', intro: 'i', quote: 'q', insight: 'n',
        steps: [{ title: 's0', text: 'x', formula: 'y' }] },
      { name: '顶流', subtitle: 's', title: 't', intro: 'i', quote: 'q', insight: 'n',
        steps: [{ title: 's0', text: 'x', formula: 'y' }] }
    ],
    challenge: { question: 'q', answer: 'a' }
  };
  const out = validateLesson('math', data, 'x²-1=0');
  assert.strictEqual(out.methods[0].steps.length, 4);
});

console.log('\n[提示词]');
check('语文提示词包含真实成语候选', () => {
  const prompt = buildLessonPrompt('chinese', '天空为什么是蓝色的', resolveGeneration({ GENERATION_PROVIDER: 'liquid' }));
  assert.match(prompt.system, /晴空万里|碧空如洗/);
});
check('主题相关时给出对应候选', () => {
  const prompt = buildLessonPrompt('chinese', '怎么高效学习', resolveGeneration({ GENERATION_PROVIDER: 'liquid' }));
  assert.match(prompt.system, /全神贯注|专心致志/);
});
check('提示词不含模型自造的示例词', () => {
  const prompt = buildLessonPrompt('chinese', '天空', resolveGeneration({ GENERATION_PROVIDER: 'liquid' }));
  assert.ok(!prompt.system.includes('蔚蓝天空'));
});
check('候选成语全部真实存在于词库', () => {
  for (const input of ['天空', '开心', '学习', '春天', '植物', '景色', '如何和妈妈沟通']) {
    for (const word of idioms.candidates(input, 8)) {
      assert.ok(idioms.isIdiom(word), `${word} 不在词库中`);
    }
  }
});
check('「如何和妈妈沟通」给出沟通类成语，而不是默认的海阔天空', () => {
  const words = idioms.candidates('如何和妈妈沟通', 8, { allowGeneric: false });
  assert.ok(words.length >= 4, words.join(','));
  assert.ok(words.includes('推心置腹') || words.includes('心平气和') || words.includes('开诚布公'), words.join(','));
  assert.ok(!words.includes('海阔天空'), words.join(','));
  assert.ok(!words.includes('水天一色'), words.join(','));
});

console.log(`\n全部通过：${passed} 项断言，失败 ${failed} 项。`);
process.exit(failed === 0 ? 0 : 1);
