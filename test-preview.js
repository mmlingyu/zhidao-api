const {
  buildPreviewPrompt,
  validatePreview,
  extractLessonPreview,
  closePartialForPreview,
  buildLessonPrompt
} = require('./models');
const assert = require('node:assert/strict');

// 预览只需要互动讲解（标题 + 导语），不再要求素材库或题目已经完整。
const en = validatePreview('english', {
  bannerTitle: '吃饭的英语',
  description: '学会礼貌点餐',
  items: [
    { word: 'would like', title: '礼貌点餐', description: '更礼貌', examples: [{ en: 'I would like water.', cn: '我想要水' }] },
    { word: 'want', title: '直接表达', description: '较直接', examples: [] }
  ],
  mnemonic: '先看场合再选句子'
});
assert.equal(en.bannerTitle, '吃饭的英语');
assert.equal(en.description, '学会礼貌点餐');
assert.equal(en.items, undefined, '预览不应带上后半段素材');

const zh = validatePreview('chinese', {
  title: '古诗',
  description: '感受思乡的意境',
  idioms: [{ word: '床前明月光', meaning: '描写月光' }, { word: '举头望明月', meaning: '抬头' }]
});
assert.equal(zh.bannerTitle, '古诗');
assert.equal(zh.idioms, undefined);

const math = validatePreview('math', {
  bannerTitle: '方程',
  description: '学会配方',
  methods: [{ name: '一般人', title: '配方', intro: '先配方', steps: [{ title: '移项', text: '把常数移过去' }] }, { name: '学霸' }]
});
assert.equal(math.bannerTitle, '方程');
assert.equal(math.methods, undefined);

let threw = false;
try { validatePreview('english', { bannerTitle: 'x', items: [{ word: 'a' }] }); } catch { threw = true; }
assert.equal(threw, true, '没有导语时不应出预览卡');

const prompt = buildPreviewPrompt('english', '吃饭的英语场景', { provider: 'liquid' });
assert.match(prompt.system, /不要生成 quizzes/);
assert.match(prompt.user, /吃饭的英语场景/);

const lessonPrompt = buildLessonPrompt('english', '吃饭的英语场景', { provider: 'liquid', temperature: 0.1 });
assert.match(lessonPrompt.system, /items 全部写完后再输出 quizzes/);

// 只有标题和导语就应出卡，不必等素材库
const bannerOnly = `{
  "title": "望月",
  "bannerTitle": "静夜思",
  "subtitle": "思乡",
  "description": "感受思乡的意境",
  "idioms": [
    {"word":"望穿秋水"
`;
const bannerEx = extractLessonPreview('chinese', bannerOnly);
assert.ok(bannerEx, '标题和导语完整就应出预览');
assert.equal(bannerEx.bannerTitle, '静夜思');
assert.equal(bannerEx.description, '感受思乡的意境');
assert.equal(bannerEx.idioms, undefined, '预览不应包含半截表达素材库');

const partialEnglish = `{
  "title": "吃饭怎么说",
  "bannerTitle": "吃饭的英语场景",
  "subtitle": "点餐用语",
  "description": "学会礼貌点餐",
  "mnemonic": "先看场合",
  "items": [
    {"word":"would like","title":"礼貌","description":"更得体","examples":[{"en":"I would like some water.","cn":"我想要一些水"}],"tip":"","extra":""},
    {"word":"want","title":"直接","description":"较直接","examples":[{"en":"I want water.","cn":"我想要水"}],"tip":"
`;
const extracted = extractLessonPreview('english', partialEnglish);
assert.ok(extracted, 'should extract from truncated stream once banner is complete');
assert.equal(extracted.bannerTitle, '吃饭的英语场景');
assert.equal(extracted.description, '学会礼貌点餐');
assert.equal(extracted.items, undefined);

// 只有标题，导语还没写完，不应出卡
assert.equal(extractLessonPreview('english', '{"title":"吃饭","bannerTitle":"吃饭"'), null);

// 导语正在输出、字符串还没闭合：不得补引号截断出卡，否则卡片和朗读都是半截
const midDesc = `{
  "title": "坐公交",
  "bannerTitle": "坐公交车的英语",
  "subtitle": "出行用语",
  "description": "在公交车上，你应该先看站牌，再`
;
assert.equal(extractLessonPreview('english', midDesc), null, '半截导语不应出预览');
assert.equal(extractLessonPreview('english', midDesc + '上车找座位。'), null, '导语引号未闭合仍不应出卡');

const closedDesc = midDesc + '上车找座位。",\n  "mnemonic": "先看牌"';
const complete = extractLessonPreview('english', closedDesc);
assert.ok(complete, '导语闭合且出现下一字段后才出卡');
assert.equal(complete.description, '在公交车上，你应该先看站牌，再上车找座位。');
assert.equal(complete.bannerTitle, '坐公交车的英语');
assert.ok(complete.description.length > 10);

const withQuizzesStart = `{
  "title": "吃饭怎么说",
  "bannerTitle": "吃饭的英语场景",
  "subtitle": "点餐",
  "description": "学会点餐",
  "mnemonic": "先看场合",
  "items": [
    {"word":"would like","title":"礼貌","description":"得体","examples":[{"en":"I would like tea.","cn":"我想喝茶"}]},
    {"word":"want","title":"直接","description":"直接","examples":[{"en":"I want tea.","cn":"我想喝茶"}]},
    {"word":"I'll have","title":"决定","description":"已决定","examples":[{"en":"I'll have tea.","cn":"我要茶"}]}
  ],
  "quizzes": [
    {"question":"点餐时更礼貌的是", "options":["I want","I would like"
`;
const ready = extractLessonPreview('english', withQuizzesStart);
assert.ok(ready);
assert.equal(ready.bannerTitle, '吃饭的英语场景');
assert.equal(ready.items, undefined);

const partialZh = `{
  "title":"望月",
  "bannerTitle":"静夜思",
  "description":"感受思乡",
  "idioms":[
    {"word":"望穿秋水","pinyin":"wàng chuān qiū shuǐ","meaning":"盼望殷切"},
    {"word":"归心似箭","pinyin":"guī xīn sì jiàn","meaning":"回家的心情急切"},
    {"word":"触景生情","meaning":"看见景物引起感情"
`;
const zhEx = extractLessonPreview('chinese', partialZh);
assert.ok(zhEx);
assert.equal(zhEx.bannerTitle, '静夜思');
assert.equal(zhEx.idioms, undefined);

const partialMath = `{
  "title":"解方程",
  "bannerTitle":"一元二次方程",
  "description":"学会配方",
  "methods":[
    {"name":"一般人","title":"先配方","intro":"把式子配成完全平方","steps":[
      {"title":"移项","text":"把常数移到右边"},
      {"title":"配方","text":"两边同时加上一次项系数一半的平方"}
    ]},
    {"name":"学霸","title":"公式法","intro":"
`;
const mathEx = extractLessonPreview('math', partialMath);
assert.ok(mathEx);
assert.equal(mathEx.bannerTitle, '一元二次方程');
assert.equal(mathEx.methods, undefined);

const closed = closePartialForPreview('{"title":"a","items":[{"word":"hi"');
assert.ok(closed);
JSON.parse(closed);

console.log('preview tests passed');
