const fs = require("fs").promises;
const path = require("path");
const { ImageAttachment } = require("@maxhub/max-bot-api");

const BANS_FILE = path.resolve(process.cwd(), "banned.json");
const DEFAULT_THROTTLE_MS = 750;

async function readBans() {
  try {
    const raw = await fs.readFile(BANS_FILE, { encoding: "utf8" });
    return JSON.parse(raw || "[]");
  } catch (e) {
    return [];
  }
}

async function writeBans(list) {
  await fs.writeFile(BANS_FILE, JSON.stringify(list, null, 2), {
    encoding: "utf8",
  });
}

async function isBanned(telegramId) {
  const bans = await readBans();
  return bans.some((b) => String(b) === String(telegramId));
}

async function banUser(telegramId, reason = "", sheetsService = null) {
  const bans = await readBans();
  if (!bans.some((b) => String(b) === String(telegramId))) {
    bans.push(String(telegramId));
    await writeBans(bans);
  }
  // Синхронизируем с таблицей, если сервис передан
  try {
    if (sheetsService && sheetsService.setUserBanStatus) {
      await sheetsService.setUserBanStatus(telegramId, true, reason || "");
    }
  } catch (e) {
    // не прерываем, если не удалось записать в таблицу
  }
  return true;
}

async function unbanUser(telegramId, sheetsService = null) {
  const telegramIdStr = String(telegramId);
  let bans = await readBans();
  const initialLength = bans.length;
  bans = bans.filter((b) => String(b) !== telegramIdStr);
  const removed = initialLength !== bans.length;

  // Удаляем пользователя из banned.json, если он там был
  if (removed) {
    await writeBans(bans);
  }

  // Всегда синхронизируем с таблицей, если сервис передан
  // Это нужно, чтобы очистить статус бана в таблице, даже если пользователя не было в banned.json
  try {
    if (sheetsService && sheetsService.setUserBanStatus) {
      await sheetsService.setUserBanStatus(telegramIdStr, false, "");
    }
  } catch (e) {
    console.error("Ошибка при обновлении статуса бана в таблице:", e);
    // не прерываем, если не удалось записать в таблицу
  }
  return true;
}

async function getBans() {
  return await readBans();
}

function logBroadcastSendError(method, userId, err) {
  const description =
    err?.description || err?.response?.description || err?.message;
  const code = err?.status ?? err?.response?.error_code;

  if (code === 403) {
    console.warn(
      `[admin] User ${userId} blocked the bot. ${method} not sent.`,
    );
    return;
  }
  if (code === 400) {
    console.warn(`[admin] Bad request for user ${userId}: ${description}`);
    return;
  }
  if (code === 429) {
    console.warn(`[admin] Rate limit for user ${userId}: ${description}`);
    return;
  }

  console.error(
    `[admin] Error in ${method} to ${userId}:`,
    description,
    code != null ? `(code: ${code})` : "",
  );
}

/**
 * @param {import('@maxhub/max-bot-api').Bot} bot
 */
async function sendMessageToUser(bot, userId, text, options = {}) {
  if (!bot?.api?.sendMessageToUser) {
    console.error("[admin] Invalid bot: api.sendMessageToUser missing");
    return null;
  }
  if (!userId) {
    return null;
  }

  try {
    return await bot.api.sendMessageToUser(Number(userId), text, options);
  } catch (err) {
    logBroadcastSendError("sendMessage", userId, err);
    return null;
  }
}

/**
 * Фото по URL или MAX token (см. TODO в broadcastToClients).
 * @param {import('@maxhub/max-bot-api').Bot} bot
 */
async function sendPhotoToUser(bot, userId, urlOrToken, caption = "") {
  if (!bot?.api?.sendMessageToUser) {
    console.error("[admin] Invalid bot: api.sendMessageToUser missing");
    return null;
  }
  if (!userId || !urlOrToken) {
    return null;
  }

  try {
    const value = String(urlOrToken).trim();
    let imageAttachment;

    if (/^https?:\/\//i.test(value)) {
      imageAttachment = await bot.api.uploadImage({ url: value });
    } else {
      imageAttachment = new ImageAttachment({ token: value });
    }

    return await bot.api.sendMessageToUser(Number(userId), caption, {
      attachments: [imageAttachment.toJson()],
    });
  } catch (err) {
    logBroadcastSendError("sendPhoto", userId, err);
    return null;
  }
}

