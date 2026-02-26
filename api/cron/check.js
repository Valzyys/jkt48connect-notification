"use strict";

const { getLiveStreams, getLatestNews, getLatestTheater, getBirthdays } = require("../../lib/jkt48api");
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

  return getAllTokens().then(function(tokens) {
    console.log("[CRON] tokens: " + tokens.length);

    if (tokens.length === 0) {
      return res.json({ ok: true, message: "No tokens registered", ms: 0 });
    }

    return Promise.allSettled([
      checkLive(tokens),
      checkNews(tokens),
      checkTheater(tokens),
      checkBirthday(tokens),
    ]).then(function(results) {
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
  }).catch(function(err) {
    console.error("[CRON] fatal:", err.message);
    return res.status(500).json({ error: err.message });
  });
};

// ── LIVE ──────────────────────────────────────────────────────────────────────
// Cache permanent tanpa TTL.
// Selama stream ada di API → cache ada → notif tidak dikirim ulang.
// Saat stream tidak ada di API lagi → cache dihapus otomatis.
function checkLive(tokens) {
  return getLiveStreams().then(function(streams) {
    var activeIds = new Set(streams.map(function(s) { return String(s.chat_room_id); }));
    var sent = 0;
    var chain = Promise.resolve();

    streams.forEach(function(stream) {
      chain = chain.then(function() {
        var id = String(stream.chat_room_id);
        return tryAcquireCache("live", id).then(function(acquired) {
          if (!acquired) return;
          var tipe = (stream.type || "IDN").toUpperCase();
          var mulai = stream.started_at
            ? new Date(stream.started_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })
            : "";
          return sendPushToAll(tokens, {
            title: stream.name + " sedang LIVE!",
            body: tipe + " Live" + (mulai ? " - Mulai " + mulai + " WIB" : "") + " - Ketuk untuk nonton!",
            data: { type: "live", room_id: stream.chat_room_id, url_key: stream.url_key, slug: stream.slug },
            channelId: "jkt48-live",
          }).then(function() { sent++; });
        });
      });
    });

    return chain.then(function() {
      // Auto-delete cache stream yang sudah offline (tidak ada di API)
      return getAllFromCache("live").then(function(cached) {
        var cleared = 0;
        var cleanChain = Promise.resolve();
        cached.forEach(function(id) {
          if (!activeIds.has(id)) {
            cleanChain = cleanChain.then(function() {
              return removeFromCache("live", id).then(function() {
                cleared++;
                console.log("[CRON] Live offline, cache dihapus: " + id);
              });
            });
          }
        });
        return cleanChain.then(function() {
          return { sent: sent, active: activeIds.size, cleared: cleared };
        });
      });
    });
  });
}

// ── NEWS ──────────────────────────────────────────────────────────────────────
// Cache permanent — ID berita selalu unik, tidak akan spam.
function checkNews(tokens) {
  return getLatestNews().then(function(list) {
    var sent = 0;
    var chain = Promise.resolve();

    list.forEach(function(item) {
      chain = chain.then(function() {
        var id = item._id || item.id;
        if (!id) return;
        return tryAcquireCache("news", id).then(function(acquired) {
          if (!acquired) return;
          return sendPushToAll(tokens, {
            title: "Berita Terbaru JKT48",
            body: item.title || "Ada berita baru dari JKT48!",
            data: { type: "news", news_id: item.id, mongo_id: item._id, date: item.date },
            channelId: "jkt48-notifications",
          }).then(function() { sent++; });
        });
      });
    });

    return chain.then(function() { return { sent: sent }; });
  });
}

// ── THEATER ───────────────────────────────────────────────────────────────────
// Cache permanent — ID show selalu unik, tidak akan spam.
function checkTheater(tokens) {
  return getLatestTheater().then(function(list) {
    var sent = 0;
    var chain = Promise.resolve();

    list.forEach(function(show) {
      chain = chain.then(function() {
        var id = String(show.id);
        return tryAcquireCache("theater", id).then(function(acquired) {
          if (!acquired) return;
          var tgl = show.date
            ? new Date(show.date).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })
            : "";
          var seitansai = (show.seitansai && show.seitansai.length)
            ? " - Seitansai: " + show.seitansai.map(function(s) { return s.name; }).join(", ")
            : "";
          return sendPushToAll(tokens, {
            title: show.title,
            body: tgl + " WIB - " + show.member_count + " member" + seitansai,
            data: { type: "theater", theater_id: show.id, url: show.url, seitansai: show.seitansai || [] },
            channelId: "jkt48-notifications",
          }).then(function() { sent++; });
        });
      });
    });

    return chain.then(function() { return { sent: sent }; });
  });
}

// ── BIRTHDAY ──────────────────────────────────────────────────────────────────
// Cache permanent — key sudah include tanggal/hari sehingga tidak akan spam.
function checkBirthday(tokens) {
  return getBirthdays().then(function(members) {
    var sent = 0;
    var chain = Promise.resolve();

    members.forEach(function(m) {
      chain = chain.then(function() {
        var url_key = m.url_key;
        var name = m.name;
        var age = m.age_after_birthday;
        var daysLeft = (m.next_birthday_countdown && m.next_birthday_countdown.days) || 0;
        var p = Promise.resolve();

        if (m.is_birthday_today) {
          var todayKey = url_key + "-today";
          p = p.then(function() {
            return tryAcquireCache("birthday", todayKey).then(function(acquired) {
              if (!acquired) return;
              return sendPushToAll(tokens, {
                title: "Selamat Ulang Tahun " + name + "!",
                body: name + " JKT48 hari ini berulang tahun ke-" + age + "! Kirimkan ucapanmu!",
                data: { type: "birthday", url_key: url_key, subtype: "today", age: age },
                channelId: "jkt48-notifications",
              }).then(function() { sent++; });
            });
          });
        }

        if (daysLeft > 0 && daysLeft <= BIRTHDAY_REMINDER_DAYS) {
          // Key sudah include daysLeft — tiap hari reminder punya key beda
          var rKey = url_key + "-reminder-" + daysLeft;
          p = p.then(function() {
            return tryAcquireCache("birthday", rKey).then(function(acquired) {
              if (!acquired) return;
              var countdown = daysLeft === 1 ? "Besok ulang tahun!" : daysLeft + " hari lagi ulang tahun!";
              return sendPushToAll(tokens, {
                title: name + " - " + countdown,
                body: name + " akan berulang tahun ke-" + age + " dalam " + daysLeft + " hari. Siapkan ucapanmu!",
                data: { type: "birthday", url_key: url_key, subtype: "reminder", days_left: daysLeft, age: age },
                channelId: "jkt48-notifications",
              }).then(function() { sent++; });
            });
          });
        }

        return p;
      });
    });

    return chain.then(function() { return { sent: sent }; });
  });
}
