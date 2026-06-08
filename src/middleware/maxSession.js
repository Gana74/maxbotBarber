/**
 * Файловые сессии для MAX Bot (аналог telegraf-session-local).
 * Формат sessions.json: { sessions: [{ id, data }] }, id = userId (строка).
 */

const fs = require("fs");
const path = require("path");
const { validateDataSize } = require("../utils/security");
const { persistChatId, readChatIdFromUpdate } = require("../utils/maxChat");

const DEFAULT_DATABASE = path.resolve(process.cwd(), "sessions.json");

/**
 * Один ключ на пользователя: в DM у message_created часто нет chat_id,
 * а старый ключ userId:userId не совпадал с userId:realChatId после bot_started.
 */
function getSessionKey(ctx) {
  const userId = ctx.user?.user_id;
  if (userId == null) {
    return null;
  }
  return String(userId);
}

/**
 * Подхватывает данные из сессий формата userId:chatId (до миграции на ключ userId).
 * @param {{ sessions: Array<{ id: string, data?: object }> }} store
 * @param {number|string} userId
 * @returns {{ id: string, data?: object }|null}
 */
function findLegacyUserSession(store, userId) {
  const prefix = `${userId}:`;
  const legacy = store.sessions.filter((s) => s?.id?.startsWith(prefix));
  if (!legacy.length) {
    return null;
  }

  legacy.sort((a, b) => {
    const aTime = a.data?.lastActivity ?? 0;
    const bTime = b.data?.lastActivity ?? 0;
    return bTime - aTime;
  });

  return legacy[0];
}

/**
 * Удаляет устаревшие записи userId:* после переноса на ключ userId.
 * @param {{ sessions: Array<{ id: string }> }} store
 * @param {number|string} userId
 */
function removeLegacyUserSessions(store, userId) {
  const prefix = `${userId}:`;
  store.sessions = store.sessions.filter((s) => !s?.id?.startsWith(prefix));
}

function loadStore(database) {
  try {
    if (!fs.existsSync(database)) {
      return { sessions: [] };
    }
    const raw = fs.readFileSync(database, { encoding: "utf8" });
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || !Array.isArray(parsed.sessions)) {
      return { sessions: [] };
    }
    return parsed;
  } catch (e) {
    console.warn("[maxSession] Failed to load sessions:", e.message);
    return { sessions: [] };
  }
}

function saveStore(database, store) {
  try {
    fs.writeFileSync(database, JSON.stringify(store, null, 2), {
      encoding: "utf8",
    });
  } catch (e) {
    console.warn("[maxSession] Failed to save sessions:", e.message);
  }
}

/**
 * Удаляет сессии без активности дольше inactiveDays и ограничивает общее число записей.
 */
function cleanupSessionsFile({
  database = DEFAULT_DATABASE,
  maxSessions = 150,
  inactiveDays = 30,
} = {}) {
  try {
    if (!fs.existsSync(database)) {
      return;
    }

    const store = loadStore(database);
    const now = Date.now();
    const inactiveMs = inactiveDays * 24 * 60 * 60 * 1000;
    const cutoff = now - inactiveMs;

    let filtered = store.sessions.filter((s) => {
      if (!s || !s.id) return false;
      const data = s.data || {};
      const lastActivity =
        data.lastActivity || s.lastActivity || s.updatedAt || s.createdAt || now;
      return lastActivity > cutoff;
    });

    filtered.sort((a, b) => {
      const aTime =
        (a.data && a.data.lastActivity) ||
        a.lastActivity ||
        a.updatedAt ||
        a.createdAt ||
        0;
      const bTime =
        (b.data && b.data.lastActivity) ||
        b.lastActivity ||
        b.updatedAt ||
        b.createdAt ||
        0;
      return bTime - aTime;
    });

    if (filtered.length > maxSessions) {
      filtered = filtered.slice(0, maxSessions);
    }

    if (filtered.length !== store.sessions.length) {
      saveStore(database, { sessions: filtered });
      console.log(
        `[maxSession] Cleanup: kept ${filtered.length} session(s)`,
      );
    }
  } catch (err) {
    console.warn("[maxSession] Cleanup error:", err.message);
  }
}

/**
 * Удаляет устаревшие поля Telegraf-сцен при старте (миграция с Telegram).
 */
function sanitizeStaleScenes(database = DEFAULT_DATABASE) {
  try {
    if (!fs.existsSync(database)) return;

    const store = loadStore(database);
    let changed = false;

    store.sessions = store.sessions.map((s) => {
      if (s?.data?.__scenes) {
        const dataCopy = { ...s.data };
        delete dataCopy.__scenes;
        changed = true;
        return { ...s, data: dataCopy };
      }
      return s;
    });

    if (changed) {
      saveStore(database, store);
      console.log("[maxSession] Removed stale __scenes from sessions.json");
    }
  } catch (err) {
    console.warn("[maxSession] sanitizeStaleScenes:", err.message);
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.database] — путь к sessions.json
 * @param {number} [options.inactiveDays] — удалять сессии старше N дней (по lastActivity)
 * @param {number} [options.maxSessions] — максимум записей в файле
 * @returns {(ctx: object, next: Function) => Promise<void>}
 */
function maxSession(options = {}) {
  const database = options.database || DEFAULT_DATABASE;
  const inactiveDays = options.inactiveDays ?? 30;
  const maxSessions = options.maxSessions ?? 150;

  let initialized = false;

  return async function maxSessionMiddleware(ctx, next) {
    if (!initialized) {
      initialized = true;
      sanitizeStaleScenes(database);
      cleanupSessionsFile({ database, maxSessions, inactiveDays });
    }

    const key = getSessionKey(ctx);
    if (!key) {
      ctx.session = {};
      return next();
    }

    const store = loadStore(database);
    let entry = store.sessions.find((s) => s.id === key);
    if (!entry) {
      const userId = ctx.user?.user_id;
      if (userId != null) {
        entry = findLegacyUserSession(store, userId);
      }
    }

    ctx.session = entry?.data ? { ...entry.data } : {};

    const chatFromUpdate = readChatIdFromUpdate(ctx.update);
    if (chatFromUpdate != null) {
      ctx.session.maxChatId = chatFromUpdate;
    }

    persistChatId(ctx);

    await next();

    ctx.session = ctx.session || {};
    ctx.session.lastActivity = Date.now();

    if (!validateDataSize(ctx.session, 10)) {
      console.warn(
        `[maxSession] Session too large for ${key}, resetting`,
      );
      ctx.session = { lastActivity: Date.now() };
    }

    const storeAfter = loadStore(database);
    const userId = ctx.user?.user_id;
    if (userId != null) {
      removeLegacyUserSessions(storeAfter, userId);
    }

    const idx = storeAfter.sessions.findIndex((s) => s.id === key);
    const record = { id: key, data: { ...ctx.session } };

    if (idx >= 0) {
      storeAfter.sessions[idx] = record;
    } else {
      storeAfter.sessions.push(record);
    }

    saveStore(database, storeAfter);
  };
}

module.exports = {
  maxSession,
  cleanupSessionsFile,
  getSessionKey,
  DEFAULT_DATABASE,
};
