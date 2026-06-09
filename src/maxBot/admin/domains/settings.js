const adminService = require("../../../services/admin");
const {
  validateMaxUserId,
  sanitizeText,
  validatePhone,
  validateSafeUrl,
} = require("../../../utils/security");
const { logCriticalAction, logAdminAction, logError } = require("../../../utils/logger");
const { sanitizeErrorMessage } = require("../../../utils/errorHandler");
const { getUserId } = require("../helpers");
const { buildSettingsMenuKeyboard } = require("../keyboards");

function createSettingsHandlers({ adapter, sheetsService }) {
  const startBan = async (ctx) => {
    ctx.session.adminAction = { type: "ban" };
    await adapter.reply(
      ctx,
      "Отправьте Max ID (числовой ID пользователя в MAX) для бана.\nДля отмены напишите /admin_cancel",
    );
  };

  const startUnban = async (ctx) => {
    ctx.session.adminAction = { type: "unban" };
    await adapter.reply(
      ctx,
      "Отправьте Max ID пользователя для разбанивания.\nДля отмены напишите /admin_cancel",
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
      await adapter.reply(ctx, `Ошибка при получении текущего сообщения: ${sanitizeErrorMessage(err)}`);
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
      await adapter.reply(ctx, `Ошибка при получении данных: ${sanitizeErrorMessage(err)}`);
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
        `Ошибка при получении текущих контактов: ${sanitizeErrorMessage(err)}`,
      );
    }
  };

  const startPortfolioUpload = async (ctx) => {
    ctx.session.adminAction = { type: "portfolio_upload" };
    await adapter.reply(
      ctx,
      "Отправьте прямую HTTPS-ссылку на изображение для портфолио. Для отмены напишите /admin_cancel",
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
      await adapter.reply(ctx, `Ошибка при получении портфолио: ${sanitizeErrorMessage(e)}`);
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
      await adapter.reply(ctx, `Ошибка при получении локации: ${sanitizeErrorMessage(e)}`);
    }
  };

  const processSettingsActionText = async (ctx, text) => {
    const action = ctx.session?.adminAction?.type;
    if (!action) return false;

    const settingsActions = [
      "ban",
      "unban",
      "edit_28day_reminder",
      "edit_tips_link",
      "edit_contacts",
      "portfolio_delete",
      "portfolio_upload",
      "save_location",
    ];
    if (!settingsActions.includes(action)) return false;

    const userId = getUserId(ctx);

    if (action === "ban") {
      const maxUserId = text;

      if (!maxUserId || !validateMaxUserId(maxUserId)) {
        await adapter.reply(
          ctx,
          "Неверный формат Max ID. /admin_cancel для отмены.",
        );
        return true;
      }

      await adminService.banUser(maxUserId, "", sheetsService);
      logCriticalAction(
        userId,
        "admin_ban_user",
        { bannedUserId: maxUserId, target: text },
        "success",
      );
      await adapter.reply(ctx, `Пользователь ${maxUserId} забанен.`, {
        attachments: [buildSettingsMenuKeyboard()],
      });
      delete ctx.session.adminAction;
      return true;
    }

    if (action === "unban") {
      const maxUserId = text;
      if (!maxUserId || !validateMaxUserId(maxUserId)) {
        await adapter.reply(
          ctx,
          "Неверный формат Max ID. /admin_cancel для отмены.",
        );
        return true;
      }

      await adminService.unbanUser(maxUserId, sheetsService);
      logCriticalAction(
        userId,
        "admin_unban_user",
        { unbannedUserId: maxUserId },
        "success",
      );
      await adapter.reply(ctx, `Пользователь ${maxUserId} разбанен.`, {
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
          `Ошибка при сохранении текста: ${sanitizeErrorMessage(err)}\n/admin_cancel для отмены.`,
        );
        await logError(userId, "admin_edit_28day_reminder", err, {});
        return true;
      }
      delete ctx.session.adminAction;
      return true;
    }

    if (action === "edit_tips_link") {
      const trimmedInput = sanitizeText(text.trim(), 500);
      if (!trimmedInput) {
        await adapter.reply(ctx, "Данные не могут быть пустыми. /admin_cancel для отмены.");
        return true;
      }
      const isValidUrl = validateSafeUrl(trimmedInput);
      const normalizedPhone = trimmedInput.replace(/[\s\-()]/g, "");
      const isPhoneNumber = validatePhone(
        normalizedPhone.startsWith("+") ? normalizedPhone : `+${normalizedPhone}`,
      );

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
          `Ошибка при сохранении: ${sanitizeErrorMessage(err)}\n/admin_cancel для отмены.`,
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

      const phoneRaw = lines[0];
      const addressRaw = lines.slice(1).join(" ");
      const phoneNormalized = phoneRaw.replace(/[\s\-()]/g, "");
      const phone = phoneNormalized.startsWith("+")
        ? phoneNormalized
        : `+${phoneNormalized}`;
      const address = sanitizeText(addressRaw, 500);

      if (!validatePhone(phone)) {
        await adapter.reply(ctx, "Некорректный телефон. /admin_cancel для отмены.");
        return true;
      }
      if (!address?.trim()) {
        await adapter.reply(ctx, "Адрес не может быть пустым. /admin_cancel для отмены.");
        return true;
      }

      try {
        await sheetsService.setBarberPhone(phone);
        await sheetsService.setBarberAddress(address);
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
          `Контакты успешно обновлены!\n\n📞 Телефон: ${phone}\n📍 Адрес: ${address}`,
          { attachments: [buildSettingsMenuKeyboard()] },
        );
      } catch (err) {
        await adapter.reply(
          ctx,
          `Ошибка при сохранении контактов: ${sanitizeErrorMessage(err)}\n/admin_cancel для отмены.`,
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
        await adapter.reply(ctx, `Ошибка при удалении фото: ${sanitizeErrorMessage(e)}`);
      }
      return true;
    }

    if (action === "portfolio_upload") {
      const trimmed = text.trim();
      const lower = trimmed.toLowerCase();
      const isValidUrl =
        lower.startsWith("http://") || lower.startsWith("https://");
      if (!isValidUrl) {
        await adapter.reply(
          ctx,
          "Ссылка должна начинаться с http:// или https://. /admin_cancel для отмены.",
        );
        return true;
      }
      try {
        await sheetsService.addPortfolioFileId(trimmed);
        await adapter.reply(ctx, "✅ Фото добавлено в портфолио.", {
          attachments: [buildSettingsMenuKeyboard()],
        });
        delete ctx.session.adminAction;
      } catch (e) {
        await adapter.reply(
          ctx,
          `Ошибка при сохранении фото в портфолио: ${sanitizeErrorMessage(e)}`,
        );
      }
      return true;
    }

    if (action === "save_location") {
      const trimmed = (text || "").trim();
      if (!trimmed) {
        await adapter.reply(ctx, "Ссылка не может быть пустой. /admin_cancel для отмены.");
        return true;
      }
      if (!validateSafeUrl(trimmed)) {
        await adapter.reply(
          ctx,
          "Ссылка должна начинаться с http://, https:// или t.me/. /admin_cancel для отмены.",
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
        await adapter.reply(ctx, `Ошибка при сохранении локации: ${sanitizeErrorMessage(e)}`);
      }
      return true;
    }

    return false;
  };

  const handlePortfolioUploadImage = async (ctx) => {
    const action = ctx.session?.adminAction?.type;
    if (action !== "portfolio_upload") return false;

    await adapter.reply(
      ctx,
      "Пожалуйста, отправьте прямую HTTPS-ссылку на изображение, а не сам файл, так как MAX API требует ссылки для постоянного хранения в портфолио.",
    );
    return true;
  };

  return {
    startBan,
    startUnban,
    startReminder28,
    startTipsLink,
    startEditContacts,
    startPortfolioUpload,
    startPortfolioDelete,
    startSaveLocation,
    processSettingsActionText,
    handlePortfolioUploadImage,
  };
}

module.exports = { createSettingsHandlers };
