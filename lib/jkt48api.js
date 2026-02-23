/**
 * lib/jkt48api.js
 * Fetch data dari JKT48Connect API
 */

const BASE = "https://v2.jkt48connect.com/api/jkt48";
const KEY = "JKTCONNECT";

async function fetchJKT48(endpoint) {
  const res = await fetch(`${BASE}/${endpoint}?apikey=${KEY}`, {
    headers: { "Cache-Control": "no-store" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${endpoint})`);
  return res.json();
}

async function getLiveStreams() {
  const d = await fetchJKT48("live");
  return Array.isArray(d) ? d : [];
}

async function getNews() {
  const d = await fetchJKT48("news");
  return Array.isArray(d?.news) ? d.news : [];
}

async function getTheater() {
  const d = await fetchJKT48("theater?page=1");
  return Array.isArray(d?.theater) ? d.theater : [];
}

async function getBirthdays() {
  const d = await fetchJKT48("birthday");
  return Array.isArray(d) ? d : [];
}

module.exports = { getLiveStreams, getNews, getTheater, getBirthdays };
