/* 成语词库：判断模型给出的「成语」是否真实存在，并提供权威的拼音与释义。
 *
 * 数据来源：中华新华字典成语库（chinese-xinhua / citysay idiom-database），
 * 另补充一批中小学生常用但词典未收的成语。
 *
 * 为什么要它：1.7B 小模型常把科学术语、输入词本身或自造短语当成成语
 * （如「光合作用」「卡尔文循环」「蔚蓝天空」）。仅靠「长度 ≥ 4 字」拦不住，
 * 必须有权威词表才能判定真伪。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, 'idioms.json');

let table = null;

function load() {
  if (table) return table;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    table = new Map();
    for (const [word, info] of Object.entries(raw)) {
      table.set(word, { pinyin: info.p, meaning: info.e });
    }
  } catch (error) {
    // 词库缺失不应让整个服务起不来：此时退化为「不做词表校验」。
    console.warn(`[idioms] 成语词库加载失败（${error.message}），已跳过词表校验`);
    table = new Map();
  }
  return table;
}

/** 该词是否为真实存在的成语。 */
function isIdiom(word) {
  if (typeof word !== 'string') return false;
  const key = word.trim();
  if (!key) return false;
  return load().has(key);
}

/** 取成语的权威拼音与释义；不是成语时返回 null。 */
function lookup(word) {
  if (typeof word !== 'string') return null;
  const key = word.trim();
  if (!key) return null;
  return load().get(key) || null;
}

/** 词库规模（用于健康检查与测试）。 */
function size() {
  return load().size;
}

/* 常见主题 → 真实成语。小模型重写时「照着候选挑」比「凭空想」成功率高得多，
 * 所以自愈提示词里要带上具体候选，而不是只说「请用真实成语」。 */
const THEME_IDIOMS = {
  天空: ['晴空万里', '碧空如洗', '天高云淡', '万里无云', '天朗气清', '风和日丽'],
  阳光: ['阳光明媚', '春光明媚', '风和日丽', '万里无云', '晴空万里', '金光灿烂'],
  植物: ['春暖花开', '百花齐放', '万紫千红', '鸟语花香', '绿树成荫', '枝繁叶茂', '生机勃勃', '生机盎然'],
  自然: ['生机盎然', '绿意盎然', '郁郁葱葱', '生机勃勃', '焕然一新', '美不胜收'],
  心情: ['心旷神怡', '兴高采烈', '眉开眼笑', '喜笑颜开', '心花怒放', '欢天喜地', '喜出望外', '兴致勃勃', '神采奕奕'],
  开心: ['笑容如花', '眉开眼笑', '兴高采烈', '喜笑颜开', '心花怒放', '欢天喜地', '满心欢喜', '神清气爽'],
  学习: ['全神贯注', '专心致志', '废寝忘食', '持之以恒', '锲而不舍', '精益求精', '温故知新', '举一反三', '融会贯通', '学以致用'],
  领悟: ['恍然大悟', '豁然开朗', '茅塞顿开', '融会贯通', '受益匪浅', '举一反三'],
  坚持: ['持之以恒', '锲而不舍', '水滴石穿', '坚持不懈', '力争上游', '再接再厉'],
  景色: ['美不胜收', '目不暇接', '应接不暇', '琳琅满目', '绚丽多彩', '别具一格'],
  成长: ['茁壮成长', '生机勃勃', '欣欣向荣', '蒸蒸日上', '日新月异', '突飞猛进'],
  春天: ['春暖花开', '万物复苏', '春意盎然', '生机勃勃', '百花齐放', '鸟语花香'],
  沟通: ['推心置腹', '心平气和', '开诚布公', '畅所欲言', '设身处地', '和颜悦色', '将心比心', '苦口婆心'],
  交流: ['推心置腹', '开诚布公', '畅所欲言', '娓娓而谈', '设身处地', '将心比心'],
  说话: ['语重心长', '和颜悦色', '娓娓而谈', '和风细雨', '畅所欲言', '平心静气'],
  妈妈: ['舐犊情深', '关怀备至', '问寒问暖', '苦口婆心', '语重心长', '循循善诱'],
  家人: ['舐犊情深', '关怀备至', '问寒问暖', '骨肉相连', '情真意切'],
  倾听: ['设身处地', '将心比心', '推己及人', '心平气和']
};

const GENERIC_FALLBACK = ['水天一色', '海阔天空', '风和日丽', '春暖花开', '神采奕奕', '豁然开朗'];
const INPUT_STOPWORDS = new Set(['如何', '怎么', '怎样', '为什么', '什么', '一个', '一些', '一下', '以及', '关于', '对于', '如果', '因为', '所以', '而且', '这个', '那个', '我们', '他们', '自己', '可以', '应该', '需要', '进行', '还有', '或者', '不是', '没有', '就是', '还是', '的话', '请帮', '帮我', '告诉', '解释', '请问', '帮助']);

/** 从输入里抽出可用于匹配词库的关键词（丢掉「如何」「怎么」等问句词）。 */
function keywords(input = '') {
  const text = String(input || '').replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, ' ');
  const parts = text.split(/[的了呢吗是和与或在把被就都也还及与跟同向]\s*|\s+/).filter(Boolean);
  return [...new Set(parts.filter(part => part.length >= 2 && !INPUT_STOPWORDS.has(part)))];
}

function isGenericFallback(words = []) {
  const list = (Array.isArray(words) ? words : []).map(word => String(word || '').trim());
  if (!list.length) return false;
  const hits = list.filter(word => GENERIC_FALLBACK.includes(word)).length;
  return hits >= 2;
}

/** 按输入内容挑一组真实成语候选，供提示词与自愈重写使用。
 *  优先主题表，再按关键词扫词库释义；只有完全没有命中时才用通用兜底。
 *  options.allowGeneric === false 时不返回「海阔天空」这类与主题无关的默认词。 */
function candidates(input = '', limit = 8, options = {}) {
  const text = String(input || '');
  const allowGeneric = options.allowGeneric !== false;
  const seen = new Set();
  const picked = [];
  const add = (word, score) => {
    const key = String(word || '').trim();
    if (!key || seen.has(key) || !load().has(key)) return;
    seen.add(key);
    picked.push({ word: key, score: score || 0 });
  };
  for (const [theme, words] of Object.entries(THEME_IDIOMS)) {
    if (!text.includes(theme)) continue;
    for (const word of words) add(word, 100);
  }
  const keys = keywords(text);
  if (keys.length) {
    const scored = [];
    for (const [word, info] of load()) {
      if (seen.has(word)) continue;
      let score = 0;
      const meaning = info.meaning || '';
      for (const token of keys) {
        if (word.includes(token)) score += 6;
        if (meaning.includes(token)) score += 3;
      }
      if (score >= 3) scored.push({ word, score });
    }
    scored.sort((a, b) => b.score - a.score);
    for (const item of scored.slice(0, Math.max(limit * 4, 24))) add(item.word, item.score);
  }
  picked.sort((a, b) => b.score - a.score);
  let list = picked.map(item => item.word);
  if (!list.length && allowGeneric) list = GENERIC_FALLBACK.filter(word => load().has(word));
  return list.slice(0, limit);
}

module.exports = { isIdiom, lookup, size, candidates, keywords, isGenericFallback, GENERIC_FALLBACK };
