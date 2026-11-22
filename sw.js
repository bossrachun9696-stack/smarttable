// ===== SmartTable service worker =====
// ทำให้ติดตั้งเป็นแอปได้ + เปิดหน้าเดิมได้ตอนเน็ตหลุดชั่วคราว
// * โหลดจากเน็ตก่อนเสมอ (ไฟล์ใหม่บน GitHub ขึ้นทันที) — ใช้ของที่เก็บไว้เฉพาะตอนออฟไลน์
// * ไม่เก็บข้อมูลจาก Supabase (ออร์เดอร์ เงิน) — เก็บแค่ไฟล์หน้าเว็บของเว็บนี้
// * ยังไม่มีแจ้งเตือน Push (จะเพิ่มหลังย้ายรวม DarkChat)
const VERSION = 'st-v8';
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
