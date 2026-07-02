const fs = require("fs");
const path = require("path");
const { downloadImageBuffer } = require("./imageDownloader");

const ASSETS_DIR = path.resolve(process.cwd(), "assets/haircut-templates");

/** Альтернативные имена файлов (опечатки в assets) */
const LOCAL_FILE_ALIASES = {
  quiff: ["qiff"],
};

/**
 * @param {string} templateId
 * @returns {string[]}
 */
function getLocalCandidatePaths(templateId) {
  const bases = [templateId, ...(LOCAL_FILE_ALIASES[templateId] || [])];
  const exts = [".jpg", ".jpeg", ".png", ".webp"];
  const paths = [];

  for (const base of bases) {
    for (const ext of exts) {
      paths.push(path.join(ASSETS_DIR, `${base}${ext}`));
    }
  }

  return paths;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function guessMimeFromPath(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/**
 * @param {string} templateId
 * @returns {{ buffer: Buffer, source: string }|null}
 */
function readLocalTemplatePhoto(templateId) {
  for (const filePath of getLocalCandidatePaths(templateId)) {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(ASSETS_DIR)) {
      continue;
    }
    if (!fs.existsSync(resolved)) {
      continue;
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      continue;
    }

    return {
      buffer: fs.readFileSync(resolved),
      source: path.basename(resolved),
    };
  }

  return null;
}

/**
 * @param {Buffer} buffer
 * @param {string} [mime='image/jpeg']
 * @returns {string}
 */
function bufferToDataUrl(buffer, mime = "image/jpeg") {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/**
 * Локальный файл из assets/haircut-templates/ → fallback на photoUrl.
 * @param {{ id: string, photoUrl?: string }} template
 * @returns {Promise<Buffer|null>}
 */
async function resolveTemplatePhotoBuffer(template) {
  if (!template?.id) {
    return null;
  }

  const local = readLocalTemplatePhoto(template.id);
  if (local?.buffer) {
    console.log(
      `[templatePhotoResolver] local file for ${template.id}:`,
      local.source,
    );
    return local.buffer;
  }

  if (template.photoUrl) {
    const remote = await downloadImageBuffer(template.photoUrl);
    if (remote) {
      console.log(
        `[templatePhotoResolver] remote URL for ${template.id}:`,
        template.photoUrl.slice(0, 80),
      );
      return remote;
    }
    console.warn(
      `[templatePhotoResolver] remote URL unavailable for ${template.id}`,
    );
  }

  return null;
}

/**
 * Для Ranvik API: data URL из локального файла или скачанного буфера.
 * @param {{ id: string, photoUrl?: string }} template
 * @returns {Promise<string|null>}
 */
async function resolveTemplatePhotoForRanvik(template) {
  if (!template?.id) {
    return null;
  }

  const local = readLocalTemplatePhoto(template.id);
  if (local?.buffer) {
    const mime = guessMimeFromPath(local.source);
    return bufferToDataUrl(local.buffer, mime);
  }

  const buffer = await downloadImageBuffer(template.photoUrl);
  if (buffer) {
    return bufferToDataUrl(buffer);
  }

  return template.photoUrl || null;
}

module.exports = {
  resolveTemplatePhotoBuffer,
  resolveTemplatePhotoForRanvik,
  readLocalTemplatePhoto,
};
