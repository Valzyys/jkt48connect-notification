"use strict";

const { getLiveStreams, getLatestNews, getLatestTheater, getBirthdays, getStreamCacheId } = require("../../lib/jkt48api");
const { sendPushToAll } = require("../../lib/push");
const {
  getAllTokens,
  tryAcquireCache,
  removeFromCache,
  getAllFromCache,
} = require("../../lib/storage");

const BIRTHDAY_REMINDER_DAYS = 7;

module.exports = function handler(req, res) {
  var start = Date.now();
  console.log("[CRON] start " + new Date().toISOString());

  return getAllTokens().then(function (tokens) {
    console.log("[CRON] tokens: " + tokens.length);

    if (tokens.length === 0) {
      return res.json({ ok: true, message: "No tokens registered", ms: 0 });
    }

    return Promise.allSettled([
      checkLive(tokens),
      checkNews(tokens),
      checkTheater(tokens),
      checkBirthday(tokens),
    ]).then(function (results) {
      var r = {
        ok: true,
        ms: Date.now() - start,
        live:     results[0].status === "fulfilled" ? results[0].value : { error: String(results[0].reason) },
        news:     results[1].status === "fulfilled" ? results[1].value : { error: String(results[1].reason) },
        theater:  results[2].status === "fulfilled" ? results[2].value : { error: String(results[2].reason) },
        birthday: results[3].status === "fulfilled" ? results[3].value : { error: String(results[3].reason) },
      };
      console.log("[CRON] done " + r.ms + "ms");
      return res.json(r);
    });
  }).catch(function (err) {
    console.error("[CRON] fatal:", err.message);
    return res.status(500).json({ error: err.message });
  });
};

// ── LIVE ──────────────────────────────────────────────────────────────────────
function checkLive(tokens) {
  return getLiveStreams().then(function (streams) {
    // Map semua stream aktif → { cacheId → stream }
    // Pakai Map agar tidak ada duplikat cacheId (Giaa 2x entry dengan slug beda = 2 cacheId beda)
    var activeMap = new Map();
    streams.forEach(function (s) {
      var id = getStreamCacheId(s);
      if (!activeMap.has(id)) {
        activeMap.set(id, s);
      }
    });

    console.log("[CRON] Live streams dari API: " + streams.length + ", unique cacheId: " + activeMap.size);

    var sent      = 0;
    var skipped   = 0;
    var details   = [];
    var chain     = Promise.resolve();

    activeMap.forEach(function (stream, cacheId) {
      chain = chain.then(function () {
        return tryAcquireCache("live", cacheId).then(function (acquired) {
          var type  = (stream.type || "idn").toLowerCase();
          var tipe  = type === "showroom" ? "Showroom" : "IDN";
          var mulai = stream.started_at
            ? new Date(stream.started_at).toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Jakarta",
              })
            : "";

          details.push({
            name: stream.name,
            cacheId: cacheId,
            type: type,
            acquired: acquired,
          });

          if (!acquired) {
            console.log("[CRON] Skip (sudah di cache): " + stream.name + " [" + cacheId + "]");
            skipped++;
            return;
          }

          console.log("[CRON] Kirim notif: " + stream.name + " [" + tipe + "] cacheId=" + cacheId);

          var notifData = {
            type:         "live",
            stream_type:  type,
            url_key:      stream.url_key  || "",
            slug:         stream.slug     || "",
            room_id:      String(stream.room_id      || ""),
            chat_room_id: String(stream.chat_room_id || ""),
          };

          return sendPushToAll(tokens, {
            title:     stream.name + " sedang LIVE!",
            body:      tipe + " Live" + (mulai ? " · Mulai " + mulai + " WIB" : "") + " · Ketuk untuk nonton!",
            data:      notifData,
            channelId: "jkt48-live",
          }).then(function () { sent++; });
        });
      });
    });

    return chain.then(function () {
      // ── Auto-cleanup cache yang sudah offline ──────────────────────────
      return getAllFromCache("live").then(function (cachedIds) {
        var cleared    = 0;
        var cleanChain = Promise.resolve();

        cachedIds.forEach(function (id) {
          if (!activeMap.has(id)) {
            cleanChain = cleanChain.then(function () {
              return removeFromCache("live", id).then(function () {
                cleared++;
                console.log("[CRON] Offline, hapus cache: " + id);
              });
            });
          }
        });

        return cleanChain.then(function () {
          return {
            sent:    sent,
            skipped: skipped,
            active:  activeMap.size,
            cleared: cleared,
            details: details,       // ← bisa dilihat di response cron untuk debug
          };
        });
      });
    });
  });
}

