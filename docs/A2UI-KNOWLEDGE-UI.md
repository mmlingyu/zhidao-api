# 知岛 · A2UI 选型分析与「知识 → 交互组件」落地方案

> 调研时间：2026-11-11 · 来源：GitHub 仓库搜索 `q=a2ui`、A2UI v1.0 规范、CopilotKit generative-ui 对比仓库
> 关联文档：[知识卡片与年级适配](KNOWLEDGE-CARDS.md)、[移动端方案](MOBILE.md)
> **进度：P0 试点 + 学科组件矩阵 + 主流程桥接 + 服务端化 P1 均已落地并全量回归通过。实现与验收数据见 [§12](#十二p0-落地实录2026-11-11)、[§13](#十三学科组件矩阵知识--过程--认知阶段2026-11-11-追加)、[§14](#十四交互案例截图与差别在哪)、[§17](#十七主流程打通知识展示--a2ui2026-11-11-追加) 与 [§18](#十八服务端化-p1编译器搬进服务端2026-11-12)；14 张实测截图见 `cache/shots/a2ui-cases.html`。**

---

## 一、结论先行

**采用 A2UI 的「协议 + 组件目录（catalog）」思想，但不引入官方渲染器；在本项目零构建的前端里自研一个轻量 renderer，让服务端把现有课程 JSON 确定性编译成 A2UI 消息流。**

三条硬判断：

1. **不让 LFM3-1.7B 写 UI。** 本项目的小模型连数学题的合法 JSON 都需要 `models.js` 自愈，直接让它生成组件树必然崩。A2UI 在本项目里的定位是**渲染层协议**，不是模型输出格式。模型继续只产出教学内容（`idioms` / `poems` / `quizzes` / `methods`），由服务端编译器翻译成组件。
2. **不引入 React / Lit / Angular 渲染器。** 项目是 Node 原生静态服务 + 原生 JS 单文件，`package.json` 无前端构建、无打包器，PWA 靠 `sw.js` 白名单预缓存。官方 `@a2ui/react` / `@a2ui/lit` 会带来构建链、包体和移动端首屏成本。
3. **最该借的是「catalog 能力协商」。** 今天修掉的 bug（诗文生成了却被 CSS 藏起来）根因是**生成侧和展示侧用了两套标准**：模型给了 `poems`，`knowledge.css` 却按年级 `display:none`。A2UI 让 renderer 先声明「本年级只允许这些组件」，模型根本不会生成不允许的组件——把适龄约束从 CSS 提升为协议级约束。

一句话：**A2UI 对本项目的价值不是「让模型画界面」，而是「把散落在 `models.js` / `dynamic.js` / `knowledge.css` 里的三套隐性约定，收敛成一份可协商、可校验、可流式传输的组件协议」。**

---

## 二、GitHub 搜索结果盘点

按 star 与相关性筛选出与本项目有关的仓库（截至 2026-11-11）：

| 仓库 | Star | 定位 | 对本项目的用法 |
| --- | ---: | --- | --- |
| [a2ui-project/a2ui](https://github.com/a2ui-project/a2ui) | 17.1k | **官方**：v1.0 协议 + Agent SDK + React/Lit/Angular/Flutter/SwiftUI/Jetpack Compose 渲染器，Apache-2.0 | **借规范与 catalog 设计**，不整体引入；规范即事实标准 |
| [AGenUI/AGenUI](https://github.com/AGenUI/AGenUI) | 1.2k | C++ 原生渲染器：iOS / Android / HarmonyOS，流式 | 移动端从 PWA 转原生时的首选，同一消息流可复用 |
| [CopilotKit/generative-ui](https://github.com/CopilotKit/generative-ui) | 882 | AG-UI / A2UI / MCP Apps 三种生成式 UI 对比样例 | 选型参考；**注意其示例用的是旧版消息名**（见 §3.3） |
| [MindLab-Research/macaron-artifacts](https://github.com/MindLab-Research/macaron-artifacts) | 298 | Token 高效的 TSX GenUI | 思路可参考，但执行代码违背本项目的儿童内容安全要求 |
| [shawnwang15/a2ui-vue](https://github.com/shawnwang15/a2ui-vue) / [vkfolio/a2ui-vue](https://github.com/vkfolio/a2ui-vue) | 101 / 60 | Vue 3 渲染器 | 本项目无 Vue，不适用 |
| [Disdjj/intelligent-ui-demo](https://github.com/Disdjj/intelligent-ui-demo) | 35 | 中文；流式 DSL 编译器 + iframe/Worker 沙箱，对照 AG-UI/A2UI | **与本项目 SSE 分阶段流式最接近**，可借鉴编译器分层 |
| [YuniqueUnic/a2ui-ask](https://github.com/YuniqueUnic/a2ui-ask) | 27 | 结构化问题 → 浏览器表单（JSON Schema） | **出题/练习组件**的直接参考 |
| [easyops-cn/a2ui-sdk](https://github.com/easyops-cn/a2ui-sdk) | 39 | TypeScript A2UI SDK | 自研 renderer 时的参考实现 |
| [southleft/a2ui-bridge](https://github.com/southleft/a2ui-bridge) | 30 | 框架适配 + 设计系统接入 | 自定义 catalog 与设计系统对齐的参考 |
| [mgechev/a2ui-debugger](https://github.com/mgechev/a2ui-debugger) | 23 | 消息流调试器 | 开发期调试消息流可用 |
| [lmee/A2UI-Android](https://github.com/lmee/A2UI-Android) / [a2ui-react-native](https://github.com/sivamrudram-eng/a2ui-react-native) / [a2ui-kmp](https://github.com/BinaryTape/a2ui-kmp) / [a2ui-swift](https://github.com/BBC6BAE9/a2ui-swift) | 80/30/46/68 | 各端渲染器 | 移动端路线储备 |
| [webllm/renderify](https://github.com/webllm/renderify) | 33 | 浏览器运行时直接执行 LLM 生成的 JSX/TSX，无构建 | **不采用**：零构建很诱人，但执行模型生成代码 = 内容安全与 XSS 风险，儿童产品不可接受 |
| [Muvon/octoweb](https://github.com/Muvon/octoweb)、[ghostapp-ai/ghost](https://github.com/ghostapp-ai/ghost)、[eCan.ai](https://github.com/scszcoder/eCan.ai) 等 | — | Agent OS / 电商 / 浏览器，只是把 a2ui 当 topic | 与本项目无关 |

**适配度排序**：官方协议规范 ≫ `a2ui-ask`（练习组件）+ `intelligent-ui-demo`（流式编译）> `a2ui-sdk` / `a2ui-bridge`（参考实现）> 各端渲染器（未来）> 其余。

### 三种生成式 UI 怎么选（CopilotKit 的光谱）

| 模式 | UI 交付 | 控制力 | 本项目判断 |
| --- | --- | --- | --- |
| Controlled（AG-UI + `useFrontendTool`） | 开发者预建组件，Agent 只选组件 + 传数据 | 最高 | 太死板：加一种知识形态要发版 |
| **Declarative（A2UI / Open-JSON-UI）** | Agent 返回结构化 UI 描述，前端按 schema 渲染 | 共享 | ✅ **选它**：流式、跨平台、组件白名单、样式统一 |
| Open-ended（MCP Apps / iframe / raw HTML） | 完整 UI surface，前端只是容器 | 最低 | ❌ 安全/性能/样式一致性风险，且依赖 Web runtime，儿童产品不适用 |

补充：AG-UI 是**底层双向运行时连接层**，与 A2UI 不是互斥关系；本项目已有自己的 SSE + REST 通道，暂不需要再引 AG-UI。

---

## 三、A2UI v1.0 协议要点（实现前必须知道）

### 3.1 消息流是 JSONL，天然适配本项目已有的 SSE

Agent → Renderer 的每条消息是**恰好一个顶层键**的 JSON 对象：

| 消息 | 作用 | 本项目的对应时机 |
| --- | --- | --- |
| `createSurface` | 新建 surface，可单条自带 `components` + `dataModel`，并开始渲染 | 学科决策完成，先出骨架 |
| `updateComponents` | 扁平组件表，靠 `id` 引用组成树，必须有一个 `id:"root"` | 讲解生成过程中逐块到达 |
| `updateDataModel` | 按 JSON Pointer（RFC 6901）`path` 更新数据，`value:null` 删除 | 内容解析完成 / 答题后更新掌握度 |
| `deleteSurface` | 删除 surface | 切换知识点 / 切换年级 |
| `callRendererFunction` / `agentFunctionResponse` | 双向函数 RPC（v1.0 新增） | 朗读、庆祝、上报证据 |

Renderer → Agent 走**单独返回通道**的 `action` 消息：

```json
{ "id": "submit_button", "component": "Button", "child": "submit_label",
  "action": { "event": { "name": "submitWriting", "context": { "word": {"@path": "/practice/word"} } } } }
```

### 3.2 数据与 UI 分离

```json
{ "version": "1.0",
  "createSurface": {
    "surfaceId": "lesson_chinese_01",
    "catalogId": "urn:zhidao:catalog:knowledge:v1",
    "components": [
      { "id": "root", "component": "Column", "children": ["poem_hint"] },
      { "id": "poem_hint", "component": "HintBar", "text": {"@path": "/hints/poems"} }
    ],
    "dataModel": { "hints": { "poems": "点右边的小喇叭，听一句，跟着读一句。" } }
  }
}
```

动态绑定统一用 `@` 前缀：`{"@path":"/lesson/poems"}`，函数调用 `{"@call":"speak","args":{...}}`，列表模板里 `{"@call":"@index"}` 取下标。普通数据的 `@` 前缀要写成 `@@`。**组件树是扁平的邻接表，可以乱序到达、渐进渲染**——这正是「先骨架、后内容」想要的。

Basic Catalog 提供 `Text / Image / Icon / Row / Column / List / Card / Tabs / Divider / Modal / Button / CheckBox / TextField / DateTimeInput / ChoicePicker / Slider / Video / AudioPlayer`；自定义 catalog 通过 `catalogId` 混入，组件名与实例 ID 必须满足 UAX #31（`^[\p{XID_Start}_][\p{XID_Continue}]*$`，即不能有连字符）。

### 3.3 ⚠️ 一个真实的坑：v1.0 改了消息名

CopilotKit 的示例仓库、不少博客仍在用 **旧版**名字：`surfaceUpdate` / `dataModelUpdate` / `beginRendering`。**官方 v1.0 规范已改名**为 `updateComponents` / `updateDataModel` / `createSurface`，并新增 `agent_to_renderer` / `renderer_to_agent` 信封。照抄旧示例会写出解析不了的 renderer。实现时以 [v1.0 规范](https://a2ui.org/specification/v1.0-a2ui/) 为准。

---

## 四、本项目其实已经有「半个 A2UI」

| A2UI 概念 | 本项目现状 | 差距 |
| --- | --- | --- |
| catalog / schema | `models.js` 的 `LESSON_SCHEMAS`（语文/英语/数学三套字段约定） | 是提示词里的自然语言，**不是可校验的 catalog JSON**，模型可自由发挥字段名 |
| Agent 输出 | 模型输出课程 JSON → `validateLesson` + `normalizeCounts` 校验/补齐 | 已有校验与自愈，等价于「服务端编译」的前半段 |
| Transport | `/api/tutor` 的 SSE `stageEvents`（决策 → 讲解，严格串行 + 各自耗时） | 只传进度事件，**不传 UI 消息**；内容仍是整块 JSON 一次性返回 |
| Renderer | `dynamic.js` 的 `renderDynamicChinese/English/Math` 手写模板 | 组件与模板写死，新增知识形态要改 5 处 |
| Data model | `state.dynamic.data` | 无 JSON Pointer 绑定，靠模板字符串插值 |
| Action 回传 | 散落在 `dynamic.js` / `app.js` 的 `window.KNOWLEDGE.record(...)` | 没有统一事件通道，漏报难发现 |
| 能力协商 | `grade-profile.js` 五个阶段 + `knowledge.css` 的 `[data-stage]` | **用 CSS 隐藏内容来「减负」，正是今天 bug 的来源** |
| 缓存 | Redis / 本地 JSON，`CACHE_VERSION` + 年级进缓存键 | 缓存的是内容，不是消息流 |

所以这不是「从零引入一个新框架」，而是**把已有的隐性协议显式化、标准化**。

---

## 五、关键设计：服务端确定性编译器

```
用户输入
   │
   ▼
学科决策（Liquid systemone，< 1s）  ── SSE: route 事件 ──► 进度条
   │
   ▼
讲解模型（LFM3-1.7B / Qwen）只输出「教学内容 JSON」
   │  models.js: parseModelJson → repairModelJson → validateLesson → normalizeCounts
   ▼
★ compileLessonToA2UI(lesson, stage, hints)   ← 纯函数，零模型参与
   │  读 catalog：按年级决定允许哪些组件
   │  把 idioms/poems/quizzes/methods 翻译成组件表
   │  把文案、状态、掌握度填进 dataModel
   ▼
SSE 逐条输出 A2UI JSONL 消息流
   │  createSurface（骨架）→ updateComponents（分块）→ updateDataModel（数据）
   ▼
a2ui-render.js（浏览器，零依赖）
   │  白名单校验 → 绑定 @path → 生成 DOM → 绑定 action
   ▼
用户交互 → POST /api/a2ui/action → 证据上报 / 继续生成 → updateDataModel
```

**为什么必须放在服务端**：年级画像、掌握度、成语真实性词表（2.95 万条）、数量归一化都在服务端；让浏览器或模型去拼组件树，等于把这些约束重新散出去。编译器是纯函数，可单测、可缓存、可灰度。

---

## 六、「知识 → 丰富交互组件」目录设计

自定义 catalog `urn:zhidao:catalog:knowledge:v1`。组件按**认知动作**分类，而不是按页面区块分类——这样才能让同一知识点在不同年级换一种「做学问的方式」。

| 组件 | 承载的知识 | 交互 | 现有对应 |
| --- | --- | --- | --- |
| `HintBar` | 年级化操作提示 | 纯展示 + 朗读 | 本轮新增的 `.stage-hint` |
| `IdiomCard` | 成语：词/拼音/释义/例句/表达强度 | 点选切换、点读例句 | `.idiom-card` |
| `PoemLine` | 诗句、出处、意象标签 | 单句朗读、跟读、划节奏 | `.poem-item` + `.poem-read` |
| `WritingPad` | 仿写任务 | 词芯片、输入、按年级的最短字数、即时反馈 | `.practice-card` |
| `ChoiceQuiz` | 英语辨析、数学判断 | 选项、对错反馈、下一题 | `.choice-button` |
| `StepReveal` | 数学分层思路 | 「展开下一步」线性解锁 | `.steps` + `#ai-next-step` |
| `FormulaBlock` | 公式 / 竖式 | 高亮、逐步替换变量 | `.math-formula` |
| `WordCard` | 英语词卡、音标、例句 | 点读、跟读 | `.grammar-card` |
| `PictureChoice` | 低年级具象选择 | 大图点按，无文字门槛 | 暂无（新增） |
| `MatchPairs` | 词—义 / 诗句—出处配对 | 连线、拖拽 | 暂无（新增） |
| `NumberLine` | 数轴、分数、加减 | 拖动、跳格 | 暂无（新增） |
| `MasteryRing` | 知识卡片掌握度 | 点击翻卡看证据时间线 | `.zk-card` |
| `SpeakButton` | 任意文本朗读 | 调 `speak()` + IP 口型同步 | `[data-speak]` |

**Renderer Functions（`@call`，服务端可调用，白名单注册）**

| 函数 | 作用 | 复用现有能力 |
| --- | --- | --- |
| `speak(text, rate)` | 朗读 + 口型同步 | `app.js bindSpeech()` / `mascot.js` |
| `celebrate(level)` | 视觉/听觉/心理三层反馈 | `feedback.js` |
| `recordEvidence(type, payload)` | 学习证据上报 | `/api/cards/record` |
| `openPoint(point)` | 跳到某知识点开讲 | `curriculum.js` + `startLesson()` |

**Action Events（Renderer → Agent）**：`answer` / `write` / `readPoem` / `nextStep` / `switchGrade` / `flipCard`。每一类直接映射到 `knowledge.js` 的 `EVIDENCE_TYPES`，彻底替代散落的 `window.KNOWLEDGE.record(...)`。

### 具体示例：本轮修的「诗文与名句 + 试着写一句」

一年级（`stage=early`，catalog 只允许 `HintBar / PoemLine / SpeakButton / WritingPad / PictureChoice`）：

```jsonl
{"version":"1.0","createSurface":{"surfaceId":"lesson_kx_01","catalogId":"urn:zhidao:catalog:knowledge:v1","sendDataModel":true,"components":[{"id":"root","component":"Column","children":["poem_hint","poem_list","write_hint","write_pad"]},{"id":"poem_hint","component":"HintBar","text":{"@path":"/hints/poems"}},{"id":"poem_list","component":"List","children":{"path":"/lesson/poems","componentId":"poem_tpl"}},{"id":"poem_tpl","component":"PoemLine","text":{"@path":"text"},"source":{"@path":"source"},"tag":{"@path":"tag"}},{"id":"write_hint","component":"HintBar","text":{"@path":"/hints/writing"}},{"id":"write_pad","component":"WritingPad","title":{"@path":"/practice/title"},"placeholder":{"@path":"/practice/placeholder"},"minLength":{"@path":"/practice/minLength"},"button":{"@path":"/practice/button"}}],"dataModel":{"hints":{"poems":"点右边的小喇叭，听一句，跟着读一句。","writing":"不用写字：选一个词，说一句话给爸爸妈妈听，说完点「我说好啦」。"},"practice":{"title":"说一句","button":"我说好啦","minLength":1}}}}
{"version":"1.0","updateDataModel":{"surfaceId":"lesson_kx_01","path":"/lesson/poems","value":[{"text":"读书破万卷，下笔如有神。","source":"唐 · 杜甫","tag":"积累"},{"text":"问渠那得清如许？为有源头活水来。","source":"宋 · 朱熹","tag":"思考"}]}}
```

同一个知识点切换到初二（`stage=teen`）：`rendererCapabilities` 改为允许 `Tabs / ChoiceQuiz / MasteryRing`，catalog 里 `WritingPad` 换成 `WritingPad` + `MethodNote`，`hints` 由 `grade-profile.js` 提供「分析手法 + 迁移仿写」，组件树**不用改一行前端代码**。这就是把知识转换成丰富交互 UI 的核心机制：**知识不变，组件与数据模型随年级、掌握度、学科重新编排。**

---

## 七、年级画像升级为 catalog 能力协商

现在 `grade-profile.js` 的 `ui.showPoems / showWriting` 是给 CSS 用的布尔开关，`knowledge.css` 再用 `[data-stage="early"] .poem-list { display:none }` 把内容藏掉——**生成了却不给看**。

改成协议级约束：

```
浏览器启动时发送 rendererCapabilities：
  { stage: "early", catalogs: ["urn:zhidao:catalog:knowledge:v1"],
    components: ["HintBar","PoemLine","SpeakButton","WritingPad","PictureChoice"],
    maxComponents: 6, textMaxLength: 12 }

服务端 compileLessonToA2UI() 按这份能力裁剪：
  - 组件不在白名单 → 不生成，改用允许的等价组件（如 Tabs → 线性 StepReveal）
  - 超长诗句 → 走 PoemLine 的短句模板，而不是让 CSS 截断
  - 低年级 minLength=1，青少年 minLength=20
```

好处：
- **根治今天这类 bug**：不允许的组件根本不会出现在消息流里，不存在「有数据但被藏」。
- 适龄从「事后裁剪」变成「事前约束」，模型提示词也不用再写「不要生成 XX」。
- 与 `docs/KNOWLEDGE-CARDS.md` 里的五阶段画像共用同一份 `grade-profile.js`，不新增标准。

---

## 八、与现有链路的衔接点（改动清单）

| 现有文件 | 改动 | 风险 |
| --- | --- | --- |
| `models.js` | 保持不变。新增 `a2ui-compiler.js` 消费其校验后的课程 JSON | 零风险，纯新增 |
| `server.js` | 新增 `/api/a2ui/stream`（SSE 输出 JSONL）与 `/api/a2ui/action`；`/api/tutor` 旧 JSON 响应保留 | 需兼容 `stageEvents` 进度事件与缓存键（年级 + catalog 版本） |
| `cache.js` / Redis | 缓存编译后的 JSONL 序列，键加 `uiVersion` | 复用现有双层存储 |
| `a2ui-render.js`（新增） | 解析 4 类消息 + `@path` 绑定 + 组件白名单 + action 注册，约 300 行，零依赖 | 白名单必须严格；所有文本走 `escapeHTML` |
| `knowledge.css` | 组件样式收敛到 catalog 对应类名，删掉 `[data-stage] ... display:none` 内容型规则 | 本轮已删掉 `.poem-list` / `.practice-input` / `.filter-pills` |
| `dynamic.js` | 逐步把三个 `renderDynamic*` 替换为 `renderSurface()`；证据上报改由 action 统一分发 | 可分模块灰度，先语文 |
| `index.html` / `sw.js` | 静态白名单与预缓存登记新文件，`sw.js` 升版本 | 已有先例 |
| `test-knowledge.js` | 新增编译器单测：组件白名单、年级裁剪、消息顺序、XSS 转义 | 已有 46 项 |

**安全底线**（儿童产品）：
- 组件白名单 + schema 校验，模型输出永远不解释为 HTML/JS；
- 所有动态文本 `escapeHTML`，`data-speak` 属性同样转义；
- 禁止 `Image` / `Video` 直接加载模型给出的外链，只允许站内资源或经服务端代理校验过的 URL；
- `callRendererFunction` 只允许上表 4 个函数，`openUrl` 之类需要用户手势且默认关闭。

---

## 九、分阶段落地路线

| 阶段 | 目标 | 验收 |
| --- | --- | --- |
| **P0 · 试点（✅ 已完成，见 §12）** | 只把语文「诗文与名句 + 试着写一句」两个模块用自定义 catalog 描述；`a2ui-compiler.js` + `a2ui-render.js` 最小实现，服务端仍走 `/api/tutor` 返回 JSON，浏览器本地编译渲染 | 一年级 / 初二 DOM·样式·像素三项零差异；`test:a2ui` 32、`test:a2ui:browser` 30、`test:knowledge` 46 全绿 |
| **P1 · 流式** | `/api/a2ui/stream` 输出 JSONL，决策完成即 `createSurface` 出骨架，讲解分块 `updateComponents` | 决策耗时 < 1s 且骨架已可见；进度条仍严格串行 |
| **P2 · 动作统一** | `action.event` 统一回传，删除散落的 `KNOWLEDGE.record`；家长知识库卡片墙也用同一 surface 渲染 | 答题 → 卡片状态流转端到端通过；无重复/漏报证据 |
| **P3 · 能力协商** | 年级 catalog 协商上线，删除 CSS 里的内容隐藏规则 | 一年级不会出现 `Tabs/FormulaBlock`；切换年级消息流随之变化 |
| **P4 · 多端** | 同一消息流喂给 AGenUI / Flutter GenUI 原生渲染器 | 移动端与 Web 呈现一致 |

**P0 是刻意保守的**：先在最熟悉、刚修过的模块上验证协议等价性，不碰 SSE、不动缓存、不引依赖，失败可随时回退。

---

## 十、不做什么

- ❌ 不让小模型直接生成组件树（LFM3-1.7B 可靠性不足，且会给儿童界面带来不可控内容）。
- ❌ 不引入 React/Lit/Angular 渲染器与打包链（破坏零构建 + PWA 轻量外壳）。
- ❌ 不采用 MCP Apps / iframe / raw HTML（儿童内容安全、样式一致性、Web 依赖）。
- ❌ 不采用 `webllm/renderify` 这类「运行时执行 LLM 生成代码」的方案，即使它零构建。
- ❌ 不照抄 CopilotKit 样例里的 `surfaceUpdate` / `beginRendering` 旧消息名。
- ❌ 不把 A2UI 当成替换现有 `models.js` 的理由：成语真实性校验、数量归一化、自愈链路已经很值钱，保留。

---

## 十一、参考

- 官方仓库与协议：<https://github.com/a2ui-project/a2ui> · <https://a2ui.org/specification/v1.0-a2ui/>
- 三种生成式 UI 对比：<https://github.com/CopilotKit/generative-ui>
- 中文流式 DSL 实现参考：<https://github.com/Disdjj/intelligent-ui-demo>
- 结构化出题组件参考：<https://github.com/YuniqueUnic/a2ui-ask>
- 原生移动渲染器：<https://github.com/AGenUI/AGenUI>
- 本项目现状：[KNOWLEDGE-CARDS.md](KNOWLEDGE-CARDS.md) · [MOBILE.md](MOBILE.md) · `models.js` · `grade-profile.js` · `dynamic.js`

---

## 十二、P0 落地实录（2026-11-11）

**状态：已完成并全量回归通过。** 本节记录实际实现与验收数据，供 P1 接着做。

### 12.1 交付的文件

| 文件 | 职责 | 行数级别 |
| --- | --- | --- |
| `a2ui-catalog.js` | UMD 前后端共用：`VERSION` / `CATALOG_ID`、23 个组件 schema、组件 id 的 UAX #31 校验、`validateMessage()`、`rendererCapabilities()`、`fallbackFor()`、JSON Pointer 与 `@path` 解析 | 协议层，零 DOM |
| `a2ui-compiler.js` | 纯函数 `compileLessonToA2UI(lesson, { grade, capabilities })`：课程 JSON → 三条 v1.0 消息；能力裁剪与降级；`compileToJSONL()` | 编译器，零 DOM / 零 window |
| `a2ui-render.js` | `createSurface(container)`：消息过闸 → 合并组件表与 dataModel → 白名单组件生成 DOM → 容器级 action 委托；4 个 renderer function | 渲染器，零依赖 |
| `test-a2ui.js` | 协议 / catalog / 编译器 32 项断言 | 纯 Node |
| `test-a2ui-browser.js` | 真实 Edge 交互回归 30 项 | 需 MOCK 服务 |
| `test-a2ui-visual.js` | 改造前后 DOM / 计算样式 / 截图像素对比 | 需 MOCK 服务 |

改动：`app.js`（抽出 `speakText()` 并挂 `window`）、`dynamic.js`（语文两栏目交给 surface，新增 `handleChineseA2UIAction`）、`index.html`（脚本顺序）、`server.js`（静态白名单）、`sw.js`（升 v4、预缓存、`ignoreSearch` 离线回退）、`package.json`、`README.md`。

### 12.2 真实消息流

编译器对同一份课程输出三条消息（JSONL，每行一条），P1 可以直接逐行塞进 SSE：

```jsonl
{"version":"1.0","createSurface":{"surfaceId":"zhidao_chinese_early","catalogId":"urn:zhidao:catalog:knowledge:v1","meta":{"stage":"early","uiVersion":"p0","componentCount":11},"components":[{"id":"root","component":"Column","className":"two-column","children":["poems_card","writing_card"]},{"id":"poem_hint","component":"HintBar","text":{"@path":"/hints/poems"}},{"id":"poem_read_all","component":"SpeakButton","text":{"@path":"/lesson/poemSpeech"},"action":{"event":{"name":"readAll","context":{"text":{"@path":"/lesson/poemSpeech"}}}}},"…"],"dataModel":{"hints":{"poems":"点右边的小喇叭，听一句，跟着读一句。"},"lesson":{"poems":[],"poemSpeech":"…"},"practice":{"minLength":1,"words":[{"word":"触景生情"}],"text":"","word":"触景生情"}}}}
{"version":"1.0","updateComponents":{"surfaceId":"zhidao_chinese_early","components":[{"id":"poem_list","component":"List","children":{"path":"/lesson/poems","componentId":"poem_tpl"}},{"id":"poem_tpl","component":"PoemLine","text":{"@path":"text"},"speakAction":{"event":{"name":"readPoem","context":{"text":{"@path":"text"}}}}}]}}
{"version":"1.0","updateDataModel":{"surfaceId":"zhidao_chinese_early","path":"/lesson/poems","value":[{"text":"读书破万卷，下笔如有神。","source":"唐 · 杜甫","tag":"积累"}]}}
```

三条消息覆盖三种消息类型，且顺序符合「先骨架、后组件、再数据」。`createSurface` 里 `root.children` 引用的 `poem_list` 此时还未到达，renderer 会跳过，第二条消息补齐后重绘——这就是 A2UI 扁平邻接表「乱序到达、渐进渲染」的实际用法。

### 12.3 组件树与 DOM 的映射

```
root(Column .two-column)
├── poems_card(Card .content-card)
│   ├── poem_heading(CardHeading) ── action=poem_read_all(SpeakButton)
│   ├── poem_hint(HintBar .stage-hint)
│   └── poem_list(List .poem-list) ── 模板 poem_tpl(PoemLine .poem-item) × N
└── writing_card(Card .content-card.practice-card)
    ├── write_heading(CardHeading)
    ├── write_hint(HintBar)
    └── write_pad(WritingPad) ── Text/WordChips/TextField/Feedback/Row/Button
```

renderer 把 `root` 的属性直接应用到容器本身（不多套一层 div），所以 `.two-column` 的 CSS 网格、`.practice-card` 的伪元素与 `[data-stage]` 规则全部原样生效——**CSS 一行没改**。

### 12.4 动作统一与 renderer function

| 原来 | P0 之后 |
| --- | --- |
| `data-speak` + `bindSpeech()` 逐个绑 | `action.event{readPoem,readAll}` → `callRendererFunction.speak` → `window.speakText()` |
| `#check-ai-writing` 的 `addEventListener` | `action.event=write` → 业务 handler 写回 `/practice/feedback` + `/practice/tone` → renderer 重绘 |
| `[data-ai-practice]` 的 `addEventListener` | `action.event=selectWord` → 更新 `/practice/word` |
| 反馈直接改 `feedback.textContent` / `className` | 只改 dataModel，DOM 由 renderer 生成 |

`app.js` 把朗读主体抽成 `speakText()` 并暴露到 `window`，`bindSpeech()` 继续服务成语卡、英语例句等未迁移模块；A2UI 的 `speak` 与它们共用同一条口型同步 / 语种判断 / 证据上报 / Chromium 长文本保活链路。

4 个 renderer function 白名单：`speak` / `celebrate` / `recordEvidence` / `openPoint`；非法名（如 `openUrl`）在 `validateMessage` 阶段就被拒绝。

### 12.5 年级能力协商的实现口径

`rendererCapabilities(grade)` 从 `grade-profile.js` 取阶段，输出 `{ stage, components, maxComponents, textMaxLength }`。**内容型组件（PoemLine / WritingPad / HintBar / List / SpeakButton）在所有阶段都允许**，只有 `Tabs` / `MethodNote` / `MasteryRing` 这类辅助组件按阶段放开。

编译器 `applyCapabilities()` 的规则：

1. 组件不在白名单 → 按 `FALLBACKS` 降级成允许的等价组件（`Tabs→Column`、`PoemLine→Text` …），并清理目标组件 schema 之外的属性；
2. 没有可用降级 → 跳过该组件，并从父组件 `children` 里移除悬空引用；
3. **超长诗句只记 warning，绝不截断或隐藏**——内容适配交给生成侧 `HINTS.rule` 约束。

这条规则正是为了避免重演「生成了诗句却被 CSS 藏起来」的 bug：能力不足时知识仍以纯文本出现，而不是消失。

### 12.6 验收数据

| 项目 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `test:a2ui`（协议 / catalog / 编译器） | 32 / 32 |
| `test:a2ui:browser`（真实 Edge 交互） | 30 / 30 |
| `test:a2ui:visual` 一年级 | DOM/样式差异 **0**，像素差异 **0 / 843298** |
| `test:a2ui:visual` 初二 | DOM/样式差异 **0**，像素差异 **0 / 354252** |
| `test:knowledge` | 46 / 46 |
| cache / models / users / idioms / ui / signup / redis | 34 / 29 / 37 / 18 / 28 / 34 / 33，全通过 |

视觉等价基线由改造前的真实浏览器采集（`cache/shots/a2ui-baseline.json` + 两张截图），对比 51 个 DOM 节点、40+ 计算样式属性与逐像素 RGBA 差值，阈值 16。

### 12.7 实现中发现并修掉的真实缺陷

1. **降级形同虚设**：`applyCapabilities()` 的 `allowed` 集合里含 `component`，循环复制原属性时把降级后的目标组件名覆盖回原值——日志说「已降级为 Text」，消息里却还是 PoemLine，`validateMessage` 随后报错。修复时显式跳过 `id` / `component`。
2. **SW 离线回退漏掉带版本号的脚本**：`index.html` 用 `?v=` 破缓存，而 `PRECACHE` 是无 query 的 URL；离线 `caches.match(request)` 命中不到，会回退到 `/` 的 HTML。加了 `caches.match(request, { ignoreSearch: true })` 兜底。
3. **`knowledge.css` 的 `[data-stage]` 隐藏规则仍是历史包袱**：P0 没删（本轮已改成只收辅助模块），但能力协商已经把适龄约束前置到协议层；P3 应把剩余内容型隐藏规则彻底删掉。
4. 测试环境坑（非产品缺陷）：`html{scroll-behavior:smooth}` 让 puppeteer 坐标点击在滚动动画中落空、悬浮吉祥物遮住提交按钮。测试里注入 `scroll-behavior:auto` 并隐藏 dock，DOM 级点击验证协议链路。

### 12.8 回退方式

P0 的改动集中在 `dynamic.js` 的 `renderDynamicChinese()`（约 30 行替换点）与 `app.js` 的 `speakText()` 抽取。若要回退：还原这两个函数、移除 `index.html` 的 3 个 script、`sw.js` 与 `server.js` 的登记项即可；`/api/tutor`、缓存键、`models.js` 全程未动，不会污染已缓存的课程数据。

### 12.9 P1 的具体改动点

1. 把 `compileLessonToA2UI()` **原样搬进服务端**：它是纯函数、无 DOM 依赖，只需在 `server.js` 里 `require('./a2ui-compiler')`；
2. 新增 `/api/a2ui/stream`：`stageEvents` 的 route 事件之后发 `createSurface`，讲解生成过程中逐块 `updateComponents`，解析完成发 `updateDataModel`；
3. 缓存键加 `uiVersion`，缓存编译后的 JSONL 序列而非重新编译；
4. 前端 `dynamic.js` 改成 `surface.feed(line)` 逐条消费，`window.ZHIDAO_A2UI_SURFACE` 已预留接管点；
5. 进度条仍严格串行（决策 → 讲解 + 各自耗时），A2UI 消息只是把「整块 JSON 一次性返回」换成「可渐进渲染的 UI 流」。

---

## 十三、学科组件矩阵：知识 × 过程 × 认知阶段（2026-11-11 追加）

### 13.1 需求与判断

用户提出：「不同的学科知识和具体问题，应该具备不同的知识组件，来匹配年纪用户的认知和学习 / 练习 / 强化等过程。」

P0 只证明了「同一份语文课可以用协议渲染」，但**组件选择仍是写死的**：不管语文、英语还是数学，不管初识还是强化，都套同一套模板。这不成立——语文的初识是「听一句、读一句」，数学的强化是「从特例回到通法」，认知动作完全不同。

所以新增一层**配方表**：把「用什么组件」从模板里抽出来，变成可计算、可测试、可协商的数据。

### 13.2 三层标尺（60 组配方）

| 维度 | 取值 | 决定什么 |
|---|---|---|
| 学科 | 语文 / 英语 / 数学 | 认知动作：读·品·仿写 / 听·选·辨 / 摆·推·验 |
| 学习过程 | 初识 → 练习 → 强化 → 迁移 | 环节目标：看见听懂 / 独立做一次 / 隔期还能做对 / 换情境仍会用 |
| 认知阶段 | early / primary / upper / teen / senior | 形态：选项数、线性还是全展开、能否出现公式、信息密度、语气 |

3 × 4 × 5 = **60 组**。`a2ui-matrix.js` 是唯一事实来源，`matrixRows()` 可把全表导出给家长看板、文档与测试。摘要（一年级 vs 初二）：

| 学科 · 过程 | 一年级（启蒙期） | 初二（青少年期） |
|---|---|---|
| 语文 · 初识 | HintBar + PoemLine + SpeakButton | 同左（内容不变，提示换成「标出关键一处」） |
| 语文 · 练习 | WordChips + WritingPad + Feedback | 同左，完成门槛 1 字 → 20 字 |
| 语文 · 强化 | PoemLine + WordChips + WritingPad（裁到 3 个） | PoemLine + WordChips + WritingPad + Feedback |
| 语文 · 迁移 | WritingPad + Feedback + HintBar（Text 降级） | WritingPad + Feedback + Text |
| 英语 · 初识 | WordChips + SpeakButton + HintBar | WordChips + SpeakButton + HintBar |
| 英语 · 练习 | ChoiceQuiz + SpeakButton + Feedback（2 选项） | ChoiceQuiz + SpeakButton + Feedback（4 选项） |
| 英语 · 强化 | ChoiceQuiz + WordChips + Feedback（2 选项） | ChoiceQuiz + WordChips + Feedback（4 选项） |
| 英语 · 迁移 | WritingPad + ChoiceQuiz + Feedback | 同左，要求替换成真实情境 |
| 数学 · 初识 | StepReveal + HintBar | StepReveal + HintBar（全展开） |
| 数学 · 练习 | StepReveal + ChoiceQuiz + Feedback | 同左（4 选项） |
| 数学 · 强化 | ChoiceQuiz + StepReveal + HintBar（公式降级、2 选项） | FormulaBlock + ChoiceQuiz + StepReveal（4 选项） |
| 数学 · 迁移 | StepReveal + ChoiceQuiz + HintBar | StepReveal + FormulaBlock + ChoiceQuiz + Text |

### 13.3 实现

- **`a2ui-matrix.js`**（UMD 前后端共用，零依赖）：`SUBJECTS` / `PHASES` / `STAGE_RULES` / `BASE_RECIPES` / `PHASE_HINTS` / `PROMPT_RULES`，导出 `recipeFor()`、`capabilitiesFor()`、`matrixRows()`。
- **`a2ui-compiler.js`** 新增 `compileKnowledgeToA2UI({ subject, phase, grade, point, data }, { capabilities })`，与 P0 的 `compileLessonToA2UI()` **完全独立**，因此语文两个模块的逐像素等价不受影响。
- catalog 补充组件 props；renderer 新增 `ChoiceQuiz` / `StepReveal` / `FormulaBlock` 三个渲染函数。
- `knowledge.css` 新增组件样式，全部使用 `k-` 前缀。
- 资源登记：`index.html` 顺序 catalog → matrix → compiler → render；`server.js` 静态白名单；`sw.js` 升 v5 预缓存。

消息流仍是三条：`createSurface`（组件树 + dataModel）→ `updateComponents`（空，为流式预留）→ `updateDataModel`（注入 `/knowledge/poems`）。

### 13.4 三条硬规则

1. **知识不删，只换承载**：`allowFormula=false` / `allowAbstract=false` 时，组件不是被 `display:none`，而是降级为 `HintBar`；生成侧 `PROMPT_RULES` 同步要求「用实物、图形或数轴描述，不先给公式」。
2. **正确答案不能被认知负荷裁剪掉**：启蒙期 4 选项裁成 2 个时，若正确答案排在后面，用一个干扰项换进来，保证孩子永远选得到对的那一项。
3. **步骤正文始终可见**：线性分步只用颜色区分当前步，不用占位文字替换后续步骤，避免重演「诗文空白」那类事故。

### 13.5 本轮发现并修掉的真实缺陷

1. 选项裁剪用 `slice(0, n)`，正确答案排在第 4 位时会被直接裁掉 → 低年级永远选不到对的那一项。
2. `StepReveal` 未展开步骤显示「第 N 步（点下一步展开）」占位文字，把知识藏起来 → 改为始终显示真实正文，按钮在全部展开时明确写「步骤已全部展开」。
3. 新增组件复用了 `.choice-button` / `.step-locked` 等类名，撞上 `styles.css` 原有学科模块样式（虚线框、`flex:1`、`text-align:center`），数学步骤渲染成错位的虚线框 → 全部改 `k-` 前缀隔离。
4. 视觉等价测试依赖公网 Google Fonts（`display=swap`），字体加载与否会造成 0.86px 文本宽度差，让「逐像素等价」随网络波动 → 测试页拦截字体请求并等待 `document.fonts.ready`，固定为 fallback 字体。
5. 抽象组件（公式 / 长说明）被排除时原本直接删除，未降级 → 统一降级为 `HintBar`。

### 13.6 验证

| 测试 | 结果 |
|---|---|
| `test-matrix.js` | **21/21**：60 组配方组件均在白名单且均有 renderer 实现、180 条消息全部通过 `validateMessage`、学科/过程/年级差异、两条缺陷回归、能力降级、XSS、资源登记 |
| `test-a2ui.js` | **32/32**（P0 未回归） |
| `test-a2ui-browser.js` | **30/30**（P0 交互未回归） |
| `test-a2ui-visual.js` | **2/2**：DOM/计算样式差异 0；初二像素 0/354252；一年级 5418/843298（0.643%，字体抗锯齿，1% 容差内） |

---

## 十四、交互案例截图与「差别」在哪

### 14.1 产出

`cache/shots/a2ui-cases.html`（单文件、图片以 base64 内嵌，可直接打开）由 `test-a2ui-cases.js` 生成，含 **14 张真实 Edge 截图**：

- **①** 改造前 vs 改造后静态对比 4 张（一年级 / 初二）
- **②** P0 交互案例 8 张：初始态、朗读、选词 + 输入回写、提交达标、不刷新切年级、初二门槛、能力裁剪降级、XSS 纯文本
- **③** 学科组件矩阵 6 张：语文初识一年级 / 语文迁移初二 / 英语练习五年级 / 英语强化初二 / 数学强化一年级 / 数学强化初二
- **④** 12 行配方总览表 + 差别对照表

每张案例左侧是产品视角截图，右侧是从页面内 hook **实测采集**的协议状态 / 配方参数（消息流、surfaceId、dataModel、组件清单、选项数、降级告警），不是手写示意。

### 14.2 结论：视觉零差别，链路全变

| | 改造前 | 引入 A2UI 后 |
|---|---|---|
| 界面 | `dynamic.js` 手写 innerHTML 模板 | 消息流 → 白名单组件树 → renderer 生成 DOM |
| 用户感知 | 几乎看不出来（DOM / 计算样式差异 0） | 一致 |
| 系统能力 | 无法回溯用户动作、适龄靠 CSS、组件写死 | 可观测、可降级、可协商、**可按学科 × 过程 × 年级重新编排** |

同一道「x + 3 = 7」在 M5（一年级）是 **2 选项 + 线性分步 + 无公式 + 提示条**，在 M6（初二）是 **4 选项 + 全展开步骤 + 公式块 + 要求写依据**；喂进去的知识点 JSON 完全相同，正确答案 D 在两个版本里都保留。

### 14.3 复现

```bash
PORT=3100 API_MOCK=true CACHE_BACKEND=local CACHE_DIR=cache/test-a2ui-cases node server.js
node test-a2ui-cases.js     # 生成 14 张截图 + a2ui-cases.html
node test-matrix.js
```

测试页注入 `disableServiceWorker` 桩（否则 `pwa.js` 在 SW 接管时会 `location.reload()` 随机打断采集），并用 DOM 级点击规避 `scroll-behavior:smooth` 与悬浮吉祥物遮挡。

### 14.4 路线更新

P1 的五个改动点见 [§12.9](#129-p1-的具体改动点)。组件矩阵已把「选什么组件」数据化，P3 的能力协商可以直接消费 `matrixRows()` 与 `capabilitiesFor()`，无需再改编译器；家长看板也可以直接用 `matrixRows()` 展示「这个孩子当前处在哪些学习过程」。

## 十五、P2 组件补齐：26 / 26 全部可渲染（2026-11-11 追加）

### 15.1 补齐了什么

第六章目录里「设计了但没实现渲染器」的 8 个组件本轮全部落地，catalog 从 **18 / 26** 变成 **26 / 26**：

| 组件 | 承载的知识 / 交互 | 主要出现位置 |
|---|---|---|
| `IdiomCard` | 成语字词卡：词、拼音、释义、例句、标签、年级 + 点读 | 语文 · 初识 |
| `WordCard` | 单词 / 术语卡：音标、多个例句、辨析提示 + 点读 | 英语 · 初识；语文数学 · 迁移 |
| `PictureChoice` | 低龄看图选：大图形按钮代替密集文字选项 | 启蒙期 · 练习 / 强化 |
| `MatchPairs` | 左右两列配对辨析，已配对项由 `matchedPairs` 驱动 | 小学期 · 练习 / 强化 |
| `NumberLine` | 数轴把抽象运算画成看得见的一格，当前值高亮 | 数学 · 低年级全阶段 |
| `MasteryRing` | 掌握度 SVG 环 + 知识点 + 状态（讲过 ≠ 会的具象化） | 初高中 · 强化 / 迁移 |
| `Tabs` | 通法 / 变式 / 易错分栏，切换走 `switchTab` | 高中期 · 强化 / 迁移 |
| `MethodNote` | 方法说明 + 可写依据输入框（`data-a2ui-bind` 回写） | 青少年 / 高中期 · 练习 |

### 15.2 接入方式（不是只在画廊里画出来）

1. `a2ui-catalog.js`：补齐 8 个组件的 `props` 白名单，新增 `P2_COMPONENTS` 清单，`STAGE_EXTRAS` 按阶段放开（启蒙期只放图示 / 内容卡，不放 `Tabs / MethodNote / MasteryRing / FormulaBlock`），`ACTION_EVENTS` 增加 `selectPair / switchTab`。
2. `a2ui-render.js`：`RENDERERS` 分派表补齐 8 个实现；`FALLBACKS` 里原有的降级链继续生效，能力禁用时都能落到 BASE 组件，而不是静默丢弃知识。
3. `knowledge.css`：新增 `k-` 前缀样式；形状、配色、数值一律来自固定白名单或数值钳制，模型输出只经 `textContent` 落地，不写 `innerHTML`、不执行字符串代码。
4. `a2ui-compiler.js`：`matrixComponent()` 补 8 个 case；`dataModel.knowledge` 增加 `idiom / wordCard / pairs / numberLine / mastery / tabs / methodNote`，调用方没给扩展字段时从已有内容重组，**不编造知识点、也不让组件渲染成空白**。
5. `a2ui-matrix.js`：新增 `extraFor(subject, phase, stage)`，60 组配方**每组只追加 1 个** P2 组件，认知负荷可控；降级产生的 `HintBar` 排在最前，绝不被 `slice(0, maxComponents)` 挤掉。

### 15.3 验证

- `test-a2ui-components.js` 12/12：26 个组件全有 renderer、8 个全进 60 组配方、每组恰好 1 个、实例属性全在 schema 内、降级链可终止、数据兜底非空、渲染器不执行字符串。
- `test-matrix.js` 21/21、`test-a2ui.js` 32/32、`test-a2ui-browser.js` 30/30、`test-a2ui-visual.js` 2/2（grade8 像素 0 差异、grade1 0.643% 在 1% 容差内）。
- `cache/shots/a2ui-components.html`：27 张真实 Edge 截图（20 张单组件 + 7 张配方），其中 S13–S20 是 8 个 P2 组件；`cache/shots/a2ui-cases.html` 的 6 张矩阵案例已同步显示新组件。

视觉复验时发现 grade8 一度出现 3.924% 像素差异，差异热图显示红色**只落在文字笔画、背景零差异**，定位为 `@import` 字体 CSS 命中磁盘缓存后绕过请求拦截、中文字形在两次运行间切换。在 `test-a2ui-visual.js` 增加 `page.setCacheEnabled(false)` 后恢复历史水平，DOM/样式始终 0 差异，确认不是结构回归。

### 15.4 仍未完成

矩阵编译器在 P2 阶段只被案例页与效果图脚本调用；**§17 的桥接层已把它接进 `/api/tutor` 的语英数三科主流程**（浏览器侧确定性编译）。仍未完成的是 [§12.9](#129-p1-的具体改动点) 的服务端化 P1：编译器搬到服务端、SSE 直接推 JSONL、`surface.feed()` 逐条消费。

> 注：§15 是 P2 阶段的记录（当时 catalog 为 26 个组件）。P3 之后组件数扩到 **32 个且全部可渲染**，见 §16。

## 十六、P3 游戏化关卡与「向知知求助」（2026-11-11 追加）

### 16.1 从参考稿到组件

参考稿是一张深紫底的教育游戏界面：主练习区 `4 · __ · __ · 7 · 8` 缺数填空 + 候选数字块 + `Reset / Submit / I don't know this`，右侧是 IP 求助卡与快捷问题，左下是语音控制条。这里不复制它的视觉，而是把每个区域抽象成可编排、可按年级换形态的 A2UI 组件：

| 参考稿区域 | 组件 | 认知意图 |
| --- | --- | --- |
| 主练习区数列与候选块 | `NumberGaps` | 点选 → 填格 → 提交，把「观察相邻关系」变成可操作动作 |
| 关卡 / 星星 / 进度 | `QuestHUD` | 低龄给即时目标与奖励，高龄换成「练习 2/5 · 正确率 80%」 |
| 左下语音条 | `VoiceGuide` | 不会打字的孩子点小喇叭即可听题目与做法 |
| 右侧 IP 卡 | `AskIP` | 知知头像 / 状态 / 台词 / 语音问 / 打字问，全程陪伴 |
| 快捷问题卡 | `QuickQuestions` | 预设问题 + 预设答案，降低「不知道该问什么」的门槛 |
| 「我不会」按钮 | `HintLadder` | 三级提示逐级解锁，前两级只给思路，第三级才揭晓答案 |

### 16.2 实现边界

`a2ui-play.js`（UMD、零依赖）做两件事：

- `compilePlayStageToA2UI({ grade, puzzle })` → 标准 A2UI v1.0 消息流（`createSurface` + `dataModel`），所有组件名、文案、动作、className 由确定性编译器给出；**模型只提供 `slots / bank / answers / hints`**。
- `createPlayController(surface, { stage, subject, onEvent })` → 组件不持有状态，点击走 `action → 控制器 → updateDataModel → surface.render()`。服务端化时只搬控制器，组件树不用改。

新增的 `ipIntent` renderer function 只接受 `idle / think / speak / happy / sad / focus / wave` 七个固定意图名，调用 `ZhidaoMascot.play()` 并 `say()` 一句引导语；模型无法注入 CSS / HTML / 代码。所有来自模型的字符串只经 `textContent` / `setAttribute` 落地。

### 16.3 真实交互链路（6 张点击状态截图）

1. 初始：深紫主题、两个空格未填、1 颗星、提示 0 级、知知在线。
2. 点候选块 `5` `6` → `fillGap` 写回 `/play/gaps`，填好的格子亮黄绿边框；点格子可 `clearGap` 取回。
3. 点「我填好啦」→ `submitGaps` 判定正确：星星 +1、连对 +1、进度 +20%、反馈鼓励语，并触发 `celebrate` + `ipIntent(happy)` + `recordEvidence(quiz, correct)`。
4. 重新进入点「我不会，找知知」→ `askIP` **只解锁第 1 条提示**（「先大声读出已经有的数字：4、7、8」），知知台词变成「给你一条提示，先自己试一试」，绝不一点就给答案。
5. 点语音胶囊播放键 → `readGuide` 的 `context.speak` 是 `{"@path":"/play/question"}`，派发时才绑定，触发 `speak` 朗读题干；真实页面由 `app.js` 的 `speakText()` 与 `mascot.js` 的口型同步接管。
6. 切到初二：**组件树一个没改**，只换年级画像 → 浅色克制主题、星星收起、按钮变小、求助改名「查看思路提示」、题干变成「观察 4、__、__、7、8 的相邻关系，补全缺项并写出依据」。

### 16.4 年级适配的五条策略

`PLAY_PROFILES` 按 `early / primary / upper / teen / senior / generic` 给出关卡名、题干、按钮文案、知知台词、快捷问题、三级提示与反馈语气；`knowledge.css` 靠 `html[data-stage]` 与 CSS 变量切换主题（深紫游戏化 ↔ 浅色工具界面）。

**不按年龄禁用组件**——启蒙期也保留语音、求助、快捷提问与分级提示，只换主题、字号与文案。这是上一轮 `display:none` 把诗句藏没了之后定下的硬规则：认知减负不能删知识、不能删求助入口。

### 16.5 验证

- `test-a2ui-play.js` 18/18：五个年级消息合法性、能力降级、正确答案不丢、三级提示顺序、庆祝与掌握证据、切换年级不重编组件树。
- `test-a2ui-components.js` 12/12：catalog **32 个组件全部有 renderer**、P2 八个全进 60 组配方、实例属性全在 schema 内。
- `test-a2ui.js` 32/32（`RENDERER_FUNCTIONS` 从 4 个扩到 5 个，断言同步更新）、`test-matrix.js` 21/21、`test-a2ui-browser.js` 30/30、`test-a2ui-visual.js` 2/2（初二像素 0/354252，一年级在 1% 容差内）。
- 全部 Node 回归 12 个脚本通过，`npm run check` 通过。
- `cache/shots/a2ui-components.html`：35 张真实 Edge 截图（26 张单组件含 6 张 P3、2 张整页关卡、7 张配方）。
- `cache/shots/a2ui-play.html`：6 张真实点击状态截图 + `srcdoc` 内联的可交互关卡，**单文件离线可用**；已用真实 Edge 验证 iframe 内点击 `fillGap` 生效。

### 16.6 仍未完成

`a2ui-play.js` 在 P3 阶段只由画廊与演示页加载；**§17 已把它登记进 `index.html` / `server.js` / `sw.js`，并按条件挂进数学主流程**。仍未完成的是服务端化 P1：编译器搬到服务端、SSE 流式输出 JSONL、`surface.feed()` 逐条消费。

## 十七、主流程打通：知识展示 ↔ A2UI（2026-11-11 追加）

### 17.1 要解决的错位

此前 §13 的 60 组配方、§16 的 6 个游戏化组件只在案例页、画廊、测试脚本里被调用；`/api/tutor` 的语英数三科主流程仍用手写模板字符串渲染。用户看到的「知识展示」与「A2UI」是两套互不相干的东西。本轮不改服务端响应 / 缓存 / 模型，新增浏览器侧确定性桥接层 `a2ui-bridge.js`，把**同一份课程 JSON** 同时喂给原有手写展示与 A2UI 消息流。

### 17.2 边界选择

| 决策 | 原因 |
| --- | --- |
| P0 语文 surface 保留在 `.two-column` 内 | 「诗文与名句 / 试着写一句」逐像素基线不动，既有浏览器断言不破 |
| 桥接区 `#a2ui-bridge` 挂在 `#lesson-content` 下、`.two-column` **之外** | 视觉等价测试只比对 `.two-column` 子树，DOM / 计算样式零差异 |
| 模型仍只产知识 JSON | 组件名、文案、动作、年级判定、样式全部由确定性编译器与 catalog 给出，LFM3 不写 UI |
| UMD 双端可用 | Node 侧 `require('./a2ui-bridge')` 做纯协议断言，浏览器侧挂 `window.ZHIDAO_A2UI_BRIDGE` |

### 17.3 编译链路

```
/api/tutor 课程 JSON
  → knowledgeFromLesson()   三科字段归一（只取 lesson.data，不凭空造知识点）
  → phaseFor()              初识 / 练习 / 强化 / 迁移
  → capabilitiesFor()       学科 × 过程 × 年级 = 60 组配方的其中一组
  → compileKnowledgeToA2UI()  A2UI v1.0 消息（createSurface / updateComponents / updateDataModel）
  → feedJSONL()             JSONL 逐条 / 整包交给 surface.feed()
  → renderer 白名单渲染 → action 回写 updateDataModel + KNOWLEDGE.practice 证据
  → 数学命中触发条件 → compilePlayStageToA2UI() + createPlayController()
```

### 17.4 游戏化关卡触发条件

| 条件 | 规则 |
| --- | --- |
| 学科 | 仅数学 |
| 学习过程 | 练习 / 强化；初识不打扰 |
| 题目形态 | 含数字，或命中找规律 / 填空 / 计算 / 数列等关键词，或模型直接给 `data.puzzle` |
| 掌握度 | 低于 80 分才出现（读 `KNOWLEDGE.board` 客户端缓存，不可用时不阻断） |
| 年级 | **不禁用组件**，只换主题与文案：低龄深紫游戏化 + 星星，初二浅色克制 + 「查看思路提示」 |

`forcePlay` 仅供测试与显式调用，不突破初识阶段的业务判断。

### 17.5 三科归一映射

| 学科 | 取自 `lesson.data` 的字段 | 组件区拿到的知识点 |
| --- | --- | --- |
| 语文 | `idioms / poems / practicePrompt / description` | 词语卡、诗句、选词、仿写、配对、Tab |
| 英语 | `items / quizzes / difference / mnemonic` | 词卡、例句、选词、辨析、配对 |
| 数学 | `methods / steps / challenge / challenge.answer` | 公式块、分步、数轴、掌握度、方法笔记、数字格子关卡 |

### 17.6 硬规则与本轮修复

- **空态不靠隐藏**：`primeEmptyFeedback()` 把一句真实的等待文案写进 `dataModel.practice.feedback`（青少年版换成克制语气），而不是 `display:none` 或留白。这是 §10「诗句空白事故」的同型防护。
- **卡片不等高不留白**：组件网格加 `align-items: start`，语文/英语单组件卡片不再被拉成整行空白。
- **幂等**：`destroy()` 用 `querySelectorAll('#a2ui-bridge')` 全量移除，修掉年级切换时 `learnerchange` / `learnerrefresh` 连续派发产生两个同 ID 组件区的中间态。
- **动作统一**：`answer / write / selectWord / switchTab / selectPair / nextStep` 一律走 `surface.setData()` 回写数据模型，练习证据走 `KNOWLEDGE.practice()`；离线 / 未登录上报失败不影响交互。
- **关卡绑定本课**：`puzzleFor()` 优先用模型给的 `data.puzzle`，否则用内置关卡，但 `point` 始终绑定本课知识点，不出现「练的是别的题」。

### 17.7 资源登记

`index.html` 脚本顺序 catalog → matrix → compiler → render → **play → bridge** → dynamic；`server.js` 静态白名单登记 `a2ui-play.js` / `a2ui-bridge.js`；`sw.js` 升 `zhidao-shell-v6` 并预缓存两文件；`dynamic.js` 三学科渲染末尾调用 `mountKnowledgeBridge()`，切内置课时 `destroy()`；`package.json` 新增 `test:a2ui:bridge` / `test:a2ui:bridge:browser` 并纳入 `check`。

### 17.8 验证

- `npm run check` OK；13 个 Node 回归脚本全绿：cache 34 / redis 33 / models 29 / users 37 / idioms 18 / knowledge 46 / a2ui 32 / matrix 21 / components 12 / play 18 / **bridge 30** / ui 28 / signup 34。
- 真实 Edge：`test:a2ui:bridge:browser` **30/30**（三科组件区、英语答对回写与证据、数学关卡填格→提交→求助→语音、年级切换重编译、无脚本错误）；`test:a2ui:browser` 30/30；`test:a2ui:visual` **2/2**（DOM / 样式差异 0，初二像素 0/354252，一年级 0.643% 字体抗锯齿微差在 1% 容差内）。
- 交付截图 `bridge-chinese.png` / `bridge-english.png` / `bridge-math.png` / `bridge-math-teen.png`，单文件离线案例页 `cache/shots/a2ui-bridge.html`。
- 3000 正式服务（本机 Redis + Liquid）与 3100 MOCK 服务均已重启加载新白名单，`/a2ui-bridge.js` 返回 200。

### 17.9 仍未完成（服务端化 P1）

服务端 SSE **尚未**改为直接推编译后的 JSONL。`feedJSONL(surface, messages, true)` 已证明「逐条 feed」与未来 SSE 推流同构，但要真正服务端化还需 [§12.9](#129-p1-的具体改动点) 的五步：编译器搬进 `server.js`（UMD 已支持 `require`）、`/api/tutor` 追加 `a2ui` JSONL 事件、前端逐条消费、缓存键绑定 A2UI 版本、能力协商从客户端移到响应头。当前客户端编译的代价是首包体积与每次重复编译，收益是零服务端风险且 P0 逐像素等价不被破坏。

## 十八、服务端化 P1：编译器搬进服务端（2026-11-12）

### 18.1 这一轮改的是什么

§17 打通了主流程，但编译器还在浏览器里：每次切年级、每次刷新都要重编，而且「客户端说了算」——浏览器可以宣称自己支持任意组件。§12.9 列的五步这轮全部做完，只是顺序和形态按实际风险重排了。

| 原计划 | 实际做法 | 原因 |
| --- | --- | --- |
| 编译器搬进 `server.js` | ✅ `require('./a2ui-compiler')`，新增 `compileA2UIForLesson()` | UMD 本来就支持 Node，零改动 |
| `/api/tutor` 追加 JSONL 事件 | ✅ 普通 JSON 给 `result.a2ui.jsonl`；SSE 多一条 `a2ui` 事件（早于 `result`） | 两条路径数据结构一致，前端只有一处消费逻辑 |
| 前端逐条 `surface.feed()` | ✅ `readStageStream()` 收集 `a2ui` 事件并合回 `result.a2ui` | 与未来「逐块推 updateComponents」同构 |
| 缓存键加 `uiVersion` | ⚠️ 改为**按课程内容做进程内 memo**，不写进 Redis 课程缓存 | 见 §18.4 |
| 能力协商从客户端移到响应头 | ⚠️ 改为**请求体 `capabilities` + 服务端收窄**，未用响应头 | 响应头放不下组件白名单；请求体天然支持 GET/POST 两条链路 |

### 18.2 链路

```
/api/tutor 请求（input / grade / capabilities）
  → 原有的学科决策 + 讲解生成 + 校验自愈（完全未改）
  → compileA2UIForLesson(payload, { grade, requested })
        knowledgeFromLesson()  三科字段归一
        phaseFor()             初识 / 练习 / 强化 / 迁移
        negotiateCapabilities() 服务端基准 ∩ 客户端宣告（只收窄）
        compileKnowledgeToA2UI() → 3 条 v1.0 消息
        validateMessage() 逐条过闸（任何一条不过就整包不下发）
  → JSON：result.a2ui.jsonl ；SSE：额外一条 a2ui 事件
  → 浏览器 a2ui-bridge.takeServerSurface() 二次校验 → surface.feed() 逐条渲染
  → 校验不过 / 旧服务 / 年级错位 → 回退本地编译（结果逐条一致）
```

### 18.3 能力协商的口径（本轮最容易错的一处）

`a2ui-catalog.js` 里有两个语义不同、名字都像「能力」的东西：

- `rendererCapabilities(grade).components` = **本阶段允许出现**的组件（教育口径，受 `STAGE_EXTRAS` 约束）
- `rendererCapabilities(grade).implemented` = **本端画得出**的组件（实现口径，与年级无关，新字段）

协商必须用 `implemented`。原因是一个真实踩到的退化：英语练习在启蒙期的配方组件是 `ChoiceQuiz`（2 选项），而 `STAGE_EXTRAS.early` 里没有 `ChoiceQuiz`。浏览器拿 `components` 去宣告，服务端按交集收窄，`ChoiceQuiz` 就被当成「渲染器画不了」按 `FALLBACKS` 降级成了 `WritingPad`——一年级英语练习直接变形，浏览器回归从 30/30 掉到 26/30。

修法不是放宽白名单，而是把两套语义分开：**渲染器实现能力**用于协商，**阶段准入**永远由服务端按年级计算。服务端还额外做三件事：

1. 未知组件名、非字符串、注入串一律忽略，不写进能力集；
2. `maxComponents` / `textMaxLength` 取 `min(服务端基准, 客户端宣告)`，客户端只能调低；
3. 客户端宣称的 `stage` 直接无视——年级来自学习者档案，不能由客户端改写。

### 18.4 为什么不把 JSONL 写进 Redis 课程缓存

课程缓存里存的是**模型输出**（要花钱、要自愈）。JSONL 是它的纯函数派生物，编译一次是微秒级。如果把 JSONL 塞进课程缓存：

- UI 版本一升，要么继续发旧 JSONL（错），要么整份课程缓存作废（把已付费的模型生成丢掉重花一次钱）。

所以改成 `hash(uiVersion + 学科/过程/阶段 + 能力集 + 知识点 + 数据)` 做进程内 memo（上限 240 条）。命中时 `cached: true` 会随响应回显，`test:a2ui:server` 有对应断言。服务端重启后第一次请求重编，代价可忽略。

### 18.5 失败即降级，绝不发半坏组件树

下面前四种情况服务端直接**不下发** `a2ui` 字段，第五种下发后被浏览器拒绝——两种都回到本地编译，页面仍是完整课程：

| 情况 | 处理 |
| --- | --- |
| 编译抛异常 | `console.warn` 后返回 `null` |
| 任一条消息没通过 `validateMessage` | 整包丢弃（不发半截树） |
| 客户端宣称连 `Column` 都画不出 | 整包丢弃（树没有容器就没法渲染） |
| 课程响应没有 `data` | 不编译 |
| 消息里的 surfaceId / 学科 / 过程 / 阶段与本地判定不一致 | 浏览器 `takeServerSurface()` 返回 `null`，本地重编 |

浏览器侧还有一层「本端组件白名单」：服务端消息流里如果出现本端实现不了的组件，同样丢弃重编，避免出现空白格子。

### 18.6 视觉与交互的可见变化

组件区标题多了一段来源标注：`知识组件 · 英语 · 练习 · 低龄 · 9 个白名单组件 · 消息流来自服务端`。它同时是回归断言的锚点（`status.source === 'server'` / `uiVersion` 形如 `p1-1.0`），也让现场排查「到底哪一层编译的」不用翻日志。

除此之外 DOM 与样式零变化：`.two-column` 里的 P0 surface 仍在浏览器侧编译（视觉基线一个字都不动），桥接区仍挂在它外面。

### 18.7 顺手修掉的真实缺陷（与本轮目标无关，但会挡住 Windows 开发）

`users.js` 的本地 JSON 用户库直接用存储键当文件名，而键是 `parent:usr_xxx`。Windows 文件名不允许 `:`，`rename` 抛 `EINVAL`，表现为**注册返回 500、重启后账号消失**。本地后端下整条注册链路是坏的（Redis 后端不受影响，所以之前没暴露）。

修法：键做 `%XX` 可逆转义（`parent%3Ausr_abc.json`），读取时还原；老库未转义的文件在首次读取时迁移；`keys()` 解码后再按前缀过滤，`remove()` 两个名字都删。`test:users` 增加 4 项断言（写入/读回/物理文件名不含冒号/keys 还原/删除)。

### 18.8 验证

| 测试 | 结果 |
|---|---|
| `npm run check` | 通过（含新增 `test-a2ui-server.js`） |
| `test:a2ui:server`（新增） | **19/19**：三科消息流合法、五阶段全过闸、能力只收窄、非法组件被忽略、容器都画不出时整包拒绝、SSE 事件顺序与去重、缓存命中仍带消息流、服务端与本地编译逐条同构、`takeServerSurface` 七种拒绝路径、空/超长输入无 a2ui、XSS 只作文本 |
| `test:a2ui:bridge:browser` | **34/34**（新增 4 项：来源=server、uiVersion、标题标注、切年级后仍是服务端消息流） |
| `test:a2ui:browser` | 30/30 |
| `test:a2ui:visual` | 2/2：DOM/样式差异 0；初二像素 0/354252；一年级 0.643%（字体抗锯齿，1% 容差内） |
| `test:users` | 41/41（含 4 项本地库落盘命名） |
| `test:ui` / `test:signup` | 28/28 · 34/34（3100 MOCK 实例） |
| 其余 Node 回归 | cache 34 / redis 33 / models 全 PASS / idioms 18 / knowledge 46 / a2ui 32 / matrix 21 / components 12 / play 18 / bridge 30 |

> 复现：`PORT=3100 API_MOCK=true CACHE_BACKEND=local CACHE_DIR=cache/test-a2ui-baseline node server.js`，
> 然后 `npm run test:a2ui:bridge:browser`；服务端编译链路自带服务，直接 `npm run test:a2ui:server`。

### 18.9 仍未完成

1. **真正边生成边推**：现在是「课程生成完 → 一次性下发 3 条消息」。要变成「决策完成即推 `createSurface` 骨架、讲解分块推 `updateComponents`」，需要生成侧改成分块解析（当前 `models.js` 是整段 JSON 校验后才可用）。协议层已经就绪（扁平邻接表 + 逐条 `feed`），差的是生成链路。
2. **游戏化关卡未服务端化**：`a2ui-play.js` 仍在浏览器编译（触发条件依赖客户端掌握度缓存）。服务端化的前提是把掌握度一起带进请求。
3. **能力协商没进响应头 / 没进缓存键**：现在每次请求带能力集，若将来支持 CDN 缓存响应，需要把能力集摘要放进缓存键（`Vary` 或查询参数）。
4. **`STAGE_EXTRAS` 与矩阵配方仍有两套阶段口径**：本轮只是让协商绕开它，长期应收敛成「catalog 只管实现、matrix 只管准入」。

## 十九、组件路线图：问题 → 配方 → UI 的全局概览（2026-11-12 追加）

§18 解决了「消息流在哪编译」，但没有回答开发者最常问的一句：**「用户到底问什么，才会看到哪一种 UI？」** 以及「下一个组件该按什么顺序加」。§19 把这件事从口头经验变成可执行、可生成、可断言的数据。

### 19.1 交付物与单一事实来源

| 文件 | 作用 |
| --- | --- |
| `a2ui-question-map.js` | **唯一事实来源**（UMD 双端）：8 个问题域、18 类用户提问、19 个待实现组件规格、4 个迭代批次、10 条硬规则、7 步实现清单、`classifyQuestion()` / `componentsFor()` / `audit()` |
| `build-a2ui-roadmap.js` | 从映射表 + `a2ui-catalog.js` **自动生成**文档与可视化页，改数据后重跑即可，不存在「文档写完就漂移」 |
| `docs/A2UI-COMPONENT-ROADMAP.md` | 总体概览文档：现状盘点、决策链、问题类型全表、换年级/换过程对照、19 个组件规格、硬规则、实现清单、批次门槛 |
| `cache/shots/a2ui-roadmap.html` | 单文件离线可交互总览页：决策链、阶段 × 过程网格、按域 / 批次 / 关键词筛选、19 张组件卡 |
| `test-a2ui-question-map.js` / `test-a2ui-roadmap-browser.js` | 映射表 18 项断言 / 真实 Edge 离线页 12 项断言 |

### 19.2 问题类型识别怎么算

三级打分，刻意做得保守：

1. `signals` 主题弱信号命中 +2（「下一句」「偏旁」「时态」「加法」）；
2. `strong` 题型叫法命中 +4，用来压过同一句里顺带出现的学科词——「给我出 5 道**加法口算**」应归「口算闯关」而不是「竖式计算」，「把圆**平均分成** 4 份怎么切」应归「图形等分」而不是「应用题」；
3. 含数字只在**已有文字信号**时 +1，否则 `<script>alert(1)</script>` 会被判成数学题。

学科由服务端决策结果先做硬过滤；识别不了返回 `null`，由原 60 组配方兜底，绝不强行分类。36 条真实提问样例全量断言。

### 19.3 19 个新组件的覆盖与批次

| 问题域 | 组件 | 所属批次（按左列顺序） |
| --- | --- | --- |
| 诗词与名句 | `PoemTiles` / `PoemChain` / `ImageryBoard` | P4b / P4a / P4a |
| 故事与课文 | `StoryOrder` / `StoryBranch` / `RoleVoice` | P4a / P4c / P4c |
| 汉字与字形 | `RadicalTiles` / `StrokeOrder` / `LookAlike` | P4b / P4c / P4a |
| 阅读与表达 | `RhetoricMatch` | P4a |
| 英语语法 | `TenseTimeline` / `SentenceBlocks` / `GrammarDoctor` | P4c / P4b / P4a |
| 词汇与听说 | `LetterTiles` | P4b |
| 计算与等式 | `ColumnArithmetic` / `BalanceScale` / `SpeedRound` | P4b / P4b / P4d |
| 应用与图形 | `UnitStrip` / `ShapeSplit` | P4d / P4d |

批次按风险递增：**P4a 选择器型（6）** → **P4b 拼装型（6，共用 AssemblyTray 内核）** → **P4c 语音与开放产出（4）** → **P4d 图形与情境（3）**。每个组件都强制写明「模型只给什么知识字段 / 编译器派生什么 / 动作回写什么证据 / 降级到哪个已实现组件 / 低龄与高龄怎么适配」，并全部通过 `audit()` 检查 fallback、reuse、证据类型、批次归属。

### 19.4 与既有硬规则的一致性

- **模型只产知识 JSON**：`modelFields` 里出现 `component` / `className` / `action` / `style` / `html` 会被测试判为非法。
- **开放题不判对错**：`StoryBranch` / `StrokeOrder` / `SentenceBlocks` 只记 `created` / `asked` / `recited`，绝不写 `correct`。
- **年级只换皮**：`componentsFor()` 断言初识阶段不弹游戏、启蒙期禁真实倒计时、青少年要求写依据。
- **降级链必须存在**：19 个组件全部指向 catalog 里已实现的 32 个组件之一。
- **不破坏视觉基线**：映射表是设计期数据源，**未挂进 `index.html` / `server.js` 静态白名单**，本轮运行时零改动。

### 19.5 与 §18.9 未完成项的关系

`classifyQuestion()` 目前**只做建议**，`a2ui-bridge.js` 的 `phaseFor()` 仍按学科粗判（语文→练习、英语→按是否作答、数学→强化）。建议接入顺序：先让题型识别只做**观测打点**，确认线上信号准确率后再让它影响过程判定与配方选择，避免一次性把 60 组配方全推翻。真正把 `classifyQuestion()` 接进 `server.js` 的编译链，属于 P1 之后的服务端化第二阶段。

### 19.6 验证

`npm run check` 通过；`npm run test:a2ui:map` **18/18**（含 36 条提问全命中、学科隔离、强信号压制、注入串不误判、UMD 双端、audit 零问题）；`npm run test:a2ui:roadmap:browser` **12/12**（真实 Edge 打开 `file://` 单文件，零外链、域 / 批次 / 关键词三种筛选生效、无脚本错误，输出整页截图 `a2ui-roadmap.png`）。既有的桥接、服务端、视觉等价回归未受影响（本轮无运行时改动）。

> 以上是 §19 交付时的**设计态快照**。§20 记录 19 个规格逐个落地后的实现态；两节并存是为了保留「先设计映射、再按批次实现」的决策轨迹，遇到结论冲突一律以 §20 为准。

---

## 二十、19 个游戏交互组件全量落地（2026-11-12 追加）

§19 结束时，`a2ui-question-map.js` 只是**设计期数据源**：19 个组件规格写好、18 类问题能识别，但运行时一行未改。用户随后要求「五、19 个待实现游戏组件 六、迭代批次与完成门槛，如果没有实现都一个一个完成」。本轮把 19 个规格全部实现，按 P4a → P4b → P4c → P4d 逐批过门槛，并把 §19.5 里「`classifyQuestion()` 只做建议」推进为「已接入编译链」。

### 20.1 交付清单

| 文件 | 作用 |
| --- | --- |
| `a2ui-games.js` | **聚合层**（UMD 双端纯函数）：注册四批模块，对外只暴露 `deriveGames / selectGame / createModel / serializable / componentFor / applyAction`；编译器、服务端、桥接层都只认识这一个 games 对象 |
| `a2ui-p4a.js` ~ `a2ui-p4d.js` | 四批实现，统一导出 `BATCH / COMPONENTS / KEY_BY_COMPONENT / GAME_ACTIONS / deriveGames / createModel / componentFor / applyAction`；新增一批只要写一个文件并登记到 `BATCH_FILES` |
| `a2ui-question-map.js` | 19 个规格 `status` 全部改为 `implemented`；补 `poem.assemble` / `hanzi.stroke` 两类题型 → **20 类问题 / 40 条样例** |
| `a2ui-catalog.js` | 白名单与 schema 从 32 扩到 **51 个组件**，19 个新组件全部纳入能力协商 |
| `a2ui-render.js` | 19 个渲染分派复用四类渲染器：选择器 / 拼装台 / 语音开放产出 / 固定图形 |
| `a2ui-compiler.js` | 命中题型时在 60 组配方**之外**追加一张 `k-game-card`，既有知识组件一个不删 |
| `a2ui-bridge.js` | 派生 `data.games`；按 `GAME_ACTIONS` 分派 `applyAction()`，把 `created / correct / asked / recited` 证据回写知识卡片 |
| `server.js` / `index.html` / `sw.js` | 静态白名单与 Service Worker 离线缓存登记 5 个新脚本 |
| `knowledge.css` | 游戏卡、拼装台、语音控件与固定 CSS 形状 `.k-game-shape.shape-0` ~ `shape-3` |
| `test-a2ui-games.js` / `test-a2ui-games-browser.js` | 四批门槛 Node 断言 / 真实 Edge 点击回归 + 19 张效果图 |

### 20.2 为什么先做聚合层

19 个组件分四批，如果每批都去改编译器与桥接层，「题型识别 → 数据派生 → 组件实例 → 动作状态机 → 证据回写」这条链会被复制四份，任何一处口径改动都要改四个地方。`a2ui-games.js` 把这四批注册成同一份接口：

```
deriveGames(subject, data) → selectGame(四道闸门) → componentFor / createModel
                                                    ↓ action
                                   applyAction() → 新状态 + 朗读文本 + 学习证据
```

单批加载失败或某一批 `deriveGames` 抛错都不影响其它批，也不影响正常上课——这是「游戏卡永远是附加项」在代码结构上的保证。

### 20.3 四道闸门：缺一不挂

`selectGame()` 必须全部满足才返回组件，否则返回 `null`，60 组配方原样输出：

1. **题型命中且已实现**：`classifyQuestion()` 命中，`specFor(...).status === 'implemented'`，且该组件已注册到某一批；
2. **学习过程允许**：`componentsFor(hit, phase, grade)` 返回 `allowed`（初识阶段不弹游戏）；
3. **能力集允许**：命中组件在协商后的 `capabilities.components` 里（渲染器画不出来就不下发）；
4. **本课有真实数据**：`data.games[key]` 存在，模型没给内容就不硬凑一个空壳组件。

第 4 条是内容质量的关键：游戏卡的选项、诗句、字块全部来自课程 JSON 的知识字段，乱序、选项数、按钮文案、年级口气由编译器确定性派生，模型不许给 `component` / `className` / `action` / `html`。

### 20.4 四批实现与门槛验收

| 批次 | 组件数 | 核心 | 完成门槛 | 验收 |
| --- | --- | --- | --- | --- |
| **P4a 选择器型** | 6 | `PoemChain / ImageryBoard / StoryOrder / LookAlike / RhetoricMatch / GrammarDoctor`，复用既有选择骨架 | 每个组件 1 张效果图 + `validateMessage` 断言 + 真实浏览器点击断言；DOM 基线零差异 | ✅ 6/6 |
| **P4b 拼装型** | 6 | `PoemTiles / RadicalTiles / SentenceBlocks / LetterTiles / ColumnArithmetic / BalanceScale`，共用 `AssemblyTray` | 共用 `/game/<key>/assembly/*` 数据契约；固定种子乱序、答案可复现；撤销可回退到任意一步 | ✅ 45 项 Node 断言覆盖 |
| **P4c 语音与开放产出** | 4 | `StoryBranch / RoleVoice / StrokeOrder / TenseTimeline` | 开放题只记 `created / asked / recited`，绝不写 `correct`；朗读可中断且口型复位；青少年版无幼态奖励 | ✅ `stopVoice` 与 `reward=false` 断言 |
| **P4d 图形与情境** | 3 | `SpeedRound / UnitStrip / ShapeSplit` | 图形只由组件按数据用 CSS 固定形状渲染，模型不给 SVG / HTML；低龄禁真实倒计时；答错不扣分、不排名、不写证据 | ✅ 形状数据只含数字 / `shape-N` |

排序逻辑与 §19.3 一致：先做「一眼能判对错」的选择器型把覆盖抬起来，再抽象拼装台内核一次性解决六份状态机，然后才碰语音与开放产出（证据口径最容易出错），最后做图形与情境（涉及 CSS 绘图与儿童保护评审）。

### 20.5 服务端 / 浏览器同构

四批模块与聚合层都是 UMD 双端纯函数：Node 走 `require`，浏览器挂 `window.ZHIDAO_A2UI_*`。因此「服务端编译下发」与「浏览器本地回退」用的是同一份派生与动作逻辑，不会出现两份实现慢慢漂移。

- 服务端：`server.js` 在 `/api/tutor` 里编译，`result.a2ui.jsonl` / SSE `a2ui` 事件直接带游戏卡；
- 浏览器：`a2ui-bridge.js` 逐条 `feed()`，校验不过自动回退本地编译；
- `test-a2ui-games-browser.js` 的 A 段断言真实 MOCK 主流程里游戏组件**可见、点得动、消息流来源是 `server`**；B 段在主流程同一套 compiler / renderer / bridge 里逐个编译 19 个组件并真实点击。

### 20.6 硬规则怎样继续保持

- **知识不删**：游戏卡是 `rawComponents.push()` 追加，`applyCapabilities()` 之后仍保留原配方；测试断言「挂游戏卡不会删掉原配方的知识组件」。
- **正确答案不裁**：低龄只减选项数与密度，正确答案始终在；注入串只作文本，永不进入 `html` / `className` 之外的 props。
- **`dataModel` 纯 JSON**：`games.serializable()` 用 JSON 往返丢掉函数字段，服务端下发与浏览器回写都不会带不可序列化状态。
- **年级只换皮**：阶段永远由服务端按年级算，客户端只能收窄能力；低龄星星 / 语音引导、青少年浅色克制与「写依据」由同一组件树按 `stage` 派生。
- **未命中零影响**：识别不了返回 `null`，组件树一字不动，`.two-column` 的 DOM 与逐像素视觉基线保持不破。

### 20.7 验证与产物

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 通过（含 5 个新脚本与 2 个新测试） |
| `npm run test:a2ui:map` | 18/18（20 类问题 / 40 条样例全命中、`audit()` 零问题） |
| `npm run test:a2ui:games` | **45/45**（四批门槛逐条断言） |
| `npm run test:a2ui:games:browser` | **48/48**（真实 Edge；A 段服务端消息流 + B 段 19 个组件点击 + 无脚本错误） |
| `npm run test:a2ui:roadmap:browser` | **12/12**（刷新后的总览页：20 类问题 / 19 张组件卡 / 三种筛选） |

产物：`cache/shots/game-*.png`（19 张效果图）、`cache/shots/a2ui-games.html`（可交互画廊）、`cache/shots/a2ui-roadmap.html` 与 `a2ui-roadmap.png`（刷新后的总览）、`docs/A2UI-COMPONENT-ROADMAP.md`（实现态文档，由 `npm run build:a2ui:roadmap` 生成，四批验收结果写在批次表最后一列）。

### 20.8 与 §19.5 的差异、仍未做的事

§19.5 说「`classifyQuestion()` 目前只做建议」——**这条已被本轮推翻**：它现在经 `games.selectGame()` 进入编译链，决定「挂不挂游戏卡」。但**学习过程仍按学科粗判**（语文→练习、英语→按是否作答、数学→强化），`phaseFor()` 没有被改写；让题型识别影响过程判定与 60 组配方，仍需先做观测打点确认线上信号准确率。

当时记录的三项未完成项如下——**现已在 §22 全部完成**，此处仅作决策演进快照保留，不作为现状说明：P3 游戏化关卡（`a2ui-play.js`）当时只在浏览器编译；`STAGE_EXTRAS` 与矩阵配方两套阶段口径当时待收敛；真正边生成边推 `updateComponents` 当时尚未实现。

---

## 二十一、协议来源与符合度：和 Google A2UI 的关系（2026-11-12 追加）

### 21.1 结论

**协议语义借鉴 Google 开源的 A2UI，运行时实现全部自研；既不是官方 SDK 接入，也不是完整规范实现。**

A2UI 由 Google 创建、Apache 2.0 许可，CopilotKit 与开源社区参与共建（[a2ui.org](https://a2ui.org/)）。规范版本线为 v0.8（legacy，`beginRendering` / `surfaceUpdate` / `dataModelUpdate`）→ v0.9（stable，引入 `createSurface`、自定义 catalog、客户端函数）→ v0.9.1（current，`application/a2ui+json`）→ v1.0（candidate，新增 `actionResponse`、action IDs、`surfaceProperties`）。本项目在 2026-11-11 调研后，按 **v0.9+ / v1.0 的消息语义**自建了一套协议契约层。

### 21.2 对照表

| 维度 | 官方 A2UI | 知岛的实现 | 关系 |
| --- | --- | --- | --- |
| 生命周期消息 | `createSurface` / `updateComponents` / `updateDataModel` / `deleteSurface` | `a2ui-catalog.js` 的 `MESSAGE_TYPES` 同名四条，v0.8 旧名列在 `LEGACY_MESSAGES` 并**一律拒绝** | ✅ 语义对齐 |
| 流式传输 | JSONL，每条是完整 JSON；SSE / WS / A2A 皆可 | `/api/tutor` 的 SSE 按事件推 JSONL，浏览器逐条 `feed()` | ✅ 语义对齐 |
| Surface 与组件图 | `surfaceId` + 扁平 adjacency list，约定 `root` 为根 | 同样用 `surfaceId` + 扁平 `components[]`，`root` 为根 | ✅ 语义对齐 |
| 数据绑定 | `{"@path": "/..."}` 指向 dataModel | `pointerGet()` / `pointerSet()` 解析 `@path`，动作回写 `updateDataModel` | ✅ 语义对齐 |
| 安全模型 | 只能用客户端预批准的 catalog 组件，不执行任意代码 | 51 组件白名单 + renderer 白名单，未知组件拒绝；所有字符串只经 `textContent` / `setAttribute` | ✅ 语义对齐 |
| 渐进渲染 | 边生成边推 `updateComponents` | §22.3 的 `a2ui-stream.js` 骨架 → 分块 → 数据 | ✅ 语义对齐（自研拆分器） |
| **谁生成 UI** | Agent / LLM 直接产出 A2UI 消息 | **模型只产课程 JSON**，组件树由 `a2ui-compiler.js` 确定性编译 | ⚠️ 关键差异：本项目刻意不让模型决定 UI |
| 组件目录 | 官方 basic catalog（URL 引用、schema 校验） | 自研 51 个教育组件（PoemLine / NumberGaps / PoemTiles …），无官方 catalogId URL | ⚠️ 自研 |
| 渲染器 | 官方 Angular / Flutter / Lit / React / Markdown | 零依赖原生 DOM 渲染器 `a2ui-render.js`，无第三方 UI 依赖 | ⚠️ 自研 |
| 能力协商 | 客户端声明 catalog / capabilities | `rendererCapabilities()`：`implemented`（画得出）与 `components`（阶段准入）分离 | ⚠️ 自研，且语义不同 |
| 传输 / RPC | A2A、AG-UI、`callRendererFunction` / `rendererFunctionResponse`、v1.0 `actionResponse`、action IDs、`surfaceProperties`、MIME `application/a2ui+json` | 只有本项目 `/api/tutor` 的 JSON + SSE；`speak` 等是本地 renderer function，动作是本地 `updateDataModel` | ❌ 未实现 |
| 传输层健壮性 | 顺序 / 重连 / 背压 / 截断流恢复 | 只做「逐条校验 + 校验不过整条流回退本地编译」 | ❌ 未实现 |

### 21.3 为什么这样选

教育内容有唯一正确答案，UI 却需要严格按年级认知与学习过程裁剪。**让模型只负责知识，让确定性代码负责组件与动作**，才能做到「同一份课程 JSON 在服务端和浏览器编译出逐条一致的消息流」（`test:a2ui:server` 19/19 断言），也才能让 UI 版本升级不连带作废已付费生成的课程缓存（A2UI JSONL 只做进程内 memo）。这与官方「LLM 直接流式吐 UI」的用法不同，是本项目在 A2UI 语义之上的架构选择，而非协议不符。

若将来要接官方 renderer，成本主要在补齐 §21.2 最后两行：把自定义 catalog 换成官方 basic catalog 映射、增加 `callRendererFunction` / `actionResponse` 双向 RPC 与 A2A/AG-UI 传输层；消息名与组件图无需重做。

---

## 二十二、三项技术债收尾（2026-11-12 追加）

### 22.1 两套阶段口径收敛

`STAGE_EXTRAS` / `BASE_COMPONENTS` 从 `a2ui-catalog.js` 迁到 `a2ui-matrix.js`，成为**唯一事实来源**。catalog 通过注入钩子拿到 `rendererCapabilities()`（只读视图），另提供 `implementationCapabilities()` 只回答「本端画得出什么」；`capabilitiesFor()` 不再回问 catalog。**catalog 只管实现、matrix 只管准入**。能力协商仍只用 `implemented`（§18.3 的教训不变）。

### 22.2 P3 游戏化关卡服务端化

掌握度 `mastery` 随 `/api/tutor` 请求上送；服务端 `require('./a2ui-play')`，用与浏览器同一份编译器产出关卡 JSONL，逐条过 `validateMessage()`；普通 JSON 挂 `result.play`，SSE 多一条 `play` 事件。桥接层新增 `takeServerPlay()`，校验 surfaceId / 学科 / 阶段 / 能力 / 消息类型，通过就优先消费并标注 `playSource=server`，否则回退本地编译。`status()` 暴露关卡来源与组件数。

### 22.3 渐进式 `updateComponents`

新增 `a2ui-stream.js`：把一次性的 3 条消息拆成「骨架 `createSurface` → 分块 `updateComponents` → `updateDataModel` → 数据到位」。`diff()` 保证与完整流语义等价（组件一条不丢、dataModel 与正文不删），`chunkEvents()` 供 SSE 分条推送。前端 `readStageStream()` 支持多条 `a2ui` 事件，在生成期间把分块逐条 `feed()` 到临时预览层，`result` 到达即销毁；普通 JSON 响应结构不变。骨架 `surfaceId` 与正式流隔离，不污染正式组件表。

### 22.4 验收

`npm run test:a2ui:progressive` **25/25**：阶段口径同源、实现/准入能力分离、服务端关卡逐条合法且与本地同构、`takeServerPlay` 拒绝全部不可信路径、渐进流与完整流等价、分块数与 root 位置、SSE 编排顺序、前端预览层生命周期、静态白名单登记。既有 `test:a2ui:server` / `test:a2ui:bridge:browser` / `test:a2ui:visual` 等全量回归未受影响。

**仍未做**（与 §20.8 相同）：`classifyQuestion()` 已进编译链但仍不影响 `phaseFor()`，学习过程仍按学科粗判；要让题型识别影响 60 组配方需先做观测打点。

---

## 二十三、点一点知知：IP 形象语音提问（2026-11-12 追加）

### 23.1 交互

直接点击首页**顶栏 logo 里的知知**或**右下角 dock 的知知**，立即用当前全局音色随机朗读一句询问需求的话，同时弹出对话框显示这句话与当前音色；用户把需求写进弹框（或用快捷需求），点「开始讲解」即走原有主流程生成互动讲解。另有「再听一遍」「换一句问」「停止朗读」与 Ctrl/⌘+Enter。

### 23.2 实现要点

- 新增 `mascot-chat.js`（UMD 双端）：8 条通用问句 + `early/primary/teen/senior` 各档专属问句，`pickGreeting()` 随机且不与上一句重复；阶段复用矩阵的 `stageOf()`，与配方同一套口径。
- **语音只走一条链路**：`window.speakText` → `voice.js`，因此形象工坊选中的 103 个音色、口型同步、服务不可用自动回退全部生效；语音模块缺失时退回 `ZhidaoVoice.speak()`。
- **弹框不复制生成逻辑**：提交时把文本写回 `#topic-input`、派发 `input`、关闭弹框、`#start-button.click()`，交给 `dynamic.js → /api/tutor`。
- 点击用 **capture 阶段**拦截并 `stopPropagation()`：既阻止 `<a class="brand">` 的滚回顶部，也避免 mascot.js 的全局点击委托把这次点击误判成别的互动；`role=button` / `tabindex=0` / Enter/Space 保证键盘可达。
- 弹框内小形象复用 `ZhidaoMascot.renderHosts()`；动态文本只经 `esc()`，不解释 HTML。

### 23.3 验收

`npm run test:mascot-chat` **67/67**（文案池、随机边界、年级适配、音色状态行、输入归一化、XSS、DOM 替身下的 openChat/submit 全链路、静态登记）；`npm run test:mascot-chat:browser` **33/33**（真实 Edge：点击顶栏/dock/键盘唤起、TTS 请求体带 `zm_009` 且 `input` 等于弹框问句、换一句/再听一遍、需求提交到 `/api/tutor` 并生成讲解、服务离线切回 `SpeechSynthesisUtterance`、无脚本错误）。截图：`cache/shots/mascot-chat.png`、`mascot-chat-offline.png`、`mascot-chat-lesson.png`。


---

## 二十四、按学科配音：英语课用英语口音（2026-11-12 追加）

### 24.1 目标

「如果识别为英语，IP 形象就用英语的发音角色」——并可在形象工坊里**按学科**配置，留有合理默认。

### 24.2 数据与默认值

`voice.js` 的设置项新增 `subjectVoices`（与 `voice` / `mode` / `base` / `speed` 同存 `zhidao-voice-settings-v1`）：

| 学科 | 槽位默认值 | 可选音色 | 是否可「跟随默认」 |
| --- | --- | --- | --- |
| 语文 | `auto` | 中文音色（`zf_` 55 + `zm_` 45） | 是 |
| 英语 | `af_maple` | 英文音色（`af_` 2 + `bf_` 1） | 否（跟随默认会变中文口音） |
| 数学 | `auto` | 中文音色 | 是 |

`auto` 表示跟随「主音色」（工坊顶部那个下拉），所以主音色仍是全局兜底；老配置没有 `subjectVoices` 时按上表补齐，升级不需要清缓存。

### 24.3 解析规则（`resolveVoice(text, subject)`）

1. 学科专用音色与**文本语种**一致 → 直接用；
2. 否则用主音色（若语种一致）；
3. 再否则在其它学科槽位里找一个语种匹配的；
4. 兜底返回主音色。

语种判定 `detectLang()`：纯拉丁字母 → `en`；含中日韩汉字 → `zh`；中英混排按字符数量多数决。`voiceLang()` 由音色前缀得到语种（`zf_`/`zm_` → zh，`af_`/`bf_` → en）。

这样「英语课读英文例句」用 `af_maple`，「英语课读中文讲解」自动回落中文音色——不会出现中文被英文口音念的情况。

### 24.4 学科同步点

| 位置 | 行为 |
| --- | --- |
| `app.js updateDetection()` | 输入框识别出学科即 `ZhidaoVoice.setSubject(cls)` |
| `app.js renderLesson()` | 进入课程时同步学科 |
| `mascot.js setSubject()` | 形象随学科换装时同步（覆盖 A2UI 动态课程，学科来自 `.topic-banner`） |
| `a2ui-render.js speak()` | renderer function 朗读时带上当前学科 |
| `mascot-chat.js` | 点知知提问：英语学科用英文问句池 + 英语音色，弹框状态行写明当前音色 |

### 24.5 验收

- `npm run test:voice` **103/103**（学科槽位默认值、语种判定、解析优先级、实际请求体走英语音色、显式音色覆盖、非法槽位忽略、`auto` 随主音色变化）。
- `npm run test:voice:browser` **33/33**（真实 Edge：工坊三个学科下拉、英语槽位默认 `af_maple`、语文/数学带「跟随默认」、英语课读英文请求体 `af_maple`、读中文回落 `zm_009`、改槽位立即生效、服务离线回退浏览器语音）。
- `npm run test:mascot-chat` **78/78**（英文问句池 4 条、当前学科读取、按学科展示音色）。
- 截图：`cache/shots/voice-subject-voices.png`。
