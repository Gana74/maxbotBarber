/**
 * Token bucket rate limiter для исходящих вызовов MAX API (до 30 rps).
 * Очередь запросов + retry при HTTP 429 с заголовком Retry-After.
 */

const DEFAULT_RPS = 30;
const MAX_RETRIES = 3;
const BACKOFF_MS = [2000, 4000, 8000];

let tokens = DEFAULT_RPS;
let lastRefill = Date.now();
const queue = [];
let processing = false;

/**
 * Пополняет token bucket.
 * @param {number} rps
 */
function refillTokens(rps) {
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1000;
  if (elapsed > 0) {
    tokens = Math.min(rps, tokens + elapsed * rps);
    lastRefill = now;
  }
}

/**
 * Извлекает задержку retry из ошибки MAX API.
 * @param {Error} err
 * @returns {number} миллисекунды
 */
function getRetryAfterMs(err) {
  const header =
    err?.headers?.["retry-after"] ??
    err?.headers?.["Retry-After"] ??
    err?.response?.headers?.["retry-after"];

  if (header != null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }

  const retryAfter =
    err?.retry_after ??
    err?.response?.parameters?.retry_after ??
    err?.response?.retry_after;

  if (retryAfter != null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }

  return 0;
}

/**
 * Проверяет, является ли ошибка rate limit (429).
 * @param {Error} err
 * @returns {boolean}
 */
function isRateLimitError(err) {
  const status = err?.status ?? err?.response?.error_code ?? err?.code;
  if (status === 429) return true;
  const msg = String(err?.message || err?.description || "").toLowerCase();
  return msg.includes("rate limit") || msg.includes("too many requests");
}

/**
 * Обрабатывает очередь запросов.
 * @param {number} rps
 */
async function processQueue(rps) {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    refillTokens(rps);

    if (tokens < 1) {
      const waitMs = Math.ceil((1 - tokens) / rps * 1000);
      await new Promise((r) => setTimeout(r, Math.max(waitMs, 10)));
      refillTokens(rps);
    }

    const item = queue.shift();
    if (!item) break;

    tokens -= 1;

    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      try {
        const result = await item.fn();
        item.resolve(result);
        break;
      } catch (err) {
        if (isRateLimitError(err) && attempt < MAX_RETRIES) {
          const retryMs =
            getRetryAfterMs(err) || BACKOFF_MS[attempt] || 8000;
          await new Promise((r) => setTimeout(r, retryMs));
          attempt += 1;
          continue;
        }
        item.reject(err);
        break;
      }
    }
  }

  processing = false;
}

/**
 * Ставит async-вызов MAX API в очередь с rate limiting.
 * @param {() => Promise<*>} fn
 * @param {object} [options]
 * @param {number} [options.rps=30]
 * @returns {Promise<*>}
 */
function schedule(fn, options = {}) {
  const rps = options.rps ?? DEFAULT_RPS;
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    processQueue(rps);
  });
}

/**
 * Обёртка над async-функцией с rate limiting.
 * @param {(...args: *) => Promise<*>} fn
 * @param {object} [options]
 * @returns {(...args: *) => Promise<*>}
 */
function withRateLimit(fn, options = {}) {
  return (...args) => schedule(() => fn(...args), options);
}

/**
 * Сброс состояния (для тестов).
 */
function resetRateLimiter() {
  tokens = DEFAULT_RPS;
  lastRefill = Date.now();
  queue.length = 0;
  processing = false;
}

module.exports = {
  schedule,
  withRateLimit,
  isRateLimitError,
  getRetryAfterMs,
  resetRateLimiter,
  DEFAULT_RPS,
};
