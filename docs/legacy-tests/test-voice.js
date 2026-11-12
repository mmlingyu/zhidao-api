/* 全局语音模块回归（Node，无需浏览器 / 无需真实 TTS 服务）
 *
 * 覆盖：103 个音色分组、配置校验与持久化、服务探测、音色生效、
 *       远程播放请求体、服务失败自动回退、中断清理，以及主流程接线。
 * 运行： npm run test:voice
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const V = require('./voice');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
}
function eq(actual, expected, name) { check(name, actual === expected, `期望 ${expected}，实际 ${actual}`); }

/* ---- 可注入的运行环境替身 ---- */
const store = new Map();
const storage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key)
};
const calls = { get: [], post: [], spoken: [], cancelled: 0, toasts: [], evidence: [] };
let mode = 'online';       // online | offline | http-error | not-audio | play-rejected
let remoteVoices = null;   // null → 用内置清单

class MockAudio {
  constructor(src) {
    this.src = src;
    this.duration = 1.2;
    this.onended = null;
    this.onerror = null;
  }
  play() {
    if (mode === 'play-rejected') return Promise.reject(new Error('NotAllowedError'));
    return Promise.resolve();
  }
  pause() { this.paused = true; }
  removeAttribute() {}
  load() {}
}
class MockUtterance {
  constructor(text) { this.text = text; }
}
const synth = {
  speaking: true,
  speak: u => calls.spoken.push(u),
  cancel: () => { calls.cancelled += 1; },
  pause() {},
  resume() {}
};
const mascotCalls = { boundary: 0, start: 0, stop: 0, token: 7 };
const mascot = {
  startSpeech: () => { mascotCalls.start += 1; return ++mascotCalls.token; },
  speechBoundary: () => { mascotCalls.boundary += 1; },
  stopSpeech: () => { mascotCalls.stop += 1; }
};

function jsonResponse(data, ok = true, status = 200) {
  return { ok, status, json: async () => data };
}
function audioResponse(size = 2048, type = 'audio/mpeg') {
  return { ok: true, status: 200, blob: async () => ({ size, type }) };
}
const fetchMock = async (url, opts = {}) => {
  if (String(url).endsWith('/v1/audio/voices')) {
    calls.get.push(String(url));
    if (mode === 'offline') throw new Error('connect ECONNREFUSED');
    const ids = remoteVoices || V.BUILTIN_VOICES;
    return jsonResponse({ voices: ids.map(id => ({ id, name: id })) });
  }
  if (String(url).endsWith('/v1/audio/speech')) {
    calls.post.push({ url: String(url), body: JSON.parse(opts.body || '{}') });
    if (mode === 'offline') throw new Error('connect ECONNREFUSED');
    if (mode === 'http-error') return { ok: false, status: 500 };
    if (mode === 'not-audio') return audioResponse(2048, 'application/json');
    return audioResponse();
  }
  throw new Error(`意外的请求 ${url}`);
};

V.setDeps({
  fetch: fetchMock,
  storage,
  Audio: MockAudio,
  createObjectURL: () => 'blob:mock-audio',
  revokeObjectURL: () => {},
  speechSynthesis: () => synth,
  SpeechSynthesisUtterance: () => MockUtterance,
  mascot: () => mascot,
  toast: msg => calls.toasts.push(msg),
  evidence: text => calls.evidence.push(text)
});

