/**
 * Хелперы клавиатуры MAX.
 * В @maxhub/max-bot-api@0.2.2 нет Keyboard.button.message — кнопка задаётся объектом API.
 */

const { Keyboard } = require("@maxhub/max-bot-api");

const MAX_KEYBOARD_ROWS = 30;
const MAX_BUTTONS_PER_ROW = 7;
const MAX_KEYBOARD_BUTTONS = 210;

/**
 * Проверяет лимиты inline-клавиатуры MAX API.
 * @param {Array} rows
 * @returns {Array}
 */
function enforceKeyboardLimits(rows) {
  if (!Array.isArray(rows)) return rows;
  const limitedRows = rows.slice(0, MAX_KEYBOARD_ROWS).map((row) => {
    const buttons = Array.isArray(row) ? row : [row];
    return buttons.slice(0, MAX_BUTTONS_PER_ROW);
  });
  let total = limitedRows.reduce((sum, row) => sum + row.length, 0);
  if (total <= MAX_KEYBOARD_BUTTONS) {
    return limitedRows;
  }
  const result = [];
  let count = 0;
  for (const row of limitedRows) {
    const nextRow = [];
    for (const btn of row) {
      if (count >= MAX_KEYBOARD_BUTTONS) break;
      nextRow.push(btn);
      count += 1;
    }
    if (nextRow.length) result.push(nextRow);
    if (count >= MAX_KEYBOARD_BUTTONS) break;
  }
  return result;
}

/** @param {string} text */
function messageButton(text) {
  if (Keyboard.button?.message) {
    return Keyboard.button.message(text);
  }
  return { type: "message", text };
}

function buildUserMenuKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "✨ Подобрать стрижку с ИИ",
        "haircut_start",
      ),
    ],
    [messageButton("Записаться 💇‍♂️")],
    [messageButton("Мои записи"), messageButton("Прайс")],
    [messageButton("Как добраться 🗺️")],
  ]);
}

module.exports = {
  messageButton,
  buildUserMenuKeyboard,
  enforceKeyboardLimits,
  MAX_KEYBOARD_ROWS,
  MAX_BUTTONS_PER_ROW,
  MAX_KEYBOARD_BUTTONS,
};
