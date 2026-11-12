/* 缓存层自检：验证命中、归一化、并发合并、追问缓存、重启不丢失、清空与刷新。
 * 运行：npm run test:cache （独立端口 + MOCK 模式，不影响正式服务与真实密钥）
 */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const CACHE_DIR = path.join(ROOT, 'cache', '_selftest');
const env = {
  ...process.env,
  PORT: String(PORT), API_MOCK: 'true', CACHE_ENABLED: 'true',
  CACHE_DIR, CACHE_TTL_DAYS: '30', CACHE_MAX_ENTRIES: '50',
  // 自检强制隔离：永远走本地 JSON，不触碰 Redis 实例，也不受公网鉴权/限流影响。
  CACHE_BACKEND: 'local', REDIS_URL: '', REDIS_HOST: '',
  ADMIN_TOKEN: '', RATE_LIMIT_PER_MIN: '0'
};

let child = null;
let log = '';
let passed = 0;

function check(condition, label, detail = '') {
  if (!condition) throw new Error(`✗ ${label}${detail ? ` · ${detail}` : ''}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function startServer() {
  return new Promise((resolve, reject) => {
    log = '';
    child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    const timer = setTimeout(() => { if (!ready) reject(new Error(`服务启动超时：${log}`)); }, 12000);
    const onData = chunk => {
      log += chunk.toString();
      if (!ready && log.includes('知岛已启动')) { ready = true; clearTimeout(timer); setTimeout(resolve, 120); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => { if (!ready) { clearTimeout(timer); reject(new Error(`服务提前退出(${code})：${log}`)); } });
  });
}

function stopServer() {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) { child = null; return resolve(); }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
    child.once('exit', () => { clearTimeout(timer); child = null; setTimeout(resolve, 200); });
    child.kill();
  });
}

async function api(route, options = {}) {
  const response = await fetch(`${BASE}${route}`, options);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, header: response.headers.get('x-zhidao-cache') || '', data };
}
const post = (route, body) => api(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/* 读取阶段事件流：验证服务端按串行顺序逐阶段推送真实耗时。 */
async function streamTutor(body) {
  const response = await fetch(`${BASE}/api/tutor`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const text = await response.text();
  const events = [];
  for (const frame of text.split(/\r?\n\r?\n/)) {
    let event = 'message', data = '';
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) continue;
    events.push({ event, data: JSON.parse(data) });
  }
  return { status: response.status, contentType: response.headers.get('content-type') || '', events };
}

async function main() {
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  console.log('缓存层自检（MOCK 模式，独立端口 3101）');

  await startServer();
  console.log('\n[1] 首次生成 → 写入缓存');
  const first = await post('/api/tutor', { input: '思念' });
  check(first.status === 200 && first.data.cached === false, '首次请求走模型生成', first.header);
  check(first.header === 'MISS', '响应头 X-Zhidao-Cache = MISS');
  check(first.data.cache?.persisted === true && first.data.cache?.version === 1, '结果已落盘并返回版本号');
  check(fs.existsSync(path.join(CACHE_DIR, 'mock', 'lessons', `${first.data.cache.key}.json`)), '磁盘上存在对应 JSON 文件');

  console.log('\n[2] 重复查询 → 直接使用缓存');
  const second = await post('/api/tutor', { input: '思念' });
  check(second.data.cached === true && second.header === 'HIT', '第二次请求命中缓存');
  check(second.data.cache?.source === 'memory' && second.data.cache?.ageSeconds >= 0, '命中来源与缓存年龄正确');
  check(second.data.data.title === first.data.data.title, '返回内容与首次完全一致');

  console.log('\n[3] 归一化：全半角 / 空白 / 大小写');
  const variant = await post('/api/tutor', { input: '  思 念  ' });
  check(variant.data.cached === true, '多余空白仍命中');
  const fullwidth = await post('/api/tutor', { input: '２ｘ ＋ ３ ＝ １１' });
  const normal = await post('/api/tutor', { input: '2x+3=11' });
  check(fullwidth.data.cached === false && normal.data.cached === true, '全半角表达式归一到同一键');

  console.log('\n[4] 并发相同请求 → 只调用一次上游');
  const [c1, c2] = await Promise.all([
    post('/api/tutor', { input: 'borrow / lend' }),
    post('/api/tutor', { input: 'borrow / lend' })
  ]);
  check(c1.header === 'MISS' || c2.header === 'MISS', '并发中恰好一次 MISS');
  check(c1.data.cached === true || c2.data.cached === true, '另一个请求合并到在途任务（in-flight）');
  const dedup = c1.data.cached ? c1.data : c2.data;
  check(dedup.cache?.source === 'in-flight' || dedup.cache?.source === 'memory', '合并来源标记正确', JSON.stringify(dedup.cache));

  console.log('\n[5] 追问缓存');
  const lesson = first.data.data;
  const f1 = await post('/api/followup', { subject: 'chinese', input: '思念', lesson, question: '能再举一个例子吗？' });
  const f2 = await post('/api/followup', { subject: 'chinese', input: '思念', lesson, question: '能再举一个例子吗？' });
  check(f1.data.cached === false && f1.header === 'MISS', '追问首次生成');
  check(f2.data.cached === true && f2.header === 'HIT', '相同追问直接命中');
  check(f1.data.answer === f2.data.answer, '追问答案一致');

  console.log('\n[6] 统计接口');
  const stats = await api('/api/cache');
  check(stats.status === 200 && stats.data.cache.lesson.entries >= 3, '课程缓存条目数正确');
  check(stats.data.cache.followup.entries === 1, '追问缓存条目数正确');
  check(stats.data.cache.lesson.bytes > 0, '统计包含磁盘占用');

  console.log('\n[7] 重启服务 → 缓存不丢失');
  const keyBefore = first.data.cache.key;
  await stopServer();
  await startServer();
  const health = await api('/api/health');
  check(health.data.cache.loadedFromDisk >= 4, '启动时从磁盘回载缓存', JSON.stringify(health.data.cache));
  const afterRestart = await post('/api/tutor', { input: '思念' });
  check(afterRestart.data.cached === true && afterRestart.header === 'HIT', '重启后仍直接命中缓存');
  check(afterRestart.data.cache.key === keyBefore, '缓存键保持一致');
  check(afterRestart.data.data.title === first.data.data.title, '重启后内容完全一致');

  console.log('\n[8] 刷新绕过 + 清空');
  const refreshed = await post('/api/tutor', { input: '思念', refresh: true });
  check(refreshed.data.cached === false && refreshed.header === 'REFRESH', 'refresh 强制重新生成并回写');
  const cleared = await api('/api/cache', { method: 'DELETE' });
  check(cleared.status === 200 && cleared.data.cleared.lesson >= 1, '清空接口删除缓存条目');
  await stopServer();
  await startServer();
  const emptyHealth = await api('/api/health');
  check(emptyHealth.data.cache.loadedFromDisk === 0, '清空后重启无残留缓存');

  console.log('\n[9] 阶段事件流：两阶段严格串行');
  const stream = await streamTutor({ input: '阶段事件串行测试', stageEvents: true });
  const stages = stream.events.filter(item => item.event === 'stage').map(item => item.data.stage);
  check(stream.contentType.includes('text/event-stream'), '开启 stageEvents 返回 SSE 事件流');
  check(stages.length === 2 && stages[0] === 'route' && stages[1] === 'lesson',
    '阶段顺序为「决策完成 → 讲解完成」，不并行', JSON.stringify(stages));
  const routeEvt = stream.events.find(item => item.event === 'stage' && item.data.stage === 'route').data;
  const lessonEvt = stream.events.find(item => item.event === 'stage' && item.data.stage === 'lesson').data;
  const streamResult = stream.events.find(item => item.event === 'result')?.data;
  check(stream.events.at(-1)?.event === 'result', '最后推送完整课程结果');
  check(Number.isFinite(routeEvt.latencyMs) && Number.isFinite(lessonEvt.latencyMs), '两阶段各自带真实响应时间');
  check(streamResult?.timings?.source === 'generated'
    && streamResult.timings.route.latencyMs === routeEvt.latencyMs
    && streamResult.timings.lesson.latencyMs === lessonEvt.latencyMs
    && Math.abs(streamResult.timings.totalMs - (routeEvt.latencyMs + lessonEvt.latencyMs)) <= 2,
  '结果与阶段事件耗时一致，总耗时为两段串行之和',
  JSON.stringify(streamResult?.timings && { route: streamResult.timings.route?.latencyMs, lesson: streamResult.timings.lesson?.latencyMs, total: streamResult.timings.totalMs }));
  check(typeof streamResult.timings.route.source === 'string' && 'd1Ms' in streamResult.timings.route,
    '决策阶段区分 d1 接口耗时与分类回退', JSON.stringify(streamResult.timings.route));
  const cachedStream = await streamTutor({ input: '阶段事件串行测试', stageEvents: true });
  const cachedStages = cachedStream.events.filter(item => item.event === 'stage').map(item => item.data.stage);
  check(cachedStages.length === 1 && cachedStages[0] === 'cached', '缓存命中只推送 cached 事件，不重造阶段计时');
  check(cachedStream.events.find(item => item.event === 'result')?.data?.cached === true, '缓存命中结果标记 cached');
  const plain = await post('/api/tutor', { input: '阶段事件串行测试' });
  check(plain.status === 200 && plain.data.cached === true && Boolean(plain.data.timings?.route),
    '未开启 stageEvents 仍返回普通 JSON，兼容旧客户端');
  await stopServer();

  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  console.log(`\n全部通过：${passed} 项断言。`);
}

main().catch(async error => {
  console.error(`\n${error.message}`);
  console.error(log);
  await stopServer().catch(() => {});
  process.exitCode = 1;
});
