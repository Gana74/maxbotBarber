const { ADMIN_MODE } = require("./constants");
const { validateCallbackTimestamp } = require("../../utils/security");

function getUserId(ctx) {
  return ctx.user?.user_id;
}

function getMessageText(ctx) {
  return ctx.message?.body?.text?.trim() ?? "";
}

function getMessageCaption(ctx) {
  return getMessageText(ctx);
}

function getMessageImageAttachment(ctx) {
  const attachments = ctx.message?.body?.attachments;
  if (!Array.isArray(attachments)) {
    return null;
  }
  return attachments.find((a) => a?.type === "image") || null;
}

function getMessageImageRef(ctx) {
  const image = getMessageImageAttachment(ctx);
  if (!image?.payload) {
    return null;
  }
  const { token, url } = image.payload;
  return token || url || null;
}

/**
 * Defense in depth: проверка актуальности callback timestamp.
 * @param {object} ctx
 * @param {import('../../adapters/maxAdapter').MaxAdapter} [adapter]
 * @returns {boolean}
 */
async function guardCallback(ctx, adapter) {
  const result = validateCallbackTimestamp(ctx);
  if (result.valid) {
    return true;
  }
  if (adapter) {
    await adapter.answerCallback(ctx, {
      notification: "Действие устарело. Повторите запрос.",
    });
  }
  return false;
}

function isAdminMode(ctx) {
  return ctx.session?.mode === ADMIN_MODE;
}

function clearAdminScenario(ctx) {
  if (!ctx.session) return;
  delete ctx.session.adminAction;
  delete ctx.session.servicesAction;
  delete ctx.session.scheduleAction;
  delete ctx.session.fromSettings;
}

function toIsoDate(raw) {
  const value = (raw || "").trim();
  if (!value) return null;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(value)) {
    const [dd, mm, yyyy] = value.split(".");
    return `${yyyy}-${mm}-${dd}`;
  }
  return value;
}

module.exports = {
  getUserId,
  getMessageText,
  getMessageCaption,
  getMessageImageAttachment,
  getMessageImageRef,
  guardCallback,
  isAdminMode,
  clearAdminScenario,
  toIsoDate,
};
