/**
 * Простой в-памяти кэш для результатов генерации AI стрижек.
 * TTL: 24 часа (совпадает с TTL cdn.ranvik.ru)
 * Цель: кэшировать бинарные данные изображений, загруженные с cdn.ranvik.ru,
 * чтобы при сетевых проблемах можно было использовать кэшированный результат.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа
const MAX_CACHE_SIZE_MB = 100;
const MAX_CACHE_BYTES = MAX_CACHE_SIZE_MB * 1024 * 1024;

/**
 * @typedef {object} CacheEntry
 * @property {Buffer} buffer
 * @property {number} expiresAt
 * @property {number} createdAt
 */

class AiResultCache {
  constructor() {
    /** @type {Map<string, CacheEntry>} */
    this.cache = new Map();
    this.totalBytes = 0;
    this.cleanupIntervalId = null;
    this._startPeriodicCleanup();
  }

  /**
   * Запускает периодическую очистку кэша (каждые 2 часа).
   * @private
   */
  _startPeriodicCleanup() {
    // Очистка каждые 2 часа
    const cleanupIntervalMs = 2 * 60 * 60 * 1000;
    this.cleanupIntervalId = setInterval(() => {
      const removed = this._cleanExpired();
      if (removed > 0) {
        console.log(
          `[aiResultCache] periodic cleanup: ${removed} expired entries removed`,
        );
      }
    }, cleanupIntervalMs);

    // Не блокируем выход приложения на этом интервале
    if (this.cleanupIntervalId.unref) {
      this.cleanupIntervalId.unref();
    }
  }

  /**
   * Останавливает периодическую очистку (вызывается при graceful shutdown).
   */
  stop() {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
      console.log("[aiResultCache] periodic cleanup stopped");
    }
  }

  /**
   * Генерирует ключ кэша из URL.
   * @param {string} url
   * @returns {string}
   */
  _getKey(url) {
    // Используем URL как ключ (без query параметров)
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url;
    }
  }

  /**
   * Очищает истёкшие записи.
   * @private
   * @returns {number} количество удалённых записей
   */
  _cleanExpired() {
    const now = Date.now();
    const expired = [];

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        expired.push(key);
      }
    }

    expired.forEach((key) => {
      const entry = this.cache.get(key);
      if (entry) {
        this.totalBytes -= entry.buffer.byteLength;
      }
      this.cache.delete(key);
    });

    if (expired.length > 0) {
      console.log(
        "[aiResultCache] cleaned expired entries:",
        `${expired.length} removed, ${Math.round(this.totalBytes / 1024)} KB used`,
      );
    }

    return expired.length;
  }

  /**
   * Очищает кэш, если он переполнен (удаляет самые старые записи).
   */
  _evictIfNeeded() {
    if (this.totalBytes <= MAX_CACHE_BYTES) {
      return;
    }

    // Сортируем по времени создания (самые старые первыми)
    const sorted = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    );

    for (const [key, entry] of sorted) {
      if (this.totalBytes <= MAX_CACHE_BYTES * 0.8) {
        // Освобождаем 80% объёма
        break;
      }
      this.totalBytes -= entry.buffer.byteLength;
      this.cache.delete(key);
    }

    console.log(
      "[aiResultCache] evicted old entries, now using:",
      `${Math.round(this.totalBytes / 1024)} KB`,
    );
  }

  /**
   * Сохраняет изображение в кэш.
   * @param {string} url
   * @param {Buffer} buffer
   * @returns {boolean} успешно ли добавлено
   */
  set(url, buffer) {
    if (!url || !Buffer.isBuffer(buffer)) {
      console.warn("[aiResultCache] set: invalid arguments");
      return false;
    }

    const key = this._getKey(url);
    const sizeKb = (buffer.byteLength / 1024).toFixed(1);

    // Проверяем, что изображение не слишком большое
    if (buffer.byteLength > MAX_CACHE_BYTES * 0.2) {
      console.warn(
        `[aiResultCache] image too large: ${sizeKb} KB, skipping cache`,
      );
      return false;
    }

    const now = Date.now();
    const entry = {
      buffer,
      expiresAt: now + CACHE_TTL_MS,
      createdAt: now,
    };

    // Удаляем старую запись если есть
    const oldEntry = this.cache.get(key);
    if (oldEntry) {
      this.totalBytes -= oldEntry.buffer.byteLength;
    }

    this.cache.set(key, entry);
    this.totalBytes += buffer.byteLength;

    // Очищаем старые и переполненные записи
    this._cleanExpired();
    this._evictIfNeeded();

    console.log(
      `[aiResultCache] cached result: ${sizeKb} KB, total: ${Math.round(this.totalBytes / 1024)} KB (${this.cache.size} entries)`,
    );

    return true;
  }

  /**
   * Получает изображение из кэша.
   * @param {string} url
   * @returns {Buffer|null}
   */
  get(url) {
    const key = this._getKey(url);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (entry.expiresAt < now) {
      this.totalBytes -= entry.buffer.byteLength;
      this.cache.delete(key);
      console.log("[aiResultCache] expired entry removed");
      return null;
    }

    console.log("[aiResultCache] cache hit");
    return entry.buffer;
  }

  /**
   * Проверяет, есть ли запись в кэше.
   * @param {string} url
   * @returns {boolean}
   */
  has(url) {
    return this.get(url) !== null;
  }

  /**
   * Очищает весь кэш.
   */
  clear() {
    const count = this.cache.size;
    this.cache.clear();
    this.totalBytes = 0;
    console.log(`[aiResultCache] cleared: ${count} entries`);
  }

  /**
   * Возвращает статистику кэша.
   * @returns {object}
   */
  getStats() {
    return {
      entries: this.cache.size,
      totalBytes: this.totalBytes,
      totalMb: (this.totalBytes / 1024 / 1024).toFixed(2),
      maxMb: MAX_CACHE_SIZE_MB,
      ttlHours: CACHE_TTL_MS / (60 * 60 * 1000),
    };
  }
}

// Глобальный синглтон кэша
const cache = new AiResultCache();

module.exports = {
  set: (url, buffer) => cache.set(url, buffer),
  get: (url) => cache.get(url),
  has: (url) => cache.has(url),
  clear: () => cache.clear(),
  stop: () => cache.stop(),
  getStats: () => cache.getStats(),
};
