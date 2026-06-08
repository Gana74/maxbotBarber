// Структурированное логирование с асинхронной буферизацией для оптимизации I/O

const fs = require("fs").promises;
const path = require("path");

const LOG_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.resolve(LOG_DIR, "security.log");
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024;

let logBuffer = [];
let bufferFlushTimer = null;
const BUFFER_FLUSH_INTERVAL = 2000;
const BUFFER_MAX_SIZE = 50;

/** @type {((userId: string|number, message: string) => Promise<void>)|null} */
let criticalAlertHandler = null;

/**
 * Регистрирует обработчик CRITICAL-уведомлений (например, sendMessageToUser админу).
 * @param {(userId: string|number, message: string) => Promise<void>} handler
 */
function setCriticalAlertHandler(handler) {
  criticalAlertHandler = handler;
}

async function ensureLogDir() {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch (e) {
    // ignore
  }
}

function formatLogEntry(level, userId, action, details, result) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    userId: userId || "unknown",
    action: action || "unknown",
    details: details || {},
    result: result || "unknown",
  };
  return JSON.stringify(entry) + "\n";
}

/**
 * Маскирует телефоны (+712367) и имена (И** П***).
 * @param {any} data
 * @returns {any}
 */
function maskSensitiveData(data) {
  if (data == null) return data;

  if (typeof data === "string") {
    let masked = data;
    masked = masked.replace(
      /(\+?\d{1,3})\d{4,}(\d{2,3})/g,
      "$1****$2",
    );
    masked = masked.replace(
      /([\p{L}])[\p{L}]+/gu,
      (match, first) => `${first}**`,
    );
    return masked;
  }

  if (Array.isArray(data)) {
    return data.map((item) => maskSensitiveData(item));
  }

  if (typeof data === "object") {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("phone") ||
        lowerKey.includes("tel") ||
        lowerKey.includes("name") ||
        lowerKey.includes("username")
      ) {
        result[key] = maskSensitiveData(value);
      } else {
        result[key] = maskSensitiveData(value);
      }
    }
    return result;
  }

  return data;
}

async function rotateLogIfNeeded() {
  try {
    const stats = await fs.stat(LOG_FILE).catch(() => null);
    if (stats && stats.size > MAX_LOG_FILE_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const rotatedFile = path.resolve(LOG_DIR, `security.${timestamp}.log`);
      await fs.rename(LOG_FILE, rotatedFile);

      const files = await fs.readdir(LOG_DIR).catch(() => []);
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (
          file.startsWith("security.") &&
          file.endsWith(".log") &&
          file !== "security.log"
        ) {
          const filePath = path.resolve(LOG_DIR, file);
          const fileStats = await fs.stat(filePath).catch(() => null);
          if (fileStats && fileStats.mtimeMs < thirtyDaysAgo) {
            await fs.unlink(filePath).catch(() => {});
          }
        }
      }
    }
  } catch (e) {
    // ignore
  }
}

async function writeLogSync(level, userId, action, details, result) {
  try {
    await ensureLogDir();
    await rotateLogIfNeeded();

    const entry = formatLogEntry(level, userId, action, details, result);
    await fs.appendFile(LOG_FILE, entry, "utf8");
  } catch (e) {
    console.error("Failed to write log:", e.message);
  }
}

function addToBuffer(level, userId, action, details, result) {
  logBuffer.push({ level, userId, action, details, result });

  if (logBuffer.length >= BUFFER_MAX_SIZE) {
    flushBuffer();
  } else if (!bufferFlushTimer) {
    bufferFlushTimer = setTimeout(flushBuffer, BUFFER_FLUSH_INTERVAL);
  }
}

async function flushBuffer() {
  if (bufferFlushTimer) {
    clearTimeout(bufferFlushTimer);
    bufferFlushTimer = null;
  }

  if (logBuffer.length === 0) {
    return;
  }

  const entries = [...logBuffer];
  logBuffer = [];

  try {
    await ensureLogDir();
    await rotateLogIfNeeded();

    const lines = entries.map((entry) =>
      formatLogEntry(
        entry.level,
        entry.userId,
        entry.action,
        entry.details,
        entry.result,
      ),
    );

    await fs.appendFile(LOG_FILE, lines.join(""), "utf8");
  } catch (e) {
    console.error("Failed to flush log buffer:", e.message);
  }
}

/**
 * Логирует событие безопасности в logs/security.log.
 * @param {string|number} userId
 * @param {string} eventType — rate_limit_exceeded | formula_injection_attempt | invalid_callback | session_hijack_attempt | global_booking_limit_exceeded
 * @param {object} [details]
 * @param {'INFO'|'WARNING'|'CRITICAL'} [severity='WARNING']
 */
async function logSecurityEvent(userId, eventType, details = {}, severity = "WARNING") {
  const maskedDetails = maskSensitiveData(details);
  await writeLogSync(severity, userId, eventType, maskedDetails, "security_event");

  if (severity === "CRITICAL" && criticalAlertHandler) {
    try {
      await criticalAlertHandler(userId, `🚨 ${eventType}`);
    } catch (e) {
      console.error("[logger] Critical alert failed:", e.message);
    }
  }
}

async function logCriticalAction(userId, action, details, result) {
  await writeLogSync("CRITICAL", userId, action, maskSensitiveData(details), result);
}

function logAdminAction(userId, action, details, result) {
  // disabled for optimization
}

async function logError(userId, action, error, details = {}) {
  const errorDetails = maskSensitiveData({
    ...details,
    error: error.message || String(error),
    stack:
      process.env.NODE_ENV === "development" ? error.stack : undefined,
  });
  await writeLogSync("ERROR", userId, action, errorDetails, "failed");
}

function logAction(userId, action, details, result) {
  // disabled for optimization
}

process.on("SIGINT", async () => {
  await flushBuffer();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await flushBuffer();
  process.exit(0);
});

module.exports = {
  logSecurityEvent,
  logCriticalAction,
  logAdminAction,
  logError,
  logAction,
  maskSensitiveData,
  setCriticalAlertHandler,
  flushBuffer,
};
