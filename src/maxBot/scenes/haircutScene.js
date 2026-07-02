/**
 * Сценарий AI-подбора стрижки для MAX Bot.
 * Состояние: ctx.session.haircutAction
 */

const { Keyboard } = require("@maxhub/max-bot-api");
const { generateHaircut } = require("../../services/aiHaircutService");
const {
  getAllTemplates,
  getTemplateById,
} = require("../../services/haircutTemplatesService");
const { downloadImageAsBase64 } = require("../../utils/imageDownloader");
const { uploadImageFromUrl, uploadTemplatePhoto } = require("../../utils/maxImageUpload");
const { resolveTemplatePhotoForRanvik } = require("../../utils/templatePhotoResolver");
const aiResultCache = require("../../utils/aiResultCache");
const { enforceKeyboardLimits } = require("../../utils/maxKeyboard");
const {
  validateImageAttachment,
  parseCallbackPayload,
} = require("../../utils/security");
const {
  getMessageImageAttachment,
  guardCallback,
} = require("../admin/helpers");
const {
  createShowUserMainMenu,
  DEFAULT_MAIN_MENU_MESSAGE,
} = require("../showUserMainMenu");

/** @typedef {'choosing_template'|'awaiting_selfie'|'showing_result'} HaircutStep */

const STEPS = {
  CHOOSING_TEMPLATE: "choosing_template",
  AWAITING_SELFIE: "awaiting_selfie",
  SHOWING_RESULT: "showing_result",
};

const HAIRCUT_STEPS = new Set(Object.values(STEPS));

const SELFIE_INSTRUCTIONS =
  "📸 Отлично! Теперь пришлите своё селфи:\n\n" +
  "• Снимок анфас\n" +
  "• Хорошее освещение\n" +
  "• Без очков и головных уборов\n\n" +
  "Отправьте фото в этот чат.";

/**
 * @param {object} ctx
 * @returns {number|undefined}
 */
function getUserId(ctx) {
  return ctx.user?.user_id;
}

/**
 * @param {object} ctx
 * @returns {boolean}
 */
function isHaircutActive(ctx) {
  const step = ctx.session?.haircutAction?.step;
  return Boolean(step && HAIRCUT_STEPS.has(step));
}

/**
 * @param {object} ctx
 */
function clearHaircutSession(ctx) {
  if (!ctx.session) {
    return;
  }
  delete ctx.session.haircutAction;
}

/**
 * Сбрасывает сценарий записи, если был активен.
 * @param {object} ctx
 */
function clearBookingSession(ctx) {
  if (!ctx.session) {
    return;
  }
  delete ctx.session.flow;
  delete ctx.session.step;
  delete ctx.session.data;
}

/**
 * @param {object} ctx
 * @returns {object}
 */
function ensureHaircutAction(ctx) {
  ctx.session = ctx.session || {};
  ctx.session.haircutAction = ctx.session.haircutAction || {};
  return ctx.session.haircutAction;
}

/**
 * @param {{ name: string, description?: string }} template
 * @param {number} index
 * @param {number} total
 * @returns {string}
 */
function buildCarouselCaption(template, index, total) {
  let text = `✨ Стиль: ${template.name}`;
  if (template.description) {
    text += `\n${template.description}`;
  }
  text += `\n\n${index + 1} из ${total}`;
  return text;
}

/**
 * @param {{ id: string, name: string, description?: string }} template
 * @param {number} index
 * @param {number} total
 * @returns {import('@maxhub/max-bot-api').InlineKeyboardAttachment}
 */
function buildCarouselKeyboard(template, index, total) {
  const navRow = [];

  if (index > 0) {
    navRow.push(
      Keyboard.button.callback(
        "← Предыдущая",
        `haircut_carousel:prev:${index}`,
      ),
    );
  }

  navRow.push(
    Keyboard.button.callback(
      "Выбрать эту ✅",
      `haircut_carousel:select:${template.id}`,
    ),
  );

  if (index < total - 1) {
    navRow.push(
      Keyboard.button.callback(
        "Следующая →",
        `haircut_carousel:next:${index}`,
      ),
    );
  }

  return Keyboard.inlineKeyboard(
    enforceKeyboardLimits([
      navRow,
      [Keyboard.button.callback("Отмена ❌", "haircut_menu")],
    ]),
  );
}

