/**
 * Обработчики пользовательского меню для MAX Bot.
 */

const { Keyboard } = require("@maxhub/max-bot-api");
const { formatDate } = require("../utils/formatDate");
const {
  validateAppointmentId,
  sanitizeDisplayName,
  validateSafeUrl,
} = require("../utils/security");
const { logAction } = require("../utils/logger");
const { safeSendMessage } = require("../utils/safeMessaging");
const { createShowUserMainMenu } = require("./showUserMainMenu");

function getUserId(ctx) {
  return ctx.user?.user_id;
}

function getDisplayName(ctx) {
  const name = sanitizeDisplayName(ctx.user?.name || "");
  if (name && name !== "Пользователь") {
    return name.split(/\s+/)[0];
  }
  return "друг";
}

function resetUserFlow(ctx) {
  ctx.session = { mode: "user" };
}

async function getSettingValue(sheetsService, key) {
  if (typeof sheetsService.getSetting === "function") {
    return sheetsService.getSetting(key);
  }
  const settings = await sheetsService.getSettings();
  const value = settings[key];
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function getServicesList(servicesService) {
  if (typeof servicesService.getServices === "function") {
    return servicesService.getServices();
  }
  return servicesService.getAllServices();
}

/**
 * @returns {Promise<boolean>} true, если портфолио отправлено (приветствие + фото)
 */
async function sendPortfolio(ctx, sheetsService, welcomeName) {
  const urls = ((await sheetsService.getPortfolioFileIds()) || []).slice(0, 6);

  if (!urls.length) {
    return false;
  }

  await ctx.reply(
    `Привет, ${welcomeName}! Я бот мастера по услугам красоты. Здесь можно записаться на стрижку.`,
  );

  for (const photoUrl of urls) {
    const url = String(photoUrl).trim();
    if (!url || !validateSafeUrl(url)) {
      console.warn(
        "[WARN] Пропущена небезопасная или пустая ссылка портфолио:",
        photoUrl,
      );
      continue;
    }

    try {
      const image = await ctx.api.uploadImage({ url });
      await ctx.reply(" ", { attachments: [image.toJson()] });
    } catch (error) {
      console.warn("[WARN] Не удалось загрузить фото портфолио:", url, error);
    }
  }

  return true;
}

function createUserHandlers(
  adapter,
  sheetsService,
  bookingService,
  servicesService,
) {
  const config = adapter.config;

  const showMainMenu = createShowUserMainMenu(adapter);

  const handleStart = async (ctx) => {
    resetUserFlow(ctx);

    const name = getDisplayName(ctx);

    const portfolioSent = await sendPortfolio(ctx, sheetsService, name);
    if (!portfolioSent) {
      await adapter.reply(
        ctx,
        `Привет, ${name}! Я бот мастера по услугам красоты. Здесь можно записаться на стрижку.`,
      );
    }

    await showMainMenu(ctx);
  };

  const handleMyBookings = async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) {
      await adapter.reply(ctx, "Не удалось определить пользователя.");
      return;
    }

    const list = await bookingService.getUserBookings(userId);

    if (!list.length) {
      await adapter.reply(ctx, "У тебя пока нет будущих записей.");
      await showMainMenu(ctx);
      return;
    }

    const lines = list.map(
      (app, idx) =>
        `${idx + 1}. ${app.service} — ${formatDate(app.date)} ${app.timeStart}`,
    );

    const keyboard = Keyboard.inlineKeyboard(
      list.map((app) => [
        Keyboard.button.callback(
          `Отменить ${formatDate(app.date)} ${app.timeStart}`,
          `cancel_app:${app.id}`,
        ),
      ]),
    );

    await adapter.reply(ctx, `Будущие записи:\n\n${lines.join("\n")}`, {
      attachments: [keyboard],
    });
    await showMainMenu(ctx);
  };

  const handlePrice = async (ctx) => {
    const services = getServicesList(servicesService);

    if (!services.length) {
      await adapter.reply(
        ctx,
        "Прайс пока не настроен. Обратитесь к администратору.",
      );
      await showMainMenu(ctx);
      return;
    }

    const text = services
      .map((s) => {
        const priceText =
          s.price !== null ? ` — ${s.price} ₽` : " — цена не указана";
        return `- ${s.name}${priceText} (${s.durationMin} мин)`;
      })
      .join("\n");

    await adapter.reply(ctx, `Прайс услуг:\n${text}`);
    await showMainMenu(ctx);
  };

  const handleLocation = async (ctx) => {
    const yandexLink = await getSettingValue(
      sheetsService,
      "ссылка_на_локацию",
    );
    const gisLink =
      typeof sheetsService.getLocationLink2gis === "function"
        ? await sheetsService.getLocationLink2gis()
        : await getSettingValue(sheetsService, "ссылка_на_2гис");

    if (!yandexLink && !gisLink) {
      await adapter.reply(
        ctx,
        "Локация не настроена. Обратитесь к администратору.",
      );
      await showMainMenu(ctx);
      return;
    }

    const rows = [];
    if (yandexLink) {
      rows.push([
        Keyboard.button.link("Открыть в Яндекс.Картах", yandexLink),
      ]);
    }
    if (gisLink) {
      rows.push([Keyboard.button.link("Открыть в 2ГИС", gisLink)]);
    }

    await adapter.reply(ctx, "Как добраться:", {
      attachments: [Keyboard.inlineKeyboard(rows)],
    });
    await showMainMenu(ctx);
  };

  const handleCancelAppointment = async (ctx) => {
    const payload = ctx.update?.callback?.payload;
    const id = payload?.startsWith("cancel_app:")
      ? payload.slice("cancel_app:".length)
      : null;

    if (!id || !validateAppointmentId(id)) {
      await adapter.answerCallback(ctx, {
        notification: "Неверный формат ID записи.",
      });
      return;
    }

    await adapter.answerCallback(ctx, { notification: "Отменяем запись..." });

    const userId = getUserId(ctx);
    const result = await bookingService.cancelAppointment(id, userId);

    if (!result.ok) {
      if (result.reason === "appointment_not_found") {
        await adapter.reply(
          ctx,
          "Не удалось отменить запись: она не найдена или уже отменена.",
        );
      } else if (result.reason === "not_owner") {
        await adapter.reply(ctx, "Эта запись принадлежит другому пользователю.");
      } else if (result.reason === "already_cancelled") {
        await adapter.reply(ctx, "Эта запись уже отменена.");
      } else {
        await adapter.reply(
          ctx,
          "Не удалось отменить запись. Попробуйте позже.",
        );
      }
      return;
    }

    const { appointment } = result;

    logAction(
      userId,
      "appointment_cancelled",
      {
        appointmentId: id,
        date: appointment.date,
        time: appointment.timeStart,
      },
      "success",
    );

    await adapter.reply(
      ctx,
      `Запись на ${formatDate(appointment.date)} ${
        appointment.timeStart
      } отменена. Спасибо, что предупредил(а)!`,
    );

    if (config.managerChatId) {
      await safeSendMessage(
        adapter,
        config.managerChatId,
        `Клиент отменил запись:\nУслуга: ${
          appointment.service
        }\nДата: ${formatDate(appointment.date)}\nВремя: ${
          appointment.timeStart
        }–${appointment.timeEnd}\nКлиент: ${appointment.clientName}\nТелефон: ${
          appointment.phone
        }\nКод отмены: ${appointment.cancelCode}`,
      );
    }

    await showMainMenu(ctx);
  };

  return {
    handleStart,
    handleMyBookings,
    handlePrice,
    handleLocation,
    handleCancelAppointment,
    showMainMenu,
    resetUserFlow,
  };
}

