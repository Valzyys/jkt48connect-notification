# JKT48 Push Server — Vercel Backend

Backend untuk push notification JKT48Connect yang bekerja bahkan saat app di-kill.

## Mengapa Dibutuhkan?

`expo-background-task` dan `setInterval` (JS polling) **berhenti total saat user force-kill app**.
Satu-satunya cara notifikasi tetap berjalan adalah dengan **server yang push ke device via FCM/APNs**.

```
Server Vercel (24/7)
  └── Cron setiap 1 menit
        ├── Fetch JKT48 API (live, news, theater, birthday)
        └── Push ke semua device via Expo Push Service
              ├── FCM → Android (BEKERJA saat app di-kill)
              └── APNs → iOS (BEKERJA saat app di-kill)
```

---

## Setup & Deploy

### 1. Buat Vercel KV Database

1. Login ke [vercel.com](https://vercel.com)
2. Masuk ke project → **Storage** → **Create Database** → pilih **KV**
3. Beri nama (misal: `jkt48-kv`) → Create
4. **Connect to Project** → pilih project ini
5. Env vars akan otomatis ter-inject: `KV_REST_API_URL`, `KV_REST_API_TOKEN`

### 2. Deploy ke Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Clone / masuk ke folder ini
cd jkt48-push-server

# Deploy
vercel deploy --prod
```

Setelah deploy, catat URL-nya (misal: `https://jkt48-push-server.vercel.app`

### 3. Set Environment Variables di Vercel

Masuk ke Vercel Dashboard → project → **Settings** → **Environment Variables**, tambahkan:

| Key | Value | Keterangan |
|-----|-------|-----------|
| `CRON_SECRET` | random string panjang | Proteksi endpoint cron |
| `KV_REST_API_URL` | (otomatis dari langkah 1) | URL Redis |
| `KV_REST_API_TOKEN` | (otomatis dari langkah 1) | Token Redis |
| `EXPO_ACCESS_TOKEN` | (opsional) | Jika push security diaktifkan di Expo |

> Generate `CRON_SECRET`: `openssl rand -hex 32`

### 4. Update App React Native

Di file `.env` atau `app.config.js` proyek Expo:

```
EXPO_PUBLIC_PUSH_SERVER_URL=https://jkt48-push-server.vercel.app
```

### 5. Ganti useJKT48Notifications.ts

Ganti file `hooks/useJKT48Notifications.ts` dengan file `useJKT48Notifications.ts` dari repo ini.

### 6. Update app.json

Ganti `app.json` dengan versi baru (atau tambahkan perubahan ini):

```json
{
  "plugins": [
    [
      "expo-notifications",
      {
        "enableBackgroundRemoteNotifications": true
      }
    ]
  ]
}
```

Dan **hapus** plugin-plugin yang tidak lagi dibutuhkan:
- `expo-background-task`
- `expo-task-manager`  
- `./plugins/withForegroundService`
- `./plugins/withHeadlessTask`

### 7. Build ulang app

```bash
eas build --platform all
```

Wajib build ulang karena ada perubahan native config (`enableBackgroundRemoteNotifications`).

---

## Struktur File

```
jkt48-push-server/
├── api/
│   ├── cron/
│   │   └── check.js        ← Cron job utama (tiap 1 menit)
│   ├── register.js         ← Device daftarkan token
│   └── status.js           ← Health check
├── lib/
│   ├── storage.js          ← Vercel KV (Redis) helpers
│   ├── push.js             ← Expo Push Service sender
│   └── jkt48api.js         ← JKT48Connect API fetcher
├── package.json
├── vercel.json             ← Cron schedule config
└── README.md
```

---

## Monitoring

Cek status server: `GET https://jkt48-push-server.vercel.app/api/status`

```json
{
  "ok": true,
  "timestamp": "2026-02-23T10:00:00.000Z",
  "devices": 1234,
  "cache": {
    "live": 2,
    "news": 47,
    "theater": 12
  }
}
```

Log cron tersedia di Vercel Dashboard → **Functions** → **Logs**.
