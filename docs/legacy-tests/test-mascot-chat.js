/* 点一点知知 · 语音提问模块回归（Node，纯函数 + 可注入 DOM 替身）
 *
 * 覆盖：随机问句池与年级适配、随机边界与不重复、音色状态行、输入归一化、
 *       弹框结构与 XSS 转义、openChat / submit 全链路、静态资源登记与主流程接线。
 * 运行： npm run test:mascot-chat
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const M = require('./mascot-chat');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
}
function eq(actual, expected, name) { check(name, actual === expected, `期望 ${expected}，实际 ${actual}`); }
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

console.log('\n【一】随机问句池');
check('通用问句 8 条', M.GREETINGS.length === 8, String(M.GREETINGS.length));
check('每条都在询问需求', M.GREETINGS.every(g => /[？?]|什么|哪|吗/.test(g)));
check('每条都在直接对着用户说话', M.GREETINGS.every(g => /知知|你|我们|告诉|说说|写下来|发我/.test(g)));
check('文案互不重复', new Set(M.GREETINGS).size === M.GREETINGS.length);
check('4 个阶段都有专属问句', ['early', 'primary', 'teen', 'senior']
  .every(k => Array.isArray(M.STAGE_GREETINGS[k]) && M.STAGE_GREETINGS[k].length >= 2));
check('低龄问句短且童趣', M.STAGE_GREETINGS.early.every(g => g.length <= 26 && /呀|吗|知知/.test(g)));
check('青少年去掉幼态语气', [...M.STAGE_GREETINGS.teen, ...M.STAGE_GREETINGS.senior]
  .every(g => !/嗨呀|小手指|玩一玩/.test(g)));
check('快捷需求 4 条且覆盖三科', M.SUGGESTIONS.length === 4 &&
  M.SUGGESTIONS.some(s => /春晓|喜出望外/.test(s)) &&
  M.SUGGESTIONS.some(s => /时态|过去时/.test(s)) &&
  M.SUGGESTIONS.some(s => /竖式/.test(s)));

console.log('\n【二】随机选取与年级适配');
eq(M.pickGreeting({ stage: 'early', random: () => 0 }), M.STAGE_GREETINGS.early[0], 'random=0 取低龄首句');
eq(M.pickGreeting({ stage: 'generic', random: () => 1 }), M.GREETINGS[M.GREETINGS.length - 1], 'random=1 夹到末句不越界');
eq(M.pickGreeting({ stage: 'generic', random: () => -3 }), M.GREETINGS[0], '负数夹到首句');
eq(M.pickGreeting({ stage: 'generic', random: () => NaN }), M.GREETINGS[0], 'NaN 退回首句');
check('随机值落点都在池内', Array.from({ length: 60 }, (_, i) => M.pickGreeting({ random: () => i / 60 }))
  .every(line => M.GREETINGS.includes(line)));
check('exclude 生效：不会连着问同一句', Array.from({ length: 30 }, () =>
  M.pickGreeting({ exclude: M.GREETINGS[0] })).every(line => line !== M.GREETINGS[0]));
const teenOnly = Array.from({ length: 40 }, (_, i) => M.pickGreeting({ stage: 'teen', random: () => i / 40 }));
check('青少年池包含专属问句', teenOnly.some(line => M.STAGE_GREETINGS.teen.includes(line)));
check('青少年池也含通用兜底', teenOnly.some(line => M.GREETINGS.includes(line)));

console.log('\n【三】年级阶段与音色状态行');
eq(M.stageFor('grade1'), 'generic', 'Node 无矩阵时退回 generic');
const root = globalThis;
root.ZHIDAO_A2UI_MATRIX = { stageOf: grade => (String(grade).startsWith('grade1') ? 'early' : 'teen') };
eq(M.stageFor('grade1'), 'early', '复用 A2UI 矩阵的阶段口径');
eq(M.stageFor('grade8'), 'teen', '高年级拿到 teen');
root.ZHIDAO_A2UI_MATRIX = { stageOf() { throw new Error('坏掉的矩阵'); } };
eq(M.stageFor('grade1'), 'generic', '矩阵异常不阻断提问');
delete root.ZHIDAO_A2UI_MATRIX;
root.LEARNER = { grade: () => 'grade1' };
eq(M.currentGrade(), 'grade1', '读取当前学习者年级');
root.LEARNER = { grade() { throw new Error('未登录'); } };
eq(M.currentGrade(), '', '学习者模块异常不影响朗读');
delete root.LEARNER;

eq(M.voiceLabel(), '浏览器默认音色', '无语音模块时按默认值展示');
root.ZhidaoVoice = { status: () => ({ effective: 'tts', voice: 'zm_009' }) };
eq(M.voiceLabel(), '知知语音服务 · zm_009', 'TTS 生效时展示选中音色');
root.ZhidaoVoice = { status: () => ({ effective: 'browser', voice: 'zf_001' }) };
eq(M.voiceLabel(), '浏览器默认音色', '服务不可用回退后展示默认音色');
root.ZhidaoVoice = { status() { throw new Error('探测失败'); } };
eq(M.voiceLabel(), '浏览器默认音色', '状态异常不打断弹框');
delete root.ZhidaoVoice;

console.log('\n【三·补】按学科口音：英语课用英文问句与英文音色');
check('英文问句 4 条', M.ENGLISH_GREETINGS.length === 4, String(M.ENGLISH_GREETINGS.length));
check('英文问句确实是英文', M.ENGLISH_GREETINGS.every(g => /[a-zA-Z]/.test(g) && !/[一-龥]/.test(g)));
check('英文问句都在问需求', M.ENGLISH_GREETINGS.every(g => /[?？]/.test(g)));
check('英文问句互不重复', new Set(M.ENGLISH_GREETINGS).size === M.ENGLISH_GREETINGS.length);
eq(M.pickGreeting({ subject: 'english', random: () => 0 }), M.ENGLISH_GREETINGS[0], '英语学科取英文问句');
check('英语学科只会取英文问句', Array.from({ length: 30 }, (_, i) =>
  M.pickGreeting({ subject: 'english', random: () => i / 30 }))
  .every(line => M.ENGLISH_GREETINGS.includes(line)));
check('非英语学科仍用中文问句', Array.from({ length: 30 }, (_, i) =>
  M.pickGreeting({ subject: 'chinese', random: () => i / 30 }))
  .every(line => !M.ENGLISH_GREETINGS.includes(line)));
root.ZhidaoVoice = {
  status: () => ({
    effective: 'tts', voice: 'zf_001', subject: 'english',
    subjectVoices: { english: 'af_maple', chinese: 'auto', math: 'auto' },
    subjects: { english: { label: '英语' }, chinese: { label: '语文' }, math: { label: '数学' } }
  })
};
eq(M.currentSubject(), 'english', '读取语音模块记录的当前学科');
eq(M.voiceLabel(), '知知语音服务 · 英语 af_maple', '英语课展示实际生效的英语音色');
root.ZhidaoVoice.status = () => ({
  effective: 'tts', voice: 'zf_001', subject: 'chinese',
  subjectVoices: { english: 'af_maple', chinese: 'auto', math: 'auto' },
  subjects: { chinese: { label: '语文' } }
});
eq(M.voiceLabel(), '知知语音服务 · 语文 zf_001', '跟随默认的学科展示主音色');
delete root.ZhidaoVoice;
eq(M.currentSubject(), '', '没有语音模块时学科为空');

console.log('\n【四】输入归一化与弹框结构');
eq(JSON.stringify(M.normalizeRequest('  帮我  讲讲\n《春晓》  ')),
  JSON.stringify({ ok: true, text: '帮我 讲讲 《春晓》' }), '压缩空白并去首尾');
eq(M.normalizeRequest('   ').ok, false, '空白输入被拒绝');
eq(M.normalizeRequest('x'.repeat(260)).text.length, 200, '超长输入截断到 200 字');
eq(M.normalizeRequest(null).ok, false, 'null 不送进生成链路');
const html = M.chatHTML('今天想学什么？', '知知语音服务 · zm_009');
check('弹框含问句文字', html.includes('今天想学什么？'));
check('弹框展示音色来源', html.includes('知知语音服务 · zm_009'));
check('弹框有输入框', html.includes('id="zd-chat-input"') && html.includes('<textarea'));
check('弹框有 4 类动作', ['submit', 'again', 'another', 'stop']
  .every(k => html.includes(`data-zd-chat-action="${k}"`)));
check('弹框有快捷需求', html.includes('data-zd-chat-suggestion=') &&
  (html.match(/data-zd-chat-suggestion=/g) || []).length === 4);
check('弹框复用同一形象渲染器', html.includes('data-zd-host') && html.includes('data-zd-size="chat"'));
check('动态文本只作文本，不解释 HTML', !M.chatHTML('<img src=x onerror=alert(1)>', 'x').includes('<img'));
check('属性里的引号被转义', !M.chatHTML('"><script>alert(1)</script>', 'x').includes('"><script>'));

console.log('\n【五】openChat / submit 全链路（DOM 替身）');
const log = { modal: null, closed: 0, toasts: [], spoken: [], inputEvents: [], clicks: [], hosts: 0, focused: '' };
const nodes = {
  '#topic-input': { value: '', dispatchEvent(e) { log.inputEvents.push(e.type); } },
  '#start-button': { click() { log.clicks.push('#start-button'); } },
  '#zd-chat-input': { value: '', focus() { log.focused = '#zd-chat-input'; } },
  '#zd-chat-line': { textContent: '' },
  '#zd-chat-voice': { textContent: '' }
};
root.document = {
  querySelector(sel) { return nodes[sel] || null; },
  querySelectorAll() { return []; },
  addEventListener() {}
};
root.openModal = (title, kicker, content) => { log.modal = { title, kicker, content }; };
root.closeModal = () => { log.closed += 1; };
root.showToast = text => { log.toasts.push(text); };
root.speakText = text => { log.spoken.push(text); };
root.ZhidaoMascot = { renderHosts() { log.hosts += 1; } };
root.ZhidaoVoice = { status: () => ({ effective: 'tts', voice: 'zm_009' }), stop() {} };
root.ZHIDAO_A2UI_MATRIX = { stageOf: () => 'early' };

const first = M.openChat({ random: () => 0 });
check('openChat 返回本次问句', typeof first === 'string' && first.length > 0, String(first));
check('打开的是语音提问弹框', log.modal && /知知/.test(log.modal.title), JSON.stringify(log.modal && log.modal.title));
check('弹框内容写入问句', log.modal.content.includes(first));
check('弹框内容写入音色', log.modal.content.includes('zm_009'));
check('立即朗读同一句', log.spoken.length === 1 && log.spoken[0] === first, JSON.stringify(log.spoken));
check('弹框内形象由主渲染器产出', log.hosts === 1, String(log.hosts));
check('状态记录了当前阶段', M.getState().stage === 'early', M.getState().stage);

eq(M.submit('   '), false, '空需求不提交');
check('空需求会提示并聚焦', log.focused === '#zd-chat-input' && log.toasts.some(t => /先写下/.test(t)));
eq(M.submit('  帮我讲讲  春晓  '), true, '有效需求提交成功');
eq(nodes['#topic-input'].value, '帮我讲讲 春晓', '需求写回首页输入框');
check('触发 input 让学科判定刷新', log.inputEvents.includes('input'));
check('关闭弹框', log.closed === 1, String(log.closed));
check('触发原有开始按钮（不复制生成链路）', log.clicks.includes('#start-button'));
check('提示已收到需求', log.toasts.some(t => /收到/.test(t)));

console.log('\n【六】静态资源登记与主流程接线');
const index = read('index.html');
const css = read('mascot.css');
const server = read('server.js');
const sw = read('sw.js');
const app = read('app.js');
const chat = read('mascot-chat.js');
check('index.html 顶栏形象可点', index.includes('data-zd-size="brand" data-zd-chat'));
check('index.html 右下角形象可点', index.includes('data-zd-size="dock" data-zd-chat'));
check('index.html 在 mascot.js 之后加载提问模块',
  index.indexOf('src="mascot.js"') < index.indexOf('src="mascot-chat.js'));
check('server 静态白名单登记 /mascot-chat.js', server.includes("'/mascot-chat.js'"));
check('sw 预缓存登记 /mascot-chat.js', sw.includes("'/mascot-chat.js'"));
check('sw 版本已升级', Number((sw.match(/zhidao-shell-v(\d+)/) || [])[1] || 0) >= 11);
check('mascot.css 有可点态与弹框样式', css.includes('[data-zd-chat]') && css.includes('.zd-chat-input'));
check('朗读走全局 speakText', chat.includes('root.speakText') && chat.includes('ZhidaoVoice'));
check('中断走 ZhidaoVoice.stop', chat.includes('ZhidaoVoice?.stop'));
check('提交委托给 #start-button', chat.includes("querySelector('#start-button')") && chat.includes('start.click()'));
check('capture 拦截 brand 默认跳转', chat.includes("addEventListener('click', onCaptureClick, true)") && chat.includes('stopPropagation()'));
check('键盘 Enter / Space 可达', chat.includes("event.key !== 'Enter' && event.key !== ' '") && chat.includes('onCaptureKey'));
check('app.js 的 speakText 委托 voice.js', app.includes('window.ZhidaoVoice') && app.includes('voice.speak(text, opts)'));
check('模块未硬编码音色', !chat.includes('zf_001') && !chat.includes('zm_009'));

console.log(`\n点知知回归：${passed} 通过 / ${failed} 失败\n`);
process.exitCode = failed ? 1 : 0;
