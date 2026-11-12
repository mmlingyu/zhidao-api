# 知识交互组件总体概览 · 问题 → 配方 → UI

> 面向开发者的**单一事实来源**。回答两个问题：①「什么样的用户问什么样的问题，会看到什么样的 A2UI」；②「下一个组件该怎么加、按什么顺序加」。
>
> 生成日期 2026-11-12 · 数据源 `a2ui-question-map.js` + `a2ui-catalog.js` · 由 `npm run build:a2ui:roadmap` 自动生成，请勿手改表格。
> 可视化页：`cache/shots/a2ui-roadmap.html`（单文件离线，可按域 / 批次 / 关键词筛选）。

---

## 零、一页速览

**现状**：3 学科 × 4 学习过程 × 5 认知阶段 = **60 组配方**；**51 个已实现组件**（32 个基础 + 19 个游戏交互组件）；服务端 `/api/tutor` 编译下发 A2UI v1.0 JSONL，浏览器白名单渲染、动作回写 `updateDataModel` 与知识卡片证据。数学原有 6 个游戏化组件按条件追加关卡。**8 个问题域 / 20 类用户提问 / 40 条真实提问样例**已全部接入题型识别；19 个游戏组件按 P4a–P4d 四批落地，逐批门槛均已验收。

**决策链**（一次提问从进来到出现 UI）：

```
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
```

**最容易记错的一条**：年级**不决定有没有组件**，只决定组件长什么样（密度、选项数、口气、奖励强度）。组件删减只发生在「渲染器画不出来」的降级链上。

---

## 一、现状盘点（已落地，勿重复造）

### 1.1 五个维度分别是谁决定的

| 维度 | 取值 | 由谁决定 | 代码位置 |
| --- | --- | --- | --- |
| 学科 | 语文 / 英语 / 数学 | 决策模型 + 启发式兜底 | `server.js` · `models.js` |
| 学习过程 | 初识 / 练习 / 强化 / 迁移 | 学科粗判 + 是否已作答；未来按题型 + 掌握度细化 | `a2ui-bridge.js` `phaseFor()` |
| 认知阶段 | 启蒙 / 基础 / 进阶 / 青少年 / 高中 | **年级**（学习者档案），客户端不能改写 | `grade-profile.js` `stageForGrade()` |
| 配方 | 3 × 4 × 5 = 60 组 | `recipeFor(subject, phase, grade)` | `a2ui-matrix.js` |
| 能力 | 组件白名单 / 数量 / 文本长度 | 服务端基准 ∩ 客户端 `implemented`（只能收窄） | `a2ui-catalog.js` · `server.js` `negotiateCapabilities()` |

### 1.2 已实现的 51 个组件

- **容器与基础（11）**：`Column`、`Card`、`Row`、`List`、`Text`、`Button`、`TextField`、`CardHeading`、`HintBar`、`Feedback`、`EmptyState`
- **语文 / 通用（7）**：`PoemLine`、`SpeakButton`、`WritingPad`、`WordChips`、`IdiomCard`、`Tabs`、`MethodNote`
- **英语 / 选择（4）**：`ChoiceQuiz`、`WordCard`、`PictureChoice`、`MatchPairs`
- **数学 / 分步（4）**：`StepReveal`、`FormulaBlock`、`NumberLine`、`MasteryRing`
- **P3 游戏化（6）**：`NumberGaps`、`QuestHUD`、`VoiceGuide`、`AskIP`、`QuickQuestions`、`HintLadder`
- **P4a 选择器型（6）**：`PoemChain`、`ImageryBoard`、`StoryOrder`、`LookAlike`、`RhetoricMatch`、`GrammarDoctor`
- **P4b 拼装型（6）**：`PoemTiles`、`RadicalTiles`、`SentenceBlocks`、`LetterTiles`、`ColumnArithmetic`、`BalanceScale`
- **P4c 语音与开放产出（4）**：`StoryBranch`、`RoleVoice`、`StrokeOrder`、`TenseTimeline`
- **P4d 图形与情境（3）**：`SpeedRound`、`UnitStrip`、`ShapeSplit`

组件协议、降级链、消息校验见 `docs/A2UI-KNOWLEDGE-UI.md` §12 / §18。P3 游戏化关卡的触发条件与截图见 §16 / §17。

