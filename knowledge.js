/* 知识卡片 · 掌握度引擎
 *
 * 为什么需要独立一层：
 * 「新知识」和「已掌握」是产品概念，但判定依据必须来自孩子真实做过的事，
 * 而不是「系统给他讲过一次」。家长看到的卡片状态，要能回答一个问题：
 * 「我孩子真的会了吗？」所以状态只由「学习证据」推导，不看浏览量。
 *
 * 核心判定链：
 *   看过讲解        → 认识（seen）      只能算「刚接触」
 *   做过练习/写作  → 会用（practiced） 有输出，但可能对可能错
 *   连续答对        → 掌握（mastered）  有稳定正确性
 *
 * 遗忘处理：
 *   掌握不是永久的。距离最后一次正确证据超过遗忘窗口，掌握度按指数衰减，
 *   衰减到阈值以下时卡片从「已掌握」退回「需巩固」——这是真实学习规律，
 *   也让「已掌握」这个标签有可信度而不是一次性的荣誉。
 */
'use strict';

/** 证据类型及其对掌握度的贡献。 */
const EVIDENCE_TYPES = {
  // 看完了讲解（只代表接触过，不代表会）
  lesson: { weight: 0.12, label: '听过讲解', kind: 'exposure' },
  // 完成了练习并答对
  correct: { weight: 0.34, label: '练习答对', kind: 'performance' },
  // 完成了练习但答错
  wrong: { weight: 0.05, label: '练习答错', kind: 'performance' },
  // 自己动手写出了答案（仿写、解题）
  created: { weight: 0.3, label: '独立完成', kind: 'performance' },
  // 主动追问过，说明在主动思考
  asked: { weight: 0.1, label: '主动追问', kind: 'engagement' },
  // 复述/朗读
  recited: { weight: 0.09, label: '朗读复述', kind: 'engagement' }
};

/** 卡片状态。用户视角的四种。 */
const CARD_STATUS = {
  NEW: 'new',           // 新知识：目录里有，但孩子还没学过
  LEARNING: 'learning', // 学过了，但证据不足以判定掌握
  MASTERED: 'mastered', // 已掌握：连续正确 + 未遗忘
  REVIEW: 'review'      // 需巩固：曾经掌握，但按遗忘曲线回落了
};

const CARD_STATUS_META = {
  new: { label: '新知识', hint: '还没开始', color: 'new', order: 1 },
  learning: { label: '学习中', hint: '学过，还要再练', color: 'learning', order: 2 },
  mastered: { label: '已掌握', hint: '能独立做对', color: 'mastered', order: 3 },
  review: { label: '需巩固', hint: '以前会，现在生疏了', color: 'review', order: 0 }
};

/** 判定阈值。集中在这里，方便按年龄段调整。 */
const THRESHOLDS = {
  // 掌握度达到此值才算「已掌握」
  mastered: 0.62,
  // 低于此值则退回「需巩固」
  decayFloor: 0.45,
  // 接触类证据（讲解、朗读、追问）的合计上限。
  // 没有这个上限，「听 10 遍讲解」会把掌握度刷到 100%，
  // 卡片状态虽然仍由正确次数挡住，但家长看到的环是满的 —— 这是误导。
  exposureCap: 0.3,
  // 掌握至少需要几次正确证据（避免蒙对一次就贴标签）
  minCorrect: 2,
  // 遗忘窗口：超过这个天数没再正确，掌握度开始衰减
  forgetDays: 21,
  // 连续正确间隔超过此天数，视为重新巩固（记忆被重新提取过）
  relearnDays: 14,
  // 家长人工确认的有效期。过期后释放覆盖，让遗忘规律重新接管：
  // 家长说「他会了」是可信的，但半年后确实可能忘了，不能永久免检。
  manualHoldDays: 21
};

const DAY_MS = 86400000;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function daysBetween(from, to) {
  return Math.abs(Number(to) - Number(from)) / DAY_MS;
}

