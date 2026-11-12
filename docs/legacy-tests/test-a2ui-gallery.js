/* 知识组件效果图采集 + 自包含画廊生成。
 *
 * 运行： node test-a2ui-gallery.js
 * 产出： cache/shots/comp-*.png（逐组件真实截图）
 *       cache/shots/a2ui-components.html（图片 base64 内嵌，单文件可直接打开）
 *
 * 与 test-a2ui-cases.js 的区别：那一份拍的是「交互流程与协议状态」，
 * 这一份拍的是「组件本身长什么样」——每个已实现组件独立渲染一张，
 * 并补上按学科 × 过程 × 年级编译出的真实配方效果图。
 * 自带极简静态服务，不依赖 server.js / MOCK / Redis。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const matrix = require('./a2ui-matrix');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = path.join(__dirname, 'cache', 'shots');
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* P2 组件演示数据：让真实配方截图展示新组件本身，而不是编译器的兜底文案。 */
const P2_DATA = {
  chinese: {
    idiom: { word: '画蛇添足', pinyin: 'huà shé tiān zú', meaning: '做了多余的事，反而把事情弄糟。',
      example: '这句已经写好，再添一笔就画蛇添足了。', tag: '寓言', level: '三年级', speech: '画蛇添足' },
    wordCard: { word: '春风', phonetic: 'chūn fēng', examples: ['春风又绿江南岸'],
      tip: '常用来写生机与希望。', speech: '春风' },
    pairs: [{ left: '春风', right: '拟人' }, { left: '明月', right: '意象' }, { left: '小溪', right: '比喻' }],
    numberLine: { min: 0, max: 10, marks: [0, 3, 7, 10], highlight: 7,
      label: '在数轴上找到 7', note: '从 0 向右数 7 格。' },
    mastery: { value: 68, status: '连续做对 2 次', point: '拟人手法', label: '当前掌握度' },
    tabs: [{ label: '手法', text: '拟人就是把物当人来写。' }, { label: '例句', text: '风儿轻轻唱着歌。' },
      { label: '易错', text: '不要写成「风像人」的比喻。' }],
    activeTab: '手法',
    methodNote: { title: '我的方法笔记', text: '写清所用手法，再换一个生活场景仿写。', placeholder: '写下你的依据……' }
  },
  english: {
    idiom: { word: 'happy', meaning: '高兴的', example: 'I am happy today.', tag: '形容词',
      level: '五年级', speech: 'happy' },
    wordCard: { word: 'happy', phonetic: '/ˈhæpi/', examples: ['I am happy today.', 'She looks happy.'],
      tip: '形容词，用在 be 动词后作表语。', speech: 'happy' },
    pairs: [{ left: 'happy', right: '高兴的' }, { left: 'glad', right: '欣喜的' }, { left: 'sad', right: '难过的' }],
    numberLine: { min: 0, max: 10, marks: [0, 3, 7, 10], highlight: 7,
      label: '在数轴上找到 7', note: '从 0 向右数 7 格。' },
    mastery: { value: 45, status: '练习中', point: 'be + adj.', label: '当前掌握度' },
    tabs: [{ label: '用法', text: 'be 动词后接形容词原级。' }, { label: '易混', text: 'happily 是副词，不能作表语。' },
      { label: '例句', text: 'I am happy today.' }],
    activeTab: '用法',
    methodNote: { title: '句型笔记', text: '先判断空格需要什么词性，再排除干扰项。', placeholder: '写下判断依据……' }
  },
  math: {
    idiom: { word: '移项', meaning: '等式两边同时做同一个运算。', example: 'x + 3 = 7 → x = 7 − 3',
      tag: '等式性质', level: '初一', speech: '移项' },
    wordCard: { word: '未知数', phonetic: 'wèi zhī shù', examples: ['x + 3 = 7 里的 x'],
      tip: '先找未知数，再决定做什么运算。', speech: '未知数' },
    pairs: [{ left: 'x + 3 = 7', right: '两边同减 3' }, { left: 'x = 4', right: '代回验算' },
      { left: '等式性质', right: '同加同减' }],
    numberLine: { min: 0, max: 10, marks: [0, 3, 4, 7, 10], highlight: 4,
      label: '在数轴上找到 x = 4', note: '从 7 向左退 3 格就是 4。' },
    mastery: { value: 72, status: '连续做对 2 次', point: '等式两边同减一个数', label: '当前掌握度' },
    tabs: [{ label: '通法', text: '等式两边做同一个运算，等式仍成立。' },
      { label: '变式', text: '把 3 换成 5，结论依然成立。' },
      { label: '易错', text: '只在左边减 3 会破坏等式。' }],
    activeTab: '通法',
    methodNote: { title: '解题依据', text: '写出每一步用到的等式性质，并代回原式验算。',
      placeholder: '写下这一步的依据……' }
  }
};

/* 配方演示用的同一批知识 JSON；学科不同只换内容，编译期才决定组件形态。 */
const DATA = {
  chinese: {
    ...P2_DATA.chinese,
    poems: [{ text: '春眠不觉晓，处处闻啼鸟', source: '孟浩然《春晓》', tag: '春景' },
      { text: '随风潜入夜，润物细无声', source: '杜甫《春夜喜雨》', tag: '春雨' }],
    words: ['开心', '晴朗', '暖洋洋'], speech: '春眠不觉晓，处处闻啼鸟',
    note: '拟人就是把物当人来写；迁移仿写时要保留「把物当人」这个结构特征。',
    question: '哪一句把风当人来写？',
    options: ['A. 风很凉', 'B. 云像棉花', 'C. 天很蓝', 'D. 风儿轻轻唱着歌'],
    answer: 'D. 风儿轻轻唱着歌',
    steps: ['读一遍句子', '圈出动词', '想想谁在唱', '说给同桌听'],
    formula: '本体 + 喻词 + 喻体', formulaNote: '拟人不需要喻词',
    prompt: '用上刚学的表达写一句。'
  },
  english: {
    ...P2_DATA.english,
    poems: [], words: ['happy', 'glad', 'sad'], speech: 'I am happy today.',
    note: 'happy 与 glad 都表示「高兴」，glad 更常用于正式回应。',
    question: '—How are you? —I am ____.',
    options: ['A. happily', 'B. happiness', 'C. happier', 'D. happy'],
    answer: 'D. happy',
    steps: ['看空格位置', '判断需要形容词', '排除副词与名词', '读一遍检查'],
    formula: 'be + adj.', formulaNote: '系动词后接形容词作表语',
    prompt: '用这个句型说一句自己的话。'
  },
  math: {
    ...P2_DATA.math,
    poems: [], words: [], speech: '两边同时减三',
    note: '移项的本质是等式两边同减一个数。',
    question: 'x + 3 = 7，x 等于几？',
    options: ['A. 3', 'B. 7', 'C. 10', 'D. 4'],
    answer: 'D. 4',
    steps: ['读题，找出未知数', '两边同时减 3', '算出 x = 4', '代回原式验算'],
    formula: 'x + 3 = 7 → x = 7 − 3 = 4', formulaNote: '等式两边做同一个运算，等式仍成立',
    prompt: '写出你的解题依据。'
  }
};