/**
 * @param {object} ctx
 * @returns {string|null}
 */
function getCallbackMessageId(ctx) {
  return ctx.messageId || ctx.message?.body?.mid || null;
}

/**
 * @returns {import('@maxhub/max-bot-api').InlineKeyboardAttachment}
 */
function buildResultKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback("Записаться на эту стрижку", "haircut_book")],
    [Keyboard.button.callback("Попробовать другой вариант", "haircut_retry")],
    [Keyboard.button.callback("В главное меню", "haircut_menu")],
  ]);
}

/**
 * @returns {import('@maxhub/max-bot-api').InlineKeyboardAttachment}
 */
function buildErrorKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback("Попробовать снова", "haircut_retry_selfie")],
    [Keyboard.button.callback("Выбрать другой вариант", "haircut_retry")],
    [Keyboard.button.callback("В главное меню", "haircut_menu")],
  ]);
}

/**
 * @returns {import('@maxhub/max-bot-api').InlineKeyboardAttachment}
 */
function buildExpiredSessionKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback("Начать заново", "haircut_start")],
    [Keyboard.button.callback("В главное меню", "haircut_menu")],
  ]);
}

/**
 * @param {import('../../adapters/maxAdapter').MaxAdapter} adapter
 * @param {object} sheetsService
 * @param {object} bookingHandlers
 */
