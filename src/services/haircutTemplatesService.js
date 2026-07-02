/**
 * Сервис шаблонов стрижек для AI-подбора.
 * Хранение в haircutTemplates.json (паттерн как services.json).
 */

const fs = require("fs");
const path = require("path");
const { validateSafeUrl } = require("../utils/security");

const TEMPLATES_FILE = path.resolve(process.cwd(), "haircutTemplates.json");

/** Порядок слайдов в карусели */
const TEMPLATE_ORDER = [
  "crop",
  "quiff",
  "caesar",
  "mullet",
  "kanadka",
  "flow",
  "undercut",
  "side_part",
  "slick_back",
  "curtains",
];

/** @type {Record<string, { id: string, name: string, description?: string, photoUrl: string, serviceKey: string }>} */
const SEED_TEMPLATES = {
  crop: {
    id: "crop",
    name: "Кроп",
    description: "Короткая текстурная стрижка с объёмом на макушке",
    photoUrl:
      "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=800",
    serviceKey: "MEN_HAIRCUT",
  },
  quiff: {
    id: "quiff",
    name: "Квифф",
    description: "Объём спереди, уложенные вверх пряди",
    photoUrl:
      "https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=800",
    serviceKey: "MEN_HAIRCUT",
  },
  caesar: {
    id: "caesar",
    name: "Цезарь",
    description: "Короткая чёлка по лбу, ровная линия",
    photoUrl:
      "https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=800",
    serviceKey: "MEN_HAIRCUT",
  },
  mullet: {
    id: "mullet",
    name: "Маллет",
    description: "Коротко спереди и по бокам, длиннее сзади",
    photoUrl:
      "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=800",
    serviceKey: "MEN_HAIRCUT",
  },
  kanadka: {
    id: "kanadka",
    name: "Канадка",
    description: "Короткие виски и затылок, длинная чёлка вперёд",
    photoUrl:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800",
    serviceKey: "MEN_HAIRCUT",
  },
  flow: {
    id: "flow",
    name: "Флоу",
    description: "Средняя длина с естественным «течением» волос",
    photoUrl:
      "https://images.unsplash.com/photo-1552053831-71594a27632d?w=800",
    serviceKey: "MEN_HAIRCUT",
  },
  undercut: {
    id: "undercut",
    name: "Андеркат",
    description: "Короткие виски и затылок, длинный верх",
    photoUrl:
      "https://images.unsplash.com/photo-1605497788041-6f7a0e4e0b0a?w=800",
    serviceKey: "MEN_HAIRCUT",
  },
  side_part: {
    id: "side_part",
    name: "Сайд парт",
    description: "Классический пробор с одной стороны",
    photoUrl:
      "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=800",
    serviceKey: "MEN_HAIRCUT",
  },
  slick_back: {
    id: "slick_back",
    name: "Слик бэк",
    description: "Волосы зачёсаны назад, гладкая укладка",
    photoUrl:
      "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=800",
    serviceKey: "MEN_HAIRCUT",
  },
  curtains: {
    id: "curtains",
    name: "Шторы (Кёртейнс)",
    description: "Средняя чёлка, расходящаяся от центра",
    photoUrl:
      "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=800",
    serviceKey: "MEN_HAIRCUT",
  },
};

/**
 * @param {object} template
 * @param {string} id
 * @returns {{ id: string, name: string, description: string, photoUrl: string, serviceKey: string }|null}
 */
function normalizeTemplate(template, id) {
  if (!template || !template.name) {
    return null;
  }
  const photoUrl = String(template.photoUrl || "").trim();
  if (!validateSafeUrl(photoUrl)) {
    return null;
  }
  const templateId = template.id || id;
  if (!validateTemplateId(templateId)) {
    return null;
  }
  return {
    id: templateId,
    name: String(template.name).trim(),
    description: String(template.description || "").trim(),
    photoUrl,
    serviceKey: template.serviceKey || "MEN_HAIRCUT",
  };
}

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
 * @returns {Array<{ id: string, name: string, description: string, photoUrl: string, serviceKey: string }>}
 */
function getAllTemplates() {
  const templates = loadTemplates();
  const ordered = [];

  for (const id of TEMPLATE_ORDER) {
    const normalized = normalizeTemplate(templates[id], id);
    if (normalized) {
      ordered.push(normalized);
    }
  }

  for (const [id, template] of Object.entries(templates)) {
    if (TEMPLATE_ORDER.includes(id)) {
      continue;
    }
    const normalized = normalizeTemplate(template, id);
    if (normalized) {
      ordered.push(normalized);
    }
  }

  return ordered;
}

/**
 * @param {string} id
 * @returns {{ id: string, name: string, description: string, photoUrl: string, serviceKey: string }|null}
 */
function getTemplateById(id) {
  if (!validateTemplateId(id)) {
    return null;
  }
  const templates = loadTemplates();
  return normalizeTemplate(templates[id], id);
}

migrateFromSeed();

module.exports = {
  getAllTemplates,
  getTemplateById,
  validateTemplateId,
  loadTemplates,
  saveTemplates,
  TEMPLATE_ORDER,
};
