/* A2UI 服务端化（P1）回归
 *
 * 覆盖：/api/tutor 是否真的把消息流下发（JSON 与 SSE 两条路径）、
 *       消息是否逐条合法、能力协商是否只能收窄、年级差异是否体现在消息流里、
 *       服务端编译与浏览器本地编译是否同构、缓存命中是否仍带消息流、异常输入是否降级。
 *
 * 运行： npm run test:a2ui:server
 * 说明：整脚本用 MOCK 生成（不花钱、不依赖密钥），但仍走真实的 HTTP / 缓存 / 校验链路。
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const catalog = require('./a2ui-catalog');
const matrix = require('./a2ui-matrix');
const compiler = require('./a2ui-compiler');
const bridge = require('./a2ui-bridge');

const ROOT = __dirname;
const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;
const CACHE_DIR = path.join(ROOT, 'cache', 'test-a2ui-server');

let passed = 0;
let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch(error => { failed++; console.log(`  ✗ ${name} → ${error.message}`); });
}
function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label || '值'} 期望 ${e}，实际 ${a}`);
}
function ok(value, label = '条件') { if (!value) throw new Error(`${label} 不成立`); }

let child = null;
let log = '';
function start() {
  const env = {
    ...process.env,
    PORT: String(PORT), API_MOCK: 'true', HOST: '127.0.0.1',
    CACHE_BACKEND: 'local', CACHE_DIR, CACHE_ENABLED: 'true',
    RATE_LIMIT_PER_MIN: '0', ADMIN_TOKEN: '', CORS_ORIGINS: ''
  };
  child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']
  });
  log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`启动超时：${log}`)), 20000);
    const check = () => {
      if (log.includes('知岛已启动')) { clearTimeout(timer); resolve(); return; }
      if (child.exitCode !== null) { clearTimeout(timer); reject(new Error(`服务退出：${log}`)); return; }
      setTimeout(check, 80);
    };
    check();
  });
}
function stop() {
  if (!child) return Promise.resolve();
  const running = child;
  child = null;
  return new Promise(resolve => {
    running.once('exit', resolve);
    running.kill();
    setTimeout(() => { try { running.kill('SIGKILL'); } catch { /* 已退出 */ } resolve(); }, 3000);
  });
}

