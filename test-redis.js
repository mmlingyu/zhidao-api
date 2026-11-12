/* Redis 后端集成自检（内置模拟实例，不需要本机或云端 Redis）
 * 内置一个最小 RESP2 服务器模拟 Redis，覆盖：连接、SETEX TTL、重启后跨实例共享、
 * 分布式锁、清空鉴权、全局限流、Redis 故障降级，以及公网安全策略。
 * 运行：npm run test:redis
 */
'use strict';
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const REDIS_PORT = 6399;
const APP_PORT = 3102;
const LIMIT_PORT = 3103;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const LIMIT_BASE = `http://127.0.0.1:${LIMIT_PORT}`;
const CACHE_DIR = path.join(ROOT, 'cache', '_redistest');
const ADMIN_TOKEN = 'zd-selftest-admin';

let passed = 0;
function check(condition, label, detail = '') {
  if (!condition) throw new Error(`✗ ${label}${detail ? ` · ${detail}` : ''}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- 最小 RESP2 服务器 ---------------- */
const kv = new Map();          // key -> { value, expireAt }
const sockets = new Set();
const stats = { setNx: 0, evals: 0, dels: 0, incrs: 0, commands: {} };
let redisServer = null;

function live(key) {
  const item = kv.get(key);
  if (!item) return null;
  if (item.expireAt && item.expireAt <= Date.now()) { kv.delete(key); return null; }
  return item;
}
function bulk(value) {
  const text = String(value);
  return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
}
function array(items) {
  return `*${items.length}\r\n${items.map(item => bulk(item)).join('')}`;
}
function parse(buf) {
  let pos = 0;
  const commands = [];
  while (pos < buf.length) {
    if (buf[pos] !== 0x2a) break;                       // 只处理 RESP 数组
    const lineEnd = buf.indexOf('\r\n', pos);
    if (lineEnd < 0) break;
    const count = Number(buf.toString('ascii', pos + 1, lineEnd));
    let cursor = lineEnd + 2;
    const args = [];
    let complete = true;
    for (let i = 0; i < count; i++) {
      if (cursor >= buf.length || buf[cursor] !== 0x24) { complete = false; break; }
      const dollarEnd = buf.indexOf('\r\n', cursor);
      if (dollarEnd < 0) { complete = false; break; }
      const size = Number(buf.toString('ascii', cursor + 1, dollarEnd));
      const start = dollarEnd + 2;
      if (start + size + 2 > buf.length) { complete = false; break; }
      args.push(buf.toString('utf8', start, start + size));
      cursor = start + size + 2;
    }
    if (!complete) break;
    commands.push(args);
    pos = cursor;
  }
  return { commands, rest: buf.subarray(pos) };
}
function matchPattern(key, pattern) {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${source}$`).test(key);
}
function execute(args) {
  const cmd = String(args[0] || '').toUpperCase();
  stats.commands[cmd] = (stats.commands[cmd] || 0) + 1;
  switch (cmd) {
    case 'PING': return '+PONG\r\n';
    case 'AUTH':
    case 'SELECT':
    case 'CLIENT':
    case 'CONFIG':
    case 'COMMAND':
    case 'QUIT':
      return '+OK\r\n';
    case 'INFO': return bulk('redis_version:7.0.0\r\nredis_mode:standalone\r\n');
    case 'GET': {
      const item = live(args[1]);
      return item ? bulk(item.value) : '$-1\r\n';
    }
    case 'SET': {
      const key = args[1];
      const value = args[2];
      const opts = args.slice(3).map(option => String(option).toUpperCase());
      const nx = opts.includes('NX');
      if (nx) stats.setNx += 1;
      if (nx && live(key)) return '$-1\r\n';
      const exIndex = opts.indexOf('EX');
      const seconds = exIndex >= 0 ? Number(args[3 + exIndex + 1]) : 0;
      kv.set(key, { value, expireAt: seconds > 0 ? Date.now() + seconds * 1000 : 0 });
      return '+OK\r\n';
    }
    case 'DEL': {
      let removed = 0;
      for (const key of args.slice(1)) if (kv.delete(key)) removed += 1;
      stats.dels += removed;
      return `:${removed}\r\n`;
    }
    case 'EXISTS': return live(args[1]) ? ':1\r\n' : ':0\r\n';
    case 'EXPIRE': {
      const item = live(args[1]);
      if (!item) return ':0\r\n';
      item.expireAt = Date.now() + Number(args[2]) * 1000;
      return ':1\r\n';
    }
    case 'TTL': {
      const item = live(args[1]);
      if (!item) return ':-2\r\n';
      return item.expireAt ? `:${Math.ceil((item.expireAt - Date.now()) / 1000)}\r\n` : ':-1\r\n';
    }
    case 'INCR': {
      const item = live(args[1]);
      const next = (Number(item?.value || 0) || 0) + 1;
      kv.set(args[1], { value: String(next), expireAt: item?.expireAt || 0 });
      stats.incrs += 1;
      return `:${next}\r\n`;
    }
    case 'SCAN': {
      const patternIndex = args.findIndex(arg => String(arg).toUpperCase() === 'MATCH');
      const pattern = patternIndex >= 0 ? args[patternIndex + 1] : '*';
      const keys = [...kv.keys()].filter(key => live(key) && matchPattern(key, pattern));
      return `*2\r\n${bulk('0')}${array(keys)}`;
    }
    case 'EVAL': {
      stats.evals += 1;
      const key = args[3];
      const token = args[4];
      const item = live(key);
      if (item && item.value === token) { kv.delete(key); return ':1\r\n'; }
      return ':0\r\n';
    }
    default: return '+OK\r\n';
  }
}
async function startRedisSim() {
  redisServer = net.createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      const { commands, rest } = parse(pending);
      pending = rest;
      for (const args of commands) socket.write(execute(args));
    });
  });
  await new Promise(resolve => redisServer.listen(REDIS_PORT, '127.0.0.1', resolve));
}
async function stopRedisSim() {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (redisServer) await new Promise(resolve => redisServer.close(resolve));
  redisServer = null;
}

