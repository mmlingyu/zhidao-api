'use strict';
/**
 * 模型切换集成测试（会真实调用两家模型，约 1 分钟、单次成本约 $0.002）：
 *   npm run test:models
 * 验证 GENERATION_PROVIDER 可切换、页面按请求切换 provider / 关闭回退、主模型失败自动回退、缓存键随配置隔离。
 * 需要同时配置 Liquid（JEV_API_KEY / LIQUID_API_KEY）与 Qwen（DASHSCOPE_API_KEY）密钥。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = __dirname;
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const CACHE_DIR = path.join(ROOT, 'cache', '_providertest');
let child = null, log = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function start(provider, extra = {}) {
  const env = {
    ...process.env,
    PORT: String(PORT), API_MOCK: 'false', HOST: '127.0.0.1',
    CACHE_BACKEND: 'local', CACHE_DIR, CACHE_ENABLED: 'true',
    GENERATION_PROVIDER: provider, GENERATION_MODEL: '', GENERATION_BASE_URL: '', GENERATION_API_KEY: '',
    LIQUID_REASONING_EFFORT: 'none', ALLOW_GENERATION_FALLBACK: extra.fallback ?? 'true',
    RATE_LIMIT_PER_MIN: '0', ADMIN_TOKEN: '', CORS_ORIGINS: '',
    ...extra.env
  };
  child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('启动超时：' + log)), 15000);
    const check = () => {
      if (log.includes('知岛已启动')) { clearTimeout(timer); resolve(); return; }
      if (child.exitCode !== null) { clearTimeout(timer); reject(new Error('服务退出：' + log)); return; }
      setTimeout(check, 100);
    };
    check();
  });
}
function stop() {
  if (!child) return Promise.resolve();
  const c = child; child = null;
  return new Promise(resolve => { c.once('exit', resolve); c.kill(); setTimeout(() => { try { c.kill('SIGKILL'); } catch {} resolve(); }, 3000); });
}
async function api(p, body) {
  const r = await fetch(BASE + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { status: r.status, cache: r.headers.get('x-zhidao-cache'), data: await r.json() };
}
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' · ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}
/* 纯函数自检：不需要模型密钥，验证 LFM3 非法 JSON 的规则修复能力。 */
const { repairModelJson } = require('./models');
check(repairModelJson('```json\n{"a":1,}\n```') !== null, '规则修复：代码块与尾随逗号');
check(repairModelJson('{"a":[1,2,') !== null, '规则修复：截断数组自动闭合');
check(repairModelJson('说明文字 {"b":"你好"} 谢谢') !== null, '规则修复：剥离解释文字');
check(repairModelJson('完全没有 JSON') === null, '规则修复：无结构时不误判');

function envKey(name) {
  if (process.env[name]) return process.env[name];
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return '';
  const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : '';
}

