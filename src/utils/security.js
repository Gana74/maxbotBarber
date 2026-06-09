// Утилиты безопасности: валидация и санитизация входных данных
// Включает LRU кэш для оптимизации производительности

const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");

dayjs.extend(customParseFormat);

/** Максимальный возраст callback (10 минут). */
const CALLBACK_MAX_AGE_MS = 10 * 60 * 1000;

/** Максимальный размер изображения для портфолио/рассылок (10 МБ). */
const MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// Простая реализация LRU кэша для кэширования результатов валидации
class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }
}

const validationCache = new LRUCache(100);

/**
 * Валидация MAX user ID.
 * @param {string|number} id
 * @returns {boolean}
 */
function validateMaxUserId(id) {
  if (id === null || id === undefined) return false;

  const cacheKey = `maxUserId:${id}`;
  const cached = validationCache.get(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const idStr = String(id).trim();
  const isValid = /^\d{1,15}$/.test(idStr);

  validationCache.set(cacheKey, isValid);
  return isValid;
}

/**
 * Валидация телефонного номера.
 * @param {string} phone
 * @returns {boolean}
 */
function validatePhone(phone) {
  if (!phone || typeof phone !== "string") return false;

  const cacheKey = `phone:${phone}`;
  const cached = validationCache.get(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const phoneStr = phone.trim();
  const isValid = /^\+?\d{10,15}$/.test(phoneStr);

  validationCache.set(cacheKey, isValid);
  return isValid;
}

/**
 * Валидация имени.
 * @param {string} name
 * @param {number} [minLength=1]
 * @param {number} [maxLength=50]
 * @returns {boolean}
 */
function validateName(name, minLength = 1, maxLength = 50) {
  if (!name || typeof name !== "string") return false;

  const trimmed = name.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    return false;
  }

  const cacheKey = `name:${trimmed}:${minLength}:${maxLength}`;
  const cached = validationCache.get(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const isValid = /^[\p{L}\s\-']+$/u.test(trimmed);

  validationCache.set(cacheKey, isValid);
  return isValid;
}

/**
 * Санитизация текста для защиты от XSS.
 * @param {string} text
 * @param {number} [maxLength=500]
 * @returns {string}
 */
function sanitizeText(text, maxLength = 500) {
  if (!text || typeof text !== "string") return "";

  let sanitized = text.trim().replace(/\x00/g, "");
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  sanitized = sanitized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");

  return sanitized;
}

/**
 * Безопасное отображение имени: валидация + минимальное экранирование.
 * @param {string} name
 * @param {number} [maxLength=50]
 * @returns {string}
 */
function sanitizeDisplayName(name, maxLength = 50) {
  if (!name || typeof name !== "string") return "";
  const trimmed = name.trim().substring(0, maxLength);
  if (!validateName(trimmed, 1, maxLength)) {
    return "Пользователь";
  }
  return trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Валидация ID записи.
 * @param {string} id
 * @returns {boolean}
 */
function validateAppointmentId(id) {
  if (!id || typeof id !== "string") return false;

  const cacheKey = `appid:${id}`;
  const cached = validationCache.get(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const idStr = id.trim();
  const isValid = /^[A-Za-z0-9_]{1,50}$/.test(idStr);

  validationCache.set(cacheKey, isValid);
  return isValid;
}

/**
 * Валидация ключа услуги.
 * @param {string} key
 * @returns {boolean}
 */
function validateServiceKey(key) {
  if (!key || typeof key !== "string") return false;
  return /^[A-Za-z0-9_]{1,50}$/.test(key.trim());
}

/**
 * Валидация времени HH:MM.
 * @param {string} time
 * @returns {boolean}
 */
function validateTimeStr(time) {
  if (!time || typeof time !== "string") return false;
  const trimmed = time.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return false;
  const [h, m] = trimmed.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * Валидация даты YYYY-MM-DD или DD.MM.YYYY.
 * @param {string} date
 * @returns {boolean}
 */
function validateDateStr(date) {
  if (!date || typeof date !== "string") return false;
  const trimmed = date.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return dayjs(trimmed, "YYYY-MM-DD", true).isValid();
  }
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)) {
    return dayjs(trimmed, "DD.MM.YYYY", true).isValid();
  }
  return false;
}

/**
 * Валидация безопасного URL.
 * @param {string} url
 * @returns {boolean}
 */
function validateSafeUrl(url) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith("javascript:") || trimmed.startsWith("data:")) {
    return false;
  }
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("t.me/")
  );
}

