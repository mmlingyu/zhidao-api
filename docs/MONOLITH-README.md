# 知岛 · 让知识有画面

面向家长与学生的互动知识讲解应用：输入一个知识点，自动判断学科（语文 / 英语 / 数学），
按该学科的方式展开讲解，并支持追问。

服务为 Node.js 原生静态 + API 服务，无 Web 框架依赖。

---

## 快速开始

```bash
npm install                 # 安装依赖（含 face-api / tfjs-wasm / ioredis）
cp .env.example .env        # 复制配置模板并填入密钥
npm run build:face          # 复制浏览器端人脸模型与 wasm 到 public/
npm start                   # 启动服务
```

默认监听 `http://127.0.0.1:3000`。

---

## 核心能力

| 能力 | 说明 |
|---|---|
| 学科决策 | Liquid `d1.1` 决策模型判断语文 / 英语 / 数学；置信度不足时按启发式规则兜底 |
| 互动讲解 | 分学科生成结构化课程：语文（成语 + 诗句）、英语（辨析 + 练习）、数学（三层解法） |
| 两阶段串行进度 | 首页进度面板分别显示「学科决策」与「讲解分析」的真实耗时 |
| 多轮追问 | 基于当前课程继续追问，答案随上下文生成 |
| 持久化缓存 | Redis 优先，本地 JSON 降级；缓存键隔离模型与提示词版本，重启不丢 |
| 用户体系 | 家长注册、家庭成员管理、年级选择、口令登录、人脸注册与登录 |
| PWA | 可添加到主屏幕，离线可打开界面；窄屏显示安装引导 |
| IP 形象 | 「知知」可换装、可编辑，朗读时口型同步 |
| 全局语音 | 浏览器默认音色 / 知知语音服务（Kokoro TTS，103 个男女音色）；服务不可用自动回退 |
| 点一点知知 | 点首页 IP 形象即用当前音色随机 TTS 提问，弹框写下需求可直接发起讲解 |

---

## 模型配置

全部通过 `.env` 控制，页面也能按请求临时切换，无需重启。

```bash
GENERATION_PROVIDER=liquid          # 默认生成模型：liquid | qwen
GENERATION_MODEL=lfm3-1.7b          # 留空则用 provider 默认值
GENERATION_BASE_URL=                # 留空则用 provider 默认地址
GENERATION_API_KEY=                 # 留空则读 provider 对应的密钥变量
ALLOW_GENERATION_FALLBACK=true      # 主模型失败时是否自动换另一家
JSON_AGENT_REPAIR=1                 # 小模型输出非法 JSON 时的自愈重写次数（0 关闭，最多 2 次）
LIQUID_REASONING_EFFORT=none        # Liquid 推理开关，none 最省 token 也最快
```

- 决策模型：`JEV_API_KEY` / `JEV_BASE_URL` / `JEV_ENDPOINT` / `JEV_MODEL` / `JEV_MIN_CONFIDENCE`
- 备用决策：`ALLOW_QWEN_ROUTE_FALLBACK=false` 可关闭低置信度兜底

---

## 语音服务与音色配置

所有朗读统一走 `voice.js`：`[data-speak]` 按钮、A2UI 的 renderer function `speak`、
游戏组件的连续朗读与 `stopVoice` 中断共用一条链路。默认就是浏览器自带语音，零依赖。

