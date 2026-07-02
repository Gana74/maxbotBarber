const fs = require("fs").promises;
const path = require("path");
const { ImageAttachment } = require("@maxhub/max-bot-api");
const { schedule } = require("../utils/apiRateLimiter");
const { uploadImageFromUrlWithApi } = require("../utils/maxImageUpload");

const BANS_FILE = path.resolve(process.cwd(), "banned.json");

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

async function isBanned(maxUserId) {
  const bans = await readBans();
  return bans.some((b) => String(b) === String(maxUserId));
}

async function banUser(maxUserId, reason = "", sheetsService = null) {
  const bans = await readBans();
  if (!bans.some((b) => String(b) === String(maxUserId))) {
    bans.push(String(maxUserId));
    await writeBans(bans);
  }
  // Синхронизируем с таблицей, если сервис передан
  try {
    if (sheetsService && sheetsService.setUserBanStatus) {
      await sheetsService.setUserBanStatus(maxUserId, true, reason || "");
    }
  } catch (e) {
    // не прерываем, если не удалось записать в таблицу
  }
  return true;
}

async function unbanUser(maxUserId, sheetsService = null) {
  const maxUserIdStr = String(maxUserId);
  let bans = await readBans();
  const initialLength = bans.length;
  bans = bans.filter((b) => String(b) !== maxUserIdStr);
  const removed = initialLength !== bans.length;

  // Удаляем пользователя из banned.json, если он там был
  if (removed) {
    await writeBans(bans);
  }

  // Всегда синхронизируем с таблицей, если сервис передан
  // Это нужно, чтобы очистить статус бана в таблице, даже если пользователя не было в banned.json
  try {
    if (sheetsService && sheetsService.setUserBanStatus) {
      await sheetsService.setUserBanStatus(maxUserIdStr, false, "");
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
    return await schedule(() =>
      bot.api.sendMessageToUser(Number(userId), text, options),
    );
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
      imageAttachment = await schedule(() =>
        uploadImageFromUrlWithApi(bot.api, value),
      );
      if (!imageAttachment) {
        return null;
      }
    } else {
      imageAttachment = new ImageAttachment({ token: value });
    }

    return await schedule(() =>
      bot.api.sendMessageToUser(Number(userId), caption, {
        attachments: [imageAttachment.toJson()],
      }),
    );
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
  // Если передан опциональный параметр `options.recipients` - используем его (массив maxUserId строк).
  // options: { recipients: string[] | null, throttleMs: number, skipBanned: boolean }
  const MAX_RECIPIENTS = 250; // Максимальное количество получателей

  const results = [];

  // Normalize options for backward compatibility (old style: throttleMs number or object)
  let recipients = null;
  let skipBanned = true;
  if (typeof options === "object" && options !== null) {
    const o = options;
    recipients = Array.isArray(o.recipients) ? o.recipients.map(String) : null;
    skipBanned = o.skipBanned !== false;
  }

  const bans = await readBans();

  // Build targets: either from recipients array or from clientsForBroadcast with maxUserId
  // Если передан явный список получателей - используем его, иначе используем getClientsForBroadcast()
  const targets = [];
  if (recipients && recipients.length) {
    recipients.forEach((id) => targets.push({ maxUserId: String(id) }));
  } else {
    // Используем getClientsForBroadcast() вместо getAllClients() для автоматической фильтрации
    const clientsForBroadcast = await sheetsService.getClientsForBroadcast();
    clientsForBroadcast.forEach((c) => {
      if (c && c.maxUserId) targets.push({ maxUserId: String(c.maxUserId) });
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
    const maxUserId = String(c.maxUserId || "");
    if (!maxUserId) continue;

    // Пропускаем забаненных пользователей
    if (skipBanned) {
      if (bans.some((b) => String(b) === maxUserId)) {
        continue;
      }
      if (sheetsService && sheetsService.getUserBanStatus) {
        try {
          const st = await sheetsService.getUserBanStatus(maxUserId);
          if (st && st.banned) continue;
        } catch (e) {
          // игнорируем ошибки таблицы
        }
      }
    }

    let sendResult = null;

    if (payload && typeof payload === "object" && payload.kind === "photo") {
      // Предполагаем, что payload.fileId — HTTPS URL (или уже MAX token)
      sendResult = await sendPhotoToUser(
        bot,
        maxUserId,
        payload.fileId,
        payload.caption || "",
      );
    } else {
      const text =
        typeof payload === "string"
          ? payload
          : (payload && payload.text) || "";
      sendResult = await sendMessageToUser(bot, maxUserId, text);
    }

    if (sendResult) {
      results.push({ id: maxUserId, ok: true });
      sentIds.push(maxUserId);
    } else {
      results.push({ id: maxUserId, ok: false, error: "Failed to send message" });
    }
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