/* ---------------- 被测服务 ---------------- */
let child = null;
let childLog = '';
async function startApp(port, extra = {}) {
  childLog = '';
  const env = {
    ...process.env,
    PORT: String(port), API_MOCK: 'true', CACHE_ENABLED: 'true',
    CACHE_BACKEND: 'redis', REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}`,
    CACHE_DIR, CACHE_TTL_DAYS: '30', CACHE_MAX_ENTRIES: '50',
    ADMIN_TOKEN, RATE_LIMIT_PER_MIN: '0', HOST: '127.0.0.1',
    ...extra
  };
  child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务启动超时：${childLog}`)), 15000);
    const onData = chunk => {
      childLog += chunk.toString();
      if (childLog.includes('知岛已启动')) { clearTimeout(timer); setTimeout(resolve, 150); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => reject(new Error(`服务提前退出(${code})：${childLog}`)));
  });
}
async function stopApp() {
  if (!child || child.exitCode !== null) { child = null; return; }
  const current = child;
  child = null;
  await new Promise(resolve => {
    const timer = setTimeout(() => { try { current.kill('SIGKILL'); } catch {} }, 3000);
    current.once('exit', () => { clearTimeout(timer); setTimeout(resolve, 200); });
    current.kill();
  });
}
async function api(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, options);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, cacheHeader: response.headers.get('x-zhidao-cache') || '', retryAfter: response.headers.get('retry-after') || '', data };
}
const post = (base, route, body, headers = {}) => api(base, route, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
});
const lessonKeys = () => [...kv.keys()].filter(key => key.includes(':lesson:') && !key.includes(':lock:'));
const limitKeys = () => [...kv.keys()].filter(key => key.startsWith('zhidao:rl:'));

