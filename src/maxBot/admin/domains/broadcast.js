const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezonePlugin = require("dayjs/plugin/timezone");
const adminService = require("../../../services/admin");
const {
  sanitizeText,
  validateImageAttachment,
} = require("../../../utils/security");
const { getMessageImageAttachment } = require("../helpers");
const { logCriticalAction } = require("../../../utils/logger");
const { sanitizeErrorMessage } = require("../../../utils/errorHandler");
const { getUserId, getMessageCaption } = require("../helpers");
const { MAX_BROADCAST_RECIPIENTS } = require("../constants");
const {
  buildMainMenuKeyboard,
  buildBroadcastConfirmKeyboard,
} = require("../keyboards");

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

function createBroadcastHandlers({ adapter, sheetsService, bot }) {
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
        `Ошибка при получении статуса рассылки: ${sanitizeErrorMessage(err)}`,
        { attachments: [buildMainMenuKeyboard()] },
      );
    }
  };

  const startBroadcast = async (ctx) => {
    ctx.session.adminAction = { type: "broadcast" };
    await adapter.reply(
      ctx,
      "Отправьте текст для рассылки или пришлите фото с подписью.\nДля отмены напишите /admin_cancel",
    );
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

  const processBroadcastText = async (ctx, text) => {
    const action = ctx.session?.adminAction?.type;
    if (action !== "broadcast") return false;

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
  };

  const handleBroadcastImage = async (ctx, imageRef) => {
    const action = ctx.session?.adminAction?.type;
    if (action !== "broadcast" || !imageRef) return false;

    const attachment = getMessageImageAttachment(ctx);
    if (attachment) {
      const validation = validateImageAttachment(attachment);
      if (!validation.valid) {
        await adapter.reply(
          ctx,
          "Недопустимое изображение. Разрешены JPEG/PNG/WebP до 10 МБ.",
        );
        return true;
      }
    }

    const caption = sanitizeText(getMessageCaption(ctx), 4000);
    await showBroadcastPreview(
      ctx,
      { kind: "photo", fileId: imageRef, caption },
      null,
    );
    return true;
  };

  return {
    showBroadcastStatus,
    startBroadcast,
    showBroadcastPreview,
    handleBroadcastConfirm,
    handleBroadcastCancel,
    processBroadcastText,
    handleBroadcastImage,
  };
}

module.exports = { createBroadcastHandlers };