function createHaircutHandlers(adapter, sheetsService, bookingHandlers) {
  const showMainMenu = createShowUserMainMenu(adapter);

  /**
   * @param {object} ctx
   * @param {string} [message]
   */
  const returnToMainMenu = async (ctx, message = DEFAULT_MAIN_MENU_MESSAGE) => {
    clearHaircutSession(ctx);
    await showMainMenu(ctx, message);
  };

  /**
   * Отправка нового сообщения с каруселью (первый показ / retry).
   * @param {object} ctx
   * @param {number} index
   */
  const sendCarouselMessage = async (ctx, index) => {
    const templates = getAllTemplates();
    if (!templates.length) {
      await adapter.reply(
        ctx,
        "Шаблоны стрижек временно недоступны. Попробуйте позже.",
      );
      await returnToMainMenu(ctx);
      return;
    }

    const safeIndex = Math.max(0, Math.min(index, templates.length - 1));
    const template = templates[safeIndex];
    const caption = buildCarouselCaption(template, safeIndex, templates.length);
    const keyboard = buildCarouselKeyboard(template, safeIndex, templates.length);

    try {
      const image = await uploadTemplatePhoto(ctx, template);
      if (!image) {
        throw new Error("uploadTemplatePhoto returned empty result");
      }
      await adapter.reply(ctx, caption, {
        attachments: [image.toJson(), keyboard],
      });
    } catch (error) {
      console.warn("[haircutScene] carousel uploadImage failed:", error);
      await adapter.reply(
        ctx,
        `${caption}\n\n⚠️ Не удалось загрузить фото референса.`,
        { attachments: [keyboard] },
      );
    }
  };

  /**
   * Обновление существующего сообщения карусели через messages.edit.
   * @param {object} ctx
   * @param {number} index
   */
  const updateCarouselMessage = async (ctx, index) => {
    const templates = getAllTemplates();
    if (!templates.length) {
      await sendCarouselMessage(ctx, 0);
      return;
    }

    const messageId = getCallbackMessageId(ctx);
    if (!messageId) {
      await sendCarouselMessage(ctx, index);
      return;
    }

    const safeIndex = Math.max(0, Math.min(index, templates.length - 1));
    const template = templates[safeIndex];
    const caption = buildCarouselCaption(template, safeIndex, templates.length);
    const keyboard = buildCarouselKeyboard(template, safeIndex, templates.length);

    try {
      const image = await uploadTemplatePhoto(ctx, template);
      if (!image) {
        throw new Error("uploadTemplatePhoto returned empty result");
      }

      await ctx.api.editMessage(messageId, {
        text: caption,
        attachments: [image.toJson(), keyboard],
      });
    } catch (error) {
      console.warn("[haircutScene] updateCarouselMessage failed:", error);
      await sendCarouselMessage(ctx, safeIndex);
    }
  };

  /**
   * Карусель референсов стрижек.
   * @param {object} ctx
   * @param {number} [index]
   */
  const showTemplateCarousel = async (ctx, index = 0) => {
    const action = ensureHaircutAction(ctx);
    action.step = STEPS.CHOOSING_TEMPLATE;
    action.carouselIndex = Math.max(0, index);
    delete action.selectedTemplate;
    delete action.lastResultUrl;

    await sendCarouselMessage(ctx, action.carouselIndex);
  };

  /**
   * Шаг 1: показать карусель шаблонов.
   * @param {object} ctx
   */
  const showTemplateStep = async (ctx) => {
    await showTemplateCarousel(ctx, 0);
  };

  /**
   * Старт сценария из главного меню.
   * @param {object} ctx
   */
  const startHaircutFlow = async (ctx) => {
    const userId = getUserId(ctx);
    console.log("[haircutScene] start user_id=", userId);

    ctx.session = ctx.session || {};
    clearBookingSession(ctx);
    ensureHaircutAction(ctx);

    await showTemplateStep(ctx);
  };

  /**
   * Листание карусели.
   * @param {object} ctx
   * @param {'prev'|'next'} direction
   * @param {number} currentIndexFromPayload
   */
  const handleCarouselNav = async (ctx, direction, currentIndexFromPayload) => {
    const action = ctx.session?.haircutAction;
    if (!action || action.step !== STEPS.CHOOSING_TEMPLATE) {
      await adapter.reply(
        ctx,
        "Сессия истекла. Начните подбор стрижки заново.",
        { attachments: [buildExpiredSessionKeyboard()] },
      );
      return;
    }

    const templates = getAllTemplates();
    if (!templates.length) {
      await showTemplateStep(ctx);
      return;
    }

    const total = templates.length;
    let index = Number.isFinite(currentIndexFromPayload)
      ? currentIndexFromPayload
      : action.carouselIndex ?? 0;

    if (direction === "prev") {
      index = Math.max(0, index - 1);
    } else {
      index = Math.min(total - 1, index + 1);
    }

    action.carouselIndex = index;

    await updateCarouselMessage(ctx, index);
  };

  /**
   * Шаг 2: подтверждение выбора из карусели.
   * @param {object} ctx
   * @param {string} templateIdFromPayload
   */
  const handleCarouselSelect = async (ctx, templateIdFromPayload) => {
    const action = ctx.session?.haircutAction;
    if (!action || action.step !== STEPS.CHOOSING_TEMPLATE) {
      await adapter.reply(
        ctx,
        "Сессия истекла. Начните подбор стрижки заново.",
        { attachments: [buildExpiredSessionKeyboard()] },
      );
      return;
    }

    const templateId = String(templateIdFromPayload || "").trim();
    const template =
      (templateId && getTemplateById(templateId)) || null;

    if (!template) {
      await showTemplateStep(ctx);
      return;
    }

    console.log(
      "[haircutScene] template selected id=",
      template.id,
      "name=",
      template.name,
    );

    action.selectedTemplate = template;
    action.step = STEPS.AWAITING_SELFIE;

    await adapter.reply(
      ctx,
      `Вы выбрали: «${template.name}»\n\n${SELFIE_INSTRUCTIONS}`,
    );
  };

  /**
   * Шаг 4–5: генерация и отправка результата.
   * @param {object} ctx
   * @param {string|Buffer} clientPhoto
   */
  const runGeneration = async (ctx, clientPhoto) => {
    const action = ctx.session?.haircutAction;
    const template = action?.selectedTemplate;
    const userId = getUserId(ctx);

    if (!template?.photoUrl && !template?.id) {
      await adapter.reply(ctx, "Сессия истекла. Начните заново.", {
        attachments: [buildExpiredSessionKeyboard()],
      });
      return;
    }

    const referencePhoto = await resolveTemplatePhotoForRanvik(template);
    if (!referencePhoto) {
      await adapter.reply(ctx, "Сессия истекла. Начните заново.", {
        attachments: [buildExpiredSessionKeyboard()],
      });
      return;
    }

    await adapter.reply(
      ctx,
      "⏳ ИИ обрабатывает ваше фото... Это займёт 15-30 секунд.",
    );

    let generationResult = { url: null };
    try {
      generationResult = await generateHaircut(
        clientPhoto,
        referencePhoto,
        template.name,
      );
    } catch (error) {
      console.error("[haircutScene] generateHaircut exception:", error);
    }

    const resultUrl = generationResult?.url ?? null;
    if (!resultUrl) {
      console.log("[haircutScene] generation result failed user_id=", userId);
      action.step = STEPS.AWAITING_SELFIE;
      const errorMessage =
        generationResult?.errorCode === "insufficient_funds"
          ? "Сервис ИИ временно недоступен: на балансе Ranvik недостаточно средств для генерации. Попробуйте позже."
          : "К сожалению, не удалось обработать фото. Попробуйте другое селфи (анфас, хорошее освещение) или повторите позже.";
      await adapter.reply(ctx, errorMessage, {
        attachments: [buildErrorKeyboard()],
      });
      return;
    }

    console.log(
      "[haircutScene] generation result ok user_id=",
      userId,
      "url=",
      resultUrl.slice(0, 150),
    );
    action.step = STEPS.SHOWING_RESULT;
    action.lastResultUrl = resultUrl;

    // Фаза 1: Сразу скачиваем результат с retry (пока CDN свежий)
    // Это решает проблему с недоступностью cdn.ranvik.ru при загрузке в MAX
    console.log("[haircutScene] downloading result from CDN...");
    const resultBase64 = await downloadImageAsBase64(resultUrl, true); // true = check accessibility

    if (!resultBase64) {
      console.error("[haircutScene] failed to download result image from CDN");
      action.step = STEPS.AWAITING_SELFIE;
      await adapter.reply(
        ctx,
        "К сожалению, результат генерации временно недоступен (ошибка загрузки). Попробуйте позже или выберите другую стрижку.",
        { attachments: [buildErrorKeyboard()] },
      );
      return;
    }

    // Фаза 2: Кэшируем результат в памяти
    try {
      const bufferMatch = resultBase64.match(/base64,(.+)$/);
      if (bufferMatch) {
        const buffer = Buffer.from(bufferMatch[1], "base64");
        const cached = aiResultCache.set(resultUrl, buffer);
        if (cached) {
          const stats = aiResultCache.getStats();
          console.log(
            "[haircutScene] result cached successfully, cache stats:",
            stats,
          );
        }
      }
    } catch (cacheError) {
      console.warn(
        "[haircutScene] failed to cache result:",
        cacheError.message,
      );
    }

    // Фаза 3: Загружаем в MAX API
    const caption =
      `✨ Вот как может выглядеть стрижка «${template.name}» на вас!\n\n` +
      "Это примерный результат ИИ — финальный вид уточнит мастер на приёме.";

    try {
      console.log("[haircutScene] uploading result to MAX API...");
      const image = await uploadImageFromUrl(ctx, resultUrl, true);
      if (!image) {
        throw new Error("uploadImageFromUrl returned empty result");
      }
      console.log("[haircutScene] successfully uploaded to MAX");
      await adapter.reply(ctx, caption, {
        attachments: [image.toJson(), buildResultKeyboard()],
      });
    } catch (uploadError) {
      const errorMsg = uploadError?.message || String(uploadError);
      console.error(
        "[haircutScene] failed to upload result image to MAX:",
        errorMsg,
      );

      // Если это была сетевая ошибка (socket/network) - есть кэш
      const isNetworkError =
        errorMsg.toLowerCase().includes("socket") ||
        errorMsg.toLowerCase().includes("fetch") ||
        errorMsg.toLowerCase().includes("econnrefused") ||
        errorMsg.toLowerCase().includes("enotfound");

      if (isNetworkError) {
        console.log("[haircutScene] network error detected, cache available");
      }

      // Отправляем сообщение об ошибке
      await adapter.reply(
        ctx,
        `${caption}\n\n⚠️ Не удалось отправить изображение. Пожалуйста, попробуйте позже (результат закэширован на сервере).`,
        { attachments: [buildResultKeyboard()] },
      );
    }
  };

  /**
   * Шаг 3: получение селфи.
   * @param {object} ctx
   */
  const handleSelfieMessage = async (ctx) => {
    const action = ctx.session?.haircutAction;
    if (!action || action.step !== STEPS.AWAITING_SELFIE) {
      return;
    }

    const attachment = getMessageImageAttachment(ctx);
    if (!attachment) {
      const text = ctx.message?.body?.text?.trim() ?? "";
      if (text) {
        await adapter.reply(
          ctx,
          "Пожалуйста, пришлите фото (не текст). Нужно селфи анфас с хорошим освещением.",
        );
      } else {
        await adapter.reply(
          ctx,
          "Не удалось распознать изображение. Пришлите фото в формате JPEG, PNG или WebP.",
        );
      }
      return;
    }

    const validation = validateImageAttachment(attachment);
    if (!validation.valid) {
      await adapter.reply(
        ctx,
        "Пожалуйста, отправьте фото в формате JPEG, PNG или WebP размером до 10 МБ.",
      );
      return;
    }

    const payload = attachment.payload || attachment;
    const clientPhotoUrl = payload?.url || attachment?.url || null;
    if (!clientPhotoUrl) {
      await adapter.reply(
        ctx,
        "Не удалось загрузить ваше фото. Попробуйте отправить другое фото или напишите /cancel для отмены.",
        { attachments: [buildErrorKeyboard()] },
      );
      return;
    }

    const size =
      payload?.size ??
      payload?.file_size ??
      payload?.fileSize ??
      attachment.size ??
      null;
    let urlHost = "unknown";
    try {
      urlHost = new URL(clientPhotoUrl).host || "unknown";
    } catch (error) {
      // ignore invalid URL parse in logs
    }
    console.log(
      "[haircutScene] selfie attachment received:",
      `host=${urlHost}`,
      `size=${size ?? "unknown"}`,
    );

    const downloadStartedAt = Date.now();
    let clientPhotoBase64 = null;
    try {
      clientPhotoBase64 = await downloadImageAsBase64(clientPhotoUrl);
      const downloadDurationMs = Date.now() - downloadStartedAt;
      if (clientPhotoBase64) {
        console.log(
          "[haircutScene] selfie downloaded:",
          `bytes=${Buffer.byteLength(clientPhotoBase64, "utf8")}`,
          `ms=${downloadDurationMs}`,
        );
      } else {
        console.warn(
          "[haircutScene] selfie download failed:",
          `ms=${downloadDurationMs}`,
          `host=${urlHost}`,
        );
      }
    } catch (error) {
      console.error("[haircutScene] downloadImageAsBase64 error:", error);
    }
    if (!clientPhotoBase64) {
      await adapter.reply(
        ctx,
        "Не удалось загрузить ваше фото. Попробуйте отправить другое фото или напишите /cancel для отмены.",
        { attachments: [buildErrorKeyboard()] },
      );
      return;
    }

    await runGeneration(ctx, clientPhotoBase64);
    clientPhotoBase64 = null;
  };

  /**
   * Переход к записи с предвыбранной услугой.
   * @param {object} ctx
   */
  const handleBookCallback = async (ctx) => {
    const action = ctx.session?.haircutAction;
    const template = action?.selectedTemplate;
    const serviceKey = template?.serviceKey || "MEN_HAIRCUT";

    clearHaircutSession(ctx);

    if (typeof bookingHandlers.startBookingWithService === "function") {
      await bookingHandlers.startBookingWithService(ctx, serviceKey);
    } else {
      await adapter.reply(
        ctx,
        "Запись временно недоступна. Используйте /book для записи.",
      );
      await showMainMenu(ctx);
    }
  };

  return {
    startHaircutFlow,
    showTemplateStep,
    showTemplateCarousel,
    handleCarouselNav,
    handleCarouselSelect,
    handleSelfieMessage,
    handleBookCallback,
    returnToMainMenu,
    showMainMenu,
    isHaircutActive,
  };
}

