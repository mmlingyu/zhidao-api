/* 知识卡片 / 年级适配 回归测试（纯 Node，不依赖服务与网络）
 * 运行：node test-knowledge.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  evaluateCard, applyEvidence, applyManualMark, buildPacks, summarize,
  normalizePoint, CARD_STATUS, EVIDENCE_TYPES, THRESHOLDS
} = require('./knowledge');
const { allPoints, pointsForGrade, matchPoint } = require('./curriculum');
const { CardService, LocalCardStore } = require('./cards');
const { UserRepository } = require('./users');
const grade = require('./grade-profile');
const models = require('./models');
const { TONES, toneForGrade } = require('./feedback');

let passed = 0;
let failed = 0;
const DAY = 86400000;

function test(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  }).catch(error => {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${error.message}`);
  });
}

function eq(actual, expected, msg) { assert.strictEqual(actual, expected, msg); }
function ok(value, msg) { assert.ok(value, msg); }

async function main() {
  console.log('\n[1] 掌握度引擎 · 状态判定');

  await test('无证据 = 新知识', () => {
    const card = { evidence: [] };
    const r = evaluateCard(card);
    eq(r.status, CARD_STATUS.NEW);
    eq(r.mastery, 0);
  });

  await test('只听讲解不会变成掌握', () => {
    let card = null;
    for (let i = 0; i < 10; i += 1) {
      card = applyEvidence(card, { type: 'lesson', subject: 'math', point: 'ma-g7-yici', title: '一元一次方程' });
    }
    eq(card.status, CARD_STATUS.LEARNING, '听十遍也只是学习中');
    ok(card.mastery < THRESHOLDS.mastered, '讲解证据不应把掌握度顶过阈值');
  });

  await test('一次答对不算掌握（防蒙对）', () => {
    let card = applyEvidence(null, { type: 'correct', subject: 'math', point: 'p', title: '测试' });
    eq(card.status, CARD_STATUS.LEARNING);
    eq(card.correctCount, 1);
  });

  await test('连续两次答对 → 已掌握', () => {
    let card = null;
    card = applyEvidence(card, { type: 'correct', subject: 'math', point: 'p', title: '测试' });
    card = applyEvidence(card, { type: 'correct', subject: 'math', point: 'p', title: '测试' });
    eq(card.status, CARD_STATUS.MASTERED);
    eq(card.everMastered, true);
    eq(card.consecutiveCorrect, 2);
  });

  await test('答错会打断连续正确，回落学习中', () => {
    const at = Date.now();
    const card = {
      everMastered: true,
      evidence: [
        { type: 'correct', at: at - 3 * DAY },
        { type: 'correct', at: at - 2 * DAY },
        { type: 'wrong', at: at - 1000 }
      ]
    };
    const r = evaluateCard(card, at);
    eq(r.consecutiveCorrect, 0);
    eq(r.status, CARD_STATUS.LEARNING);
  });

  await test('超过遗忘窗口未按指数衰减，退回需巩固', () => {
    const at = Date.now();
    const card = {
      everMastered: true,
      evidence: [
        { type: 'correct', at: at - 90 * DAY },
        { type: 'correct', at: at - 90 * DAY + 1000 },
        { type: 'created', at: at - 90 * DAY + 2000 }
      ]
    };
    const r = evaluateCard(card, at);
    eq(r.status, CARD_STATUS.REVIEW, `实际 ${r.status}，mastery=${r.mastery}`);
    ok(r.mastery < THRESHOLDS.decayFloor);
  });

  await test('长时间未复习后再答对，可以重新掌握', () => {
    const at = Date.now();
    const card = {
      everMastered: true,
      evidence: [
        { type: 'correct', at: at - 90 * DAY },
        { type: 'created', at: at - 90 * DAY + 1000 },
        { type: 'correct', at: at - 1000 },
        { type: 'correct', at }
      ]
    };
    const r = evaluateCard(card, at);
    eq(r.status, CARD_STATUS.MASTERED);
  });

  await test('未知证据类型降级为 lesson 而不是崩溃', () => {
    const card = applyEvidence(null, { type: 'nonsense', subject: 'math', point: 'p', title: '测试' });
    eq(card.evidence.length, 1);
    eq(card.evidence[0].type, 'lesson');
  });

  await test('证据序列保留上限 60 条', () => {
    let card = null;
    for (let i = 0; i < 80; i += 1) {
      card = applyEvidence(card, { type: 'lesson', subject: 'math', point: 'p', title: '测试', at: Date.now() + i });
    }
    eq(card.evidence.length, 60);
  });

  console.log('\n[2] 家长手动标记与卡片包');

  await test('家长确认掌握优先于自动判定', () => {
    const card = applyEvidence(null, { type: 'lesson', subject: 'math', point: 'p', title: '测试' });
    const marked = applyManualMark(card, { mastered: true });
    eq(marked.status, CARD_STATUS.MASTERED);
    eq(marked.mastery, 1);
    ok(marked.reason.includes('家长'));
  });

  await test('家长标记还需练习会写入错误证据', () => {
    let card = applyEvidence(null, { type: 'correct', subject: 'math', point: 'p', title: '测试' });
    card = applyEvidence(card, { type: 'correct', subject: 'math', point: 'p', title: '测试' });
    const marked = applyManualMark(card, { mastered: false });
    ok(marked.evidence.some(item => item.manual && item.type === 'wrong'));
    ok(marked.mastery < 1);
  });

  await test('四包分装：需巩固排最前，已掌握其次', () => {
    const cards = [
      { id: 'a', status: 'new', updatedAt: 1 },
      { id: 'b', status: 'mastered', updatedAt: 2 },
      { id: 'c', status: 'review', updatedAt: 3 },
      { id: 'd', status: 'learning', updatedAt: 4 }
    ];
    const packs = buildPacks(cards);
    eq(packs.length, 4);
    eq(packs[0].key, 'review');
    eq(packs[1].key, 'mastered');
    eq(packs[1].total, 1);
  });

  await test('掌握率按「学过的」而非总卡片数计算', () => {
    const s = summarize([
      { status: 'new', mastery: 0 }, { status: 'new', mastery: 0 },
      { status: 'mastered', mastery: 1 }, { status: 'learning', mastery: .4 }
    ]);
    eq(s.total, 4);
    eq(s.attempted, 2);
    eq(s.masteryRate, 50);
  });

  await test('normalizePoint 归一化空白与全角', () => {
    eq(normalizePoint('math', '  Ｘ＋１  '), normalizePoint('math', 'x+1'));
  });

  console.log('\n[3] 知识点目录');

  await test('三个学科都有目录条目', () => {
    const all = allPoints();
    ok(all.length > 50, `目录条目 ${all.length} 条`);
    const subjects = new Set(all.map(item => item.subject));
    ok(subjects.has('chinese') && subjects.has('english') && subjects.has('math'));
  });

  await test('每个条目字段完整且 id 唯一', () => {
    const all = allPoints();
    const ids = new Set();
    for (const point of all) {
      ok(point.id && point.title && point.subject && point.grade, `字段缺失：${JSON.stringify(point)}`);
      ok(Array.isArray(point.keywords) && point.keywords.length, `${point.id} 缺关键词`);
      ok(!ids.has(point.id), `重复 id：${point.id}`);
      ids.add(point.id);
    }
  });

  await test('按年级取条目只返回该年级', () => {
    const points = pointsForGrade('grade7');
    ok(points.length >= 6);
    ok(points.every(item => item.grade === 'grade7'));
  });

  await test('口语输入能匹配回目录条目', () => {
    const hit = matchPoint('一元一次方程怎么解', 'math');
    ok(hit, '应命中目录');
    eq(hit.id, 'ma-g7-yici');
  });

  await test('学科不匹配时不会串科', () => {
    eq(matchPoint('一元一次方程', 'chinese'), null);
  });

  await test('无关输入不强行匹配', () => {
    eq(matchPoint('今天天气真不错呀', 'math'), null);
  });

  console.log('\n[4] 卡片仓储（本地 JSON 持久化）');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhidao-cards-'));
  const store = new LocalCardStore({ dir });
  const service = new CardService({ repository: new UserRepository({ store, fallbackStore: null }) });

  await test('上报讲解 → 生成卡片且归属目录', async () => {
    const card = await service.record('stu_test', {
      type: 'lesson', subject: 'math', point: '一元一次方程', title: '一元一次方程'
    });
    eq(card.subject, 'math');
    eq(card.point, 'ma-g7-yici');
    eq(card.catalogTitle, '一元一次方程');
    eq(card.status, CARD_STATUS.LEARNING);
    ok(card.id.startsWith('kcd_'));
  });

  await test('同一知识点多次学习落到同一张卡', async () => {
    await service.record('stu_test', { type: 'correct', subject: 'math', point: '一元一次方程', title: '一元一次方程' });
    const card = await service.record('stu_test', { type: 'correct', subject: 'math', point: '一元一次方程', title: '一元一次方程' });
    const cards = await service.listCards('stu_test');
    eq(cards.length, 1);
    eq(card.status, CARD_STATUS.MASTERED);
  });

  await test('不同孩子的卡片互不可见', async () => {
    await service.record('stu_other', { type: 'lesson', subject: 'english', point: '一般现在时', title: '一般现在时' });
    const a = await service.listCards('stu_test');
    const b = await service.listCards('stu_other');
    eq(a.length, 1);
    eq(b.length, 1);
    ok(a[0].id !== b[0].id);
  });

  await test('重启后数据不丢（新实例读取）', async () => {
    const fresh = new CardService({
      repository: new UserRepository({ store: new LocalCardStore({ dir }), fallbackStore: null })
    });
    const cards = await fresh.listCards('stu_test');
    eq(cards.length, 1);
    eq(cards[0].status, CARD_STATUS.MASTERED);
  });

  await test('家长看板包含四包、统计与目录空白', async () => {
    const board = await service.buildBoard('stu_test', { grade: 'grade7' });
    eq(board.packs.length, 4);
    ok(board.summary.total >= 1);
    ok(Array.isArray(board.pending));
    // 已学的「一元一次方程」不应再出现在待学目录里
    ok(!board.pending.some(item => item.id === 'ma-g7-yici'));
  });

  await test('手动标记后状态持久化', async () => {
    const cards = await service.listCards('stu_other');
    const card = await service.mark('stu_other', cards[0].id, { mastered: true });
    eq(card.status, CARD_STATUS.MASTERED);
    const again = await service.getCard('stu_other', cards[0].id);
    eq(again.status, CARD_STATUS.MASTERED);
  });

  await test('标记不存在的卡片返回 404', async () => {
    await assert.rejects(
      () => service.mark('stu_test', 'kcd_missing', { mastered: true }),
      error => error.statusCode === 404
    );
  });

  fs.rmSync(dir, { recursive: true, force: true });

  console.log('\n[5] 年级认知画像');

  await test('五个认知阶段恰好覆盖 users.js 的全部年级', () => {
    const { GRADES } = require('./users');
    const covered = grade.STAGES.flatMap(stage => stage.grades);
    eq(covered.length, GRADES.length, '阶段覆盖数与年级表一致');
    eq(new Set(covered).size, GRADES.length, '无重复归类');
    for (const item of GRADES) ok(covered.includes(item.id), `漏掉 ${item.id}`);
  });

  await test('年级 → 阶段映射正确', () => {
    eq(grade.stageForGrade('grade1').id, 'early');
    eq(grade.stageForGrade('grade4').id, 'primary');
    eq(grade.stageForGrade('grade6').id, 'upper');
    eq(grade.stageForGrade('grade8').id, 'teen');
    eq(grade.stageForGrade('senior3').id, 'senior');
    eq(grade.stageForGrade('unknown').id, grade.DEFAULT_STAGE);
    eq(grade.stageForGrade('').id, grade.DEFAULT_STAGE);
  });

  await test('低龄与青少年语气档位不同', () => {
    eq(grade.stageForGrade('grade1').tone, 'child');
    eq(grade.stageForGrade('grade8').tone, 'teen');
    eq(toneForGrade('grade1'), TONES.child);
    eq(toneForGrade('grade8'), TONES.teen);
  });

  await test('低龄画像隐藏抽象模块，青少年保留', () => {
    const early = grade.uiProfileForGrade('grade1');
    const teen = grade.uiProfileForGrade('grade8');
    eq(early.ui.showTabs, false);
    eq(early.ui.showFormulas, false);
    eq(early.ui.cardsPerScreen, 1);
    eq(teen.ui.showTabs, true);
    eq(teen.ui.cardsPerScreen, 4);
  });

  await test('青少年反馈克制、低龄反馈丰富', () => {
    eq(grade.uiProfileForGrade('grade1').interaction.celebration, 'high');
    eq(grade.uiProfileForGrade('grade8').interaction.celebration, 'low');
    eq(grade.uiProfileForGrade('senior1').interaction.celebration, 'none');
  });

  await test('青少年文案不含低龄化表达', () => {
    const text = grade.promptForGrade('grade8');
    ok(text.includes('禁止'), '提示词应显式禁止幼态表达');
    ok(!grade.promptForGrade('grade8').includes('多用叠词'));
    ok(grade.promptForGrade('grade1').includes('小猫') || grade.promptForGrade('grade1').includes('糖果'));
  });

  console.log('\n[6] 生成提示词按年级分叉');

  await test('未指定年级时提示词不含年级约束', () => {
    const p = models.buildLessonPrompt('chinese', '开心', { provider: 'liquid' });
    ok(!p.system.includes('学习者年级适配'));
  });

  await test('指定年级后注入约束且保持字段结构', () => {
    const p = models.buildLessonPrompt('chinese', '开心', { provider: 'liquid' }, 'grade1');
    ok(p.system.includes('学习者年级适配'));
    ok(p.system.includes('句子不超过 12 个字'));
    ok(p.system.includes('字段结构与各项数量要求必须完全保持不变'));
    ok(p.system.includes('idioms 恰好4项'), '数量硬约束不能被年级要求覆盖');
  });

  await test('同一输入不同年级产生不同提示词', () => {
    const a = models.buildLessonPrompt('math', 'x²-5x+6=0', { provider: 'liquid' }, 'grade1');
    const b = models.buildLessonPrompt('math', 'x²-5x+6=0', { provider: 'liquid' }, 'grade9');
    ok(a.system !== b.system);
    ok(a.system.includes('不要出现方程'));
    ok(b.system.includes('术语准确'));
  });

  await test('提示词包含全部证据类型定义', () => {
    ok(Object.keys(EVIDENCE_TYPES).length >= 6);
  });

  console.log('\n[7] 栏目操作提示与内容可见性（诗文与名句 / 试着写一句）');

  const stageIds = ['early', 'primary', 'upper', 'teen', 'senior'];

  await test('五个认知阶段都有完整的栏目操作提示', () => {
    for (const id of stageIds) {
      const sample = grade.STAGES.find(s => s.id === id).grades[0];
      const poems = grade.hintForGrade(sample, 'poems');
      const writing = grade.hintForGrade(sample, 'writing');
      ok(poems?.text && poems?.rule, `${id} 缺少诗文提示`);
      ok(writing?.text && writing?.title && writing?.button && writing?.placeholder && writing?.rule,
        `${id} 缺少写作提示`);
      ok(Number.isFinite(writing.minLength) && writing.minLength > 0, `${id} 缺少完成门槛`);
    }
  });

  await test('未选择年级时返回中性提示，不做幼态化假设', () => {
    const poems = grade.hintForGrade('', 'poems');
    const writing = grade.hintForGrade('', 'writing');
    eq(poems.text, grade.GENERIC_HINTS.poems.text);
    eq(writing.minLength, 16);
    ok(!/小朋友|宝贝|爸爸妈妈/.test(poems.text + writing.text));
  });

  await test('青少年栏目提示不含低龄化表达', () => {
    for (const id of ['teen', 'senior']) {
      const sample = grade.STAGES.find(s => s.id === id).grades[0];
      const text = grade.hintForGrade(sample, 'poems').text + grade.hintForGrade(sample, 'writing').text;
      ok(!/小朋友|宝贝|太棒啦|爸爸妈妈|真聪明|！/.test(text), `${id} 出现了幼态措辞：${text}`);
    }
  });

  await test('完成门槛随认知能力递增（说出来 → 写清做法）', () => {
    const lens = stageIds.map(id =>
      grade.hintForGrade(grade.STAGES.find(s => s.id === id).grades[0], 'writing').minLength);
    eq(lens[0], 1, '启蒙期说出来就算完成');
    ok(lens.every((n, i) => i === 0 || n >= lens[i - 1]), `门槛应递增：${lens.join(',')}`);
    eq(lens.at(-1), 20);
  });

  await test('画像接口带出提示，供前端与 /api/learner/profile 使用', () => {
    const p = grade.uiProfileForGrade('grade1');
    eq(p.hints.writing.title, '说一句');
    eq(p.hints.writing.button, '我说好啦');
    eq(p.hints.poems.text, grade.hintForGrade('grade1', 'poems').text);
  });

  await test('生成侧字段约束只对语文且已指定年级生效', () => {
    ok(grade.lessonFieldPrompt('grade1', 'chinese').includes('每句不超过 10 个字'));
    ok(grade.lessonFieldPrompt('grade8', 'chinese').includes('迁移仿写'));
    eq(grade.lessonFieldPrompt('', 'chinese'), '');
    eq(grade.lessonFieldPrompt('grade1', 'math'), '');
  });

  await test('语文提示词注入栏目年级适配，且不覆盖数量硬约束', () => {
    const p = models.buildLessonPrompt('chinese', '开心', { provider: 'liquid' }, 'grade2');
    ok(p.system.includes('语文栏目年级适配'));
    ok(p.system.includes('poems 恰好3项'));
    const math = models.buildLessonPrompt('math', 'x²-5x+6=0', { provider: 'liquid' }, 'grade2');
    ok(!math.system.includes('语文栏目年级适配'));
  });

  await test('样式不再隐藏诗文、写作输入框与筛选器', () => {
    const css = fs.readFileSync(path.join(__dirname, 'knowledge.css'), 'utf8');
    const hidden = (css.match(/html\[data-stage="early"\][^{]*\{[^}]*display:\s*none[^}]*\}/g) || []).join('\n');
    ok(hidden.length > 0, '应仍保留对高阶辅助模块的收起规则');
    ok(!/poem-list|practice-input|filter-pills/.test(hidden), '内容型模块被隐藏会导致「有声无字」');
    ok(!css.includes('说出一句给爸爸妈妈听，就算完成啦'), '硬编码伪元素提示应改为按年级取真实文本');
    ok(css.includes('.stage-hint'), '应有年级提示条样式');
  });

  await test('渲染层使用真实提示文本并保留空态兜底与单句朗读', () => {
    // P0 之后这些职责由 A2UI 编译器 / 渲染器承担，不再写在 dynamic.js 的模板字符串里。
    const dyn = fs.readFileSync(path.join(__dirname, 'dynamic.js'), 'utf8');
    ok(dyn.includes('compileLessonToA2UI') && dyn.includes('createSurface'), '语文两栏目必须走 A2UI 组件协议');
    ok(dyn.includes('zhidao:learnerrefresh'), '切换年级后必须重编译 surface');
    const compiler = fs.readFileSync(path.join(__dirname, 'a2ui-compiler.js'), 'utf8');
    ok(compiler.includes('hintFor') && compiler.includes('grade'), '提示文案必须按年级取自同一份画像');
    ok(compiler.includes('这一课暂时没有配套诗句'), '诗句为空时必须有兜底态');
    const render = fs.readFileSync(path.join(__dirname, 'a2ui-render.js'), 'utf8');
    ok(render.includes('stage-hint') && render.includes('poem-read'), '提示条与单句朗读按钮必须渲染');
    ok(render.includes('data-a2ui-action'), '朗读必须走统一 action 通道');
    const learner = fs.readFileSync(path.join(__dirname, 'learner.js'), 'utf8');
    ok(learner.includes('function hint(key)') && learner.includes('hint,'));
  });

  console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