### 1.3 现在什么条件会触发游戏化关卡

| 条件 | 规则 |
| --- | --- |
| 学科 | 仅数学 |
| 学习过程 | 练习 / 强化；初识不打扰 |
| 题目形态 | 含数字，或命中找规律 / 填空 / 计算 / 数列等关键词，或模型给 `data.puzzle` |
| 掌握度 | 低于 80 分才出现 |
| 年级 | 不禁用组件，只换主题与文案（低龄深紫星星 / 初二浅色克制） |

> 这四条是 P3 数学关卡的规则。19 个游戏组件不套用它，而是走 `a2ui-games.js` 的**四道闸门**：题型命中且已实现 / 学习过程允许 / 能力集允许 / 本课派生出了真实数据；任一不满足就完全不挂，识别不了返回 `null`，组件树原样不动。诗词 / 故事 / 语法等域各有自己的触发条件（见 §二 的「学习过程」列），且「没有唯一答案」的开放题一律不弹判定型关卡。

---

## 二、用户会问什么 · 问题类型全表

`signals` 是主题弱信号（命中 +2），`strong` 是题型叫法（命中 +4，用来压过同一句里顺带出现的学科词，例如「加法**口算**」「**平均分成**」）。含数字只在**已有文字信号**时 +1，避免把 `<script>alert(1)</script>` 判成数学题。识别不了返回 `null`，由原 60 组配方兜底，绝不强行分类。

| 题型 ID | 用户会怎么问 | 学科 | 学习过程 | 主 UI 组件 | 批次 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| `poem.complete` | 「床前明月光」的下一句是什么？ | 语文 | 初识 / 练习 / 强化 | `PoemChain` | P4a | ✅ 已实现（P4a） |
| `poem.assemble` | 把这几句诗碎片拼回原样 | 语文 | 练习 / 强化 | `PoemTiles` | P4b | ✅ 已实现（P4b） |
| `poem.imagery` | 「孤舟蓑笠翁」写的是什么画面？ | 语文 | 初识 / 练习 | `ImageryBoard` | P4a | ✅ 已实现（P4a） |
| `story.sequence` | 这个故事先发生了什么？ | 语文 | 练习 / 强化 | `StoryOrder` | P4a | ✅ 已实现（P4a） |
| `story.choice` | 如果你是小明，你会怎么做？ | 语文 | 练习 / 迁移 / 应用 | `StoryBranch` | P4c | ✅ 已实现（P4c） |
| `story.dialogue` | 帮我把这段对话分角色读一遍 | 语文 | 初识 / 练习 | `RoleVoice` | P4c | ✅ 已实现（P4c） |
| `hanzi.structure` | 「清」是什么偏旁？ | 语文 | 初识 / 练习 | `RadicalTiles` | P4b | ✅ 已实现（P4b） |
| `hanzi.stroke` | 这个字的笔顺是怎样？ | 语文 | 初识 / 练习 | `StrokeOrder` | P4c | ✅ 已实现（P4c） |
| `hanzi.lookalike` | 「己」和「已」怎么区分？ | 语文 | 练习 / 强化 | `LookAlike` | P4a | ✅ 已实现（P4a） |
| `reading.device` | 「月亮像小船」用了什么修辞？ | 语文 | 练习 / 迁移 / 应用 | `RhetoricMatch` | P4a | ✅ 已实现（P4a） |
| `grammar.tense` | yesterday 后面动词要用什么形式？ | 英语 | 初识 / 练习 / 强化 | `TenseTimeline` | P4c | ✅ 已实现（P4c） |
| `grammar.order` | 用这几个词连成一句话 | 英语 | 练习 / 迁移 / 应用 | `SentenceBlocks` | P4b | ✅ 已实现（P4b） |
| `grammar.fix` | He go to school 哪里错了？ | 英语 | 练习 / 强化 | `GrammarDoctor` | P4a | ✅ 已实现（P4a） |
| `vocab.spell` | apple 怎么拼？ | 英语 | 练习 / 强化 | `LetterTiles` | P4b | ✅ 已实现（P4b） |
| `calc.arithmetic` | 27 + 45 等于多少？ | 数学 | 练习 / 强化 | `ColumnArithmetic` | P4b | ✅ 已实现（P4b） |
| `calc.equation` | 3 + □ = 8，方框里填几？ | 数学 | 初识 / 练习 / 强化 | `BalanceScale` | P4b | ✅ 已实现（P4b） |
| `calc.drill` | 给我出 5 道加法口算 | 数学 | 强化 | `SpeedRound` | P4d | ✅ 已实现（P4d） |
| `calc.pattern` | 2、4、6、8，接下来是几？ | 数学 | 练习 / 强化 | `NumberGaps` | — | ✅ 原配方已覆盖 |
| `apply.wordproblem` | 小明有 5 颗糖，小红比他多 3 颗，一共几颗？ | 数学 | 初识 / 练习 / 强化 / 迁移 / 应用 | `UnitStrip` | P4d | ✅ 已实现（P4d） |
| `apply.geometry` | 把圆平均分成 4 份怎么切？ | 数学 | 初识 / 练习 / 强化 | `ShapeSplit` | P4d | ✅ 已实现（P4d） |

