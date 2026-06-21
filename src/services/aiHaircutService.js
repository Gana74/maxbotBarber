// src/services/aiHaircutService.js
// Сервис интеграции с Ranvik API для AI-примерки мужских стрижек

const RANVIK_API_URL = "https://api.ranvik.ru/v1/images/generations";
const RANVIK_TASKS_URL = "https://api.ranvik.ru/v1/tasks";

// ⚠️ ОСНОВНАЯ МОДЕЛЬ: nano-banana-2 @ 0.5K — 15.48₽ (проверенная рабочая модель)
const MODEL = "nano-banana-2";
const RESOLUTION = "0.5K"; // Экономия 30% по сравнению с 1K

// Порядок перебора при fallback:
// 1. nano-banana-2 @ 0.5K — основная, работает отлично, экономия 30%
// 2. nano-banana-pro — премиум-качество, если нужно лучше (45.88₽)
const MODELS_TO_TRY = [MODEL, "nano-banana-pro"];

const REQUEST_TIMEOUT_MS = 90000;
const USE_ASYNC_MODE = process.env.RANVIK_ASYNC_MODE === "true";
const ASYNC_POLL_INTERVAL_MS = 3000;
const ASYNC_POLL_TIMEOUT_MS = 120000;

const NEGATIVE_PROMPT = [
  "cartoon",
  "anime",
  "drawing",
  "painting",
  "illustration",
  "3d render",
  "low quality",
  "blurry",
  "pixelated",
  "overexposed",
  "underexposed",
  "distorted face",
  "extra limbs",
  "bad anatomy",
  "deformed",
  "disfigured",
  "mutated",
  "asymmetrical eyes",
  "cross-eyed",
  "pasted hair",
  "wig-like",
  "floating hair",
  "helmet hair",
  "unnatural hairline",
  "hair floating above head",
  "disconnected hair",
  "copied beard",
  "copied mustache",
  "copied stubble",
  "copied glasses",
  "copied accessories",
  "copied jewelry",
  "copied earrings",
  "gender change",
  "makeup",
  "lipstick",
  "eyeliner",
  "foundation",
  "different skin tone",
  "different age",
  "different person",
  "changed facial expression",
  "closed eyes",
  "unnatural lighting",
  "wrong shadows",
  "changed background",
  "changed clothing",
  "different clothes",
  "generic hairstyle",
  "default hairstyle",
  "common haircut style",
  "template haircut",
  "stock photo haircut",
  "catalog haircut",
  // ⚠️ КРИТИЧНО: защита от копирования цвета волос с референса
  "different hair color",
  "changed hair color",
  "copied hair color",
  "bleached hair",
  "dyed hair",
  "colored hair",
  "painted hair",
  "blonde hair on dark client",
  "dark hair on blonde client",
  "hair color mismatch",
  "unnatural hair color",
].join(", ");

function buildPrompt(templateName) {
  const styleName =
    templateName && String(templateName).trim()
      ? String(templateName).trim()
      : "men's barbershop haircut";

  return (
    `Image 1: MALE client selfie. Image 2: reference of "${styleName}" haircut.\n\n` +
    `TASK: Replace ONLY the hairstyle in Image 1 with EXACT haircut from Image 2. Result must be PIXEL-PERFECT replica.\n\n` +
    `CRITICAL RULES (priority order):\n\n` +
    `1. EXACT STYLE REPLICATION (HIGHEST):\n` +
    `   - Hairstyle MUST be EXACT copy of Image 2. Do NOT interpret, modify, or "improve".\n` +
    `   - Do NOT default to popular styles (side part, classic taper) — copy EXACTLY what's shown.\n` +
    `   - If undercut → result MUST be undercut (shaved sides, long top, disconnected). NOT side part.\n` +
    `   - If fade → result MUST be fade with exact same height/transition. NOT undercut.\n` +
    `   - Copy exact hairline, parting, direction, volume, length — even if unusual.\n\n` +
    `2. HAIR COLOR FROM IMAGE 1 ONLY (CRITICAL):\n` +
    `   - The hair color in the result MUST be EXACTLY the same as in Image 1.\n` +
    `   - Do NOT copy hair color from Image 2 — Image 2 is ONLY for hairstyle shape.\n` +
    `   - If client has dark hair in Image 1 → result has dark hair (even if Image 2 shows blonde).\n` +
    `   - If client has light hair in Image 1 → result has light hair (even if Image 2 shows dark).\n` +
    `   - Preserve natural hair color, highlights, and tones from Image 1.\n` +
    `   - Do NOT bleach, dye, or change hair color in any way.\n\n` +
    `3. FACE & IDENTITY (PRESERVE 100%):\n` +
    `   - Keep facial identity, bone structure, proportions unchanged.\n` +
    `   - Preserve eyes, nose, mouth, ears, skin tone, texture exactly as Image 1.\n` +
    `   - Preserve existing facial hair (beard, mustache, stubble) from Image 1.\n` +
    `   - Do NOT copy facial hair, glasses, accessories from reference.\n` +
    `   - Preserve original expression and head angle.\n\n` +
    `4. HAIR INTEGRATION:\n` +
    `   - Hair must look naturally grown from scalp — NOT pasted, NOT wig.\n` +
    `   - Match hair thickness, texture to client's natural hair from Image 1.\n` +
    `   - Preserve natural hairline on forehead.\n` +
    `   - Smooth fade/taper transition into skin if applicable.\n` +
    `   - Natural hair direction, flow, lay for "${styleName}" style.\n` +
    `   - Sideburns match haircut style.\n\n` +
    `5. PHOTOREALISM:\n` +
    `   - Sharp, high-quality, photorealistic portrait.\n` +
    `   - Hair texture interacts with existing lighting — matching shadows, highlights.\n` +
    `   - Natural skin-to-hair transitions at forehead, temples, neck.\n` +
    `   - Clean, sharp hairline — professional barbershop quality.\n\n` +
    `6. PRESERVE FROM IMAGE 1:\n` +
    `   - Keep background, clothing, neck, shoulders, pose exactly as Image 1.\n` +
    `   - Modify ONLY hairstyle on head and sides/back where haircut applies.\n\n` +
    `OUTPUT: Hyper-realistic barbershop photo — same man from Image 1, same face/clothes/background, same hair COLOR from Image 1, but with EXACT "${styleName}" hairstyle SHAPE from Image 2.`
  );
}

