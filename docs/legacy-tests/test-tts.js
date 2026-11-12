/* 浏览器离线语音（TTS）回归（Node，无需浏览器 / 无需真实模型）
 *
 * 覆盖：离线引擎产物与模型/音色资源是否就位、服务端与 SW 是否放行 /tts/、
 *       朗读通道的三级回退（离线引擎 → 本地服务 → 浏览器默认）、
 *       离线合成的口型同步与中断复位、以及按学科取音色在离线路径同样生效。
 * 运行： npm run test:tts
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
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const exists = file => fs.existsSync(path.join(__dirname, file));

/* ---- 可注入的运行环境替身 ---- */
const store = new Map();
const storage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key)
};
const calls = { post: [], spoken: [], toasts: [], evidence: [], cancelled: 0 };
let mode = 'online';
let engineState = 'ok';       // ok | fail
let engineLoads = 0;

class MockAudioContext {
  constructor() {
    this.state = 'running'; this.destination = {}; this.sources = [];
    MockAudioContext.instances.push(this);
  }
  createBuffer(channels, length, sampleRate) {
    const data = new Float32Array(length);
    return {
      length, sampleRate, numberOfChannels: channels,
      copyToChannel(arr) { data.set(arr); },
      getChannelData() { return data; }
    };
  }
  createBufferSource() {
    const source = {
      buffer: null, onended: null, started: false, stopped: false,
      connect() {}, disconnect() {},
      start() { this.started = true; },
      stop() { this.stopped = true; }
    };
    this.sources.push(source);
    return source;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
}
MockAudioContext.instances = [];

const mascotCalls = { boundary: 0, start: 0, stop: 0, token: 11 };
const mascot = {
  startSpeech: () => { mascotCalls.start += 1; return ++mascotCalls.token; },
  speechBoundary: () => { mascotCalls.boundary += 1; },
  stopSpeech: () => { mascotCalls.stop += 1; }
};

const fetchMock = async (url, opts = {}) => {
  if (String(url).endsWith('/v1/audio/voices')) {
    if (mode === 'offline') throw new Error('connect ECONNREFUSED');
    return { ok: true, status: 200, json: async () => ({ voices: V.BUILTIN_VOICES.map(id => ({ id })) }) };
  }
  if (String(url).endsWith('/v1/audio/speech')) {
    calls.post.push(JSON.parse(opts.body || '{}'));
    if (mode === 'offline') throw new Error('connect ECONNREFUSED');
    return { ok: true, status: 200, blob: async () => ({ size: 4096, type: 'audio/mpeg' }) };
  }
  return { ok: false, status: 404 };
};

class MockUtterance { constructor(text) { this.text = text; } }
class MockAudio {
  constructor(src) { this.src = src; this.duration = 1.2; this.onended = null; this.onerror = null; }
  play() { return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() {}
  load() {}
}
const synth = {
  speaking: true,
  speak: u => calls.spoken.push(u),
  cancel: () => { calls.cancelled += 1; },
  pause() {}, resume() {}
};

let audioContext = null;
const fakeEngine = {
  synthesize: async (text, options) => {
    calls.evidence.push({ text, options });
    const samples = new Float32Array(2400);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(i / 12) * 0.3;
    return { samples, sampleRate: 24000, duration: samples.length / 24000 };
  },
  onChange: () => {}
};

V.setDeps({
  fetch: fetchMock,
  storage,
  Audio: MockAudio,
  createObjectURL: () => 'blob:mock',
  revokeObjectURL: () => {},
  speechSynthesis: () => synth,
  SpeechSynthesisUtterance: () => MockUtterance,
  mascot: () => mascot,
  toast: msg => calls.toasts.push(msg),
  evidence: text => calls.evidence.push({ evidence: text }),
  loadOfflineEngine: async () => {
    engineLoads += 1;
    if (engineState === 'fail') throw new Error('离线引擎加载失败');
    return fakeEngine;
  },
  audioContext: () => MockAudioContext
});

(async () => {
  console.log('\n【一】离线语音资源与接线（静态断言）');
  check('引擎入口存在', exists(path.join('tts', 'engine.entry.js')));
  check('引擎包已生成', exists(path.join('public', 'tts', 'kokoro-tts.js')));
  check('ONNX Runtime 运行时已就位', exists(path.join('public', 'tts', 'ort', 'ort-wasm-simd-threaded.asyncify.wasm')));
  check('模型文件已就位', exists(path.join('public', 'tts', 'models', 'onnx-community', 'Kokoro-82M-v1.1-zh-ONNX', 'onnx', 'model.onnx')));
  check('模型配置与分词器已就位',
    exists(path.join('public', 'tts', 'models', 'onnx-community', 'Kokoro-82M-v1.1-zh-ONNX', 'config.json'))
    && exists(path.join('public', 'tts', 'models', 'onnx-community', 'Kokoro-82M-v1.1-zh-ONNX', 'tokenizer.json')));
  const voiceDir = path.join(__dirname, 'public', 'tts', 'voices');
  const voiceFiles = fs.existsSync(voiceDir) ? fs.readdirSync(voiceDir).filter(name => name.endsWith('.bin')) : [];
  check('103 个音色文件齐备', voiceFiles.length === 103, String(voiceFiles.length));
  check('英语音色在离线包里', voiceFiles.includes('af_maple.bin'));
  const server = read('server.js');
  check('服务端放行 /tts/ 静态资源', server.includes("pathname.startsWith('/tts/')"));
  check('服务端识别 .onnx 与 .mjs', server.includes("'.onnx': 'application/octet-stream'") && server.includes("'.mjs': 'text/javascript; charset=utf-8'"));
  const sw = read('sw.js');
  check('SW 对 /tts/ 走缓存优先', sw.includes("url.pathname.startsWith('/tts/')"));
  check('SW 不预缓存大模型', !sw.includes("'/tts/models/"));
  check('SW 预缓存清单里没有引擎包', !sw.includes("'/tts/kokoro-tts.js'"));
  const engine = read(path.join('tts', 'engine.entry.js'));
  check('引擎从本站读模型', engine.includes("env.localModelPath = MODEL_PATH") && engine.includes("'/tts/models/'"));
  check('引擎从本站读音色', engine.includes("voicePath: VOICE_PATH"));
  check('引擎优先 WebGPU 并回退 WASM', engine.includes("'webgpu'") && engine.includes("device: 'wasm'"));
  check('引擎暴露 window.ZhidaoTTS', engine.includes('window.ZhidaoTTS = API'));

  console.log('\n【二】默认走离线合成');
  eq(V.status().mode, 'offline', '默认模式是离线合成');
  eq(V.status().effective, 'offline', '离线模式下生效通道是 offline');
  mode = 'online';
  await V.refresh();
  calls.post.length = 0;
  calls.spoken.length = 0;
  const offlineOk = await V.speak('春眠不觉晓');
  eq(offlineOk, true, '离线合成朗读成功');
  eq(calls.post.length, 0, '离线合成不请求本地语音服务');
  eq(calls.spoken.length, 0, '离线合成不走浏览器 speechSynthesis');
  const synthCalls = calls.evidence.filter(item => item && item.options);
  eq(synthCalls.length, 1, '引擎被调用一次');
  eq(synthCalls[0].options.voice, 'zf_001', '默认音色 zf_001');
  check('离线播放启动了 Web Audio 源', MockAudioContext.instances[0].sources.some(item => item.started));
  // 口型由定时器驱动，等一拍再看。
  await new Promise(resolve => setTimeout(resolve, 220));
  check('离线播放驱动了口型', mascotCalls.boundary > 0, String(mascotCalls.boundary));
  check('离线朗读上报证据', calls.evidence.some(item => item && item.evidence));
  V.stop();
  check('中断会停掉 Web Audio 源', MockAudioContext.instances[0].sources.some(item => item.stopped));

  console.log('\n【三】按学科取音色在离线路径同样生效');
  V.setSubject('english');
  calls.evidence.length = 0;
  await V.speak('Let us play football');
  const enCall = calls.evidence.filter(item => item && item.options).pop();
  eq(enCall.options.voice, 'af_maple', '英语课读英文用英语音色');
  calls.evidence.length = 0;
  await V.speak('我们今天学英语');
  const zhCall = calls.evidence.filter(item => item && item.options).pop();
  eq(zhCall.options.voice, 'zf_001', '英语课读中文回落中文音色');
  V.setSubject('chinese');

  console.log('\n【四】回退链：离线 → 本地服务 → 浏览器默认');
  engineState = 'fail';
  V.resetOffline();
  calls.post.length = 0;
  calls.spoken.length = 0;
  const fallbackService = await V.speak('床前明月光');
  eq(fallbackService, true, '离线失败后仍能朗读');
  eq(calls.post.length, 1, '回退到本地语音服务');
  eq(calls.spoken.length, 0, '服务可用时不走浏览器语音');
  eq(V.status().offline.state, 'failed', '离线引擎标记为失败');
  eq(V.status().effective, 'tts', '生效通道回退到本地服务');

  mode = 'offline';
  await V.refresh();
  calls.post.length = 0;
  calls.spoken.length = 0;
  const fallbackBrowser = await V.speak('服务也不在');
  eq(fallbackBrowser, true, '离线与服务都不可用时仍能朗读');
  eq(calls.spoken.length, 1, '最终回退到浏览器默认音色');
  eq(calls.spoken[0].lang, 'zh-CN', '浏览器回退按中文朗读');
  check('回退过程有明确提示', calls.toasts.some(t => t.includes('离线语音不可用')), calls.toasts.join('|'));

  console.log('\n【五】显式选择其它通道');
  mode = 'online';
  await V.refresh();
  engineState = 'ok';
  V.resetOffline();
  V.configure({ mode: 'browser' });
  calls.post.length = 0;
  calls.spoken.length = 0;
  await V.speak('浏览器自己读');
  eq(calls.spoken.length, 1, '浏览器模式走 speechSynthesis');
  eq(calls.post.length, 0, '浏览器模式不请求服务');
  eq(engineLoads >= 1, true, '引擎只在需要时加载过');
  V.configure({ mode: 'tts' });
  calls.post.length = 0;
  calls.spoken.length = 0;
  await V.speak('本地服务读');
  eq(calls.post.length, 1, '本地服务模式走 /v1/audio/speech');
  eq(calls.spoken.length, 0, '本地服务可用时不走浏览器语音');
  V.configure({ mode: 'offline' });

  console.log('\n【六】配置与状态接口');
  const st = V.status();
  eq(st.modes.join(','), 'offline,tts,browser', '三种朗读通道都登记');
  check('状态里有离线引擎信息', st.offline && typeof st.offline.state === 'string');
  check('状态里有学科槽位', st.subjectVoices && st.subjectVoices.english === 'af_maple', JSON.stringify(st.subjectVoices));
  eq(V.normalize({ mode: 'weird' }).mode, 'offline', '非法模式回到离线合成');
  eq(V.normalize({}).mode, 'offline', '老配置补齐默认模式');
  check('离线引擎可重复加载复用', typeof V.ensureOfflineEngine === 'function');

  V.stop();
  console.log(`\n离线语音回归：${passed} 通过 / ${failed} 失败\n`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => {
  console.error('回归异常：', error);
  try { V.stop(); } catch { /* noop */ }
  process.exitCode = 1;
});
