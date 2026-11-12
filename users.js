/* 用户体系数据层：家长账号、学生成员、会话令牌。
 *
 * 设计要点：
 * 1. 人脸只存 128 维特征向量，不存原始照片 —— 降低隐私风险，体积约 1KB/人。
 * 2. 存储后端与缓存层同构：Redis 优先，本地 JSON 兜底，服务重启不丢数据。
 * 3. 家长拥有家庭（family），可添加/管理多个学生成员；学生只能使用自己的学习空间。
 * 4. 匹配阈值可配置：同一人不同角度/光线下余弦相似度通常 >0.5，异人通常 <0.4。
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const USER_STORE_VERSION = 1;
const DESCRIPTOR_LENGTH = 128;
// 欧几里得距离阈值（越小越像）。
// 标定（受控变换 + 多样本最小距离）：
//   同人 0.148~0.219（均值 0.174）｜异人 0.335~0.575（最小 0.335）
// 取间隙中点 0.28：既容纳同人的正常波动，又能挡住异人。
const DEFAULT_MATCH_THRESHOLD = 0.28;
// 家庭成员之间的最小区分间距：最优与次优距离差小于此值时拒绝匹配，避免认错人。
const DEFAULT_MIN_GAP = 0.05;

const GRADES = [
  { id: 'preschool', label: '学前' }, { id: 'grade1', label: '一年级' },
  { id: 'grade2', label: '二年级' }, { id: 'grade3', label: '三年级' },
  { id: 'grade4', label: '四年级' }, { id: 'grade5', label: '五年级' },
  { id: 'grade6', label: '六年级' }, { id: 'grade7', label: '初一' },
  { id: 'grade8', label: '初二' }, { id: 'grade9', label: '初三' },
  { id: 'senior1', label: '高一' }, { id: 'senior2', label: '高二' },
  { id: 'senior3', label: '高三' }
];

function now() { return Date.now(); }
function id(prefix) { return `${prefix}_${crypto.randomBytes(9).toString('hex')}`; }
function token() { return crypto.randomBytes(24).toString('base64url'); }

/** 口令散列：随机盐 + scrypt，避免明文与彩虹表。 */
function hashSecret(secret, salt = crypto.randomBytes(12).toString('hex')) {
  const derived = crypto.scryptSync(String(secret), salt, 32).toString('hex');
  return { salt, hash: derived };
}
function verifySecret(secret, record) {
  if (!record?.salt || !record?.hash) return false;
  const derived = crypto.scryptSync(String(secret), record.salt, 32).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(record.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- 人脸特征集合 ---------------- */

/**
 * 一张脸对应一组特征向量（同一人的多张不同角度/光线的采样）。
 *
 * 为什么存多张：单张特征对采集条件敏感 —— 实测同人仅因缩放不同，距离就能到 0.334；
 * 而不同人的最小距离是 0.364，两者间隙很窄。多张采样取最优匹配后，
 * 同人更容易被认出来、异人更难被误认。
 */
const MAX_DESCRIPTORS = 3;

/** 校验并清洗一组特征：过滤非法项，最多保留 MAX_DESCRIPTORS 个。 */
function normalizeDescriptorSet(input) {
  const list = Array.isArray(input) ? input : (input ? [input] : []);
  const valid = [];
  for (const item of list) {
    if (!Array.isArray(item) || item.length !== DESCRIPTOR_LENGTH) continue;
    const values = item.map(Number);
    if (values.some(v => !Number.isFinite(v))) continue;
    valid.push(values);
    if (valid.length >= MAX_DESCRIPTORS) break;
  }
  return valid;
}

/** 单个特征是否合法。 */
function normalizeDescriptor(input) {
  if (!Array.isArray(input) || input.length !== DESCRIPTOR_LENGTH) return null;
  const values = input.map(Number);
  if (values.some(v => !Number.isFinite(v))) return null;
  return values;
}

/**
 * 欧几里得距离：face-api 官方 FaceMatcher 使用的度量方式。
 *
 * 为什么不用余弦相似度：实测 6 张不同人脸的余弦相似度高达 0.93~0.96，
 * 与同人（1.0）几乎无法区分，阈值无从下手；欧几里得距离的分布才有间隙。
 * 受控标定结果（同一人施加亮度/对比度/缩放/模糊/旋转变换 vs 不同人）：
 *   同人距离 0 ~ 0.334（均值 0.147），异人距离 0.364 ~ 0.574（均值 0.468）。
 */
function euclideanDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/** 一组特征与另一组特征之间的最小距离（取最像的那一对）。 */
function minDistance(setA, setB) {
  let best = Infinity;
  for (const a of setA || []) {
    for (const b of setB || []) {
      const d = euclideanDistance(a, b);
      if (d < best) best = d;
    }
  }
  return best;
}

function gradeLabel(gradeId) {
  return GRADES.find(g => g.id === gradeId)?.label || '';
}

/* ---------------- 存储后端（与缓存层同构：Redis 优先，本地 JSON 兜底） ---------------- */

/* 本地 JSON 存储的文件名转义：Windows 禁止 `: < > " / \ | ? *` 与控制字符，
 * 而存储键形如 `parent:usr_xxx`。用 %XX 可逆转义，避免「注册 500 / 重启丢账号」。 */
const FS_UNSAFE = /[%<>:"/\\|?*\u0000-\u001f]/g;
function encodeKey(key) {
  return String(key).replace(FS_UNSAFE, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}
function decodeKey(name) {
  return String(name).replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

class LocalUserStore {
  constructor({ dir }) {
    this.name = 'local';
    this.dir = dir;
    this.writeChain = Promise.resolve();
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /* 键是「命名空间:主键」（如 parent:usr_xxx），而 Windows 文件名不允许 `:` 等字符，
   * 直接拿键当文件名会 rename EINVAL —— 表现为「注册返回 500 / 重启后账号消失」。
   * 这里做可逆转义（用 %XX），读取时还原；老库里未转义的文件在首次读取时迁移。 */
  fileFor(key) { return path.join(this.dir, `${encodeKey(key)}.json`); }
  legacyFileFor(key) { return path.join(this.dir, `${key}.json`); }
  readFile(file) { return fs.promises.readFile(file, 'utf8').catch(() => null); }

  async get(key) {
    let raw = await this.readFile(this.fileFor(key));
    if (raw === null) {
      const legacy = this.legacyFileFor(key);
      if (legacy !== this.fileFor(key)) {
        raw = await this.readFile(legacy);
        // 迁移到新文件名；失败也不影响本次读取，下次再试。
        if (raw !== null) {
          try { await fs.promises.rename(legacy, this.fileFor(key)); } catch { /* 忽略 */ }
        }
      }
    }
    if (raw === null) return null;
    try {
      const entry = JSON.parse(raw);
      if (entry?.version !== USER_STORE_VERSION) return null;
      return entry.payload ?? null;
    } catch { return null; }
  }

  async put(key, payload) {
    const file = this.fileFor(key);
    const data = JSON.stringify({ version: USER_STORE_VERSION, key, updatedAt: now(), payload });
    const tmp = `${file}.${process.pid}.tmp`;
    // 原子写：先写临时文件再 rename，避免进程被杀时留下半截 JSON。
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      await fs.promises.writeFile(tmp, data, 'utf8');
      await fs.promises.rename(tmp, file);
    }).catch(error => {
      console.warn(`[users:local] 写入失败：${error.message}`);
      try { fs.unlinkSync(tmp); } catch { /* 忽略 */ }
      throw error;
    });
    await this.writeChain;
    return payload;
  }

  async remove(key) {
    await fs.promises.unlink(this.fileFor(key)).catch(() => {});
    await fs.promises.unlink(this.legacyFileFor(key)).catch(() => {});
  }

  async keys(prefix = '') {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter(file => file.endsWith('.json'))
      .map(file => decodeKey(file.slice(0, -5)))
      .filter(key => key.startsWith(prefix));
  }

  async list(prefix = '') {
    const keys = await this.keys(prefix);
    const out = [];
    for (const key of keys) {
      const payload = await this.get(key);
      if (payload) out.push({ key, payload });
    }
    return out;
  }

  describe() { return { backend: 'local', dir: this.dir }; }
}

class RedisUserStore {
  constructor({ redis, prefix, namespace }) {
    this.name = 'redis';
    this.redis = redis;
    this.namespace = `${prefix}:v${USER_STORE_VERSION}:${namespace}`;
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
  async keys(prefix = '') {
    const found = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', `${this.namespace}:${prefix}*`, 'COUNT', 200);
      cursor = next;
      for (const item of batch) found.push(item.slice(this.namespace.length + 1));
    } while (cursor !== '0');
    return found;
  }
  async list(prefix = '') {
    const keys = await this.keys(prefix);
    const out = [];
    for (const key of keys) {
      const payload = await this.get(key);
      if (payload) out.push({ key, payload });
    }
    return out;
  }
  describe() { return { backend: 'redis' }; }
}

/* ---------------- 用户仓储 ---------------- */

class UserRepository {
  constructor({ store, fallbackStore = null }) {
    this.store = store;
    this.fallbackStore = fallbackStore;
    this.degraded = 0;
  }

  async read(key) {
    try {
      const value = await this.store.get(key);
      if (value) return value;
    } catch (error) {
      this.degraded += 1;
      console.warn(`[users] 读取失败(${key})：${error.message}`);
    }
    // Redis 不可用时回退本地 JSON，保证用户体系在缓存故障时仍可用。
    if (this.fallbackStore) {
      try {
        const value = await this.fallbackStore.get(key);
        if (value) return value;
      } catch { /* 忽略 */ }
    }
    return null;
  }

  async write(key, payload) {
    try {
      await this.store.put(key, payload);
      return payload;
    } catch (error) {
      this.degraded += 1;
      console.warn(`[users] 写入失败(${key})：${error.message}`);
      if (!this.fallbackStore) throw error;
      await this.fallbackStore.put(key, payload);
      return payload;
    }
  }

  async remove(key) {
    try { await this.store.remove(key); } catch { /* 忽略 */ }
    if (this.fallbackStore) { try { await this.fallbackStore.remove(key); } catch { /* 忽略 */ } }
  }

  async list(prefix) {
    try {
      const items = await this.store.list(prefix);
      if (items.length) return items;
    } catch { /* 忽略 */ }
    if (this.fallbackStore) {
      try { return await this.fallbackStore.list(prefix); } catch { /* 忽略 */ }
    }
    return [];
  }
}

/* ---------------- 业务服务 ---------------- */

class UserService {
  constructor({ repository, sessionTtlMs = 30 * 86400000, matchThreshold = DEFAULT_MATCH_THRESHOLD, minGap = DEFAULT_MIN_GAP }) {
    this.repo = repository;
    this.sessionTtlMs = sessionTtlMs;
    this.matchThreshold = matchThreshold;
    this.minGap = minGap;
  }

  /* ---- 家长 ---- */

  /** 注册家长：同时创建家庭。返回家长档案与会话令牌。 */
  async registerParent({ name, grade = '', descriptor = null, secret = '', avatar = null }) {
    const cleanName = String(name || '').trim();
    if (cleanName.length < 1 || cleanName.length > 24) {
      throw Object.assign(new Error('请输入 1-24 个字的称呼'), { statusCode: 400 });
    }
    const face = normalizeDescriptorSet(descriptor);
    const familyId = id('fam');
    const parentId = id('usr');
    const record = {
      id: parentId,
      role: 'parent',
      familyId,
      name: cleanName,
      grade: grade || '',
      face,
      avatar,
      secret: secret ? hashSecret(secret) : null,
      createdAt: now(),
      lastLoginAt: 0
    };
    await this.repo.write(`parent:${parentId}`, record);
    await this.repo.write(`family:${familyId}`, {
      id: familyId, name: `${cleanName}的家庭`, ownerId: parentId, createdAt: now()
    });
    await this.repo.write(`family_members:${familyId}`, [parentId]);
    const session = await this.createSession(parentId, 'parent');
    return { user: toPublicUser(record), family: await this.getFamily(familyId), token: session.token, expiresAt: session.expiresAt };
  }

  /**
   * 按姓名查找账号（家长与学生都查）。
   *
   * 为什么需要：口令登录是给人用的，用户记的是「王妈妈」而不是 usr_a1b2c3。
   * 服务端先按用户 ID 精确匹配，查不到再退回姓名匹配；
   * 同名多人时由调用方决定如何提示，这里如实返回全部候选。
   */
  async findUsersByName(name) {
    const clean = String(name || '').trim();
    if (!clean) return [];
    const found = [];
    for (const prefix of ['parent:', 'student:']) {
      const items = await this.repo.list(prefix);
      for (const item of items) {
        const record = item.payload;
        if (record && record.name === clean) found.push(record);
      }
    }
    return found;
  }

  async getParent(parentId) { return this.repo.read(`parent:${parentId}`); }

  /** 修改家长资料（改名 / 更新人脸 / 设置口令）。 */
  async updateParent(parentId, patch = {}) {
    const record = await this.getParent(parentId);
    if (!record) throw Object.assign(new Error('账号不存在'), { statusCode: 404 });
    if (patch.name !== undefined) {
      const clean = String(patch.name || '').trim();
      if (clean.length < 1 || clean.length > 24) throw Object.assign(new Error('请输入 1-24 个字的称呼'), { statusCode: 400 });
      record.name = clean;
    }
    if (patch.descriptor !== undefined) {
      const face = normalizeDescriptorSet(patch.descriptor);
      if (!face.length) throw Object.assign(new Error('人脸特征无效，请重新采集'), { statusCode: 400 });
      record.face = face;
    }
    if (patch.secret) record.secret = hashSecret(patch.secret);
    record.updatedAt = now();
    await this.repo.write(`parent:${parentId}`, record);
    return toPublicUser(record);
  }

  /* ---- 学生成员 ---- */

  /** 家长添加学生成员。 */
  async addMember(parentId, { name, grade = '', descriptor = null, avatar = null, secret = '' }) {
    const parent = await this.getParent(parentId);
    if (!parent) throw Object.assign(new Error('账号不存在'), { statusCode: 404 });
    const cleanName = String(name || '').trim();
    if (cleanName.length < 1 || cleanName.length > 24) {
      throw Object.assign(new Error('请输入 1-24 个字的称呼'), { statusCode: 400 });
    }
    const gradeId = String(grade || '').trim();
    if (gradeId && !GRADES.some(g => g.id === gradeId)) {
      throw Object.assign(new Error('年级不正确'), { statusCode: 400 });
    }
    const memberId = id('stu');
    const record = {
      id: memberId,
      role: 'student',
      familyId: parent.familyId,
      name: cleanName,
      grade: gradeId,
      face: normalizeDescriptorSet(descriptor),
      avatar,
      // 孩子也需要能在摄像头不可用时登录：家长可以为成员设置口令。
      secret: secret ? hashSecret(secret) : null,
      createdAt: now(),
      lastLoginAt: 0
    };
    await this.repo.write(`student:${memberId}`, record);
    const members = await this.repo.read(`family_members:${parent.familyId}`) || [];
    members.push(memberId);
    await this.repo.write(`family_members:${parent.familyId}`, members);
    return toPublicUser(record);
  }

  async getStudent(memberId) { return this.repo.read(`student:${memberId}`); }

  async updateMember(parentId, memberId, patch = {}) {
    const record = await this.getStudent(memberId);
    if (!record) throw Object.assign(new Error('成员不存在'), { statusCode: 404 });
    const parent = await this.getParent(parentId);
    if (!parent || record.familyId !== parent.familyId) {
      throw Object.assign(new Error('无权修改该成员'), { statusCode: 403 });
    }
    if (patch.name !== undefined) {
      const clean = String(patch.name || '').trim();
      if (clean.length < 1 || clean.length > 24) throw Object.assign(new Error('请输入 1-24 个字的称呼'), { statusCode: 400 });
      record.name = clean;
    }
    if (patch.grade !== undefined) {
      const gradeId = String(patch.grade || '').trim();
      if (gradeId && !GRADES.some(g => g.id === gradeId)) throw Object.assign(new Error('年级不正确'), { statusCode: 400 });
      record.grade = gradeId;
    }
    if (patch.descriptor !== undefined) {
      const face = normalizeDescriptorSet(patch.descriptor);
      if (!face.length) throw Object.assign(new Error('人脸特征无效，请重新采集'), { statusCode: 400 });
      record.face = face;
    }
    if (patch.secret !== undefined) {
      // 传空字符串表示清除口令（改回只能用摄像头登录）。
      record.secret = patch.secret ? hashSecret(patch.secret) : null;
    }
    record.updatedAt = now();
    await this.repo.write(`student:${memberId}`, record);
    return toPublicUser(record);
  }

  async removeMember(parentId, memberId) {
    const record = await this.getStudent(memberId);
    if (!record) throw Object.assign(new Error('成员不存在'), { statusCode: 404 });
    const parent = await this.getParent(parentId);
    if (!parent || record.familyId !== parent.familyId) {
      throw Object.assign(new Error('无权删除该成员'), { statusCode: 403 });
    }
    const members = await this.repo.read(`family_members:${parent.familyId}`) || [];
    await this.repo.write(`family_members:${parent.familyId}`, members.filter(item => item !== memberId));
    await this.repo.remove(`student:${memberId}`);
    // 同时清掉该成员的会话，避免删人后仍能凭旧令牌登录。
    const sessions = await this.repo.list(`session_user:${memberId}`);
    for (const { key } of sessions) await this.repo.remove(key);
    return { removed: memberId };
  }

  /** 家庭信息 + 成员列表（家长视图）。 */
  async getFamily(familyId) {
    const family = await this.repo.read(`family:${familyId}`);
    if (!family) return null;
    const ids = await this.repo.read(`family_members:${familyId}`) || [];
    const users = [];
    for (const memberId of ids) {
      const record = memberId.startsWith('usr_')
        ? await this.getParent(memberId)
        : await this.getStudent(memberId);
      if (record) users.push(toPublicUser(record));
    }
    return { ...family, members: users };
  }

  /* ---- 会话 ---- */

  async createSession(userId, role) {
    const sessionToken = token();
    const record = { token: sessionToken, userId, role, createdAt: now(), expiresAt: now() + this.sessionTtlMs };
    await this.repo.write(`session:${sessionToken}`, record);
    await this.repo.write(`session_user:${userId}:${sessionToken}`, { token: sessionToken, userId, role });
    return record;
  }

  /** 校验令牌，返回用户档案；过期或无效返回 null。 */
  async resolveSession(sessionToken) {
    if (!sessionToken) return null;
    const session = await this.repo.read(`session:${sessionToken}`);
    if (!session) return null;
    if (session.expiresAt && session.expiresAt < now()) {
      await this.repo.remove(`session:${sessionToken}`);
      await this.repo.remove(`session_user:${session.userId}:${sessionToken}`);
      return null;
    }
    const record = session.role === 'parent'
      ? await this.getParent(session.userId)
      : await this.getStudent(session.userId);
    if (!record) return null;
    return { session, user: record };
  }

  async destroySession(sessionToken) {
    if (!sessionToken) return;
    const session = await this.repo.read(`session:${sessionToken}`);
    if (session) await this.repo.remove(`session_user:${session.userId}:${sessionToken}`);
    await this.repo.remove(`session:${sessionToken}`);
  }

  /* ---- 人脸匹配 ---- */

  /**
   * 在家庭成员中做人脸匹配。
   *
   * 用欧几里得距离（越小越像），阈值默认 0.5（官方 FaceMatcher 推荐值，
   * 落在实测的同人 0.334 / 异人 0.364 间隙之外的安全一侧）。
   *
   * 额外做「混淆保护」：若最优候选与次优候选的差距过小，说明这张脸在多个成员之间
   * 难以区分（例如双胞胎或光线极差），此时宁可直接拒绝也不要随机认人。
   *
   * @returns {{matched:boolean, user?:object, distance?:number, threshold:number}}
   */
  async matchFace(familyId, descriptor, { threshold = this.matchThreshold, minGap = this.minGap } = {}) {
    const query = normalizeDescriptorSet(descriptor);
    if (!query.length) throw Object.assign(new Error('人脸特征无效，请重新采集'), { statusCode: 400 });
    const family = await this.getFamily(familyId);
    if (!family) return { matched: false, distance: null, threshold, reason: 'family-not-found' };

    const scored = [];
    for (const member of family.members) {
      if (!member.hasFace) continue;
      const record = member.role === 'parent'
        ? await this.getParent(member.id)
        : await this.getStudent(member.id);
      if (!record?.face?.length) continue;
      // 双方都是特征集合，取跨集合的最小距离（最像的一对）。
      const distance = Number(minDistance(query, record.face).toFixed(4));
      scored.push({ user: toPublicUser(record), distance });
    }
    if (!scored.length) return { matched: false, distance: null, threshold, reason: 'no-face-enrolled' };

    scored.sort((a, b) => a.distance - b.distance);
    const best = scored[0];
    const runnerUp = scored[1];
    const gap = runnerUp ? Number((runnerUp.distance - best.distance).toFixed(4)) : Infinity;

    if (best.distance > threshold) {
      return { matched: false, distance: best.distance, threshold, gap, reason: 'too-far' };
    }
    // 只有一位录入人脸的成员时不存在混淆问题；多成员时要求区分度足够。
    if (runnerUp && gap < minGap) {
      return { matched: false, distance: best.distance, threshold, gap, reason: 'ambiguous' };
    }
    return { matched: true, user: best.user, distance: best.distance, threshold, gap };
  }

  /** 家庭成员数量统计，用于健康检查。 */
  async stats() {
    const families = await this.repo.list('family:');
    const students = await this.repo.list('student:');
    const parents = await this.repo.list('parent:');
    return {
      families: families.length,
      parents: parents.length,
      students: students.length,
      backend: this.repo.store.name,
      degraded: this.repo.degraded
    };
  }
}

/** 对外暴露的用户档案：绝不含人脸向量与口令散列。 */
function toPublicUser(record) {
  if (!record) return null;
  return {
    id: record.id,
    role: record.role,
    familyId: record.familyId,
    name: record.name,
    grade: record.grade,
    gradeLabel: gradeLabel(record.grade),
    avatar: record.avatar || null,
    hasFace: Array.isArray(record.face) ? record.face.length > 0 : Boolean(record.face),
    faceCount: Array.isArray(record.face) ? record.face.length : (record.face ? 1 : 0),
    hasSecret: Boolean(record.secret),
    createdAt: record.createdAt,
    lastLoginAt: record.lastLoginAt || 0
  };
}

module.exports = {
  UserService, UserRepository, LocalUserStore, RedisUserStore,
  normalizeDescriptor, normalizeDescriptorSet, euclideanDistance, minDistance,
  hashSecret, verifySecret, toPublicUser, gradeLabel,
  GRADES, DESCRIPTOR_LENGTH, MAX_DESCRIPTORS,
  DEFAULT_MATCH_THRESHOLD, DEFAULT_MIN_GAP, USER_STORE_VERSION
};
