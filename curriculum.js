/* 知识点目录：新知识包的候选来源。
 *
 * 为什么需要目录：孩子在这个 App 里学过的知识点是零散的，
 * 家长却需要回答「接下来该学什么」。目录按学科 + 年级给出体系化的候选，
 * 让「新知识包」不只包含历史遗留，而是指向真实的下一步。
 *
 * 结构：subject → gradeId → [{ id, title, tags, keywords }]
 * keywords 用于把用户输入的任意表述匹配回目录条目（口语 → 学科术语）。
 */
'use strict';

const CATALOG = {
  chinese: {
    label: '语文',
    grades: {
      grade1: [
        { id: 'ch-g1-zi', title: '认字与拼音', tags: ['识字'], keywords: ['拼音', '声母', '韵母', '认字', '生字'] },
        { id: 'ch-g1-ju', title: '把一句话说完整', tags: ['句子'], keywords: ['句子', '完整句', '造句'] },
        { id: 'ch-g1-chengyu', title: '身边的成语', tags: ['成语'], keywords: ['成语', '四字词语', '词语'] }
      ],
      grade2: [
        { id: 'ch-g2-ju', title: '逗号、句号与问号', tags: ['标点'], keywords: ['标点', '逗号', '句号', '问号'] },
        { id: 'ch-g2-biyu', title: '打比方', tags: ['修辞'], keywords: ['比喻', '打比方', '像'] },
        { id: 'ch-g2-riju', title: '古诗一首', tags: ['古诗'], keywords: ['古诗', '唐诗', '背诵'] }
      ],
      grade3: [
        { id: 'ch-g3-biyu', title: '比喻与拟人', tags: ['修辞'], keywords: ['比喻', '拟人', '修辞'] },
        { id: 'ch-g3-ju', title: '把句子写具体', tags: ['句子'], keywords: ['具体', '扩句', '缩句', '修改病句'] },
        { id: 'ch-g3-yuedu', title: '读懂一段话', tags: ['阅读'], keywords: ['阅读', '段落', '概括', '中心'] }
      ],
      grade4: [
        { id: 'ch-g4-chengyu', title: '成语背后的故事', tags: ['成语'], keywords: ['成语', '典故', '故事'] },
        { id: 'ch-g4-bi', title: '修辞的组合运用', tags: ['修辞'], keywords: ['修辞', '排比', '夸张', '设问'] },
        { id: 'ch-g4-yuedu', title: '体会人物心情', tags: ['阅读'], keywords: ['人物', '心情', '体会', '感受'] }
      ],
      grade5: [
        { id: 'ch-g5-shuoming', title: '说明方法', tags: ['说明文'], keywords: ['说明方法', '列数字', '打比方', '说明文'] },
        { id: 'ch-g5-jufa', title: '句式转换', tags: ['句式'], keywords: ['句式转换', '把字句', '被字句', '反问'] },
        { id: 'ch-g5-yuedu', title: '读书方法与批注', tags: ['阅读'], keywords: ['读书', '批注', '方法', '做笔记'] }
      ],
      grade6: [
        { id: 'ch-g6-wenyan', title: '文言文小段', tags: ['文言文'], keywords: ['文言文', '之乎者也', '古文'] },
        { id: 'ch-g6-bijiao', title: '对比与衬托', tags: ['写作'], keywords: ['对比', '衬托', '写作', '选材'] },
        { id: 'ch-g6-shuxie', title: '围绕中心选材', tags: ['写作'], keywords: ['中心', '选材', '围绕'] }
      ],
      grade7: [
        { id: 'ch-g7-yuedu', title: '记叙文阅读', tags: ['阅读'], keywords: ['记叙文', '阅读', '线索', '顺序'] },
        { id: 'ch-g7-ciyu', title: '词语的感情色彩', tags: ['基础'], keywords: ['感情色彩', '词语', '褒贬'] },
        { id: 'ch-g7-xiezuo', title: '写好一件事', tags: ['写作'], keywords: ['写事', '作文', '记叙', '细节'] }
      ],
      grade8: [
        { id: 'ch-g8-wenyan', title: '文言实词与虚词', tags: ['文言文'], keywords: ['文言', '实词', '虚词', '一词多义'] },
        { id: 'ch-g8-shuoming', title: '说明文阅读', tags: ['说明文'], keywords: ['说明文', '说明顺序', '准确'] },
        { id: 'ch-g8-xiezuo', title: '写好一个人', tags: ['写作'], keywords: ['写人', '作文', '人物描写'] }
      ],
      grade9: [
        { id: 'ch-g9-yilun', title: '议论文的论证', tags: ['议论文'], keywords: ['议论文', '论证', '论点', '论据'] },
        { id: 'ch-g9-jingdian', title: '文学常识与名著', tags: ['积累'], keywords: ['文学常识', '名著', '作者'] },
        { id: 'ch-g9-zonghe', title: '综合性学习', tags: ['综合'], keywords: ['综合性学习', '活动', '策划'] }
      ]
    }
  },
  english: {
    label: '英语',
    grades: {
      grade1: [
        { id: 'en-g1-letter', title: '字母与自然拼读', tags: ['字母'], keywords: ['字母', '自然拼读', 'phonics'] },
        { id: 'en-g1-hello', title: '日常问候语', tags: ['口语'], keywords: ['hello', '问候', '打招呼'] }
      ],
      grade2: [
        { id: 'en-g2-color', title: '颜色与数字', tags: ['词汇'], keywords: ['颜色', '数字', 'colour', 'number'] },
        { id: 'en-g2-be', title: 'be 动词', tags: ['语法'], keywords: ['be动词', 'am', 'is', 'are'] }
      ],
      grade3: [
        { id: 'en-g3-present', title: '一般现在时', tags: ['语法'], keywords: ['一般现在时', 'present simple', '第三人称单数'] },
        { id: 'en-g3-look', title: '看图说话', tags: ['口语'], keywords: ['看图说话', '描述', 'picture'] }
      ],
      grade4: [
        { id: 'en-g4-plural', title: '名词复数', tags: ['语法'], keywords: ['复数', 'plural', '名词'] },
        { id: 'en-g4-yu', title: '介词 in / on / at', tags: ['语法'], keywords: ['介词', 'in', 'on', 'at'] },
        { id: 'en-g4-clothes', title: '衣物与穿戴', tags: ['词汇'], keywords: ['衣物', '穿', 'clothes', 'wear'] }
      ],
      grade5: [
        { id: 'en-g5-there', title: 'There be 句型', tags: ['语法'], keywords: ['there be', 'there is', 'there are'] },
        { id: 'en-g5-yingyu', title: '现在进行时', tags: ['语法'], keywords: ['现在进行时', 'ing', 'progressive'] },
        { id: 'en-g5-pinlv', title: '频度副词', tags: ['语法'], keywords: ['频度', 'always', 'usually', 'often'] }
      ],
      grade6: [
        { id: 'en-g6-past', title: '一般过去时', tags: ['语法'], keywords: ['一般过去时', 'past simple', '过去式'] },
        { id: 'en-g6-bijiao', title: '形容词比较级', tags: ['语法'], keywords: ['比较级', '最高级', 'taller'] },
        { id: 'en-g6-shenghuo', title: '日常作息表达', tags: ['口语'], keywords: ['作息', '生活', 'daily'] }
      ],
      grade7: [
        { id: 'en-g7-dai', title: '情态动词', tags: ['语法'], keywords: ['情态动词', 'can', 'must', 'should'] },
        { id: 'en-g7-teshuti', title: '特殊疑问句', tags: ['语法'], keywords: ['特殊疑问句', 'what', 'where', 'how'] },
        { id: 'en-g7-xiezuo', title: '小作文：介绍自己', tags: ['写作'], keywords: ['写作', '介绍自己', '作文'] }
      ],
      grade8: [
        { id: 'en-g8-wancheng', title: '现在完成时', tags: ['语法'], keywords: ['现在完成时', 'have', 'has', 'already'] },
        { id: 'en-g8-lianhe', title: '连词与从句', tags: ['语法'], keywords: ['连词', '从句', 'because', 'although', 'if'] },
        { id: 'en-g8-yuedu', title: '阅读理解：细节题', tags: ['阅读'], keywords: ['阅读', '细节题', 'reading'] }
      ],
      grade9: [
        { id: 'en-g9-beidong', title: '被动语态', tags: ['语法'], keywords: ['被动语态', 'passive', 'be + done'] },
        { id: 'en-g9-feidong', title: '非谓语动词', tags: ['语法'], keywords: ['非谓语', '不定式', '动名词', '分词'] },
        { id: 'en-g9-jianding', title: '中考写作：图表与书信', tags: ['写作'], keywords: ['中考写作', '书信', '图表', '作文'] }
      ]
    }
  },
  math: {
    label: '数学',
    grades: {
      grade1: [
        { id: 'ma-g1-jiajian', title: '10 以内加减法', tags: ['计算'], keywords: ['加法', '减法', '凑十', '10以内'] },
        { id: 'ma-g1-tubiao', title: '认识图形与立体', tags: ['图形'], keywords: ['图形', '立体', '正方体', '圆柱'] }
      ],
      grade2: [
        { id: 'ma-g2-chengfa', title: '表内乘除法', tags: ['计算'], keywords: ['乘法', '除法', '九九表', '口诀'] },
        { id: 'ma-g2-weiyuan', title: '长度单位与测量', tags: ['测量'], keywords: ['长度', '厘米', '米', '测量'] }
      ],
      grade3: [
        { id: 'ma-g3-frac', title: '分数的初步认识', tags: ['数与代数'], keywords: ['分数', '几分之一', '几分之几'] },
        { id: 'ma-g3-mianji', title: '长方形正方形的面积', tags: ['几何'], keywords: ['面积', '长方形', '正方形'] },
        { id: 'ma-g3-zhouchang', title: '周长的计算', tags: ['几何'], keywords: ['周长', '一圈'] }
      ],
      grade4: [
        { id: 'ma-g4-dashu', title: '大数的认识', tags: ['数与代数'], keywords: ['大数', '亿', '万', '数位'] },
        { id: 'ma-g4-yunsuan', title: '运算律与简便计算', tags: ['计算'], keywords: ['运算律', '简便计算', '乘法分配律'] },
        { id: 'ma-g4-sanjiao', title: '三角形的特性', tags: ['几何'], keywords: ['三角形', '内角和', '稳定性'] }
      ],
      grade5: [
        { id: 'ma-g5-xiaoshu', title: '小数的意义与运算', tags: ['数与代数'], keywords: ['小数', '小数乘法', '小数除法'] },
        { id: 'ma-g5-fangcheng', title: '简易方程', tags: ['数与代数'], keywords: ['方程', '用字母表示数', '解方程'] },
        { id: 'ma-g5-mianji2', title: '多边形的面积', tags: ['几何'], keywords: ['平行四边形', '梯形', '三角形面积'] }
      ],
      grade6: [
        { id: 'ma-g6-fenshu', title: '分数与百分数', tags: ['数与代数'], keywords: ['分数', '百分数', '分数乘法', '分数除法'] },
        { id: 'ma-g6-bi', title: '比和比例', tags: ['数与代数'], keywords: ['比', '比例', '比例尺'] },
        { id: 'ma-g6-yuan', title: '圆的认识与面积', tags: ['几何'], keywords: ['圆', '半径', '直径', '圆面积'] }
      ],
      grade7: [
        { id: 'ma-g7-youli', title: '有理数与运算', tags: ['数与代数'], keywords: ['有理数', '正负数', '绝对值'] },
        { id: 'ma-g7-yishi', title: '整式的加减', tags: ['数与代数'], keywords: ['整式', '单项式', '多项式', '合并同类项'] },
        { id: 'ma-g7-yici', title: '一元一次方程', tags: ['数与代数'], keywords: ['一元一次方程', '解方程', '移项', '应用题'] }
      ],
      grade8: [
        { id: 'ma-g8-shuzi', title: '一次函数', tags: ['函数'], keywords: ['一次函数', '函数', '图像', '斜率'] },
        { id: 'ma-g8-quaneng', title: '全等三角形', tags: ['几何'], keywords: ['全等', '全等三角形', 'SSS', 'SAS'] },
        { id: 'ma-g8-gougu', title: '勾股定理', tags: ['几何'], keywords: ['勾股定理', '直角三角形', '斜边'] }
      ],
      grade9: [
        { id: 'ma-g9-erci', title: '二次函数', tags: ['函数'], keywords: ['二次函数', '抛物线', '顶点', '对称轴'] },
        { id: 'ma-g9-xiesi', title: '相似三角形', tags: ['几何'], keywords: ['相似', '相似比'] },
        { id: 'ma-g9-ruijiao', title: '锐角三角函数', tags: ['几何'], keywords: ['锐角', '三角函数', 'sin', 'cos', 'tan'] }
      ]
    }
  }
};

