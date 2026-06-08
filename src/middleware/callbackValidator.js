/**
 * Middleware: защита от callback replay (устаревший timestamp).
 */

const { validateCallbackTimestamp } = require("../utils/security");
const { logSecurityEvent } = require("../utils/logger");

/**
 * @returns {(ctx: object, next: Function) => Promise<void>}
 */
function createCallbackValidator() {
  return async function callbackValidatorMiddleware(ctx, next) {
    const updateType = ctx?.update?.update_type;
    if (updateType !== "message_callback") {
      return next();
    }

    const result = validateCallbackTimestamp(ctx);
    if (!result.valid) {
      const userId = ctx?.user?.user_id ?? "unknown";
      await logSecurityEvent(
        userId,
        "invalid_callback",
        {
          reason: result.reason,
          payload: ctx?.update?.callback?.payload,
        },
        "WARNING",
      );

      try {
        if (typeof ctx.answerOnCallback === "function") {
          await ctx.answerOnCallback({
            notification: "Действие устарело. Повторите запрос.",
          });
        }
      } catch {
        // ignore
      }
      return;
    }

    return next();
  };
}

const callbackValidator = createCallbackValidator();

module.exports = {
  callbackValidator,
  createCallbackValidator,
};