(async () => {
  console.log('\n【一】音色清单与分组（服务文档 /v1/audio/voices）');
  eq(V.BUILTIN_VOICES.length, 103, '内置 103 个音色');
  eq(new Set(V.BUILTIN_VOICES).size, 103, '音色 ID 无重复');
  const groups = V.groupVoices(V.BUILTIN_VOICES);
  const female = groups.filter(g => g.gender === 'female').reduce((n, g) => n + g.count, 0);
  const male = groups.filter(g => g.gender === 'male').reduce((n, g) => n + g.count, 0);
  eq(female, 58, '女声 58 个（中文 55 + 美式 2 + 英式 1）');
  eq(male, 45, '男声 45 个（中文男声）');
  eq(female + male, 103, '男女音色合计 103');
  eq(groups.find(g => g.key === 'zh-female').count, 55, '中文女声 55');
  eq(groups.find(g => g.key === 'en-us-female').count, 2, '美式女声 2');
  eq(groups.find(g => g.key === 'en-gb-female').count, 1, '英式女声 1');
  eq(V.classifyVoice('zm_009').gender, 'male', 'zm_ 判为男声');
  eq(V.classifyVoice('bf_vale').gender, 'female', 'bf_ 判为女声');
  eq(V.classifyVoice('af_maple').group, 'en-us-female', 'af_ 归美式女声');
  check('每个音色都有可读标签', V.BUILTIN_VOICES.every(id => V.classifyVoice(id).label.includes('·')));
  eq(V.groupVoices(['zf_001', 'zf_001', '<script>']).reduce((n, g) => n + g.count, 0), 1, '重复与非法 ID 被过滤');

  console.log('\n【二】配置校验与持久化');
  const bad = V.normalize({ mode: 'hack', voice: '../../etc', base: 'javascript:alert(1)', speed: 99 });
  eq(bad.mode, 'offline', '非法 mode 回到默认的离线合成');
  eq(bad.voice, 'zf_001', '非法 voice 回到默认音色');
  eq(bad.base, V.DEFAULT_BASE, '非法地址回到默认服务地址');
  eq(bad.speed, 2, '语速被夹到上限');
  eq(V.normalize({ base: 'http://192.168.1.5:8880/' }).base, 'http://192.168.1.5:8880', '尾斜杠被去掉');
  eq(V.status().mode, 'offline', '首次加载默认离线合成');
  eq(V.status().effective, 'offline', '默认生效模式是离线合成');
  V.configure({ mode: 'tts', voice: 'zm_009' });
  eq(JSON.parse(store.get(V.STORE_KEY)).voice, 'zm_009', '配置写入 localStorage');
  eq(V.status().mode, 'tts', '配置立即反映到 status');

  console.log('\n【三】服务探测：在线 / 离线');
  await V.refresh();
  eq(V.status().available, true, '服务在线时 available=true');
  eq(V.status().count, 103, '在线清单 103 个音色');
  eq(V.status().effective, 'tts', '选中远程音色且服务在线 → 生效 tts');
  remoteVoices = ['zf_001', 'zm_009', 'xx_001']; // 末位是服务未来可能新增的未知前缀
  await V.refresh();
  eq(V.status().count, 3, '以服务实时清单为准');
  eq(V.status().groups.some(g => g.key === 'other'), true, '未知前缀落到「其他音色」组');
  remoteVoices = null;
  mode = 'offline';
  await V.refresh();
  eq(V.status().available, false, '服务不可达时 available=false');
  eq(V.status().count, 103, '离线仍展示内置 103 个音色');
  eq(V.status().effective, 'browser', '服务不可达 → 生效模式自动回退浏览器默认');
  check('离线错误原因被记录', /ECONNREFUSED/.test(V.status().error), V.status().error);

  console.log('\n【四】朗读：服务不可用自动回退浏览器默认');
  calls.spoken.length = 0;
  const fallbackOk = await V.speak('床前明月光');
  eq(fallbackOk, true, '回退后朗读仍成功');
  eq(calls.spoken.length, 1, '调用了浏览器 speechSynthesis.speak');
  eq(calls.spoken[0].text, '床前明月光', '文本原样传入');
  eq(calls.spoken[0].lang, 'zh-CN', '中文判断 zh-CN');
  check('朗读证据仍上报', calls.evidence.includes('床前明月光'));
  check('回退后仍给出朗读反馈', calls.toasts.some(t => t.includes('正在朗读')), calls.toasts.join('|'));
  V.stop();

  console.log('\n【五】朗读：远程音色请求与全局生效');
  mode = 'online';
  await V.refresh();
  V.configure({ mode: 'tts', voice: 'zf_042' });
  calls.post.length = 0;
  const remoteOk = await V.speak('春眠不觉晓');
  eq(remoteOk, true, '远程朗读成功');
  eq(calls.post.length, 1, '只发一次 TTS 请求');
  const body = calls.post[0].body;
  eq(body.voice, 'zf_042', '请求体用的是所选音色');
  eq(body.model, 'kokoro', '模型为 kokoro');
  eq(body.response_format, 'mp3', '返回 mp3');
  eq(body.stream, false, '关闭流式，拿单个完整音频');
  eq(body.return_timestamps, false, '关闭时间戳');
  eq(body.input, '春眠不觉晓', '原文送入 TTS');
  eq(calls.spoken.length, 1, '远程生效时不再调浏览器语音');
  check('远程朗读有口型起点', mascotCalls.start >= 2);
  const stopsBefore = mascotCalls.stop;
  V.stop();
  eq(mascotCalls.stop, stopsBefore + 1, '中断会复位口型');

  console.log('\n【六】远程失败逐项回退');
  for (const scenario of ['http-error', 'not-audio', 'play-rejected', 'offline']) {
    mode = scenario;
    await V.refresh();
    const before = calls.spoken.length;
    const ok = await V.speak('测试回退');
    eq(ok, true, `${scenario} 仍可朗读`);
    eq(calls.spoken.length, before + 1, `${scenario} 回退到浏览器语音`);
    eq(V.status().available, false, `${scenario} 标记服务不可用`);
    V.stop();
    mode = 'online';
    await V.refresh();
  }
  eq((await V.speak('')), false, '空文本不朗读');

  console.log('\n【七】按学科配音：英语课用英语音色');
  eq(Object.keys(V.SUBJECTS).join(','), 'chinese,english,math', '三个学科都有槽位');
  eq(V.SUBJECTS.english.label, '英语', '英语学科有中文标签');
  eq(V.DEFAULT_SUBJECT_VOICES.english, 'af_maple', '英语默认英文音色 af_maple');
  eq(V.DEFAULT_SUBJECT_VOICES.chinese, 'auto', '语文默认跟随默认音色');
  eq(V.DEFAULT_SUBJECT_VOICES.math, 'auto', '数学默认跟随默认音色');
  eq(V.detectLang('Let us play football'), 'en', '纯英文判为英文');
  eq(V.detectLang('春眠不觉晓'), 'zh', '纯中文判为中文');
  eq(V.detectLang('play / do / go'), 'en', '英文短语判为英文');
  eq(V.detectLang('这个 play 怎么用'), 'zh', '中英混排按多数决');
  eq(V.voiceLang('af_maple'), 'en', 'af_ 是英文音色');
  eq(V.voiceLang('zm_009'), 'zh', 'zm_ 是中文音色');

  // 学科槽位与全局主音色是两层：主音色对所有学科兜底，学科槽位可以单独指定。
  V.configure({ mode: 'tts', voice: 'zf_042' });
  V.configure({ subjectVoices: { english: 'af_maple' } });
  eq(V.resolveVoice('Let us play football', 'english'), 'af_maple', '英语课读英文用英语音色');
  eq(V.resolveVoice('我们今天学英语', 'english'), 'zf_042', '英语课读中文回落中文音色');
  eq(V.resolveVoice('春眠不觉晓', 'chinese'), 'zf_042', '语文课跟随主音色');
  eq(V.resolveVoice('先把系数写出来', 'math'), 'zf_042', '数学课跟随主音色');
  V.configure({ subjectVoices: { chinese: 'zm_009' } });
  eq(V.resolveVoice('春眠不觉晓', 'chinese'), 'zm_009', '语文课可单独指定男声音色');
  eq(V.resolveVoice('我们今天学英语', 'english'), 'zf_042', '英语槽位改动不影响语文槽位');
  eq(V.status().subjectVoices.math, 'auto', '未指定的学科保持跟随默认');

  // 实际请求体：英语课读英文时确实用英语音色。
  mode = 'online';
  await V.refresh();
  V.configure({ subjectVoices: { chinese: 'auto' } });
  V.setSubject('english');
  eq(V.status().subject, 'english', '当前学科被记录');
  calls.post.length = 0;
  await V.speak('Let us play football');
  eq(calls.post[0].body.voice, 'af_maple', '英语课的英文朗读走英语音色');
  V.setSubject('chinese');
  calls.post.length = 0;
  await V.speak('春眠不觉晓');
  eq(calls.post[0].body.voice, 'zf_042', '语文课朗读走主音色');
  calls.post.length = 0;
  await V.speak('Let us play football', { subject: 'english' });
  eq(calls.post[0].body.voice, 'af_maple', '显式指定学科同样生效');
  calls.post.length = 0;
  await V.speak('Let us play football', { subject: 'english', voice: 'bf_vale' });
  eq(calls.post[0].body.voice, 'bf_vale', '显式指定音色优先于学科槽位');
  V.stop();

  // 槽位是「跟随默认」时，主音色改了要跟着变。
  V.configure({ subjectVoices: { chinese: 'auto', math: 'auto' } });
  V.configure({ voice: 'zf_051' });
  eq(V.resolveVoice('春眠不觉晓', 'chinese'), 'zf_051', '跟随默认的槽位随主音色变化');
  eq(V.normalize({ subjectVoices: { english: '<script>' } }).subjectVoices.english, 'af_maple', '非法槽位值被忽略');
  eq(V.normalize({ subjectVoices: { english: 'auto' } }).subjectVoices.english, 'auto', 'auto 是合法槽位值');
  eq(V.normalize({}).subjectVoices.english, 'af_maple', '老配置补齐学科槽位默认值');
  V.configure({ voice: 'zf_042', subjectVoices: { english: 'af_maple' } });

  console.log('\n【八】主流程接线（静态断言）');
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(__dirname, 'a2ui-bridge.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
  const mascotSrc = fs.readFileSync(path.join(__dirname, 'mascot.js'), 'utf8');
  const renderSrc = fs.readFileSync(path.join(__dirname, 'a2ui-render.js'), 'utf8');
  const chatSrc = fs.readFileSync(path.join(__dirname, 'mascot-chat.js'), 'utf8');
  check('app.js 的 speakText 委托 ZhidaoVoice.speak',
    app.includes('window.ZhidaoVoice') && app.includes('voice.speak(text, opts)'));
  check('app.js 识别学科后同步给语音模块',
    app.includes('ZhidaoVoice?.setSubject?.(result.cls)') && app.includes('ZhidaoVoice?.setSubject?.(type)'));
  check('a2ui-render 的 speak 带上学科', renderSrc.includes('ZhidaoVoice') && renderSrc.includes('{ subject }'));
  check('形象切学科时同步语音模块', mascotSrc.includes('V.setSubject(next)'));
  check('形象工坊有学科音色下拉', mascotSrc.includes('data-zd-subject-voice-select')
    && mascotSrc.includes('zd-subject-voice-${esc(key)}'));
  check('学科音色按语种分组', mascotSrc.includes('st.subjectGroups'));
  check('点知知有英文问句池', chatSrc.includes('ENGLISH_GREETINGS') && chatSrc.includes("subject === 'english'"));
  check('a2ui-bridge 的 stopVoice 同时停远程音频', bridge.includes('ZhidaoVoice?.stop?.()'));
  check('形象工坊有音色字段', mascotSrc.includes('id="zd-voice-field"') && mascotSrc.includes('data-zd-voice-mode'));
  check('音色按男女分组展示', mascotSrc.includes('optgroup label='));
  for (const [name, src] of [['index.html', html], ['server.js', server], ['sw.js', sw]]) {
    check(`${name} 已登记 voice.js`, src.includes(name === 'index.html' ? 'voice.js' : '/voice.js'));
  }
  check('voice.js 在 app.js 之前加载', html.indexOf('voice.js') < html.indexOf('app.js'));
  check('SW 不拦截跨域请求', sw.includes("if (url.origin !== location.origin) return;"));

  V.stop();
  console.log(`\n全局语音回归：${passed} 通过 / ${failed} 失败\n`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => {
  console.error('回归异常：', error);
  try { V.stop(); } catch { /* noop */ }
  process.exitCode = 1;
});
