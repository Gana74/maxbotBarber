/**
 * Админ-панель для MAX Bot (ctx.session, Keyboard.inlineKeyboard).
 */

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezonePlugin = require("dayjs/plugin/timezone");
const { Keyboard } = require("@maxhub/max-bot-api");
const adminService = require("../../services/admin");
const servicesService = require("../../services/services");
const revenueStats = require("../../services/revenueStats");
const { formatDate } = require("../../utils/formatDate");
const { validateTelegramId, sanitizeText } = require("../../utils/security");
const { logCriticalAction, logAdminAction, logError } = require("../../utils/logger");
const { safeSendMessage } = require("../../utils/safeMessaging");
const { isBookingActive } = require("../scenes/bookingScene");
const { createShowUserMainMenu } = require("../showUserMainMenu");

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

const ADMIN_MODE = "admin";
const MAX_BROADCAST_RECIPIENTS = 250;

function getUserId(ctx) {
  return ctx.user?.user_id;
}

function getMessageText(ctx) {
  return ctx.message?.body?.text?.trim() ?? "";
}

function getMessageCaption(ctx) {
  return getMessageText(ctx);
}

function getMessageImageRef(ctx) {
  const attachments = ctx.message?.body?.attachments;
  if (!Array.isArray(attachments)) {
    return null;
  }
  const image = attachments.find((a) => a?.type === "image");
  if (!image?.payload) {
    return null;
  }
  const { token, url } = image.payload;
  return token || url || null;
}

function isAdminMode(ctx) {
  return ctx.session?.mode === ADMIN_MODE;
}

function clearAdminScenario(ctx) {
  if (!ctx.session) return;
  delete ctx.session.adminAction;
  delete ctx.session.servicesAction;
  delete ctx.session.scheduleAction;
  delete ctx.session.fromSettings;
}

function toIsoDate(raw) {
  const value = (raw || "").trim();
  if (!value) return null;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(value)) {
    const [dd, mm, yyyy] = value.split(".");
    return `${yyyy}-${mm}-${dd}`;
  }
  return value;
}

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