> 代码入口：`map.classifyQuestion(input, subject)` → `{ id, primary, phases, batch, alternatives }`；再加 `map.componentsFor(id, phase, grade)` 得到过程 / 年级约束；`games.selectGame()` 汇成四道闸门交给编译器。40 条真实提问样例由 `npm run test:a2ui:map` 全量断言。

### 2.1 同一个问题，换年级 / 换阶段会怎么变

| 提问 | 年级 / 阶段 | 过程 | 看到的 UI | 关键差别 |
| --- | --- | --- | --- | --- |
| 「床前明月光」下一句 | 一年级 · 启蒙期 | 初识 | `PoemLine` + `SpeakButton` + `HintBar`，大按钮、自动朗读 | 不弹游戏；一次一件事；句子 ≤ 12 字 |
| 同上 | 一年级 · 启蒙期 | 练习 | `PoemChain` 接龙，**2 个选项**，答对点亮一颗星 | 组件树还在，只把「读」换成「选」 |
| 同上 | 初二 · 青少年期 | 练习 | 仍是 `PoemChain` 接龙，**4 个选项** + 出处与意象注释 | 浅色克制、无星星、要求写依据 |
| 27 + 45 等于多少 | 三年级 · 基础期 | 练习 | `ColumnArithmetic` 竖式：逐位填、一次检查一格 | 不进位 / 进位分级，格子放大 |
| 同上 | 初二 · 青少年期 | 强化 | 同一竖式组件 + `MethodNote` 写清算理，不庆祝 | 掌握度 ≥ 80 时不再自动弹出 |
| He go to school 哪里错了 | 初一 · 青少年期 | 练习 | `GrammarDoctor`：高亮错误片段 → 四选一改法 → 朗读订正句 | 展示术语解释；不出现幼态夸奖 |

**读法**：横向看是「学科 × 题型」定组件，纵向看是「过程」定交互强度，斜向看是「年级」定皮肤与文案。三条轴互不覆盖。

---

## 三、19 个游戏交互组件规格（全部已实现）

每个组件都遵守同一份契约：**模型只给知识内容字段**（`modelFields`），乱序 / 选项数 / 按钮文案 / 年级口气由编译器确定性派生；所有交互走 `action → updateDataModel → 重渲染`，组件不自持状态；降级链必须指向已实现组件。

### 诗词与名句（语文 · 3 个）

| 组件 | 做什么 | 模型只给什么 | 动作 → 证据 | 降级到 | 年级适配 |
| --- | --- | --- | --- | --- | --- |
| `PoemTiles` · 诗句拼图 · **P4b** · ✅ 已实现 | 把一句诗拆成词块，点选放回原位；低龄一次只补一个空。 | lines: 诗句数组<br>distractors?: 干扰词块 | `placeTile` `undoTile` `checkPoem`<br>→ 练习答对（`correct`） | `WordChips` | 低龄：一次只亮一个空，词块 ≤ 4<br>高龄：整句重排，要求写出排序依据 |
| `PoemChain` · 诗句接龙 · **P4a** · ✅ 已实现 | 给上句选下句 / 给下句补上句，答对后自动接下一联。 | couplets: [{upper, lower, source?}]<br>options?: 备选项 | `pickLine` `nextCouplet` `readLine`<br>→ 练习答对（`correct`） | `ChoiceQuiz` | 低龄：两选项 + 朗读跟读<br>高龄：四选项 + 出处与意象注释 |
| `ImageryBoard` · 意境配画 · **P4a** · ✅ 已实现 | 给诗句选对应的画面 / 意象标签，把抽象的文字变成可指认的具体事物。 | lines: 诗句数组<br>imagery: [{label, line, note?}] | `pickImage` `readLine`<br>→ 练习答对（`correct`） | `PictureChoice` | 低龄：用具体名词（月亮 / 小船 / 霜），不出抽象词<br>高龄：意象 + 情感基调对照 |

