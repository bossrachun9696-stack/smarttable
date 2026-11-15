// ===== หน้า พิมพ์ QR (print.html?id=<shop_id>[&table=<table_id>]) =====
(async function () {
  const { sb, configOk, $, esc, thaiError, pageUrl, showMsg, requireUser } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;

  const q = new URLSearchParams(location.search);
  const shopId = q.get('id');
  const only = q.get('table');
  if (!shopId) return location.replace('home.html');
  $('#back').href = 'tables.html?id=' + encodeURIComponent(shopId);

  const { data: shop } = await sb.from('st_shops').select('name').eq('id', shopId).maybeSingle();
  const { data: tables, error } = await sb.rpc('st_tables_board', { p_shop: shopId });
  if (error || !shop) { $('#print-info').textContent = ''; return showMsg(error ? thaiError(error) : 'ไม่พบร้านนี้'); }

  const list = tables.filter(t => t.is_active && (!only || t.id === only));
  $('#print-info').textContent = `${list.length} โต๊ะ · ${Math.ceil(list.length / 6) || 0} หน้า`;
  if (!list.length) return showMsg('ยังไม่มีโต๊ะที่ใช้งานอยู่ให้พิมพ์');

  const card = (t) => `
    <div class="st-qcard">
      <p class="q-shop">${esc(shop.name)}</p>
      <div class="q-table">โต๊ะ ${esc(t.label)}</div>
      <div class="q-code">${STQR.svg(pageUrl('table.html') + '?t=' + encodeURIComponent(t.qr_token), { margin: 1 })}</div>
      <p class="q-text">สแกนเพื่อดูเมนูและสั่งอาหาร</p>
      <p class="q-foot">SmartTable</p>
    </div>`;

  let html = '';
  for (let i = 0; i < list.length; i += 6) {
    html += `<section class="st-a4">${list.slice(i, i + 6).map(card).join('')}</section>`;
  }
  $('#sheets').innerHTML = html;
  document.title = `QR โต๊ะ · ${shop.name}`;
  $('#btn-print').addEventListener('click', () => window.print());
})();
