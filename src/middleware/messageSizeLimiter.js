/**
 * Middleware: отклоняет входящие сообщения длиннее лимита MAX API (4000 символов).
 */

const MAX_MESSAGE_LENGTH = 4000;

/**
 * @returns {(ctx: object, next: Function) => Promise<void>}
 */
function createMessageSizeLimiter() {
  return async function messageSizeLimiterMiddleware(ctx, next) {
    const text = ctx?.message?.body?.text;
    if (text != null && String(text).length > MAX_MESSAGE_LENGTH) {
      try {
        if (typeof ctx.reply === "function") {
          await ctx.reply(
            "Сообщение слишком длинное (максимум 4000 символов).",
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

const messageSizeLimiter = createMessageSizeLimiter();

module.exports = {
  messageSizeLimiter,
  createMessageSizeLimiter,
  MAX_MESSAGE_LENGTH,
};
