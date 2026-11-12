/* 知识卡片仓储：把「孩子学了什么、掌握到什么程度」持久化。
 *
 * 与用户体系同构：Redis 优先、本地 JSON 兜底，服务重启不丢数据。
 * 数据归属家庭成员（memberId），家长能看所有孩子的卡，孩子只看自己的。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  normalizePoint, evaluateCard, applyEvidence, applyManualMark, buildPacks, summarize
} = require('./knowledge');
const { pointsForGrade, matchPoint } = require('./curriculum');

const CARD_STORE_VERSION = 1;

function now() { return Date.now(); }
function cardId(subject, point) {
  return `kcd_${crypto.createHash('sha1').update(`${subject}::${point}`).digest('hex').slice(0, 14)}`;
}

/* ---------------- 本地 JSON 存储 ---------------- */

class LocalCardStore {
  constructor({ dir }) {
    this.name = 'local';
    this.dir = dir;
    this.writeChain = Promise.resolve();
    fs.mkdirSync(this.dir, { recursive: true });
  }
  fileFor(key) { return path.join(this.dir, `${key.replace(/[^\w.-]/g, '_')}.json`); }
  async get(key) {
    try {
      const raw = await fs.promises.readFile(this.fileFor(key), 'utf8');
      const entry = JSON.parse(raw);
      if (entry?.version !== CARD_STORE_VERSION) return null;
      return entry.payload ?? null;
    } catch { return null; }
  }
  async put(key, payload) {
    const file = this.fileFor(key);
    const data = JSON.stringify({ version: CARD_STORE_VERSION, key, updatedAt: now(), payload });
    const tmp = `${file}.${process.pid}.tmp`;
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      await fs.promises.writeFile(tmp, data, 'utf8');
      await fs.promises.rename(tmp, file);
    }).catch(error => {
      console.warn(`[cards:local] 写入失败：${error.message}`);
      try { fs.unlinkSync(tmp); } catch { /* 忽略 */ }
      throw error;
    });
    await this.writeChain;
    return payload;
  }
  async remove(key) { await fs.promises.unlink(this.fileFor(key)).catch(() => {}); }
  async list(prefix = '') {
    if (!fs.existsSync(this.dir)) return [];
    const out = [];
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      const key = file.slice(0, -5);
      if (!key.startsWith(prefix.replace(/[^\w.-]/g, '_'))) continue;
      const payload = await this.get(key);
      if (payload) out.push({ key, payload });
    }
    return out;
  }
  describe() { return { backend: 'local', dir: this.dir }; }
}

/* ---------------- Redis 存储 ---------------- */

class RedisCardStore {
  constructor({ redis, prefix, namespace }) {
    this.name = 'redis';
    this.redis = redis;
    this.namespace = `${prefix}:v${CARD_STORE_VERSION}:${namespace}`;
  }
  keyFor(key) { return `${this.namespace}:${key}`; }
  async get(key) {
    const raw = await this.redis.get(this.keyFor(key));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  async put(key, payload) {
    await this.redis.set(this.keyFor(key), JSON.stringify(payload));
    return payload;
  }
  async remove(key) { await this.redis.del(this.keyFor(key)); }
  async list(prefix = '') {
    const found = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', `${this.namespace}:${prefix}*`, 'COUNT', 200);
      cursor = next;
      for (const item of batch) found.push(item.slice(this.namespace.length + 1));
    } while (cursor !== '0');
    const out = [];
    for (const key of found) {
      const payload = await this.get(key);
      if (payload) out.push({ key, payload });
    }
    return out;
  }
  describe() { return { backend: 'redis' }; }
}

/* ---------------- 卡片服务 ---------------- */

class CardService {
  constructor({ repository }) {
    this.repo = repository;
  }

  /** 读取某成员的卡片索引。 */
  async listCards(memberId) {
    const items = await this.repo.list(`cards:${memberId}:`);
    const cards = items.map(item => item.payload).filter(Boolean);
    // 每次读取都重新评估：遗忘是随时间发生的，不能只在写入时算一次。
    const evaluated = cards.map(card => {
      const result = evaluateCard(card, now());
      return {
        ...card,
        status: result.status,
        mastery: result.mastery,
        correctCount: result.correctCount,
        consecutiveCorrect: result.consecutiveCorrect,
        lastCorrectAt: result.lastCorrectAt,
        everMastered: result.everMastered || card.everMastered,
        reason: result.reason
      };
    });
    evaluated.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    return evaluated;
  }

  async getCard(memberId, id) {
    const cards = await this.listCards(memberId);
    return cards.find(card => card.id === id) || null;
  }

  /**
   * 记录一条学习证据。
   * @param {string} memberId 归属成员
   * @param {object} payload { type, subject, point, title, grade, detail, at }
   */
  async record(memberId, payload = {}) {
    const subject = ['chinese', 'english', 'math'].includes(payload.subject) ? payload.subject : 'chinese';
    const rawPoint = String(payload.point || payload.title || '').trim();
    if (!rawPoint) throw Object.assign(new Error('缺少知识点'), { statusCode: 400 });

    // 优先归到目录条目，让「目录进度」和「实际学习」能对上账。
    const matched = matchPoint(rawPoint, subject);
    const point = matched ? matched.id : normalizePoint(subject, rawPoint);
    const title = matched ? matched.title : rawPoint;
    const grade = payload.grade || matched?.grade || '';

    const id = cardId(subject, point);
    const key = `cards:${memberId}:${id}`;
    const existing = await this.repo.read(key);
    const card = applyEvidence(existing, {
      type: payload.type,
      point,
      subject,
      title,
      grade,
      detail: payload.detail,
      at: payload.at
    });
    card.id = id;
    card.memberId = memberId;
    card.catalogTitle = matched ? matched.title : '';
    card.catalogTags = matched ? matched.tags || [] : [];
    await this.repo.write(key, card);
    return card;
  }

  /** 家长手动标记掌握 / 需练习。 */
  async mark(memberId, id, { mastered, detail, at } = {}) {
    const key = `cards:${memberId}:${id}`;
    const existing = await this.repo.read(key);
    if (!existing) throw Object.assign(new Error('卡片不存在'), { statusCode: 404 });
    const card = applyManualMark(existing, { mastered, detail, at });
    card.id = id;
    card.memberId = memberId;
    await this.repo.write(key, card);
    return card;
  }

  /**
   * 生成家长看板数据：三个卡片包 + 目录对账。
   *
   * 目录对账回答的是「还有哪些没学过」——
   * 只看历史卡片的话，家长永远不知道孩子的知识地图上还有哪些空白。
   */
  async buildBoard(memberId, { grade = '', subject = '' } = {}) {
    const cards = await this.listCards(memberId);
    const summary = summarize(cards);
    const packs = buildPacks(cards);

    // 目录空白：按年级列出还没碰过的条目
    const studied = new Set(cards.map(card => card.point));
    const candidateGrades = grade ? [grade] : [];
    const pending = [];
    if (candidateGrades.length) {
      for (const point of pointsForGrade(candidateGrades[0])) {
        if (subject && point.subject !== subject) continue;
        if (studied.has(point.id)) continue;
        pending.push({
          id: point.id,
          title: point.title,
          subject: point.subject,
          subjectLabel: point.subjectLabel,
          grade: point.grade,
          tags: point.tags,
          keywords: point.keywords
        });
      }
    }

    return { cards, packs, summary, pending };
  }
}

module.exports = { CardService, LocalCardStore, RedisCardStore, CARD_STORE_VERSION, cardId };