### 故事与课文（语文 · 3 个）

| 组件 | 做什么 | 模型只给什么 | 动作 → 证据 | 降级到 | 年级适配 |
| --- | --- | --- | --- | --- | --- |
| `StoryOrder` · 情节排序 · **P4a** · ✅ 已实现 | 把打乱的情节卡拖回正确顺序，理解「先发生什么、再发生什么」。 | events: [{id, text}]<br>correctOrder: id 数组 | `moveEvent` `checkOrder` `readEvent`<br>→ 练习答对（`correct`） | `MatchPairs` | 低龄：3 张卡、只用「先 / 再 / 最后」<br>高龄：5–6 张卡 + 因果连线与依据 |
| `StoryBranch` · 故事分支 · **P4c** · ✅ 已实现 | 「如果你是主人公，你会怎么做」——分支选择没有标准答案，只给后果与追问。 | scene: 情境<br>choices: [{id, text, consequence, why}]<br>reflection?: 收束提问 | `chooseBranch` `askWhy` `readScene`<br>→ 独立完成（`created`） | `QuickQuestions` | 低龄：两个大按钮 + 知知复述后果<br>高龄：四选项 + 写出选择依据 |
| `RoleVoice` · 角色朗读 · **P4c** · ✅ 已实现 | 分角色点读对话，朗读时同步驱动知知口型与角色高亮。 | roles: 角色名数组<br>lines: [{role, text}] | `readLine` `nextLine` `replayLine`<br>→ 朗读复述（`recited`） | `SpeakButton` | 低龄：自动连读 + 大按钮<br>高龄：手动逐行 + 可关语音 |

### 汉字与字形（语文 · 3 个）

| 组件 | 做什么 | 模型只给什么 | 动作 → 证据 | 降级到 | 年级适配 |
| --- | --- | --- | --- | --- | --- |
| `RadicalTiles` · 部件拼字 · **P4b** · ✅ 已实现 | 把偏旁部件拼成一个字，理解合体字的结构。 | char: 目标字<br>parts: [{part, label?}]<br>distractors?: 干扰部件 | `combineParts` `clearParts` `checkChar`<br>→ 练习答对（`correct`） | `WordChips` | 低龄：2 个部件、给结构图<br>高龄：3 个部件 + 形旁声旁说明 |
| `StrokeOrder` · 笔顺跟写 · **P4c** · ✅ 已实现 | 按笔顺逐笔点亮，跟读笔画名；低龄只认顺序，高龄判断错序。 | char: 目标字<br>strokes: 笔画名数组<br>total?: 笔画数 | `nextStroke` `resetStroke` `readStroke`<br>→ 独立完成（`created`） | `HintLadder` | 低龄：只跟读、不判错<br>高龄：给出错序提示并要求订正 |
| `LookAlike` · 形近字辨析 · **P4a** · ✅ 已实现 | 在句子里选对形近字（「己 / 已 / 巳」），用语境而不是字形记忆。 | pairs: [{a, b, context, answer, why?}] | `pickChar` `nextPair`<br>→ 练习答对（`correct`） | `ChoiceQuiz` | 低龄：一次一组，配图提示<br>高龄：一次四组 + 释义辨析 |

### 阅读与表达（语文 · 1 个）

| 组件 | 做什么 | 模型只给什么 | 动作 → 证据 | 降级到 | 年级适配 |
| --- | --- | --- | --- | --- | --- |
| `RhetoricMatch` · 手法配对 · **P4a** · ✅ 已实现 | 把句子与它用的修辞 / 表达手法连起来，从「认得出」走到「说得出为什么」。 | pairs: [{sentence, device, why?}] | `selectPair` `readSentence`<br>→ 练习答对（`correct`） | `MatchPairs` | 低龄：只配 3 组常见手法（比喻 / 拟人 / 反复）<br>高龄：6 组 + 写出判断依据 |

