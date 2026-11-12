'use strict';
/**
 * 生成模型实测基准：qwen-plus vs Liquid LFM3-1.7B
 * 用与生产完全相同的提示词、解析和校验（models.js），跑真实课程任务，
 * 输出延迟、token、成本与合格课程率，并把结果写入 bench-results.json。
 *
 *   npm run bench                  # 三学科（语文/英语/数学）
 *   npm run bench -- --quick       # 只跑语文
 *   npm run bench -- --provider=qwen
 *
 * 成本说明：Liquid 直接采用响应里的 usage.cost（USD，官方计费）；
 * Qwen 按中国内地 qwen-plus 非思考模式官方价 ¥0.8/百万输入、¥2/百万输出折算，
 * 汇率由 USD_CNY_RATE 配置，默认 7.1。价格为估算，实际以账单为准。
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  PROVIDERS, resolveGeneration, chatCompletion,
  buildLessonPrompt, parseModelJson, validateLesson, DEFAULT_USD_CNY
} = require('./models');

const ROOT = __dirname;
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const providerArg = (args.find(a => a.startsWith('--provider=')) || '').split('=')[1];
const cases = quick
  ? [{ subject: 'chinese', input: '思念' }]
  : [
    { subject: 'chinese', input: '思念' },
    { subject: 'english', input: 'borrow / lend' },
    { subject: 'math', input: '2x+3=11' }
  ];
const providers = providerArg ? [providerArg] : Object.keys(PROVIDERS);

function loadEnv() {
  const env = { ...process.env };
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return env;
  // 密钥变量必须让 .env 优先：shell 里可能残留旧版 apikey_ 前缀的失效密钥。
  const keyVars = new Set(['JEV_API_KEY', 'LIQUID_API_KEY', 'DASHSCOPE_API_KEY', 'GENERATION_API_KEY']);
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (keyVars.has(m[1])) env[m[1]] = value;
    else if (process.env[m[1]] === undefined) env[m[1]] = value; // 其余参数允许命令行临时覆盖
  }
  return env;
}

function configFor(env, provider) {
  return resolveGeneration({
    ...env,
    GENERATION_PROVIDER: provider,
    GENERATION_MODEL: '', GENERATION_BASE_URL: '', GENERATION_API_KEY: ''
  });
}

function money(value) {
  if (!Number.isFinite(value)) return '-';
  return value < 0.0001 ? `$${value.toFixed(8)}` : `$${value.toFixed(6)}`;
}
function pad(value, width) {
  const text = String(value);
  // 中文按 2 列宽近似，保证控制台表格对齐
  const size = [...text].reduce((n, ch) => n + (/[\u2e80-\uffff]/.test(ch) ? 2 : 1), 0);
  return text + ' '.repeat(Math.max(0, width - size));
}

async function runCase(cfg, item) {
  const prompt = buildLessonPrompt(item.subject, item.input, cfg);
  const started = Date.now();
  const record = {
    provider: cfg.provider, model: cfg.model, subject: item.subject, input: item.input,
    ok: false, valid: false, error: '', latencyMs: 0, chars: 0,
    usage: null, costUSD: 0, costSource: '', finishReason: ''
  };
  try {
    const result = await chatCompletion(cfg, {
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
      temperature: cfg.temperature, maxTokens: cfg.maxTokens
    });
    record.latencyMs = result.latencyMs;
    record.chars = String(result.content || '').length;
    record.usage = result.usage;
    record.costUSD = result.costUSD;
    record.costSource = result.costSource;
    record.finishReason = result.finishReason;
    record.ok = true;
    try {
      const data = validateLesson(item.subject, parseModelJson(result.content), item.input);
      record.valid = true;
      record.title = data.title;
      record.sample = item.subject === 'chinese' ? (data.idioms[0]?.word || '')
        : item.subject === 'english' ? (data.items[0]?.word || '')
          : (data.methods[0]?.name || '');
    } catch (error) { record.error = error.message; }
  } catch (error) {
    record.latencyMs = Date.now() - started;
    record.error = `${error.message}${error.upstream ? ` · ${error.upstream}` : ''}`;
  }
  return record;
}

function summarize(records) {
  const ok = records.filter(r => r.ok);
  const valid = records.filter(r => r.valid);
  const total = fn => ok.reduce((sum, r) => sum + fn(r), 0);
  const avg = fn => ok.length ? total(fn) / ok.length : 0;
  return {
    calls: records.length, okCalls: ok.length, validCalls: valid.length,
    validRate: records.length ? valid.length / records.length : 0,
    avgLatencyMs: Math.round(avg(r => r.latencyMs)),
    totalPromptTokens: total(r => r.usage?.promptTokens || 0),
    totalCompletionTokens: total(r => r.usage?.completionTokens || 0),
    totalReasoningTokens: total(r => r.usage?.reasoningTokens || 0),
    totalCachedTokens: total(r => r.usage?.cachedTokens || 0),
    avgCompletionTokens: Math.round(avg(r => r.usage?.completionTokens || 0)),
    tokensPerSecond: Math.round(avg(r => (r.usage?.completionTokens || 0) / (r.latencyMs / 1000))),
    totalCostUSD: total(r => r.costUSD),
    avgCostUSD: avg(r => r.costUSD),
    costPer1kLessonsUSD: avg(r => r.costUSD) * 1000,
    // 只看合格的课：失败请求同样会计费，因此「全部请求」与「成功课程」要分开看。
    validAvgLatencyMs: Math.round(valid.length ? valid.reduce((s, r) => s + r.latencyMs, 0) / valid.length : 0),
    validAvgCostUSD: valid.length ? valid.reduce((s, r) => s + r.costUSD, 0) / valid.length : 0,
    validTokensPerSecond: Math.round(valid.length ? valid.reduce((s, r) => s + (r.usage?.completionTokens || 0) / (r.latencyMs / 1000), 0) / valid.length : 0)
  };
}

(async () => {
  const env = loadEnv();
  const configs = providers.map(p => configFor(env, p));
  for (const cfg of configs) {
    if (!PROVIDERS[cfg.provider]) throw new Error(`未知 provider：${cfg.provider}`);
    if (!cfg.configured) throw new Error(`${cfg.provider} 缺少密钥，请检查 .env`);
  }
  console.log('知岛生成模型基准测试（真实接口、生产同款提示词与校验）');
  console.log(`用例：${cases.map(c => `${c.subject}/${c.input}`).join('  ')}`);
  console.log('配置：' + configs.map(c => `${c.id} temp=${c.temperature} max=${c.maxTokens}${c.provider === 'liquid' ? ` reasoning=${c.reasoningEffort}` : ''}`).join(' | '));
  console.log(`汇率：1 USD ≈ ¥${configs[0].usdCny}（可用 USD_CNY_RATE 调整；默认 ${DEFAULT_USD_CNY}）\n`);

  const records = [];
  for (const cfg of configs) {
    for (const item of cases) {
      process.stdout.write(`运行中 ${pad(cfg.id, 22)} ${pad(item.subject + ' / ' + item.input, 26)} ... `);
      const record = await runCase(cfg, item);
      records.push(record);
      console.log(record.valid ? `合格 ${record.latencyMs}ms ${money(record.costUSD)}`
        : `不合格/失败 ${record.latencyMs}ms ${record.error.slice(0, 70)}`);
    }
  }

  console.log('\n----- 逐次明细 -----');
  console.log(`${pad('模型', 22)}${pad('学科/输入', 26)}${pad('延迟', 10)}${pad('输入tok', 10)}${pad('输出tok', 10)}${pad('推理tok', 10)}${pad('成本', 14)}合格`);
  for (const r of records) {
    console.log(`${pad(r.model, 22)}${pad(r.subject + '/' + r.input, 26)}${pad(r.latencyMs + 'ms', 10)}${pad(r.usage?.promptTokens ?? '-', 10)}${pad(r.usage?.completionTokens ?? '-', 10)}${pad(r.usage?.reasoningTokens ?? '-', 10)}${pad(money(r.costUSD), 14)}${r.valid ? '✓' : '✗ ' + r.error}`);
  }

  console.log('\n----- 汇总 -----');
  const summary = {};
  for (const cfg of configs) {
    const s = summarize(records.filter(r => r.provider === cfg.provider));
    summary[cfg.id] = s;
    console.log(`${cfg.id}: 全部请求平均 ${s.avgLatencyMs}ms · ${money(s.avgCostUSD)}/次（含失败，失败也计费） · 1000 次 ${money(s.costPer1kLessonsUSD)} · 合格 ${s.validCalls}/${s.calls}`);
    console.log(`  仅合格课程：平均 ${s.validAvgLatencyMs}ms · ${s.validTokensPerSecond} tok/s · ${money(s.validAvgCostUSD)}/次 · 输出 ${s.avgCompletionTokens} tok`);
    console.log(`  计费：${cfg.pricing.note}`);
  }
  if (configs.length === 2) {
    const a = summary[configs[0].id], b = summary[configs[1].id];
    if (a.validAvgLatencyMs && b.validAvgLatencyMs) {
      console.log(`\n合格课程对比（${configs[1].id} 相对 ${configs[0].id}）：延迟 ${(b.validAvgLatencyMs / a.validAvgLatencyMs).toFixed(2)}x · 成本 ${(b.validAvgCostUSD / a.validAvgCostUSD).toFixed(2)}x · 吞吐 ${(b.validTokensPerSecond / a.validTokensPerSecond).toFixed(2)}x · 合格率 ${(b.validRate * 100).toFixed(0)}% vs ${(a.validRate * 100).toFixed(0)}%`);
    }
  }

  const output = {
    ranAt: new Date().toISOString(),
    note: 'Liquid 成本来自 usage.cost；Qwen 成本按官方单价与 USD_CNY_RATE 估算。合格率按生产 validateLesson 判定，不代表内容事实准确性。',
    pricing: Object.fromEntries(configs.map(c => [c.id, { ...c.pricing, usdCnyRate: c.usdCny, docs: c.docs }])),
    configs: configs.map(c => ({ id: c.id, temperature: c.temperature, maxTokens: c.maxTokens, reasoningEffort: c.provider === 'liquid' ? c.reasoningEffort : null, promptVersion: c.promptVersion })),
    records, summary
  };
  const outFile = path.join(ROOT, 'bench-results.json');
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\n结果已保存：${outFile}`);
})().catch(error => { console.error(`基准测试失败：${error.message}`); process.exit(1); });
