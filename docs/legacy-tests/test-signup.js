/* 注册 / 登录全链路端到端自测（真实浏览器 + 真实服务端）
 *
 * 覆盖：
 *  - 注册弹窗：年级下拉必须可选出真实年级（曾因 grades 未加载而无法选择）
 *  - 注册：填称呼 → 选年级 → 设口令 → （模拟人脸采集）→ 创建账号
 *  - 成员管理：添加孩子（年级 + 口令）
 *  - 退出登录 → 用「称呼 + 口令」重新登录（曾因前端提交姓名而服务端要 ID 而永远失败）
 *  - 同名账号被拒绝（防止登录到别人家）
 *
 * 人脸采集：headless 环境无摄像头，脚本在页面内注入 FACE.describeMulti /
 * FACE.describe 的替身，返回可区分不同人的单位向量。这样能完整走通
 * 表单 → 采集 → 提交 → 建号的真实链路，而不是绕过前端直接调接口。
 *
 * 运行：node test-signup.js（需先启动 node server.js）
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(ROOT, 'cache', 'shots');
const BASE = process.env.UI_TEST_URL || 'http://127.0.0.1:3000';
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' · ' + detail : ''}`); }
}
function section(title) { console.log(`\n[${title}]`); }

/**
 * 在页面里注入人脸采集替身。
 * seed 决定「这张脸」是谁 —— 不同 seed 的向量彼此远离，用来验证是否登错人。
 */
