/* 知岛 · 持久化缓存层
 * L1：进程内 LRU Map（同一进程内零延迟命中）
 * L2：可插拔 Store —— LocalJsonStore（本机磁盘）或 RedisStore（本机 / 云端 Redis）
 *
 * 设计要点：
 * - 键 = sha256(归一化内容 + 学科/课程指纹 + 决策模型 + 生成模型 + 提示词版本)，
 *   任一模型或提示词结构变化都会让旧缓存自动失效，不会串用旧答案。
 * - 只缓存成功结果，失败请求不落盘；TTL 与 LRU 双重约束容量。
 * - 同一 key 的并发请求合并为一次上游调用（进程内 singleflight + Redis 分布式锁），
 *   避免多实例重复调用上游扣费。
 * - Redis 不可用时自动降级到本地 JSON，并在统计与健康检查里暴露降级次数。
 * - refresh 可绕过读取但仍回写，用于「重新生成」。
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// 提示词模板、返回结构或校验规则发生变化时 +1，旧缓存会在启动时自动清理。
const CACHE_VERSION = 1;

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

// 全半角统一、忽略所有空白与大小写：让「思念」「 思 念 」「2x+3=11」「２ｘ ＋ ３ ＝ １１」命中同一条缓存。
// 这里是缓存键而非展示文本，去掉空白不会改变知识点本身的含义；响应仍回显用户本次输入的原文。
function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function hash(parts) {
  return crypto.createHash('sha256').update(stableStringify(parts)).digest('hex').slice(0, 40);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* ---------------- Store 接口 ----------------
 * load(): 同步返回启动时可枚举的条目（Redis 不做全量加载，靠 get 懒查）
 * get(key): L1 未命中时回查后端，返回 { payload, createdAt, bytes, file } 或 null
 * persist(key, payload, createdAt, ttlMs): 写入，返回 { bytes, file }
 * touch(key, entry): 更新热度（本地用 mtime，Redis 无需处理）
 * remove(key) / clear(): 删除与清空
 * lock(key, ttlSeconds) / unlock(key, token): 跨实例互斥，不支持时返回 null
 */

class LocalJsonStore {
  constructor({ dir, version, ttlMs }) {
    this.name = 'local';
    this.dir = dir;
    this.version = version;
    this.ttlMs = Number(ttlMs) || 0;
    this.writeChain = Promise.resolve();
    // 降级目标可能从未 load() 过，先确保目录存在，避免首次写入失败。
    fs.mkdirSync(this.dir, { recursive: true });
  }

  fileFor(key) { return path.join(this.dir, `${key}.json`); }
  isExpired(createdAt) { return this.ttlMs > 0 && Date.now() - Number(createdAt) > this.ttlMs; }

  readEntry(key) {
    const file = this.fileFor(key);
    let entry;
    try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
    if (!entry || entry.version !== this.version || entry.key !== key || !('payload' in entry)) {
      fs.promises.unlink(file).catch(() => {});
      return null;
    }
    if (this.isExpired(entry.createdAt)) {
      fs.promises.unlink(file).catch(() => {});
      return null;
    }
    const stat = fs.statSync(file);
    return {
      payload: entry.payload, createdAt: Number(entry.createdAt),
      bytes: stat.size, file, lastHitAt: stat.mtimeMs || Number(entry.createdAt)
    };
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    const entries = [];
    for (const file of fs.readdirSync(this.dir)) {
      // 上次进程被强杀时可能残留半截临时文件，启动即清理。
      if (file.endsWith('.tmp')) { try { fs.unlinkSync(path.join(this.dir, file)); } catch { /* 忽略 */ } continue; }
      if (!file.endsWith('.json')) continue;
      const hit = this.readEntry(file.slice(0, -5));
      if (hit) entries.push({ key: path.basename(hit.file, '.json'), ...hit });
    }
    return entries.sort((a, b) => a.lastHitAt - b.lastHitAt);
  }

  async get(key) { return this.readEntry(key); }