/** 把一个知识点归一化成稳定标识，保证同一知识点多次学习会落到同一张卡。 */
function normalizePoint(subject, input) {
  const text = String(input ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return `${subject}:${text}`;
}

/**
 * 根据证据序列计算掌握度与状态。
 *
 * 掌握度不是简单加权求和 —— 那样「听十遍讲解」会虚高。
 * 规则：
 *   1. 讲解类证据只提供基础分（上限 0.12 那一档），不会把卡片顶到掌握。
 *   2. 正确证据按「最近一次正确之后是否又复习过」计算增量，越久没复习，
 *      同样的正确次数贡献越低（提取强度衰减）。
 *   3. 错误证据不清零，但会把掌握度往下拉，并打断「连续正确」计数。
 *   4. 曾经达到 mastered 后，若距最后正确证据超过遗忘窗口，按指数衰减，
 *      低于 decayFloor 则退回 review。
 */
function evaluateCard(card, now = Date.now()) {
  const evidence = Array.isArray(card?.evidence) ? card.evidence : [];
  const sorted = [...evidence].sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
  const correct = sorted.filter(item => item.type === 'correct' || item.type === 'created');

  // 家长确认在有效期内优先于自动判定：
  // 系统只看得到 App 里的行为，孩子在纸上、课堂上学会的东西系统看不见。
  const manualAt = Number(card?.manualMasteredAt || 0);
  if (card?.manualMastered && manualAt && daysBetween(manualAt, now) <= THRESHOLDS.manualHoldDays) {
    return {
      status: CARD_STATUS.MASTERED, mastery: 1,
      correctCount: correct.length, totalCount: sorted.length,
      consecutiveCorrect: 0, lastCorrectAt: Number(correct[correct.length - 1]?.at || 0),
      everMastered: true, reason: '家长确认已掌握'
    };
  }

  if (!sorted.length) {
    return { status: CARD_STATUS.NEW, mastery: 0, correctCount: 0, totalCount: 0, lastCorrectAt: 0, reason: '还没有任何学习记录' };
  }

  const lastCorrectAt = correct.length ? Number(correct[correct.length - 1].at || 0) : 0;
  const totalCount = sorted.length;

  // 连续正确：以最后一次错误为界
  let consecutiveCorrect = 0;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const item = sorted[i];
    if (item.type === 'wrong') break;
    if (item.type === 'correct' || item.type === 'created') consecutiveCorrect += 1;
  }

  // 提取强度：距今越久，同样一次正确的贡献越低。
  // 14 天内算「刚复习过」（满额），之后按半衰期 21 天指数衰减。
  let gain = 0;
  let exposureGain = 0;
  for (const item of sorted) {
    const meta = EVIDENCE_TYPES[item.type];
    if (!meta) continue;
    let contribution = meta.weight;
    if (meta.kind === 'performance' && (item.type === 'correct' || item.type === 'created')) {
      const age = daysBetween(item.at || now, now);
      if (age > THRESHOLDS.relearnDays) {
        contribution *= Math.pow(0.5, (age - THRESHOLDS.relearnDays) / THRESHOLDS.forgetDays);
      }
      gain += contribution;
    } else {
      // 接触类证据单独累计并封顶，不参与「越刷越高」的累加
      exposureGain += contribution;
    }
  }
  gain += Math.min(THRESHOLDS.exposureCap, exposureGain);

  // 错误惩罚：最近一次错误影响更大
  const lastWrong = [...sorted].reverse().find(item => item.type === 'wrong');
  if (lastWrong) {
    const age = daysBetween(lastWrong.at || now, now);
    const penalty = age > THRESHOLDS.forgetDays ? 0.05 : 0.16;
    gain = Math.max(0, gain - penalty);
  }

  let mastery = clamp01(gain);
  const everMastered = Boolean(card?.everMastered);

  // 遗忘衰减：曾经掌握过，但很久没再正确，就往回落。
  if (everMastered && lastCorrectAt) {
    const age = daysBetween(lastCorrectAt, now);
    if (age > THRESHOLDS.forgetDays) {
      mastery *= Math.pow(0.5, (age - THRESHOLDS.forgetDays) / THRESHOLDS.forgetDays);
    }
  }

  const correctCount = correct.length;
  const enoughCorrect = correctCount >= THRESHOLDS.minCorrect;
  const enoughConsecutive = consecutiveCorrect >= THRESHOLDS.minCorrect;

  let status;
  let reason;
  if (mastery >= THRESHOLDS.mastered && enoughCorrect && enoughConsecutive) {
    status = CARD_STATUS.MASTERED;
    reason = `连续答对 ${consecutiveCorrect} 次`;
  } else if (everMastered && mastery < THRESHOLDS.decayFloor) {
    status = CARD_STATUS.REVIEW;
    reason = '以前掌握过，但有一段时间没碰了';
  } else {
    status = CARD_STATUS.LEARNING;
    reason = correctCount === 0
      ? '听过了，还需要动手练一次'
      : `已答对 ${correctCount} 次，再稳定一些就能算掌握`;
  }

  return {
    status,
    mastery: Math.round(mastery * 100) / 100,
    correctCount,
    totalCount,
    consecutiveCorrect,
    lastCorrectAt,
    everMastered: everMastered || status === CARD_STATUS.MASTERED,
    reason
  };
}

/**
 * 记录一条学习证据，返回更新后的卡片。
 * @param {object} card 现有卡片（可为 null）
 * @param {object} payload { type, point, subject, title, grade, detail, at }
 */
