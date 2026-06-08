/**
 * chat_id для MAX: в диалоге у message_created recipient.chat_id часто null,
 * но chat_id приходит в bot_started и в message_callback.message.
 */

/**
 * @param {object} [update]
 * @returns {number|null}
 */
function readChatIdFromUpdate(update) {
  if (!update) {
    return null;
  }

  if (update.chat_id != null) {
    return Number(update.chat_id);
  }

  const recipientChatId = update.message?.recipient?.chat_id;
  if (recipientChatId != null) {
    return Number(recipientChatId);
  }

  const linkChatId = update.message?.link?.chat_id;
  if (linkChatId != null) {
    return Number(linkChatId);
  }

  return null;
}

/**
 * @param {import('@maxhub/max-bot-api').Context} ctx
 * @returns {number|null}
 */
function resolveChatId(ctx) {
  const fromUpdate = readChatIdFromUpdate(ctx?.update);
  if (fromUpdate != null) {
    return fromUpdate;
  }

  if (ctx?.chatId != null) {
    return Number(ctx.chatId);
  }

  if (ctx?.session?.maxChatId != null) {
    return Number(ctx.session.maxChatId);
  }

  return null;
}

/**
 * Сохраняет chat_id в сессию, если удалось определить.
 * @param {import('@maxhub/max-bot-api').Context} ctx
 * @returns {number|null}
 */
function persistChatId(ctx) {
  const chatId = resolveChatId(ctx);
  if (chatId != null && ctx?.session) {
    ctx.session.maxChatId = chatId;
  }
  return chatId;
}

module.exports = {
  readChatIdFromUpdate,
  resolveChatId,
  persistChatId,
};
