/**
 * Сценарий записи для MAX (ctx.session вместо WizardScene).
 */

const { Keyboard } = require("@maxhub/max-bot-api");
const { buildUserMenuKeyboard: buildUserMenuKeyboardFromUtil } = require("../../utils/maxKeyboard");
const { createShowUserMainMenu, DEFAULT_MAIN_MENU_MESSAGE } = require("../showUserMainMenu");
const dayjs = require("dayjs");
const timezonePlugin = require("dayjs/plugin/timezone");

dayjs.extend(timezonePlugin);

const servicesService = require("../../services/services");
const { formatDate } = require("../../utils/formatDate");
const {
  validateName,
  validatePhone,
  sanitizeText,
  sanitizeDisplayName,
  validateServiceKey,
  validateTimeStr,
} = require("../../utils/security");
const { guardCallback } = require("../admin/helpers");
const { logAction } = require("../../utils/logger");
const { safeSendMessage } = require("../../utils/safeMessaging");

const BOOKING_FLOW = "booking";

const STEPS = {
  CHOOSING_SERVICE: "choosing_service",
  CHOOSING_DATE: "choosing_date",
  CHOOSING_TIME: "choosing_time",
  AWAITING_NAME: "awaiting_name",
  AWAITING_CONTACT: "awaiting_contact",
  AWAITING_COMMENT: "awaiting_comment",
  CONFIRMING: "confirming",
};

const BOOKING_STEPS = new Set(Object.values(STEPS));

function getServices() {
  return servicesService.getAllServices();
}

function getUserId(ctx) {
  return ctx.user?.user_id;
}

function isBookingActive(ctx) {
  return (
    ctx.session?.flow === BOOKING_FLOW &&
    ctx.session?.step &&
    BOOKING_STEPS.has(ctx.session.step)
  );
}

function ensureData(ctx) {
  ctx.session.data = ctx.session.data || {};
  return ctx.session.data;
}

function clearBookingSession(ctx) {
  if (!ctx.session) return;
  delete ctx.session.flow;
  delete ctx.session.step;
  delete ctx.session.data;
}

function buildUserMenuKeyboard() {
  return buildUserMenuKeyboardFromUtil();
}

function monthKeyFromDate(d) {
  return dayjs(d).format("YYYY-MM");
}

const DATE_BUTTONS_PER_ROW = 4;

function getAllowedMonthKeys(timezone) {
  const now = dayjs().tz(timezone);
  const current = now.startOf("month");
  const keys = [current.format("YYYY-MM")];
  if (now.date() >= 15) {
    keys.push(current.add(1, "month").format("YYYY-MM"));
  }
  return keys;
}

async function buildAvailableDateSet({ timezone, allowedMonths, sheetsService }) {
  const result = new Set();
  if (!allowedMonths || !allowedMonths.length) return result;

  const monthStarts = allowedMonths.map((k) => dayjs.tz(`${k}-01`, timezone));
  const rangeStart = monthStarts.reduce((min, d) =>
    d.isBefore(min) ? d : min,
  );
  const rangeEnd = monthStarts.reduce((max, d) => {
    const end = d.endOf("month");
    return end.isAfter(max) ? end : max;
  }, rangeStart.endOf("month"));

  const today = dayjs().tz(timezone).startOf("day");
  let cursor = rangeStart.startOf("day");

  while (!cursor.isAfter(rangeEnd)) {
    const monthKey = monthKeyFromDate(cursor);
    if (!allowedMonths.includes(monthKey) || cursor.isBefore(today)) {
      cursor = cursor.add(1, "day");
      continue;
    }

    const dateStr = cursor.format("YYYY-MM-DD");
    try {
      const wh = await sheetsService.getWorkHoursForDate(dateStr);
      if (wh && wh.start && wh.end) {
        result.add(dateStr);
      }
    } catch (e) {
      // ignore
    }
    cursor = cursor.add(1, "day");
  }

  return result;
}