  async persist(key, payload, createdAt, ttlMs) {
    const file = this.fileFor(key);
    const data = JSON.stringify({ version: this.version, key, createdAt, payload });
    const tmp = `${file}.${process.pid}.tmp`;
    // 串行化磁盘写入，先写临时文件再原子重命名，避免读到半截 JSON。
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      await fs.promises.writeFile(tmp, data, 'utf8');
      await fs.promises.rename(tmp, file);
    }).catch(error => {
      console.warn(`[cache:local] 写入失败：${error.message}`);
      try { fs.unlinkSync(tmp); } catch { /* 忽略 */ }
      throw error;
    });
    await this.writeChain;
    return { bytes: Buffer.byteLength(data), file };
  }

  async touch(key, entry) {
    if (!entry?.file) return;
    const now = new Date();
    await fs.promises.utimes(entry.file, now, now);
  }

  async remove(key) { await fs.promises.unlink(this.fileFor(key)).catch(() => {}); }

  async clear() {
    if (!fs.existsSync(this.dir)) return 0;
    let removed = 0;
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith('.json') && !file.endsWith('.tmp')) continue;
      try { fs.unlinkSync(path.join(this.dir, file)); removed += 1; } catch { /* 忽略 */ }
    }
    return removed;
  }

  async lock() { return null; } // 本地磁盘无跨进程锁，靠进程内 singleflight
  async unlock() {}
  describe() { return { backend: 'local', dir: this.dir }; }
}

class RedisStore {
  constructor({ redis, prefix, namespace, version, ttlMs, lockTtlSeconds = 30 }) {
    this.name = 'redis';
    this.redis = redis;
    this.version = version;
    this.ttlMs = Number(ttlMs) || 0;
    this.lockTtlSeconds = lockTtlSeconds;
    this.namespace = `${prefix}:v${version}:${namespace}`;
  }

  keyFor(key) { return `${this.namespace}:${key}`; }
  lockKeyFor(key) { return `${this.namespace}:lock:${key}`; }

  load() { return []; } // 不做全量加载，L1 未命中时按 key 懒查

  async get(key) {
    const raw = await this.redis.get(this.keyFor(key));
    if (!raw) return null;
    let entry;
    try { entry = JSON.parse(raw); } catch { await this.remove(key); return null; }
    if (!entry || entry.version !== this.version || entry.key !== key || !('payload' in entry)) {
      await this.remove(key);
      return null;
    }
    // Redis 自身已按 TTL 淘汰；双保险处理 TTL=0 或时钟漂移下的过期数据。
    if (this.ttlMs > 0 && Date.now() - Number(entry.createdAt) > this.ttlMs) {
      await this.remove(key);
      return null;
    }
    return {
      payload: entry.payload, createdAt: Number(entry.createdAt),
      bytes: Buffer.byteLength(raw), file: null, lastHitAt: Date.now()
    };
  }

  async persist(key, payload, createdAt) {
    const data = JSON.stringify({ version: this.version, key, createdAt, payload });
    const redisKey = this.keyFor(key);
    if (this.ttlMs > 0) await this.redis.set(redisKey, data, 'EX', Math.max(1, Math.ceil(this.ttlMs / 1000)));
    else await this.redis.set(redisKey, data);
    return { bytes: Buffer.byteLength(data), file: null };
  }

  async touch() {} // TTL 由 Redis 原生管理，不因命中而延长

  async remove(key) { await this.redis.del(this.keyFor(key)); }

