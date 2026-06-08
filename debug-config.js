// debug-config.js
require("dotenv").config();

console.log("=== ДИАГНОСТИКА ЧТЕНИЯ GOOGLE_PRIVATE_KEY ===\n");

const rawKey = process.env.GOOGLE_PRIVATE_KEY;

if (!rawKey) {
  console.log("❌ GOOGLE_PRIVATE_KEY не найден в process.env");
  process.exit(1);
}

console.log("1. Длина ключа:", rawKey.length, "символов");
console.log("2. Первые 50 символов:", JSON.stringify(rawKey.substring(0, 50)));
console.log(
  "3. Последние 50 символов:",
  JSON.stringify(rawKey.substring(rawKey.length - 50)),
);
console.log('4. Начинается с кавычки "?', rawKey.startsWith('"'));
console.log('5. Заканчивается кавычкой "?', rawKey.endsWith('"'));
console.log("6. Содержит реальные переносы строк:", rawKey.includes("\n"));
console.log("7. Содержит экранированные \\n:", rawKey.includes("\\n"));

// Пробуем очистить ключ (как это делает src/config/index.js)
let cleanedKey = rawKey.replace(/\\n/g, "\n");

// Дополнительная очистка: убираем кавычки в начале и конце, если они есть
if (cleanedKey.startsWith('"') && cleanedKey.endsWith('"')) {
  console.log("\n⚠️ ОБНАРУЖЕНЫ КАВЫЧКИ В КЛЮЧЕ! Убираю их...");
  cleanedKey = cleanedKey.slice(1, -1);
}

console.log("\n8. После очистки:");
console.log(
  "   Первые 50 символов:",
  JSON.stringify(cleanedKey.substring(0, 50)),
);
console.log(
  "   Последние 50 символов:",
  JSON.stringify(cleanedKey.substring(cleanedKey.length - 50)),
);

// Пробуем авторизоваться с очищенным ключом
console.log("\n9. Попытка авторизации с очищенным ключом...");
const { google } = require("googleapis");

async function test() {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: cleanedKey,
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      fields: "sheets.properties.title",
    });

    console.log("✅ УСПЕХ! Таблица доступна с очищенным ключом.");
    console.log(
      "Листы:",
      res.data.sheets.map((s) => s.properties.title).join(", "),
    );
    console.log(
      "\n💡 РЕШЕНИЕ: Нужно обновить src/config/index.js, чтобы он убирал кавычки из ключа.",
    );
  } catch (error) {
    console.error("❌ ОШИБКА:", error.message);
    if (
      error.message.includes("PEM") ||
      error.message.includes("invalid_grant")
    ) {
      console.log(
        "\n💡 ПРИЧИНА: Ключ всё ещё повреждён. Попробуйте записать его в .env БЕЗ кавычек, но с реальными переводами строк (многострочный формат).",
      );
    }
  }
}

test();
