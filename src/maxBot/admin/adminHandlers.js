/**
 * Админ-панель для MAX Bot — фасад модуля.
 */

const { ADMIN_MODE } = require("./constants");
const { registerAdminHandlers } = require("./registerAdminHandlers");
const {
  buildMainMenuKeyboard,
  buildSettingsMenuKeyboard,
  buildScheduleMenuKeyboard,
} = require("./keyboards");

module.exports = {
  registerAdminHandlers,
  ADMIN_MODE,
  buildMainMenuKeyboard,
  buildSettingsMenuKeyboard,
  buildScheduleMenuKeyboard,
};
