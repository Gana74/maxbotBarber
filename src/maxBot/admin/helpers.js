const { ADMIN_MODE } = require("./constants");

function getUserId(ctx) {
  return ctx.user?.user_id;
}

function getMessageText(ctx) {
  return ctx.message?.body?.text?.trim() ?? "";
}

function getMessageCaption(ctx) {
  return getMessageText(ctx);
}

function getMessageImageRef(ctx) {
  const attachments = ctx.message?.body?.attachments;
  if (!Array.isArray(attachments)) {
    return null;
  }
  const image = attachments.find((a) => a?.type === "image");
  if (!image?.payload) {
    return null;
  }
  const { token, url } = image.payload;
  return token || url || null;
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
  getMessageImageRef,
  isAdminMode,
  clearAdminScenario,
  toIsoDate,
};
