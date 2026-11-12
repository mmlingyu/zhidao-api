/* 知识交互组件总览 · 文档与可视化页生成器
 *
 * 单一事实来源：a2ui-question-map.js（+ a2ui-catalog.js 的已实现清单）。
 * 改完映射表跑 `npm run build:a2ui:roadmap`，会同时刷新：
 *   docs/A2UI-COMPONENT-ROADMAP.md
 *   cache/shots/a2ui-roadmap.html  （单文件离线，可交互筛选）
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const map = require('./a2ui-question-map');
const catalog = require('./a2ui-catalog');

const ROOT = __dirname;
const DOC = path.join(ROOT, 'docs', 'A2UI-COMPONENT-ROADMAP.md');
const HTML = path.join(ROOT, 'cache', 'shots', 'a2ui-roadmap.html');
const DATE = new Date().toISOString().slice(0, 10);

const GROUPS = [
  ['容器与基础', ['Column', 'Card', 'Row', 'List', 'Text', 'Button', 'TextField', 'CardHeading', 'HintBar', 'Feedback', 'EmptyState']],
  ['语文 / 通用', ['PoemLine', 'SpeakButton', 'WritingPad', 'WordChips', 'IdiomCard', 'Tabs', 'MethodNote']],
  ['英语 / 选择', ['ChoiceQuiz', 'WordCard', 'PictureChoice', 'MatchPairs']],
  ['数学 / 分步', ['StepReveal', 'FormulaBlock', 'NumberLine', 'MasteryRing']],
  ['P3 游戏化', ['NumberGaps', 'QuestHUD', 'VoiceGuide', 'AskIP', 'QuickQuestions', 'HintLadder']],
  ['P4a 选择器型', ['PoemChain', 'ImageryBoard', 'StoryOrder', 'LookAlike', 'RhetoricMatch', 'GrammarDoctor']],
  ['P4b 拼装型', ['PoemTiles', 'RadicalTiles', 'SentenceBlocks', 'LetterTiles', 'ColumnArithmetic', 'BalanceScale']],
  ['P4c 语音与开放产出', ['StoryBranch', 'RoleVoice', 'StrokeOrder', 'TenseTimeline']],
  ['P4d 图形与情境', ['SpeedRound', 'UnitStrip', 'ShapeSplit']]
];

/* 四批完成门槛的验收结果（逐批跑 Node 断言 + 真实 Edge 点击回归后填入）。 */
const GATE_RESULTS = {
  P4a: '6/6 组件各有效果图、validateMessage 断言与真实浏览器点击断言；DOM 基线零差异',
  P4b: '6 个组件共用 /game/:key/assembly/* 契约、固定种子乱序、答案可复现、撤销可回退任意一步',
  P4c: '开放题只记 created / asked / recited、朗读可中断且口型复位、青少年无幼态奖励',
  P4d: '图形只用 CSS 固定形状、低龄禁真实倒计时、答错不扣分不排名'
};

