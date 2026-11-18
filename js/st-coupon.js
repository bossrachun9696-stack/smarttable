// ===== หน้าคูปอง (coupon.html?c=<CODE>&s=<shop_id>) — เปิดจากการสแกน QR คูปองด้วยกล้องมือถือ =====
// เก็บโค้ดไว้ในเครื่อง -> ถ้าเพิ่งสแกนโต๊ะของร้านนี้ พาไปหน้าสั่งอาหารและใส่คูปองให้อัตโนมัติ
(function () {
  const q = new URLSearchParams(location.search);
  const code = (q.get('c') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
  const shop = q.get('s') || null;
  const $ = (s) => document.querySelector(s);
  const en = !/^th/i.test(navigator.language || 'th');
  const T = en
    ? { lead: 'Discount coupon', go: 'Go to my table', copy: 'Copy code', copied: 'Copied ✓', bad: 'This coupon link is incomplete.',
        none: 'Scan the QR code on your table first — the coupon will be added automatically. Or type this code in "Promotions & coupons".', jump: 'Taking you to your table…' }
    : { lead: 'คูปองส่วนลด', go: 'ไปหน้าสั่งอาหาร', copy: 'คัดลอกโค้ด', copied: 'คัดลอกแล้ว ✓', bad: 'ลิงก์คูปองไม่ครบ',
        none: 'สแกน QR ที่โต๊ะก่อน แล้วคูปองจะใส่ให้อัตโนมัติ · หรือพิมพ์โค้ดนี้ที่ปุ่ม "โปรโมชันและคูปอง" ในหน้าสั่งอาหาร', jump: 'กำลังพาไปหน้าสั่งอาหาร…' };
  $('#c-lead').textContent = T.lead;
  $('#c-copy').textContent = T.copy;
  $('#c-go').textContent = T.go;
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) { $('#c-text').textContent = T.bad; $('#c-copy').hidden = true; return; }
  $('#c-code').textContent = code;
  try { localStorage.setItem('st-coupon-pending', JSON.stringify({ code, shop, at: Date.now() })); } catch { /* ไม่เป็นไร */ }

  let last = null;
  try { last = JSON.parse(localStorage.getItem('st-last-table') || 'null'); } catch { last = null; }
  const fresh = last && last.qr && Date.now() - (last.at || 0) < 12 * 3600000 && (!shop || !last.shop || last.shop === shop);
  if (fresh) {
    const url = 'table.html?t=' + encodeURIComponent(last.qr);
    $('#c-go').href = url; $('#c-go').hidden = false;
    $('#c-text').textContent = T.jump;
    setTimeout(() => location.replace(url), 900);
  } else {
    $('#c-text').textContent = T.none;
  }
  $('#c-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); $('#c-copy').textContent = T.copied; } catch { /* กดค้างที่โค้ดแล้วคัดลอกเองได้ */ }
  });
})();