/**
 * Валидация кода отмены (6 символов A-Z0-9).
 * @param {string} code
 * @returns {boolean}
 */
function validateCancelCode(code) {
  if (!code || typeof code !== "string") return false;
  return /^[A-Z0-9]{6}$/.test(code.trim().toUpperCase());
}

/**
 * Извлечение и валидация суффикса callback payload.
 * @param {string} payload
 * @param {string} prefix — например "service_edit:"
 * @param {(value: string) => boolean} [validateSuffix]
 * @returns {string|null}
 */
function parseCallbackPayload(payload, prefix, validateSuffix) {
  if (!payload || typeof payload !== "string") return null;
  if (!payload.startsWith(prefix)) return null;
  const suffix = payload.slice(prefix.length);
  if (!suffix) return null;
  if (validateSuffix && !validateSuffix(suffix)) return null;
  return suffix;
}

/**
 * Проверка актуальности callback по timestamp из Update MAX API.
 * @param {object} ctx — контекст MAX Bot
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateCallbackTimestamp(ctx) {
  const timestamp = ctx?.update?.timestamp;
  if (timestamp == null) {
    return { valid: true };
  }

  const ts =
    typeof timestamp === "number" ? timestamp : Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { valid: false, reason: "invalid_timestamp" };
  }

  const age = Date.now() - ts;
  if (age > CALLBACK_MAX_AGE_MS) {
    return { valid: false, reason: "callback_expired" };
  }
  if (age < -60_000) {
    return { valid: false, reason: "callback_future" };
  }

  return { valid: true };
}

/**
 * Валидация вложения-изображения (размер и MIME).
 * @param {object} attachment — элемент из ctx.message.body.attachments
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateImageAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") {
    return { valid: false, reason: "missing_attachment" };
  }

  const type = String(attachment.type || "").toLowerCase();
  if (type && type !== "image") {
    return { valid: false, reason: "not_image" };
  }

  const payload = attachment.payload || attachment;
  const mime =
    payload?.mime_type ||
    payload?.mimeType ||
    payload?.content_type ||
    attachment.mime_type;

  if (mime && !ALLOWED_IMAGE_MIME_TYPES.has(String(mime).toLowerCase())) {
    return { valid: false, reason: "invalid_mime" };
  }

  const size =
    payload?.size ??
    payload?.file_size ??
    payload?.fileSize ??
    attachment.size;

  if (size != null && Number(size) > MAX_IMAGE_ATTACHMENT_BYTES) {
    return { valid: false, reason: "file_too_large" };
  }

  return { valid: true };
}

/**
 * Проверяет, содержит ли строка потенциальную formula injection.
 * @param {string} text
 * @returns {boolean}
 */
function hasFormulaInjectionPattern(text) {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  return /^[=+\-@\t\r|]/.test(trimmed);
}

/**
 * Валидация размера данных (защита от DoS).
 * @param {any} data
 * @param {number} [maxSizeKB=10]
 * @returns {boolean}
 */
function validateDataSize(data, maxSizeKB = 10) {
  try {
    const jsonStr = JSON.stringify(data);
    const sizeBytes = Buffer.byteLength(jsonStr, "utf8");
    const sizeKB = sizeBytes / 1024;
    return sizeKB <= maxSizeKB;
  } catch (e) {
    return false;
  }
}

/**
 * Санитизация текста перед записью в Google Sheets (formula injection).
 * @param {string} text
 * @param {number} [maxLength=500]
 * @returns {string}
 */
function sanitizeSheetsInput(text, maxLength = 500) {
  if (text == null || typeof text !== "string") {
    return "";
  }

  let sanitized = text.trim().replace(/\x00/g, "");
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  if (/^[=+\-@\t\r|]/.test(sanitized)) {
    sanitized = `'${sanitized}`;
  }

  return sanitized;
}

/**
 * Очистка кэша валидации.
 */
function clearValidationCache() {
  validationCache.clear();
}

module.exports = {
  CALLBACK_MAX_AGE_MS,
  MAX_IMAGE_ATTACHMENT_BYTES,
  validateMaxUserId,
  validatePhone,
  validateName,
  sanitizeText,
  sanitizeDisplayName,
  sanitizeSheetsInput,
  validateAppointmentId,
  validateServiceKey,
  validateTimeStr,
  validateDateStr,
  validateSafeUrl,
  validateCancelCode,
  parseCallbackPayload,
  validateCallbackTimestamp,
  validateImageAttachment,
  hasFormulaInjectionPattern,
  validateDataSize,
  clearValidationCache,
};