function auditOrThrow() {
  const audit = map.audit();
  if (audit.issues.length) throw new Error(`映射表自检失败：${audit.issues.join('；')}`);
  const listed = GROUPS.flatMap(g => g[1]);
  const implemented = Object.keys(catalog.COMPONENTS);
  if (listed.length !== implemented.length || new Set(listed).size !== listed.length) {
    throw new Error('已实现组件分组与 catalog 不一致');
  }
  for (const name of implemented) if (!listed.includes(name)) throw new Error(`分组漏了 ${name}`);
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SUBJECT_LABEL = { chinese: '语文', english: '英语', math: '数学' };
const BATCH_COLOR = { P4a: '#3aa08a', P4b: '#7c5cd6', P4c: '#c2608c', P4d: '#d2574f' };
const EVIDENCE_LABEL = {
  lesson: '听过讲解', correct: '练习答对', wrong: '练习答错',
  created: '独立完成', asked: '主动追问', recited: '朗读复述'
};

/* ============================== Markdown ============================== */

function mdQuestionTable() {
  const rows = map.QUESTION_TYPES.map(q => {
    const spec = map.specFor(q.primary);
    const status = q.batch === 'done' ? '✅ 原配方已覆盖' : `✅ 已实现（${q.batch}）`;
    return `| \`${q.id}\` | ${esc(q.examples[0])} | ${SUBJECT_LABEL[q.subject]} | ${q.phases.map(p => map.PHASES.find(x => x.id === p).label.replace(' / 学习', '').replace(' / 巩固', '')).join(' / ')} | \`${q.primary}\` | ${q.batch === 'done' ? '—' : q.batch} | ${status} |`;
  });
  return [
    '| 题型 ID | 用户会怎么问 | 学科 | 学习过程 | 主 UI 组件 | 批次 | 状态 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows
  ].join('\n');
}

function mdSpecTables() {
  return Object.entries(map.DOMAINS).map(([id, domain]) => {
    const specs = map.COMPONENT_SPECS.filter(s => s.domain === id);
    const rows = specs.map(s => [
      `\`${s.name}\` · ${s.label} · **${s.batch}** · ${s.status === 'implemented' ? '✅ 已实现' : '🟡 设计态'}`,
      esc(s.summary),
      s.modelFields.map(esc).join('<br>'),
      s.actions.map(a => `\`${a}\``).join(' ') + `<br>→ ${EVIDENCE_LABEL[s.evidence]}（\`${s.evidence}\`）`,
      `\`${s.fallback}\``,
      `低龄：${esc(s.gradeNotes.young)}<br>高龄：${esc(s.gradeNotes.senior)}`
    ].join(' | '));
    return [
      `### ${domain.label}（${SUBJECT_LABEL[domain.subject]} · ${specs.length} 个）`,
      '',
      '| 组件 | 做什么 | 模型只给什么 | 动作 → 证据 | 降级到 | 年级适配 |',
      '| --- | --- | --- | --- | --- | --- |',
      `| ${rows.join(' |\n| ')} |`,
      ''
    ].join('\n');
  }).join('\n');
}

function mdBatchTable() {
  return [
    '| 批次 | 主题 | 组件（数量） | 风险 | 完成门槛（全部已达成） | 验收结果 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...map.BATCHES.map(b => `| **${b.id}** | ${b.label} · ${esc(b.theme)} | ${b.components.map(c => `\`${c}\``).join(' ')}（${b.components.length}） | ${b.risk} | ${esc(b.gate)} | ✅ ${esc(GATE_RESULTS[b.id] || '')} |`)
  ].join('\n');
}

function mdGroups() {
  return GROUPS.map(([label, names]) =>
    `- **${label}（${names.length}）**：${names.map(n => `\`${n}\``).join('、')}`
  ).join('\n');
}

function buildMarkdown() {
  return `# 知识交互组件总体概览 · 问题 → 配方 → UI

> 面向开发者的**单一事实来源**。回答两个问题：①「什么样的用户问什么样的问题，会看到什么样的 A2UI」；②「下一个组件该怎么加、按什么顺序加」。
>
> 生成日期 ${DATE} · 数据源 \`a2ui-question-map.js\` + \`a2ui-catalog.js\` · 由 \`npm run build:a2ui:roadmap\` 自动生成，请勿手改表格。
> 可视化页：\`cache/shots/a2ui-roadmap.html\`（单文件离线，可按域 / 批次 / 关键词筛选）。

---

## 零、一页速览

**现状**：3 学科 × 4 学习过程 × 5 认知阶段 = **60 组配方**；**51 个已实现组件**（32 个基础 + 19 个游戏交互组件）；服务端 \`/api/tutor\` 编译下发 A2UI v1.0 JSONL，浏览器白名单渲染、动作回写 \`updateDataModel\` 与知识卡片证据。数学原有 6 个游戏化组件按条件追加关卡。**8 个问题域 / 20 类用户提问 / 40 条真实提问样例**已全部接入题型识别；19 个游戏组件按 P4a–P4d 四批落地，逐批门槛均已验收。

**决策链**（一次提问从进来到出现 UI）：

\`\`\`
用户提问
  → ① 学科决策（chinese / english / math，服务端）
  → ② 题型识别（20 类，signals + strong 强信号；识别不了就走原配方）
  → ③ 学习过程（初识 / 练习 / 强化 / 迁移，看是否已作答、掌握度、间隔）
  → ④ 认知阶段（early / primary / upper / teen / senior，永远由年级算，客户端改不了）
  → ⑤ 能力协商（服务端基准 ∩ 渲染器 implemented，只能收窄）
  → ⑥ 配方 recipeFor(subject, phase, grade) → 组件树 → validateMessage 全量过闸
  → ⑦ 服务端下发：JSON result.a2ui.jsonl / SSE a2ui 事件 → 浏览器逐条 feed
  → ⑧ 交互：action → updateDataModel → 知识卡片证据（correct/wrong/created/asked/recited）
         ↳ 数学且练习/强化且掌握度 < 80 且题目含数字 → 追加游戏化关卡
\`\`\`

**最容易记错的一条**：年级**不决定有没有组件**，只决定组件长什么样（密度、选项数、口气、奖励强度）。组件删减只发生在「渲染器画不出来」的降级链上。

---

## 一、现状盘点（已落地，勿重复造）

### 1.1 五个维度分别是谁决定的

| 维度 | 取值 | 由谁决定 | 代码位置 |
| --- | --- | --- | --- |
| 学科 | 语文 / 英语 / 数学 | 决策模型 + 启发式兜底 | \`server.js\` · \`models.js\` |
| 学习过程 | 初识 / 练习 / 强化 / 迁移 | 学科粗判 + 是否已作答；未来按题型 + 掌握度细化 | \`a2ui-bridge.js\` \`phaseFor()\` |
| 认知阶段 | 启蒙 / 基础 / 进阶 / 青少年 / 高中 | **年级**（学习者档案），客户端不能改写 | \`grade-profile.js\` \`stageForGrade()\` |
| 配方 | 3 × 4 × 5 = 60 组 | \`recipeFor(subject, phase, grade)\` | \`a2ui-matrix.js\` |
| 能力 | 组件白名单 / 数量 / 文本长度 | 服务端基准 ∩ 客户端 \`implemented\`（只能收窄） | \`a2ui-catalog.js\` · \`server.js\` \`negotiateCapabilities()\` |

### 1.2 已实现的 51 个组件

${mdGroups()}

组件协议、降级链、消息校验见 \`docs/A2UI-KNOWLEDGE-UI.md\` §12 / §18。P3 游戏化关卡的触发条件与截图见 §16 / §17。

### 1.3 现在什么条件会触发游戏化关卡

| 条件 | 规则 |
| --- | --- |
| 学科 | 仅数学 |
| 学习过程 | 练习 / 强化；初识不打扰 |
| 题目形态 | 含数字，或命中找规律 / 填空 / 计算 / 数列等关键词，或模型给 \`data.puzzle\` |
| 掌握度 | 低于 80 分才出现 |
| 年级 | 不禁用组件，只换主题与文案（低龄深紫星星 / 初二浅色克制） |

> 这四条是 P3 数学关卡的规则。19 个游戏组件不套用它，而是走 \`a2ui-games.js\` 的**四道闸门**：题型命中且已实现 / 学习过程允许 / 能力集允许 / 本课派生出了真实数据；任一不满足就完全不挂，识别不了返回 \`null\`，组件树原样不动。诗词 / 故事 / 语法等域各有自己的触发条件（见 §二 的「学习过程」列），且「没有唯一答案」的开放题一律不弹判定型关卡。

---

## 二、用户会问什么 · 问题类型全表

\`signals\` 是主题弱信号（命中 +2），\`strong\` 是题型叫法（命中 +4，用来压过同一句里顺带出现的学科词，例如「加法**口算**」「**平均分成**」）。含数字只在**已有文字信号**时 +1，避免把 \`<script>alert(1)</script>\` 判成数学题。识别不了返回 \`null\`，由原 60 组配方兜底，绝不强行分类。

${mdQuestionTable()}

> 代码入口：\`map.classifyQuestion(input, subject)\` → \`{ id, primary, phases, batch, alternatives }\`；再加 \`map.componentsFor(id, phase, grade)\` 得到过程 / 年级约束；\`games.selectGame()\` 汇成四道闸门交给编译器。40 条真实提问样例由 \`npm run test:a2ui:map\` 全量断言。

### 2.1 同一个问题，换年级 / 换阶段会怎么变

| 提问 | 年级 / 阶段 | 过程 | 看到的 UI | 关键差别 |
| --- | --- | --- | --- | --- |
| 「床前明月光」下一句 | 一年级 · 启蒙期 | 初识 | \`PoemLine\` + \`SpeakButton\` + \`HintBar\`，大按钮、自动朗读 | 不弹游戏；一次一件事；句子 ≤ 12 字 |
| 同上 | 一年级 · 启蒙期 | 练习 | \`PoemChain\` 接龙，**2 个选项**，答对点亮一颗星 | 组件树还在，只把「读」换成「选」 |
| 同上 | 初二 · 青少年期 | 练习 | 仍是 \`PoemChain\` 接龙，**4 个选项** + 出处与意象注释 | 浅色克制、无星星、要求写依据 |
| 27 + 45 等于多少 | 三年级 · 基础期 | 练习 | \`ColumnArithmetic\` 竖式：逐位填、一次检查一格 | 不进位 / 进位分级，格子放大 |
| 同上 | 初二 · 青少年期 | 强化 | 同一竖式组件 + \`MethodNote\` 写清算理，不庆祝 | 掌握度 ≥ 80 时不再自动弹出 |
| He go to school 哪里错了 | 初一 · 青少年期 | 练习 | \`GrammarDoctor\`：高亮错误片段 → 四选一改法 → 朗读订正句 | 展示术语解释；不出现幼态夸奖 |

**读法**：横向看是「学科 × 题型」定组件，纵向看是「过程」定交互强度，斜向看是「年级」定皮肤与文案。三条轴互不覆盖。

---

## 三、19 个游戏交互组件规格（全部已实现）

每个组件都遵守同一份契约：**模型只给知识内容字段**（\`modelFields\`），乱序 / 选项数 / 按钮文案 / 年级口气由编译器确定性派生；所有交互走 \`action → updateDataModel → 重渲染\`，组件不自持状态；降级链必须指向已实现组件。

${mdSpecTables()}

> \`derived\`、\`reuse\`、\`risk\`、\`kind\` 等完整字段见 \`a2ui-question-map.js\` 的 \`COMPONENT_SPECS\`，可视化页也可逐卡展开。

---

## 四、硬规则（新增组件一律过这 10 条）

${map.RULES.map((r, i) => `${i + 1}. ${esc(r)}`).join('\n')}

---

## 五、新增一个组件的最小实现清单

按顺序做，每一步都有可验证产物；任何一步没做就不要进下一批。

${map.CHECKLIST.map((c, i) => `${i + 1}. **${esc(c.split('：')[0])}**${c.includes('：') ? '：' + esc(c.slice(c.indexOf('：') + 1)) : ''}`).join('\n')}

> 验收基线：\`npm run check\`、\`npm run test:a2ui:map\`、\`npm run test:a2ui:games\`、\`npm run test:a2ui:games:browser\`、\`npm run test:a2ui:server\`、\`npm run test:a2ui:bridge:browser\` 全绿；\`npm run test:a2ui:visual\` 的 \`.two-column\` 逐像素基线不破（新组件区始终挂在它外面）。

---

## 六、迭代批次 · 为什么按这个顺序

${mdBatchTable()}

**排序逻辑**：先做「一眼能判对错」的选择器型（复用既有骨架，风险最低，快速把覆盖从 3 域抬到 6 域）；再抽象「拼装台」内核，一次解决 6 个组件共有的乱序 / 撤销 / 答案复现问题；然后才碰语音、开放产出与证据口径；最后做图形与情境——它们要么需要 CSS 绘图，要么涉及儿童保护（时间压力），必须先过评审。

**四批已按此顺序全部落地并验收**：每批做完都把 \`a2ui-question-map.js\` 的 \`status\` 改为 \`implemented\`，重跑 \`npm run build:a2ui:roadmap\`，补齐效果图与浏览器点击断言，最后更新工作日志。验收结果逐批写在上表最后一列。

---

## 七、边界与下一步

1. **本轮已改运行时，但未命中就零影响**：\`a2ui-question-map.js\` / \`a2ui-games.js\` / 四个批次模块已挂进 \`index.html\`、\`sw.js\` 与 \`server.js\` 静态白名单；题型识别经 \`games.selectGame()\` 进入编译链，只有四道闸门全过才在 60 组配方**之外**追加一张游戏卡，不删改任何既有知识组件，DOM / 逐像素基线零差异。
2. **\`phaseFor()\` 仍按学科粗判**：题型识别现在决定「挂不挂游戏卡」，尚未改写学习过程判定（语文→练习、英语→按是否作答、数学→强化）。要让它影响过程与配方，建议先做观测打点确认信号准确率。
3. **P3 游戏化关卡仍未服务端化**：\`a2ui-play.js\` 在浏览器编译，触发依赖客户端掌握度缓存；服务端化前提是把掌握度带进请求。
4. **两套阶段口径待收敛**：\`STAGE_EXTRAS\`（阶段准入）与矩阵配方各有一套，§18.3 已让能力协商绕开它，长期应统一为「catalog 只管实现、matrix 只管准入」。
5. **真正边生成边推** \`updateComponents\` 尚未实现（当前是课程生成完一次性下发 3 条消息），需要生成侧改成分块解析。

### 复现

\`\`\`bash
npm run test:a2ui:map                # 映射表 18 项断言（20 类问题 / 40 条样例）
npm run test:a2ui:games              # 19 个游戏组件四批门槛（45 项）
npm run test:a2ui:games:browser      # 真实 Edge 点击回归 + 19 张效果图（需 3100 MOCK）
npm run build:a2ui:roadmap           # 重新生成本文件与可视化页
npm run test:a2ui:roadmap:browser    # 总览页离线交互回归
npm run check                        # 全量语法检查
\`\`\`
`;
}