/** 某年级的全部条目（三个学科）。 */
function pointsForGrade(gradeId) {
  const out = [];
  for (const [subject, group] of Object.entries(CATALOG)) {
    for (const point of group.grades[gradeId] || []) {
      out.push({ ...point, subject, subjectLabel: group.label, grade: gradeId });
    }
  }
  return out;
}

/** 全部目录条目。 */
function allPoints() {
  const out = [];
  for (const [subject, group] of Object.entries(CATALOG)) {
    for (const [gradeId, points] of Object.entries(group.grades)) {
      for (const point of points) {
        out.push({ ...point, subject, subjectLabel: group.label, grade: gradeId });
      }
    }
  }
  return out;
}

/**
 * 用用户输入反查目录条目。
 *
 * 场景：家长输入「二次函数怎么考」，需要归到目录里的「二次函数」条目，
 * 这样它才能进入「已学 / 未学」的对账里，而不是变成一张孤立卡片。
 *
 * 打分规则：完全命中标题最高；命中关键词次之；标题被输入包含也算命中。
 */
function matchPoint(input, subject = '') {
  const text = String(input ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  if (!text) return null;
  let best = null;
  for (const point of allPoints()) {
    if (subject && point.subject !== subject) continue;
    const title = point.title.toLowerCase().replace(/\s+/g, '');
    let score = 0;
    if (text === title) score = 100;
    else if (text.includes(title) || title.includes(text) && text.length >= 3) score = 70;
    else {
      for (const keyword of point.keywords || []) {
        const key = String(keyword).toLowerCase().replace(/\s+/g, '');
        if (!key) continue;
        if (text.includes(key)) score = Math.max(score, 40 + key.length);
        else if (key.includes(text) && text.length >= 3) score = Math.max(score, 35);
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { ...point, score };
  }
  return best && best.score >= 35 ? best : null;
}

module.exports = { CATALOG, pointsForGrade, allPoints, matchPoint };