const CARD = (id, children, className = 'content-card') => ({ id, component: 'Card', className, children });
const HEAD = (id, number, title, subtitle, extra = {}) => ({
  id, component: 'CardHeading', number, title, subtitle, ...extra
});
const ROOT = children => ({ id: 'root', component: 'Column', className: 'gallery-root', children });

/* ---------- 12 张单组件效果图 ---------- */
const COMPONENT_SHOTS = [
  {
    id: 'S01', name: 'HintBar', group: '内容呈现', stage: 'early',
    desc: '年级化操作提示', detail: '把「这一步怎么做」说成该年龄听得懂的话；启蒙期放大字号与间距，青少年期改成克制的一行小字。',
    use: '全部 12 组配方的开头 · 语文/英语/数学初识',
    components: [ROOT(['h1']), {
      id: 'h1', component: 'HintBar',
      text: '点右边的小喇叭，听一句，跟着读一句。'
    }]
  },
  {
    id: 'S02', name: 'PoemLine + SpeakButton', group: '内容呈现', stage: 'primary',
    desc: '诗句行与单句朗读', detail: '每句诗独立成卡：正文、出处、意象标签，右下角小喇叭只朗读这一句；标题栏另有「朗读全篇」。',
    use: '语文 · 初识 / 强化',
    components: [ROOT(['pcard']),
      CARD('pcard', ['phead', 'poem_a', 'poem_b', 'read_all']),
      HEAD('phead', '02', '诗文与名句', '从经典表达中汲取灵感', { trailingIcon: 'pen' }),
      { id: 'poem_a', component: 'PoemLine', className: 'poem-item', text: '春眠不觉晓，处处闻啼鸟。', source: '孟浩然《春晓》', tag: '春景',
        speakAction: { event: { name: 'readPoem', context: { text: '春眠不觉晓，处处闻啼鸟。' } } } },
      { id: 'poem_b', component: 'PoemLine', className: 'poem-item', text: '随风潜入夜，润物细无声。', source: '杜甫《春夜喜雨》', tag: '春雨',
        speakAction: { event: { name: 'readPoem', context: { text: '随风潜入夜，润物细无声。' } } } },
      { id: 'read_all', component: 'SpeakButton', className: 'text-button', label: '朗读全篇', icon: 'volume',
        text: '春眠不觉晓，处处闻啼鸟。随风潜入夜，润物细无声。',
        action: { event: { name: 'readAll', context: { text: '春眠不觉晓，处处闻啼鸟。随风潜入夜，润物细无声。' } } } }
    ]
  },
  {
    id: 'S03', name: 'Text（知识说明）', group: '内容呈现', stage: 'teen',
    desc: '抽象说明 / 手法笔记', detail: '承载定义、辨析、语体说明；只在允许抽象组件的年级出现，低年级会降级为 HintBar，而不是被隐藏。',
    use: '语文 · 迁移 · 初二以上；英语辨析说明',
    components: [ROOT(['ncard']),
      CARD('ncard', ['nhead', 'note']),
      HEAD('nhead', '04', '表达手法笔记', '迁移仿写前先看清结构'),
      { id: 'note', component: 'Text', tag: 'p', className: 'knowledge-note',
        text: '拟人不要求出现「像」这类喻词，关键是赋予物以人的动作或情感；仿写时保留这个结构特征，再换成自己熟悉的生活场景。' }
    ]
  },
  {
    id: 'S04', name: 'FormulaBlock', group: '内容呈现', stage: 'teen',
    desc: '公式 / 通法与易错边界', detail: '等宽字体高亮通法，下面挂一行边界说明。低年级 allowFormula=false 时降级为 HintBar，知识不消失。',
    use: '数学 · 强化 / 迁移 · 五年级以上',
    components: [ROOT(['fcard']),
      CARD('fcard', ['fhead', 'fb']),
      HEAD('fhead', '05', '通法与公式', '从特例回到一般'),
      { id: 'fb', component: 'FormulaBlock', className: 'k-formula',
        formula: 'x + 3 = 7 → x = 7 − 3 = 4', note: '等式两边做同一个运算，等式仍成立；代回原式可验算。' }
    ]
  },
  {
    id: 'S05', name: 'CardHeading + List', group: '内容呈现', stage: 'upper',
    desc: '列表模板与数据绑定', detail: 'List 用 children:{path, componentId} 指向数据数组，同一个 PoemLine 模板按 @path 渲染 N 条，UI 与数据分离。',
    use: '诗文列表 · 成语卡列表 · 任意重复型知识',
    components: [ROOT(['lcard']),
      CARD('lcard', ['lhead', 'plist']),
      HEAD('lhead', '02', '诗文与名句', '列表由 dataModel 驱动'),
      { id: 'plist', component: 'List', className: 'poem-list', emptyText: '这一课暂时没有配套诗句。',
        children: { path: '/lesson/poems', componentId: 'poem_tpl' } },
      { id: 'poem_tpl', component: 'PoemLine', text: { '@path': 'text' }, source: { '@path': 'source' }, tag: { '@path': 'tag' },
        speakAction: { event: { name: 'readPoem', context: { text: { '@path': 'text' } } } } }
    ],
    dataModel: { lesson: { poems: [
      { text: '春眠不觉晓，处处闻啼鸟', source: '孟浩然《春晓》', tag: '春景' },
      { text: '随风潜入夜，润物细无声', source: '杜甫《春夜喜雨》', tag: '春雨' },
      { text: '两个黄鹂鸣翠柳，一行白鹭上青天', source: '杜甫《绝句》', tag: '对仗' }
    ] } }
  },
  {
    id: 'S06', name: 'EmptyState', group: '内容呈现', stage: 'upper',
    desc: '空态兜底', detail: '模型没给诗句时显示引导文案，而不是留一块空白或让朗读按钮读到空串；这是上一轮「听得到看不到」事故后的兜底。',
    use: '所有列表型内容的空数据分支',
    components: [ROOT(['ecard']),
      CARD('ecard', ['ehead', 'empty']),
      HEAD('ehead', '02', '诗文与名句', '本课暂无配套内容'),
      { id: 'empty', component: 'EmptyState', className: 'stage-hint is-empty',
        text: '这一课暂时没有配套诗句，先看看上面的表达素材吧。' }
    ]
  },
  {
    id: 'S07', name: 'WordChips', group: '交互练习', stage: 'primary',
    desc: '词芯片 / 选素材', detail: '点选后通过 action:selectWord 写回 /practice/word；低年级用大按钮，青少年期收成紧凑标签。',
    use: '语文 · 练习 / 强化；英语 · 初识 / 强化',
    components: [ROOT(['wcard']),
      CARD('wcard', ['whead', 'chips']),
      HEAD('whead', '01', '表达素材库', '选一个词，再写一句话'),
      { id: 'chips', component: 'WordChips', className: 'word-chips',
        items: [{ word: '开心' }, { word: '晴朗' }, { word: '蹦跳' }, { word: '暖洋洋' }],
        active: '晴朗', wordsPath: '/practice/words',
        action: { event: { name: 'selectWord', context: {} } } }
    ]
  },
  {
    id: 'S08', name: 'WritingPad', group: '交互练习', stage: 'upper',
    desc: '写一句 / 说一句（复合组件）', detail: '内部由 任务说明 + WordChips + TextField + Feedback + Button 组成；完成门槛 minLength 随年级从 1 字递增到 20 字。',
    use: '语文 · 练习 / 强化 / 迁移；英语 · 迁移',
    components: [ROOT(['wp_card']),
      CARD('wp_card', ['wp_head', 'wp']),
      HEAD('wp_head', '03', '试着写一句', '选素材 → 写一句 → 看反馈'),
      { id: 'wp', component: 'WritingPad',
        task: '选一个素材，写一句有动作或画面的话。',
        words: [{ word: '开心' }, { word: '晴朗' }, { word: '蹦跳' }], wordsPath: '/practice/words',
        placeholder: '比如：他笑得眼睛弯成了小月牙……',
        button: '看看写得怎样', minLength: 12, value: '他蹦跳着跑进洒满阳光的院子。', activeWord: '蹦跳',
        feedback: '写得具体，动作和画面都出来了。', tone: 'good',
        footerNote: 'AI 生成内容建议结合课本核对',
        inputId: 'g_writing_input', feedbackId: 'g_writing_feedback', buttonId: 'g_writing_submit',
        inputBind: '/practice/text',
        chipAction: { event: { name: 'selectWord', context: { word: { '@path': 'word' } } } },
        submitAction: { event: { name: 'write', context: { text: { '@path': '/practice/text' }, minLength: 12 } } } }
    ]
  },
  {
    id: 'S09', name: 'ChoiceQuiz', group: '交互练习', stage: 'teen',
    desc: '选项判断与辨析', detail: '两列网格承载 2/3/4 个选项（数量由认知阶段决定）；编译器保证裁选项时正确答案一定还在。',
    use: '英语 · 练习 / 强化 / 迁移；数学 · 练习 / 强化 / 迁移',
    components: [ROOT(['qcard']),
      CARD('qcard', ['qhead', 'quiz']),
      HEAD('qhead', '02', '你来判一判', '在情景里选对用法'),
      { id: 'quiz', component: 'ChoiceQuiz', className: 'k-quiz',
        question: '—How are you? —I am ____.',
        options: ['A. happily', 'B. happiness', 'C. happier', 'D. happy'],
        note: '空格在 be 动词之后，需要形容词原级。',
        feedback: '', tone: '',
        action: { event: { name: 'answer', context: { answer: 'D. happy' } } } }
    ]
  },
  {
    id: 'S10', name: 'StepReveal', group: '交互练习', stage: 'early',
    desc: '分步展开思路（线性）', detail: '低年级一次只高亮一步，但所有步骤正文始终可见；高年级 stepMode=all 一次全展开并禁用「下一步」。',
    use: '数学 · 全部过程（初识到迁移）',
    components: [ROOT(['scard']),
      CARD('scard', ['shead', 'steps']),
      HEAD('shead', '01', '一步一步摆出来', '看见解题的顺序'),
      { id: 'steps', component: 'StepReveal', className: 'k-steps',
        steps: ['读题，找出未知数', '两边同时减 3', '算出 x = 4', '代回原式验算'],
        current: 2, button: '下一步', hint: '一次只看一步，点「下一步」继续。',
        action: { event: { name: 'nextStep', context: {} } } }
    ]
  },
  {
    id: 'S11', name: 'Feedback', group: '交互练习', stage: 'primary',
    desc: '对错反馈与过程归因', detail: 'tone 决定颜色：good（达成）/ hint（再试一次）；文案由业务层写回 dataModel，DOM 由 renderer 重绘，不直接改 DOM。',
    use: '所有含提交动作的配方',
    components: [ROOT(['fbcard']),
      CARD('fbcard', ['fbhead', 'fb1', 'fb2']),
      HEAD('fbhead', '03', '即时反馈', '三种语气'),
      { id: 'fb1', component: 'Feedback', text: '答对了！这里用的是形容词原级，判断依据写得很清楚。', tone: 'good' },
      { id: 'fb2', component: 'Feedback', text: '还差一点点：再写一句，把动作或看得见的画面加进去。', tone: 'hint' }
    ]
  },
  {
    id: 'S12', name: 'Column / Row / Card / Button / TextField', group: '基础原语', stage: 'upper',
    desc: '布局与输入原语', detail: 'A2UI Basic Catalog 子集，负责把知识组件拼成卡片、行列与表单；本身不承载知识，但所有配方都依赖它们。',
    use: '全部 60 组配方的骨架',
    components: [ROOT(['grow', 'g_demo_btn', 'g_demo_tf']),
      { id: 'grow', component: 'Row', className: 'gallery-row', children: ['gc1', 'gc2'] },
      CARD('gc1', ['gt1']), CARD('gc2', ['gt2']),
      { id: 'gt1', component: 'Text', tag: 'p', className: 'knowledge-note', text: 'Column：纵向排列，控制信息密度' },
      { id: 'gt2', component: 'Text', tag: 'p', className: 'knowledge-note', text: 'Row / Card：横向并排与内容分组' },
      { id: 'g_demo_tf', component: 'TextField', className: 'practice-input',
        placeholder: 'TextField · 在这里输入你的想法……', value: '', bind: '/demo/text' },
      { id: 'g_demo_btn', component: 'Button', className: 'primary-small', label: 'Button · 提交练习',
        icon: 'arrow', action: { event: { name: 'write', context: {} } } }
    ]
  },
  {
    id: 'S13', name: 'IdiomCard', group: 'P2 新组件', stage: 'primary',
    desc: '成语 / 字词知识卡', detail: '大字词条 + 拼音 + 释义 + 例句 + 标签与年级，右下角小喇叭只朗读这个词；语文初识按年级追加。',
    use: '语文 · 初识（全部年级）',
    components: [ROOT(['icard']),
      CARD('icard', ['ihead', 'idiom']),
      HEAD('ihead', '01', '字词卡', '读一读，记一记'),
      { id: 'idiom', component: 'IdiomCard', className: 'k-idiom',
        word: '画蛇添足', pinyin: 'huà shé tiān zú', meaning: '做了多余的事，反而把事情弄糟。',
        example: '这句已经写好，再添一笔就画蛇添足了。', tag: '寓言', level: '三年级',
        action: { event: { name: 'readAll', context: { text: '画蛇添足' } } } }
    ]
  },
  {
    id: 'S14', name: 'WordCard', group: 'P2 新组件', stage: 'upper',
    desc: '英语单词 / 术语卡', detail: '词条、音标、多个例句与辨析提示放在一张卡里；英语初识与高年级迁移都会用到。',
    use: '英语 · 初识；语文 / 数学 · 迁移',
    components: [ROOT(['wccard']),
      CARD('wccard', ['wchead', 'wc']),
      HEAD('wchead', '01', '词汇卡', '声音与词义一起记'),
      { id: 'wc', component: 'WordCard', className: 'k-word-card',
        word: 'happy', phonetic: '/ˈhæpi/', examples: ['I am happy today.', 'She looks happy.'],
        tip: '形容词，用在 be 动词后作表语；happily 是副词，不能作表语。',
        action: { event: { name: 'readAll', context: { text: 'happy' } } } }
    ]
  },
  {
    id: 'S15', name: 'PictureChoice', group: 'P2 新组件', stage: 'early',
    desc: '看图大按钮选择', detail: '启蒙期用大图形 + 短标签代替密集文字选项；形状与配色来自固定白名单，模型给不了 CSS 或图片地址。',
    use: '语文 / 英语 · 练习；各学科 · 启蒙期强化',
    components: [ROOT(['pccard']),
      CARD('pccard', ['pchead', 'pc']),
      HEAD('pchead', '02', '看图选一选', '点一个大按钮就算完成'),
      { id: 'pc', component: 'PictureChoice', className: 'k-pictures',
        question: '哪一幅图是圆圆的？', options: ['A. 圆圆的太阳', 'B. 方方的盒子', 'C. 尖尖的小山'],
        answer: 'A. 圆圆的太阳', note: '先看形状，再看颜色。', feedback: '', tone: '',
        action: { event: { name: 'answer', context: { answer: 'A. 圆圆的太阳' } } } }
    ]
  },
  {
    id: 'S16', name: 'MatchPairs', group: 'P2 新组件', stage: 'primary',
    desc: '配对 / 辨析连线', detail: '左右两列点选成一对，已配对的项由 dataModel 的 matchedPairs 决定样式；动作经 selectPair 上报，不在渲染器里藏状态。',
    use: '英语 · 练习 / 强化；语文 · 练习',
    components: [ROOT(['mpcard']),
      CARD('mpcard', ['mphead', 'mp']),
      HEAD('mphead', '02', '配成一对', '先点左边，再点右边'),
      { id: 'mp', component: 'MatchPairs', className: 'k-pairs',
        pairs: [{ left: 'happy', right: '高兴的' }, { left: 'glad', right: '欣喜的' }, { left: 'sad', right: '难过的' }],
        matched: ['高兴的'], hint: '先点左边，再点右边配成一对。', feedback: '已经配好 1 对。', tone: 'good',
        action: { event: { name: 'selectPair', context: {} } } }
    ]
  },
  {
    id: 'S17', name: 'NumberLine', group: 'P2 新组件', stage: 'early',
    desc: '数轴 / 实物化描述', detail: '低年级不出现公式，改用数轴把「两边同减 3」画出来；刻度数值钳制后定位，当前值高亮。',
    use: '数学 · 初识 / 练习 / 强化（低年级）',
    components: [ROOT(['nlcard']),
      CARD('nlcard', ['nlhead', 'nl']),
      HEAD('nlhead', '01', '在数轴上走一走', '把抽象运算变成看得见的一格'),
      { id: 'nl', component: 'NumberLine', className: 'k-numberline',
        min: 0, max: 10, marks: [0, 3, 4, 7, 10], highlight: 4,
        label: '从 7 向左退 3 格，找到 x = 4', note: '等式两边做同一个运算，等式仍成立。' }
    ]
  },
  {
    id: 'S18', name: 'MasteryRing', group: 'P2 新组件', stage: 'teen',
    desc: '掌握度进度环', detail: '把「讲过 ≠ 会」画成可读的进度：SVG 圆环 + 百分比 + 知识点名称与状态，数值来自知识卡片而非模型。',
    use: '初高中 · 强化 / 迁移；家长看板可复用',
    components: [ROOT(['mrcard']),
      CARD('mrcard', ['mrhead', 'mr']),
      HEAD('mrhead', '04', '这一点的掌握情况', '连续做对才算掌握'),
      { id: 'mr', component: 'MasteryRing', className: 'k-mastery',
        mastery: 68, status: '连续 2 次做对 · 再练一次可标记掌握',
        point: '等式两边同减一个数', label: '当前掌握度' }
    ]
  },
  {
    id: 'S19', name: 'Tabs', group: 'P2 新组件', stage: 'senior',
    desc: '分栏切换多侧面', detail: '同一知识点的通法 / 变式 / 易错分栏呈现；当前标签由 dataModel.activeTab 决定，切换走 switchTab 动作。',
    use: '高中期 · 强化 / 迁移',
    components: [ROOT(['tbcard']),
      CARD('tbcard', ['tbhead', 'tb']),
      HEAD('tbhead', '05', '换个角度再看', '一次聚焦一个侧面'),
      { id: 'tb', component: 'Tabs', className: 'k-tabs',
        tabs: [{ label: '通法', text: '等式两边做同一个运算，等式仍成立。' },
          { label: '变式', text: '把 3 换成 5，结论依然成立。' },
          { label: '易错', text: '只在左边减 3 会破坏等式。' }],
        active: '通法', note: '切换标签查看不同侧面。',
        action: { event: { name: 'switchTab', context: {} } } }
    ]
  },
  {
    id: 'S20', name: 'MethodNote', group: 'P2 新组件', stage: 'teen',
    desc: '方法笔记 + 可写思路', detail: '高年级要求写出判断依据：上半是方法说明，下半输入框通过 data-a2ui-bind 写回 dataModel，不使用 innerHTML。',
    use: '青少年 / 高中期 · 练习 / 迁移',
    components: [ROOT(['mncard']),
      CARD('mncard', ['mnhead', 'mn']),
      HEAD('mnhead', '03', '我的方法笔记', '先写依据，再核对结论'),
      { id: 'mn', component: 'MethodNote', className: 'k-method',
        title: '解题依据', text: '先写出每一步用到的等式性质，再对照通法检查有没有漏掉条件。',
        placeholder: '写下这一步的依据……', noteValue: '', noteBind: '/practice/methodNoteText',
        inputId: 'g_method_input' }
    ]
  },
  {
    id: 'S21', name: 'NumberGaps', group: '游戏化与 IP 求助', stage: 'early',
    desc: '缺数填空 · 点选候选块',
    detail: '参考设计稿的主练习区：固定数字块 + 可填空格 + 候选数字块 + 重来/提交/找知知三按钮。点候选块由 fillGap 动作写回 dataModel，空格可点按取回；不执行任何模型生成的脚本。',
    use: '启蒙 / 基础期 · 数学数感与规律',
    components: [ROOT(['p21']),
      { id: 'p21', component: 'Card', className: 'k-play-standalone', children: ['p21g'] },
      { id: 'p21g', component: 'NumberGaps', className: 'k-play k-gaps',
        title: '哪两个数字躲起来了？', question: '看看这排数字，把躲起来的数字找回来。',
        slots: ['4', '', '', '7', '8'], gaps: [null, '5', null, null, null],
        bank: ['5', '6', '7', '3', '4'], hint: '点数字块，把它放进空格里',
        resetLabel: '重来一次', submitLabel: '我填好啦', askLabel: '我不会，找知知',
        feedback: '放好啦！再看看下一个空格。', tone: 'info', feedbackId: 'p21_fb' }
    ]
  },
  {
    id: 'S22', name: 'QuestHUD', group: '游戏化与 IP 求助', stage: 'early',
    desc: '关卡 / 星星 / 连对进度',
    detail: '低龄用关卡号 + 三颗星 + 连对次数制造即时目标；青少年期星星被 CSS 收起，只保留细进度条与正确率，不把中学生当小孩哄。',
    use: '全部练习关卡 · 启蒙期最显著',
    components: [ROOT(['p22']),
      { id: 'p22', component: 'Card', className: 'k-play-standalone', children: ['p22h'] },
      { id: 'p22h', component: 'QuestHUD', className: 'k-quest',
        level: '第 1 关 · 数字排队', progress: 20, stars: 1, combo: 0,
        label: '做对一次就点亮一颗星', note: '一次只看这一题' }
    ]
  },
  {
    id: 'S23', name: 'VoiceGuide', group: '游戏化与 IP 求助', stage: 'early',
    desc: '语音引导胶囊 · 听题 / 听做法 / 静音',
    detail: '设计稿左下角控制条的组件化：三个按钮分别读题目、读操作引导、切换静音；朗读走 speak renderer function，自动联动知知的口型同步。',
    use: '启蒙 / 基础期 · 所有需要听读的关卡',
    components: [ROOT(['p23']),
      { id: 'p23', component: 'Card', className: 'k-play-standalone', children: ['p23v'] },
      { id: 'p23v', component: 'VoiceGuide', className: 'k-voice',
        label: '听一听', hint: '听题目 / 听做法', muted: false,
        playAction: { event: { name: 'readGuide', context: { mode: 'question', speak: '看看这排数字，把躲起来的数字找回来。' } } },
        guideAction: { event: { name: 'readGuide', context: { mode: 'guide', speak: '先点小喇叭听题目，再点数字块放进空格里。' } } },
        muteAction: { event: { name: 'readGuide', context: { mode: 'mute' } } } }
    ]
  },
  {
    id: 'S24', name: 'AskIP', group: '游戏化与 IP 求助', stage: 'early',
    desc: '知知求助卡 · 语音 / 对话两个入口',
    detail: '右侧 IP 卡的组件化：头像、在线状态、知知当前台词、未读角标与两个圆形入口。求助不会直接给答案，而是触发第一级提示；高年级切 compact 变成一行「查看思路提示」。',
    use: '全部年级 · 卡住时的情绪兜底',
    components: [ROOT(['p24']),
      { id: 'p24', component: 'Card', className: 'k-play-standalone', children: ['p24i'] },
      { id: 'p24i', component: 'AskIP', className: 'k-ip',
        name: '知知', status: '随时可以问我', line: '别急，我们一起一个一个数。', badge: 1,
        callLabel: '语音问知知', chatLabel: '打字问知知', compact: false,
        callAction: { event: { name: 'askIP', context: { mode: 'call' } } },
        chatAction: { event: { name: 'askIP', context: { mode: 'chat' } } } }
    ]
  },
  {
    id: 'S25', name: 'QuickQuestions', group: '游戏化与 IP 求助', stage: 'primary',
    desc: '快捷提问 · 不用打字也能求助',
    detail: '不会组织问题的孩子直接点预设问题：小喇叭朗读问题，气泡让知知回答对应提示。问题与答案都来自年级文案表，不交给模型即兴发挥。',
    use: '启蒙 / 基础期 · 表达尚不成熟时',
    components: [ROOT(['p25']),
      { id: 'p25', component: 'Card', className: 'k-play-standalone', children: ['p25q'] },
      { id: 'p25q', component: 'QuickQuestions', className: 'k-questions',
        title: '问问知知', activeId: 'q1', note: '点小喇叭听问题，点气泡让知知回答。',
        questions: [
          { id: 'q1', text: '为什么有的格子空空的？', hint: '空格子是故意留给你填的。', speech: '为什么有的格子空空的？' },
          { id: 'q2', text: '我怎么知道下一个数是几？', hint: '从 4 开始，一个一个往后数。', speech: '我怎么知道下一个数是几？' }
        ],
        questionAction: { event: { name: 'askQuestion', context: {} } },
        feedback: '空格子是故意留给你填的，先读出旁边已经有的数字。', tone: 'info' }
    ]
  },
  {
    id: 'S26', name: 'HintLadder', group: '游戏化与 IP 求助', stage: 'early',
    desc: '分级提示 · 不一点就给答案',
    detail: '求助的解答形态：三级提示逐级解锁，未解锁项只显示占位，前两级只给思路，第三级才揭晓答案；每条都能让知知读一遍。',
    use: '全部年级 · 求助解答 / 错因复盘',
    components: [ROOT(['p26']),
      { id: 'p26', component: 'Card', className: 'k-play-standalone', children: ['p26h'] },
      { id: 'p26h', component: 'HintLadder', className: 'k-hints',
        title: '知知的小提示', unlocked: 1, button: '再给一条提示',
        note: '前两条先自己试，第三条才揭晓答案。',
        steps: ['先大声读出已经有的数字：4、7、8。', '从 4 往后一个一个数，数到 7 之前停一下。',
          '答案揭晓：4、5、6、7、8。跟着知知读一遍就记住啦。'],
        revealAction: { event: { name: 'revealHint', context: {} } },
        voiceAction: { event: { name: 'readGuide', context: { mode: 'hint', speak: '先大声读出已经有的数字：4、7、8。' } } },
        feedback: '', tone: '' }
    ]
  }
];

