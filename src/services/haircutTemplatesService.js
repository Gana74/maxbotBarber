/**
 * Сервис шаблонов стрижек для AI-подбора.
 * Хранение в haircutTemplates.json (паттерн как services.json).
 */

const fs = require("fs");
const path = require("path");
const { validateSafeUrl } = require("../utils/security");

const TEMPLATES_FILE = path.resolve(process.cwd(), "haircutTemplates.json");

/** @type {Record<string, { id: string, name: string, photoUrl: string, serviceKey: string }>} */
const SEED_TEMPLATES = {
  fade_low: {
    id: "fade_low",
    name: "Низкий fade",
    photoUrl:
      "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=512",
    serviceKey: "MEN_HAIRCUT",
  },
  fade_mid: {
    id: "fade_mid",
    name: "Средний fade",
    photoUrl:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=512",
    serviceKey: "MEN_HAIRCUT",
  },
  classic_short: {
    id: "classic_short",
    name: "Классика короткая",
    photoUrl:
      "https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=512",
    serviceKey: "MEN_HAIRCUT",
  },
  undercut: {
    id: "undercut",
    name: "Андеркат",
    photoUrl:
      "https://images.unsplash.com/photo-1605497788041-6f7a0e4e0b0a?w=512",
    serviceKey: "MEN_HAIRCUT",
  },
  pompadour: {
    id: "pompadour",
    name: "Помпадур",
    photoUrl:
      "https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=512",
    serviceKey: "MEN_HAIRCUT",
  },
  buzzcut: {
    id: "buzzcut",
    name: "Под машинку",
    photoUrl:
      "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=512",
    serviceKey: "BUZZCUT",
  },
  textured_crop: {
    id: "textured_crop",
    name: "Текстурный кроп",
    photoUrl:
      "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=512",
    serviceKey: "MEN_HAIRCUT",
  },
  side_part: {
    id: "side_part",
    name: "С пробором",
    photoUrl:
      "https://images.unsplash.com/photo-1552053831-71594a27632d?w=512",
    serviceKey: "MEN_HAIRCUT",
  },
  curly_top: {
    id: "curly_top",
    name: "Кудри сверху",
    photoUrl:
      "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=512",
    serviceKey: "MEN_HAIRCUT",
  },
  long_layers: {
    id: "long_layers",
    name: "Длинные слои",
    photoUrl:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=512",
    serviceKey: "WOMEN_HAIRCUT",
  },
};

/**
 * @param {string} id
 * @returns {boolean}
 */
function validateTemplateId(id) {
  if (!id || typeof id !== "string") {
    return false;
  }
  return /^[a-z0-9_]+$/.test(id);
}

function migrateFromSeed() {
  try {
    if (fs.existsSync(TEMPLATES_FILE)) {
      return;
    }
    console.log(
      "[haircutTemplatesService] Creating haircutTemplates.json from seed...",
    );
    saveTemplates(SEED_TEMPLATES);
  } catch (e) {
    console.error("[haircutTemplatesService] migrateFromSeed error:", e.message);
  }
}

/**
 * @returns {Record<string, object>}
 */
function loadTemplates() {
  try {
    if (!fs.existsSync(TEMPLATES_FILE)) {
      migrateFromSeed();
    }
    const content = fs.readFileSync(TEMPLATES_FILE, { encoding: "utf8" });
    const parsed = JSON.parse(content || "{}");
    return parsed;
  } catch (e) {
    console.warn(
      "[haircutTemplatesService] Failed to load haircutTemplates.json:",
      e.message,
    );
    return SEED_TEMPLATES;
  }
}

/**
 * @param {Record<string, object>} templates
 * @returns {boolean}
 */
function saveTemplates(templates) {
  try {
    const content = JSON.stringify(templates, null, 2);
    fs.writeFileSync(TEMPLATES_FILE, content, { encoding: "utf8" });
    return true;
  } catch (e) {
    console.error(
      "[haircutTemplatesService] Failed to save haircutTemplates.json:",
      e.message,
    );
    return false;
  }
}

/**
 * @returns {Array<{ id: string, name: string, photoUrl: string, serviceKey: string }>}
 */
function getAllTemplates() {
  const templates = loadTemplates();
  return Object.values(templates).filter(
    (t) =>
      t &&
      validateTemplateId(t.id) &&
      t.name &&
      validateSafeUrl(String(t.photoUrl || "").trim()),
  );
}

/**
 * @param {string} id
 * @returns {{ id: string, name: string, photoUrl: string, serviceKey: string }|null}
 */
function getTemplateById(id) {
  if (!validateTemplateId(id)) {
    return null;
  }
  const templates = loadTemplates();
  const template = templates[id];
  if (!template || !template.name) {
    return null;
  }
  const photoUrl = String(template.photoUrl || "").trim();
  if (!validateSafeUrl(photoUrl)) {
    return null;
  }
  return {
    id: template.id || id,
    name: String(template.name).trim(),
    photoUrl,
    serviceKey: template.serviceKey || "MEN_HAIRCUT",
  };
}

migrateFromSeed();

module.exports = {
  getAllTemplates,
  getTemplateById,
  validateTemplateId,
  loadTemplates,
  saveTemplates,
};