function getModelFamily(model) {
  if (!model) return "generic";
  const lower = model.toLowerCase();
  if (lower === "nano-banana-2") return "nano-banana-2";
  if (lower.startsWith("nano-banana")) return "nano-banana-pro";
  return "generic";
}

/**
 * Nano Banana 2 @ 0.5K — 15.48₽ (основная модель, экономия 30%)
 */
function buildNanoBanana2RequestBody(prompt, referenceImages) {
  return {
    model: "nano-banana-2",
    positivePrompt: prompt,
    inputs: {
      referenceImages,
    },
    resolution: RESOLUTION,
    numberResults: 1,
    outputType: "URL",
    outputFormat: "JPG",
    outputQuality: 95,
    async: USE_ASYNC_MODE,
  };
}

/**
 * Nano Banana Pro — 45.88₽ (премиум-качество)
 */
function buildNanoBananaProRequestBody(prompt, referenceImages) {
  return {
    model: "nano-banana-pro",
    prompt,
    reference_images: referenceImages,
    n: 1,
    aspect_ratio: "1:1",
  };
}

function buildRequestBody(model, prompt, referenceImages) {
  const family = getModelFamily(model);

  switch (family) {
    case "nano-banana-2":
      return buildNanoBanana2RequestBody(prompt, referenceImages);
    case "nano-banana-pro":
      return buildNanoBananaProRequestBody(prompt, referenceImages);
    default:
      return {
        model,
        prompt,
        reference_images: referenceImages,
        n: 1,
        size: "1024x1024",
      };
  }
}

function normalizeClientPhoto(clientPhoto) {
  if (!clientPhoto) return null;
  if (Buffer.isBuffer(clientPhoto)) {
    const encoded = clientPhoto.toString("base64");
    return encoded ? `data:image/jpeg;base64,${encoded}` : null;
  }
  if (typeof clientPhoto !== "string") return null;
  const trimmed = clientPhoto.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("data:image/") ||
    lower.startsWith("https://") ||
    lower.startsWith("http://")
  ) {
    return trimmed;
  }
  return `data:image/jpeg;base64,${trimmed}`;
}

function describeClientPhoto(clientPhoto) {
  const trimmed = clientPhoto.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("https://") || lower.startsWith("http://")) {
    return `[url] ${trimmed.slice(0, 120)}`;
  }
  if (lower.startsWith("data:image/")) {
    return `[data-uri] ${trimmed.slice(0, 24)}... (${trimmed.length} chars)`;
  }
  return `[base64] ${trimmed.length} chars`;
}

function isParameterSupportError(status, detail) {
  if (status !== 400 && status !== 422) return false;
  const text = String(detail).toLowerCase();
  return (
    text.includes("negative_prompt") ||
    text.includes("reference_images") ||
    text.includes("unknown parameter") ||
    text.includes("unsupported") ||
    text.includes("invalid parameter") ||
    text.includes("not supported") ||
    text.includes("unrecognized") ||
    text.includes("missing required")
  );
}

function isProviderModelError(status, detail) {
  if (status !== 400 && status !== 502 && status !== 503) return false;
  const text = String(detail).toLowerCase();
  return (
    text.includes("google") ||
    text.includes("provider") ||
    text.includes("no content") ||
    text.includes("invalid response")
  );
}

function isInsufficientFundsError(status, detail) {
  if (status !== 402) return false;
  const text = String(detail).toLowerCase();
  return text.includes("insufficient") || text.includes("funds");
}

function shouldRetryWithNextModel(result, hasNextModel) {
  if (!hasNextModel) return false;
  return (
    isParameterSupportError(result.status, result.detail) ||
    isProviderModelError(result.status, result.detail)
  );
}