本机（或局域网）运行 [Kokoro TTS API](http://127.0.0.1:8880/docs)（OpenAI 兼容）时，
在 **形象工坊 → 音色 VOICE** 切到「知知语音服务」，即可选用服务支持的全部音色：

| 分组 | 数量 | 前缀 |
| --- | --- | --- |
| 女声 · 中文普通话 | 55 | `zf_` |
| 女声 · 美式英语 | 2 | `af_` |
| 女声 · 英式英语 | 1 | `bf_` |
| 男声 · 中文普通话 | 45 | `zm_` |

共 **103 个音色**，清单由 `GET /v1/audio/voices` 实时读取；服务暂时连不上时用内置同名清单展示。
选择后立即写入本机 `localStorage`（`zhidao-voice-settings-v1`），**全局朗读立即生效**，无需重启服务；
「试听一下」用当前音色读一句话。音色配置与形象外观分开保存，「恢复默认造型」不会改音色。

播放走 `POST /v1/audio/speech`（`model=kokoro`、`response_format=mp3`、`stream=false`），
返回 `audio/mpeg` 由浏览器 `Audio` 播放，并按音频时长模拟 `onboundary` 驱动知知口型。
服务地址默认 `http://127.0.0.1:8880`，可在工坊里修改（手机访问时填电脑的局域网地址）。

### 按学科配音（英语课自动用英语口音）

工坊的「按学科配音」区可以为**语文 / 英语 / 数学**分别指定知知的音色：

| 学科 | 默认 | 可选范围 |
| --- | --- | --- |
| 语文 | 跟随默认音色（`zf_001`） | 中文音色 100 个 + 「跟随默认音色」 |
| 英语 | `af_maple`（美式女声） | 英文音色 3 个（`af_` / `bf_`） |
| 数学 | 跟随默认音色（`zf_001`） | 中文音色 100 个 + 「跟随默认音色」 |

朗读时按**当前学科 + 文本语种**两个条件解析音色：

1. 学科专用音色与文本语种一致 → 直接用（英语课读英文 → `af_maple`）；
2. 否则回落默认音色（英语课读中文讲解 → 默认中文音色，不会出现中文被英文口音念）；
3. 再不行才按语种找其它学科的音色。

切换规则：首页输入框识别出学科、进入新课程、形象随学科换装时都会同步当前学科；
点「知知」提问时英语学科用英文问句、语文与数学用中文问句，弹框里会写明当前用的哪个音色。

**自动回退**：服务不存在 / 超时 / 返回不是音频 / 浏览器拦截自动播放时，
`ZhidaoVoice` 会把 `available` 置为 `false`，本次及后续朗读改回浏览器默认音色，
工坊状态行明确提示「语音服务未连接 · 已回退浏览器默认」，不会出现点了没声音。
配置仍保留，服务恢复后刷新页面或重开工坊即可继续用。

> 浏览器直连语音服务（该服务已开放 CORS，`access-control-allow-origin: *`）；
> Service Worker 只处理同源请求，不会拦截跨域音频请求。

### 点一点知知（IP 形象语音提问）

直接点**顶栏 logo 里的知知**或**右下角 dock 的知知**（键盘可 Tab 后按 Enter），
立即用当前全局音色随机朗读一句询问需求的话，并弹出对话框显示这句话与正在使用的音色。
在框里写下想学什么、点个快捷需求，按「开始讲解」或 Ctrl / ⌘ + Enter，
就会把需求写回首页输入框并触发原有生成流程；另有「再听一遍」「换一句问」「停止朗读」。

实现见 `mascot-chat.js`：8 条通用问句 + 按认知阶段微调的专属问句，阶段沿用 A2UI 矩阵的 `stageOf()`；
朗读只经 `speakText → voice.js`，所以工坊里选的音色、口型同步、服务离线自动回退全部生效；
弹框不复制生成逻辑，提交只做「写回 `#topic-input` → `#start-button.click()`」。
效果截图 `cache/shots/mascot-chat.png`、`mascot-chat-offline.png`；设计说明见文档 §23。

```bash
npm run test:voice              # 70 项：音色分组、配置、探测、请求体、四种失败回退、主流程接线
npm run test:voice:browser      # 真实 Edge：工坊控件、全局生效、离线回退（需 3100 + 8880）
npm run test:mascot-chat        # 点知知模块 67 项（文案池、弹框、提交、静态接线）
npm run test:mascot-chat:browser # 真实 Edge 33 项（点击形象、TTS 请求体、提交、离线回退）
```

---

## 缓存与存储

```bash
CACHE_BACKEND=redis                 # redis | local
REDIS_URL=redis://127.0.0.1:6379/0  # 本机或云端 Redis
CACHE_TTL_DAYS=30
CACHE_MAX_ENTRIES=300
```

用户体系同样可用 Redis 或本地目录（`USER_STORE_DIR`），会话有效期 `USER_SESSION_DAYS`（默认 30 天）。

---

## 人脸登录

浏览器端 `@vladmandic/face-api` + `@tensorflow/tfjs-backend-wasm`（wasm 离线运行，不依赖 CDN）：

1. 客户端检测人脸并提取 128 维特征，只上传向量，**不存原始人脸图片**；
2. 服务端按欧氏距离匹配，阈值 `USER_MATCH_THRESHOLD`（默认 `0.28`），并有混淆保护；
3. 采集 3 张不同角度可显著提升准确率。

> 摄像头需要**安全上下文**：`https://` 或 `http://localhost`。
> 手机访问局域网 IP 属于非安全上下文，需配置 HTTPS 后才能使用人脸登录。

### 模型加载失败怎么排查

旧版本把任何失败都包装成「人脸模型加载失败，请检查网络后重试」，实际原因可能是部署缺文件、
Service Worker 缓存了旧的 404、或浏览器初始化不了 wasm。现在：

- 服务端公开 `GET /api/face-assets`（`/api/health` 里也有 `face.ready`），逐个报告 8 个必需资源；
- 加载器分阶段报错，带上失败的 URL、HTTP 状态和下一步动作；控制台可看 `window.FACE.status()`；
- 计算后端按 `wasm → webgl → cpu` 自动降级，个别浏览器没有 SIMD / WebGL 也能继续用；
- 加载前清掉缓存里的历史错误响应，首次失败再清空 `/model`、`/vendor` 缓存并带 cache-busting 重试一次；
- SW 升到 `zhidao-shell-v12`，模型资源改为**网络优先 + 只缓存 2xx**，离线时回退本地缓存；
- 人脸始终只是可选增强：失败时弹窗直接高亮「改用口令登录」，注册/登录不受阻断。

排查顺序：`curl http://127.0.0.1:3000/api/face-assets` → 若 `ready:false`，执行 `npm run build:face` 并重启服务；
若 `ready:true` 仍失败，在页面控制台执行 `FACE.status()` 看 `lastError.stage / url`，
或在身份弹窗点「重试加载模型」。

---

## 账号与登录

面向家长与学生两类角色，一个家庭共用一个「家庭空间」。

| 环节 | 方式 | 说明 |
|---|---|---|
| 注册家长 | 称呼 + 孩子年级 + 选填口令 + 选填人脸 | 人脸不是必填 —— 没有摄像头也能先用口令登录，之后随时补录 |
| 添加孩子 | 称呼 + 年级 + 选填口令 + 选填人脸 | 家长可给每个孩子单独设口令 |
| 口令登录 | **账号（称呼或账号 ID）+ 口令** | 账号可直接填注册时的称呼；同名时改用账号 ID |
| 人脸登录 | 对着摄像头 | 需先录入人脸，家庭内自动识别成员 |

**年级列表**：`GET /api/grades` 是公开接口。注册弹窗对未登录用户开放，所以年级不能只从需要鉴权的 `/api/me` 拿 —— 否则游客看到的是空下拉框。

**同名保护**：按姓名登录时若命中多个账号，服务端返回 409 并提示改用账号 ID，避免登录到别人的家庭。成员管理页会展示当前账号的 ID。

---

## 成语质量保障

`idioms.json` 是内置的成语词库（29513 条，来源：中华新华字典成语库 + 常用成语补充），`idioms.js` 提供查询。

解决的问题：1.7B 小模型常把科学术语或自造短语当成成语（如「卡尔文循环」「蔚蓝天空」）。

- 校验阶段用词表判定真伪，不真实则拦截并触发自愈；
- 自愈提示词附带**真实成语候选**，让模型「照抄」而不是凭空造词；
- 词表命中后用**权威拼音与释义**覆盖模型输出（模型拼音常有声调错误）；
- 数量多给的字段（如 idioms 给 5 项）先裁剪再校验，避免「内容都对只多一项」被整体判失败。

---

## 测试

```bash
npm run check          # 全部文件语法检查
npm run test:cache     # 缓存层（34 项）
npm run test:redis     # Redis 后端与公网加固（33 项）
npm run test:models    # 模型切换、缓存键隔离、回退策略（29 项）
npm run test:users     # 用户体系 + 本地库落盘命名（41 项）
npm run test:idioms    # 成语质量与数量归一化（18 项）
npm run test:knowledge # 掌握度引擎、课标目录、卡片仓储、年级画像（46 项）
npm run test:a2ui      # A2UI 协议、组件目录、能力协商、编译器（32 项）
npm run test:matrix    # 学科组件矩阵 60 组配方（21 项）
npm run test:a2ui:components  # 51 个组件渲染器全覆盖（12 项）
npm run test:a2ui:play        # 游戏化关卡编译器与交互控制器（18 项）
npm run test:a2ui:bridge      # 课程 JSON ↔ A2UI 桥接与三科归一（30 项）
npm run test:a2ui:server      # 服务端编译 / SSE 下发 / 能力协商（19 项，自带 MOCK 服务）
npm run test:a2ui:map         # 20 类问题 / 40 条样例 ↔ 组件映射表（18 项）
npm run test:a2ui:games       # 19 个游戏组件四批完成门槛（45 项）
npm run test:a2ui:progressive # 阶段口径收敛 / P3 关卡服务端化 / 渐进式下发（25 项）
npm run build:a2ui:roadmap    # 重新生成组件总览文档与可视化页
npm run test:a2ui:roadmap:browser # 总览页离线交互回归（12 项，真实 Edge）
npm run test:a2ui:games:browser # 19 个游戏组件真实点击回归（48 项，需 3100 MOCK）
npm run test:voice         # 全局语音：音色分组、配置、探测、回退、接线（70 项）
npm run test:voice:browser # 音色真实浏览器端到端（需 3100 + 8880）
npm run test:mascot-chat        # 点知知：随机问句、弹框、提交（67 项）
npm run test:mascot-chat:browser # 点知知真实浏览器端到端（33 项，需 3100 + 8880）
npm run test:ui        # 前端端到端（28 项，需先启动服务）
npm run test:signup    # 注册登录全链路（34 项，需先启动服务）
npm run test:face      # 人脸资源清单 / 自检接口 / 加载器与 SW 策略（41 项，需先启动服务）
npm run test:face:browser # 人脸真实浏览器：脏缓存自愈 / 后端降级 / 报错与口令兜底 / 离线（20 项）
```

浏览器专项（需先启动服务或 MOCK 实例，默认 `http://127.0.0.1:3100`）：

```bash
npm run test:a2ui:browser  # A2UI 交互回归（30 项，真实 Edge）
npm run test:a2ui:bridge:browser # 主流程桥接端到端（34 项，真实 Edge + MOCK）
npm run test:a2ui:visual   # 与改造前基线逐像素对比（先 --baseline 采集）
npm run test:a2ui:games:browser # 19 个游戏组件真实点击 + 19 张效果图 → a2ui-games.html
npm run test:a2ui:cases    # 采集 14 张交互案例截图并生成自包含画廊
npm run test:a2ui:gallery  # 采集 35 张组件 / 配方效果图 → a2ui-components.html
npm run test:a2ui:play:shots # 6 张真实点击状态 + 可交互关卡 → a2ui-play.html
```

`test:a2ui:visual` 对比 DOM 结构、40+ 计算样式与截图像素；基线文件是 `cache/shots/a2ui-baseline.json`。
测试页会拦截公网字体请求并等待 `document.fonts.ready`，避免 Google Fonts 加载状态影响逐像素对比。
`test:a2ui:cases` 输出 `cache/shots/a2ui-cases.html`（图片内嵌，可直接打开）：8 个 P0 交互案例 +
6 个学科组件矩阵案例 + 12 行配方总览 + 差别对照表。
`test:ui` 用真实浏览器覆盖用户体系、移动端布局与 PWA，截图输出到 `cache/shots/`。
`test:a2ui:gallery` 与 `test:a2ui:play:shots` 自带静态服务，不需要启动 `server.js` / Redis / 模型；
`a2ui-play.html` 把演示关卡用 `srcdoc` 内联，单个 HTML 文件即可离线点击。
`test:signup` 覆盖注册 → 添加孩子 → 退出 → 口令重新登录 → 同名保护 → 移动端注册全流程；
headless 下无摄像头，脚本会注入人脸采集替身，因此走的是真实的前端表单链路而非直接调接口。
可用 `UI_TEST_URL` 指定其他地址，默认 `http://127.0.0.1:3000`。

---

## 知识卡片与年级适配

家长登录后点侧栏「知识库」，可以看到孩子的四个卡片包（需巩固 / 已掌握 / 正在学 / 还没开始）、
掌握率和按年级课标列出的待学知识点。卡片翻面可查看学习证据时间线并手动确认掌握。

顶栏年级选择器决定讲解深度与界面形态：学生登录后自动带出自己的年级，家长/游客可手动切换。
孩子做题时会有视觉、听觉（Web Audio 合成）与心理三层反馈，语气和庆祝强度随年龄段变化。

完整设计与实现说明见 [docs/KNOWLEDGE-CARDS.md](docs/KNOWLEDGE-CARDS.md)。
「诗文与名句」「试着写一句」会按年级给出一句操作提示（`grade-profile.js` 的 `HINTS`），
生成侧字段约束同步注入提示词；年级切换不刷新页面即可看到提示与完成门槛变化。

A2UI 生态选型与「知识 → 交互组件」的落地路线见 [docs/A2UI-KNOWLEDGE-UI.md](docs/A2UI-KNOWLEDGE-UI.md)。

**P0 已落地**：语文「诗文与名句 + 试着写一句」改由自定义 catalog 描述，
`a2ui-catalog.js`（协议 + 组件白名单 + 年级能力）→ `a2ui-compiler.js`（课程 JSON 确定性编译成
`createSurface` / `updateComponents` / `updateDataModel` 消息流）→ `a2ui-render.js`（零依赖渲染 +
统一 action 分发）。模型仍只产教学内容，服务端 `/api/tutor` 响应与缓存完全未动；
年级提示、朗读文本、完成门槛全部由编译器从 `grade-profile.js` 取，浏览器不再手写模板。
朗读改为 renderer function `speak`，与 `[data-speak]` 共用 `app.js` 的 `speakText()`。
实测一年级 / 初二与改造前 **DOM、计算样式零差异**；初二像素零差异，一年级 0.643%
（固定字体后的抗锯齿微差，1% 容差内）。

**学科组件矩阵**：`a2ui-matrix.js` 把「用什么组件」数据化为
3 学科 × 4 学习过程（初识 / 练习 / 强化 / 迁移）× 5 认知阶段 = 60 组配方，
`compileKnowledgeToA2UI()` 按配方生成组件树，新增 `ChoiceQuiz` / `StepReveal` / `FormulaBlock` 等组件。
启蒙期 2 选项、线性分步、公式降级为提示条；初二 4 选项、全展开、允许公式。
硬规则：知识不删（降级而非隐藏）、正确答案不被认知负荷裁掉、步骤正文始终可见。
14 张实测交互案例截图与差别对照见 `cache/shots/a2ui-cases.html`，设计说明见文档 §13 / §14。

**P3 游戏化关卡与 IP 求助**：`a2ui-play.js` 新增 6 个组件（NumberGaps / QuestHUD / VoiceGuide /
AskIP / QuickQuestions / HintLadder），catalog 当时扩到 32 个且全部可渲染（19 个游戏组件落地后为 51 个）。低龄是深紫游戏化关卡 +
星星 + 语音引导 + 知知三级提示；初二同一组件树换成浅色克制界面、星星收起、求助改名「查看思路提示」。
求助不会一点就给答案，快捷问题走预设问答，模型只提供题目数据。
6 张真实点击状态截图与可交互演示见 `cache/shots/a2ui-play.html`（单文件离线可用），
35 张组件效果图见 `cache/shots/a2ui-components.html`，设计说明见文档 §16。

**主流程打通**：`a2ui-bridge.js` 把 `/api/tutor` 的同一份课程 JSON 按
「学科 × 学习过程 × 年级」编译成 A2UI 消息流，挂进语英数三科主流程；
组件区在原 `.two-column` 之外，P0 语文 surface 与逐像素基线不动。
数学在练习/强化、题目含数字或找规律关键词、掌握度 < 80 时，
会在同一容器追加游戏化关卡与知知求助；年级只换主题与文案，不删组件。
作答走 `updateDataModel` 回写，练习证据进知识卡片。
4 张真实主流程截图与触发条件见 `cache/shots/a2ui-bridge.html`，设计说明见文档 §17。

**组件总览与 19 个游戏交互组件（P4a–P4d 已全部落地）**：`a2ui-question-map.js` 是「用户问题 → 配方 → UI」的单一事实来源：
8 个问题域 / 20 类真实提问 / 40 条提问样例；题型命中后由 `a2ui-games.js` 的**四道闸门**（已实现 / 过程允许 / 能力允许 / 本课有真实数据）决定是否追加一张游戏卡，
识别不了返回 `null`，组件树原样走 60 组配方，DOM / 逐像素基线零差异。
19 个组件按风险递增分四批实现：**P4a 选择器型（6）**、**P4b 拼装型（6，共用 `/assembly/*` 契约与撤销栈）**、
**P4c 语音与开放产出（4，只记 created / asked / recited）**、**P4d 图形与情境（3，CSS 固定形状、低龄禁真实倒计时）**；
`a2ui-catalog.js` 从 32 扩到 **51 个组件**且全部可渲染。四批完成门槛逐条验收：`test:a2ui:games` 45/45、
`test:a2ui:games:browser` 48/48（真实 Edge 点击），19 张效果图与可交互画廊见 `cache/shots/a2ui-games.html`。
由 `npm run build:a2ui:roadmap` 自动生成 [docs/A2UI-COMPONENT-ROADMAP.md](docs/A2UI-COMPONENT-ROADMAP.md)
与可按域 / 批次 / 关键词筛选的单文件总览页 `cache/shots/a2ui-roadmap.html`；设计说明见文档 §19 / §20。

**协议来源与三项技术债**：消息语义借鉴 Google 开源的 A2UI（v0.9+ / v1.0），但组件目录、编译器、渲染器全是本项目自研，
不是官方 SDK 接入，也未实现官方 A2A / AG-UI / `callRendererFunction` 等完整规范（逐项对照见文档 §21）。
此前挂在 §20.8 的三项债已全部收尾：阶段口径收敛到 `a2ui-matrix.js`、P3 关卡服务端编译下发、
`a2ui-stream.js` 渐进式 `updateComponents` 分块推流（验收 `test:a2ui:progressive` 25/25，见 §22）。
仍未做：让 `classifyQuestion()` 影响 `phaseFor()` 与 60 组配方（需先做题型信号观测打点）。

**服务端化（P1）**：编译器搬进 `server.js`，`/api/tutor` 直接返回 `a2ui` 消息流
（普通 JSON 走 `result.a2ui.jsonl`，SSE 多一条 `a2ui` 事件），浏览器只 `split('\n')` 逐条 `feed()`。
能力协商改成「浏览器宣告自己画得出的组件（`rendererCapabilities().implemented`），
服务端按年级 × 学科 × 学习过程收窄，只能收窄不能放宽」；阶段准入永远由服务端按年级计算。
编译失败、消息校验不过、年级错位时服务端不下发消息流，前端自动回退本地编译——
两条路径产出的消息流逐条一致（`test:a2ui:server` 有同构断言）。
组件区标题会标出「消息流来自服务端 / 浏览器本地编译」，方便现场判断链路。
设计说明见文档 §18。
复现：`npm run test:a2ui:bridge`、`npm run test:a2ui:bridge:browser`（需 3100 端口 MOCK 服务）。

> 边界：服务端 `/api/tutor` 已直接下发 A2UI JSONL（§18），浏览器逐条 `feed()`；
> `test:a2ui:server` 断言服务端与本地编译两条路径产出的消息流逐条同构，校验不过自动回退本地编译。

新增接口：`GET /api/cards/board`、`POST /api/cards/record`、`POST /api/cards/:id/mark`、
`GET /api/learner/profile`；`/api/tutor` 与 `/api/followup` 支持可选 `grade`。
卡片数据与用户体系同构：Redis 优先、本地 JSON 兜底，重启不丢。

---

## 移动端

当前形态为响应式 Web + PWA。移动端适配细节、iOS 限制与后续 App / 小程序路线见 [docs/MOBILE.md](docs/MOBILE.md)。
