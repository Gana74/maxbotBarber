/**
 * Безопасная обработка ошибок для ответов пользователю.
 */

/**
 * Возвращает безопасное сообщение для пользователя.
 * Stack trace и пути — только в NODE_ENV=development.
 * @param {Error|unknown} error
 * @returns {string}
 */
function sanitizeErrorMessage(error) {
  if (process.env.NODE_ENV === "development") {
    if (error && typeof error === "object" && "message" in error) {
      return String(error.message) || "Произошла ошибка";
    }
    return String(error || "Произошла ошибка");
  }
  return "Произошла ошибка";
}

module.exports = {
  sanitizeErrorMessage,
};
