'use strict';
/**
 * 真实调用 /api/tutor（stageEvents 流），记录语文/数学/英语
 * 互动讲解卡是否在完整课之前到达，以及领先多少毫秒。
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.ZHIDAO_BASE || 'http://127.0.0.1:3100';
const OUT = process.env.ZHIDAO_PREVIEW_LOG || path.join(__dirname, 'preview-flow-results.json');

const CASES = [
  { name: '语文', input: '「静夜思」里「床前明月光」在写什么' },
  { name: '数学', input: '三角形的内角和是多少，怎么说明' },
  { name: '英语', input: '点餐时 how to use would like' }
];

function now() { return Date.now(); }
function fmt(ms) { return `${(ms / 1000).toFixed(1)}s`; }

async function readSSE(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    for (const frame of frames) {
      let event = 'message', data = '';
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      let payload;
      try { payload = JSON.parse(data); } catch { continue; }
      onEvent(event, payload);
    }
  }
}

async function runCase(item) {
  const started = now();
  const rec = {
    name: item.name,
    input: item.input,
    startedAt: new Date(started).toISOString(),
    events: [],
    previewAt: null,
    resultAt: null,
    routeAt: null,
    preview: null,
    resultMeta: null,
    error: null
  };
  const log = (msg) => {
    const line = `[${item.name} +${fmt(now() - started)}] ${msg}`;
    console.log(line);
    rec.events.push({ t: now() - started, msg });
  };
  log(`开始请求 ${item.input}`);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 240000);
  try {
    const response = await fetch(`${BASE}/api/tutor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        input: item.input,
        refresh: true,
        stageEvents: true,
        allowFallback: true,
        grade: '三年级'
      }),
      signal: ac.signal
    });
    const ctype = response.headers.get('content-type') || '';
    log(`HTTP ${response.status} ${ctype}`);
    if (!response.ok) {
      const text = await response.text();
      rec.error = `HTTP ${response.status} ${text.slice(0, 300)}`;
      log(`失败 ${rec.error}`);
      return rec;
    }
    if (!ctype.includes('text/event-stream')) {
      const json = await response.json().catch(() => ({}));
      rec.error = '未返回事件流，无法验证提前出卡';
      rec.resultMeta = { subject: json.subject, cached: json.cached };
      log(rec.error);
      return rec;
    }
    await readSSE(response, (event, payload) => {
      if (event === 'stage' && payload.stage === 'route') {
        rec.routeAt = now();
        log(`学科决策完成 subject=${payload.subject} 耗时${payload.latencyMs}ms`);
      } else if (event === 'preview') {
        rec.previewAt = now();
        rec.preview = {
          subject: payload.subject,
          title: payload.data && (payload.data.bannerTitle || payload.data.title),
          subtitle: payload.data && payload.data.subtitle,
          description: payload.data && payload.data.description,
          latencyMs: payload.latencyMs,
          source: payload.source
        };
        log(`互动讲解卡已到达 subject=${rec.preview.subject} 标题=${rec.preview.title} 导语${String(rec.preview.description || '').length}字 服务端距讲解开始${payload.latencyMs}ms`);
      } else if (event === 'stage' && payload.stage === 'lesson') {
        log(`讲解分析完成 耗时${payload.latencyMs}ms model=${payload.model || ''} provider=${payload.provider || ''}`);
      } else if (event === 'result') {
        rec.resultAt = now();
        const data = payload.data || {};
        rec.resultMeta = {
          subject: payload.subject,
          title: data.bannerTitle || data.title,
          cached: payload.cached,
          model: payload.generationModel,
          provider: payload.generationProvider
        };
        const lead = rec.previewAt ? (rec.resultAt - rec.previewAt) : 0;
        log(`完整课到达 subject=${payload.subject} 模型=${payload.generationProvider || ''} ${payload.generationModel || ''} 提前出卡=${Boolean(rec.previewAt)} 领先${lead}ms`);
      } else if (event === 'error') {
        rec.error = payload.error || JSON.stringify(payload);
        log(`错误 ${rec.error}`);
      }
    });
  } catch (error) {
    rec.error = error.name === 'AbortError' ? '等待超时（240秒）' : error.message;
    log(`异常 ${rec.error}`);
  } finally {
    clearTimeout(timer);
  }
  rec.totalMs = now() - started;
  rec.leadMs = rec.previewAt && rec.resultAt ? rec.resultAt - rec.previewAt : null;
  rec.earlyCard = Boolean(rec.previewAt && rec.resultAt && rec.leadMs >= 400);
  rec.sameTime = Boolean(rec.previewAt && rec.resultAt && rec.leadMs < 400);
  rec.noPreview = !rec.previewAt;
  const verdict = rec.earlyCard
    ? `可以先出卡，领先完整课 ${(rec.leadMs / 1000).toFixed(1)} 秒`
    : rec.sameTime
      ? `预览与完整课几乎同时到达（相差 ${rec.leadMs}ms），页面上看起来仍像等全部完成`
      : rec.noPreview
        ? '全程没有收到互动讲解卡预览'
        : (rec.error || '未完成');
  rec.verdict = verdict;
  log(`结论：${verdict} 总耗时${fmt(rec.totalMs)}`);
  return rec;
}

(async () => {
  const results = [];
  for (const item of CASES) {
    results.push(await runCase(item));
  }
  const report = {
    at: new Date().toISOString(),
    base: BASE,
    results: results.map(r => ({
      name: r.name,
      input: r.input,
      routedSubject: (r.preview && r.preview.subject) || (r.resultMeta && r.resultMeta.subject) || null,
      previewTitle: r.preview && r.preview.title,
      previewDescription: r.preview && r.preview.description,
      previewLatencyMs: r.preview && r.preview.latencyMs,
      resultTitle: r.resultMeta && r.resultMeta.title,
      model: r.resultMeta && `${r.resultMeta.provider || ''} ${r.resultMeta.model || ''}`.trim(),
      cached: r.resultMeta && r.resultMeta.cached,
      totalMs: r.totalMs,
      leadMs: r.leadMs,
      earlyCard: r.earlyCard,
      sameTime: r.sameTime,
      noPreview: r.noPreview,
      verdict: r.verdict,
      error: r.error,
      events: r.events
    }))
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n===== 汇总 =====');
  for (const r of report.results) {
    console.log(`${r.name}: ${r.verdict}`);
  }
  console.log(`日志已写入 ${OUT}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