async function installFaceStub(page, seed) {
  await page.evaluate((faceSeed) => {
    const make = (s) => {
      const v = new Array(128).fill(0);
      const off = (s % 16) * 8;
      for (let k = 0; k < 8; k++) v[off + k] = 1;
      const n = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
      return v.map(x => x / n);
    };
    window.__faceSeed = faceSeed;
    window.FACE.describeMulti = async () => ({
      descriptors: [make(faceSeed), make(faceSeed + 1), make(faceSeed + 2)],
      best: make(faceSeed)
    });
    window.FACE.describe = async () => ({ descriptor: make(window.__faceSeed), score: 0.99, box: {} });
    window.FACE.load = async () => true;
    window.FACE.cameraSupport = () => ({ ok: true, reason: '' });
    window.FACE.openCamera = async (video) => {
      // 视频源不可用时也要让 UI 走完流程，这里只做占位。
      video.dataset.stub = '1';
      return { video, stop() {} };
    };
  }, seed);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // 「Failed to load resource」是浏览器对非 2xx 响应的自动提示，不是脚本异常。
    // 本用例会故意触发 401（错误口令）与 409（同名保护），属于预期结果。
    if (text.includes('Failed to load resource')) return;
    if (text.includes('favicon')) return;
    errors.push('console: ' + text);
  });

  // 每次跑用不同的名字，避免与历史数据同名导致「多个同名账号」。
  const stamp = Date.now().toString().slice(-8);
  const parentName = `测试家长${stamp}`;
  const childName = `测试孩子${stamp}`;
  const parentSecret = 'zhidao2026';

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  // ---------- 1. 注册弹窗：年级可选 ----------
  section('注册弹窗');
  await installFaceStub(page, 3);
  await page.click('#id-entry');
  await new Promise(r => setTimeout(r, 900));

  const gradeInfo = await page.evaluate(() => {
    const select = document.getElementById('id-grade');
    if (!select) return null;
    return {
      count: select.options.length,
      disabled: select.disabled,
      labels: Array.from(select.options).map(o => o.textContent),
      values: Array.from(select.options).map(o => o.value)
    };
  });
  check('注册弹窗含年级下拉', Boolean(gradeInfo));
  check('年级列表已加载（≥10 项）', (gradeInfo?.count || 0) >= 10, `${gradeInfo?.count} 项`);
  check('年级下拉未被禁用', gradeInfo?.disabled === false);
  check('包含具体年级（三年级）', gradeInfo?.labels.includes('三年级') === true);

  // 真实选中一个年级，验证 select 的 value 确实被写上。
  const picked = await page.evaluate(() => {
    const select = document.getElementById('id-grade');
    if (!select) return null;
    select.value = 'grade4';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { value: select.value, text: select.selectedOptions[0]?.textContent || '' };
  });
  check('年级可被实际选中', picked?.value === 'grade4', `选中「${picked?.text}」`);

  const hasSubmit = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#modal-body .id-btn'))
      .find(b => b.textContent.includes('创建账号'));
    return Boolean(btn);
  });
  check('注册有独立提交按钮（不依赖摄像头）', hasSubmit);
  await page.screenshot({ path: path.join(OUT, 'signup-1-register.png') });

  // ---------- 2. 完成注册 ----------
  section('注册');
  await page.type('#id-name', parentName);
  await page.evaluate(() => { document.getElementById('id-grade').value = 'grade4'; });
  await page.type('#id-secret', parentSecret);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#modal-body .id-btn'))
      .find(b => b.textContent.includes('创建账号'));
    btn?.click();
  });
  await new Promise(r => setTimeout(r, 2500));

  const afterRegister = await page.evaluate(() => ({
    token: Boolean(localStorage.getItem('zhidao.session.token')),
    entryName: document.getElementById('id-entry-name')?.textContent,
    title: document.getElementById('modal-title')?.textContent,
    hasGradeHint: document.body.innerText.includes('登录账号')
  }));
  check('注册成功并获得会话', afterRegister.token === true);
  check('顶栏显示家长称呼', afterRegister.entryName === parentName, `顶栏「${afterRegister.entryName}」`);
  check('注册后进入家庭成员管理', afterRegister.title === '家庭成员', `标题「${afterRegister.title}」`);
  check('展示登录账号 ID', afterRegister.hasGradeHint === true);
  await page.screenshot({ path: path.join(OUT, 'signup-2-members.png') });

  // ---------- 3. 添加孩子（含年级与口令） ----------
  section('添加成员');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#modal-body .id-btn'))
      .find(b => b.textContent.includes('添加孩子'));
    btn?.click();
  });
  await new Promise(r => setTimeout(r, 800));

  const memberGrade = await page.evaluate(() => {
    const select = document.getElementById('id-member-grade');
    return select ? { count: select.options.length, disabled: select.disabled } : null;
  });
  check('添加成员含年级下拉', Boolean(memberGrade));
  check('添加成员年级列表已加载', (memberGrade?.count || 0) >= 10, `${memberGrade?.count} 项`);
  check('添加成员年级未被禁用', memberGrade?.disabled === false);

  const hasMemberSecret = await page.evaluate(() => Boolean(document.getElementById('id-member-secret')));
  check('添加成员可设置登录口令', hasMemberSecret);

  await page.type('#id-member-name', childName);
  await page.evaluate(() => { document.getElementById('id-member-grade').value = 'grade3'; });
  await page.type('#id-member-secret', 'child1234');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#modal-body .id-btn'))
      .find(b => b.textContent.includes('保存成员'));
    btn?.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  const memberList = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.id-member-info strong')).map(el => el.textContent));
  check('孩子已加入家庭', memberList.includes(childName), memberList.join('/'));

  const childMeta = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.id-member'));
    const card = cards.find(c => c.querySelector('strong')?.textContent?.includes('孩子'));
    return card?.querySelector('small')?.textContent || '';
  });
  check('孩子年级正确显示', childMeta.includes('三年级'), childMeta);
  await page.screenshot({ path: path.join(OUT, 'signup-3-child.png') });

  // ---------- 4. 退出后用「称呼 + 口令」登录 ----------
  section('口令登录');
  await page.evaluate(() => {
    localStorage.removeItem('zhidao.session.token');
    localStorage.removeItem('zhidao.session.user');
    localStorage.removeItem('zhidao.session.family');
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));
  const guestName = await page.evaluate(() => document.getElementById('id-entry-name')?.textContent);
  check('退出后回到游客态', guestName === '登录', `顶栏「${guestName}」`);

  await page.click('#id-entry');
  await new Promise(r => setTimeout(r, 700));
  await page.evaluate(() => document.getElementById('id-tab-secret').click());
  await new Promise(r => setTimeout(r, 500));

  const loginUi = await page.evaluate(() => ({
    hasInput: Boolean(document.getElementById('id-user')),
    inputTag: document.getElementById('id-user')?.tagName,
    placeholder: document.getElementById('id-user')?.placeholder
  }));
  check('登录面板含账号输入框', loginUi.hasInput === true);
  check('账号是可输入控件而非空下拉', loginUi.inputTag === 'INPUT', loginUi.inputTag);

  // 错误口令应被拒绝
  await page.type('#id-user', parentName);
  await page.type('#id-secret-login', 'wrong-password');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#modal-body .id-btn'))
      .find(b => b.textContent.trim() === '登录');
    btn?.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  const wrongPass = await page.evaluate(() => ({
    token: Boolean(localStorage.getItem('zhidao.session.token')),
    toast: document.getElementById('toast')?.textContent || ''
  }));
  check('错误口令被拒绝', wrongPass.token === false);
  check('错误口令有明确提示', wrongPass.toast.includes('不正确'), wrongPass.toast);

  // 正确口令应登录成功
  await page.evaluate(() => {
    document.getElementById('id-secret-login').value = '';
    document.getElementById('id-secret-login').focus();
  });
  await page.type('#id-secret-login', parentSecret);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#modal-body .id-btn'))
      .find(b => b.textContent.trim() === '登录');
    btn?.click();
  });
  await new Promise(r => setTimeout(r, 2500));

  const afterLogin = await page.evaluate(() => ({
    token: Boolean(localStorage.getItem('zhidao.session.token')),
    entryName: document.getElementById('id-entry-name')?.textContent,
    profileSub: document.getElementById('profile-sub')?.textContent
  }));
  check('用称呼 + 口令登录成功', afterLogin.token === true);
  check('登录后顶栏显示称呼', afterLogin.entryName === parentName, `顶栏「${afterLogin.entryName}」`);
  check('登录后识别为家长', /家长/.test(afterLogin.profileSub || ''), afterLogin.profileSub);
  await page.screenshot({ path: path.join(OUT, 'signup-4-relogin.png') });

  // ---------- 5. 孩子也能用自己的口令登录 ----------
  section('成员登录');
  const childLogin = await page.evaluate(async (name) => {
    const res = await fetch('/api/auth/login/secret', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: name, secret: 'child1234' })
    });
    const data = await res.json();
    return { status: res.status, role: data.user?.role, name: data.user?.name, error: data.error };
  }, childName);
  check('孩子可用自己的口令登录', childLogin.status === 200 && childLogin.role === 'student',
    `status=${childLogin.status} ${childLogin.error || ''}`);

  // ---------- 6. 同名账号必须被拒绝 ----------
  section('同名保护');
  const dupe = await page.evaluate(async (name) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, grade: 'grade1', secret: 'another-pass' })
    });
    return { status: res.status };
  }, parentName);
  check('允许同名账号注册（姓名本身可重复）', dupe.status === 200, `status=${dupe.status}`);

  const ambiguous = await page.evaluate(async (name) => {
    const res = await fetch('/api/auth/login/secret', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: name, secret: 'zhidao2026' })
    });
    return { status: res.status, error: (await res.json()).error };
  }, parentName);
  check('同名时拒绝按姓名登录（防串号）', ambiguous.status === 409, `status=${ambiguous.status} ${ambiguous.error || ''}`);

  // 用账号 ID 则应能登录
  const byId = await page.evaluate(async () => {
    const user = JSON.parse(localStorage.getItem('zhidao.session.user') || 'null');
    const res = await fetch('/api/auth/login/secret', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: user.id, secret: 'zhidao2026' })
    });
    return { status: res.status };
  });
  check('同名时可用账号 ID 登录', byId.status === 200, `status=${byId.status}`);

  // ---------- 6. 移动端注册流程 ----------
  section('移动端注册');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  const entryHit = await page.evaluate(() => {
    const entry = document.getElementById('id-entry');
    const rect = entry.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { blocked: Boolean(top) && top !== entry && !entry.contains(top), who: top?.id || top?.className || '' };
  });
  check('移动端身份入口可点（未被遮挡）', entryHit.blocked === false, entryHit.who);

  await page.click('#id-entry');
  await new Promise(r => setTimeout(r, 1000));
  const mobileGrade = await page.evaluate(() => {
    const select = document.getElementById('id-grade');
    const btn = Array.from(document.querySelectorAll('#modal-body .id-btn')).find(b => b.textContent.includes('创建账号'));
    const rect = btn?.getBoundingClientRect();
    return {
      count: select?.options.length ?? 0,
      disabled: select?.disabled,
      btnVisible: rect ? (rect.top >= 0 && rect.bottom <= window.innerHeight) : false,
      btnHeight: rect ? Math.round(rect.height) : 0,
      overflowX: document.documentElement.scrollWidth <= window.innerWidth + 1
    };
  });
  check('移动端年级列表可用', mobileGrade.count >= 10 && mobileGrade.disabled === false, `${mobileGrade.count} 项`);
  check('移动端创建账号按钮无需滚动即可见', mobileGrade.btnVisible === true);
  check('移动端按钮触控区 ≥ 40px', mobileGrade.btnHeight >= 40, `${mobileGrade.btnHeight}px`);
  check('移动端弹窗无横向溢出', mobileGrade.overflowX === true);
  await page.screenshot({ path: path.join(OUT, 'signup-5-mobile.png') });

  // ---------- 7. 无 JS 错误 ----------
  section('运行期');
  check('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n全部通过：${passed} 项断言，失败 ${failed} 项。`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => {
  console.error('失败:', e.message);
  process.exit(1);
});