/**
 * @param {object} ctx
 * @param {import('../../adapters/maxAdapter').MaxAdapter} adapter
 * @param {Function} showMainMenuFn
 * @returns {Promise<boolean>}
 */
async function cancelHaircutIfActive(ctx, adapter, showMainMenuFn) {
  if (!isHaircutActive(ctx)) {
    return false;
  }
  clearHaircutSession(ctx);
  await showMainMenuFn(
    ctx,
    "Подбор стрижки отменён.\n\n" + DEFAULT_MAIN_MENU_MESSAGE,
  );
  return true;
}

/**
 * @param {import('@maxhub/max-bot-api').Bot} bot
 * @param {import('../../adapters/maxAdapter').MaxAdapter} adapter
 * @param {object} sheetsService
 * @param {object} bookingHandlers
 */
function registerHaircutScene(bot, adapter, sheetsService, bookingHandlers) {
  const h = createHaircutHandlers(adapter, sheetsService, bookingHandlers);

  bot.action("haircut_start", async (ctx) => {
    await adapter.answerCallback(ctx);
    await h.startHaircutFlow(ctx);
  });

  bot.action(/^haircut_carousel:prev:\d+$/, async (ctx) => {
    if (!(await guardCallback(ctx, adapter))) {
      return;
    }
    const payload = ctx.update?.callback?.payload || "";
    const suffix = parseCallbackPayload(payload, "haircut_carousel:prev:");
    const currentIndex =
      suffix != null ? Number.parseInt(suffix, 10) : NaN;
    await adapter.answerCallback(ctx);
    await h.handleCarouselNav(ctx, "prev", currentIndex);
  });

  bot.action(/^haircut_carousel:next:\d+$/, async (ctx) => {
    if (!(await guardCallback(ctx, adapter))) {
      return;
    }
    const payload = ctx.update?.callback?.payload || "";
    const suffix = parseCallbackPayload(payload, "haircut_carousel:next:");
    const currentIndex =
      suffix != null ? Number.parseInt(suffix, 10) : NaN;
    await adapter.answerCallback(ctx);
    await h.handleCarouselNav(ctx, "next", currentIndex);
  });

  bot.action(/^haircut_carousel:select:.+$/, async (ctx) => {
    if (!(await guardCallback(ctx, adapter))) {
      return;
    }
    const payload = ctx.update?.callback?.payload || "";
    const templateId = parseCallbackPayload(
      payload,
      "haircut_carousel:select:",
    );
    await adapter.answerCallback(ctx);
    await h.handleCarouselSelect(ctx, templateId || "");
  });

  bot.action("haircut_retry", async (ctx) => {
    await adapter.answerCallback(ctx);
    await h.showTemplateStep(ctx);
  });

  bot.action("haircut_retry_selfie", async (ctx) => {
    await adapter.answerCallback(ctx);
    const action = ctx.session?.haircutAction;
    if (action?.selectedTemplate) {
      action.step = STEPS.AWAITING_SELFIE;
      await adapter.reply(ctx, SELFIE_INSTRUCTIONS);
    } else {
      await h.showTemplateStep(ctx);
    }
  });

  bot.action("haircut_menu", async (ctx) => {
    await adapter.answerCallback(ctx);
    await h.returnToMainMenu(ctx);
  });

  bot.action("haircut_book", async (ctx) => {
    if (!(await guardCallback(ctx, adapter))) {
      return;
    }
    await adapter.answerCallback(ctx);
    await h.handleBookCallback(ctx);
  });

  bot.on("message_created", async (ctx, next) => {
    const text = ctx.message?.body?.text?.trim() ?? "";
    if (text.startsWith("/start")) {
      return next();
    }

    if (!h.isHaircutActive(ctx)) {
      return next();
    }

    if (ctx.session.haircutAction.step === STEPS.AWAITING_SELFIE) {
      await h.handleSelfieMessage(ctx);
      return;
    }

    await adapter.reply(ctx, "Используйте кнопки под сообщением.");
  });

  return h;
}

module.exports = {
  registerHaircutScene,
  cancelHaircutIfActive,
  isHaircutActive,
  STEPS,
  createHaircutHandlers,
};