### 英语语法（英语 · 3 个）

| 组件 | 做什么 | 模型只给什么 | 动作 → 证据 | 降级到 | 年级适配 |
| --- | --- | --- | --- | --- | --- |
| `TenseTimeline` · 时态轴 · **P4c** · ✅ 已实现 | 把句子放到「过去—现在—将来」的时间轴上，让时态变成看得见的位置。 | sentences: [{text, time, marker?}]<br>axis?: 时间点标签 | `placeOnAxis` `checkAxis` `readSentence`<br>→ 练习答对（`correct`） | `NumberLine` | 低龄：三段轴 + 大按钮，只出现 now / before / later<br>高龄：五段轴 + 时间状语与时态名称 |
| `SentenceBlocks` · 句子积木 · **P4b** · ✅ 已实现 | 把打乱的单词块摆成正确语序，提交后生成自己的句子。 | tokens: 词块数组<br>answer: 正确语序<br>pattern?: 句型标签<br>distractors?: 多余词块 | `appendToken` `removeToken` `checkSentence` `readSentence`<br>→ 独立完成（`created`） | `WritingPad` | 低龄：3–4 块、只组 SVO<br>高龄：含从句 / 状语，要求说明语序理由 |
| `GrammarDoctor` · 语法小医生 · **P4a** · ✅ 已实现 | 给一个病句挑错并选改法，错误处高亮、改完朗读正确句子。 | sentence: 原句<br>error: 错误片段<br>fixes: 候选改法<br>answer: 正确改法<br>explanation: 解释 | `pickFix` `readFixed` `askWhy`<br>→ 练习答对（`correct`） | `ChoiceQuiz` | 低龄：只判「对 / 不对」两选项，不出现语法术语<br>高龄：四选项 + 展示术语解释 |

### 词汇与听说（英语 · 1 个）

| 组件 | 做什么 | 模型只给什么 | 动作 → 证据 | 降级到 | 年级适配 |
| --- | --- | --- | --- | --- | --- |
| `LetterTiles` · 字母拼词 · **P4b** · ✅ 已实现 | 听发音，把字母块拼成单词，拼完自动朗读一遍。 | word: 目标词<br>letters: 字母数组<br>phonics?: 拼读提示 | `appendLetter` `removeLetter` `checkWord` `readWord`<br>→ 练习答对（`correct`） | `WritingPad` | 低龄：按音节分块，不逐字母<br>高龄：逐字母 + 词根提示 |

### 计算与等式（数学 · 3 个）

| 组件 | 做什么 | 模型只给什么 | 动作 → 证据 | 降级到 | 年级适配 |
| --- | --- | --- | --- | --- | --- |
| `ColumnArithmetic` · 竖式填空 · **P4b** · ✅ 已实现 | 按位填竖式（含进位 / 退位），每一步都能单独检查。 | operandA<br>operandB<br>operator<br>columns: 逐位答案<br>carry?: 进位 | `fillColumn` `checkSum` `clearColumn`<br>→ 练习答对（`correct`） | `NumberGaps` | 低龄：只做不进位加法，格子放大<br>高龄：多位数乘除 + 进位标注 |
| `BalanceScale` · 天平等式 · **P4b** · ✅ 已实现 | 往天平两边放砝码，直观理解「等号两边一样重」。 | left: 已知量<br>right: 已知量<br>unknown: 待求量<br>equation? | `placeWeight` `checkBalance` `askHint`<br>→ 练习答对（`correct`） | `NumberLine` | 低龄：只用整数颗糖果，不出现未知数符号<br>高龄：过渡到含 x 的等式 |
| `SpeedRound` · 口算闯关 · **P4d** · ✅ 已实现 | 连续几道口算组成一关，连对点亮星星；低龄不算时间。 | items: [{question, answer}]<br>hint?: 关卡提示 | `answerRound` `nextRound` `askHint`<br>→ 练习答对（`correct`） | `ChoiceQuiz` | 低龄：禁真实倒计时，只显示「第几关」与星星<br>高龄：可选计时，但错误不扣分、不排名 |

### 应用与图形（数学 · 2 个）