  async clear() {
    let cursor = '0';
    let removed = 0;
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${this.namespace}:*`, 'COUNT', 200);
      cursor = next;
      for (let i = 0; i < keys.length; i += 100) {
        removed += await this.redis.del(...keys.slice(i, i + 100));
      }
    } while (cursor !== '0');
    return removed;
  }

  async lock(key, ttlSeconds = this.lockTtlSeconds) {
    const token = crypto.randomBytes(12).toString('hex');
    const result = await this.redis.set(this.lockKeyFor(key), token, 'EX', ttlSeconds, 'NX');
    return result === 'OK' ? token : null;
  }

  async unlock(key, token) {
    if (!token) return;
    // Lua 保证只释放自己持有的锁，避免超时后误删别人的锁。
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1, this.lockKeyFor(key), token
    );
  }

  describe() {
    return { backend: 'redis', namespace: this.namespace, ttlDays: this.ttlMs ? +(this.ttlMs / 86400000).toFixed(2) : 0 };
  }
}

class PersistentCache {
  constructor({ name, dir, version = CACHE_VERSION, ttlMs = 0, maxEntries = 300, enabled = true, store = null, fallbackStore = null }) {
    this.name = name;
    this.version = version;
    this.ttlMs = Number(ttlMs) || 0;
    this.maxEntries = Math.max(1, Number(maxEntries) || 300);
    this.enabled = enabled !== false;
    this.mem = new Map();                        // key -> { payload, createdAt, hits, lastHitAt, bytes, file }
    this.inFlight = new Map();                   // key -> Promise（进程内并发去重）
    this.store = store || new LocalJsonStore({ dir, version, ttlMs });
    // Redis 为主时保留一份本地 Store 作为降级目标；本地模式不需要。
    this.fallback = fallbackStore || (this.store.name === 'local' ? null : new LocalJsonStore({ dir, version, ttlMs }));
    this.counters = {
      hits: 0, misses: 0, writes: 0, evictions: 0, expired: 0, loadedFromDisk: 0,
      remoteHits: 0, degraded: 0, lockWaits: 0, storeErrors: 0
    };
    if (this.enabled) {
      for (const entry of this.store.load()) {
        this.mem.set(entry.key, {
          payload: entry.payload, createdAt: entry.createdAt, hits: 0,
          lastHitAt: entry.lastHitAt, bytes: entry.bytes, file: entry.file
        });
      }
      this.counters.loadedFromDisk = this.mem.size;
      this.evict();
    }
  }

  isExpired(createdAt) { return this.ttlMs > 0 && Date.now() - Number(createdAt) > this.ttlMs; }

  /* 主 Store 出错时切到本地 JSON，服务不中断；降级状态在 /api/health 可见。 */
  async withFallback(operation) {
    try { return await operation(this.store); }
    catch (error) {
      this.counters.storeErrors += 1;
      if (!this.fallback || this.store === this.fallback) throw error;
      this.counters.degraded += 1;
      console.warn(`[cache:${this.name}] ${this.store.name} 不可用，已降级到本地 JSON：${error.message}`);
      this.store = this.fallback;
      return operation(this.store);
    }
  }

  safeGet(key) { return this.withFallback(store => store.get(key)); }
  safePersist(key, payload, createdAt) { return this.withFallback(store => store.persist(key, payload, createdAt, this.ttlMs)); }
  safeRemove(key) { return this.withFallback(store => store.remove(key)); }
  safeClear() { return this.withFallback(store => store.clear()); }
  safeLock(key) { return this.withFallback(store => store.lock(key)); }
  safeUnlock(key, token) { return this.withFallback(store => store.unlock(key, token)); }

  get(key) {
    if (!this.enabled) { this.counters.misses += 1; return null; }
    const entry = this.mem.get(key);
    if (!entry) { this.counters.misses += 1; return null; }
    if (this.isExpired(entry.createdAt)) {
      this.remove(key);
      this.counters.expired += 1;
      this.counters.misses += 1;
      return null;
    }
    this.mem.delete(key);
    this.mem.set(key, entry);                    // 提到 LRU 尾部
    entry.hits += 1;
    entry.lastHitAt = Date.now();
    this.counters.hits += 1;
    this.withFallback(store => store.touch(key, entry)).catch(() => {});
    return {
      payload: entry.payload, createdAt: entry.createdAt,
      hits: entry.hits, ageMs: Date.now() - entry.createdAt
    };
  }

  admit(key, remote) {
    this.mem.delete(key);
    this.mem.set(key, {
      payload: remote.payload, createdAt: remote.createdAt, hits: 1,
      lastHitAt: Date.now(), bytes: remote.bytes, file: remote.file || null
    });
    this.evict();
  }

  async set(key, payload) {
    if (!this.enabled) return;
    const createdAt = Date.now();
    const written = await this.safePersist(key, payload, createdAt);
    this.mem.delete(key);
    this.mem.set(key, {
      payload, createdAt, hits: 0, lastHitAt: createdAt,
      bytes: written.bytes, file: written.file || null
    });
    this.counters.writes += 1;
    this.evict();
  }

  remove(key) {
    this.mem.delete(key);
    this.safeRemove(key).catch(() => {});
  }

  evict() {
    while (this.mem.size > this.maxEntries) {
      this.remove(this.mem.keys().next().value);
      this.counters.evictions += 1;
    }
  }

  async clear() {
    const count = this.mem.size;
    this.mem.clear();
    await this.safeClear();
    return count;
  }

  hitResult(payload, createdAt, hits, ageMs, source) {
    return {
      payload,
      cache: {
        hit: true, source, backend: this.store.name,
        createdAt: new Date(createdAt).toISOString(),
        ageSeconds: Math.round(ageMs / 1000), hits
      }
    };
  }

  /** 读取 → 并发合并 → 分布式互斥 → 生成 → 回写，一步完成 */
  async resolve(key, producer, { refresh = false } = {}) {
    if (this.enabled && !refresh) {
      const hit = this.get(key);               // L1：进程内存
      if (hit) return this.hitResult(hit.payload, hit.createdAt, hit.hits, hit.ageMs, 'memory');
      const remote = await this.safeGet(key); // L2：Redis 或本地磁盘
      if (remote) {
        this.admit(key, remote);
        this.counters.remoteHits += 1;
        return this.hitResult(remote.payload, remote.createdAt, 1, Date.now() - remote.createdAt, this.store.name === 'redis' ? 'redis' : 'disk');
      }
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      const payload = await pending;
      return { payload, cache: { hit: true, source: 'in-flight', deduplicated: true } };
    }

    // 同步占位：后续获取分布式锁、等待其它实例都是 await，
    // 若先 await 再注册，并发请求会穿过 in-flight 检查而重复调用上游。
    let settle;
    const placeholder = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    placeholder.catch(() => {});                 // 没有等待者时避免 unhandled rejection
    this.inFlight.set(key, placeholder);

    let lock = null;
    let payload;
    let result;
    try {
      // 跨实例互斥：拿不到锁说明别的实例正在生成，先等它写完再读缓存。
      lock = this.enabled ? await this.safeLock(key) : null;
      if (!lock && this.enabled && this.store.name === 'redis') {
        for (let attempt = 0; attempt < 20; attempt++) {
          await sleep(200);
          const local = this.get(key);
          if (local) {
            this.counters.lockWaits += 1;
            payload = local.payload;
            result = this.hitResult(local.payload, local.createdAt, local.hits, local.ageMs, 'lock-wait');
            break;
          }
          const remote = await this.safeGet(key);
          if (remote) {
            this.admit(key, remote);
            this.counters.lockWaits += 1;
            payload = remote.payload;
            result = this.hitResult(remote.payload, remote.createdAt, 1, Date.now() - remote.createdAt, 'lock-wait');
            break;
          }
        }
      }
      if (payload === undefined) {
        payload = await Promise.resolve().then(producer);
        if (this.enabled) await this.set(key, payload);
        result = {
          payload,
          cache: {
            hit: false, source: refresh ? 'refreshed' : 'generated',
            persisted: this.enabled, backend: this.store.name
          }
        };
      }
      settle.resolve(payload);
      return result;
    } catch (error) {
      settle.reject(error);
      throw error;
    } finally {
      this.inFlight.delete(key);
      await this.safeUnlock(key, lock).catch(() => {});
    }
  }

  stats() {
    let bytes = 0, oldest = null, newest = null, totalHits = 0;
    for (const entry of this.mem.values()) {
      totalHits += entry.hits;
      bytes += entry.bytes || 0;
      if (oldest === null || entry.createdAt < oldest) oldest = entry.createdAt;
      if (newest === null || entry.createdAt > newest) newest = entry.createdAt;
    }
    const requests = this.counters.hits + this.counters.misses;
    return {
      name: this.name,
      ...this.store.describe(),
      fallback: this.fallback ? this.fallback.describe() : null,
      enabled: this.enabled,
      version: this.version,
      entries: this.mem.size,
      maxEntries: this.maxEntries,
      ttlDays: this.ttlMs ? +(this.ttlMs / 86400000).toFixed(2) : 0,
      bytes,
      hits: this.counters.hits,
      misses: this.counters.misses,
      hitRate: requests ? +(this.counters.hits / requests * 100).toFixed(1) : 0,
      writes: this.counters.writes,
      evictions: this.counters.evictions,
      expired: this.counters.expired,
      loadedFromDisk: this.counters.loadedFromDisk,
      remoteHits: this.counters.remoteHits,
      degraded: this.counters.degraded,
      storeErrors: this.counters.storeErrors,
      lockWaits: this.counters.lockWaits,
      inFlight: this.inFlight.size,
      totalHits,
      oldestAt: oldest === null ? null : new Date(oldest).toISOString(),
      newestAt: newest === null ? null : new Date(newest).toISOString()
    };
  }
}

module.exports = { PersistentCache, LocalJsonStore, RedisStore, CACHE_VERSION, normalizeText, hash, stableStringify };
