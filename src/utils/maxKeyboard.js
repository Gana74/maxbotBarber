/**
 * Хелперы клавиатуры MAX.
 * В @maxhub/max-bot-api@0.2.2 нет Keyboard.button.message — кнопка задаётся объектом API.
 */

const { Keyboard } = require("@maxhub/max-bot-api");

/** @param {string} text */
function messageButton(text) {
  if (Keyboard.button?.message) {
    return Keyboard.button.message(text);
  }
  return { type: "message", text };
}

function buildUserMenuKeyboard() {
  return Keyboard.inlineKeyboard([
    [messageButton("Записаться 💇‍♂️")],
    [messageButton("Мои записи"), messageButton("Прайс")],
    [messageButton("Как добраться 🗺️")],
  ]);
}

module.exports = {
  messageButton,
  buildUserMenuKeyboard,
};