// ── NEWS ──────────────────────────────────────────────────────────────────────
function checkNews(tokens) {
  return getLatestNews().then(function (list) {
    var sent  = 0;
    var chain = Promise.resolve();

    list.forEach(function (item) {
      chain = chain.then(function () {
        var id = item._id || item.id;
        if (!id) return;
        return tryAcquireCache("news", id).then(function (acquired) {
          if (!acquired) return;
          return sendPushToAll(tokens, {
            title:     "Berita Terbaru JKT48",
            body:      item.title || "Ada berita baru dari JKT48!",
            data:      { type: "news", news_id: item.id, mongo_id: item._id, date: item.date },
            channelId: "jkt48-notifications",
          }).then(function () { sent++; });
        });
      });
    });

    return chain.then(function () { return { sent: sent }; });
  });
}

// ── THEATER ───────────────────────────────────────────────────────────────────
function checkTheater(tokens) {
  return getLatestTheater().then(function (list) {
    var sent  = 0;
    var chain = Promise.resolve();

    list.forEach(function (show) {
      chain = chain.then(function () {
        var id = String(show.id);
        return tryAcquireCache("theater", id).then(function (acquired) {
          if (!acquired) return;
          var tgl = show.date
            ? new Date(show.date).toLocaleString("id-ID", {
                day: "numeric", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit",
                timeZone: "Asia/Jakarta",
              })
            : "";
          var seitansai = show.seitansai && show.seitansai.length
            ? " · Seitansai: " + show.seitansai.map(function (s) { return s.name; }).join(", ")
            : "";
          return sendPushToAll(tokens, {
            title:     show.title,
            body:      tgl + " WIB · " + show.member_count + " member" + seitansai,
            data:      { type: "theater", theater_id: show.id, url: show.url, seitansai: show.seitansai || [] },
            channelId: "jkt48-notifications",
          }).then(function () { sent++; });
        });
      });
    });

    return chain.then(function () { return { sent: sent }; });
  });
}

// ── BIRTHDAY ──────────────────────────────────────────────────────────────────
function checkBirthday(tokens) {
  return getBirthdays().then(function (members) {
    var sent  = 0;
    var chain = Promise.resolve();

    members.forEach(function (m) {
      chain = chain.then(function () {
        var url_key  = m.url_key;
        var name     = m.name;
        var age      = m.age_after_birthday;
        var daysLeft = (m.next_birthday_countdown && m.next_birthday_countdown.days) || 0;
        var p        = Promise.resolve();

        if (m.is_birthday_today) {
          var todayKey = url_key + "-today";
          p = p.then(function () {
            return tryAcquireCache("birthday", todayKey).then(function (acquired) {
              if (!acquired) return;
              return sendPushToAll(tokens, {
                title:     "Selamat Ulang Tahun " + name + "!",
                body:      name + " JKT48 hari ini berulang tahun ke-" + age + "! Kirimkan ucapanmu!",
                data:      { type: "birthday", url_key: url_key, subtype: "today", age: age },
                channelId: "jkt48-notifications",
              }).then(function () { sent++; });
            });
          });
        }

        if (daysLeft > 0 && daysLeft <= BIRTHDAY_REMINDER_DAYS) {
          var rKey = url_key + "-reminder-" + daysLeft;
          p = p.then(function () {
            return tryAcquireCache("birthday", rKey).then(function (acquired) {
              if (!acquired) return;
              var countdown = daysLeft === 1 ? "Besok ulang tahun!" : daysLeft + " hari lagi ulang tahun!";
              return sendPushToAll(tokens, {
                title:     name + " - " + countdown,
                body:      name + " akan berulang tahun ke-" + age + " dalam " + daysLeft + " hari. Siapkan ucapanmu!",
                data:      { type: "birthday", url_key: url_key, subtype: "reminder", days_left: daysLeft, age: age },
                channelId: "jkt48-notifications",
              }).then(function () { sent++; });
            });
          });
        }

        return p;
      });
    });

    return chain.then(function () { return { sent: sent }; });
  });
}