function createAdminHandlers(adapter, sheetsService, bookingService, bot) {
  const config = adapter.config;
  const showUserMainMenu = createShowUserMainMenu(adapter);

  const checkAdmin = (ctx) => {
    if (adapter.isAdmin(ctx)) {
      return true;
    }
    const userId = getUserId(ctx);
    const managerId = config.managerChatId;
    if (userId != null && managerId != null && userId === Number(managerId)) {
      return true;
    }
    return false;
  };

  const replyNoAccess = async (ctx) => {
    await adapter.reply(ctx, "Нет доступа к админ-панели.");
  };

  const showMainMenu = async (ctx, text) => {
    ctx.session = ctx.session || {};
    ctx.session.mode = ADMIN_MODE;
    clearAdminScenario(ctx);
    await adapter.reply(
      ctx,
      text || "Включён режим администратора. Выберите действие:",
      { attachments: [buildMainMenuKeyboard()] },
    );
  };

  const showSettingsMenu = async (ctx) => {
    ctx.session.fromSettings = true;
    await adapter.reply(ctx, "Настройки. Выберите действие:", {
      attachments: [buildSettingsMenuKeyboard()],
    });
  };

  const showScheduleMenu = async (ctx) => {
    ctx.session.fromSettings = true;
    delete ctx.session.scheduleAction;
    await adapter.reply(ctx, "Настройки расписания. Выберите действие:", {
      attachments: [buildScheduleMenuKeyboard()],
    });
  };

  const showServicesMenu = async (ctx) => {
    ctx.session.fromSettings = true;
    await adapter.reply(ctx, "Управление услугами. Выберите действие:", {
      attachments: [buildServicesMenuKeyboard()],
    });
  };

  const handleAdminCancel = async (ctx) => {
    clearAdminScenario(ctx);
    await showMainMenu(ctx, "Действие админа отменено.");
  };

  const showAllBookings = async (ctx) => {
    const all = await sheetsService.getAllActiveAppointments();
    if (!all.length) {
      await adapter.reply(ctx, "Нет активных записей.", {
        attachments: [buildMainMenuKeyboard()],
      });
      return;
    }
    const lines = all
      .slice(0, 50)
      .map(
        (a) =>
          `Код отмены: ${a.cancelCode || "N/A"} — ${a.service} ${formatDate(
            a.date,
          )} ${a.timeStart}-${a.timeEnd} — ${a.clientName} (${a.phone})`,
      );
    await adapter.reply(
      ctx,
      `Активные записи (показано ${lines.length} из ${all.length}):\n` +
        lines.join("\n"),
      { attachments: [buildMainMenuKeyboard()] },
    );
  };

  const showStats = async (ctx) => {
    const all = await sheetsService.getAllActiveAppointments();
    const clients = await sheetsService.getAllClients();
    const uniqueClients = new Set(
      clients.map((c) => String(c.telegramId)).filter(Boolean),
    ).size;
    await adapter.reply(
      ctx,
      `Статистика:\nАктивных записей: ${all.length}\nКлиентов в базе: ${uniqueClients}`,
      { attachments: [buildMainMenuKeyboard()] },
    );
  };

  const showBroadcastStatus = async (ctx) => {
    try {
      const clientsForBroadcast = sheetsService.getClientsForBroadcast
        ? await sheetsService.getClientsForBroadcast()
        : [];
      const allClients = await sheetsService.getAllClients();
      const allClientsWithTelegram = allClients.filter(
        (c) => c && c.telegramId,
      );

      const timezone = await sheetsService.getTimezone();
      const nowTz = dayjs().tz(timezone);
      let nextMonday = nowTz.day(1);
      if (nextMonday.isBefore(nowTz) || nextMonday.isSame(nowTz, "day")) {
        nextMonday = nextMonday.add(7, "day");
      }
      nextMonday = nextMonday.hour(0).minute(0).second(0).millisecond(0);

      const availableToday = clientsForBroadcast.length;
      const totalClients = allClientsWithTelegram.length;
      const waitingCount = Math.max(0, totalClients - availableToday);
      const nextResetDate = nextMonday.format("DD.MM.YYYY HH:mm");
      const canSendToday = Math.min(availableToday, MAX_BROADCAST_RECIPIENTS);
      const remainingToday = Math.max(
        0,
        availableToday - MAX_BROADCAST_RECIPIENTS,
      );

      let message = "📊 Статус рассылки\n\n";
      message += `📤 Доступно сегодня: ${canSendToday} из ${MAX_BROADCAST_RECIPIENTS}\n`;
      if (remainingToday > 0) {
        message += `⏳ Ожидают (после лимита): ${remainingToday}\n`;
      }
      message += `👥 Всего клиентов: ${totalClients}\n`;
      if (waitingCount > 0) {
        message += `⏱ Отправленных за последние 24 часа: ${waitingCount}\n`;
      }
      message += `🔄 Следующий сброс меток: ${nextResetDate} (${timezone})\n`;

      await adapter.reply(ctx, message, {
        attachments: [buildMainMenuKeyboard()],
      });
    } catch (err) {
      console.error("Ошибка при получении статуса рассылки:", err);
      await adapter.reply(
        ctx,
        `Ошибка при получении статуса рассылки: ${err.message}`,
        { attachments: [buildMainMenuKeyboard()] },
      );
    }
  };

  const showRevenueMenu = async (ctx) => {
    await adapter.reply(ctx, "Выберите период для просмотра статистики:", {
      attachments: [buildRevenueMenuKeyboard()],
    });
  };

  const startCancelByCode = async (ctx) => {
    ctx.session.adminAction = { type: "cancel_booking_by_code" };
    await adapter.reply(
      ctx,
      "Отправьте код отмены записи (например: A3K9X2).\nДля отмены напишите /admin_cancel",
    );
  };

  const startBroadcast = async (ctx) => {
    ctx.session.adminAction = { type: "broadcast" };
    await adapter.reply(
      ctx,
      "Отправьте текст для рассылки или пришлите фото с подписью.\nДля отмены напишите /admin_cancel",
    );
  };

  const startBan = async (ctx) => {
    ctx.session.adminAction = { type: "ban" };
    await adapter.reply(
      ctx,
      "Отправьте Telegram ID или @username пользователя для бана.\nДля отмены напишите /admin_cancel",
    );
  };

  const startUnban = async (ctx) => {
    ctx.session.adminAction = { type: "unban" };
    await adapter.reply(
      ctx,
      "Отправьте Telegram ID пользователя для разбанивания.\nДля отмены напишите /admin_cancel",
    );
  };

  const startReminder28 = async (ctx) => {
    try {
      const currentMessage = await sheetsService.get28DayReminderMessage();
      ctx.session.adminAction = { type: "edit_28day_reminder" };
      await adapter.reply(
        ctx,
        `Текущий текст напоминания:\n\n${currentMessage}\n\nОтправьте новый текст. Используйте {clientName} для подстановки имени клиента.\nДля отмены напишите /admin_cancel`,
      );
    } catch (err) {
      await adapter.reply(ctx, `Ошибка при получении текущего сообщения: ${err.message}`);
    }
  };

  const startTipsLink = async (ctx) => {
    try {
      const currentTips = await sheetsService.getTipsLink();
      ctx.session.adminAction = { type: "edit_tips_link" };
      await adapter.reply(
        ctx,
        `Текущие данные для чаевых:\n\n${
          currentTips || "не установлены"
        }\n\nОтправьте новую ссылку (http://, https://, t.me/) или номер телефона.\nДля отмены напишите /admin_cancel`,
      );
    } catch (err) {
      await adapter.reply(ctx, `Ошибка при получении данных: ${err.message}`);
    }
  };

  const startEditContacts = async (ctx) => {
    try {
      const currentPhone = await sheetsService.getBarberPhone();
      const currentAddress = await sheetsService.getBarberAddress();
      ctx.session.adminAction = { type: "edit_contacts" };
      await adapter.reply(
        ctx,
        `Текущие контакты:\n\n📞 Телефон: ${
          currentPhone || "не установлен"
        }\n📍 Адрес: ${
          currentAddress || "не установлен"
        }\n\nОтправьте новые контакты в формате:\nТелефон (первая строка)\nАдрес (вторая строка)\n\nДля отмены напишите /admin_cancel`,
      );
    } catch (err) {
      await adapter.reply(
        ctx,
        `Ошибка при получении текущих контактов: ${err.message}`,
      );
    }
  };

  const startPortfolioUpload = async (ctx) => {
    ctx.session.adminAction = { type: "portfolio_upload" };
    await adapter.reply(
      ctx,
      "Пришлите фото для портфолио.\nДля отмены напишите /admin_cancel",
    );
  };

  const startPortfolioDelete = async (ctx) => {
    try {
      const ids = (await sheetsService.getPortfolioFileIds()) || [];
      const best = ids.slice(0, 6);

      if (!best.length) {
        await adapter.reply(ctx, "Портфолио пустое. Сначала загрузите фото.", {
          attachments: [buildSettingsMenuKeyboard()],
        });
        return;
      }

      await adapter.reply(
        ctx,
        "Текущие фото (самые свежие) для удаления:",
        { attachments: [buildSettingsMenuKeyboard()] },
      );

      for (let i = 0; i < best.length; i += 1) {
        await adapter.sendPhoto(
          getUserId(ctx),
          best[i],
          `Фото №${i + 1}`,
        );
      }

      ctx.session.adminAction = {
        type: "portfolio_delete",
        maxIndex: best.length,
      };
      await adapter.reply(
        ctx,
        `Отправьте номер фото для удаления: 1..${best.length}.\nДля отмены напишите /admin_cancel`,
      );
    } catch (e) {
      await adapter.reply(ctx, `Ошибка при получении портфолио: ${e.message || e}`);
    }
  };

  const startSaveLocation = async (ctx) => {
    try {
      const current = await sheetsService.getLocationLink();
      ctx.session.adminAction = { type: "save_location" };
      await adapter.reply(
        ctx,
        `Текущая ссылка на локацию:\n${current || "не установлена"}\n\nПришлите новую ссылку на маршрут (http:// или https://).\nДля отмены напишите /admin_cancel`,
      );
    } catch (e) {
      await adapter.reply(ctx, `Ошибка при получении локации: ${e.message || e}`);
    }
  };

  const startScheduleView = async (ctx) => {
    ctx.session.scheduleAction = { type: "view", step: "date" };
    await adapter.reply(
      ctx,
      "Укажите дату в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД для просмотра расписания:",
    );
  };

  const startScheduleEdit = async (ctx) => {
    ctx.session.scheduleAction = { type: "edit", step: "date" };
    await adapter.reply(
      ctx,
      "Укажите дату в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД для изменения/добавления расписания:",
    );
  };

  const startScheduleDelete = async (ctx) => {
    ctx.session.scheduleAction = { type: "delete", step: "date" };
    await adapter.reply(
      ctx,
      "Укажите дату в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД для удаления расписания:",
    );
  };

  const showAllSchedule = async (ctx) => {
    try {
      const rows = (await sheetsService.getWorkHoursRaw()) || [];
      const nonEmpty = rows.filter(
        (r) => (r.date || r.rawDate || "").trim() || (r.weekday || "").trim(),
      );

      if (!nonEmpty.length) {
        await adapter.reply(ctx, "Расписание пусто в окне из 50 строк.", {
          attachments: [buildScheduleMenuKeyboard()],
        });
        return;
      }

      const lines = nonEmpty.map((r, idx) => {
        const label =
          (r.date || r.rawDate || "").trim() || `шаблон: ${r.weekday}`;
        const base = `#${idx + 1}. ${label}`;
        const work = r.start && r.end ? ` ${r.start}–${r.end}` : "";
        const lunch =
          r.lunchStart && r.lunchEnd
            ? `, обед ${r.lunchStart}–${r.lunchEnd}`
            : "";
        return base + work + lunch;
      });

      await adapter.reply(
        ctx,
        'Текущее окно расписания (первые 50 строк листа "Расписание"):\n\n' +
          lines.join("\n"),
        { attachments: [buildScheduleMenuKeyboard()] },
      );
      await adapter.reply(
        ctx,
        'Чтобы отредактировать конкретную дату, используйте пункт "Изменить/добавить расписание на дату" и укажите нужную дату.',
      );
    } catch (e) {
      await adapter.reply(ctx, `Ошибка при получении расписания: ${e.message || e}`, {
        attachments: [buildScheduleMenuKeyboard()],
      });
    }
  };

  const startScheduleWeekday = async (ctx) => {
    try {
      const rows = (await sheetsService.getWorkHoursRaw()) || [];
      const templates = rows.filter((r) => !r.date && (r.weekday || "").trim());

      if (!templates.length) {
        await adapter.reply(
          ctx,
          "Шаблоны по дням недели ещё не заданы. Можно настроить их, ответив на вопросы ниже.",
        );
      } else {
        const lines = templates.map((r) => {
          const work =
            r.start && r.end ? ` ${r.start}–${r.end}` : " (время не задано)";
          const lunch =
            r.lunchStart && r.lunchEnd
              ? `, обед ${r.lunchStart}–${r.lunchEnd}`
              : "";
          return `${r.weekday}${work}${lunch}`;
        });
        await adapter.reply(
          ctx,
          "Текущие шаблоны по дням недели:\n\n" + lines.join("\n"),
        );
      }

      ctx.session.scheduleAction = { type: "weekday_edit", step: "weekday" };
      await adapter.reply(
        ctx,
        'Укажите день недели (например, Пн, Вт, Ср или mon/tue/...)\nили напишите "удалить Пн" чтобы удалить шаблон для Пн:',
      );
    } catch (e) {
      await adapter.reply(ctx, `Ошибка при получении шаблонов: ${e.message || e}`);
    }
  };

  const showServicesList = async (ctx) => {
    const services = servicesService.getAllServices();
    if (!services.length) {
      await adapter.reply(ctx, "Нет услуг в системе.", {
        attachments: [buildServicesMenuKeyboard()],
      });
      return;
    }
    const text = services
      .map(
        (s) =>
          `• ${s.name}\n  Ключ: ${s.key}\n  Цена: ${
            s.price !== null ? `${s.price} ₽` : "не указана"
          }\n  Продолжительность: ${s.durationMin} мин`,
      )
      .join("\n\n");
    await adapter.reply(ctx, `Список услуг:\n\n${text}`, {
      attachments: [buildServicesMenuKeyboard()],
    });
  };

  const startAddService = async (ctx) => {
    ctx.session.servicesAction = { type: "create", step: "key" };
    await adapter.reply(
      ctx,
      "Добавление новой услуги.\n\nОтправьте ключ услуги (латинские буквы, цифры, подчёркивания, например: NEW_SERVICE):\nДля отмены напишите /admin_cancel",
    );
  };

  const showEditServicePicker = async (ctx) => {
    const services = servicesService.getAllServices();
    if (!services.length) {
      await adapter.reply(ctx, "Нет услуг для изменения.", {
        attachments: [buildServicesMenuKeyboard()],
      });
      return;
    }
    const rows = services.map((s) => [
      Keyboard.button.callback(`${s.name} (${s.key})`, `service_edit:${s.key}`),
    ]);
    rows.push([Keyboard.button.callback("Отменить", "service_cancel")]);
    await adapter.reply(ctx, "Выберите услугу для изменения:", {
      attachments: [Keyboard.inlineKeyboard(rows)],
    });
  };

  const showDeleteServicePicker = async (ctx) => {
    const services = servicesService.getAllServices();
    if (!services.length) {
      await adapter.reply(ctx, "Нет услуг для удаления.", {
        attachments: [buildServicesMenuKeyboard()],
      });
      return;
    }
    const rows = services.map((s) => [
      Keyboard.button.callback(`${s.name} (${s.key})`, `service_delete:${s.key}`),
    ]);
    rows.push([Keyboard.button.callback("Отменить", "service_cancel")]);
    await adapter.reply(ctx, "Выберите услугу для удаления:", {
      attachments: [Keyboard.inlineKeyboard(rows)],
    });
  };

  const buildBroadcastRecipients = async () => {
    const clientsForBroadcast = sheetsService.getClientsForBroadcast
      ? await sheetsService.getClientsForBroadcast()
      : await sheetsService.getAllClients();
    const bans = await adminService.getBans();
    return clientsForBroadcast
      .filter((c) => c && c.telegramId)
      .map((c) => String(c.telegramId))
      .filter((id) => id && !bans.some((b) => String(b) === String(id)));
  };

  const showBroadcastPreview = async (ctx, payload, originalText) => {
    const recipients = await buildBroadcastRecipients();

    if (!recipients.length) {
      await adapter.reply(
        ctx,
        "Нет получателей для рассылки (нет клиентов с telegramId или все в бане).",
        { attachments: [buildMainMenuKeyboard()] },
      );
      delete ctx.session.adminAction;
      return;
    }

    const allClients = await sheetsService.getAllClients();
    const allClientsWithTelegram = allClients.filter(
      (c) => c && c.telegramId,
    ).length;
    const recipientsToSend = recipients.slice(0, MAX_BROADCAST_RECIPIENTS);
    const waitingCount = Math.max(
      0,
      allClientsWithTelegram - recipients.length,
    );

    ctx.session.adminAction = {
      type: "broadcast",
      payload,
      recipients: recipientsToSend,
    };

    let previewMessage = "";
    if (payload.kind === "text") {
      previewMessage = `Предпросмотр рассылки:\n\nТекст:\n${originalText || payload.text}\n\n`;
    } else {
      previewMessage =
        "Предпросмотр фото-письма. Подпись:" +
        (payload.caption ? `\n${payload.caption}` : " (без подписи)") +
        "\n\n";
    }

    previewMessage += `📤 Будет отправлено сегодня: ${recipientsToSend.length} из ${MAX_BROADCAST_RECIPIENTS}\n`;
    if (waitingCount > 0) {
      previewMessage += `⏳ Заблокированных пользователей: ${waitingCount}\n`;
    }
    if (recipients.length > MAX_BROADCAST_RECIPIENTS) {
      previewMessage += `⚠️ Всего доступно: ${recipients.length}. Будет отправлено ${MAX_BROADCAST_RECIPIENTS}, остальные получат рассылку завтра.\n`;
    }

    if (payload.kind === "photo" && payload.fileId) {
      await adapter.sendPhoto(getUserId(ctx), payload.fileId, payload.caption || " ");
    }

    await adapter.reply(ctx, previewMessage, {
      attachments: [buildBroadcastConfirmKeyboard()],
    });
  };

  const handleBroadcastConfirm = async (ctx) => {
    const act = ctx.session?.adminAction;
    if (!act || act.type !== "broadcast" || !act.recipients) {
      await adapter.reply(ctx, "Нет ожидаемой рассылки.", {
        attachments: [buildMainMenuKeyboard()],
      });
      return;
    }

    const recipients = act.recipients || [];
    if (!recipients.length) {
      await adapter.reply(ctx, "Нет получателей для рассылки.", {
        attachments: [buildMainMenuKeyboard()],
      });
      delete ctx.session.adminAction;
      return;
    }

    await adapter.reply(ctx, `Запускаю рассылку на ${recipients.length} клиентов...`);
    const results = await adminService.broadcastToClients(
      bot,
      sheetsService,
      act.payload || act.message,
      { recipients, throttleMs: 750, skipBanned: true },
    );
    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;

    logCriticalAction(
      getUserId(ctx),
      "admin_broadcast",
      {
        recipientsCount: recipients.length,
        sentCount: ok,
        failedCount: fail,
        payloadKind: act.payload?.kind || "text",
      },
      ok > 0 ? "success" : "failed",
    );

    await adapter.reply(
      ctx,
      `Рассылка завершена. Отправлено: ${ok}. Ошибок: ${fail}.`,
      { attachments: [buildMainMenuKeyboard()] },
    );
    delete ctx.session.adminAction;
  };

  const handleBroadcastCancel = async (ctx) => {
    delete ctx.session.adminAction;
    await adapter.reply(ctx, "Рассылка отменена.", {
      attachments: [buildMainMenuKeyboard()],
    });
  };

  const handleRevenueCallback = async (ctx, period) => {
    if (period === "back") {
      await showMainMenu(ctx);
      return;
    }

    try {
      const timezone = await sheetsService.getTimezone();
      let startDate = null;
      let endDate = null;
      let periodLabel = "";
      const now = dayjs().tz(timezone);

      switch (period) {
        case "today":
          startDate = now.startOf("day").format("YYYY-MM-DD");
          endDate = now.endOf("day").format("YYYY-MM-DD");
          periodLabel = formatDate(startDate);
          break;
        case "yesterday": {
          const yesterday = now.subtract(1, "day");
          startDate = yesterday.startOf("day").format("YYYY-MM-DD");
          endDate = yesterday.endOf("day").format("YYYY-MM-DD");
          periodLabel = formatDate(startDate);
          break;
        }
        case "this_week": {
          const monday = now.startOf("week").add(1, "day");
          startDate = monday.format("YYYY-MM-DD");
          endDate = now.format("YYYY-MM-DD");
          periodLabel = `с ${formatDate(startDate)} по ${formatDate(endDate)}`;
          break;
        }
        case "last_week": {
          const lastMonday = now
            .subtract(1, "week")
            .startOf("week")
            .add(1, "day");
          const lastSunday = lastMonday.add(6, "day");
          startDate = lastMonday.format("YYYY-MM-DD");
          endDate = lastSunday.format("YYYY-MM-DD");
          periodLabel = `с ${formatDate(startDate)} по ${formatDate(endDate)}`;
          break;
        }
        case "this_month":
          startDate = now.startOf("month").format("YYYY-MM-DD");
          endDate = now.format("YYYY-MM-DD");
          periodLabel = `${now.format("MMMM YYYY")} (по ${formatDate(endDate)})`;
          break;
        case "last_month": {
          const lastMonth = now.subtract(1, "month");
          startDate = lastMonth.startOf("month").format("YYYY-MM-DD");
          endDate = lastMonth.endOf("month").format("YYYY-MM-DD");
          periodLabel = lastMonth.format("MMMM YYYY");
          break;
        }
        case "by_services":
          startDate = null;
          endDate = null;
          periodLabel = "все время";
          break;
        default:
          await adapter.reply(ctx, "Неизвестный период.", {
            attachments: [buildRevenueMenuKeyboard()],
          });
          return;
      }

      const appointments = await sheetsService.getCompletedAppointments({
        startDate,
        endDate,
      });

      let extraMetrics = null;
      if (startDate || endDate) {
        const [cancelledAppointments, newClientsCount] = await Promise.all([
          sheetsService.getCancelledAppointmentsInPeriod({ startDate, endDate }),
          sheetsService.getNewClientsCountInPeriod({ startDate, endDate }),
        ]);
        extraMetrics = {
          newClientsCount,
          cancelledCount: cancelledAppointments.length,
        };
      }

      const stats = revenueStats.calculateRevenueStats(appointments);
      const formatted = revenueStats.formatRevenueStats(
        stats,
        periodLabel,
        extraMetrics,
      );

      await adapter.reply(ctx, formatted, {
        attachments: [buildRevenueMenuKeyboard()],
      });
    } catch (error) {
      console.error("Ошибка при получении статистики доходов:", error);
      await adapter.reply(
        ctx,
        `Ошибка при получении статистики: ${
          error.message || "Неизвестная ошибка"
        }`,
        { attachments: [buildRevenueMenuKeyboard()] },
      );
    }
  };

  const handleAdminCallback = async (ctx, action) => {
    await adapter.answerCallback(ctx);

    switch (action) {
      case "bookings":
        await showAllBookings(ctx);
        break;
      case "stats":
        await showStats(ctx);
        break;
      case "cancel_code":
        await startCancelByCode(ctx);
        break;
      case "broadcast":
        await startBroadcast(ctx);
        break;
      case "broadcast_status":
        await showBroadcastStatus(ctx);
        break;
      case "revenue":
        await showRevenueMenu(ctx);
        break;
      case "broadcast_confirm":
        await handleBroadcastConfirm(ctx);
        break;
      case "broadcast_cancel":
        await handleBroadcastCancel(ctx);
        break;
      case "settings":
        await showSettingsMenu(ctx);
        break;
      case "schedule_menu":
        await showScheduleMenu(ctx);
        break;
      case "schedule_view":
        await startScheduleView(ctx);
        break;
      case "schedule_edit":
        await startScheduleEdit(ctx);
        break;
      case "schedule_delete":
        await startScheduleDelete(ctx);
        break;
      case "schedule_all":
        await showAllSchedule(ctx);
        break;
      case "schedule_weekday":
        await startScheduleWeekday(ctx);
        break;
      case "main_menu":
        await showMainMenu(ctx);
        break;
      case "services_menu":
        await showServicesMenu(ctx);
        break;
      case "services_back":
        if (ctx.session?.fromSettings) {
          delete ctx.session.servicesAction;
          await showSettingsMenu(ctx);
        } else {
          await showMainMenu(ctx);
        }
        break;
      case "services_list":
        await showServicesList(ctx);
        break;
      case "services_add":
        await startAddService(ctx);
        break;
      case "services_edit":
        await showEditServicePicker(ctx);
        break;
      case "services_delete":
        await showDeleteServicePicker(ctx);
        break;
      case "ban":
        await startBan(ctx);
        break;
      case "unban":
        await startUnban(ctx);
        break;
      case "reminder_28":
        await startReminder28(ctx);
        break;
      case "tips_link":
        await startTipsLink(ctx);
        break;
      case "contacts":
        await startEditContacts(ctx);
        break;
      case "portfolio_upload":
        await startPortfolioUpload(ctx);
        break;
      case "portfolio_delete":
        await startPortfolioDelete(ctx);
        break;
      case "save_location":
        await startSaveLocation(ctx);
        break;
      case "user_mode":
        clearAdminScenario(ctx);
        await showUserMainMenu(
          ctx,
          "Режим пользователя.\n\n👇 Выберите действие с помощью кнопок ниже:",
        );
        break;
      default:
        break;
    }
  };

  const handleServiceEditCallback = async (ctx, key) => {
    await adapter.answerCallback(ctx);
    const service = servicesService.getServiceByKey(key);
    if (!service) {
      await adapter.reply(ctx, "Услуга не найдена.", {
        attachments: [buildServicesMenuKeyboard()],
      });
      return;
    }
    ctx.session.servicesAction = {
      type: "update",
      key,
      step: "field",
    };
    const rows = [
      [Keyboard.button.callback("Название", "service_field:name")],
      [Keyboard.button.callback("Цена", "service_field:price")],
      [
        Keyboard.button.callback(
          "Продолжительность",
          "service_field:durationMin",
        ),
      ],
      [Keyboard.button.callback("Отменить", "service_cancel")],
    ];
    await adapter.reply(
      ctx,
      `Редактирование услуги: ${service.name}\n\nТекущие значения:\nНазвание: ${
        service.name
      }\nЦена: ${
        service.price !== null ? `${service.price} ₽` : "не указана"
      }\nПродолжительность: ${
        service.durationMin
      } мин\n\nВыберите поле для изменения:`,
      { attachments: [Keyboard.inlineKeyboard(rows)] },
    );
  };

  const handleServiceFieldCallback = async (ctx, field) => {
    await adapter.answerCallback(ctx);
    const servicesAction = ctx.session?.servicesAction;
    if (!servicesAction || servicesAction.type !== "update") {
      clearAdminScenario(ctx);
      await showMainMenu(ctx, "Сессия истекла. Начните заново.");
      return;
    }
    servicesAction.step = field;
    const fieldNames = {
      name: "название",
      price: "цену (число или 'удалить' для очистки)",
      durationMin: "продолжительность в минутах",
    };
    await adapter.reply(
      ctx,
      `Отправьте новое значение для поля "${fieldNames[field]}":\nДля отмены напишите /admin_cancel`,
    );
  };

  const handleServiceDeleteCallback = async (ctx, key) => {
    await adapter.answerCallback(ctx);
    const service = servicesService.getServiceByKey(key);
    if (!service) {
      await adapter.reply(ctx, "Услуга не найдена.", {
        attachments: [buildServicesMenuKeyboard()],
      });
      return;
    }
    const result = servicesService.deleteService(key);
    if (result.ok) {
      await adapter.reply(ctx, `Услуга "${service.name}" удалена.`, {
        attachments: [buildServicesMenuKeyboard()],
      });
    } else {
      await adapter.reply(ctx, `Ошибка: ${result.error}`, {
        attachments: [buildServicesMenuKeyboard()],
      });
    }
  };

  const processScheduleActionText = async (ctx, text) => {
    const scheduleAction = ctx.session?.scheduleAction;
    if (!scheduleAction) return false;

    if (scheduleAction.step === "date") {
      const input = (text || "").trim();
      if (!input) {
        await adapter.reply(
          ctx,
          "Дата не может быть пустой. Укажите дату в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД:",
        );
        return true;
      }

      scheduleAction.dateInput = input;
      const isoDate = toIsoDate(input);

      if (scheduleAction.type === "view") {
        try {
          const workHours = await sheetsService.getWorkHoursForDate(isoDate);
          if (!workHours || !workHours.start || !workHours.end) {
            await adapter.reply(ctx, "На эту дату расписание не задано (выходной).", {
              attachments: [buildScheduleMenuKeyboard()],
            });
          } else {
            const infoLines = [
              `Расписание на ${input}:`,
              `Рабочее время: ${workHours.start}–${workHours.end}`,
            ];
            if (workHours.lunchStart && workHours.lunchEnd) {
              infoLines.push(
                `Обед: ${workHours.lunchStart}–${workHours.lunchEnd}`,
              );
            }
            await adapter.reply(ctx, infoLines.join("\n"), {
              attachments: [buildScheduleMenuKeyboard()],
            });
          }
        } catch (e) {
          await adapter.reply(ctx, `Ошибка при получении расписания: ${e.message || e}`);
        }
        delete ctx.session.scheduleAction;
        return true;
      }

      if (scheduleAction.type === "edit") {
        scheduleAction.step = "start";
        await adapter.reply(
          ctx,
          `Укажите время начала рабочего дня для ${input} в формате HH:MM (например, 10:00):`,
        );
        return true;
      }

      if (scheduleAction.type === "delete") {
        try {
          await sheetsService.deleteWorkHoursForDate(isoDate);
          await adapter.reply(
            ctx,
            `Расписание на дату ${input} удалено (если было задано).`,
            { attachments: [buildScheduleMenuKeyboard()] },
          );
        } catch (e) {
          await adapter.reply(ctx, `Ошибка при удалении расписания: ${e.message || e}`);
        }
        delete ctx.session.scheduleAction;
        return true;
      }
    }

    if (scheduleAction.type === "edit") {
      const dateInput = scheduleAction.dateInput;
      if (!dateInput) {
        delete ctx.session.scheduleAction;
        await adapter.reply(ctx, "Сессия настройки расписания истекла. Начните заново.", {
          attachments: [buildScheduleMenuKeyboard()],
        });
        return true;
      }

      if (scheduleAction.step === "start") {
        if (!/^\d{2}:\d{2}$/.test(text || "")) {
          await adapter.reply(
            ctx,
            "Некорректный формат времени. Укажите время в формате HH:MM (например, 10:00):",
          );
          return true;
        }
        scheduleAction.start = text;
        scheduleAction.step = "end";
        await adapter.reply(
          ctx,
          "Укажите время окончания рабочего дня в формате HH:MM (например, 20:00):",
        );
        return true;
      }

      if (scheduleAction.step === "end") {
        if (!/^\d{2}:\d{2}$/.test(text || "")) {
          await adapter.reply(
            ctx,
            "Некорректный формат времени. Укажите время в формате HH:MM (например, 20:00):",
          );
          return true;
        }
        scheduleAction.end = text;
        scheduleAction.step = "lunch_start";
        await adapter.reply(
          ctx,
          'Укажите время начала обеда в формате HH:MM или "-" если без обеда:',
        );
        return true;
      }

      if (scheduleAction.step === "lunch_start") {
        let lunchStart = "";
        if (text && text.trim() !== "-") {
          if (!/^\d{2}:\d{2}$/.test(text || "")) {
            await adapter.reply(
              ctx,
              'Некорректный формат времени. Укажите время в формате HH:MM или "-" если без обеда:',
            );
            return true;
          }
          lunchStart = text;
        }
        scheduleAction.lunchStart = lunchStart;
        if (lunchStart) {
          scheduleAction.step = "lunch_end";
          await adapter.reply(
            ctx,
            "Укажите время окончания обеда в формате HH:MM (должно быть позже начала обеда):",
          );
        } else {
          scheduleAction.step = "confirm";
          await adapter.reply(
            ctx,
            'Обед будет отсутствовать. Подтвердите сохранение: напишите "Да" или "Нет".',
          );
        }
        return true;
      }

      if (scheduleAction.step === "lunch_end") {
        const lunchStart = scheduleAction.lunchStart;
        let lunchEnd = "";
        if (text && text.trim() !== "-") {
          if (!/^\d{2}:\d{2}$/.test(text || "")) {
            await adapter.reply(
              ctx,
              "Некорректный формат времени. Укажите время окончания обеда в формате HH:MM:",
            );
            return true;
          }
          lunchEnd = text;
        }
        scheduleAction.lunchEnd = lunchEnd;
        scheduleAction.step = "confirm";

        const summary = [
          `Расписание на ${dateInput}:`,
          `Рабочее время: ${scheduleAction.start}–${scheduleAction.end}`,
          lunchStart && lunchEnd
            ? `Обед: ${lunchStart}–${lunchEnd}`
            : "Обед: нет",
          "",
          'Подтвердите сохранение: напишите "Да" или "Нет".',
        ].join("\n");
        await adapter.reply(ctx, summary);
        return true;
      }

      if (scheduleAction.step === "confirm") {
        const answer = (text || "").trim().toLowerCase();
        if (answer !== "да" && answer !== "нет") {
          await adapter.reply(ctx, 'Ответьте "Да" для сохранения или "Нет" для отмены.');
          return true;
        }
        if (answer === "нет") {
          delete ctx.session.scheduleAction;
          await adapter.reply(ctx, "Изменение расписания отменено.", {
            attachments: [buildScheduleMenuKeyboard()],
          });
          return true;
        }

        try {
          await sheetsService.setWorkHoursForDate(scheduleAction.dateInput, {
            start: scheduleAction.start,
            end: scheduleAction.end,
            lunchStart: scheduleAction.lunchStart,
            lunchEnd: scheduleAction.lunchEnd,
          });
          await adapter.reply(
            ctx,
            `Расписание на дату ${scheduleAction.dateInput} сохранено.`,
            { attachments: [buildScheduleMenuKeyboard()] },
          );
        } catch (e) {
          await adapter.reply(ctx, `Ошибка при сохранении расписания: ${e.message || e}`);
        }
        delete ctx.session.scheduleAction;
        return true;
      }
    }

    if (scheduleAction.type === "weekday_edit") {
      if (scheduleAction.step === "weekday") {
        if (!text) {
          await adapter.reply(
            ctx,
            'Укажите день недели (например, Пн, Вт, Ср или mon/tue/...) или "удалить Пн":',
          );
          return true;
        }

        const lower = text.toLowerCase();
        if (lower.startsWith("удалить")) {
          const parts = text.split(/\s+/);
          const dayToken = parts[1];
          if (!dayToken) {
            await adapter.reply(ctx, 'Укажите день для удаления, например: "удалить Пн".');
            return true;
          }
          try {
            await sheetsService.deleteWeekdayTemplate(dayToken);
            await adapter.reply(
              ctx,
              `Шаблон для дня "${dayToken}" удалён (если существовал).`,
              { attachments: [buildScheduleMenuKeyboard()] },
            );
          } catch (e) {
            await adapter.reply(ctx, `Ошибка при удалении шаблона: ${e.message || e}`);
          }
          delete ctx.session.scheduleAction;
          return true;
        }

        scheduleAction.weekdayKey = text;
        scheduleAction.step = "weekday_start";
        await adapter.reply(
          ctx,
          `Укажите время начала рабочего дня для шаблона "${text}" в формате HH:MM:`,
        );
        return true;
      }

      if (scheduleAction.step === "weekday_start") {
        if (!/^\d{2}:\d{2}$/.test(text || "")) {
          await adapter.reply(
            ctx,
            "Некорректный формат времени. Укажите время в формате HH:MM:",
          );
          return true;
        }
        scheduleAction.start = text;
        scheduleAction.step = "weekday_end";
        await adapter.reply(
          ctx,
          "Укажите время окончания рабочего дня в формате HH:MM:",
        );
        return true;
      }

      if (scheduleAction.step === "weekday_end") {
        if (!/^\d{2}:\d{2}$/.test(text || "")) {
          await adapter.reply(
            ctx,
            "Некорректный формат времени. Укажите время в формате HH:MM:",
          );
          return true;
        }
        scheduleAction.end = text;
        scheduleAction.step = "weekday_lunch_start";
        await adapter.reply(
          ctx,
          'Укажите время начала обеда в формате HH:MM или "-" если без обеда:',
        );
        return true;
      }

      if (scheduleAction.step === "weekday_lunch_start") {
        let lunchStart = "";
        if (text && text.trim() !== "-") {
          if (!/^\d{2}:\d{2}$/.test(text || "")) {
            await adapter.reply(
              ctx,
              'Некорректный формат времени. Укажите время в формате HH:MM или "-" если без обеда:',
            );
            return true;
          }
          lunchStart = text;
        }
        scheduleAction.lunchStart = lunchStart;

        if (!lunchStart) {
          scheduleAction.lunchEnd = "";
          scheduleAction.step = "weekday_confirm";
          const d = scheduleAction.weekdayKey;
          const summary = [
            `Шаблон для дня "${d}":`,
            `Рабочее время: ${scheduleAction.start}–${scheduleAction.end}`,
            "Обед: нет",
            "",
            'Подтвердите сохранение шаблона: напишите "Да" или "Нет".',
          ].join("\n");
          await adapter.reply(ctx, summary);
          return true;
        }

        scheduleAction.step = "weekday_lunch_end";
        await adapter.reply(
          ctx,
          "Укажите время окончания обеда в формате HH:MM (должно быть позже начала обеда):",
        );
        return true;
      }

      if (scheduleAction.step === "weekday_lunch_end") {
        if (!/^\d{2}:\d{2}$/.test(text || "")) {
          await adapter.reply(
            ctx,
            "Некорректный формат времени. Укажите время окончания обеда в формате HH:MM:",
          );
          return true;
        }
        scheduleAction.lunchEnd = text;
        scheduleAction.step = "weekday_confirm";

        const d = scheduleAction.weekdayKey;
        const summary = [
          `Шаблон для дня "${d}":`,
          `Рабочее время: ${scheduleAction.start}–${scheduleAction.end}`,
          `Обед: ${scheduleAction.lunchStart}–${scheduleAction.lunchEnd}`,
          "",
          'Подтвердите сохранение шаблона: напишите "Да" или "Нет".',
        ].join("\n");
        await adapter.reply(ctx, summary);
        return true;
      }

      if (scheduleAction.step === "weekday_confirm") {
        const answer = (text || "").trim().toLowerCase();
        if (answer !== "да" && answer !== "нет") {
          await adapter.reply(ctx, 'Ответьте "Да" для сохранения или "Нет" для отмены.');
          return true;
        }
        if (answer === "нет") {
          delete ctx.session.scheduleAction;
          await adapter.reply(ctx, "Изменение шаблона отменено.", {
            attachments: [buildScheduleMenuKeyboard()],
          });
          return true;
        }

        try {
          await sheetsService.setWeekdayTemplate(scheduleAction.weekdayKey, {
            start: scheduleAction.start,
            end: scheduleAction.end,
            lunchStart: scheduleAction.lunchStart,
            lunchEnd: scheduleAction.lunchEnd,
          });
          await adapter.reply(
            ctx,
            `Шаблон для дня "${scheduleAction.weekdayKey}" сохранён.`,
            { attachments: [buildScheduleMenuKeyboard()] },
          );
        } catch (e) {
          await adapter.reply(ctx, `Ошибка при сохранении шаблона: ${e.message || e}`);
        }
        delete ctx.session.scheduleAction;
        return true;
      }
    }

    return false;
  };

  const processServicesActionText = async (ctx, text) => {
    const servicesAction = ctx.session?.servicesAction;
    if (!servicesAction) return false;

    if (servicesAction.type === "create") {
      if (servicesAction.step === "key") {
        const key = text.toUpperCase();
        if (servicesService.getServiceByKey(key)) {
          await adapter.reply(
            ctx,
            "Услуга с таким ключом уже существует. Попробуйте другой ключ или /admin_cancel для отмены.",
          );
          return true;
        }
        if (!/^[A-Za-z0-9_]+$/.test(key)) {
          await adapter.reply(
            ctx,
            "Ключ должен содержать только латинские буквы, цифры и подчёркивания. Попробуйте снова или /admin_cancel для отмены.",
          );
          return true;
        }
        ctx.session.servicesAction = { type: "create", step: "name", key };
        await adapter.reply(ctx, "Отправьте название услуги:");
        return true;
      }
      if (servicesAction.step === "name") {
        if (!text) {
          await adapter.reply(
            ctx,
            "Название не может быть пустым. Попробуйте снова или /admin_cancel для отмены.",
          );
          return true;
        }
        ctx.session.servicesAction = {
          type: "create",
          step: "price",
          key: servicesAction.key,
          name: text,
        };
        await adapter.reply(
          ctx,
          "Отправьте цену услуги (число в рублях) или 'нет' если цена не указана:",
        );
        return true;
      }
      if (servicesAction.step === "price") {
        let price = null;
        if (text.toLowerCase() !== "нет" && text !== "") {
          const priceNum = Number(text);
          if (Number.isNaN(priceNum) || priceNum < 0) {
            await adapter.reply(
              ctx,
              "Цена должна быть неотрицательным числом или 'нет'. Попробуйте снова или /admin_cancel для отмены.",
            );
            return true;
          }
          price = priceNum;
        }
        ctx.session.servicesAction = {
          type: "create",
          step: "duration",
          key: servicesAction.key,
          name: servicesAction.name,
          price,
        };
        await adapter.reply(ctx, "Отправьте продолжительность услуги в минутах:");
        return true;
      }
      if (servicesAction.step === "duration") {
        const durationNum = Number(text);
        if (Number.isNaN(durationNum) || durationNum <= 0) {
          await adapter.reply(
            ctx,
            "Продолжительность должна быть положительным числом. Попробуйте снова или /admin_cancel для отмены.",
          );
          return true;
        }
        const result = servicesService.createService({
          key: servicesAction.key,
          name: servicesAction.name,
          price: servicesAction.price,
          durationMin: durationNum,
        });
        delete ctx.session.servicesAction;
        if (result.ok) {
          await adapter.reply(
            ctx,
            `Услуга "${result.service.name}" успешно создана!\nКлюч: ${
              result.service.key
            }\nЦена: ${
              result.service.price !== null
                ? `${result.service.price} ₽`
                : "не указана"
            }\nПродолжительность: ${result.service.durationMin} мин`,
            { attachments: [buildServicesMenuKeyboard()] },
          );
        } else {
          await adapter.reply(ctx, `Ошибка при создании услуги: ${result.error}`, {
            attachments: [buildServicesMenuKeyboard()],
          });
        }
        return true;
      }
    }

    if (servicesAction.type === "update") {
      const field = servicesAction.step;
      if (field === "name") {
        if (!text) {
          await adapter.reply(
            ctx,
            "Название не может быть пустым. Попробуйте снова или /admin_cancel для отмены.",
          );
          return true;
        }
        const result = servicesService.updateService(servicesAction.key, {
          name: text,
        });
        delete ctx.session.servicesAction;
        await adapter.reply(
          ctx,
          result.ok
            ? `Название услуги обновлено: "${result.service.name}"`
            : `Ошибка: ${result.error}`,
          { attachments: [buildServicesMenuKeyboard()] },
        );
        return true;
      }
      if (field === "price") {
        let price = null;
        if (
          text.toLowerCase() !== "удалить" &&
          text.toLowerCase() !== "нет" &&
          text !== ""
        ) {
          const priceNum = Number(text);
          if (Number.isNaN(priceNum) || priceNum < 0) {
            await adapter.reply(
              ctx,
              "Цена должна быть неотрицательным числом, 'удалить' или 'нет'. Попробуйте снова или /admin_cancel для отмены.",
            );
            return true;
          }
          price = priceNum;
        }
        const result = servicesService.updateService(servicesAction.key, {
          price,
        });
        delete ctx.session.servicesAction;
        await adapter.reply(
          ctx,
          result.ok
            ? `Цена услуги обновлена: ${
                result.service.price !== null
                  ? `${result.service.price} ₽`
                  : "не указана"
              }`
            : `Ошибка: ${result.error}`,
          { attachments: [buildServicesMenuKeyboard()] },
        );
        return true;
      }
      if (field === "durationMin") {
        const durationNum = Number(text);
        if (Number.isNaN(durationNum) || durationNum <= 0) {
          await adapter.reply(
            ctx,
            "Продолжительность должна быть положительным числом. Попробуйте снова или /admin_cancel для отмены.",
          );
          return true;
        }
        const result = servicesService.updateService(servicesAction.key, {
          durationMin: durationNum,
        });
        delete ctx.session.servicesAction;
        await adapter.reply(
          ctx,
          result.ok
            ? `Продолжительность услуги обновлена: ${result.service.durationMin} мин`
            : `Ошибка: ${result.error}`,
          { attachments: [buildServicesMenuKeyboard()] },
        );
        return true;
      }
    }

    return false;
  };

  const processAdminActionText = async (ctx, text) => {
    const action = ctx.session?.adminAction?.type;
    if (!action) return false;

    const userId = getUserId(ctx);

    if (action === "cancel_booking_by_code") {
      const cancelCode = text.toUpperCase();
      if (!cancelCode || cancelCode.length !== 6 || !/^[A-Z0-9]+$/.test(cancelCode)) {
        await adapter.reply(
          ctx,
          "Неверный формат кода отмены. Код должен состоять из 6 символов (буквы и цифры). /admin_cancel для отмены.",
        );
        return true;
      }

      const result = await bookingService.cancelAppointmentByCode(cancelCode);

      if (!result.ok) {
        if (result.reason === "appointment_not_found") {
          await adapter.reply(
            ctx,
            "Запись с таким кодом отмены не найдена. /admin_cancel для отмены.",
          );
        } else if (result.reason === "already_cancelled") {
          await adapter.reply(ctx, "Эта запись уже отменена. /admin_cancel для отмены.");
        } else {
          await adapter.reply(
            ctx,
            "Не удалось отменить запись. /admin_cancel для отмены.",
          );
        }
        logAdminAction(
          userId,
          "admin_cancel_booking_by_code",
          { cancelCode, reason: result.reason },
          "failed",
        );
      } else {
        const appointment = result.appointment;
        await adapter.reply(
          ctx,
          `Запись отменена по коду ${cancelCode}.\n` +
            `ID: ${appointment.id}\n` +
            `Клиент: ${appointment.clientName}\n` +
            `Дата: ${formatDate(appointment.date)} ${appointment.timeStart}`,
          { attachments: [buildMainMenuKeyboard()] },
        );
        logCriticalAction(
          userId,
          "admin_cancel_booking_by_code",
          {
            appointmentId: appointment.id,
            cancelCode,
            clientTelegramId: appointment.telegramId,
            date: appointment.date,
            time: appointment.timeStart,
          },
          "success",
        );
        if (appointment.telegramId) {
          await safeSendMessage(
            adapter,
            String(appointment.telegramId),
            `Ваша запись на ${formatDate(appointment.date)} ${
              appointment.timeStart
            } отменена менеджером.`,
          );
        }
      }
      delete ctx.session.adminAction;
      return true;
    }

    if (action === "ban") {
      let telegramId = null;
      if (text.startsWith("@")) {
        const clients = await sheetsService.getAllClients();
        const found = clients.find(
          (c) => c.username && `@${c.username}` === text,
        );
        if (found) telegramId = found.telegramId;
      } else {
        telegramId = text;
      }

      if (!telegramId || !validateTelegramId(telegramId)) {
        await adapter.reply(
          ctx,
          "Неверный формат Telegram ID. /admin_cancel для отмены.",
        );
        return true;
      }

      await adminService.banUser(telegramId, "", sheetsService);
      logCriticalAction(
        userId,
        "admin_ban_user",
        { bannedUserId: telegramId, target: text },
        "success",
      );
      await adapter.reply(ctx, `Пользователь ${telegramId} забанен.`, {
        attachments: [buildSettingsMenuKeyboard()],
      });
      delete ctx.session.adminAction;
      return true;
    }

    if (action === "unban") {
      const telegramId = text;
      if (!telegramId || !validateTelegramId(telegramId)) {
        await adapter.reply(
          ctx,
          "Неверный формат Telegram ID. /admin_cancel для отмены.",
        );
        return true;
      }

      await adminService.unbanUser(telegramId, sheetsService);
      logCriticalAction(
        userId,
        "admin_unban_user",
        { unbannedUserId: telegramId },
        "success",
      );
      await adapter.reply(ctx, `Пользователь ${telegramId} разбанен.`, {
        attachments: [buildSettingsMenuKeyboard()],
      });
      delete ctx.session.adminAction;
      return true;
    }

    if (action === "edit_28day_reminder") {
      if (!text || text.trim().length === 0) {
        await adapter.reply(ctx, "Текст не может быть пустым. /admin_cancel для отмены.");
        return true;
      }
      const sanitizedMessage = sanitizeText(text, 2000);
      if (sanitizedMessage.length === 0) {
        await adapter.reply(ctx, "Текст после очистки пуст. /admin_cancel для отмены.");
        return true;
      }
      try {
        await sheetsService.set28DayReminderMessage(sanitizedMessage);
        logAdminAction(
          userId,
          "admin_edit_28day_reminder",
          { messageLength: sanitizedMessage.length },
          "success",
        );
        await adapter.reply(
          ctx,
          `Текст напоминания через 28 дней успешно обновлен!\n\nНовый текст:\n${sanitizedMessage}`,
          { attachments: [buildSettingsMenuKeyboard()] },
        );
      } catch (err) {
        await adapter.reply(
          ctx,
          `Ошибка при сохранении текста: ${err.message}\n/admin_cancel для отмены.`,
        );
        await logError(userId, "admin_edit_28day_reminder", err, {});
        return true;
      }
      delete ctx.session.adminAction;
      return true;
    }

    if (action === "edit_tips_link") {
      const trimmedInput = text.trim();
      if (!trimmedInput) {
        await adapter.reply(ctx, "Данные не могут быть пустыми. /admin_cancel для отмены.");
        return true;
      }
      const isValidUrl =
        trimmedInput.startsWith("http://") ||
        trimmedInput.startsWith("https://") ||
        trimmedInput.startsWith("t.me/");
      const isPhoneNumber =
        /^[\d\s\-+()]+$/.test(trimmedInput) && trimmedInput.length >= 5;

      if (!isValidUrl && !isPhoneNumber) {
        await adapter.reply(
          ctx,
          "Укажите ссылку (http://, https://, t.me/) или номер телефона. /admin_cancel для отмены.",
        );
        return true;
      }

      try {
        await sheetsService.setTipsLink(trimmedInput);
        logAdminAction(
          userId,
          "admin_edit_tips_link",
          { isLink: isValidUrl, isPhone: isPhoneNumber },
          "success",
        );
        const typeText = isValidUrl ? "Ссылка" : "Номер телефона";
        await adapter.reply(
          ctx,
          `✅ ${typeText} для чаевых успешно обновлен!\n\n${trimmedInput}`,
          { attachments: [buildSettingsMenuKeyboard()] },
        );
      } catch (err) {
        await adapter.reply(
          ctx,
          `Ошибка при сохранении: ${err.message}\n/admin_cancel для отмены.`,
        );
        await logError(userId, "admin_edit_tips_link", err, {});
        return true;
      }
      delete ctx.session.adminAction;
      return true;
    }

    if (action === "edit_contacts") {
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        await adapter.reply(
          ctx,
          "Необходимо указать телефон и адрес в двух строках:\nПервая строка - телефон\nВторая строка - адрес\n\n/admin_cancel для отмены.",
        );
        return true;
      }

      const phone = lines[0];
      const address = lines.slice(1).join(" ");

      if (!phone?.trim()) {
        await adapter.reply(ctx, "Телефон не может быть пустым. /admin_cancel для отмены.");
        return true;
      }
      if (!address?.trim()) {
        await adapter.reply(ctx, "Адрес не может быть пустым. /admin_cancel для отмены.");
        return true;
      }

      try {
        await sheetsService.setBarberPhone(phone.trim());
        await sheetsService.setBarberAddress(address.trim());
        logAdminAction(
          userId,
          "admin_edit_contacts",
          {
            phoneLength: phone.trim().length,
            addressLength: address.trim().length,
          },
          "success",
        );
        await adapter.reply(
          ctx,
          `Контакты успешно обновлены!\n\n📞 Телефон: ${phone.trim()}\n📍 Адрес: ${address.trim()}`,
          { attachments: [buildSettingsMenuKeyboard()] },
        );
      } catch (err) {
        await adapter.reply(
          ctx,
          `Ошибка при сохранении контактов: ${err.message}\n/admin_cancel для отмены.`,
        );
        await logError(userId, "admin_edit_contacts", err, {});
        return true;
      }
      delete ctx.session.adminAction;
      return true;
    }

    if (action === "portfolio_delete") {
      const displayNumber = Number((text || "").trim());
      const ids = (await sheetsService.getPortfolioFileIds()) || [];
      const maxInStore = Math.min(6, ids.length);

      if (
        Number.isNaN(displayNumber) ||
        displayNumber < 1 ||
        displayNumber > maxInStore
      ) {
        await adapter.reply(
          ctx,
          `Некорректный номер. Введите число от 1 до ${maxInStore}.\nДля отмены напишите /admin_cancel`,
        );
        return true;
      }

      try {
        const ok = await sheetsService.deletePortfolioFileIdByIndex(
          displayNumber - 1,
        );
        if (!ok) {
          await adapter.reply(ctx, "Не удалось удалить фото. Попробуйте другой номер.");
          return true;
        }
        await adapter.reply(
          ctx,
          `✅ Фото №${displayNumber} удалено из портфолио.`,
          { attachments: [buildSettingsMenuKeyboard()] },
        );
        delete ctx.session.adminAction;
      } catch (e) {
        await adapter.reply(ctx, `Ошибка при удалении фото: ${e.message || e}`);
      }
      return true;
    }

    if (action === "save_location") {
      const trimmed = (text || "").trim();
      if (!trimmed) {
        await adapter.reply(ctx, "Ссылка не может быть пустой. /admin_cancel для отмены.");
        return true;
      }
      if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
        await adapter.reply(
          ctx,
          "Ссылка должна начинаться с http:// или https://. /admin_cancel для отмены.",
        );
        return true;
      }
      try {
        await sheetsService.setLocationLink(trimmed);
        await adapter.reply(ctx, "✅ Локация сохранена.", {
          attachments: [buildSettingsMenuKeyboard()],
        });
        delete ctx.session.adminAction;
      } catch (e) {
        await adapter.reply(ctx, `Ошибка при сохранении локации: ${e.message || e}`);
      }
      return true;
    }

    if (action === "broadcast") {
      if (!text) {
        await adapter.reply(ctx, "Текст пуст. /admin_cancel для отмены.");
        return true;
      }
      const sanitizedMessage = sanitizeText(text, 4000);
      if (sanitizedMessage.length === 0) {
        await adapter.reply(ctx, "Текст после очистки пуст. /admin_cancel для отмены.");
        return true;
      }
      await showBroadcastPreview(
        ctx,
        { kind: "text", text: sanitizedMessage },
        text,
      );
      return true;
    }

    return false;
  };

  const handleAdminImage = async (ctx) => {
    const action = ctx.session?.adminAction?.type;
    if (!action) return false;

    const imageRef = getMessageImageRef(ctx);
    if (!imageRef) return false;

    if (action === "portfolio_upload") {
      try {
        await sheetsService.addPortfolioFileId(imageRef);
        await adapter.reply(ctx, "✅ Фото добавлено в портфолио.", {
          attachments: [buildSettingsMenuKeyboard()],
        });
      } catch (e) {
        await adapter.reply(
          ctx,
          `Ошибка при сохранении фото в портфолио: ${e.message || e}`,
        );
      }
      delete ctx.session.adminAction;
      return true;
    }

    if (action === "broadcast") {
      const caption = getMessageCaption(ctx);
      await showBroadcastPreview(
        ctx,
        { kind: "photo", fileId: imageRef, caption },
        null,
      );
      return true;
    }

    return false;
  };

  const handleAdminText = async (ctx) => {
    const text = getMessageText(ctx);
    if (!text) return false;

    if (await processScheduleActionText(ctx, text)) {
      return true;
    }
    if (await processServicesActionText(ctx, text)) {
      return true;
    }
    if (await processAdminActionText(ctx, text)) {
      return true;
    }
    return false;
  };

  return {
    checkAdmin,
    replyNoAccess,
    showMainMenu,
    handleAdminCancel,
    handleAdminCallback,
    handleRevenueCallback,
    handleServiceEditCallback,
    handleServiceFieldCallback,
    handleServiceDeleteCallback,
    handleAdminText,
    handleAdminImage,
    clearAdminScenario,
  };
}

