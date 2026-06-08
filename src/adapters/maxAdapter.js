/**
 * Адаптер MAX Bot API — эмуляция интерфейса Telegraf для сервисов и утилит.
 * Не меняет бизнес-логику в src/services/; подключается снаружи (index, handlers).
 */

const { Keyboard, ImageAttachment } = require("@maxhub/max-bot-api");
const { persistChatId, resolveChatId } = require("../utils/maxChat");

class MaxAdapter {
  /**
   * @param {object} config — конфиг приложения (managerChatId и др.)
   * @param {object} sheetsService — сервис Google Sheets
   * @param {object|null} calendarService — сервис Google Calendar
   * @param {import('@maxhub/max-bot-api').Bot} bot — экземпляр MAX Bot
   */
  constructor(config, sheetsService, calendarService, bot) {
    if (!config || !bot?.api) {
      throw new Error("[MaxAdapter] config и bot с полем api обязательны");
    }

    this.config = config;
    this.sheetsService = sheetsService;
    this.calendarService = calendarService ?? null;
    this.bot = bot;
    this.api = bot.api;
  }

  /**
   * Совместимость с safeMessaging (bot.telegram.sendMessage).
   */
  get telegram() {
    return {
      sendMessage: (chatId, text, options) =>
        this.sendMessage(chatId, text, options),
      sendPhoto: (chatId, photo, options = {}) =>
        this.sendPhoto(chatId, photo, options.caption ?? "", options),
    };
  }

  /**
   * ID пользователя MAX из контекста (аналог ctx.from.id).
   * @param {import('@maxhub/max-bot-api').Context} ctx
   * @returns {number|undefined}
   */
  getUserId(ctx) {
    return ctx?.user?.user_id;
  }

  /**
   * Проверка прав администратора.
   * @param {import('@maxhub/max-bot-api').Context} ctx
   * @returns {boolean}
   */
  isAdmin(ctx) {
    const userId = this.getUserId(ctx);
    if (userId == null || this.config.managerChatId == null) {
      return false;
    }
    return userId === Number(this.config.managerChatId);
  }

  /**
   * Отправка текста пользователю (аналог bot.telegram.sendMessage).
   * @param {number|string} userId
   * @param {string} text
   * @param {object} [extra] — format, attachments, link и др. (SendMessageExtra)
   * @returns {Promise<object|null>}
   */
  async sendMessage(userId, text, extra = {}) {
    if (userId == null || userId === "") {
      console.error("[MaxAdapter] sendMessage: пустой userId");
      return null;
    }

    try {
      return await this.api.sendMessageToUser(Number(userId), text, extra);
    } catch (err) {
      this._logSendError("sendMessage", userId, err);
      return null;
    }
  }

  /**
   * Отправка изображения по URL или token MAX.
   * @param {number|string} userId
   * @param {string} urlOrToken — HTTPS URL или token уже загруженного файла
   * @param {string} [caption]
   * @param {object} [extra] — доп. параметры sendMessage (без caption)
   * @returns {Promise<object|null>}
   */
  async sendPhoto(userId, urlOrToken, caption = "", extra = {}) {
    if (userId == null || userId === "") {
      console.error("[MaxAdapter] sendPhoto: пустой userId");
      return null;
    }

    if (!urlOrToken) {
      console.error("[MaxAdapter] sendPhoto: пустой urlOrToken");
      return null;
    }

    try {
      const imageAttachment = await this._resolveImageAttachment(urlOrToken);
      const { caption: _omit, ...rest } = extra;
      const attachments = [
        imageAttachment.toJson(),
        ...(Array.isArray(rest.attachments) ? rest.attachments : []),
      ];

      return await this.api.sendMessageToUser(Number(userId), caption, {
        ...rest,
        attachments,
      });
    } catch (err) {
      this._logSendError("sendPhoto", userId, err);
      return null;
    }
  }

  /**
   * Сообщение с inline-клавиатурой.
   * @param {number|string} userId
   * @param {string} text
   * @param {Array} keyboardArray — ряды кнопок (см. _buildInlineKeyboard)
   * @param {object} [extra]
   * @returns {Promise<object|null>}
   */
  async sendKeyboard(userId, text, keyboardArray, extra = {}) {
    const keyboard = this._buildInlineKeyboard(keyboardArray);
    if (!keyboard) {
      console.error("[MaxAdapter] sendKeyboard: не удалось собрать клавиатуру");
      return null;
    }

    const attachments = [
      keyboard,
      ...(Array.isArray(extra.attachments) ? extra.attachments : []),
    ];

    return this.sendMessage(userId, text, { ...extra, attachments });
  }

  /**
   * MAX API требует непустой text при отправке сообщения.
   * @param {string} [text]
   * @returns {string}
   * @private
   */
  _normalizeReplyText(text) {
    const value = text == null ? "" : String(text);
    return value.trim() === "" ? "Сообщение" : value;
  }