async function pollAsyncTask(apiKey, taskId) {
  const startTime = Date.now();

  while (Date.now() - startTime < ASYNC_POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS));

    try {
      const response = await fetch(`${RANVIK_TASKS_URL}/${taskId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        console.warn(
          `[aiHaircutService] pollAsyncTask HTTP ${response.status}`,
        );
        continue;
      }

      const data = await response.json();
      const status = data?.status;

      console.log(`[aiHaircutService] async task ${taskId} status: ${status}`);

      if (status === "completed") {
        const url = data?.data?.[0]?.url;
        if (url) {
          return { ok: true, url };
        }
        return { ok: false, status: 0, detail: "no URL in completed task" };
      }

      if (status === "failed" || status === "canceled") {
        return {
          ok: false,
          status: 500,
          detail: data?.error || `task ${status}`,
        };
      }
    } catch (error) {
      console.warn(`[aiHaircutService] pollAsyncTask error:`, error);
    }
  }

  return { ok: false, status: 408, detail: "async polling timeout" };
}

async function callRanvikApi(apiKey, requestBody) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(RANVIK_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorDetail = "";
      try {
        const errorBody = await response.json();
        errorDetail =
          errorBody?.error?.message ??
          errorBody?.message ??
          JSON.stringify(errorBody);
      } catch {
        try {
          errorDetail = await response.text();
        } catch {
          // ignore
        }
      }

      return {
        ok: false,
        status: response.status,
        detail: errorDetail || response.statusText,
      };
    }

    const responseBody = await response.json();

    if (USE_ASYNC_MODE && responseBody?.id) {
      console.log(`[aiHaircutService] async task created: ${responseBody.id}`);
      return pollAsyncTask(apiKey, responseBody.id);
    }

    const resultUrl = responseBody?.data?.[0]?.url ?? null;

    if (!resultUrl) {
      return {
        ok: false,
        status: 0,
        detail: "no image URL in response",
      };
    }

    return { ok: true, url: resultUrl };
  } catch (error) {
    if (error.name === "AbortError") {
      return {
        ok: false,
        status: 408,
        detail: `request timeout after ${REQUEST_TIMEOUT_MS}ms`,
      };
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateHaircut(clientPhoto, templatePhotoUrl, templateName) {
  const apiKey = process.env.RANVIK_API_KEY;
  if (!apiKey) {
    console.error(
      "[aiHaircutService] generateHaircut error: RANVIK_API_KEY is not set",
    );
    return { url: null };
  }

  const prompt = buildPrompt(templateName);
  const normalizedClientPhoto = normalizeClientPhoto(clientPhoto);
  if (!normalizedClientPhoto) {
    console.error(
      "[aiHaircutService] generateHaircut error: invalid clientPhoto",
    );
    return { url: null };
  }

  const referenceImages = [normalizedClientPhoto, templatePhotoUrl];

  for (let index = 0; index < MODELS_TO_TRY.length; index += 1) {
    const model = MODELS_TO_TRY[index];
    const requestBody = buildRequestBody(model, prompt, referenceImages);

    console.log(
      `[aiHaircutService] === Attempt ${index + 1}/${MODELS_TO_TRY.length} ===`,
    );
    console.log(`[aiHaircutService] model: ${model}`);
    console.log(`[aiHaircutService] prompt length: ${prompt.length}`);
    console.log(
      `[aiHaircutService] reference images:`,
      describeClientPhoto(normalizedClientPhoto),
      `[template-url] ${templatePhotoUrl.slice(0, 120)}`,
    );
    console.log(`[aiHaircutService] async mode: ${USE_ASYNC_MODE}`);
    console.log(`[aiHaircutService] timeout: ${REQUEST_TIMEOUT_MS}ms`);

    try {
      const result = await callRanvikApi(apiKey, requestBody);

      if (result.ok) {
        console.log(`[aiHaircutService] ✅ success with model: ${model}`);
        console.log(
          `[aiHaircutService] result URL: ${result.url.slice(0, 150)}`,
        );
        return { url: result.url };
      }

      if (isInsufficientFundsError(result.status, result.detail)) {
        console.warn(
          `[aiHaircutService] ⚠️ insufficient Ranvik balance for model ${model}: ${result.detail}`,
        );
        return { url: null, errorCode: "insufficient_funds" };
      }

      const nextModel = MODELS_TO_TRY[index + 1];
      if (shouldRetryWithNextModel(result, Boolean(nextModel))) {
        console.warn(
          `[aiHaircutService] ⚠️ model ${model} failed (HTTP ${result.status}), retrying with ${nextModel}: ${result.detail}`,
        );
        continue;
      }

      console.error(
        `[aiHaircutService] ❌ generateHaircut error: HTTP ${result.status} — ${result.detail}`,
      );
      return { url: null };
    } catch (error) {
      console.error(`[aiHaircutService] ❌ generateHaircut exception:`, error);
      return { url: null };
    }
  }

  return { url: null };
}

module.exports = {
  generateHaircut,
  buildPrompt,
};
