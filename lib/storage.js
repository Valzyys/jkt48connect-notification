/**
 * lib/storage.js
 */
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(command, ...args) {
  if (!KV_URL || !KV_TOKEN) {
    throw new Error("KV_REST_API_URL atau KV_REST_API_TOKEN tidak ditemukan.");
  }
  const path = [command, ...args].map(encodeURIComponent).join("/");
  const res = await fetch(`${KV_URL}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`KV HTTP ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json.error) throw new Error(`KV error: ${json.error}`);
  return json.result;
}

// ── Token management ──────────────────────────────────────────────────────────
async function addToken(token) {
  const result = await kv("SADD", "jkt48_tokens", token);
  console.log(`[STORAGE] addToken result: ${result}`);
  return result;
}

async function removeToken(token) {
  await kv("SREM", "jkt48_tokens", token);
}

async function getAllTokens() {
  const result = await kv("SMEMBERS", "jkt48_tokens");
  return Array.isArray(result) ? result : [];
}

// ── Cache (semua permanent, tanpa TTL) ───────────────────────────────────────
// Tidak ada TTL sama sekali — cache hanya dihapus manual via removeFromCache.
// Untuk live: dihapus otomatis saat stream offline.
// Untuk news/theater/birthday: dihapus tidak perlu karena ID selalu unik.
const PREFIX = "jkt48_sent_";

/**
 * Atomic check-and-set PERMANENT (tanpa TTL).
 * Return true  → belum ada di cache, berhasil di-set → boleh kirim notif
 * Return false → sudah ada / race condition kalah → skip
 */
async function tryAcquireCache(setName, id) {
  const key = `${PREFIX}${setName}:${id}`;
  const result = await kv("SET", key, "1", "NX");
  return result === "OK";
}

async function hasInCache(setName, id) {
  const key = `${PREFIX}${setName}:${id}`;
  try {
    const result = await kv("EXISTS", key);
    return result === 1;
  } catch {
    return false;
  }
}

async function addToCache(setName, id) {
  const key = `${PREFIX}${setName}:${id}`;
  await kv("SET", key, "1");
}

async function removeFromCache(setName, id) {
  const key = `${PREFIX}${setName}:${id}`;
  await kv("DEL", key);
}

async function getAllFromCache(setName) {
  const pattern = `${PREFIX}${setName}:*`;
  const keys = await kv("KEYS", pattern);
  if (!Array.isArray(keys)) return [];
  return keys.map((k) => k.replace(`${PREFIX}${setName}:`, ""));
}

module.exports = {
  addToken,
  removeToken,
  getAllTokens,
  hasInCache,
  addToCache,
  removeFromCache,
  getAllFromCache,
  tryAcquireCache,
};