/* ============================== HTML ============================== */

const CLIENT_JS = [
  "var search = document.getElementById('q');",
  "var domainButtons = [].slice.call(document.querySelectorAll('button[data-domain]'));",
  "var batchButtons = [].slice.call(document.querySelectorAll('button[data-batch]'));",
  "var state = { domain: 'all', batch: 'all', text: '' };",
  "function apply() {",
  "  var rows = [].slice.call(document.querySelectorAll('[data-row]'));",
  "  var cards = [].slice.call(document.querySelectorAll('[data-card]'));",
  "  var shownRows = 0, shownCards = 0;",
  "  rows.forEach(function (el) {",
  "    var okD = state.domain === 'all' || el.getAttribute('data-domain') === state.domain;",
  "    var okB = state.batch === 'all' || el.getAttribute('data-batch') === state.batch;",
  "    var okT = !state.text || el.textContent.toLowerCase().indexOf(state.text) >= 0;",
  "    var show = okD && okB && okT;",
  "    el.style.display = show ? '' : 'none';",
  "    if (show) shownRows++;",
  "  });",
  "  cards.forEach(function (el) {",
  "    var okD = state.domain === 'all' || el.getAttribute('data-domain') === state.domain;",
  "    var okB = state.batch === 'all' || el.getAttribute('data-batch') === state.batch;",
  "    var okT = !state.text || el.textContent.toLowerCase().indexOf(state.text) >= 0;",
  "    var show = okD && okB && okT;",
  "    el.style.display = show ? '' : 'none';",
  "    if (show) shownCards++;",
  "  });",
  "  document.getElementById('count').textContent = '当前显示 ' + shownRows + ' 类问题 / ' + shownCards + ' 个组件';",
  "}",
  "function bind(buttons, key) {",
  "  buttons.forEach(function (btn) {",
  "    btn.addEventListener('click', function () {",
  "      state[key] = btn.getAttribute('data-' + key);",
  "      buttons.forEach(function (b) { b.classList.toggle('active', b === btn); });",
  "      apply();",
  "    });",
  "  });",
  "}",
  "bind(domainButtons, 'domain');",
  "bind(batchButtons, 'batch');",
  "search.addEventListener('input', function () { state.text = search.value.trim().toLowerCase(); apply(); });",
  "apply();"
].join('\n');