  /**
   * Ответ в текущий чат (аналог ctx.reply).
   * При message_callback chatId может отсутствовать — тогда отправка по user_id.
   * @param {import('@maxhub/max-bot-api').Context} ctx
   * @param {string} text
   * @param {object} [extra]
   */
  async reply(ctx, text, extra = {}) {
    if (!ctx) {
      console.error("[MaxAdapter] reply: ctx недоступен");
      return null;
    }

    const messageText = this._normalizeReplyText(text);
    persistChatId(ctx);
    const userId = this.getUserId(ctx);
    let chatId =
      ctx.chatId != null ? Number(ctx.chatId) : resolveChatId(ctx);
    if (
      chatId != null &&
      userId != null &&
      Number(chatId) === Number(userId)
    ) {
      chatId = null;
    }
    const hasAttachments =
      Array.isArray(extra.attachments) && extra.attachments.length > 0;

    try {
      if (chatId != null) {
        return await this.api.sendMessageToChat(
          chatId,
          messageText,
          extra,
        );
      }

      if (!hasAttachments && userId != null) {
        return await this.api.sendMessageToUser(
          Number(userId),
          messageText,
          extra,
        );
      }

      if (userId != null) {
        return await this.api.sendMessageToUser(
          Number(userId),
          messageText,
          extra,
        );
      }

      console.error(
        "[MaxAdapter] reply: нет chatId",
        hasAttachments ? "(нужен для вложений)" : "",
        "и userId",
      );
      return null;
    } catch (err) {
      this._logSendError("reply", userId ?? chatId, err);
      return null;
    }
  }

  /**
   * Ответ на callback-кнопку (обязательны notification или message).
   * @param {import('@maxhub/max-bot-api').Context} ctx
   * @param {object} [extra]
   */
  async answerCallback(ctx, extra = {}) {
    const callbackId = ctx?.callback?.callback_id;
    if (!callbackId) {
      return null;
    }

    const payload = { ...extra };
    if (payload.message == null && payload.notification == null) {
      payload.notification = " ";
    }

    try {
      return await ctx.answerOnCallback(payload);
    } catch (err) {
      console.error("[MaxAdapter] answerCallback:", err.message || err);
      return null;
    }
  }

  /**
   * @param {string} urlOrToken
   * @returns {Promise<import('@maxhub/max-bot-api').ImageAttachment>}
   * @private
   */
  async _resolveImageAttachment(urlOrToken) {
    const value = String(urlOrToken).trim();

    if (/^https?:\/\//i.test(value)) {
      return this.api.uploadImage({ url: value });
    }

    return new ImageAttachment({ token: value });
  }

  /**
   * Преобразует массив рядов кнопок в attachment inline_keyboard.
   * Поддерживает:
   * - готовый объект Keyboard.inlineKeyboard (type === 'inline_keyboard')
   * - кнопки MAX ({ type: 'callback', text, payload })
   * - Telegraf-стиль { text, callback_data }
   * - кортеж ['Подпись', 'payload']
   * - строку payload (текст = payload)
   *
   * @param {Array} keyboardArray
   * @returns {object|null}
   * @private
   */
  _buildInlineKeyboard(keyboardArray) {
    if (!keyboardArray) {
      return null;
    }

    if (
      keyboardArray.type === "inline_keyboard" &&
      keyboardArray.payload?.buttons
    ) {
      return keyboardArray;
    }

    if (!Array.isArray(keyboardArray) || keyboardArray.length === 0) {
      return null;
    }

    const rows = keyboardArray.map((row) => {
      const buttons = Array.isArray(row) ? row : [row];
      return buttons.map((btn) => this._normalizeButton(btn));
    });

    return Keyboard.inlineKeyboard(rows);
  }

  /**
   * @param {object|string|Array} btn
   * @returns {object}
   * @private
   */
  _normalizeButton(btn) {
    if (btn == null) {
      throw new Error("[MaxAdapter] пустая кнопка в клавиатуре");
    }

    if (typeof btn === "object" && btn.type) {
      if (btn.type === "callback" && btn.payload != null) {
        return Keyboard.button.callback(btn.text, String(btn.payload), btn);
      }
      if (btn.type === "link" && btn.url) {
        return Keyboard.button.link(btn.text, btn.url);
      }
      return btn;
    }

    if (Array.isArray(btn) && btn.length >= 2) {
      const [text, payload] = btn;
      return Keyboard.button.callback(String(text), String(payload));
    }

    if (typeof btn === "object") {
      const text = btn.text ?? btn.label ?? String(btn.callback_data ?? "");
      const payload =
        btn.callback_data ?? btn.payload ?? btn.data ?? text;

      if (btn.url) {
        return Keyboard.button.link(text, btn.url);
      }

      return Keyboard.button.callback(text, String(payload));
    }

    const payload = String(btn);
    return Keyboard.button.callback(payload, payload);
  }

  /**
   * @private
   */
  _logSendError(method, targetId, err) {
    const message = err?.message ?? String(err);
    const code = err?.status ?? err?.code;

    console.error(
      `[MaxAdapter] ${method} → ${targetId}: ${message}${code != null ? ` (code: ${code})` : ""}`,
    );
  }
}

module.exports = { MaxAdapter };