(async () => {
  try {
    if (!envKey('JEV_API_KEY') && !envKey('LIQUID_API_KEY')) { console.log('SKIP：缺少 Liquid 密钥'); return; }
    if (!envKey('DASHSCOPE_API_KEY')) { console.log('SKIP：缺少 Qwen 密钥，无法验证自动回退'); return; }
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    await start('liquid');
    let h = await api('/api/health');
    check(h.data.generation?.provider === 'liquid', '健康检查显示主模型 liquid', h.data.generation?.id);
    check(h.data.generation?.fallback?.provider === 'qwen', '健康检查显示备用模型 qwen');
    check(h.data.generation?.promptVersion === 2, '提示词版本随配置层生效');
    check(h.data.generation?.jsonAgentRepair === 1, '健康检查暴露 JSON 自愈次数配置');
    check(h.data.generation?.defaultProvider === 'liquid' && h.data.generation?.userSelectable === true
      && h.data.generation?.available?.length === 2, '健康检查暴露可选模型与用户切换能力');

    const t0 = Date.now();
    const first = await api('/api/tutor', { input: '思念' });
    check(first.status === 200, 'liquid 主模型调用完成（成功或自动回退）', `${Date.now() - t0}ms`);
    // 小模型输出有随机性：成功时必须是 liquid 自己，失败回退时必须标记为 qwen。
    check(first.data.generation?.usedFallback === true
      ? first.data.generation?.provider === 'qwen'
      : first.data.generation?.provider === 'liquid',
    '响应标记实际使用的模型与回退标记一致', JSON.stringify(first.data.generation?.attempts));
    check(first.data.data?.idioms?.length === 4, '回退后课程结构合格');
    check(first.cache === 'MISS' && first.data.cached === false, '首次为 MISS');
    const ft = first.data.timings;
    check(first.status === 200 && ft?.source === 'generated'
      && Number.isFinite(ft?.route?.latencyMs) && Number.isFinite(ft?.lesson?.latencyMs)
      && ft.route.latencyMs >= 0 && ft.lesson.latencyMs >= 0
      && Math.abs(ft.totalMs - (ft.route.latencyMs + ft.lesson.latencyMs)) <= 2
      && Number.isFinite(ft.serverMs) && ft.serverMs >= ft.totalMs,
    '首次响应分别返回学科决策 / 讲解分析耗时与总耗时', JSON.stringify(ft && { route: ft.route?.latencyMs, lesson: ft.lesson?.latencyMs, total: ft.totalMs, server: ft.serverMs }));
    check(typeof ft?.route?.source === 'string' && 'd1Ms' in ft.route,
      '真实决策阶段区分 d1.1 接口往返与分类回退', JSON.stringify(ft?.route));

    const second = await api('/api/tutor', { input: '思念' });
    check(second.cache === 'HIT' && second.data.cached === true, '重复查询命中缓存');
    const st = second.data.timings;
    check(st?.source === 'cache'
      && st.route?.latencyMs === ft?.route?.latencyMs && st.lesson?.latencyMs === ft?.lesson?.latencyMs
      && Number(st.serverMs) < Number(ft?.serverMs),
    '缓存命中保留首次两阶段耗时且本次处理更快', JSON.stringify(st && { source: st.source, route: st.route?.latencyMs, lesson: st.lesson?.latencyMs, server: st.serverMs }));

    const fu = await api('/api/followup', { subject: 'chinese', input: '思念', lesson: first.data.data, question: '再举一个例子？' });
    check(fu.status === 200 && typeof fu.data.answer === 'string', '追问接口在可配置模型下可用');

    await stop();
    await start('qwen'); // 同一缓存目录、切换 provider：应视为新键
    h = await api('/api/health');
    check(h.data.generation?.provider === 'qwen', '重启后主模型切换为 qwen', h.data.generation?.id);
    check(h.data.generation?.cacheKey !== h.data.generation?.id, '缓存键包含模型参数');
    const afterSwitch = await api('/api/tutor', { input: '思念' });
    check(afterSwitch.cache === 'MISS' && afterSwitch.data.cached === false, '切换模型后旧缓存自动失效');
    check(afterSwitch.data.generationProvider === 'qwen', '响应标记主模型 provider');

    const bad = await api('/api/tutor', { input: '思念', provider: 'not-a-model' });
    check(bad.status === 400, '请求级 provider 走白名单，非法值返回 400');
    const switched = await api('/api/tutor', { input: '思念', provider: 'liquid' });
    check(switched.status === 200, '页面切换 provider 后可用 Liquid 配置生成', `status=${switched.status}`);
    check(switched.data.requestedProvider === 'liquid', '响应回显用户选择的模型');
    check(switched.data.cache?.key && switched.data.cache.key !== afterSwitch.data.cache?.key, '同一输入不同模型缓存键隔离');
    const strict = await api('/api/tutor', { input: '思念', provider: 'liquid', allowFallback: false });
    check(strict.status === 200
      ? strict.data.strictModel === true && strict.data.generation?.usedFallback === false
      : strict.status >= 500, '仅用所选模型时不会自动回退', `status=${strict.status}`);

    await stop();
    await start('liquid', { fallback: 'false' });
    const h2 = await api('/api/health');
    check(h2.data.generation?.fallback === null, '关闭 ALLOW_GENERATION_FALLBACK 后不注册备用模型');
    const noFallback = await api('/api/tutor', { input: '思念' });
    // 小模型输出有随机性：成功时必须由主模型自身完成，失败时应返回明确错误而非静默降级。
    check(noFallback.status === 200
      ? noFallback.data.generation?.usedFallback === false && noFallback.data.generationProvider === 'liquid'
      : noFallback.status >= 500, '关闭回退后结果只来自主模型（或明确报错）', `status=${noFallback.status}`);
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exitCode = 1;
  } finally {
    await stop();
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  }
})();
