/* 知识交互组件总览页 · 真实浏览器回归（离线 file:// 打开）
 *
 * 断言：单文件可打开、无外链请求、全部问题类型 / 组件卡可见、
 *       域 / 批次 / 关键词三种筛选生效、无脚本错误；输出一张整页截图。
 * 数量一律从 a2ui-question-map.js 动态读取，映射表扩容不需要再改测试。
 * 运行： npm run test:a2ui:roadmap:browser（需先 npm run build:a2ui:roadmap）
 */
'use strict';

const path = require('node:path');
const puppeteer = require('puppeteer-core');
const map = require('./a2ui-question-map');

const QUESTION_COUNT = map.QUESTION_TYPES.length;
const SPEC_COUNT = map.COMPONENT_SPECS.length;
const POETRY_ROWS = map.QUESTION_TYPES.filter(q => q.domain === 'poetry').length;
const POETRY_CARDS = map.COMPONENT_SPECS.filter(s => s.domain === 'poetry').length;

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGE = path.join(__dirname, 'cache', 'shots', 'a2ui-roadmap.html');
const SHOT = path.join(__dirname, 'cache', 'shots', 'a2ui-roadmap.png');

let passed = 0, failed = 0;
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 180000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/^https?:/.test(request.url())) external.push(request.url());
    });
    await page.goto('file:///' + PAGE.replace(/\\/g, '/'), { waitUntil: 'load' });

    console.log('\n【一】页面完整性');
    const title = await page.title();
    check('标题正确', title.includes('知识交互组件总体概览'), title);
    const counts = await page.evaluate(() => ({
      rows: document.querySelectorAll('tr[data-row]').length,
      cards: document.querySelectorAll('article[data-card]').length,
      stages: document.querySelectorAll('.stage').length,
      phases: document.querySelectorAll('.phasebox').length,
      batches: document.querySelectorAll('.batch').length,
      counter: document.getElementById('count').textContent,
      visibleRows: [...document.querySelectorAll('tr[data-row]')].filter(e => e.style.display !== 'none').length
    }));
    check(`${QUESTION_COUNT} 类问题全部渲染`, counts.rows === QUESTION_COUNT, JSON.stringify(counts.rows));
    check(`${SPEC_COUNT} 个组件卡片全部渲染`, counts.cards === SPEC_COUNT, JSON.stringify(counts.cards));
    check('5 阶段 / 4 过程 / 4 批次', counts.stages === 5 && counts.phases === 4 && counts.batches === 4,
      `${counts.stages}/${counts.phases}/${counts.batches}`);
    check(`初始计数显示 ${QUESTION_COUNT} 类 / ${SPEC_COUNT} 个`,
      counts.counter.includes(`${QUESTION_COUNT} 类问题`) && counts.counter.includes(`${SPEC_COUNT} 个组件`), counts.counter);
    check('单文件离线，零外链请求', external.length === 0, external.join(','));

    console.log('\n【二】三种筛选交互');
    await page.click('button[data-domain="poetry"]');
    const byDomain = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('tr[data-row]')].filter(e => e.style.display !== 'none').length,
      cards: [...document.querySelectorAll('article[data-card]')].filter(e => e.style.display !== 'none').length
    }));
    check(`按「诗词与名句」筛选：${POETRY_ROWS} 类问题 / ${POETRY_CARDS} 个组件`,
      byDomain.rows === POETRY_ROWS && byDomain.cards === POETRY_CARDS, JSON.stringify(byDomain));

    await page.click('button[data-domain="all"]');
    await page.click('button[data-batch="P4b"]');
    const byBatch = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('tr[data-row]')].filter(e => e.style.display !== 'none').length,
      cards: [...document.querySelectorAll('article[data-card]')].filter(e => e.style.display !== 'none').length,
      names: [...document.querySelectorAll('article[data-card]')]
        .filter(e => e.style.display !== 'none').map(e => e.querySelector('h3 code').textContent)
    }));
    check('按 P4b 筛选：6 个拼装型组件', byBatch.cards === 6, byBatch.names.join(','));
    check('P4b 含 ColumnArithmetic', byBatch.names.includes('ColumnArithmetic'));

    await page.click('button[data-batch="all"]');
    await page.type('#q', '口算');
    const byText = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('tr[data-row]')].filter(e => e.style.display !== 'none').length,
      cards: [...document.querySelectorAll('article[data-card]')].filter(e => e.style.display !== 'none').length
    }));
    check('关键词「口算」同时收窄表格与卡片',
      byText.rows > 0 && byText.rows < QUESTION_COUNT && byText.cards > 0 && byText.cards < SPEC_COUNT,
      JSON.stringify(byText));

    await page.evaluate(() => {
      const input = document.getElementById('q');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.screenshot({ path: SHOT, fullPage: true });
    check('整页截图已输出', require('node:fs').existsSync(SHOT), SHOT);
    check('页面无脚本错误', errors.length === 0, errors.join(' | '));

    console.log(`\n全部通过：${passed} 项断言，失败 ${failed} 项。`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error('浏览器回归异常：', error);
  process.exitCode = 1;
});