function parseBookingDatePayload(payload) {
  if (!payload?.startsWith("booking_date:")) {
    return null;
  }
  const match = payload.match(/^booking_date:(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return null;
  }
  const [, dd, mm, yyyy] = match;
  const dateStr = `${yyyy}-${mm}-${dd}`;
  if (!dayjs(dateStr).isValid()) {
    return null;
  }
  return dateStr;
}

function buildDateKeyboard(dateStrings, timezone) {
  const sorted = [...dateStrings].sort();
  const rows = [];
  let row = [];

  sorted.forEach((dateStr, idx) => {
    const d = dayjs.tz(dateStr, timezone);
    const label = d.format("DD.MM");
    const callbackPayload = `booking_date:${d.format("DD.MM.YYYY")}`;
    row.push(Keyboard.button.callback(label, callbackPayload));

    if ((idx + 1) % DATE_BUTTONS_PER_ROW === 0) {
      rows.push(row);
      row = [];
    }
  });

  if (row.length) {
    rows.push(row);
  }

  rows.push([Keyboard.button.callback("Назад ⬅️", "back_to_services")]);
  return Keyboard.inlineKeyboard(rows);
}

function buildTimeKeyboard(slots) {
  const rows = [];
  let row = [];

  slots.forEach((slot, idx) => {
    row.push(Keyboard.button.callback(slot.timeStr, `time:${slot.timeStr}`));
    if ((idx + 1) % 4 === 0) {
      rows.push(row);
      row = [];
    }
  });
  if (row.length) rows.push(row);
  rows.push([Keyboard.button.callback("Назад ⬅️", "back_to_dates")]);
  return Keyboard.inlineKeyboard(rows);
}

function extractPhoneFromContact(ctx) {
  const contactInfo = ctx.contactInfo;
  if (!contactInfo?.tel) return null;

  let raw = contactInfo.tel;
  if (Array.isArray(raw)) {
    raw = raw[0];
  }
  if (raw && typeof raw === "object" && raw.valueOf) {
    raw = raw.valueOf();
  }
  if (Array.isArray(raw)) {
    raw = raw[0];
  }

  let phone = String(raw || "").replace(/[^\d+]/g, "");
  if (!phone) return null;
  if (!phone.startsWith("+")) {
    phone = `+${phone}`;
  }
  return validatePhone(phone) ? phone : null;
}

function resolveProfileName(ctx) {
  const profileName = sanitizeDisplayName(ctx.user?.name || "");
  if (!profileName || profileName === "Пользователь") {
    return null;
  }
  return profileName;
}

function createBookingHandlers(adapter, sheetsService, bookingService) {
  const config = adapter.config;
  const showMainMenu = createShowUserMainMenu(adapter);

  const returnToUserMenu = async (
    ctx,
    message = `Вы вернулись в главное меню.\n\n${DEFAULT_MAIN_MENU_MESSAGE}`,
  ) => {
    clearBookingSession(ctx);
    await showMainMenu(ctx, message);
  };

  const checkBanned = async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId || !sheetsService?.getUserBanStatus) {
      return false;
    }
    try {
      const st = await sheetsService.getUserBanStatus(userId);
      return Boolean(st && st.banned);
    } catch (e) {
      return false;
    }
  };

  const invalidateWorkHoursCache = () => {
    if (sheetsService.invalidateWorkHoursCache) {
      try {
        sheetsService.invalidateWorkHoursCache();
      } catch (e) {
        // ignore
      }
    }
  };

  const showServiceStep = async (ctx) => {
    const services = getServices();
    const rows = services.map((s) => {
      const priceText = s.price !== null ? ` (${s.price} ₽)` : "";
      return [
        Keyboard.button.callback(
          `${s.name}${priceText}`,
          `book_svc:${s.key}`,
        ),
      ];
    });
    rows.push([Keyboard.button.callback("Назад ⬅️", "book_back_menu")]);

    ctx.session.flow = BOOKING_FLOW;
    ctx.session.step = STEPS.CHOOSING_SERVICE;
    ensureData(ctx);

    await adapter.reply(ctx, "Выбери услугу:", {
      attachments: [Keyboard.inlineKeyboard(rows)],
    });
  };

  const showDateStep = async (ctx) => {
    invalidateWorkHoursCache();
    const timezone = await sheetsService.getTimezone();
    const allowed = getAllowedMonthKeys(timezone);
    const availableDates = await buildAvailableDateSet({
      timezone,
      allowedMonths: allowed,
      sheetsService,
    });

    const data = ensureData(ctx);
    const dateList = Array.from(availableDates).sort();
    data.availableDates = dateList;

    if (!dateList.length) {
      await adapter.reply(
        ctx,
        "Сейчас нет доступных дат для записи. Выберите другую услугу или попробуйте позже.",
      );
      await showServiceStep(ctx);
      return;
    }

    ctx.session.step = STEPS.CHOOSING_DATE;
    const keyboard = buildDateKeyboard(dateList, timezone);
    await adapter.reply(ctx, "Выберите дату для записи:", {
      attachments: [keyboard],
    });
  };

  const showTimeStep = async (ctx, dateStr) => {
    const data = ensureData(ctx);
    const { serviceKey } = data;
    const { slots } = await bookingService.getAvailableSlotsForService(
      serviceKey,
      dateStr,
    );

    if (!slots.length) {
      const wh =
        (sheetsService.getWorkHoursForDate &&
          (await sheetsService.getWorkHoursForDate(dateStr))) ||
        null;

      if (!wh) {
        await adapter.reply(
          ctx,
          "В этот день у меня выходной. Выбери другую дату.",
        );
      } else {
        await adapter.reply(
          ctx,
          `На этот день нет свободных слотов. Рабочие часы: ${wh.start}–${wh.end}. Попробуй выбрать другую дату.`,
        );
      }

      await showDateStep(ctx);
      return;
    }

    ctx.session.step = STEPS.CHOOSING_TIME;
    await adapter.reply(ctx, "Выберите время:", {
      attachments: [buildTimeKeyboard(slots)],
    });
  };

  const showNameStep = async (ctx) => {
    ctx.session.step = STEPS.AWAITING_NAME;
    await adapter.reply(
      ctx,
      "Введи, пожалуйста, своё имя (от 1 до 50 символов, только буквы, пробелы, дефисы и апострофы).",
    );
  };

  const showContactStep = async (ctx) => {
    ctx.session.step = STEPS.AWAITING_CONTACT;
    const contactKb = Keyboard.inlineKeyboard([
      [Keyboard.button.requestContact("Отправить мой контакт")],
    ]);
    await adapter.reply(
      ctx,
      "Теперь отправь контакт по кнопке ниже или введи номер телефона текстом (+79XXXXXXXXX):",
      { attachments: [contactKb] },
    );
  };

  const proceedAfterTimeSelected = async (ctx) => {
    const data = ensureData(ctx);
    const profileName = resolveProfileName(ctx);
    if (profileName) {
      data.name = profileName;
      await showContactStep(ctx);
    } else {
      await showNameStep(ctx);
    }
  };

  const showCommentStep = async (ctx) => {
    ctx.session.step = STEPS.AWAITING_COMMENT;
    await adapter.reply(
      ctx,
      'Для продолжения записи добавь комментарий. Или напиши "-".',
    );
  };

  const showConfirmStep = async (ctx) => {
    const data = ensureData(ctx);
    const service = bookingService.getServiceByKey(data.serviceKey);

    const summary = [
      "Проверь, всё ли верно:",
      `Услуга: ${service.name}`,
      `Дата: ${formatDate(data.dateStr)}`,
      `Время: ${data.timeStr}`,
      `Имя: ${data.name}`,
      `Телефон: ${data.phone}`,
      `Комментарий: ${data.comment || "нет"}`,
    ].join("\n");

    const keyboard = Keyboard.inlineKeyboard([
      [Keyboard.button.callback("Подтвердить ✅", "confirm")],
      [Keyboard.button.callback("Отмена ❌", "cancel")],
    ]);

    ctx.session.step = STEPS.CONFIRMING;
    await adapter.reply(ctx, summary, { attachments: [keyboard] });
  };

  const startBooking = async (ctx) => {
    if (await checkBanned(ctx)) {
      await adapter.reply(
        ctx,
        "Ваш аккаунт заблокирован для записи. Свяжитесь с администратором.",
      );
      return;
    }

    ctx.session = ctx.session || {};
    ctx.session.flow = BOOKING_FLOW;
    ctx.session.data = {};
    await showServiceStep(ctx);
  };

  const requireBookingStep = (ctx, allowedSteps) => {
    if (!isBookingActive(ctx)) return false;
    if (!allowedSteps.includes(ctx.session.step)) {
      return false;
    }
    return true;
  };

  const handleServiceCallback = async (ctx) => {
    const payload = ctx.update?.callback?.payload;
    if (!requireBookingStep(ctx, [STEPS.CHOOSING_SERVICE])) return;

    if (payload === "book_back_menu") {
      await returnToUserMenu(
        ctx,
        "Ок, возвращаю в главное меню.\n\n👇 Выберите действие с помощью кнопок ниже:",
      );
      return;
    }

    if (!payload?.startsWith("book_svc:")) {
      return;
    }

    const serviceKey = payload.slice("book_svc:".length);
    if (!validateServiceKey(serviceKey)) {
      await showServiceStep(ctx);
      return;
    }
    const service = bookingService.getServiceByKey(serviceKey);
    if (!service) {
      await showServiceStep(ctx);
      return;
    }

    const data = ensureData(ctx);
    data.serviceKey = serviceKey;
    delete data.dateStr;
    delete data.date;
    delete data.timeStr;
    delete data.availableDates;

    await showDateStep(ctx);
  };

  const handleBackToServicesCallback = async (ctx) => {
    const payload = ctx.update?.callback?.payload;
    if (payload !== "back_to_services") {
      return;
    }

    if (
      !requireBookingStep(ctx, [
        STEPS.CHOOSING_DATE,
        STEPS.CHOOSING_TIME,
      ])
    ) {
      return;
    }

    const data = ensureData(ctx);
    delete data.dateStr;
    delete data.date;
    delete data.timeStr;
    delete data.availableDates;
    await showServiceStep(ctx);
  };

  const handleBookingDateCallback = async (ctx) => {
    const payload = ctx.update?.callback?.payload;
    if (!requireBookingStep(ctx, [STEPS.CHOOSING_DATE])) {
      return;
    }

    const dateStr = parseBookingDatePayload(payload);
    if (!dateStr) {
      return;
    }

    const data = ensureData(ctx);
    const timezone = await sheetsService.getTimezone();
    const allowed = getAllowedMonthKeys(timezone);
    const monthKey = monthKeyFromDate(dateStr);
    const today = dayjs().tz(timezone).startOf("day");
    const selectedDate = dayjs.tz(dateStr, timezone).startOf("day");
    const availableSet = new Set(data.availableDates || []);

    const replyInvalidDate = async (message) => {
      if (availableSet.size) {
        await adapter.reply(ctx, message, {
          attachments: [buildDateKeyboard(Array.from(availableSet), timezone)],
        });
      } else {
        await showDateStep(ctx);
      }
    };

    if (
      !allowed.includes(monthKey) ||
      selectedDate.isBefore(today, "day") ||
      (availableSet.size > 0 && !availableSet.has(dateStr))
    ) {
      await replyInvalidDate("Эта дата недоступна. Выберите другую дату:");
      return;
    }

    const workHours = await sheetsService.getWorkHoursForDate(dateStr);
    if (!workHours || !workHours.start || !workHours.end) {
      await replyInvalidDate("В этот день выходной. Выберите другую дату:");
      return;
    }

    data.dateStr = dateStr;
    data.date = dateStr;
    await showTimeStep(ctx, dateStr);
  };

  const handleTimeCallback = async (ctx) => {
    const payload = ctx.update?.callback?.payload;
    if (!requireBookingStep(ctx, [STEPS.CHOOSING_TIME])) return;

    const data = ensureData(ctx);

    if (payload === "back_to_dates") {
      delete data.timeStr;
      await showDateStep(ctx);
      return;
    }

    if (!payload?.startsWith("time:")) {
      return;
    }

    const timeStr = payload.slice("time:".length);
    if (!validateTimeStr(timeStr)) {
      return;
    }
    data.timeStr = timeStr;
    await proceedAfterTimeSelected(ctx);
  };

  const handleConfirmCallback = async (ctx) => {
    const payload = ctx.update?.callback?.payload;
    if (!requireBookingStep(ctx, [STEPS.CONFIRMING])) return;

    const data = ensureData(ctx);
    const userId = getUserId(ctx);

    if (payload === "cancel") {
      await returnToUserMenu(
        ctx,
        "Ок, ничего не записываю.\n\n👇 Выберите действие с помощью кнопок ниже:",
      );
      return;
    }

    if (payload !== "confirm") {
      return;
    }

    const { serviceKey, dateStr, timeStr } = data;
    const result = await bookingService.bookAppointment({
      serviceKey,
      dateStr,
      timeStr,
      client: {
        name: data.name,
        phone: data.phone,
        username: ctx.user?.username || null,
        maxUserId: userId,
      },
      comment: data.comment,
    });

    if (!result.ok) {
      logAction(
        userId,
        "appointment_creation_failed",
        {
          reason: result.reason,
          serviceKey,
          dateStr,
          timeStr,
        },
        "failed",
      );

      if (result.reason === "limit_exceeded") {
        const existingCount = result.existingCount || 3;
        await adapter.reply(
          ctx,
          `❌ Нельзя создать запись: превышен лимит!\n\n` +
            `У вас уже ${existingCount} активных записей.\n` +
            `Ограничение: не более 3 активных записей от одного пользователя.\n\n` +
            `Пожалуйста, отмените ненужные записи через "Мои записи" или свяжитесь с администрацией.`,
        );
        await returnToUserMenu(ctx);
        return;
      }

      if (result.reason === "daily_limit_exceeded") {
        const existingCount = result.existingCount || 4;
        await adapter.reply(
          ctx,
          `❌ Нельзя создать запись: превышен дневной лимит!\n\n` +
            `Сегодня вы уже создали ${existingCount} записей.\n` +
            `Ограничение: не более 4 записей в день.\n\n` +
            `Попробуйте снова завтра или свяжитесь с администрацией.`,
        );
        await returnToUserMenu(ctx);
        return;
      }

      if (result.reason === "slot_taken") {
        await adapter.reply(
          ctx,
          "К сожалению, пока мы бронировали, это время уже заняли. Выбери другое время на эту же дату.",
        );
        delete data.timeStr;

        const { slots } = await bookingService.getAvailableSlotsForService(
          serviceKey,
          dateStr,
        );

        if (!slots.length) {
          await returnToUserMenu(
            ctx,
            "На этот день больше нет свободных слотов. Попробуй выбрать другую дату командой /book.",
          );
          return;
        }

        ctx.session.step = STEPS.CHOOSING_TIME;
        await adapter.reply(ctx, "Выберите время:", {
          attachments: [buildTimeKeyboard(slots)],
        });
        return;
      }

      if (result.reason === "closed") {
        await returnToUserMenu(
          ctx,
          "Нельзя создать запись: в этот день у меня выходной. Попробуй другую дату.",
        );
        return;
      }

      if (result.reason === "banned") {
        await returnToUserMenu(
          ctx,
          "Ваш аккаунт заблокирован для записи. Свяжитесь с администратором.",
        );
        return;
      }

      if (result.reason === "global_limit") {
        await adapter.reply(
          ctx,
          "Сейчас слишком много записей. Пожалуйста, попробуйте через минуту.",
        );
        await returnToUserMenu(ctx);
        return;
      }

      if (
        result.reason === "invalid_client" ||
        result.reason === "invalid_service" ||
        result.reason === "invalid_date" ||
        result.reason === "invalid_time"
      ) {
        await returnToUserMenu(
          ctx,
          "Не удалось создать запись: некорректные данные. Начните запись заново.",
        );
        return;
      }

      await returnToUserMenu(
        ctx,
        "Не удалось создать запись из-за ошибки. Попробуй ещё раз позже.",
      );
      return;
    }

    const { appointment } = result;

    logAction(
      userId,
      "appointment_created",
      {
        appointmentId: appointment.id,
        service: appointment.service,
        date: appointment.date,
        timeStart: appointment.timeStart,
        timeEnd: appointment.timeEnd,
      },
      "success",
    );

    const confirmation = [
      "Готово! Ты записан(а)👌",
      `Услуга: ${appointment.service}`,
      `Дата: ${formatDate(appointment.date)}`,
      `Время: ${appointment.timeStart}–${appointment.timeEnd}`,
      "",
      "Если планы изменятся — можно отменить запись по кнопке ниже.",
    ].join("\n");

    const cancelKb = Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback(
          "Отменить эту запись ❌",
          `cancel_app:${appointment.id}`,
        ),
      ],
    ]);

    await adapter.reply(ctx, confirmation, { attachments: [cancelKb] });

    if (config.managerChatId) {
      const managerMsg = [
        "Новая запись:",
        `Услуга: ${appointment.service}`,
        `Дата: ${formatDate(appointment.date)}`,
        `Время: ${appointment.timeStart}–${appointment.timeEnd}`,
        `Клиент: ${appointment.clientName}`,
        `Телефон: ${appointment.phone}`,
        `MAX ID: ${appointment.maxUserId || "нет"}`,
        `Комментарий: ${appointment.comment || "нет"}`,
        `Код отмены: ${appointment.cancelCode}`,
      ].join("\n");

      await safeSendMessage(adapter, config.managerChatId, managerMsg);
    }

    clearBookingSession(ctx);
    await showMainMenu(
      ctx,
      `Запись завершена! Вы вернулись в главное меню.\n\n${DEFAULT_MAIN_MENU_MESSAGE}`,
    );
  };

  const handleNameInput = async (ctx) => {
    if (!requireBookingStep(ctx, [STEPS.AWAITING_NAME])) return;

    const text = ctx.message?.body?.text?.trim();
    if (!text) {
      await adapter.reply(ctx, "Пожалуйста, введите своё имя текстом.");
      return;
    }

    if (!validateName(text, 1, 50)) {
      await adapter.reply(
        ctx,
        "Имя должно содержать от 1 до 50 символов и состоять только из букв, пробелов, дефисов и апострофов. Попробуйте снова.",
      );
      return;
    }

    const data = ensureData(ctx);
    data.name = sanitizeText(text, 50);
    await showContactStep(ctx);
  };

  const handleContactInput = async (ctx) => {
    if (!requireBookingStep(ctx, [STEPS.AWAITING_CONTACT])) return;

    const data = ensureData(ctx);
    const phoneFromContact = extractPhoneFromContact(ctx);

    if (phoneFromContact) {
      data.phone = phoneFromContact;
      await showCommentStep(ctx);
      return;
    }

    const text = ctx.message?.body?.text?.trim();
    if (!text) {
      await adapter.reply(
        ctx,
        "Отправь контакт по кнопке «Отправить мой контакт» или введите номер в формате +79XXXXXXXXX.",
      );
      return;
    }

    if (!validatePhone(text)) {
      await adapter.reply(
        ctx,
        "Некорректный номер телефона. Используйте формат +79XXXXXXXXX или кнопку «Отправить мой контакт».",
      );
      return;
    }

    data.phone = text.startsWith("+") ? text : `+${text}`;
    await showCommentStep(ctx);
  };

  const handleCommentInput = async (ctx) => {
    if (!requireBookingStep(ctx, [STEPS.AWAITING_COMMENT])) return;

    const text = ctx.message?.body?.text?.trim();
    if (!text) {
      await adapter.reply(
        ctx,
        'Пожалуйста, введите комментарий текстом или напишите "-" для пропуска.',
      );
      return;
    }

    const data = ensureData(ctx);

    if (text === "-") {
      data.comment = "";
    } else {
      const sanitizedComment = sanitizeText(text, 200);
      if (sanitizedComment.length === 0 && text.length > 0) {
        await adapter.reply(
          ctx,
          "Комментарий содержит недопустимые символы. Попробуйте снова или напишите '-' для пропуска.",
        );
        return;
      }
      data.comment = sanitizedComment;
    }

    await showConfirmStep(ctx);
  };

  const cancelBooking = async (ctx) => {
    if (!isBookingActive(ctx)) {
      return false;
    }
    await returnToUserMenu(
      ctx,
      "Отменено. Для новой записи используй /book",
    );
    return true;
  };

  return {
    startBooking,
    handleServiceCallback,
    handleBackToServicesCallback,
    handleBookingDateCallback,
    handleTimeCallback,
    handleConfirmCallback,
    handleNameInput,
    handleContactInput,
    handleCommentInput,
    cancelBooking,
    returnToUserMenu,
    showMainMenu,
    isBookingActive,
    proceedAfterTimeSelected,
    showTimeStep,
    STEPS,
  };
}

