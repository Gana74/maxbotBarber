/**
 * Шифрование бэкапов sessions.json / banned.json (AES-256-CBC).
 */

const crypto = require("crypto");

const ALGORITHM = "aes-256-cbc";
const KEY_LEN = 32;
const IV_LEN = 16;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/**
 * Генерирует ключ из пароля через scrypt.
 * @param {string} password
 * @param {Buffer} salt
 * @returns {Buffer}
 */
function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_OPTIONS);
}

/**
 * Шифрует данные для бэкапа.
 * @param {string|object} data — строка или объект (будет JSON.stringify)
 * @param {string} password
 * @returns {string} base64-encoded payload: salt:iv:ciphertext
 */
function encryptBackup(data, password) {
  if (!password || typeof password !== "string") {
    throw new Error("Password is required for backup encryption");
  }

  const plaintext =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);

  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    salt.toString("base64"),
    iv.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Расшифровывает бэкап.
 * @param {string} encrypted — формат salt:iv:ciphertext (base64)
 * @param {string} password
 * @returns {string}
 */
function decryptBackup(encrypted, password) {
  if (!password || typeof password !== "string") {
    throw new Error("Password is required for backup decryption");
  }

  const parts = String(encrypted).split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted backup format");
  }

  const [saltB64, ivB64, dataB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");
  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

module.exports = {
  encryptBackup,
  decryptBackup,
};