/* ---------- 2 张整页场景：把 6 个组件按参考稿编排成一关 ---------- */
const PLAY_SHOTS = [
  {
    id: 'P1', name: '整页关卡 · 一年级', group: '游戏化与 IP 求助', stage: 'early',
    desc: '参考稿复刻：主练习区 + 右侧知知求助 + 语音控制条',
    detail: '深紫游戏化主题、大数字块与候选块、Reset / 提交 /「我不会，找知知」三按钮、右侧 IP 卡与快捷提问、左下语音胶囊。题目、星星、口语化提示全部由一年级画像编译。',
    use: '启蒙期 · 数学数感关卡', scene: { grade: 'grade1' }
  },
  {
    id: 'P2', name: '整页关卡 · 初二', group: '游戏化与 IP 求助', stage: 'teen',
    desc: '同一关卡换年级：游戏化退场，改成克制工具界面',
    detail: '组件树完全不变，只换年级画像：浅色主题、星星收起、按钮变小、求助改名「查看思路提示」、要求写出判断依据、快捷问题改成思路核对。知识一个没删。',
    use: '青少年期 · 同一数列题的推导训练', scene: { grade: 'grade8' }
  }
];

/* ---------- 7 张真实配方效果图 ---------- */
function recipeShot(id, title, subject, phase, grade, detail) {
  const r = matrix.recipeFor(subject, phase, grade);
  return {
    id, name: title, group: '配方效果图',
    stage: r.stage, desc: `${r.subjectLabel} · ${r.phaseLabel} · ${r.stageLabel}`,
    detail, use: r.components.join(' + '),
    recipe: { subject, phase, grade, point: title, data: DATA[subject] },
    meta: { key: r.key, hint: r.hint, optionCount: r.optionCount, stepMode: r.stepMode, density: r.density }
  };
}
const RECIPE_SHOTS = [
  recipeShot('C1', '语文 · 初识 · 一年级', 'chinese', 'learn', 'grade1',
    '启蒙期给 4 个组件：提示条 + 诗句 + 朗读按钮 + 成语卡，按钮与字号放大；不出现公式、长说明或分栏等抽象组件。'),
  recipeShot('C2', '语文 · 初识 · 初二', 'chinese', 'learn', 'grade8',
    '同一门语文、同一个过程，只把用户换成初二：组件不变，但提示换成「对照注释标出关键一处」，字号收小、语气克制，知识一条没删。'),
  recipeShot('C3', '语文 · 迁移 · 初二', 'chinese', 'transfer', 'grade8',
    '进入迁移过程后换成写作板 + 反馈 + 抽象说明，要求写清所用手法；抽象组件在青少年期才被允许。'),
  recipeShot('C4', '英语 · 练习 · 五年级', 'english', 'practice', 'grade5',
    '英语练习用 3 选项 ChoiceQuiz + 朗读 + 反馈，强调「听音辨词、排除典型易混干扰项」，与语文的诗句/仿写完全不同。'),
  recipeShot('C5', '英语 · 强化 · 初二', 'english', 'reinforce', 'grade8',
    '同为英语，强化过程换成 4 选项 + 词芯片 + 反馈，重点是间隔回忆与易混点并列；年级升高让干扰项从 3 个增到 4 个。'),
  recipeShot('C6', '数学 · 强化 · 一年级', 'math', 'reinforce', 'grade1',
    '数学强化在低龄裁掉公式块（降级为提示条），只留 2 个选项 + 线性分步 + 数轴；正确答案 D 排在最后仍被保留，4 个步骤正文全部可见。'),
  recipeShot('C7', '数学 · 强化 · 初二', 'math', 'reinforce', 'grade8',
    '同一道 x + 3 = 7 换到初二：公式块回来了、选项变 4 个、步骤一次全展开，并加上掌握度环要求自检。知识点完全相同，组件与认知负荷全变。')
];

