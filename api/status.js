/**
 * api/status.js
 * Health check & monitoring — GET /api/status
 */

const { getAllTokens, getAllFromCache } = require("../lib/storage");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).end();

  try {
    const [tokens, live, news, theater] = await Promise.all([
      getAllTokens(),
      getAllFromCache("live"),
      getAllFromCache("news"),
      getAllFromCache("theater"),
    ]);

    return res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      devices: tokens.length,
      cache: { live: live.length, news: news.length, theater: theater.length },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
