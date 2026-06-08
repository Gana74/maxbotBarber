/**
 * Централизованный показ главного пользовательского меню (reply-кнопки через messageButton).
 */

const { buildUserMenuKeyboard } = require("../utils/maxKeyboard");

const DEFAULT_MAIN_MENU_MESSAGE =
  "👇 Выберите действие с помощью кнопок ниже:";

/**
 * @param {import('../adapters/maxAdapter').MaxAdapter} adapter
 */
function createShowUserMainMenu(adapter) {
  return async function showMainMenu(
    ctx,
    message = DEFAULT_MAIN_MENU_MESSAGE,
  ) {
    ctx.session = ctx.session || {};
    ctx.session.mode = "user";
    await adapter.reply(ctx, message, {
      attachments: [buildUserMenuKeyboard()],
    });
  };
}

module.exports = {
  createShowUserMainMenu,
  DEFAULT_MAIN_MENU_MESSAGE,
};