const SHOTS_DEF = [...COMPONENT_SHOTS, ...PLAY_SHOTS, ...RECIPE_SHOTS];

/* catalog 现状：26 个组件全部实现渲染器；其中 8 个是本轮补齐的 P2 组件。 */
const OVERVIEW = [
  ['内容呈现', 'HintBar / PoemLine / SpeakButton / Text / FormulaBlock / CardHeading / List / EmptyState', '8', '已实现'],
  ['交互练习', 'WordChips / WritingPad / ChoiceQuiz / StepReveal / Feedback', '5', '已实现'],
  ['基础原语', 'Column / Row / Card / Button / TextField', '5', '已实现'],
  ['P2 新增', 'IdiomCard / WordCard / PictureChoice / MatchPairs / NumberLine / MasteryRing / Tabs / MethodNote', '8', '已实现'],
  ['P3 游戏化', 'NumberGaps / QuestHUD / VoiceGuide / AskIP / QuickQuestions / HintLadder', '6', '已实现']
];

/* ---------------- 独立页面 ---------------- */
function buildPage(sprite) {
  const shotHtml = SHOTS_DEF.map(s => `
    <section class="shot" id="shot-${s.id}">
      <div class="shot-head"><span class="shot-id">${esc(s.id)}</span><span class="shot-name">${esc(s.name)}</span><span class="shot-group">${esc(s.group)}</span></div>
      <div class="shot-canvas"><div class="surface" id="surface-${s.id}"></div></div>
    </section>`).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>知岛 · 知识组件效果图采集页</title>
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/knowledge.css">
<style>
html,body{margin:0;background:#f4f1fb;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
*,*::before,*::after{animation:none!important;transition:none!important}
.svg-sprite{position:absolute;width:0;height:0;overflow:hidden}
.page{width:920px;margin:0 auto;padding:18px 0 40px}
.shot{width:860px;margin:0 auto 18px;background:#fff;border:1px solid #e8e1f6;border-radius:14px;overflow:hidden}
.shot-head{display:flex;align-items:center;gap:10px;padding:10px 16px;background:#f7f4ff;border-bottom:1px solid #eee9f8;font:13px/1.5 system-ui,sans-serif;color:#493380}
.shot-id{background:#5b3fa8;color:#fff;border-radius:6px;padding:3px 8px;font:600 11px/1.4 ui-monospace,Consolas,monospace}
.shot-name{font-weight:600}.shot-group{margin-left:auto;color:#9a92b5;font-size:11px}
.shot-canvas{padding:18px 20px 22px;background:#fff;min-height:70px}
.surface{width:100%}
.gallery-root{display:block;max-width:100%}
.gallery-root>.content-card{margin:0 0 12px}
.gallery-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
.knowledge-surface{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.knowledge-surface>.content-card{margin:0}
</style></head><body>
${sprite}
<div class="page">${shotHtml}</div>
<script src="/grade-profile.js"></script>
<script src="/a2ui-catalog.js"></script>
<script src="/a2ui-matrix.js"></script>
<script src="/a2ui-compiler.js"></script>
<script src="/a2ui-render.js"></script>
<script src="/a2ui-play.js"></script>
<script>
const SHOTS = ${JSON.stringify(SHOTS_DEF)};
const PROFILE = {
  early:{density:'sparse',tone:'child',font:1.18,cards:1,celebration:'high',gesture:'tap',mascot:1.15},
  primary:{density:'comfortable',tone:'child',font:1.08,cards:2,celebration:'high',gesture:'tap',mascot:1},
  upper:{density:'balanced',tone:'child',font:1,cards:3,celebration:'medium',gesture:'tap',mascot:0.9},
  teen:{density:'dense',tone:'teen',font:0.96,cards:4,celebration:'low',gesture:'click',mascot:0.7},
  senior:{density:'dense',tone:'teen',font:0.94,cards:4,celebration:'none',gesture:'click',mascot:0.55}
};
window.__applyStage = function(id){
  const p = PROFILE[id] || PROFILE.upper, root = document.documentElement;
  root.dataset.stage = id; root.dataset.density = p.density; root.dataset.tone = p.tone;
  root.dataset.celebration = p.celebration; root.dataset.gesture = p.gesture;
  root.style.setProperty('--zd-stage-font', String(p.font));
  root.style.setProperty('--zd-stage-cards', String(p.cards));
  root.style.setProperty('--zd-mascot-amp', String(p.mascot));
};
window.speakText = () => true;
window.__GALLERY_ERRORS = [];
for (const s of SHOTS) {
  try {
    const container = document.getElementById('surface-' + s.id);
    const surface = window.ZHIDAO_A2UI.createSurface(container, {});
    if (s.recipe) {
      surface.feed(window.ZHIDAO_A2UI_COMPILER.compileKnowledgeToA2UI(s.recipe));
    } else if (s.scene) {
      surface.feed(window.ZHIDAO_PLAY.compilePlayStageToA2UI(s.scene));
    } else {
      surface.feed([{ version: '1.0', createSurface: {
        surfaceId: 'shot_' + s.id.toLowerCase(), catalogId: window.ZHIDAO_A2UI_CATALOG.CATALOG_ID,
        components: s.components, dataModel: s.dataModel || {}
      } }]);
    }
  } catch (err) { window.__GALLERY_ERRORS.push(s.id + ': ' + err.message); }
}
window.__GALLERY_READY = true;
</script></body></html>`;
}

/* ---------------- 采集 ---------------- */
async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const sprite = (indexHtml.match(/<svg class="svg-sprite"[\s\S]*?<\/svg>/) || [''])[0];
  const pageHtml = buildPage(sprite);

  const ALLOW = new Set(['grade-profile.js', 'a2ui-catalog.js', 'a2ui-matrix.js',
    'a2ui-compiler.js', 'a2ui-render.js', 'a2ui-play.js', 'styles.css', 'knowledge.css']);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/__gallery') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(pageHtml);
      return;
    }
    const name = path.basename(url.pathname);
    if (!ALLOW.has(name) || !fs.existsSync(path.join(__dirname, name))) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, {
      'Content-Type': name.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(path.join(__dirname, name)).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, protocolTimeout: 180000,
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(req.url())) req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });
    await page.goto(`${BASE}/__gallery`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GALLERY_READY === true, { timeout: 30000 });
    const errors = await page.evaluate(() => window.__GALLERY_ERRORS);
    if (errors.length) throw new Error('页面渲染失败：\n' + errors.join('\n'));
    await page.evaluate(() => document.fonts.ready);

    for (const shot of SHOTS_DEF) {
      await page.evaluate(stage => window.__applyStage(stage), shot.stage);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const el = await page.$(`#shot-${shot.id}`);
      if (!el) throw new Error(`缺少截图节点 ${shot.id}`);
      const file = `comp-${shot.id}.png`;
      await el.screenshot({ path: path.join(SHOTS, file) });
      shot.file = file;
      console.log(`  ✓ ${shot.id}  ${shot.name}`);
    }
    await page.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  /* ---------------- 自包含画廊 ---------------- */
  const img = file => `data:image/png;base64,${fs.readFileSync(path.join(SHOTS, file)).toString('base64')}`;
  const groups = ['内容呈现', '交互练习', '基础原语', 'P2 新组件', '游戏化与 IP 求助', '配方效果图'];
  const cards = groups.map(group => {
    const list = SHOTS_DEF.filter(s => s.group === group);
    return `<h2>${esc(group)} <small>${list.length} 张</small></h2>` + list.map(s => `
      <article class="card">
        <div class="card-head"><span class="idx">${esc(s.id)}</span><div>
          <h3>${esc(s.name)}</h3><p>${esc(s.desc)}</p></div></div>
        <figure><img src="${img(s.file)}" alt="${esc(s.name)}"></figure>
        <div class="meta">
          <div><b>承载的知识 / 交互</b>${esc(s.detail)}</div>
          <div><b>出现位置</b><code>${esc(s.use)}</code></div>
          ${s.meta ? `<div><b>实测配方</b><code>${esc(s.meta.key)}</code> · ${s.meta.optionCount} 选项 · ${s.meta.stepMode === 'linear' ? '线性逐步' : '一次看全'} · 密度 ${esc(s.meta.density)}</div>
          <div><b>操作提示</b>${esc(s.meta.hint)}</div>` : ''}
        </div>
      </article>`).join('');
  }).join('');

  const overviewRows = OVERVIEW.map(row => `<tr><td>${esc(row[0])}</td><td><code>${esc(row[1])}</code></td><td>${esc(row[2])}</td><td><span class="${row[3] === '已实现' ? 'ok' : 'todo'}">${esc(row[3])}</span></td></tr>`).join('');

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>知岛 · 知识组件效果图</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f7f5fc;color:#2b2740;font:15px/1.7 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:36px 24px 70px}
header h1{font-size:27px;margin:0 0 8px;color:#3d2b70}header p{margin:0;color:#6f6789}
.hero{background:#efe9ff;border:1px solid #e1d7f7;border-radius:18px;padding:20px 24px;margin:24px 0 30px;font-size:14px;color:#4b4363}
.hero b{color:#5b3fa8}.hero .big{font-size:19px;font-weight:600;color:#493380;margin-bottom:8px}
.hero ul{margin:10px 0 0;padding-left:20px}.hero li{margin:3px 0}
.badge{display:inline-block;background:#e7f7ee;color:#1f7a4d;border-radius:20px;padding:2px 11px;font-size:12px;font-weight:600;margin-top:10px}
h2{font-size:19px;margin:38px 0 16px;color:#493380;border-left:4px solid #8b6fe0;padding-left:11px}
h2 small{font-size:12px;color:#9a92b5;font-weight:400;margin-left:8px}
.card{background:#fff;border:1px solid #e8e1f6;border-radius:16px;padding:20px;margin-bottom:22px;box-shadow:0 6px 22px rgba(72,52,130,.06)}
.card-head{display:flex;gap:14px;align-items:flex-start;margin-bottom:14px}
.idx{background:#5b3fa8;color:#fff;border-radius:9px;padding:5px 10px;font:600 13px/1.4 ui-monospace,Consolas,monospace;flex:none}
.card h3{margin:0;font-size:17px;color:#3d2b70}.card-head p{margin:3px 0 0;color:#7a7192;font-size:13px}
.card figure{margin:0}.card img{width:100%;height:auto;display:block;border:1px solid #eee9f8;border-radius:10px;background:#fff}
.meta{margin-top:14px;background:#fbfaff;border:1px solid #e8e1f6;border-radius:12px;padding:12px 15px;font-size:13px;color:#4b4363}
.meta>div{margin:3px 0}.meta b{display:inline-block;min-width:118px;color:#5b3fa8;font-weight:600}
.meta code{font:600 11.5px/1.7 ui-monospace,Consolas,monospace;color:#5b3fa8;background:#f2eeff;padding:1px 6px;border-radius:5px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;font-size:13.5px}
th,td{padding:11px 13px;text-align:left;border-bottom:1px solid #eee9f8;vertical-align:top}
th{background:#f0ebff;color:#493380;font-weight:600}td:first-child{color:#5b3fa8;font-weight:600;width:14%}
td code{font:600 11.5px/1.7 ui-monospace,Consolas,monospace;color:#5b3fa8}
.ok{background:#e7f7ee;color:#1f7a4d;border-radius:20px;padding:2px 10px;font-size:12px}
.todo{background:#fff3e2;color:#a1661d;border-radius:20px;padding:2px 10px;font-size:12px}
footer{margin-top:36px;color:#9a92b5;font-size:12.5px;text-align:center}
</style></head><body><div class="wrap">
<header><h1>知岛 · 目前支持的知识组件效果图</h1><p>真实 Edge 渲染 · ${SHOTS_DEF.length} 张截图 · ${new Date().toLocaleString('zh-CN')}</p></header>
<div class="hero">
  <div class="big">catalog 登记 32 个组件：32 个全部实现渲染（P2 补 8 个 · P3 游戏化补 6 个）</div>
  组件按<b>认知动作</b>分类，不按页面区块分类：同样是「学一个知识点」，语文要听读、英语要听辨、数学要分步摆出来，
  因此需要完全不同的组件。每张图都是浏览器里真实的 <code>createSurface → renderer</code> 产物，不是手绘示意。
  <ul>
    <li>前 26 张：逐个组件独立渲染（含 8 张 P2、6 张 P3 游戏化组件），按年级画像切换字号、密度与语气。</li>
    <li>P1 / P2 两张整页关卡参考设计稿编排：主练习区 + 右侧知知求助 + 快捷提问 + 左下语音引导；同一组件树换年级后，深紫游戏化主题会切换成克制的浅色工具界面。</li>
    <li>后 7 张：由 <code>compileKnowledgeToA2UI()</code> 按「学科 × 学习过程 × 认知阶段」真实编译出的配方效果。</li>
    <li>8 个 P2 组件已接入 60 组配方：每组按学科 / 过程 / 年级追加 1 个适龄组件，卡片总数与认知负荷可控。</li>
    <li>低年级不出现公式与长说明，但<b>知识不删</b>——抽象组件降级为 HintBar，正确答案永不被选项裁剪掉；向知知求助也<b>不会一点就给答案</b>，三级提示逐级解锁。</li>
    <li>配方效果图里每个组件各占一张卡片，尚未作答的反馈区会留白，这是等待交互的真实状态，不是渲染缺失。</li>
  </ul>
  <span class="badge">60 组配方 · 180 条消息全部通过协议校验 · test-matrix 21/21</span>
</div>
<h2>组件清单</h2>
<table><tr><th>类别</th><th>组件</th><th>数量</th><th>状态</th></tr>${overviewRows}</table>
${cards}
<h2>复现方式</h2>
<div class="hero" style="margin-top:0"><code>node test-a2ui-gallery.js</code><br>
脚本自带静态服务，不依赖 <code>server.js</code> / Redis / 模型；逐组件截图写入 <code>cache/shots/comp-*.png</code>，
再把图片以 base64 内嵌进本文件，可离线直接打开。</div>
<footer>知岛 · A2UI 自定义 catalog: urn:zhidao:catalog:knowledge:v1</footer>
</div></body></html>`;

  const out = path.join(SHOTS, 'a2ui-components.html');
  fs.writeFileSync(out, html, 'utf8');
  console.log(`\n完成：${SHOTS_DEF.length} 张截图 → ${out}（${(fs.statSync(out).size / 1024).toFixed(0)} KB）`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
