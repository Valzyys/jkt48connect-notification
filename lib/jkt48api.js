"use strict";
/**
 * lib/jkt48api.js  —  v2
 * Fix: getStreamCacheId() handle IDN chat_room_id=null + Showroom room_id=0
 */
const BASE = "https://v2.jkt48connect.com/api/jkt48";
const KEY  = "JKTCONNECT";

async function fetchJKT48(endpoint) {
  const res = await fetch(
    BASE + "/" + endpoint + (endpoint.includes("?") ? "&" : "?") + "apikey=" + KEY,
    {
      headers: { "Cache-Control": "no-store" },
      signal: AbortSignal.timeout(25000),
    }
  );
  if (!res.ok) throw new Error("HTTP " + res.status + " (" + endpoint + ")");
  return res.json();
}

async function getLiveStreams() {
  const d = await fetchJKT48("live");
  return Array.isArray(d) ? d : [];
}

async function getLatestNews() {
  const d = await fetchJKT48("news");
  const list = Array.isArray(d && d.news) ? d.news : [];
  return list.length > 0 ? [list[0]] : [];
}

async function getLatestTheater() {
  const d = await fetchJKT48("theater");
  const list = Array.isArray(d && d.theater) ? d.theater : [];
  return list.length > 0 ? [list[0]] : [];
}

async function getBirthdays() {
  const d = await fetchJKT48("birthday");
  return Array.isArray(d) ? d : [];
}

/**
 * Buat unique cache ID per stream session.
 *
 * IDN:
 *   - chat_room_id ada & non-null  → "idn-{chat_room_id}"
 *   - chat_room_id null/undefined  → "idn-slug-{slug}"   ← Giaa duplikat pakai ini
 *   - tidak ada slug juga          → "idn-uk-{url_key}"
 *
 * Showroom:
 *   - room_id > 0                  → "sr-{room_id}"
 *   - room_id 0 / tidak ada        → "sr-uk-{url_key}"
 *
 * Fallback:
 *   - "uk-{url_key}"
 */
function getStreamCacheId(stream) {
  const type = (stream.type || "").toLowerCase();

  if (type === "idn") {
    if (stream.chat_room_id) {
      return "idn-" + String(stream.chat_room_id);
    }
    if (stream.slug) {
      return "idn-slug-" + String(stream.slug);
    }
    return "idn-uk-" + String(stream.url_key || "unknown");
  }

  if (type === "showroom") {
    if (stream.room_id && stream.room_id > 0) {
      return "sr-" + String(stream.room_id);
    }
    return "sr-uk-" + String(stream.url_key || "unknown");
  }

  return "uk-" + String(stream.url_key || stream.slug || "unknown");
}

module.exports = {
  getLiveStreams,
  getLatestNews,
  getLatestTheater,
  getBirthdays,
  getStreamCacheId,
};
