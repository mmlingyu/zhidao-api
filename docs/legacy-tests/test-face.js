/* 人脸资源链路回归（Node 层）
 *
 * 背景：曾出现「人脸模型加载失败，请检查网络后重试」，但真实原因被吞掉 ——
 * 可能是部署缺文件、Service Worker 缓存了 404、wasm 后端初始化失败，
 * 前端统一包装成一句「检查网络」，既不能定位也不能自愈。
 *
 * 本测试校验：资源清单三方一致、服务端自检接口就绪、静态资源 HTTP 状态与 MIME 正确、
 * 加载器具备分阶段诊断 / 后端降级 / 缓存清理重试、SW 不再缓存错误响应。
 *
 * 运行：node test-face.js（需先启动 node server.js）
 *       UI_TEST_URL=http://127.0.0.1:3100 node test-face.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const BASE = process.env.UI_TEST_URL || 'http://127.0.0.1:3000';
let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${detail ? ' · ' + detail : ''}`); }
}
function section(title) { console.log(`\n[${title}]`); }
function read(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8'); }

const REQUIRED = [
  '/vendor/face-api.esm.js',
  '/vendor/tfjs-backend-wasm.wasm',
  '/vendor/tfjs-backend-wasm-simd.wasm',
  '/vendor/tfjs-backend-wasm-threaded-simd.wasm',
  '/model/tiny_face_detector_model-weights_manifest.json',
  '/model/tiny_face_detector_model.bin',
  '/model/face_recognition_model-weights_manifest.json',
  '/model/face_recognition_model.bin'
];

async function main() {
  const face = read('face.js');
  const server = read('server.js');
  const sw = read('sw.js');
  const build = read('build-face.js');
  const identity = read('identity.js');
  const html = read('index.html');

  section('资源清单三方一致');
  for (const url of REQUIRED) {
    check(`清单含 ${url}`,
      face.includes(url) && server.includes(url) && sw.includes(url) && build.includes(url.split('/').pop()),
      'face.js / server.js / sw.js / build-face.js 都要包含');
  }
  check('public 下文件真实存在且非空', REQUIRED.every(url => {
    const file = path.join(ROOT, 'public', url.slice(1));
    try { return fs.statSync(file).isFile() && fs.statSync(file).size > 0; } catch (e) { return false; }
  }));

  section('加载器：诊断、降级与自愈');
  check('动态导入使用绝对路径', face.includes("const FACE_API_URL = '/vendor/face-api.esm.js'") && !face.includes("import('./vendor"));
  check('不再吞掉底层异常', !face.includes('人脸模型加载失败，请检查网络后重试'));
  check('错误带 FACE_MODEL 码与定位字段', /error\.code = 'FACE_MODEL'/.test(face)
    && face.includes('error.stage') && face.includes('error.url') && face.includes('error.status'));
  check('按阶段解析失败原因', face.includes("failure('vendor'") && face.includes("failure('model'")
    && face.includes("stage === 'backend'"));
  check('wasm → webgl → cpu 三级降级', /\['wasm', 'webgl', 'cpu'\]/.test(face));
  check('加载前先清理历史错误缓存', face.includes('purgeAssetCache({ onlyBad: true })') && face.includes('hit?.ok !== false'));
  check('失败后清理资源缓存并重试一次', face.includes('purgeAssetCache()') && face.includes('loadOnce(true)'));
  check('导出自检与状态接口', face.includes('checkAssets, purgeAssetCache') && face.includes('function status()'));
  check('并发加载共享 Promise、失败后允许重试', face.includes('if (loadPromise) return loadPromise;')
    && face.includes('loadPromise = null'));

  section('Service Worker：只缓存 2xx + 网络优先');
  const version = Number((sw.match(/zhidao-shell-v(\d+)/) || [])[1] || 0);
  check('版本已升级到 v12 以上（清掉历史脏缓存）', version >= 12, `当前 v${version}`);
  const assetBranch = sw.slice(sw.indexOf("url.pathname.startsWith('/model/')"), sw.indexOf('// 其余静态资源'));
  check('模型/wasm 分支先走网络', assetBranch.includes('fetch(request)')
    && assetBranch.indexOf('fetch(request)') < assetBranch.indexOf('caches.match(request)'));
  check('只缓存成功响应', (sw.match(/if \(response\.ok\)/g) || []).length >= 2);
  check('离线回退过滤错误响应', sw.includes('hit && hit.ok ? hit : Response.error()'));
  check('回退时忽略查询串', sw.includes('ignoreSearch: true'));

  section('界面：失败可重试且不挡住口令路径');
  check('识别 FACE_MODEL 错误', identity.includes("error?.code === 'FACE_MODEL'"));
  check('展示具体原因与 hint', identity.includes('error.hint'));
  check('提供重试按钮文案', identity.includes('重试加载模型'));
  check('高亮口令登录', identity.includes('改用口令登录'));
  check('face.js 版本号已更新', /face\.js\?v=20261112/.test(html));

  section('服务端自检接口与静态资源');
  let report = null;
  try {
    const res = await fetch(`${BASE}/api/face-assets`, { cache: 'no-store' });
    report = res.ok ? await res.json() : null;
    check('GET /api/face-assets 返回 200', Boolean(report), `HTTP ${res.status}`);
  } catch (e) {
    check('GET /api/face-assets 返回 200', false, e.message);
  }
  if (report) {
    check('ready=true 且无缺失', report.ready === true && Array.isArray(report.missing) && report.missing.length === 0,
      JSON.stringify(report.missing));
    check('清单覆盖 8 个资源', report.assets?.length === REQUIRED.length);
    check('每个资源都有字节数', report.assets?.every(a => a.ok && a.size > 0));
  }
  try {
    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('/api/health 暴露人脸资源状态', health.face?.ready === true);
  } catch (e) {
    check('/api/health 暴露人脸资源状态', false, e.message);
  }
  const mimeExpect = url => url.endsWith('.wasm') ? 'application/wasm'
    : url.endsWith('.bin') ? 'application/octet-stream'
      : url.endsWith('.json') ? 'application/json' : 'text/javascript';
  for (const url of REQUIRED) {
    try {
      const res = await fetch(`${BASE}${url}`, { method: 'HEAD' });
      const type = (res.headers.get('content-type') || '').split(';')[0];
      check(`HEAD ${url} → 200 / ${mimeExpect(url)}`, res.status === 200 && type === mimeExpect(url),
        `HTTP ${res.status} ${type}`);
    } catch (e) {
      check(`HEAD ${url}`, false, e.message);
    }
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败${failed ? `（服务地址 ${BASE}）` : ''}`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('测试异常：', e); process.exitCode = 1; });
