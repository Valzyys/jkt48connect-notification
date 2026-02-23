/**
 * lib/push.js
 *
 * Kirim push notification ke semua device via Expo Push Service.
 * Expo Push Service meneruskan ke FCM (Android) dan APNs (iOS) secara otomatis —
 * notifikasi diterima bahkan saat app di-kill total.
 *
 * Referensi: https://docs.expo.dev/push-notifications/sending-notifications/
 */

const { Expo } = require("expo-server-sdk");
const { removeToken } = require("./storage");

// Buat Expo client (opsional: tambah EXPO_ACCESS_TOKEN env jika push security enabled)
const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
});

/**
 * Kirim notifikasi ke array of ExpoPushToken.
 * @param {string[]} tokens
 * @param {{ title: string, body: string, data?: object }} payload
 * @returns {Promise<number>} jumlah notif berhasil terkirim
 */
async function sendPushToAll(tokens, payload) {
  if (!tokens || tokens.length === 0) return 0;

  // Filter token valid saja
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (valid.length === 0) {
    console.log("[PUSH] Tidak ada token valid");
    return 0;
  }

  // Build message objects
  const messages = valid.map((token) => ({
    to: token,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    priority: "high",
    // Android: pastikan muncul di notification tray
    channelId: "jkt48-notifications",
  }));

  // Expo merekomendasikan chunking (max 100 per request)
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (err) {
      console.error("[PUSH] Error kirim chunk:", err.message);
    }
  }

  // Hapus token yang sudah tidak valid (DeviceNotRegistered)
  let successCount = 0;
  for (let i = 0; i < valid.length; i++) {
    const ticket = tickets[i];
    if (!ticket) continue;
    if (ticket.status === "ok") {
      successCount++;
    } else if (ticket.status === "error") {
      const errCode = ticket.details?.error;
      console.warn(`[PUSH] Error [${valid[i]}]: ${errCode}`);
      if (errCode === "DeviceNotRegistered" || errCode === "InvalidCredentials") {
        await removeToken(valid[i]).catch(() => {});
        console.log(`[PUSH] Token dihapus: ${valid[i]}`);
      }
    }
  }

  console.log(`[PUSH] ✅ ${successCount}/${valid.length} terkirim`);
  return successCount;
}

module.exports = { sendPushToAll };
