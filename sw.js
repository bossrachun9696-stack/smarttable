// ===== SmartTable service worker =====
// ทำให้ติดตั้งเป็นแอปได้ + เปิดหน้าเดิมได้ตอนเน็ตหลุดชั่วคราว
// * โหลดจากเน็ตก่อนเสมอ (ไฟล์ใหม่บน GitHub ขึ้นทันที) — ใช้ของที่เก็บไว้เฉพาะตอนออฟไลน์
// * ไม่เก็บข้อมูลจาก Supabase (ออร์เดอร์ เงิน) — เก็บแค่ไฟล์หน้าเว็บของเว็บนี้
// * แจ้งเตือน Push (st-31): ออร์เดอร์ใหม่ / เรียกพนักงาน / เปิดโต๊ะ / คิว — ส่งจาก Edge Function st-push
const VERSION = 'st-v16';
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // Supabase / CDN / ฟอนต์ ปล่อยเบราว์เซอร์จัดการ
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  event.respondWith((async () => {
    try {
      // เน็ตช้า/สัญญาณอ่อน: รอเน็ตไม่เกิน 4 วินาที แล้วใช้ไฟล์ที่เก็บไว้แทน (ถ้ามี) ไม่ค้างหน้าขาว
      const net = fetch(req);
      const res = await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))])
        .catch(async (e) => {
          const hit = await (await caches.open(VERSION)).match(req);
          if (hit) { net.then(r => { if (r && r.ok && r.type === 'basic') caches.open(VERSION).then(c => c.put(req, r)); }).catch(() => null); return hit; }
          return net;                                  // ไม่มีในเครื่อง -> รอเน็ตต่อ
        });
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => null);
      }
      return res;
    } catch (err) {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req) || await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const off = await cache.match('offline.html');
        if (off) return off;
      }
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
