// Точка входа MAX Bot API
// Загружает конфиг, Google Sheets/Calendar, бота и cron-напоминания

const { Bot, MaxError } = require("@maxhub/max-bot-api");
const { MaxAdapter } = require("./src/adapters/maxAdapter");
const { maxSession } = require("./src/middleware/maxSession");
const { registerUserHandlers } = require("./src/maxBot/userHandlers");
const { registerBookingHandlers } = require("./src/maxBot/scenes/bookingScene");
const { registerHaircutScene } = require("./src/maxBot/scenes/haircutScene");
const { registerAdminHandlers } = require("./src/maxBot/admin/adminHandlers");
const { initConfig } = require("./src/config");
const { createSheetsService } = require("./src/services/googleSheets");
const { createCalendarService } = require("./src/services/googleCalendar");
const { createBookingService } = require("./src/services/booking");
const { setupReminders } = require("./src/services/reminders");
const { rateLimiter } = require("./src/middleware/rateLimiter");
const { callbackValidator } = require("./src/middleware/callbackValidator");
const { messageSizeLimiter } = require("./src/middleware/messageSizeLimiter");
const { setCriticalAlertHandler } = require("./src/utils/logger");
const { schedule } = require("./src/utils/apiRateLimiter");
const servicesService = require("./src/services/services");
const aiResultCache = require("./src/utils/aiResultCache");

/**
 * Некритичные ошибки MAX API и похожих HTTP-клиентов.
 * Не должны ронять процесс при unhandledRejection / частично при uncaughtException.
 */
function isNonCriticalApiError(err) {
  if (!err) {
    return false;
  }

  if (err instanceof MaxError) {
    const status = err.status;
    if (status === 403 || status === 429 || status === 400) {
      return true;
    }
  }

  const httpStatus = err.status ?? err.response?.status ?? err.code;
  if (httpStatus === 403 || httpStatus === 429 || httpStatus === 400) {
    return true;
  }

  const message = String(err.description || err.message || "").toLowerCase();

  if (
    message.includes("blocked") ||
    message.includes("forbidden") ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  ) {
    return true;
  }

  return false;
}

function describeApiError(err) {
  if (!err) {
    return "unknown error";
  }
  if (err instanceof MaxError) {
    return `${err.status}: ${err.description || err.message}`;
  }
  const code = err.status ?? err.code;
  const text = err.description || err.message || String(err);
  return code != null ? `${code}: ${text}` : text;
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection, reason:", reason);

  if (isNonCriticalApiError(reason)) {
    console.warn(
      `[Global Error Handler] Non-critical API error: ${describeApiError(reason)}`,
    );
    return;
  }

  console.error(
    "[Global Error Handler] Unhandled rejection logged, continuing...",
  );
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);

  if (isNonCriticalApiError(error)) {
    console.warn(
      `[Global Error Handler] Non-critical API error: ${describeApiError(error)}, continuing...`,
    );
    return;
  }

  console.error("[Global Error Handler] Critical error, exiting...");
  process.exit(1);
});

async function main() {
  console.log("Bootstrapping barber bot...");

  const config = initConfig();

  const sheetsService = await createSheetsService(config);

  let calendarService = null;
  if (config.google && config.google.calendarId) {
    try {
      calendarService = await createCalendarService(config);
    } catch (e) {
      console.warn("Не удалось инициализировать Google Calendar:", e.message);
      calendarService = null;
    }
  }

  await sheetsService.ensureSheetsStructure();

  if (!config.maxBotToken) {
    throw new Error("Не задан токен бота: укажите MAX_BOT_TOKEN в .env");
  }

  const bot = new Bot(config.maxBotToken);
  const adapter = new MaxAdapter(config, sheetsService, calendarService, bot);

  const bookingService = createBookingService({
    sheetsService,
    config,
    calendarService,
  });

  setCriticalAlertHandler(async (managerId, message) => {
    if (!config.managerChatId) return;
    await schedule(() =>
      bot.api.sendMessageToUser(Number(config.managerChatId), message),
    );
  });

  bot.use(maxSession());
  bot.use(callbackValidator);
  bot.use(rateLimiter);
  bot.use(messageSizeLimiter);

  bot.on("message_created", async (ctx, next) => {
    console.log(
      "[DEBUG] Получено сообщение от user_id:",
      ctx.user?.user_id,
      "текст:",
      ctx.message?.body?.text,
    );
    return next();
  });

  bot.on("bot_started", async (ctx, next) => {
    console.log(
      "[DEBUG] Событие bot_started от user_id:",
      ctx.user?.user_id,
      "payload:",
      ctx.startPayload,
    );
    return next();
  });

  const bookingHandlers = registerBookingHandlers(
    bot,
    adapter,
    sheetsService,
    bookingService,
  );
  const haircutHandlers = registerHaircutScene(
    bot,
    adapter,
    sheetsService,
    bookingHandlers,
  );
  registerUserHandlers(
    bot,
    adapter,
    sheetsService,
    bookingService,
    servicesService,
    haircutHandlers,
  );
  registerAdminHandlers(bot, adapter, sheetsService, bookingService);

  setupReminders({
    bot,
    config,
    sheetsService,
    calendarService,
  });

  bot.catch((err, ctx) => {
    if (isNonCriticalApiError(err)) {
      console.warn(
        `[Bot] Non-critical API error while processing update:`,
        describeApiError(err),
      );
      return;
    }
    console.error("Unhandled error while processing", ctx?.update, err);
  });

  console.log("Launching MAX bot...");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isTransientNetworkError = (err) => {
    const code = err && (err.code || err.errno);
    return (
      code === "ETIMEDOUT" ||
      code === "ECONNRESET" ||
      code === "EAI_AGAIN" ||
      code === "ENOTFOUND" ||
      code === "ECONNREFUSED"
    );
  };

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      await bot.start({
        allowedUpdates: [
          "message_created",
          "message_callback",
          "message_edited",
          "bot_started",
          "bot_added",
          "bot_removed",
        ],
      });
      break;
    } catch (err) {
      if (!isTransientNetworkError(err) && !isNonCriticalApiError(err)) {
        throw err;
      }

      const delayMs = Math.min(60_000, 2000 * 2 ** (attempt - 1));
      console.warn(
        `MAX bot start failed (${err.code || err.status || err.errno || "unknown"}). ` +
          `Retrying in ${Math.round(delayMs / 1000)}s...`,
      );
      bot.stop();
      await sleep(delayMs);
    }
  }

  console.log("Bot is up. Waiting for updates...");

  process.once("SIGINT", () => {
    bot.stop();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    bot.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error in main:", err);
  process.exit(1);
});

// Graceful shutdown: очищаем ресурсы при выключении
process.on("SIGTERM", () => {
  console.log("[main] SIGTERM signal received: closing gracefully");
  aiResultCache.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[main] SIGINT signal received: closing gracefully");
  aiResultCache.stop();
  process.exit(0);
});
