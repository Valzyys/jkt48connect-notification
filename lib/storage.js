/**
 * lib/storage.js
 *
 * Storage via Vercel KV (Redis) menggunakan REST API.
 * Gratis tier lebih dari cukup untuk use case ini.
 *
 * Setup:
 *   1. Di Vercel dashboard → Storage → Create KV Database
 *   2. "Connect to Project" → env vars otomatis ter-inject:
 *      KV_REST_API_URL, KV_REST_API_TOKEN
 */

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

/** Low-level KV REST call */
async function kv(command, ...args) {
  const path = [command, ...args].map(encodeURIComponent).join("/");
  const res = await fetch(`${KV_URL}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(`KV error: ${json.error}`);
  return json.result;
}

// ── Token (ExpoPushToken) management ─────────────────────────────────────────

/** Simpan token device ke Redis Set "jkt48_tokens" */
async function addToken(token) {
  await kv("SADD", "jkt48_tokens", token);
}

/** Hapus token yang sudah tidak valid */
async function removeToken(token) {
  await kv("SREM", "jkt48_tokens", token);
}

/** Ambil semua token terdaftar → string[] */
async function getAllTokens() {
  const result = await kv("SMEMBERS", "jkt48_tokens");
  return Array.isArray(result) ? result : [];
}

// ── Sent-cache (mencegah double notif) ───────────────────────────────────────

const PREFIX = "jkt48_sent_";

async function hasInCache(setName, id) {
  const result = await kv("SISMEMBER", PREFIX + setName, id);
  return result === 1;
}

async function addToCache(setName, id) {
  await kv("SADD", PREFIX + setName, id);
}

async function removeFromCache(setName, id) {
  await kv("SREM", PREFIX + setName, id);
}

async function getAllFromCache(setName) {
  const result = await kv("SMEMBERS", PREFIX + setName);
  return Array.isArray(result) ? result : [];
}

module.exports = {
  addToken,
  removeToken,
  getAllTokens,
  hasInCache,
  addToCache,
  removeFromCache,
  getAllFromCache,
};
