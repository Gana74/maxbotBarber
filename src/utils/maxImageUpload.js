const { downloadImageBuffer } = require("./imageDownloader");
const { resolveTemplatePhotoBuffer } = require("./templatePhotoResolver");

/**
 * Скачивает изображение по HTTPS и загружает в MAX через buffer upload.
 * Не используйте uploadImage({ url }) — MAX часто не может забрать внешний URL сам.
 * @param {import('@maxhub/max-bot-api').Api} api
 * @param {string} url
 * @param {boolean} [checkAccessibility=false]
 * @returns {Promise<object|null>} ImageAttachment или null
 */
async function uploadImageFromUrlWithApi(api, url, checkAccessibility = false) {
  if (!api?.uploadImage || !url) {
    return null;
  }

  const buffer = await downloadImageBuffer(url, checkAccessibility);
  if (!buffer) {
    console.warn("[maxImageUpload] failed to download image for MAX upload");
    return null;
  }

  try {
    const image = await api.uploadImage({ source: buffer });
    if (!image) {
      console.warn("[maxImageUpload] uploadImage returned empty result");
      return null;
    }
    return image;
  } catch (error) {
    console.warn(
      "[maxImageUpload] uploadImage error:",
      error?.message || String(error),
    );
    return null;
  }
}

/**
 * @param {object} ctx
 * @param {string} url
 * @param {boolean} [checkAccessibility=false]
 * @returns {Promise<object|null>}
 */
async function uploadImageFromUrl(ctx, url, checkAccessibility = false) {
  return uploadImageFromUrlWithApi(ctx?.api, url, checkAccessibility);
}

/**
 * @param {import('@maxhub/max-bot-api').Api} api
 * @param {Buffer} buffer
 * @returns {Promise<object|null>}
 */
async function uploadImageFromBufferWithApi(api, buffer) {
  if (!api?.uploadImage || !buffer?.length) {
    return null;
  }

  try {
    const image = await api.uploadImage({ source: buffer });
    if (!image) {
      console.warn("[maxImageUpload] uploadImage returned empty result");
      return null;
    }
    return image;
  } catch (error) {
    console.warn(
      "[maxImageUpload] uploadImageFromBuffer error:",
      error?.message || String(error),
    );
    return null;
  }
}

/**
 * @param {object} ctx
 * @param {Buffer} buffer
 * @returns {Promise<object|null>}
 */
async function uploadImageFromBuffer(ctx, buffer) {
  return uploadImageFromBufferWithApi(ctx?.api, buffer);
}

/**
 * Локальный assets/haircut-templates/ → fallback photoUrl.
 * @param {object} ctx
 * @param {{ id: string, photoUrl?: string }} template
 * @returns {Promise<object|null>}
 */
async function uploadTemplatePhoto(ctx, template) {
  const buffer = await resolveTemplatePhotoBuffer(template);
  if (!buffer) {
    return null;
  }
  return uploadImageFromBuffer(ctx, buffer);
}

module.exports = {
  uploadImageFromUrl,
  uploadImageFromUrlWithApi,
  uploadImageFromBuffer,
  uploadImageFromBufferWithApi,
  uploadTemplatePhoto,
};
