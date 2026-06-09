// Утилиты для безопасной отправки сообщений с обработкой ошибок
// Предотвращает крах бота при отправке сообщений заблокировавшим пользователям

const { getRetryAfterMs, isRateLimitError } = require("./apiRateLimiter");

/**
 * @param {Error} err
 * @returns {number|string|undefined}
 */
function getErrorCode(err) {
  return err?.status ?? err?.response?.error_code ?? err?.code;
}

/**
 * MAX user ID из контекста бота.
 * @param {Object} ctx - Контекст MAX Bot
 * @returns {string|number}
 */
function getUserId(ctx) {
  return ctx?.user?.user_id ?? "unknown";
}

/**
 * Безопасная отправка текстового сообщения через messenger.sendMessage.
 * @param {Object} messenger - Объект с методом sendMessage (например, MaxAdapter)
 * @param {string|number} userId - MAX user_id получателя
 * @param {string} text - Текст сообщения
 * @param {Object} options - Дополнительные опции для sendMessage
 * @returns {Promise<Object|null>} Результат отправки или null при ошибке
 */
async function safeSendMessage(messenger, userId, text, options = {}) {
  if (!messenger?.sendMessage) {
    console.error("[safeMessaging] Invalid messenger: sendMessage missing");
    return null;
  }

  if (!userId) {
    console.error("[safeMessaging] Invalid userId");
    return null;
  }

  try {
    const result = await messenger.sendMessage(userId, text, options);
    return result;
  } catch (err) {
    const errorCode = getErrorCode(err);
    const errorDescription =
      err.description || err.response?.description || err.message;

    // 403 Forbidden - пользователь заблокировал бота
    if (errorCode === 403) {
      console.warn(
        `[safeMessaging] User ${userId} blocked the bot. Message not sent.`,
      );
      return null;
    }

    // 400 Bad Request - неверный запрос (например, неверный user_id)
    if (errorCode === 400) {
      console.warn(
        `[safeMessaging] Bad request for user ${userId}: ${errorDescription}`,
      );
      return null;
    }

    // 429 Too Many Requests - превышен лимит запросов
    if (errorCode === 429 || isRateLimitError(err)) {
      const retryMs = getRetryAfterMs(err);
      console.warn(
        `[safeMessaging] Rate limit exceeded for user ${userId}. Retry after: ${retryMs ? `${retryMs}ms` : "unknown"}`,
      );
      return null;
    }

    // Другие ошибки - логируем с деталями
    console.error(
      `[safeMessaging] Error sending message to ${userId}:`,
      errorDescription,
      `(code: ${errorCode || "unknown"})`,
    );
    return null;
  }
}

/**
 * Безопасная отправка фото через messenger.sendPhoto.
 * @param {Object} messenger - Объект с методом sendPhoto (например, MaxAdapter)
 * @param {string|number} userId - MAX user_id получателя
 * @param {string} photo - URL фото или MAX token
 * @param {Object} options - Дополнительные опции для sendPhoto
 * @returns {Promise<Object|null>} Результат отправки или null при ошибке
 */
async function safeSendPhoto(messenger, userId, photo, options = {}) {
  if (!messenger?.sendPhoto) {
    console.error("[safeMessaging] Invalid messenger: sendPhoto missing");
    return null;
  }

  if (!userId) {
    console.error("[safeMessaging] Invalid userId");
    return null;
  }

  try {
    const result = await messenger.sendPhoto(userId, photo, options);
    return result;
  } catch (err) {
    const errorCode = getErrorCode(err);
    const errorDescription =
      err.description || err.response?.description || err.message;

    // 403 Forbidden - пользователь заблокировал бота
    if (errorCode === 403) {
      console.warn(
        `[safeMessaging] User ${userId} blocked the bot. Photo not sent.`,
      );
      return null;
    }

    // 400 Bad Request
    if (errorCode === 400) {
      console.warn(
        `[safeMessaging] Bad request for user ${userId}: ${errorDescription}`,
      );
      return null;
    }

    // 429 Too Many Requests
    if (errorCode === 429 || isRateLimitError(err)) {
      const retryMs = getRetryAfterMs(err);
      console.warn(
        `[safeMessaging] Rate limit exceeded for user ${userId}. Retry after: ${retryMs ? `${retryMs}ms` : "unknown"}`,
      );
      return null;
    }

    // Другие ошибки
    console.error(
      `[safeMessaging] Error sending photo to ${userId}:`,
      errorDescription,
      `(code: ${errorCode || "unknown"})`,
    );
    return null;
  }
}

/**
 * Безопасный ответ через ctx.reply.
 * @param {Object} ctx - Контекст MAX Bot
 * @param {string} text - Текст сообщения
 * @param {Object} extra - Дополнительные опции (keyboard, format и т.д.)
 * @returns {Promise<Object|null>} Результат отправки или null при ошибке
 */
async function safeReply(ctx, text, extra = {}) {
  if (!ctx) {
    console.error("[safeMessaging] Invalid ctx");
    return null;
  }

  if (!ctx.reply) {
    console.error("[safeMessaging] ctx.reply is not available");
    return null;
  }

  try {
    const result = await ctx.reply(text, extra);
    return result;
  } catch (err) {
    const errorCode = getErrorCode(err);
    const errorDescription =
      err.description || err.response?.description || err.message;
    const userId = getUserId(ctx);

    // 403 Forbidden - пользователь заблокировал бота
    if (errorCode === 403) {
      console.warn(
        `[safeMessaging] User ${userId} blocked the bot. Reply not sent.`,
      );
      return null;
    }

    // 400 Bad Request
    if (errorCode === 400) {
      console.warn(
        `[safeMessaging] Bad request for user ${userId}: ${errorDescription}`,
      );
      return null;
    }

    // 429 Too Many Requests
    if (errorCode === 429 || isRateLimitError(err)) {
      const retryMs = getRetryAfterMs(err);
      console.warn(
        `[safeMessaging] Rate limit exceeded for user ${userId}. Retry after: ${retryMs ? `${retryMs}ms` : "unknown"}`,
      );
      return null;
    }

    // Другие ошибки
    console.error(
      `[safeMessaging] Error replying to user ${userId}:`,
      errorDescription,
      `(code: ${errorCode || "unknown"})`,
    );
    return null;
  }
}

/**
 * Проверяет, является ли ошибка ошибкой блокировки бота пользователем
 * @param {Error} err - Объект ошибки
 * @returns {boolean} true если пользователь заблокировал бота
 */
function isBlockedError(err) {
  return err.response?.error_code === 403;
}

/**
 * Проверяет, является ли ошибка ошибкой превышения лимита запросов
 * @param {Error} err - Объект ошибки
 * @returns {boolean} true если превышен лимит запросов
 */
function isRateLimitErrorLegacy(err) {
  return getErrorCode(err) === 429 || isRateLimitError(err);
}

module.exports = {
  getUserId,
  safeSendMessage,
  safeSendPhoto,
  safeReply,
  isBlockedError,
  isRateLimitError: isRateLimitErrorLegacy,
};
