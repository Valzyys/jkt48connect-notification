"use strict";

const { getLiveStreams, getNews, getTheater, getBirthdays } = require("../../lib/jkt48api");
const { sendPushToAll } = require("../../lib/push");
const { getAllTokens, hasInCache, addToCache, removeFromCache, getAllFromCache } = require("../../lib/storage");

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

function checkLive(tokens) {
  return getLiveStreams().then(function(streams) {
    var activeIds = new Set(streams.map(function(s) { return String(s.chat_room_id); }));
    var sent = 0;
    var chain = Promise.resolve();
    streams.forEach(function(stream) {
      chain = chain.then(function() {
        var id = String(stream.chat_room_id);
        return hasInCache("live", id).then(function(cached) {
          if (cached) return;
          var tipe = (stream.type || "IDN").toUpperCase();
          var mulai = stream.started_at
            ? new Date(stream.started_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })
            : "";
          return sendPushToAll(tokens, {
            title: "\uD83D\uDD34 " + stream.name + " sedang LIVE!",
            body: tipe + " Live" + (mulai ? " \u2022 Mulai " + mulai + " WIB" : "") + " \u2014 Ketuk untuk nonton!",
            data: { type: "live", room_id: stream.chat_room_id, url_key: stream.url_key, slug: stream.slug },
          }).then(function() { return addToCache("live", id); }).then(function() { sent++; });
        });
      });
    });
    return chain.then(function() {
      return getAllFromCache("live").then(function(cached) {
        var cleared = 0;
        var cleanChain = Promise.resolve();
        cached.forEach(function(id) {
          if (!activeIds.has(id)) {
            cleanChain = cleanChain.then(function() {
              return removeFromCache("live", id).then(function() { cleared++; });
            });
          }
        });
        return cleanChain.then(function() { return { sent: sent, active: activeIds.size, cleared: cleared }; });
      });
    });
  });
}

function checkNews(tokens) {
  return getNews().then(function(list) {
    var sent = 0;
    var chain = Promise.resolve();
    list.forEach(function(item) {
      chain = chain.then(function() {
        var id = item._id || item.id;
        if (!id) return;
        return hasInCache("news", id).then(function(cached) {
          if (cached) return;
          return sendPushToAll(tokens, {
            title: "\uD83D\uDCF0 Berita Terbaru JKT48",
            body: item.title || "Ada berita baru dari JKT48!",
            data: { type: "news", news_id: item.id, mongo_id: item._id, date: item.date },
          }).then(function() { return addToCache("news", id); }).then(function() { sent++; });
        });
      });
    });
    return chain.then(function() { return { sent: sent }; });
  });
}

function checkTheater(tokens) {
  return getTheater().then(function(list) {
    var sent = 0;
    var chain = Promise.resolve();
    list.forEach(function(show) {
      chain = chain.then(function() {
        var id = String(show.id);
        return hasInCache("theater", id).then(function(cached) {
          if (cached) return;
          var tgl = show.date
            ? new Date(show.date).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })
            : "";
          var seitansai = (show.seitansai && show.seitansai.length)
            ? " \u2022 Seitansai: " + show.seitansai.map(function(s) { return s.name; }).join(", ")
            : "";
          return sendPushToAll(tokens, {
            title: "\uD83C\uDFAD Theater: " + show.title,
            body: tgl + " WIB \u2022 " + show.member_count + " member" + seitansai,
            data: { type: "theater", theater_id: show.id, url: show.url, seitansai: show.seitansai || [] },
          }).then(function() { return addToCache("theater", id); }).then(function() { sent++; });
        });
      });
    });
    return chain.then(function() { return { sent: sent }; });
  });
}

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
            return hasInCache("birthday", todayKey).then(function(cached) {
              if (cached) return;
              return sendPushToAll(tokens, {
                title: "\uD83C\uDF82 Selamat Ulang Tahun " + name + "!",
                body: name + " JKT48 hari ini berulang tahun ke-" + age + "! Kirimkan ucapanmu!",
                data: { type: "birthday", url_key: url_key, subtype: "today", age: age },
              }).then(function() { return addToCache("birthday", todayKey); }).then(function() { sent++; });
            });
          });
        } else {
          p = p.then(function() {
            return hasInCache("birthday", url_key + "-today").then(function(cached) {
              if (cached) return removeFromCache("birthday", url_key + "-today");
            });
          });
        }

        if (daysLeft > 0 && daysLeft <= BIRTHDAY_REMINDER_DAYS) {
          var rKey = url_key + "-reminder-" + daysLeft;
          p = p.then(function() {
            return hasInCache("birthday", rKey).then(function(cached) {
              if (cached) return;
              var countdown = daysLeft === 1 ? "Besok ulang tahun!" : daysLeft + " hari lagi ulang tahun!";
              return sendPushToAll(tokens, {
                title: "\uD83C\uDF80 " + name + " JKT48 \u2014 " + countdown,
                body: name + " akan berulang tahun ke-" + age + " dalam " + daysLeft + " hari. Siapkan ucapanmu!",
                data: { type: "birthday", url_key: url_key, subtype: "reminder", days_left: daysLeft, age: age },
              }).then(function() { return addToCache("birthday", rKey); }).then(function() { sent++; });
            });
          });
        }

        return p;
      });
    });
    return chain.then(function() { return { sent: sent }; });
  });
}
