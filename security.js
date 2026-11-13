/* 公网多用户部署的安全边界：CORS 白名单、管理操作鉴权、按 IP 限流。
 * 本机绑定（HOST=127.0.0.1）时保持开发态宽松；一旦监听 0.0.0.0 则必须显式配置。 */
'use strict';

const crypto = require('node:crypto');

function normalizeIp(req) {
  return String(req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}
function isLoopback(req) {
  const ip = normalizeIp(req);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}


function isLocalDevOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    const parts = host.split('.').map(Number);
    if (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
      if (parts[0] === 10) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function createSecurity({ config, redis }) {
  const isLocalBind = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  const origins = config.corsOrigins
    ? new Set(config.corsOrigins.split(',').map(item => item.trim()).filter(Boolean))
    : null;
  // 限流计数键前缀：多环境（开发/测试/生产）或多实例共用同一 Redis 时，
  // 用不同前缀可避免互相挤占额度。
  const ratePrefix = String(config.redisPrefix || 'zhidao') + ':rl:v1';

  function corsHeaders(req) {
    const common = {
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      // Authorization 承载会话令牌（人脸登录后的接口调用需要）。
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, X-Session-Token',
      'Access-Control-Expose-Headers': 'X-Zhidao-Cache',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin'
    };
    const origin = req.headers.origin;
    if (!origin) return common;                       // 同源请求不需要 ACAO
    if (origins) {
      // 不在白名单就不返回 ACAO，浏览器会拒绝跨源响应。
      return origins.has(origin) ? { ...common, 'Access-Control-Allow-Origin': origin } : common;
    }
    // 未配置白名单：本机绑定允许任意来源；监听 0.0.0.0 时仍允许本机与局域网来源，
    // 以便预览面板、其它本地端口的页面能连上 3100，同时不对公网任意站点开放。
    if (isLocalBind) return { ...common, 'Access-Control-Allow-Origin': '*' };
    if (isLocalDevOrigin(origin)) return { ...common, 'Access-Control-Allow-Origin': origin };
    return common;
  }

  function adminAllowed(req) {
    if (config.adminToken) {
      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const provided = req.headers['x-admin-token'] || bearer;
      return provided === config.adminToken;
    }
    // 没有管理令牌时，只允许本机清空缓存，避免公网任何人可调用 DELETE。
    return isLoopback(req);
  }

  const memoryBuckets = new Map();
  function pruneBuckets(now) {
    if (memoryBuckets.size < 2000) return;
    for (const [key, bucket] of memoryBuckets) if (bucket.resetAt <= now) memoryBuckets.delete(key);
  }

  /**
   * 进程启动时清理当前分钟窗口的限流计数。
   *
   * 为什么需要：限流计数存在 Redis 里，服务重启后计数仍在，
   * 用户会在重启后立刻撞上 429（体验上像是"服务坏了"）。
   * 这里在启动瞬间清一次当前窗口的计数，让重启后的用户立刻可用。
   *
   * 注意只清当前分钟窗口，不影响其他窗口的计数语义；
   * 多实例部署时每个实例启动各清一次，代价是重启窗口内的额度会被重置，
   * 这是可接受的权衡（换来的是重启不锁用户）。
   */
  async function resetRateLimitWindow() {
    if (!redis || redis.status !== 'ready') {
      memoryBuckets.clear();
      return { cleared: 0, backend: 'memory' };
    }
    const window = Math.floor(Date.now() / 60000);
    let cleared = 0;
    try {
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', `${ratePrefix}:${window}:*`, 'COUNT', 200);
        cursor = next;
        if (batch.length) {
          await redis.del(...batch);
          cleared += batch.length;
        }
      } while (cursor !== '0');
    } catch (error) {
      console.warn(`[security] 清理限流计数失败：${error.message}`);
    }
    memoryBuckets.clear();
    return { cleared, backend: 'redis' };
  }

  async function rateLimit(req, route) {
    const limit = config.rateLimitPerMin;
    if (!limit) return { allowed: true };
    const ip = normalizeIp(req);
    const window = Math.floor(Date.now() / 60000);
    const key = `${ratePrefix}:${window}:${ip}:${route}`;
    const resetAt = (window + 1) * 60000;
    let count = null;

    // Redis 可用时用全局计数，多实例共享同一限额；不可用时回退进程内固定窗口。
    if (redis && redis.status === 'ready') {
      try {
        count = await redis.incr(key);
        if (count === 1) await redis.expire(key, 65);
      } catch { count = null; }
    }
    if (count === null) {
      const now = Date.now();
      pruneBuckets(now);
      const bucket = memoryBuckets.get(key) || { count: 0, resetAt };
      bucket.count += 1;
      memoryBuckets.set(key, bucket);
      count = bucket.count;
    }
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfter: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
    };
  }

  return { corsHeaders, adminAllowed, rateLimit, resetRateLimitWindow, isLocalBind, isLoopback, origins: origins ? [...origins] : null };
}

module.exports = { createSecurity, isLoopback };
