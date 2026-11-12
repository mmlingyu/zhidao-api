/* 局域网访问回归：手机 / 其它设备通过 http://<局域网IP>:端口 访问时，
 * 页面与接口必须都能通，且不出现 "Failed to fetch"。
 *
 * 背景：服务默认只监听 127.0.0.1（安全默认）。一旦有人从局域网 IP 访问，
 * 浏览器会把请求发到局域网地址，而服务没监听该地址 → 连接被拒 →
 * 前端只看到 "Failed to fetch"，看不出真实原因。
 * 所以发布/联调时必须 HOST=0.0.0.0 并配置 CORS_ORIGINS。
 *
 * 运行：node test-lan-access.js
 *       LAN_TEST_URL=http://192.168.x.x:3100 node test-lan-access.js
 */
'use strict';

const os = require('node:os');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DEFAULT_PORT = 3100;

/* 找出本机可用的局域网 IPv4（排除回环与 WSL 虚拟网卡）。 */
function lanAddresses() {
  const out = [];
  const interfaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(interfaces)) {
    for (const item of list || []) {
      if (item.family !== 'IPv4') continue;
      if (item.internal) continue;
      if (/vEthernet|WSL|Hyper-V|VMware|VirtualBox|Loopback/i.test(name)) continue;
      out.push({ name, address: item.address });
    }
  }
  return out;
}

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${detail ? ' · ' + detail : ''}`); }
}

(async () => {
  const lan = lanAddresses();
  if (!lan.length) {
    console.log('本机没有可用的局域网 IPv4，跳过局域网访问回归。');
    return;
  }
  const target = process.env.LAN_TEST_URL || `http://${lan[0].address}:${DEFAULT_PORT}`;
  const host = new URL(target).hostname;
  console.log(`\n【局域网访问】目标 ${target}（网卡 ${lan[0].name}）\n`);

  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 120000,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    const netErrors = [];
    page.on('requestfailed', r => netErrors.push(`${r.failure() && r.failure().errorText} ${r.url()}`));
    page.on('console', m => { if (m.type() === 'error') netErrors.push(`console: ${m.text()}`); });

    await page.goto(`${target}/?t=${Date.now()}`, { waitUntil: 'networkidle2', timeout: 60000 });
    check('局域网地址能打开页面', true);

    const probe = await page.evaluate(async () => {
      try {
        const res = await fetch('/api/grades');
        return { ok: res.ok, status: res.status };
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) };
      }
    });
    check('页面内接口请求成功（不出现 Failed to fetch）',
      probe.ok === true, JSON.stringify(probe));

    const face = await page.evaluate(async () => {
      try { await window.FACE.load(); return { ok: true, backend: window.FACE.status().backend }; }
      catch (error) { return { ok: false, error: String((error && error.message) || error) }; }
    });
    check('人脸模型从局域网地址加载成功', face.ok === true, JSON.stringify(face));

    await page.click('#id-entry');
    await new Promise(resolve => setTimeout(resolve, 700));
    const ui = await page.evaluate(() => ({
      secure: window.isSecureContext,
      hint: document.getElementById('id-face-hint')?.textContent || '',
      captureDisabled: document.getElementById('id-capture')?.disabled === true,
      secretTab: document.getElementById('id-tab-secret')?.textContent || ''
    }));
    // 非安全上下文（http 局域网 IP）下摄像头不可用是预期行为，
    // 但必须给出明确指引并保留口令登录入口。
    check('非 HTTPS 下明确提示摄像头不可用',
      ui.secure === false ? /HTTPS/.test(ui.hint) : true, ui.hint);
    check('摄像头不可用时禁用采集按钮', ui.captureDisabled === true, ui.hint);
    check('保留口令登录入口', /口令/.test(ui.secretTab), ui.secretTab);

    const failedRequests = netErrors.filter(item => !item.includes('favicon'));
    check('没有网络层失败请求', failedRequests.length === 0, failedRequests.join(' | '));
  } finally {
    await browser.close();
  }

  console.log(`\n局域网访问回归：${passed} 通过 / ${failed} 失败\n`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error('局域网回归异常：', error);
  process.exitCode = 1;
});
