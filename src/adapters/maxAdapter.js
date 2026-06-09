/**
 * Адаптер MAX Bot API для сервисов и handlers.
 */

const { Keyboard, ImageAttachment } = require("@maxhub/max-bot-api");
const { persistChatId, resolveChatId } = require("../utils/maxChat");
const { schedule } = require("../utils/apiRateLimiter");
const { enforceKeyboardLimits } = require("../utils/maxKeyboard");

/**
 * Проверяет структуру ответа MAX API.
 * @param {object|null} response
 * @param {string[]} [expectedFields]
 * @returns {boolean}
 */
function validateApiResponse(response, expectedFields = []) {
  if (response === null) {
    return false;
  }
  if (response === undefined) {
    return true;
  }
  if (typeof response !== "object") {
    return true;
  }
  if (!expectedFields.length) {
    return true;
  }
  return expectedFields.every((field) => field in response);
}

class MaxAdapter {
  /**
   * @param {object} config
   * @param {object} sheetsService
   * @param {object|null} calendarService
   * @param {import('@maxhub/max-bot-api').Bot} bot
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

  getUserId(ctx) {
    return ctx?.user?.user_id;
  }

  isAdmin(ctx) {
    const userId = this.getUserId(ctx);
    if (userId == null || this.config.managerChatId == null) {
      return false;
    }
    return userId === Number(this.config.managerChatId);
  }

  async sendMessage(userId, text, extra = {}) {
    if (userId == null || userId === "") {
      console.error("[MaxAdapter] sendMessage: пустой userId");
      return null;
    }

    try {
      const result = await schedule(() =>
        this.api.sendMessageToUser(Number(userId), text, extra),
      );
      if (!validateApiResponse(result)) {
        console.warn("[MaxAdapter] sendMessage: unexpected API response");
        return null;
      }
      return result;
    } catch (err) {
      this._logSendError("sendMessage", userId, err);
      return null;
    }
  }

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

      const result = await schedule(() =>
        this.api.sendMessageToUser(Number(userId), caption, {
          ...rest,
          attachments,
        }),
      );
      if (!validateApiResponse(result)) {
        console.warn("[MaxAdapter] sendPhoto: unexpected API response");
        return null;
      }
      return result;
    } catch (err) {
      this._logSendError("sendPhoto", userId, err);
      return null;
    }
  }

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

  _normalizeReplyText(text) {
    const value = text == null ? "" : String(text);
    return value.trim() === "" ? "Сообщение" : value;
  }

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
        const result = await schedule(() =>
          this.api.sendMessageToChat(chatId, messageText, extra),
        );
        if (!validateApiResponse(result)) {
          console.warn("[MaxAdapter] reply(chat): unexpected API response");
          return null;
        }
        return result;
      }

      if (userId != null) {
        const result = await schedule(() =>
          this.api.sendMessageToUser(Number(userId), messageText, extra),
        );
        if (!validateApiResponse(result)) {
          console.warn("[MaxAdapter] reply(user): unexpected API response");
          return null;
        }
        return result;
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

  async uploadImage(options) {
    try {
      const result = await schedule(() => this.api.uploadImage(options));
      if (!result || (result.token == null && typeof result.toJson !== "function")) {
        console.warn("[MaxAdapter] uploadImage: unexpected API response");
        return null;
      }
      return result;
    } catch (err) {
      this._logSendError("uploadImage", "api", err);
      return null;
    }
  }

  async _resolveImageAttachment(urlOrToken) {
    const value = String(urlOrToken).trim();

    if (/^https?:\/\//i.test(value)) {
      const uploaded = await this.uploadImage({ url: value });
      if (!uploaded?.token) {
        throw new Error("uploadImage did not return token");
      }
      return new ImageAttachment({ token: uploaded.token });
    }

    return new ImageAttachment({ token: value });
  }

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

    const rows = enforceKeyboardLimits(
      keyboardArray.map((row) => {
        const buttons = Array.isArray(row) ? row : [row];
        return buttons.map((btn) => this._normalizeButton(btn));
      }),
    );

    return Keyboard.inlineKeyboard(rows);
  }

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

  _logSendError(method, targetId, err) {
    const message = err?.message ?? String(err);
    const code = err?.status ?? err?.code;

    console.error(
      `[MaxAdapter] ${method} → ${targetId}: ${message}${code != null ? ` (code: ${code})` : ""}`,
    );
  }
}

module.exports = { MaxAdapter, validateApiResponse };