/* ---------------- 测试主体 ---------------- */
async function main() {
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  console.log('Redis 后端集成自检（模拟 RESP2 服务器，独立端口 3102/3103）\n');
  await startRedisSim();
  console.log('[1] 连接与后端选择');
  await startApp(APP_PORT);
  const health = await api(BASE, '/api/health');
  check(health.status === 200 && health.data.cache?.backend === 'redis', '健康检查显示后端为 redis', JSON.stringify(health.data.cache));
  check(health.data.cache?.redisReady === true, 'Redis 连接就绪');
  check(health.data.security?.adminProtected === true, '管理接口已启用令牌保护');

  console.log('\n[2] 首次生成 → SETEX 写入');
  const first = await post(BASE, '/api/tutor', { input: '思念' });
  check(first.status === 200 && first.data.cached === false, '首次请求生成课程', first.cacheHeader);
  check(first.cacheHeader === 'MISS', '响应头 X-Zhidao-Cache = MISS');
  const keys = lessonKeys();
  check(keys.length === 1, 'Redis 中写入一条课程缓存', String(keys.length));
  const stored = JSON.parse(live(keys[0]).value);
  check(stored.version === 1 && stored.payload?.data?.title, '缓存内容包含版本与课程');
  check(Boolean(kv.get(keys[0])?.expireAt), '缓存键带原生 TTL');

  console.log('\n[3] 重复查询与重启后跨实例共享');
  const second = await post(BASE, '/api/tutor', { input: '思念' });
  check(second.data.cached === true && second.cacheHeader === 'HIT', '重复查询命中缓存');
  check(second.data.data?.title === first.data.data?.title, '命中内容与首次一致');
  await stopApp();
  await startApp(APP_PORT);                       // 新进程 L1 为空，只能从 Redis 读
  const afterRestart = await post(BASE, '/api/tutor', { input: '思念' });
  check(afterRestart.data.cached === true, '重启后仍直接命中');
  check(afterRestart.data.cache?.source === 'redis', '命中来源是 Redis（跨实例共享）', afterRestart.data.cache?.source);
  check(afterRestart.data.data?.title === first.data.data?.title, '重启后内容完全一致');

  console.log('\n[4] 分布式锁与清空鉴权');
  check(stats.setNx > 0, '生成前尝试 SET NX 获取分布式锁', `setNx=${stats.setNx}`);
  check(stats.evals > 0, '生成后用 Lua 安全释放锁', `evals=${stats.evals}`);
  const denied = await api(BASE, '/api/cache', { method: 'DELETE' });
  check(denied.status === 403, '无令牌清空被拒绝');
  const cleared = await api(BASE, '/api/cache', { method: 'DELETE', headers: { 'X-Admin-Token': ADMIN_TOKEN } });
  check(cleared.status === 200, '带令牌清空成功');
  check(lessonKeys().length === 0, 'Redis 中课程键已删除');

  console.log('\n[5] refresh 绕过读取仍回写');
  const refreshed = await post(BASE, '/api/tutor', { input: '思念', refresh: true });
  check(refreshed.data.cached === false && refreshed.cacheHeader === 'REFRESH', 'refresh 强制重新生成');
  check(lessonKeys().length === 1, 'refresh 结果回写 Redis');

  console.log('\n[6] 全局限流（第二个实例共享同一 Redis 计数）');
  let limitChild = null;
  const limitEnv = {
    ...process.env, PORT: String(LIMIT_PORT), API_MOCK: 'true', CACHE_ENABLED: 'true',
    CACHE_BACKEND: 'redis', REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}`,
    CACHE_DIR, ADMIN_TOKEN, RATE_LIMIT_PER_MIN: '2', HOST: '127.0.0.1'
  };
  limitChild = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: limitEnv, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let limitLog = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`限流实例启动超时：${limitLog}`)), 15000);
    const onData = chunk => { limitLog += chunk.toString(); if (limitLog.includes('知岛已启动')) { clearTimeout(timer); setTimeout(resolve, 150); } };
    limitChild.stdout.on('data', onData);
    limitChild.stderr.on('data', onData);
    limitChild.on('exit', code => reject(new Error(`限流实例退出(${code})：${limitLog}`)));
  });
  const r1 = await post(LIMIT_BASE, '/api/tutor', { input: '限流测试甲' });
  const r2 = await post(LIMIT_BASE, '/api/tutor', { input: '限流测试乙' });
  const r3 = await post(LIMIT_BASE, '/api/tutor', { input: '限流测试丙' });
  check(r1.status === 200 && r2.status === 200, '前两次请求放行');
  check(r3.status === 429 && Boolean(r3.retryAfter), '第三次返回 429 且带 Retry-After');
  check(limitKeys().length > 0 && stats.incrs >= 3, '限流计数写入 Redis（多实例共享）');
  await new Promise(resolve => {
    const timer = setTimeout(() => { try { limitChild.kill('SIGKILL'); } catch {} }, 3000);
    limitChild.once('exit', () => { clearTimeout(timer); setTimeout(resolve, 150); });
    limitChild.kill();
  });

  console.log('\n[7] Redis 故障 → 自动降级本地 JSON');
  await stopRedisSim();
  const degraded = await post(BASE, '/api/tutor', { input: '开心' });
  check(degraded.status === 200 && degraded.data.cached === false, 'Redis 断开后仍能生成课程');
  const degradedHealth = await api(BASE, '/api/health');
  check(degradedHealth.data.cache?.degraded > 0, '健康检查暴露降级次数', JSON.stringify(degradedHealth.data.cache));
  const localFiles = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json')) localFiles.push(full);
    }
  };
  walk(CACHE_DIR);                              // MOCK 模式写在 cache/_redistest/mock 分区
  check(localFiles.length > 0, '降级后结果写入本地 JSON 文件');

  console.log('\n[8] 公网安全策略');
  const { createSecurity } = require('./security');
  const publicSecurity = createSecurity({
    config: { host: '0.0.0.0', corsOrigins: 'https://a.example.com,https://b.example.com', adminToken: ADMIN_TOKEN, rateLimitPerMin: 2 },
    redis: null
  });
  const makeReq = (origin, headers = {}, remoteAddress = '203.0.113.9') => ({ headers: { ...(origin ? { origin } : {}), ...headers }, socket: { remoteAddress } });
  check(publicSecurity.corsHeaders(makeReq('https://a.example.com'))['Access-Control-Allow-Origin'] === 'https://a.example.com', '白名单来源返回 ACAO');
  check(!publicSecurity.corsHeaders(makeReq('https://evil.example.com'))['Access-Control-Allow-Origin'], '非白名单来源不返回 ACAO');
  check(!publicSecurity.adminAllowed(makeReq(null)), '公网无管理令牌被拒绝');
  check(publicSecurity.adminAllowed(makeReq(null, { 'x-admin-token': ADMIN_TOKEN })), '带管理令牌通过');
  const noOriginSecurity = createSecurity({ config: { host: '0.0.0.0', corsOrigins: '', adminToken: '', rateLimitPerMin: 2 }, redis: null });
  check(!noOriginSecurity.corsHeaders(makeReq('https://evil.example.com'))['Access-Control-Allow-Origin'], '公网未配白名单时禁止跨源');
  check(noOriginSecurity.adminAllowed(makeReq(null, {}, '127.0.0.1')), '未配令牌时仅本机可管理');
  check(!noOriginSecurity.adminAllowed(makeReq(null, {}, '203.0.113.9')), '未配令牌时公网不可管理');

  await stopApp();
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  console.log(`\n全部通过：${passed} 项断言。`);
}

main().catch(async error => {
  console.error(`\nERROR: ${error.message}`);
  try { await stopApp(); } catch {}
  try { await stopRedisSim(); } catch {}
  try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
