const s = require("../src/utils/security");
const l = require("../src/utils/logger");
const b = require("../src/utils/backup");

const inj = s.sanitizeSheetsInput("=CMD");
if (!inj.startsWith("'")) {
  throw new Error("formula injection failed");
}

const masked = l.maskSensitiveData({
  phone: "+79161234567",
  name: "Иван Петров",
});
if (!String(masked.phone).includes("****")) {
  throw new Error("phone masking failed");
}

const old = s.validateCallbackTimestamp({
  update: { timestamp: Date.now() - 11 * 60 * 1000 },
});
if (old.valid) {
  throw new Error("callback expiry failed");
}

const enc = b.encryptBackup({ test: 1 }, "password");
const dec = JSON.parse(b.decryptBackup(enc, "password"));
if (dec.test !== 1) {
  throw new Error("backup encryption failed");
}

console.log("Security smoke tests passed");
