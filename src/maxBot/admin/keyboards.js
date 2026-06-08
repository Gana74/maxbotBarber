const { Keyboard } = require("@maxhub/max-bot-api");

function buildMainMenuKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback("Просмотр записей", "admin:bookings"),
      Keyboard.button.callback("Статистика", "admin:stats"),
    ],
    [Keyboard.button.callback("Отмена по коду", "admin:cancel_code")],
    [Keyboard.button.callback("Массовая рассылка", "admin:broadcast")],
    [
      Keyboard.button.callback("📊 Финансовая статистика", "admin:revenue"),
      Keyboard.button.callback("📊 Статус рассылки", "admin:broadcast_status"),
    ],
    [Keyboard.button.callback("⚙️ Настройки", "admin:settings")],
    [
      Keyboard.button.callback(
        "Вернуться в пользовательский режим",
        "admin:user_mode",
      ),
    ],
  ]);
}

function buildSettingsMenuKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback("Забанить пользователя", "admin:ban"),
      Keyboard.button.callback("Разбанить пользователя", "admin:unban"),
    ],
    [Keyboard.button.callback("Управление услугами", "admin:services_menu")],
    [
      Keyboard.button.callback(
        "Редактировать напоминание 28 дней",
        "admin:reminder_28",
      ),
    ],
    [
      Keyboard.button.callback(
        "Редактировать ссылку на чаевые",
        "admin:tips_link",
      ),
    ],
    [Keyboard.button.callback("Изменить контакты", "admin:contacts")],
    [
      Keyboard.button.callback(
        "Загрузить фото в портфолио",
        "admin:portfolio_upload",
      ),
    ],
    [Keyboard.button.callback("Удалить фото", "admin:portfolio_delete")],
    [Keyboard.button.callback("Сохранить локацию", "admin:save_location")],
    [Keyboard.button.callback("Настройки расписания", "admin:schedule_menu")],
    [Keyboard.button.callback("Назад в админ-меню", "admin:main_menu")],
  ]);
}

function buildScheduleMenuKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "Просмотр расписания на дату",
        "admin:schedule_view",
      ),
    ],
    [
      Keyboard.button.callback(
        "Изменить/добавить расписание на дату",
        "admin:schedule_edit",
      ),
    ],
    [
      Keyboard.button.callback(
        "Удалить расписание на дату",
        "admin:schedule_delete",
      ),
    ],
    [Keyboard.button.callback("Посмотреть всё расписание", "admin:schedule_all")],
    [
      Keyboard.button.callback(
        "Шаблоны по дням недели",
        "admin:schedule_weekday",
      ),
    ],
    [Keyboard.button.callback("Назад в админ-меню", "admin:main_menu")],
  ]);
}

function buildServicesMenuKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback("Список услуг", "admin:services_list")],
    [
      Keyboard.button.callback("Добавить услугу", "admin:services_add"),
      Keyboard.button.callback("Изменить услугу", "admin:services_edit"),
    ],
    [Keyboard.button.callback("Удалить услугу", "admin:services_delete")],
    [Keyboard.button.callback("Назад", "admin:services_back")],
  ]);
}

function buildRevenueMenuKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback("Сегодня", "revenue:today")],
    [Keyboard.button.callback("Вчера", "revenue:yesterday")],
    [Keyboard.button.callback("Эта неделя", "revenue:this_week")],
    [Keyboard.button.callback("Прошлая неделя", "revenue:last_week")],
    [Keyboard.button.callback("Этот месяц", "revenue:this_month")],
    [Keyboard.button.callback("Прошлый месяц", "revenue:last_month")],
    [Keyboard.button.callback("По услугам", "revenue:by_services")],
    [Keyboard.button.callback("Назад в админ-меню", "revenue:back")],
  ]);
}

function buildBroadcastConfirmKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "Подтвердить рассылку ✅",
        "admin:broadcast_confirm",
      ),
    ],
    [Keyboard.button.callback("Отменить ❌", "admin:broadcast_cancel")],
  ]);
}

module.exports = {
  buildMainMenuKeyboard,
  buildSettingsMenuKeyboard,
  buildScheduleMenuKeyboard,
  buildServicesMenuKeyboard,
  buildRevenueMenuKeyboard,
  buildBroadcastConfirmKeyboard,
};