async function broadcastToClients(
  bot,
  sheetsService,
  payload,
  options = {},
) {
  // Поддерживаем два режима: передан список получателей или отправка всем клиентам
  // Если передан опциональный параметр `options.recipients` - используем его (массив telegramId строк).
  // options: { recipients: string[] | null, throttleMs: number, skipBanned: boolean }
  const MAX_RECIPIENTS = 250; // Максимальное количество получателей

  const results = [];

  // Normalize options for backward compatibility (old style: throttleMs number or object)
  let recipients = null;
  let optsThrottle = DEFAULT_THROTTLE_MS;
  let skipBanned = true;
  if (typeof options === "number") {
    optsThrottle = options;
  } else if (typeof options === "object" && options !== null) {
    const o = options;
    recipients = Array.isArray(o.recipients) ? o.recipients.map(String) : null;
    optsThrottle =
      typeof o.throttleMs === "number" ? o.throttleMs : DEFAULT_THROTTLE_MS;
    skipBanned = o.skipBanned !== false;
  }

  const bans = await readBans();

  // Build targets: either from recipients array or from clientsForBroadcast with telegramId
  // Если передан явный список получателей - используем его, иначе используем getClientsForBroadcast()
  const targets = [];
  if (recipients && recipients.length) {
    recipients.forEach((id) => targets.push({ telegramId: String(id) }));
  } else {
    // Используем getClientsForBroadcast() вместо getAllClients() для автоматической фильтрации
    const clientsForBroadcast = await sheetsService.getClientsForBroadcast();
    clientsForBroadcast.forEach((c) => {
      if (c && c.telegramId) targets.push({ telegramId: String(c.telegramId) });
    });
  }

  // Ограничение максимального количества получателей - берем первые 250
  const targetsToSend = targets.slice(0, MAX_RECIPIENTS);

  if (targets.length > MAX_RECIPIENTS) {
    // Предупреждение будет показано в предпросмотре, здесь просто ограничиваем
  }

  // Список успешно отправленных для отметки
  const sentIds = [];

  for (const c of targetsToSend) {
    const tid = String(c.telegramId || "");
    if (!tid) continue;

    // Пропускаем забаненных пользователей
    if (skipBanned) {
      if (bans.some((b) => String(b) === tid)) {
        continue;
      }
      if (sheetsService && sheetsService.getUserBanStatus) {
        try {
          const st = await sheetsService.getUserBanStatus(tid);
          if (st && st.banned) continue;
        } catch (e) {
          // игнорируем ошибки таблицы
        }
      }
    }

    let sendResult = null;

    if (payload && typeof payload === "object" && payload.kind === "photo") {
      // TODO: Требуется миграция file_id в URL или MAX token, так как MAX API требует URL или свой токен для uploadImage
      // Предполагаем, что payload.fileId — HTTPS URL (или уже MAX token)
      sendResult = await sendPhotoToUser(
        bot,
        tid,
        payload.fileId,
        payload.caption || "",
      );
    } else {
      const text =
        typeof payload === "string"
          ? payload
          : (payload && payload.text) || "";
      sendResult = await sendMessageToUser(bot, tid, text);
    }

    if (sendResult) {
      results.push({ id: tid, ok: true });
      sentIds.push(tid);
    } else {
      results.push({ id: tid, ok: false, error: "Failed to send message" });
    }
    if (optsThrottle) await new Promise((r) => setTimeout(r, optsThrottle));
  }

  // Отмечаем успешно отправленных клиентов меткой рассылки
  if (sentIds.length > 0 && sheetsService && sheetsService.markBroadcastSent) {
    try {
      await sheetsService.markBroadcastSent(sentIds);
    } catch (e) {
      // Логируем ошибку, но не прерываем выполнение
      console.error("Ошибка при отметке клиентов в рассылке:", e.message || e);
    }
  }

  return results;
}

module.exports = {
  isBanned,
  banUser,
  unbanUser,
  getBans,
  broadcastToClients,
  sendMessageToUser,
  sendPhotoToUser,
};