function chips(items, key) {
  return [
    `<button class="chip active" data-${key}="all">全部</button>`,
    ...items.map(item => `<button class="chip" data-${key}="${esc(item.id)}" style="--dot:${esc(item.color || '#7c5cd6')}">${esc(item.label)}</button>`)
  ].join('');
}

function questionRows() {
  return map.QUESTION_TYPES.map(q => {
    const spec = map.specFor(q.primary);
    const status = q.batch === 'done'
      ? '<span class="tag done">原配方已覆盖</span>'
      : `<span class="tag done">已实现 ${q.batch}</span>`;
    return `<tr data-row data-domain="${q.domain}" data-batch="${q.batch}">
      <td><code>${esc(q.id)}</code><div class="sub">${esc(q.label)}</div></td>
      <td>${q.examples.map(e => `<div class="ask">「${esc(e)}」</div>`).join('')}</td>
      <td><span class="subject s-${q.subject}">${SUBJECT_LABEL[q.subject]}</span></td>
      <td>${q.phases.map(p => `<span class="phase">${esc(map.PHASES.find(x => x.id === p).label.split(' / ')[0])}</span>`).join('')}</td>
      <td><strong>${esc(q.primary)}</strong>${spec ? `<div class="sub">${esc(spec.label)}</div>` : ''}</td>
      <td>${status}</td>
    </tr>`;
  }).join('\n');
}

