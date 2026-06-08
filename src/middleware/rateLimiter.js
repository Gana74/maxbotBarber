// Rate Limiting Middleware для MAX Bot API

const { isBookingStepActive } = require("../maxBot/constants");
const { logSecurityEvent } = require("../utils/logger");

const MAX_MAP_SIZE = 5000;
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const INACTIVE_THRESHOLD = 10 * 60 * 1000;

const userRequests = new Map();
let cleanupTimer = null;

const DEFAULT_LIMITS = {
  general: 30,
  admin: 10,
  scene: 15,
};

const BUCKET_TYPES = ["general", "admin", "scene"];

function createEmptyBuckets() {
  return { general: [], admin: [], scene: [] };
}

function getUserIdFromCtx(ctx) {
  const id = ctx?.user?.user_id;
  return id != null ? id : null;
}

function getMessageText(ctx) {
  return ctx.message?.body?.text?.trim() ?? "";
}

function getCallbackPayload(ctx) {
  return ctx.update?.callback?.payload ?? "";
}

function isAdminContext(ctx) {
  const text = getMessageText(ctx);
  if (text === "/admin" || text.startsWith("/admin_")) {
    return true;
  }

  const payload = getCallbackPayload(ctx);
  if (/^(admin:|revenue:|service_(edit|field|delete):)/.test(payload)) {
    return true;
  }

  return false;
}

function cleanup() {
  const now = Date.now();
  const toDelete = [];

  for (const [userId, entry] of userRequests.entries()) {
    if (now - entry.lastAccess > INACTIVE_THRESHOLD) {
      toDelete.push(userId);
    }
  }

  for (const userId of toDelete) {
    userRequests.delete(userId);
  }

  if (userRequests.size > MAX_MAP_SIZE) {
    const entries = Array.from(userRequests.entries())
      .map(([userId, entry]) => ({ userId, lastAccess: entry.lastAccess }))
      .sort((a, b) => a.lastAccess - b.lastAccess);

    const toRemove = entries.slice(0, userRequests.size - MAX_MAP_SIZE);
    for (const entry of toRemove) {
      userRequests.delete(entry.userId);
    }
  }
}

function startCleanupTimer() {
  if (cleanupTimer) {
    return;
  }
  cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL);
}

function stopCleanupTimer() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * @param {string|number} userId
 * @param {'general'|'admin'|'scene'} type
 * @param {number|null} [limit]
 * @returns {boolean}
 */
function checkRateLimit(userId, type = "general", limit = null) {
  const userIdStr = String(userId);
  const now = Date.now();
  const windowMs = 60 * 1000;
  const actualLimit = limit || DEFAULT_LIMITS[type] || DEFAULT_LIMITS.general;

  let entry = userRequests.get(userIdStr);
  if (!entry) {
    entry = {
      buckets: createEmptyBuckets(),
      lastAccess: now,
    };
    userRequests.set(userIdStr, entry);
  }

  if (!entry.buckets) {
    entry.buckets = createEmptyBuckets();
  }

  entry.lastAccess = now;

  const bucket = entry.buckets[type] || (entry.buckets[type] = []);
  entry.buckets[type] = bucket.filter(
    (timestamp) => now - timestamp < windowMs,
  );

  if (entry.buckets[type].length >= actualLimit) {
    return false;
  }

  entry.buckets[type].push(now);

  if (userRequests.size >= MAX_MAP_SIZE) {
    cleanup();
  }

  return true;
}

/**
 * @param {object} ctx
 * @returns {'general' | 'admin' | 'scene'}
 */
function resolveLimitType(ctx) {
  if (isAdminContext(ctx)) {
    return "admin";
  }
  if (
    ctx.session?.flow === "booking" &&
    isBookingStepActive(ctx.session)
  ) {
    return "scene";
  }
  return "general";
}

function createRateLimiter(options = {}) {
  const limits = {
    general: options.generalLimit ?? DEFAULT_LIMITS.general,
    admin: options.adminLimit ?? DEFAULT_LIMITS.admin,
    scene: options.sceneLimit ?? DEFAULT_LIMITS.scene,
  };

  startCleanupTimer();

  return async (ctx, next) => {
    const userId = getUserIdFromCtx(ctx);
    if (userId == null) {
      return next();
    }

    const type = resolveLimitType(ctx);
    const allowed = checkRateLimit(userId, type, limits[type]);

    if (!allowed) {
      await logSecurityEvent(
        userId,
        "rate_limit_exceeded",
        { limitType: type, limit: limits[type] },
        "WARNING",
      );

      try {
        if (typeof ctx.reply === "function") {
          await ctx.reply(
            "Слишком много запросов. Пожалуйста, подождите немного.",
          );
        }
      } catch {
        // ignore
      }
      return;
    }

    return next();
  };
}

const rateLimiter = createRateLimiter();

process.on("SIGINT", () => {
  stopCleanupTimer();
  userRequests.clear();
});

process.on("SIGTERM", () => {
  stopCleanupTimer();
  userRequests.clear();
});

module.exports = {
  rateLimiter,
  createRateLimiter,
  checkRateLimit,
  cleanup,
  getUserIdFromCtx,
  isAdminContext,
  DEFAULT_LIMITS,
  BUCKET_TYPES,
};