| 组件 | 做什么 | 模型只给什么 | 动作 → 证据 | 降级到 | 年级适配 |
| --- | --- | --- | --- | --- | --- |
| `UnitStrip` · 数量关系条 · **P4d** · ✅ 已实现 | 把应用题画成线段图，先看清「谁多谁少」再列式。 | quantities: [{label, value?}]<br>relation: 关系描述<br>question: 求什么 | `fillQuantity` `checkRelation` `showSteps`<br>→ 练习答对（`correct`） | `StepReveal` | 低龄：实物图 + 数一数，不出现线段<br>高龄：标准线段图 + 方程入口 |
| `ShapeSplit` · 图形切一切 · **P4d** · ✅ 已实现 | 在图形上选一条切割线 / 拼块，验证等分与面积。 | shape: 图形描述<br>pieces: 切块描述<br>target: 目标（如等分） | `pickCut` `checkSplit` `askHint`<br>→ 练习答对（`correct`） | `PictureChoice` | 低龄：只用圆 / 方，点选二选一<br>高龄：多块拼接 + 面积守恒说明 |


> `derived`、`reuse`、`risk`、`kind` 等完整字段见 `a2ui-question-map.js` 的 `COMPONENT_SPECS`，可视化页也可逐卡展开。

---

## 四、硬规则（新增组件一律过这 10 条）

1. 模型只产知识 JSON：组件名、样式、动作、年级、乱序结果一律由编译器确定性派生。
2. 知识不删：新游戏组件只增加交互层，原有诗文、释义、步骤正文始终可见。
3. 正确答案不裁：低龄减小的是「选项数 / 单步任务量」，不是把正确答案从数据里拿掉。
4. 空态要有真实文案：宁可写一句「先自己试一次」，也不留白或用 display:none。
5. 动作统一：所有交互走 action → updateDataModel → 重渲染，组件不自持状态，为服务端化留路。
6. 证据回写唯一出口：correct / wrong / created / asked / recited 六类，开放题绝不记 correct。
7. 年级只换皮不删组件：低龄与青少年用的是同一棵组件树，差别在密度、口气、奖励强度。
8. 降级链必须存在：每个新组件都要有指向「已实现组件」的 fallback，画不出来就降级，不出现空白格子。
9. 触发条件克制：初识不打扰、掌握度 ≥ 80 不再刷、数学之外的学科不自动弹关卡。
10. 派生数据不进课程缓存：编译结果按内容做进程内 memo，UI 版本升级不能作废付费生成。

---

## 五、新增一个组件的最小实现清单

按顺序做，每一步都有可验证产物；任何一步没做就不要进下一批。

1. **在 a2ui-question-map.js 登记**：问题类型 signals / examples / primary、组件规格与批次。
2. **a2ui-catalog.js**：COMPONENTS[name].props、FALLBACKS[name]、ACTION_EVENTS、把名字加进对应 P4 分组与 implemented。
3. **a2ui-render.js**：写 RENDERERS[name]（纯字符串渲染 + textContent，禁止 innerHTML 拼用户内容）与 knowledge.css 样式。
4. **a2ui-compiler.js / a2ui-matrix.js**：从 lesson.data 的 modelFields 派生 props，按学科 × 过程 × 年级加入配方。
5. **a2ui-bridge.js**：动作映射到 updateDataModel 路径与 KNOWLEDGE.practice 证据；服务端 compileA2UIForLesson 同步纳入。
6. **测试**：test-a2ui-components 出效果图、test-a2ui-server 过 validateMessage、浏览器回归加点击与年级切换断言。
7. **交付**：更新本文件 status 为 implemented、刷新 docs/A2UI-COMPONENT-ROADMAP.md 与 a2ui-roadmap.html、补工作日志。

> 验收基线：`npm run check`、`npm run test:a2ui:map`、`npm run test:a2ui:games`、`npm run test:a2ui:games:browser`、`npm run test:a2ui:server`、`npm run test:a2ui:bridge:browser` 全绿；`npm run test:a2ui:visual` 的 `.two-column` 逐像素基线不破（新组件区始终挂在它外面）。

---

## 六、迭代批次 · 为什么按这个顺序

