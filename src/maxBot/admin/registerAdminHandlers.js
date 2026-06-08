const { logAdminAction } = require("../../utils/logger");
const { isBookingActive } = require("../scenes/bookingScene");
const { createAdminHandlers } = require("./createAdminHandlers");
const {
  getUserId,
  getMessageText,
  getMessageImageRef,
  guardCallback,
  isAdminMode,
} = require("./helpers");
const { buildServicesMenuKeyboard } = require("./keyboards");

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
    if (!(await guardCallback(ctx, adapter))) return;
    if (!h.checkAdmin(ctx)) return;
    if (!isAdminMode(ctx)) return;
    const action = ctx.update?.callback?.payload?.slice("admin:".length);
    if (!action) return;
    await h.handleAdminCallback(ctx, action);
  });

  bot.action(/^revenue:(.+)/, async (ctx) => {
    if (!(await guardCallback(ctx, adapter))) return;
    if (!h.checkAdmin(ctx) || !isAdminMode(ctx)) return;
    await adapter.answerCallback(ctx);
    const period = ctx.update?.callback?.payload?.slice("revenue:".length);
    if (!period) return;
    await h.handleRevenueCallback(ctx, period);
  });

  bot.action(/^service_edit:(.+)/, async (ctx) => {
    if (!(await guardCallback(ctx, adapter))) return;
    if (!h.checkAdmin(ctx) || !isAdminMode(ctx)) return;
    const key = ctx.update?.callback?.payload?.slice("service_edit:".length);
    if (!key) return;
    await h.handleServiceEditCallback(ctx, key);
  });

  bot.action(/^service_field:(.+)/, async (ctx) => {
    if (!(await guardCallback(ctx, adapter))) return;
    if (!h.checkAdmin(ctx) || !isAdminMode(ctx)) return;
    const field = ctx.update?.callback?.payload?.slice("service_field:".length);
    if (!field) return;
    await h.handleServiceFieldCallback(ctx, field);
  });

  bot.action(/^service_delete:(.+)/, async (ctx) => {
    if (!(await guardCallback(ctx, adapter))) return;
    if (!h.checkAdmin(ctx) || !isAdminMode(ctx)) return;
    const key = ctx.update?.callback?.payload?.slice("service_delete:".length);
    if (!key) return;
    await h.handleServiceDeleteCallback(ctx, key);
  });

  bot.action("service_cancel", async (ctx) => {
    if (!(await guardCallback(ctx, adapter))) return;
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

module.exports = { registerAdminHandlers };
