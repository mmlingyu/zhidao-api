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
  春天: ['春暖花开', '万物复苏', '春意盎然', '生机勃勃', '百花齐放', '鸟语花香']
};

/** 按输入内容挑一组真实成语候选，供提示词与自愈重写使用。 */
function candidates(input = '', limit = 8) {
  const text = String(input);
  const picked = new Set();
  for (const [theme, words] of Object.entries(THEME_IDIOMS)) {
    if (!text.includes(theme)) continue;
    for (const word of words) picked.add(word);
  }
  // 主题没命中时给一组通用候选，避免提示里没有可照抄的例子。
  if (!picked.size) {
    for (const word of ['水天一色', '海阔天空', '风和日丽', '春暖花开', '神采奕奕', '豁然开朗']) picked.add(word);
  }
  const list = [...picked].filter(word => load().has(word));
  return list.slice(0, limit);
}

module.exports = { isIdiom, lookup, size, candidates };
