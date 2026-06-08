const { formatDate } = require("../../../utils/formatDate");
const { logCriticalAction, logAdminAction } = require("../../../utils/logger");
const { safeSendMessage } = require("../../../utils/safeMessaging");
const { getUserId } = require("../helpers");
const { buildMainMenuKeyboard } = require("../keyboards");

function createBookingsHandlers({ adapter, sheetsService, bookingService }) {
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

  const startCancelByCode = async (ctx) => {
    ctx.session.adminAction = { type: "cancel_booking_by_code" };
    await adapter.reply(
      ctx,
      "Отправьте код отмены записи (например: A3K9X2).\nДля отмены напишите /admin_cancel",
    );
  };

  const processCancelByCodeText = async (ctx, text) => {
    const action = ctx.session?.adminAction?.type;
    if (action !== "cancel_booking_by_code") return false;

    const userId = getUserId(ctx);
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
  };

  return {
    showAllBookings,
    showStats,
    startCancelByCode,
    processCancelByCodeText,
  };
}

module.exports = { createBookingsHandlers };
