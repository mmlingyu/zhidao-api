// 用户体系接口测试：注册、成员管理、权限隔离、持久化、人脸匹配
'use strict';
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;
let BASE = '';
let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ✓ ${label}${detail ? ` · ${detail}` : ''}`); }
  else { failed += 1; console.log(`  ✗ ${label}${detail ? ` · ${detail}` : ''}`); }
}

function request(method, urlPath, { body = null, token = '' } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(`${BASE}${urlPath}`, { method, headers }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* 非 JSON */ }
        resolve({ status: res.statusCode, body: json, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * 构造 128 维特征向量。
 * 用互不重叠的稀疏基向量（不同 seed 落在不同坐标块），
 * 保证任意两个不同 seed 的向量距离接近 sqrt(2)≈1.414，远超匹配阈值。
 * 早期版本用 sin(seed + i*0.37) 生成，不同 seed 意外靠得很近
 * （seed 50 与 999 距离仅 0.24），会导致「异人应被拒」用例误判。
 */
function descriptor(seed = 1) {
  const values = new Array(128).fill(0);
  const offset = (seed % 16) * 8;
  for (let k = 0; k < 8; k += 1) values[offset + k] = 1;
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  return values.map(v => v / norm);
}

/** 在基准向量上叠加扰动，模拟"同一个人不同拍摄条件"。 */
function perturb(base, amount = 0.01) {
  return base.map((v, i) => v + Math.cos(i * 0.21) * amount);
}

async function run() {
  console.log('\n[1] 家长注册');
  const parentRes = await request('POST', '/api/auth/register', {
    body: { name: '测试家长', grade: 'grade3', secret: 'test1234', descriptor: [descriptor(1), perturb(descriptor(1), 0.02)] }
  });
  check('注册返回 200', parentRes.status === 200, `status=${parentRes.status}`);
  check('返回会话令牌', typeof parentRes.body?.token === 'string' && parentRes.body.token.length > 20);
  check('返回家长档案', parentRes.body?.user?.role === 'parent' && parentRes.body?.user?.name === '测试家长');
  check('档案不含人脸向量', !JSON.stringify(parentRes.body?.user || {}).includes('descriptor'));
  const parentToken = parentRes.body?.token;
  const familyId = parentRes.body?.user?.familyId;
  check('创建了家庭', typeof familyId === 'string' && familyId.length > 4);

  console.log('\n[2] 年级校验');
  const badGrade = await request('POST', '/api/family/members', {
    body: { name: '错误年级', grade: 'not-a-grade' }, token: parentToken
  });
  check('非法年级被拒绝', badGrade.status === 400, `status=${badGrade.status}`);

  console.log('\n[3] 添加学生成员');
  const memberRes = await request('POST', '/api/family/members', {
    body: { name: '王小明', grade: 'grade4', descriptor: [descriptor(2), perturb(descriptor(2), 0.02)] }, token: parentToken
  });
  check('添加成员成功', memberRes.status === 200, `status=${memberRes.status}`);
  check('成员年级正确', memberRes.body?.user?.gradeLabel === '四年级', memberRes.body?.user?.gradeLabel);
  const memberId = memberRes.body?.user?.id;
  check('家庭含 2 位成员', memberRes.body?.family?.members?.length === 2, `实际 ${memberRes.body?.family?.members?.length}`);

  console.log('\n[4] 权限隔离');
  const noToken = await request('GET', '/api/family/members');
  check('未登录访问成员列表被拒', noToken.status === 401, `status=${noToken.status}`);
  const badToken = await request('GET', '/api/family/members', { token: 'invalid-token' });
  check('无效令牌被拒', badToken.status === 401, `status=${badToken.status}`);
  const studentRes = await request('POST', '/api/auth/login/secret', {
    body: { userId: memberId, secret: 'nope' }
  });
  check('学生无口令时登录被拒', studentRes.status === 401, `status=${studentRes.status}`);

  console.log('\n[5] 口令登录');
  const loginRes = await request('POST', '/api/auth/login/secret', {
    body: { userId: parentRes.body.user.id, secret: 'test1234' }
  });
  check('家长口令登录成功', loginRes.status === 200 && Boolean(loginRes.body?.token), `status=${loginRes.status}`);
  const loginRes2 = await request('POST', '/api/auth/login/secret', {
    body: { userId: parentRes.body.user.id, secret: 'wrong' }
  });
  check('错误口令被拒', loginRes2.status === 401, `status=${loginRes2.status}`);

  console.log('\n[6] 人脸匹配');
  const base = descriptor(1);
  const sameRes = await request('POST', '/api/auth/login/face', {
    body: { familyId, descriptor: [perturb(base, 0.008)] }
  });
  check('同一人（轻微扰动）登录成功', sameRes.status === 200, `status=${sameRes.status} ${sameRes.body?.error || ''}`);
  check('匹配到正确成员', sameRes.body?.user?.name === '测试家长', sameRes.body?.user?.name);

  const otherRes = await request('POST', '/api/auth/login/face', {
    body: { familyId, descriptor: [descriptor(7)] }
  });
  check('异人被拒绝', otherRes.status === 401, `status=${otherRes.status} body=${JSON.stringify(otherRes.body).slice(0, 160)}`);

  const badDesc = await request('POST', '/api/auth/login/face', {
    body: { familyId, descriptor: [[1, 2, 3]] }
  });
  check('非法维度特征被拒', badDesc.status === 400, `status=${badDesc.status}`);

  const noFaceFamily = await request('POST', '/api/auth/login/face', {
    body: { familyId: 'fam_nonexistent', descriptor: [base] }
  });
  check('不存在的家庭被拒', noFaceFamily.status === 401 || noFaceFamily.status === 400, `status=${noFaceFamily.status}`);

  console.log('\n[7] 混淆保护');
  // 造两个几乎一样的成员：最优与次优距离差小于 minGap(0.05) 时必须拒绝认人。
  // 扰动 0.005 时甲乙距离约 0.04，正好落在混淆区间内。
  const twinA = await request('POST', '/api/family/members', {
    body: { name: '双胞胎甲', grade: 'grade1', descriptor: [descriptor(3)] }, token: parentToken
  });
  const twinB = await request('POST', '/api/family/members', {
    body: { name: '双胞胎乙', grade: 'grade1', descriptor: [perturb(descriptor(3), 0.005)] }, token: parentToken
  });
  check('可添加特征相近的两位成员', twinA.status === 200 && twinB.status === 200);
  const ambiguousRes = await request('POST', '/api/auth/login/face', {
    body: { familyId, descriptor: [descriptor(3)] }
  });
  check('特征无法区分时拒绝认人', ambiguousRes.status === 401, `status=${ambiguousRes.status} ${ambiguousRes.body?.error || ''}`);
  check('提示是"难以区分"而非"没找到"', /相似/.test(ambiguousRes.body?.error || ''), ambiguousRes.body?.error);
  await request('DELETE', `/api/family/members/${twinA.body.user.id}`, { token: parentToken });
  await request('DELETE', `/api/family/members/${twinB.body.user.id}`, { token: parentToken });

  console.log('\n[8] 成员修改与删除');
  const patchRes = await request('PATCH', `/api/family/members/${memberId}`, {
    body: { name: '王小红', grade: 'grade5' }, token: parentToken
  });
  check('修改成员成功', patchRes.status === 200, `status=${patchRes.status}`);
  check('改名生效', patchRes.body?.user?.name === '王小红', patchRes.body?.user?.name);
  check('年级更新生效', patchRes.body?.user?.gradeLabel === '五年级', patchRes.body?.user?.gradeLabel);

  const foreignPatch = await request('PATCH', `/api/family/members/${parentRes.body.user.id}`, {
    body: { name: '越权' }, token: parentToken
  });
  check('不能修改家长记录（越权）', foreignPatch.status === 404 || foreignPatch.status === 403, `status=${foreignPatch.status}`);

  const delRes = await request('DELETE', `/api/family/members/${memberId}`, { token: parentToken });
  check('删除成员成功', delRes.status === 200, `status=${delRes.status}`);
  check('删除后剩 1 位成员', delRes.body?.family?.members?.length === 1, `实际 ${delRes.body?.family?.members?.length}`);

  console.log('\n[9] 会话管理');
  const meRes = await request('GET', '/api/me', { token: parentToken });
  check('获取当前用户', meRes.status === 200 && meRes.body?.user?.name === '测试家长');
  check('返回家庭信息', Array.isArray(meRes.body?.family?.members));
  const logoutRes = await request('POST', '/api/auth/logout', { token: parentToken });
  check('退出登录成功', logoutRes.status === 200);
  const afterLogout = await request('GET', '/api/me', { token: parentToken });
  check('退出后令牌失效', afterLogout.status === 401, `status=${afterLogout.status}`);

  console.log('\n[10] 限流保护');
  // 限流阈值 200/分钟，这里发 260 次登录请求，必须出现 429。
  const burst = [];
  for (let i = 0; i < 260; i += 1) {
    burst.push(await request('POST', '/api/auth/login/secret', { body: { userId: 'x', secret: 'y' } }));
  }
  const limited = burst.some(r => r.status === 429);
  check('连续尝试触发限流', limited, `429 出现 ${burst.filter(r => r.status === 429).length} 次`);

  return { ok: failed === 0, parentToken, familyId, parentId: parentRes.body.user.id };
}

(async () => {
  // 启动一个独立实例，避免污染开发服务的数据。
  // 限流计数默认走 Redis，与开发服务共享会互相干扰 —— 这里换成独立的 DB 与键前缀。
  const port = 7801;
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  process.env.CACHE_DIR = 'cache/test-users';
  process.env.USER_STORE_DIR = 'cache/test-users/users';
  process.env.API_MOCK = 'true';
  process.env.RATE_LIMIT_PER_MIN = '200';
  // 测试专用 Redis 库与键前缀：与开发/生产隔离，避免互相挤占限流额度与缓存。
  // REDIS_URL 里直接带库号 —— 它比 REDIS_DB 优先（URL 自身已含 db 段）。
  // 限流键跟随 REDIS_KEY_PREFIX（security.js 用 redisPrefix 构造），
  // 因此同一分钟内重复运行测试需先清理旧计数，否则会误触发 429。
  process.env.REDIS_URL = 'redis://127.0.0.1:6379/9';
  process.env.REDIS_KEY_PREFIX = 'zhidao-test-users';
  process.env.CACHE_BACKEND = 'redis';

  // 清掉上一轮遗留的限流计数（键含分钟窗口，只删本前缀下的 rl 部分）。
  try {
    const Redis = require('ioredis');
    const cleanup = new Redis({
      lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 1, enableOfflineQueue: false, db: 9
    });
    await cleanup.connect();
    let cursor = '0';
    do {
      const [next, batch] = await cleanup.scan(cursor, 'MATCH', 'zhidao-test-users:rl:v1:*', 'COUNT', 200);
      cursor = next;
      if (batch.length) await cleanup.del(...batch);
    } while (cursor !== '0');
    await cleanup.quit();
    console.log('[setup] 已清理旧限流计数');
  } catch (error) {
    console.log('[setup] 跳过限流计数清理:', error.message);
  }

  const child = require('node:child_process').spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = [];
  child.stdout.on('data', d => logs.push(d.toString()));
  child.stderr.on('data', d => logs.push(d.toString()));

  await new Promise(resolve => {
    const timer = setInterval(() => {
      if (logs.join('').includes('知岛已启动')) { clearInterval(timer); resolve(); }
    }, 200);
    setTimeout(() => { clearInterval(timer); resolve(); }, 15000);
  });

  BASE = `http://127.0.0.1:${port}`;
  let result = { ok: false };
  try {
    result = await run();
  } catch (error) {
    console.error('测试异常:', error.message);
    console.error(logs.join('').slice(-800));
  }

  if (result.ok) {
    // 重启服务：账号与成员必须还在（存储层不随进程消失）。
    console.log('\n[11] 重启后数据不丢');
    child.kill();
    await new Promise(resolve => setTimeout(resolve, 800));
    const child2 = require('node:child_process').spawn(process.execPath, ['server.js'], {
      cwd: ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe']
    });
    const logs2 = [];
    child2.stdout.on('data', d => logs2.push(d.toString()));
    child2.stderr.on('data', d => logs2.push(d.toString()));
    await new Promise(resolve => {
      const timer = setInterval(() => {
        if (logs2.join('').includes('知岛已启动')) { clearInterval(timer); resolve(); }
      }, 200);
      setTimeout(() => { clearInterval(timer); resolve(); }, 15000);
    });
    console.log('[restart] 实例日志:', logs2.join('').split('\n').filter(l => l.includes('redis') || l.includes('用户体系')).join(' | '));
    // 注意：第 9 节已退出登录，原令牌已失效，这里需要重新登录取新令牌。
    const relogin = await request('POST', '/api/auth/login/secret', {
      body: { userId: result.parentId, secret: 'test1234' }
    });
    check('重启后可用口令重新登录', relogin.status === 200, `status=${relogin.status}`);
    const freshToken = relogin.body?.token;
    const afterRestart = await request('GET', '/api/me', { token: freshToken });
    check('重启后会话仍有效', afterRestart.status === 200, `status=${afterRestart.status}`);
    check('重启后家庭成员仍在', afterRestart.body?.family?.members?.length >= 1, `成员数 ${afterRestart.body?.family?.members?.length}`);
    const faceAfterRestart = await request('POST', '/api/auth/login/face', {
      body: { familyId: result.familyId, descriptor: [perturb(descriptor(1), 0.008)] }
    });
    check('重启后人脸特征仍可匹配', faceAfterRestart.status === 200, `status=${faceAfterRestart.status} ${faceAfterRestart.body?.error || ''}`);
    child2.kill();
  }

  // 本地 JSON 存储的落盘命名：Windows 文件名不允许 `:`，而键是 `parent:usr_xxx`。
  // 曾直接用键当文件名，rename 抛 EINVAL，表现为「注册 500 / 重启后账号消失」。
  const fs = require('node:fs');
  const os = require('node:os');
  const { LocalUserStore } = require('./users');
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhidao-store-'));
  const store = new LocalUserStore({ dir: storeDir });
  await store.put('parent:usr_abc', { id: 'usr_abc', name: '小明' });
  const readBack = await store.get('parent:usr_abc');
  check('本地存储：带冒号的键可写入并读回', readBack?.name === '小明', JSON.stringify(readBack));
  const files = fs.readdirSync(storeDir);
  check('本地存储：物理文件名不含非法字符', files.length === 1 && !files[0].includes(':'), files.join(','));
  const listed = await store.keys('parent:');
  check('本地存储：keys 还原成原始键', listed.includes('parent:usr_abc'), listed.join(','));
  await store.remove('parent:usr_abc');
  check('本地存储：删除后读不到', (await store.get('parent:usr_abc')) === null);
  fs.rmSync(storeDir, { recursive: true, force: true });

  console.log(`\n全部通过：${passed} 项断言，失败 ${failed} 项。`);
  process.exit(failed === 0 ? 0 : 1);
})();