function applyEvidence(card, payload = {}) {
  const type = EVIDENCE_TYPES[payload.type] ? payload.type : 'lesson';
  const subject = payload.subject || card?.subject || 'chinese';
  const at = Number(payload.at || Date.now());
  const point = payload.point || card?.point || '';
  const evidence = Array.isArray(card?.evidence) ? [...card.evidence] : [];
  evidence.push({
    type,
    at,
    detail: String(payload.detail || '').slice(0, 240),
    // 记录时点用于展示「当时做了什么」
    meta: EVIDENCE_TYPES[type].label
  });
  // 只保留最近 60 条证据，避免卡片无限膨胀
  const trimmed = evidence.slice(-60);
  const next = {
    ...(card || {}),
    id: card?.id || '',
    subject,
    point,
    title: payload.title || card?.title || point,
    grade: payload.grade ?? card?.grade ?? '',
    evidence: trimmed,
    updatedAt: at,
    createdAt: card?.createdAt || at
  };
  // 家长确认过之后孩子又答错了：释放人工覆盖，让真实表现说话。
  if (type === 'wrong' && next.manualMastered) {
    next.manualMastered = false;
    next.manualMasteredAt = 0;
  }
  const evaluation = evaluateCard(next, at);
  return {
    ...next,
    status: evaluation.status,
    mastery: evaluation.mastery,
    correctCount: evaluation.correctCount,
    consecutiveCorrect: evaluation.consecutiveCorrect,
    lastCorrectAt: evaluation.lastCorrectAt,
    everMastered: evaluation.everMastered,
    reason: evaluation.reason
  };
}

/**
 * 家长手动标记「已掌握」/「还需练习」。
 *
 * 为什么要有人工干预：系统只能看到 app 里的行为，孩子在纸上、在课堂上、
 * 在生活里学会的东西，系统看不见。家长的一句「这个他会了」比任何自动判定都权威。
 */
function applyManualMark(card, mark = {}) {
  const at = Number(mark.at || Date.now());
  const mastered = mark.mastered !== false;
  const next = { ...(card || {}) };
  const prior = Array.isArray(card?.evidence) ? card.evidence : [];
  // 人工判定写成卡片上的显式标记，而不是靠临时塞一条证据。
  // 否则 listCards 每次重算时会用「连续正确次数」把家长的确认悄悄推翻。
  next.manualMastered = mastered;
  next.manualMasteredAt = mastered ? at : 0;
  next.evidence = [
    ...prior,
    mastered
      ? { type: 'created', at, detail: String(mark.detail || '家长确认已掌握'), meta: '家长确认', manual: true }
      : { type: 'wrong', at, detail: String(mark.detail || '家长标记为还需练习'), meta: '家长标记', manual: true }
  ];
  next.updatedAt = at;
  const evaluation = evaluateCard(next, at);
  return {
    ...next,
    status: mastered ? CARD_STATUS.MASTERED : evaluation.status,
    mastery: mastered ? 1 : evaluation.mastery,
    correctCount: evaluation.correctCount,
    consecutiveCorrect: evaluation.consecutiveCorrect,
    lastCorrectAt: evaluation.lastCorrectAt,
    everMastered: mastered || evaluation.everMastered,
    reason: mastered ? '家长确认已掌握' : evaluation.reason
  };
}

/** 卡片包：把卡片按状态分装成家长能直接看懂的三个包。 */
const PACK_DEFS = [
  {
    key: 'new',
    title: '还没开始',
    subtitle: '目录里已备好，等孩子来点亮',
    status: CARD_STATUS.NEW,
    color: 'new'
  },
  {
    key: 'learning',
    title: '正在学',
    subtitle: '接触过了，还需要再练几次',
    status: CARD_STATUS.LEARNING,
    color: 'learning'
  },
  {
    key: 'mastered',
    title: '已掌握',
    subtitle: '能独立做对，遗忘后会回到巩固区',
    status: CARD_STATUS.MASTERED,
    color: 'mastered'
  },
  {
    key: 'review',
    title: '需要巩固',
    subtitle: '以前会了，隔了一阵子该回来看一眼',
    status: CARD_STATUS.REVIEW,
    color: 'review'
  }
];

function buildPacks(cards = []) {
  const packs = PACK_DEFS.map(def => ({ ...def, cards: [], total: 0 }));
  const index = new Map(packs.map(pack => [pack.status, pack]));
  for (const card of cards) {
    const pack = index.get(card.status) || packs[1];
    pack.cards.push(card);
    pack.total += 1;
  }
  // 已掌握排前面（家长最想看成就），需巩固排最前（最需要行动）
  const order = { review: 0, mastered: 1, learning: 2, new: 3 };
  packs.sort((a, b) => order[a.key] - order[b.key]);
  for (const pack of packs) {
    pack.cards.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }
  return packs;
}

/** 汇总统计，用于家长看板顶部的进度条。 */
function summarize(cards = []) {
  const total = cards.length;
  const byStatus = { new: 0, learning: 0, mastered: 0, review: 0 };
  let masterySum = 0;
  for (const card of cards) {
    if (byStatus[card.status] !== undefined) byStatus[card.status] += 1;
    masterySum += Number(card.mastery || 0);
  }
  const attempted = total - byStatus.new;
  return {
    total,
    attempted,
    byStatus,
    masteryRate: attempted ? Math.round((byStatus.mastered / attempted) * 100) : 0,
    averageMastery: total ? Math.round((masterySum / total) * 100) : 0
  };
}

module.exports = {
  EVIDENCE_TYPES,
  CARD_STATUS,
  CARD_STATUS_META,
  THRESHOLDS,
  PACK_DEFS,
  normalizePoint,
  evaluateCard,
  applyEvidence,
  applyManualMark,
  buildPacks,
  summarize
};