/**
 * @param {import('@maxhub/max-bot-api').Bot} bot
 * @param {import('../adapters/maxAdapter').MaxAdapter} adapter
 * @param {object} sheetsService
 * @param {object} bookingService
 * @param {object} servicesService
 */
function registerUserHandlers(
  bot,
  adapter,
  sheetsService,
  bookingService,
  servicesService,
  haircutHandlers = null,
) {
  const h = createUserHandlers(
    adapter,
    sheetsService,
    bookingService,
    servicesService,
  );

  const handleStartCommand = async (ctx) => {
    console.log(
      "[DEBUG] Команда /start получена от user_id:",
      ctx.user?.user_id,
    );
    try {
      await h.handleStart(ctx);
    } catch (error) {
      console.error("[ERROR] Ошибка в /start:", error);
      await ctx.reply(
        "Произошла ошибка при запуске бота. Попробуйте позже.",
      );
    }
  };

  bot.command("start", handleStartCommand);
  bot.on("bot_started", handleStartCommand);

  bot.command("price", async (ctx) => {
    await h.handlePrice(ctx);
  });

  bot.hears("Мои записи", async (ctx) => {
    await h.handleMyBookings(ctx);
  });

  bot.hears(["Прайс", "прайс"], async (ctx) => {
    await h.handlePrice(ctx);
  });

  bot.hears(["Как добраться", "Как добраться 🗺️"], async (ctx) => {
    await h.handleLocation(ctx);
  });

  if (haircutHandlers?.startHaircutFlow) {
    bot.hears("✨ Подобрать стрижку с ИИ", async (ctx) => {
      await haircutHandlers.startHaircutFlow(ctx);
    });
  }

  bot.action(/^cancel_app:.+/, async (ctx) => {
    await h.handleCancelAppointment(ctx);
  });

  return h;
}

module.exports = {
  registerUserHandlers,
};