| 批次 | 主题 | 组件（数量） | 风险 | 完成门槛（全部已达成） | 验收结果 |
| --- | --- | --- | --- | --- | --- |
| **P4a** | 选择器型 · 复用既有骨架，零新交互范式 | `PoemChain` `ImageryBoard` `StoryOrder` `LookAlike` `RhetoricMatch` `GrammarDoctor`（6） | 低 | 每个组件：1 张效果图 + 1 条 validateMessage 断言 + 1 条真实浏览器点击断言；DOM 基线零差异。 | ✅ 6/6 组件各有效果图、validateMessage 断言与真实浏览器点击断言；DOM 基线零差异 |
| **P4b** | 拼装型 · 共用一套「拼装台」内核与撤销栈 | `PoemTiles` `RadicalTiles` `SentenceBlocks` `LetterTiles` `ColumnArithmetic` `BalanceScale`（6） | 中 | 6 个组件共用同一个 /assembly/* 数据契约；乱序使用固定种子，答案可复现；撤销可回退到任意一步。 | ✅ 6 个组件共用 /game/:key/assembly/* 契约、固定种子乱序、答案可复现、撤销可回退任意一步 |
| **P4c** | 语音与开放产出 · 接 IP 口型、开放题不判对错 | `StoryBranch` `RoleVoice` `StrokeOrder` `TenseTimeline`（4） | 中 | 开放题只记 created / asked，绝不写 correct；连续朗读可中断且口型复位；青少年版无幼态奖励。 | ✅ 开放题只记 created / asked / recited、朗读可中断且口型复位、青少年无幼态奖励 |
| **P4d** | 图形与情境 · 先文字选项，后绘图 | `SpeedRound` `UnitStrip` `ShapeSplit`（3） | 高 | 图形只由组件按数据用 CSS/固定图形渲染，模型不给 SVG/HTML；低龄禁真实倒计时；错误不扣分不排名。 | ✅ 图形只用 CSS 固定形状、低龄禁真实倒计时、答错不扣分不排名 |

**排序逻辑**：先做「一眼能判对错」的选择器型（复用既有骨架，风险最低，快速把覆盖从 3 域抬到 6 域）；再抽象「拼装台」内核，一次解决 6 个组件共有的乱序 / 撤销 / 答案复现问题；然后才碰语音、开放产出与证据口径；最后做图形与情境——它们要么需要 CSS 绘图，要么涉及儿童保护（时间压力），必须先过评审。

**四批已按此顺序全部落地并验收**：每批做完都把 `a2ui-question-map.js` 的 `status` 改为 `implemented`，重跑 `npm run build:a2ui:roadmap`，补齐效果图与浏览器点击断言，最后更新工作日志。验收结果逐批写在上表最后一列。

---

## 七、边界与下一步

1. **本轮已改运行时，但未命中就零影响**：`a2ui-question-map.js` / `a2ui-games.js` / 四个批次模块已挂进 `index.html`、`sw.js` 与 `server.js` 静态白名单；题型识别经 `games.selectGame()` 进入编译链，只有四道闸门全过才在 60 组配方**之外**追加一张游戏卡，不删改任何既有知识组件，DOM / 逐像素基线零差异。
2. **`phaseFor()` 仍按学科粗判**：题型识别现在决定「挂不挂游戏卡」，尚未改写学习过程判定（语文→练习、英语→按是否作答、数学→强化）。要让它影响过程与配方，建议先做观测打点确认信号准确率。
3. **P3 游戏化关卡仍未服务端化**：`a2ui-play.js` 在浏览器编译，触发依赖客户端掌握度缓存；服务端化前提是把掌握度带进请求。
4. **两套阶段口径待收敛**：`STAGE_EXTRAS`（阶段准入）与矩阵配方各有一套，§18.3 已让能力协商绕开它，长期应统一为「catalog 只管实现、matrix 只管准入」。
5. **真正边生成边推** `updateComponents` 尚未实现（当前是课程生成完一次性下发 3 条消息），需要生成侧改成分块解析。

### 复现

```bash
npm run test:a2ui:map                # 映射表 18 项断言（20 类问题 / 40 条样例）
npm run test:a2ui:games              # 19 个游戏组件四批门槛（45 项）
npm run test:a2ui:games:browser      # 真实 Edge 点击回归 + 19 张效果图（需 3100 MOCK）
npm run build:a2ui:roadmap           # 重新生成本文件与可视化页
npm run test:a2ui:roadmap:browser    # 总览页离线交互回归
npm run check                        # 全量语法检查
```