async function tutor(body) {
  const response = await fetch(`${BASE}/api/tutor`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const type = response.headers.get('content-type') || '';
  if (type.includes('text/event-stream')) {
    const text = await response.text();
    const events = text.split(/\r?\n\r?\n/).filter(Boolean).map(frame => {
      let event = 'message', data = '';
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      return { event, data: data ? JSON.parse(data) : null };
    }).filter(item => item.data);
    return { status: response.status, cache: response.headers.get('x-zhidao-cache'), events, type };
  }
  return { status: response.status, cache: response.headers.get('x-zhidao-cache'), data: await response.json(), type };
}

/** 解析并逐条校验服务端下发的 JSONL。 */
function parseStream(a2ui) {
  ok(a2ui && typeof a2ui.jsonl === 'string' && a2ui.jsonl.trim(), 'a2ui.jsonl 缺失');
  const lines = a2ui.jsonl.split('\n').filter(Boolean);
  const messages = lines.map(line => JSON.parse(line));
  eq(messages.length, a2ui.messageCount, 'JSONL 行数与 messageCount');
  const surfaceId = messages[0]?.createSurface?.surfaceId;
  ok(surfaceId, '第一条消息必须是 createSurface');
  for (const message of messages) {
    const type = Object.keys(message).find(key => key !== 'version');
    eq(message[type].surfaceId, surfaceId, 'surfaceId 一致');
    const check = catalog.validateMessage(message, a2ui.capabilities);
    ok(check.ok, `消息合法：${check.errors.join('；')}`);
  }
  ok(messages.some(message => message.updateDataModel), '必须有一条 updateDataModel');
  return { messages, surfaceId, lines };
}

const SUBJECTS = [
  { subject: 'chinese', input: '开心', expected: 'practice' },
  { subject: 'english', input: 'make 和 do 的区别', expected: 'practice' },
  { subject: 'math', input: 'x + 3 = 7 怎么解', expected: 'reinforce' }
];
const GRADES = ['grade1', 'grade3', 'grade5', 'grade8', 'senior2'];

(async () => {
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  try {
    await start();

    console.log('\n【一】课程响应里是否真的带着消息流');
    const first = {};
    for (const item of SUBJECTS) {
      const response = await tutor({ input: item.input, grade: 'grade8' });
      eq(response.status, 200, `${item.subject} 状态码`);
      const a2ui = response.data.a2ui;
      ok(a2ui, `${item.subject} 缺少 a2ui`);
      const parsed = parseStream(a2ui);
      first[item.subject] = { a2ui, parsed, response };
      await test(`${item.subject}：消息流合法（${parsed.messages.length} 条 / ${a2ui.componentCount} 组件）`, () => {
        eq(a2ui.subject, item.subject, '学科');
        eq(a2ui.phase, item.expected, '学习过程');
        eq(a2ui.stage, 'teen', '认知阶段');
        ok(a2ui.recipeKey, '配方 key 为空');
        ok(a2ui.components.length > 0, '配方组件为空');
        ok(parsed.surfaceId === a2ui.surfaceId, 'surfaceId 与元数据一致');
        ok(a2ui.jsonl.includes('updateDataModel'), '缺少数据模型消息');
      });
    }

    await test('三科的消息流组件组合互不相同', () => {
      const sets = SUBJECTS.map(item => JSON.stringify(first[item.subject].a2ui.components.slice().sort()));
      eq(new Set(sets).size, 3, '三科配方组件重复');
    });

    console.log('\n【二】年级：同一份知识，不同形态');
    await test('一年级与初二的阶段、组件形态都不同', async () => {
      const early = await tutor({ input: '开心', grade: 'grade1' });
      const teen = first.chinese.a2ui;
      eq(early.data.a2ui.stage, 'early', '一年级阶段');
      eq(teen.stage, 'teen', '初二阶段');
      const earlyComponents = early.data.a2ui.components.slice().sort().join(',');
      const teenComponents = teen.components.slice().sort().join(',');
      ok(earlyComponents !== teenComponents, '两个年级配方组件应不同');
      parseStream(early.data.a2ui);
    });

    await test('五个年级的消息流全部通过校验', async () => {
      for (const grade of GRADES) {
        const response = await tutor({ input: '开心', grade });
        ok(response.data.a2ui, `${grade} 缺少 a2ui`);
        parseStream(response.data.a2ui);
      }
    });

    console.log('\n【三】能力协商：客户端只能收窄，不能放宽');
    await test('客户端去掉 WritingPad → 服务端如实收窄并降级承载', async () => {
      const full = catalog.rendererCapabilities('grade8');
      const response = await tutor({
        input: '开心', grade: 'grade8',
        capabilities: {
          components: full.implemented.filter(name => name !== 'WritingPad'),
          maxComponents: full.maxComponents, textMaxLength: full.textMaxLength
        }
      });
      const a2ui = response.data.a2ui;
      ok(a2ui, '缺少 a2ui');
      ok(a2ui.negotiated.narrowed, '应标记为已收窄');
      ok(a2ui.negotiated.dropped.includes('WritingPad'), '应记录被收窄掉的 WritingPad');
      ok(!a2ui.capabilities.components.includes('WritingPad'), '能力集不应再含 WritingPad');
      ok(!a2ui.jsonl.includes('"component":"WritingPad"'), '消息流里不应再出现 WritingPad');
      parseStream(a2ui);
    });

    await test('客户端宣称支持公式块，也撑不开一年级', async () => {
      const senior = catalog.rendererCapabilities('senior2');
      const response = await tutor({
        input: '3 + 4 等于几', grade: 'grade1',
        capabilities: {
          stage: 'senior', components: senior.implemented.concat(['Tabs', 'FormulaBlock', 'MethodNote', 'MasteryRing']),
          maxComponents: 99, textMaxLength: 999
        }
      });
      const a2ui = response.data.a2ui;
      ok(a2ui, '缺少 a2ui');
      eq(a2ui.stage, 'early', '阶段仍由年级决定');
      for (const name of ['Tabs', 'FormulaBlock', 'MethodNote', 'MasteryRing']) {
        ok(!a2ui.capabilities.components.includes(name), `一年级不应放开 ${name}`);
        ok(!a2ui.jsonl.includes(`"component":"${name}"`), `消息流里不应出现 ${name}`);
      }
      ok(a2ui.capabilities.maxComponents < 99, 'maxComponents 只能被调低');
      ok(a2ui.capabilities.textMaxLength < 999, 'textMaxLength 只能被调低');
      parseStream(a2ui);
    });

    await test('未知组件名 / 非法类型被忽略，不写进能力集', async () => {
      const full = catalog.rendererCapabilities('grade8');
      const response = await tutor({
        input: '开心', grade: 'grade8',
        capabilities: { components: full.implemented.concat(['NotAComponent', '<script>alert(1)</script>', 42, null]) }
      });
      const a2ui = response.data.a2ui;
      ok(a2ui, '非法能力不应导致编译失败');
      for (const name of ['NotAComponent', '<script>alert(1)</script>']) {
        ok(!a2ui.capabilities.components.includes(name), `能力集不应含 ${name}`);
        ok(!a2ui.jsonl.includes(name), `消息流不应含 ${name}`);
      }
      parseStream(a2ui);
    });

    await test('如实宣告实现能力时不该被收窄（英语启蒙期仍保留 ChoiceQuiz）', async () => {
      // 回归：曾把 STAGE_EXTRAS（阶段准入）当渲染器能力去协商，
      // 结果启蒙期英语练习的 ChoiceQuiz 被当成「画不出来」降级成 WritingPad。
      const response = await tutor({
        input: 'play / do / go', grade: 'grade1',
        capabilities: { components: catalog.rendererCapabilities('grade1').implemented }
      });
      const a2ui = response.data.a2ui;
      ok(a2ui, '缺少 a2ui');
      eq(a2ui.negotiated.narrowed, false, '不该被收窄');
      ok(a2ui.capabilities.components.includes('ChoiceQuiz'), '能力集应保留 ChoiceQuiz');
      ok(a2ui.jsonl.includes('"component":"ChoiceQuiz"'), '消息流应渲染 ChoiceQuiz');
      parseStream(a2ui);
    });

    await test('客户端宣称连容器都不会画 → 整包拒绝，交浏览器本地重编', async () => {
      const response = await tutor({
        input: '开心', grade: 'grade8',
        capabilities: { components: ['HintBar', 'Feedback'] }
      });
      // 无法渲染的组件树宁可不发：前端 takeServerSurface 拿到空值会本地编译，
      // 页面仍然是完整课程，只是消息流来源变成「浏览器本地编译」。
      eq(response.data.a2ui, undefined, '不应下发无法渲染的消息流');
      eq(response.status, 200, '课程本身必须正常返回');
      ok(response.data.data, '课程内容仍在');
    });

    console.log('\n【四】SSE 事件流');
    await test('stageEvents=true：a2ui 事件先到，result 不重复携带 JSONL', async () => {
      const response = await tutor({ input: '开心', grade: 'grade8', stageEvents: true });
      eq(response.status, 200, '状态码');
      const names = response.events.map(item => item.event);
      ok(names.includes('a2ui'), '缺少 a2ui 事件');
      const resultIndex = names.indexOf('result');
      ok(resultIndex > names.indexOf('a2ui'), 'a2ui 事件必须早于 result');
      const a2uiEvent = response.events.find(item => item.event === 'a2ui').data;
      const result = response.events.find(item => item.event === 'result').data;
      ok(a2uiEvent.jsonl, '事件里应带 jsonl');
      ok(result.a2ui, 'result 应带元数据');
      eq(result.a2ui.jsonl, '', 'result 不应重复携带 JSONL');
      eq(result.a2ui.surfaceId, a2uiEvent.surfaceId, 'surfaceId 一致');
      parseStream({ ...result.a2ui, jsonl: a2uiEvent.jsonl });
    });

    await test('两条路径（JSON / SSE）消息流完全一致', async () => {
      const sse = await tutor({ input: '开心', grade: 'grade8', stageEvents: true });
      const json = await tutor({ input: '开心', grade: 'grade8' });
      const sseJsonl = sse.events.find(item => item.event === 'a2ui').data.jsonl;
      eq(sseJsonl, json.data.a2ui.jsonl, '同一课程的消息流');
    });

    console.log('\n【五】与服务端缓存协同');
    await test('缓存命中时仍下发消息流，且内容与首次一致', async () => {
      const again = await tutor({ input: 'x + 3 = 7 怎么解', grade: 'grade8' });
      eq(again.cache, 'HIT', '应命中服务端缓存');
      ok(again.data.a2ui, '命中缓存仍应有 a2ui');
      eq(again.data.a2ui.jsonl, first.math.a2ui.jsonl, '消息流应与首次一致');
      eq(again.data.a2ui.cached, true, '应标记为 memo 命中');
    });

    console.log('\n【六】服务端编译与浏览器编译同构（回退路径可信）');
    await test('同一份课程，服务端 JSONL 与本地编译结果逐条一致', async () => {
      const response = await tutor({ input: '开心', grade: 'grade8' });
      const payload = response.data;
      const knowledge = bridge.knowledgeFromLesson(payload);
      const phase = bridge.phaseFor(payload);
      const local = compiler.compileKnowledgeToA2UI(
        { subject: knowledge.subject, phase, grade: 'grade8', point: knowledge.point, data: knowledge.data },
        { capabilities: matrix.capabilitiesFor(knowledge.subject, phase, 'grade8') }
      );
      bridge.primeEmptyFeedback(local, matrix.recipeFor(knowledge.subject, phase, 'grade8'));
      const served = parseStream(payload.a2ui).messages.map(message => stripSurfaceId(message));
      eq(served, local.map(message => stripSurfaceId(message)), '服务端 / 本地消息结构');
    });

    await test('takeServerSurface 对不合法 / 错位消息流一律返回 null（触发本地重编）', () => {
      const ctx = { subject: 'chinese', phase: 'practice', stage: 'teen' };
      const good = first.chinese.a2ui;
      ok(bridge.takeServerSurface(good, ctx), '合法消息流应被接受');
      eq(bridge.takeServerSurface(null, ctx), null, '空载荷');
      eq(bridge.takeServerSurface({ ...good, jsonl: '{"version":"1.0","surfaceUpdate":{}}' }, ctx), null, '旧版消息名');
      eq(bridge.takeServerSurface({ ...good, phase: 'transfer' }, ctx), null, '过程错位');
      eq(bridge.takeServerSurface({ ...good, stage: 'early' }, ctx), null, '阶段错位');
      eq(bridge.takeServerSurface({ ...good, subject: 'math' }, ctx), null, '学科错位');
      eq(bridge.takeServerSurface({ ...good, capabilities: { components: ['HintBar'] } }, ctx), null, '组件被本端阉割');
      const tampered = good.jsonl.split('\n');
      tampered[0] = tampered[0].replace('"component":"Column"', '"component":"EvilBox"');
      eq(bridge.takeServerSurface({ ...good, jsonl: tampered.join('\n') }, ctx), null, '未白名单组件');
    });

    console.log('\n【七】异常输入不产生半坏消息流');
    await test('空输入 400 且不返回 a2ui', async () => {
      const response = await tutor({ input: '   ', grade: 'grade8' });
      eq(response.status, 400, '状态码');
      eq(response.data.a2ui, undefined, '不应有 a2ui');
    });

    await test('超长输入 400 且不返回 a2ui', async () => {
      const response = await tutor({ input: '词'.repeat(1300), grade: 'grade8' });
      eq(response.status, 400, '状态码');
      eq(response.data.a2ui, undefined, '不应有 a2ui');
    });

    console.log('\n【八】XSS：模型内容只作文本进消息流');
    await test('恶意输入不改变 JSONL 结构，只作为字符串值存在', async () => {
      const evil = '<img src=x onerror=alert(1)>开心';
      const response = await tutor({ input: evil, grade: 'grade8' });
      const a2ui = response.data.a2ui;
      ok(a2ui, '应有 a2ui');
      const { messages } = parseStream(a2ui);
      const serialized = JSON.stringify(messages);
      ok(!serialized.includes('"component":"img"'), '不应生成 img 组件');
      ok(serialized.includes('onerror=alert(1)') || !serialized.includes('onerror'), '文本原样保留在字符串里即可');
      // 所有组件的属性名必须来自 schema 白名单，恶意内容只能落在值里。
      for (const message of messages) {
        const body = message.createSurface || message.updateComponents;
        for (const component of body?.components || []) {
          ok(catalog.COMPONENTS[component.component], `组件 ${component.component} 必须在白名单内`);
        }
      }
    });
  } catch (error) {
    failed++;
    console.log(`\n致命错误：${error.message}\n${log.slice(-800)}`);
  } finally {
    await stop();
  }
  console.log(`\n服务端 A2UI 回归：${passed}/${passed + failed} 通过`);
  if (failed) process.exitCode = 1;
})();

/** surfaceId 由调用方指定（服务端 zhidao_lesson_* / 本地 zhidao_bridge_*），比对时抹掉。 */
function stripSurfaceId(message) {
  const clone = JSON.parse(JSON.stringify(message));
  for (const key of ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']) {
    if (clone[key]) delete clone[key].surfaceId;
  }
  return clone;
}
