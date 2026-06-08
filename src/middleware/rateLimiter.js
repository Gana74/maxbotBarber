// Rate Limiting Middleware для MAX Bot API
// Оптимизация памяти: TTL cleanup, LRU eviction, ограничение размера Map

const MAX_MAP_SIZE = 5000;
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 минут
const INACTIVE_THRESHOLD = 10 * 60 * 1000; // 10 минут

// Map для хранения запросов пользователей
const userRequests = new Map();
let cleanupTimer = null;

// Лимиты по умолчанию (запросов в минуту)
const DEFAULT_LIMITS = {
  general: 30,
  admin: 10,
};

/**
 * ID пользователя из контекста MAX.
 * @param {object} ctx
 * @returns {string|number|null}
 */
function getUserIdFromCtx(ctx) {
  const id = ctx?.user?.user_id;
  return id != null ? id : null;
}

/**
 * Текст сообщения из контекста MAX.
 * @param {object} ctx
 * @returns {string}
 */
function getMessageText(ctx) {
  return ctx.message?.body?.text?.trim() ?? "";
}

/**
 * Payload callback-кнопки из контекста MAX.
 * @param {object} ctx
 * @returns {string}
 */
function getCallbackPayload(ctx) {
  return ctx.update?.callback?.payload ?? "";
}

/**
 * Админский контекст: команда /admin, другие admin-команды или admin-callback.
 * @param {object} ctx
 * @returns {boolean}
 */
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

/**
 * Очистка неактивных пользователей и старых записей
 */
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
 * Проверка rate limit для пользователя
 * @param {string|number} userId - ID пользователя
 * @param {string} type - Тип запроса: 'general' | 'admin'
 * @param {number} [limit] - Лимит запросов в минуту (опционально)
 * @returns {boolean} - true если лимит не превышен
 */
function checkRateLimit(userId, type = "general", limit = null) {
  const userIdStr = String(userId);
  const now = Date.now();
  const windowMs = 60 * 1000;
  const actualLimit = limit || DEFAULT_LIMITS[type] || DEFAULT_LIMITS.general;

  let entry = userRequests.get(userIdStr);
  if (!entry) {
    entry = {
      requests: [],
      lastAccess: now,
    };
    userRequests.set(userIdStr, entry);
  }

  entry.lastAccess = now;

  entry.requests = entry.requests.filter(
    (timestamp) => now - timestamp < windowMs,
  );

  if (entry.requests.length >= actualLimit) {
    return false;
  }

  entry.requests.push(now);

  if (userRequests.size >= MAX_MAP_SIZE) {
    cleanup();
  }

  return true;
}

/**
 * Определяет тип лимита: admin (10/мин) или general (30/мин).
 * @param {object} ctx
 * @returns {'general' | 'admin'}
 */
function resolveLimitType(ctx) {
  if (isAdminContext(ctx)) {
    return "admin";
  }
  return "general";
}

/**
 * @param {object} [options]
 * @param {number} [options.generalLimit] - Лимит для общих запросов (по умолчанию 30/мин)
 * @param {number} [options.adminLimit] - Лимит для админ-команд (по умолчанию 10/мин)
 * @returns {(ctx: object, next: Function) => Promise<void>}
 */
function createRateLimiter(options = {}) {
  const limits = {
    general: options.generalLimit ?? DEFAULT_LIMITS.general,
    admin: options.adminLimit ?? DEFAULT_LIMITS.admin,
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
      try {
        if (typeof ctx.reply === "function") {
          await ctx.reply(
            "Слишком много запросов. Пожалуйста, подождите немного.",
          );
        }
      } catch {
        // Игнорируем ошибки отправки сообщения
      }
      return;
    }

    return next();
  };
}

/** Готовый middleware для bot.use(rateLimiter) */
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
};
