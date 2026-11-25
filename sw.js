// ===== SmartTable service worker =====
// ทำให้ติดตั้งเป็นแอปได้ + เปิดหน้าเดิมได้ตอนเน็ตหลุดชั่วคราว
// * เปิดจากไฟล์ในเครื่องก่อน แล้วอัปเดตเบื้องหลัง (ต้องเปลี่ยน VERSION ทุกครั้งที่อัปโหลด)
// * ไม่เก็บข้อมูลจาก Supabase (ออร์เดอร์ เงิน) — เก็บแค่ไฟล์หน้าเว็บของเว็บนี้
// * แจ้งเตือน Push (st-31): ออร์เดอร์ใหม่ / เรียกพนักงาน / เปิดโต๊ะ / คิว — ส่งจาก Edge Function st-push
const VERSION = 'st-v17';
const META = 'stmeta-badge';   // ห้ามขึ้นต้นด้วย 'st-' (activate จะลบทิ้ง)
const SHELL = [
  './', 'index.html', 'home.html', 'settings.html', 'offline.html', 'manifest.webmanifest',
  'css/st-style.css', 'js/st-auth.js', 'js/st-config.js',
  'icons/st-192.png', 'icons/st-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('st-') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// เปิดเร็ว (stale-while-revalidate): ส่งไฟล์หน้าเว็บจากเครื่องทันที แล้วโหลดตัวใหม่เก็บไว้เบื้องหลัง (เปิดครั้งหน้าได้ตัวใหม่)
// ไม่มีในเครื่อง = รอเน็ต · ออฟไลน์ = offline.html · ข้อมูลร้าน/ออร์เดอร์มาจาก Supabase เสมอ (ไม่เก็บ)
// อัปเดตแอป: เปลี่ยนเลข VERSION ทุกครั้งที่อัปโหลดไฟล์ใหม่
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // Supabase / CDN / ฟอนต์ ปล่อยเบราว์เซอร์จัดการ
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  const nav = req.mode === 'navigate';
  const key = nav ? new Request(url.origin + url.pathname) : req;   // หน้าเว็บ: ไม่สน ?shop=… (ข้อมูลอ่านจาก URL ตอนเปิด)

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(key) || (nav ? await cache.match(key, { ignoreSearch: true }) : null);
    const net = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(key, res.clone()).catch(() => null);
      return res;
    });
    if (hit) { event.waitUntil(net.catch(() => null)); return hit; }
    try { return await net; }
    catch (err) {
      if (nav) { const off = await cache.match('offline.html'); if (off) return off; }
      throw err;
    }
  })());
});

// ---------- แจ้งเตือน Push ----------
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'SmartTable', body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'SmartTable', {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: 'icons/st-192.png',
      badge: 'icons/favicon-32.png',
      vibrate: [180, 80, 180],
      data: { url: d.url || 'home.html' }
    });
    await setBadge(null, 1);
  })());
});

// ตัวเลขบนไอคอนแอป: n = ค่าที่ตั้ง · add = บวกเพิ่มจากค่าเดิม
async function setBadge(n, add) {
  try {
    const cache = await caches.open(META);
    if (n == null) {
      const hit = await cache.match('badge');
      n = (hit ? parseInt(await hit.text(), 10) || 0 : 0) + (add || 0);
    }
    n = Math.max(0, Math.min(999, n | 0));
    await cache.put('badge', new Response(String(n)));
    if (n > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(n);
    else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch { /* อุปกรณ์ไม่รองรับป้าย */ }
}

// หน้าแอปส่งจำนวนงานค้างจริงมา (หน้าโฮม) หรือขอให้นับตามแจ้งเตือนที่ยังค้าง
self.addEventListener('message', (event) => {
  const m = event.data || {};
  if (m.type !== 'st-badge') return;
  event.waitUntil((async () => {
    if (typeof m.count === 'number') return setBadge(m.count);
    const left = (await self.registration.getNotifications()).length;
    return setBadge(left);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.registration.getNotifications().then(l => setBadge(l.length)).catch(() => null));
  const target = new URL((event.notification.data && event.notification.data.url) || 'home.html', self.registration.scope).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = list.find(c => c.url === target);
    if (same) return same.focus();
    const mine = list.find(c => c.url.startsWith(self.registration.scope));
    if (mine) { try { await mine.navigate(target); return mine.focus(); } catch { /* เปิดใหม่ด้านล่าง */ } }
    return self.clients.openWindow(target);
  })());
});
