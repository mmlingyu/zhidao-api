const g = require('./a2ui-games');
const b = require('./a2ui-bridge');
const c = require('./a2ui-catalog');
const m = require('./a2ui-matrix');
const comp = require('./a2ui-compiler');

console.log('batches', g.BATCHES.map(x => x.BATCH), 'components', g.COMPONENTS.length);
const words = ['触景生情', '情景交融', '画龙点睛'];
const raw = {
  poems: [
    { text: '读书破万卷，下笔如有神。', source: '唐 · 杜甫' },
    { text: '问渠那得清如许？为有源头活水来。', source: '宋 · 朱熹' }
  ],
  idioms: words.map((word, i) => ({
    word, tag: ['情境表达', '写法积累', '语言增色'][i],
    meaning: '释义' + i, example: '试着把「' + word + '」放进句子中。'
  }))
};
const k = b.knowledgeFromLesson({ subject: 'chinese', input: '床前明月光的下一句是什么', data: raw });
console.log('games keys', Object.keys(k.data.games));
const caps = m.capabilitiesFor('chinese', 'practice', 'grade1');
for (const q of ['床前明月光的下一句是什么', '「孤舟蓑笠翁」写的是什么画面', '这个故事先发生了什么',
  '己和已怎么区分', '月亮像小船用了什么修辞', '开心']) {
  const hit = g.selectGame({ question: q, subject: 'chinese', phase: 'practice', grade: 'grade1', capabilities: caps, data: k.data });
  console.log(q, '->', hit ? hit.name : 'null');
}
const msgs = comp.compileKnowledgeToA2UI({
  subject: 'chinese', phase: 'practice', grade: 'grade1',
  point: '床前明月光的下一句是什么', data: k.data
}, { capabilities: caps });
console.log('meta.game', JSON.stringify(msgs.meta.game));
console.log('components', msgs[0].createSurface.components.map(x => x.component).join(','));
const bad = [];
for (const msg of msgs) {
  const r = c.validateMessage(msg, caps);
  if (!r.ok) bad.push(r.errors);
}
console.log('validate', bad.length ? JSON.stringify(bad) : 'OK');
console.log('game model keys', Object.keys(msgs[0].createSurface.dataModel.game));
