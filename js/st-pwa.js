// ===== ปุ่ม "ติดตั้ง SmartTable บนมือถือ" (หน้า home.html) =====
// Android / Chrome / Edge: กดปุ่มติดตั้ง · iPhone / iPad (Safari): บอกวิธี แชร์ → เพิ่มไปยังหน้าจอโฮม
// ซ่อนเองเมื่อเปิดจากแอปที่ติดตั้งแล้ว หรือกด "ไว้ทีหลัง" (ถามใหม่ใน 14 วัน)
(function () {
  const $ = (s) => document.querySelector(s);
  const card = $('#pwa-card');
  if (!card) return;
  const KEY = 'st-pwa-later';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  let later = 0;
  try { later = Number(localStorage.getItem(KEY) || 0); } catch { /* ไม่เป็นไร */ }
  if (standalone || Date.now() - later < 14 * 864e5) return;

  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const iosSafari = iOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Line\//.test(ua);
  let deferred = null;

  if (iOS) {
    $('#pwa-text').innerHTML = iosSafari
      ? 'แตะปุ่ม <b>แชร์</b> <span aria-hidden="true">⬆︎</span> ด้านล่างของ Safari → เลือก <b>เพิ่มไปยังหน้าจอโฮม</b> → <b>เพิ่ม</b>'
      : 'เปิดหน้านี้ด้วย <b>Safari</b> ก่อน แล้วแตะ <b>แชร์</b> → <b>เพิ่มไปยังหน้าจอโฮม</b>';
    card.hidden = false;
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    $('#pwa-install').hidden = false;
    card.hidden = false;
  });
  $('#pwa-install').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    const r = await deferred.userChoice.catch(() => null);
    deferred = null;
    if (r && r.outcome === 'accepted') card.hidden = true;
  });
  window.addEventListener('appinstalled', () => { card.hidden = true; });
  $('#pwa-close').addEventListener('click', () => {
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ไม่เป็นไร */ }
    card.hidden = true;
  });
})();