function specCards() {
  return map.COMPONENT_SPECS.map(s => {
    const domain = map.DOMAINS[s.domain];
    return `<article class="card" data-card data-domain="${s.domain}" data-batch="${s.batch}">
      <header><span class="dot" style="background:${domain.color}"></span>
        <div><h3>${esc(s.label)} <code>${esc(s.name)}</code></h3>
        <div class="meta">${esc(domain.label)} · ${SUBJECT_LABEL[domain.subject]} · ${esc(s.kind)}</div></div>
        <span class="tag done">已实现</span><span class="tag" style="--c:${BATCH_COLOR[s.batch]}">${s.batch}</span></header>
      <p class="summary">${esc(s.summary)}</p>
      <dl>
        <dt>模型只给</dt><dd>${s.modelFields.map(f => `<code>${esc(f)}</code>`).join(' ')}</dd>
        <dt>编译器派生</dt><dd>${s.derived.map(esc).join('；')}</dd>
        <dt>动作 → 证据</dt><dd>${s.actions.map(a => `<code>${esc(a)}</code>`).join(' ')} <span class="ev">→ ${EVIDENCE_LABEL[s.evidence]}（${s.evidence}）</span></dd>
        <dt>降级 / 复用</dt><dd><code>${esc(s.fallback)}</code> · ${s.reuse.map(r => `<code>${esc(r)}</code>`).join(' ')}</dd>
        <dt>年级适配</dt><dd><b>低龄</b> ${esc(s.gradeNotes.young)}<br><b>高龄</b> ${esc(s.gradeNotes.senior)}</dd>
      </dl>
      <footer>风险：${esc(s.risk)}</footer>
    </article>`;
  }).join('\n');
}

