/**
 * Резолв HTTPS URL фото клиента из вложения MAX для внешних API (Ranvik).
 */

const { validateSafeUrl } = require("./security");

const MAX_PLATFORM_API = "https://platform-api.max.ru";

/**
 * Проверяет, что URL — прямая ссылка на изображение, доступная внешним API.
 * @param {string} url
 * @returns {boolean}
 */
function isDirectImageUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }

  const lower = url.trim().toLowerCase();
  if (/\.(jpe?g|png|webp)(\?|#|$)/.test(lower)) {
    return true;
  }

  return lower.includes("/images/");
}

/**
 * Извлекает публичный URL из ответа MAX API для изображения.
 * @param {object} body
 * @returns {string|null}
 */
function extractImageUrlFromApiResponse(body) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const candidates = [
    body.url,
    body.urls?.original,
    body.urls?.full,
    body.urls?.default,
    body.urls?.large,
    body.urls?.preview,
  ];

  if (body.urls && typeof body.urls === "object") {
    for (const value of Object.values(body.urls)) {
      if (typeof value === "string" && validateSafeUrl(value)) {
        return value;
      }
      if (value && typeof value === "object" && validateSafeUrl(value.url)) {
        return value.url;
      }
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate === "string" && validateSafeUrl(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Запрашивает публичный URL изображения по токену MAX Platform API.
 * @param {string} token
 * @returns {Promise<string|null>}
 */
async function resolveImageUrlByToken(token) {
  const botToken = process.env.MAX_BOT_TOKEN;
  if (!botToken || !token) {
    return null;
  }

  const encodedToken = encodeURIComponent(String(token).trim());
  const endpoints = [
    `${MAX_PLATFORM_API}/images/${encodedToken}`,
    `${MAX_PLATFORM_API}/photos/${encodedToken}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: botToken,
        },
      });

      if (!response.ok) {
        continue;
      }

      const body = await response.json();
      const url = extractImageUrlFromApiResponse(body);
      if (url) {
        return url;
      }
    } catch (error) {
      console.warn(
        "[resolveClientPhotoUrl] resolveImageUrlByToken error:",
        endpoint,
        error.message || error,
      );
    }
  }

  return null;
}

/**
 * Перезагружает изображение через MAX API и возвращает стабильный HTTPS URL.
 * @param {object} ctx
 * @param {string} sourceUrl
 * @returns {Promise<string|null>}
 */
async function reuploadAndResolveUrl(ctx, sourceUrl) {
  if (!ctx?.api?.uploadImage || !sourceUrl) {
    return null;
  }

  try {
    const uploaded = await ctx.api.uploadImage({ url: sourceUrl });
    const uploadToken = uploaded?.token;
    if (!uploadToken) {
      console.warn(
        "[resolveClientPhotoUrl] uploadImage did not return token for",
        sourceUrl,
      );
      return null;
    }

    return resolveImageUrlByToken(uploadToken);
  } catch (error) {
    console.warn(
      "[resolveClientPhotoUrl] reuploadAndResolveUrl error:",
      error.message || error,
    );
    return null;
  }
}

/**
 * Возвращает HTTPS URL селфи клиента для передачи в Ranvik API.
 * Приоритет: token → прямой URL → перезагрузка временного URL через MAX API.
 *
 * @param {object} attachment — элемент ctx.message.body.attachments (type image)
 * @param {object} [ctx] — контекст MAX Bot (нужен для uploadImage при временных URL)
 * @returns {Promise<string|null>}
 */
async function resolveClientPhotoUrl(attachment, ctx = null) {
  if (!attachment || attachment.type !== "image") {
    return null;
  }

  const payload = attachment.payload || attachment;
  const directUrl = payload?.url ? String(payload.url).trim() : "";
  const token = payload?.token ? String(payload.token).trim() : "";

  if (token) {
    const resolvedByToken = await resolveImageUrlByToken(token);
    if (resolvedByToken) {
      return resolvedByToken;
    }
  }

  if (
    directUrl &&
    validateSafeUrl(directUrl) &&
    isDirectImageUrl(directUrl)
  ) {
    return directUrl;
  }

  if (directUrl && validateSafeUrl(directUrl) && ctx) {
    const reuploadedUrl = await reuploadAndResolveUrl(ctx, directUrl);
    if (reuploadedUrl) {
      return reuploadedUrl;
    }
  }

  if (token) {
    return resolveImageUrlByToken(token);
  }

  return null;
}

module.exports = {
  resolveClientPhotoUrl,
  resolveImageUrlByToken,
  extractImageUrlFromApiResponse,
  isDirectImageUrl,
  reuploadAndResolveUrl,
};
