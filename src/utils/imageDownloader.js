const { MAX_IMAGE_ATTACHMENT_BYTES, validateSafeUrl } = require("./security");

const DOWNLOAD_TIMEOUT_MS = 10_000;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [2000, 4000, 8000]; // exponential backoff для retry'ев

/**
 * Возвращает безопасную для логирования версию URL без query/fragment.
 * @param {string} url
 * @returns {string}
 */
function toLoggableUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(url || "").slice(0, 120);
  }
}

/**
 * Нормализует MIME из Content-Type (без charset и пр.).
 * @param {string|null} contentType
 * @returns {string}
 */
function normalizeMime(contentType) {
  if (!contentType) {
    return "";
  }
  return String(contentType).split(";")[0].trim().toLowerCase();
}

/**
 * Отправляет HEAD запрос для проверки доступности URL.
 * @param {string} url
 * @returns {Promise<{ok: boolean, statusCode: number, contentLength: number|null, error: string|null}>}
 */
async function checkUrlAccessibility(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      DOWNLOAD_TIMEOUT_MS / 2,
    );

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return {
      ok: response.ok,
      statusCode: response.status,
      contentLength: parseInt(
        response.headers.get("content-length") || "0",
        10,
      ),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      contentLength: null,
      error: error?.message || String(error),
    };
  }
}

/**
 * Ждёт перед retry с exponential backoff.
 * @param {number} attemptIndex - 0 for 1st retry, 1 for 2nd, etc.
 * @returns {Promise<void>}
 */
async function delayBeforeRetry(attemptIndex) {
  const delayMs =
    RETRY_BACKOFF_MS[Math.min(attemptIndex, RETRY_BACKOFF_MS.length - 1)];
  console.log(
    `[imageDownloader] waiting ${delayMs}ms before retry ${attemptIndex + 1}`,
  );
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Определяет MIME по URL, если сервер не вернул Content-Type.
 * @param {string} url
 * @returns {string|null}
 */
function guessMimeFromUrl(url) {
  const lower = String(url || "").toLowerCase();
  if (/\.jpe?g(\?|#|$)/.test(lower)) return "image/jpeg";
  if (/\.png(\?|#|$)/.test(lower)) return "image/png";
  if (/\.webp(\?|#|$)/.test(lower)) return "image/webp";
  return null;
}

/**
 * Скачивает изображение по URL и возвращает Buffer.
 * @param {string} url
 * @param {boolean} [checkAccessibility=false]
 * @returns {Promise<Buffer|null>}
 */
async function downloadImageBuffer(url, checkAccessibility = false) {
  if (!validateSafeUrl(url)) {
    console.warn("[imageDownloader] invalid image URL:", toLoggableUrl(url));
    return null;
  }

  const loggableUrl = toLoggableUrl(url);

  if (checkAccessibility) {
    const check = await checkUrlAccessibility(url);
    if (!check.ok) {
      console.warn(
        "[imageDownloader] URL not accessible (HEAD request failed):",
        `status=${check.statusCode}, error=${check.error}`,
      );
      return null;
    }
  }

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await delayBeforeRetry(attempt - 1);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "image/*,*/*",
          "User-Agent": "MaxBot/1.0",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (attempt < RETRY_ATTEMPTS - 1) {
          continue;
        }
        return null;
      }

      let mime = normalizeMime(response.headers.get("content-type"));
      if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
        mime = guessMimeFromUrl(url) || mime;
      }
      if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
        console.warn("[imageDownloader] unsupported mime:", mime || "unknown");
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.byteLength > MAX_IMAGE_ATTACHMENT_BYTES) {
        console.warn(
          "[imageDownloader] image too large:",
          buffer.byteLength,
          "bytes",
        );
        return null;
      }

      return buffer;
    } catch (error) {
      clearTimeout(timeoutId);
      if (attempt === RETRY_ATTEMPTS - 1) {
        return null;
      }
    }
  }

  console.error("[imageDownloader] all retry attempts failed:", loggableUrl);
  return null;
}

/**
 * Скачивает изображение по URL и возвращает Data URI в base64.
 * С поддержкой retry при сетевых ошибках.
 * @param {string} url - HTTPS URL изображения из MAX attachment.
 * @param {boolean} [checkAccessibility=false] - проверить доступность HEAD запросом перед скачиванием
 * @returns {Promise<string|null>} data:image/{mime};base64,... или null при ошибке.
 */
async function downloadImageAsBase64(url, checkAccessibility = false) {
  if (!validateSafeUrl(url)) {
    console.warn("[imageDownloader] invalid image URL:", toLoggableUrl(url));
    return null;
  }

  const loggableUrl = toLoggableUrl(url);

  // Опциональная проверка доступности перед основным скачиванием
  if (checkAccessibility) {
    console.log("[imageDownloader] checking accessibility:", loggableUrl);
    const check = await checkUrlAccessibility(url);
    if (!check.ok) {
      console.warn(
        "[imageDownloader] URL not accessible (HEAD request failed):",
        `status=${check.statusCode}, error=${check.error}`,
      );
      return null;
    }
    console.log(
      "[imageDownloader] URL accessible, content-length:",
      check.contentLength,
    );
  }

  const startedAt = Date.now();
  console.log("[imageDownloader] download start:", loggableUrl);

  // Retry цикл
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    const isRetry = attempt > 0;
    if (isRetry) {
      await delayBeforeRetry(attempt - 1);
      console.log(
        `[imageDownloader] retry attempt ${attempt}/${RETRY_ATTEMPTS - 1}:`,
        loggableUrl,
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "image/*,*/*",
          "User-Agent": "MaxBot/1.0",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(
          `[imageDownloader] download failed (attempt ${attempt + 1}/${RETRY_ATTEMPTS}):`,
          `status=${response.status}`,
          loggableUrl,
        );
        if (isRetry && attempt < RETRY_ATTEMPTS - 1) {
          continue; // try again
        }
        return null;
      }

      let mime = normalizeMime(response.headers.get("content-type"));
      if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
        mime = guessMimeFromUrl(url) || mime;
      }
      if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
        console.warn("[imageDownloader] unsupported mime:", mime || "unknown");
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.byteLength > MAX_IMAGE_ATTACHMENT_BYTES) {
        console.warn(
          "[imageDownloader] image too large:",
          buffer.byteLength,
          "bytes",
        );
        return null;
      }

      const elapsedMs = Date.now() - startedAt;
      const attemptStr = isRetry ? ` (retry attempt ${attempt})` : "";
      console.log(
        `[imageDownloader] download success${attemptStr}:`,
        `${buffer.byteLength} bytes`,
        `${elapsedMs} ms`,
      );

      return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch (error) {
      clearTimeout(timeoutId);

      const isAbort = error?.name === "AbortError";
      const errorMsg = isAbort ? "timeout" : error?.message || String(error);

      console.error(
        `[imageDownloader] download error (attempt ${attempt + 1}/${RETRY_ATTEMPTS}):`,
        errorMsg,
      );

      if (!isRetry || attempt === RETRY_ATTEMPTS - 1) {
        // Нет смысла retry'ить в последней попытке
        return null;
      }
    }
  }

  console.error("[imageDownloader] all retry attempts failed:", loggableUrl);
  return null;
}

module.exports = {
  downloadImageAsBase64,
  downloadImageBuffer,
};