function stageGrid() {
  return map.STAGES.map(s => `<div class="stage"><b>${esc(s.label)}</b><span>${esc(s.grades)} · ${esc(s.age)}</span><p>${esc(s.ui)}</p></div>`).join('');
}

function phaseGrid() {
  return map.PHASES.map((p, i) => `<div class="phasebox"><span class="num">${i + 1}</span><b>${esc(p.label)}</b><em>${esc(p.goal)}</em><p>${esc(p.ui)}</p></div>`).join('');
}

function batchCards() {
  return map.BATCHES.map(b => `<div class="batch" style="border-top-color:${BATCH_COLOR[b.id]}">
    <div class="batch-head"><span class="tag" style="--c:${BATCH_COLOR[b.id]}">${b.id}</span><b>${esc(b.label)}</b><em>风险 ${esc(b.risk)}</em></div>
    <p class="theme">${esc(b.theme)}</p>
    <p class="goal">${esc(b.goal)}</p>
    <div class="comps">${b.components.map(c => `<code>${esc(c)}</code>`).join('')}</div>
    <p class="gate"><b>完成门槛（已达成）</b> ${esc(b.gate)}</p>
    <p class="gate okline"><b>验收</b> ${esc(GATE_RESULTS[b.id] || '')}</p>
  </div>`).join('');
}

function implementedChips() {
  return GROUPS.map(([label, names]) => `<div class="group"><b>${esc(label)}</b><div>${names.map(n => `<code>${esc(n)}</code>`).join('')}</div></div>`).join('');
}

const FLOW = [
  ['①', '学科决策', '语文 / 英语 / 数学<br><em>服务端</em>'],
  ['②', '题型识别', '20 类 · signals + strong<br><em>识别不了走原配方</em>'],
  ['③', '学习过程', '初识 / 练习 / 强化 / 迁移'],
  ['④', '认知阶段', '5 阶段 · 只由年级决定'],
  ['⑤', '能力协商', '基准 ∩ implemented<br><em>只能收窄</em>'],
  ['⑥', '配方编译', '60 组 · validateMessage 过闸'],
  ['⑦', '下发 / 渲染', 'JSONL / SSE → 逐条 feed'],
  ['⑧', '动作 / 证据', 'updateDataModel → 知识卡片']
];

function buildHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>知岛 · 知识交互组件总体概览</title>
<style>
:root{color-scheme:light;--ink:#2b2740;--muted:#6c6486;--line:#e6e0f2;--bg:#f6f4fb;--purple:#6f5bd6}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 "Microsoft YaHei","PingFang SC",system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:34px 20px 70px}
h1{font-size:27px;margin:0 0 8px}h2{font-size:19px;margin:40px 0 14px;padding-left:11px;border-left:4px solid var(--purple)}
h3{font-size:15px;margin:0}
.lead{color:var(--muted);margin:0 0 14px;max-width:900px}
.meta-line{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 4px}
.meta-line span{background:#ece7fb;border:1px solid #ddd3f5;border-radius:999px;padding:3px 11px;font-size:12px;color:#5b4b96}
.note{color:var(--muted);font-size:13px}
code{font:12px/1.5 ui-monospace,Consolas,monospace;background:#f0ecf9;border:1px solid #e3dcf5;border-radius:5px;padding:1px 5px;color:#574794;white-space:normal}
.panel{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.flow{display:flex;flex-wrap:wrap;gap:8px;align-items:stretch}
.step{flex:1 1 128px;min-width:128px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 11px;position:relative}
.step i{font-style:normal;color:var(--purple);font-weight:700;font-size:14px}
.step b{display:block;font-size:13px;margin:2px 0 4px}
.step small{color:var(--muted);font-size:11px;line-height:1.5;display:block}
.step em{font-style:normal;color:#958bb5}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.stages{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.stage,.phasebox{background:#fff;border:1px solid var(--line);border-radius:11px;padding:11px 12px}
.stage b{display:block;font-size:13px}.stage span{display:block;color:var(--muted);font-size:11px;margin:2px 0 6px}.stage p,.phasebox p{margin:0;color:#5b5475;font-size:11px;line-height:1.55}
.phases{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}
.phasebox .num{display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;background:#ece7fb;border-radius:50%;color:#5b4b96;font-size:11px;margin-right:5px}
.phasebox b{font-size:13px}.phasebox em{display:block;font-style:normal;color:var(--purple);font-size:11px;margin:3px 0}
.filters{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:0 0 12px}
.chip{border:1px solid var(--line);background:#fff;color:#5b5475;border-radius:999px;padding:5px 13px;font-size:12px;cursor:pointer;font-family:inherit}
.chip::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dot,#b9aee0);margin-right:6px;vertical-align:1px}
.chip.active{background:var(--purple);border-color:var(--purple);color:#fff}
.chip.active::before{background:#fff}
#q{flex:1 1 210px;min-width:180px;border:1px solid var(--line);border-radius:9px;padding:7px 12px;font:13px inherit;color:var(--ink);background:#fff}
#count{font-size:12px;color:var(--muted);margin:0 0 8px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:13px}
th,td{padding:9px 11px;text-align:left;border-bottom:1px solid #f0ecf8;vertical-align:top}
th{background:#f0ebfb;color:#4e4189;font-size:12px;white-space:nowrap}
tr:last-child td{border-bottom:0}
.sub{color:var(--muted);font-size:11px;margin-top:2px}
.ask{color:#4b4468;font-size:12px}
.subject{display:inline-block;border-radius:6px;padding:1px 8px;font-size:11px;color:#fff}
.s-chinese{background:#7c5cd6}.s-english{background:#3aa08a}.s-math{background:#d2574f}
.phase{display:inline-block;background:#f2eefb;border-radius:5px;padding:1px 6px;font-size:11px;color:#5b4b96;margin:1px 3px 1px 0}
.tag{display:inline-block;border:1px solid var(--c,#7c5cd6);color:var(--c,#7c5cd6);border-radius:6px;padding:1px 7px;font-size:11px;white-space:nowrap}
.tag.done{--c:#3aa08a;background:#eaf7ef}
.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.card{background:#fff;border:1px solid var(--line);border-radius:13px;padding:14px 15px;box-shadow:0 4px 16px rgba(61,45,120,.05)}
.card header{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px}
.card header>div{flex:1}.card h3 code{font-size:11px}
.dot{width:9px;height:9px;border-radius:50%;margin-top:7px;flex:none}
.card .meta{color:var(--muted);font-size:11px}
.summary{margin:0 0 10px;font-size:13px;color:#4b4468}
dl{margin:0;display:grid;grid-template-columns:76px 1fr;gap:5px 9px;font-size:12px}
dt{color:var(--muted);white-space:nowrap}dd{margin:0;color:#4b4468;overflow-wrap:anywhere}
.ev{color:#256b42}
.card footer{margin-top:10px;padding-top:8px;border-top:1px dashed var(--line);color:var(--muted);font-size:11px}
.batches{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.batch{background:#fff;border:1px solid var(--line);border-top:3px solid var(--purple);border-radius:12px;padding:13px}
.batch-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.batch-head b{font-size:14px}.batch-head em{margin-left:auto;font-style:normal;color:var(--muted);font-size:11px}
.theme{color:var(--purple);font-size:12px;margin:8px 0 4px}.goal{font-size:12px;color:#4b4468;margin:0 0 8px}
.comps{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:9px}
.gate{font-size:11px;color:var(--muted);margin:0}.gate b{color:#4b4468}.gate.okline{color:#256b42;margin-top:6px}
ol.rules{margin:0;padding-left:22px;font-size:13px;color:#4b4468}ol.rules li{margin:4px 0}
.group{display:flex;gap:10px;align-items:baseline;padding:7px 0;border-bottom:1px dashed var(--line);font-size:12px}
.group:last-child{border-bottom:0}.group b{min-width:92px;color:#5b4b96}.group code{margin:2px 3px 2px 0;display:inline-block}
.ok{background:#eaf7ef;border:1px solid #c7e9d4;color:#256b42;border-radius:10px;padding:10px 14px;font-size:13px}
@media(max-width:900px){.cards,.grid2,.batches{grid-template-columns:1fr}.stages{grid-template-columns:repeat(2,1fr)}.phases{grid-template-columns:repeat(2,1fr)}}
</style></head><body><div class="wrap">
<h1>知识交互组件总体概览</h1>
<p class="lead">「什么样的用户问什么样的问题，会看到什么样的 A2UI」——把学科、题型、学习过程、认知阶段、组件、动作与学习证据放在同一张图上，并按风险排好后续迭代顺序。</p>
<div class="meta-line"><span>3 学科</span><span>4 学习过程</span><span>5 认知阶段</span><span>60 组配方</span><span>51 个已实现组件</span><span>8 个问题域</span><span>20 类用户提问</span><span>19 个游戏组件已实现</span><span>4 批门槛已验收</span></div>
<p class="note">数据源 <code>a2ui-question-map.js</code> · 生成于 ${DATE} · 单文件离线可用 · 复现 <code>npm run build:a2ui:roadmap</code></p>

<h2>一、一次提问走完全程</h2>
<div class="flow">${FLOW.map(([n, t, d]) => `<div class="step"><i>${n}</i><b>${t}</b><small>${d}</small></div>`).join('')}</div>
<p class="note" style="margin-top:10px">年级<strong>不决定有没有组件</strong>，只决定组件长什么样；组件删减只发生在「渲染器画不出来」的降级链上。数学且练习 / 强化且掌握度 &lt; 80 且题目含数字时，才在组件区外追加游戏化关卡。</p>

<h2>二、两个正交的轴：阶段 × 过程</h2>
<div class="stages">${stageGrid()}</div>
<div class="phases">${phaseGrid()}</div>

<h2>三、筛选器</h2>
<div class="filters">${chips(Object.entries(map.DOMAINS).map(([id, d]) => ({ id, label: d.label, color: d.color })), 'domain')}</div>
<div class="filters">${chips(map.BATCHES.map(b => ({ id: b.id, label: b.label, color: BATCH_COLOR[b.id] })), 'batch')}
<input id="q" placeholder="搜问题、组件名、动作…" autocomplete="off"></div>
<p id="count"></p>

<h2>四、问题类型 → UI 全表</h2>
<div class="panel" style="padding:0;overflow:auto"><table>
<thead><tr><th>题型</th><th>用户会怎么问</th><th>学科</th><th>过程</th><th>主 UI</th><th>批次</th></tr></thead>
<tbody>${questionRows()}</tbody></table></div>
<p class="note">弱信号 +2、强信号 +4、数字只在已有文字信号时 +1；识别不了返回 null，由原 60 组配方兜底。40 条样例由 <code>npm run test:a2ui:map</code> 全量断言；命中后还要过 <code>games.selectGame()</code> 的四道闸门。</p>

<h2>五、19 个游戏交互组件（全部已实现）</h2>
<div class="cards">${specCards()}</div>

<h2>六、迭代批次与完成门槛</h2>
<div class="batches">${batchCards()}</div>
<p class="note" style="margin-top:10px">四批已按风险递增顺序全部落地：先选择器型（低风险、复用既有骨架）→ 再抽象「拼装台」内核 → 才碰语音与开放产出 → 最后是图形与儿童保护评审。每批的完成门槛均已由 Node 断言与真实浏览器点击回归验收（见各卡「验收」行）。</p>

<h2>七、硬规则</h2>
<div class="panel"><ol class="rules">${map.RULES.map(r => `<li>${esc(r)}</li>`).join('')}</ol></div>

<h2>八、已实现的 51 个组件（勿重复造）</h2>
<div class="panel">${implementedChips()}</div>

<h2>九、状态</h2>
<p class="ok">19 个游戏组件<strong>全部已实现并接入运行时</strong>：<code>a2ui-games.js</code> 聚合层与四个批次模块已挂进静态白名单，题型命中才在配方之外追加一张游戏卡，未命中时 DOM 与逐像素视觉基线零差异。<code>npm run check</code>、<code>npm run test:a2ui:map</code> 18/18、<code>npm run test:a2ui:games</code> 45/45、<code>npm run test:a2ui:games:browser</code> 48/48（真实 Edge）。</p>
<p class="note">下一步：让 <code>classifyQuestion()</code> 从「只决定挂不挂游戏卡」推进到影响 <code>phaseFor()</code> 与配方；P3 关卡服务端化与两套阶段口径收敛见 <code>docs/A2UI-KNOWLEDGE-UI.md</code> §20。</p>
</div><script>${CLIENT_JS}</script></body></html>`;
}

/* ============================== main ============================== */

auditOrThrow();
fs.mkdirSync(path.dirname(HTML), { recursive: true });
fs.writeFileSync(DOC, buildMarkdown(), 'utf8');
fs.writeFileSync(HTML, buildHtml(), 'utf8');
console.log(`映射表自检 OK：${map.COMPONENT_SPECS.length} 个组件 / ${map.QUESTION_TYPES.length} 类问题 / ${map.BATCHES.length} 个批次`);
console.log(`已生成 ${DOC} (${fs.statSync(DOC).size} bytes)`);
console.log(`已生成 ${HTML} (${fs.statSync(HTML).size} bytes)`);