/**
 * @param {import('@maxhub/max-bot-api').Bot} bot
 * @param {import('../../adapters/maxAdapter').MaxAdapter} adapter
 * @param {object} sheetsService
 * @param {object} bookingService
 */
function registerAdminHandlers(bot, adapter, sheetsService, bookingService) {
  const h = createAdminHandlers(adapter, sheetsService, bookingService, bot);

  bot.command("admin", async (ctx) => {
    if (!h.checkAdmin(ctx)) {
      await h.replyNoAccess(ctx);
      return;
    }
    logAdminAction(getUserId(ctx), "admin_mode_enabled", {}, "success");
    await h.showMainMenu(ctx);
  });

  bot.command("admin_cancel", async (ctx) => {
    if (!h.checkAdmin(ctx)) {
      await h.replyNoAccess(ctx);
      return;
    }
    if (!isAdminMode(ctx)) {
      await adapter.reply(ctx, "Админ-режим не активен.");
      return;
    }
    await h.handleAdminCancel(ctx);
  });

  bot.action(/^admin:(.+)/, async (ctx) => {
    if (!h.checkAdmin(ctx)) return;
    if (!isAdminMode(ctx)) return;
    const action = ctx.update?.callback?.payload?.slice("admin:".length);
    if (!action) return;
    await h.handleAdminCallback(ctx, action);
  });

  bot.action(/^revenue:(.+)/, async (ctx) => {
    if (!h.checkAdmin(ctx) || !isAdminMode(ctx)) return;
    await adapter.answerCallback(ctx);
    const period = ctx.update?.callback?.payload?.slice("revenue:".length);
    if (!period) return;
    await h.handleRevenueCallback(ctx, period);
  });

  bot.action(/^service_edit:(.+)/, async (ctx) => {
    if (!h.checkAdmin(ctx) || !isAdminMode(ctx)) return;
    const key = ctx.update?.callback?.payload?.slice("service_edit:".length);
    if (!key) return;
    await h.handleServiceEditCallback(ctx, key);
  });

  bot.action(/^service_field:(.+)/, async (ctx) => {
    if (!h.checkAdmin(ctx) || !isAdminMode(ctx)) return;
    const field = ctx.update?.callback?.payload?.slice("service_field:".length);
    if (!field) return;
    await h.handleServiceFieldCallback(ctx, field);
  });

  bot.action(/^service_delete:(.+)/, async (ctx) => {
    if (!h.checkAdmin(ctx) || !isAdminMode(ctx)) return;
    const key = ctx.update?.callback?.payload?.slice("service_delete:".length);
    if (!key) return;
    await h.handleServiceDeleteCallback(ctx, key);
  });

  bot.action("service_cancel", async (ctx) => {
    if (!h.checkAdmin(ctx) || !isAdminMode(ctx)) return;
    await adapter.answerCallback(ctx);
    h.clearAdminScenario(ctx);
    await adapter.reply(ctx, "Отменено.", {
      attachments: [buildServicesMenuKeyboard()],
    });
  });

  bot.on("message_created", async (ctx, next) => {
    if (!h.checkAdmin(ctx) || !isAdminMode(ctx)) {
      return next();
    }
    if (isBookingActive(ctx)) {
      return next();
    }

    const text = getMessageText(ctx);
    if (text === "/admin_cancel" || text.startsWith("/admin_cancel ")) {
      await h.handleAdminCancel(ctx);
      return;
    }

    const hasScenario =
      ctx.session?.adminAction ||
      ctx.session?.servicesAction ||
      ctx.session?.scheduleAction;

    if (!hasScenario) {
      return next();
    }

    const imageRef = getMessageImageRef(ctx);
    if (imageRef) {
      const handledImage = await h.handleAdminImage(ctx);
      if (handledImage) return;
    }

    const handled = await h.handleAdminText(ctx);
    if (!handled && (text || imageRef)) {
      await adapter.reply(
        ctx,
        "Не удалось обработать сообщение. /admin_cancel — отмена и возврат в меню.",
      );
    }
  });

  return h;
}

module.exports = {
  registerAdminHandlers,
  ADMIN_MODE,
  buildMainMenuKeyboard,
  buildSettingsMenuKeyboard,
  buildScheduleMenuKeyboard,
};