/**
 * @param {import('@maxhub/max-bot-api').Bot} bot
 * @param {import('../../adapters/maxAdapter').MaxAdapter} adapter
 * @param {object} sheetsService
 * @param {object} bookingService
 */
function registerBookingHandlers(bot, adapter, sheetsService, bookingService) {
  const h = createBookingHandlers(adapter, sheetsService, bookingService);

  bot.command("book", async (ctx) => {
    await h.startBooking(ctx);
  });

  bot.hears("Записаться 💇‍♂️", async (ctx) => {
    await h.startBooking(ctx);
  });

  bot.command("cancel", async (ctx) => {
    const cancelled = await h.cancelBooking(ctx);
    if (!cancelled) {
      await adapter.reply(
        ctx,
        "Нет активной записи. Для новой записи используй /book",
      );
      await h.showMainMenu(ctx);
    }
  });

  bot.action("book_back_menu", async (ctx) => {
    await adapter.answerCallback(ctx);
    await h.handleServiceCallback(ctx);
  });

  bot.action(/^book_svc:.+/, async (ctx) => {
    if (!(await guardCallback(ctx, adapter))) return;
    await adapter.answerCallback(ctx);
    await h.handleServiceCallback(ctx);
  });

  bot.action("back_to_services", async (ctx) => {
    await adapter.answerCallback(ctx);
    await h.handleBackToServicesCallback(ctx);
  });

  bot.action(/^booking_date:.+/, async (ctx) => {
    await adapter.answerCallback(ctx);
    await h.handleBookingDateCallback(ctx);
  });

  bot.action("back_to_dates", async (ctx) => {
    await adapter.answerCallback(ctx);
    if (ctx.session?.step === STEPS.CHOOSING_TIME) {
      await h.handleTimeCallback(ctx);
    } else if (
      ctx.session?.step === STEPS.AWAITING_NAME ||
      ctx.session?.step === STEPS.AWAITING_CONTACT ||
      ctx.session?.step === STEPS.AWAITING_COMMENT
    ) {
      const data = ctx.session.data || {};
      const { serviceKey, dateStr } = data;
      if (serviceKey && dateStr) {
        const { slots } = await bookingService.getAvailableSlotsForService(
          serviceKey,
          dateStr,
        );
        ctx.session.step = STEPS.CHOOSING_TIME;
        await adapter.reply(ctx, "Выберите время:", {
          attachments: [buildTimeKeyboard(slots)],
        });
      }
    }
  });

  bot.action(/^time:.+/, async (ctx) => {
    if (!(await guardCallback(ctx, adapter))) return;
    await adapter.answerCallback(ctx);
    if (ctx.session?.step === STEPS.CHOOSING_TIME) {
      await h.handleTimeCallback(ctx);
    } else if (
      ctx.session?.step === STEPS.AWAITING_NAME ||
      ctx.session?.step === STEPS.AWAITING_CONTACT ||
      ctx.session?.step === STEPS.AWAITING_COMMENT
    ) {
      const payload = ctx.update?.callback?.payload;
      if (payload?.startsWith("time:")) {
        const data = ctx.session.data || {};
        data.timeStr = payload.slice("time:".length);
        await h.proceedAfterTimeSelected(ctx);
      }
    }
  });

  bot.action("confirm", async (ctx) => {
    if (!(await guardCallback(ctx, adapter))) return;
    await adapter.answerCallback(ctx);
    await h.handleConfirmCallback(ctx);
  });

  bot.action("cancel", async (ctx) => {
    if (ctx.session?.step === STEPS.CONFIRMING) {
      await adapter.answerCallback(ctx);
      await h.handleConfirmCallback(ctx);
    }
  });

  bot.on("message_created", async (ctx, next) => {
    const text = ctx.message?.body?.text?.trim() ?? "";
    if (text.startsWith("/start")) {
      return next();
    }

    if (!h.isBookingActive(ctx)) {
      return next();
    }

    const step = ctx.session.step;

    if (step === STEPS.AWAITING_NAME) {
      await h.handleNameInput(ctx);
      return;
    }

    if (step === STEPS.AWAITING_CONTACT) {
      await h.handleContactInput(ctx);
      return;
    }

    if (step === STEPS.AWAITING_COMMENT) {
      await h.handleCommentInput(ctx);
      return;
    }

    if (step === STEPS.CONFIRMING) {
      await adapter.reply(ctx, "Подтверди или отмени запись по кнопкам.");
      return;
    }

    await adapter.reply(ctx, "Используй кнопки под сообщением для выбора.");
  });

  return h;
}

module.exports = {
  registerBookingHandlers,
  buildUserMenuKeyboard,
  STEPS,
  BOOKING_FLOW,
  isBookingActive: (ctx) =>
    ctx.session?.flow === BOOKING_FLOW &&
    ctx.session?.step &&
    BOOKING_STEPS.has(ctx.session.step),
};
