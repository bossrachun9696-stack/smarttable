// ===== หน้า ใบเสร็จ (receipt.html?id=<shop_id>&p=<payment_id>[&new=1]) =====
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, requireUser } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;

  const q = new URLSearchParams(location.search);
  const shopId = q.get('id'), pid = q.get('p');
  if (!shopId || !pid) return location.replace('home.html');
  $('#back').href = 'tables.html?id=' + encodeURIComponent(shopId);
  $('#btn-list').href = 'receipts.html?id=' + encodeURIComponent(shopId);

  const { data: me } = await sb.from('st_shop_members').select('role')
    .eq('shop_id', shopId).eq('user_id', user.id).maybeSingle();
  const canVoid = me && ['owner', 'manager'].includes(me.role);

  const baht = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const METHOD = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', transfer: 'โอนเงิน', card: 'บัตร' };

  async function load() {
    const { data: r, error } = await sb.rpc('st_receipt', { p_payment: pid });
    if (error) return showMsg(thaiError(error));
    const at = new Date(r.created_at);
    const ymd = at.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).replace(/-/g, '');
    document.title = `ใบเสร็จ ${ymd}-${String(r.receipt_no).padStart(3, '0')}`;

    $('#rc').innerHTML = `
      ${r.status === 'void' ? '<div class="void">ยกเลิก</div>' : ''}
      <h1>${esc(r.shop.name)}</h1>
      ${r.shop.address ? `<div class="c muted">${esc(r.shop.address)}</div>` : ''}
      ${r.shop.phone ? `<div class="c muted">โทร ${esc(r.shop.phone)}</div>` : ''}
      <div class="title">ใบเสร็จรับเงิน</div>
      <div class="row"><span>เลขที่</span><span>${ymd}-${String(r.receipt_no).padStart(3, '0')}</span></div>
      <div class="row"><span>วันที่</span><span>${at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} ${at.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="row"><span>โต๊ะ</span><span>${esc(r.table_label)}${r.guest_count ? ` · ${r.guest_count} คน` : ''}</span></div>
      ${r.cashier ? `<div class="row"><span>พนักงาน</span><span>${esc(r.cashier)}</span></div>` : ''}
      <hr>
      ${r.items.map(i => `
        <div class="item">
          <div class="row"><span>${i.qty} ${esc(i.name)}</span><span>${baht(i.line_total)}</span></div>
          ${i.options ? `<small>${esc(i.options)}</small>` : ''}
        </div>`).join('')}
      <hr>
      <div class="row"><span>รวมค่าอาหาร</span><span>${baht(r.subtotal)}</span></div>
      ${Number(r.discount) ? `<div class="row"><span>ส่วนลด</span><span>-${baht(r.discount)}</span></div>` : ''}
      ${Number(r.service_pct) ? `<div class="row"><span>ค่าบริการ ${Number(r.service_pct)}%</span><span>${baht(r.service)}</span></div>` : ''}
      ${Number(r.vat_pct) && !r.vat_included ? `<div class="row"><span>VAT ${Number(r.vat_pct)}%</span><span>${baht(r.vat)}</span></div>` : ''}
      <div class="row total"><span>ยอดสุทธิ</span><span>${baht(r.total)}</span></div>
      ${Number(r.vat_pct) && r.vat_included ? `<div class="row muted"><span>ราคารวม VAT ${Number(r.vat_pct)}% แล้ว</span><span>${baht(r.vat)}</span></div>` : ''}
      <hr>
      <div class="row"><span>ชำระโดย</span><span>${METHOD[r.method]}</span></div>
      ${r.method === 'cash' ? `
        <div class="row"><span>รับเงิน</span><span>${baht(r.received)}</span></div>
        <div class="row"><span>เงินทอน</span><span>${baht(r.change)}</span></div>` : ''}
      ${r.note ? `<div class="muted">หมายเหตุ: ${esc(r.note)}</div>` : ''}
      ${r.status === 'void' ? `<div class="muted">ยกเลิกเพราะ: ${esc(r.void_reason || '')}</div>` : ''}
      <hr>
      <div class="c">ขอบคุณที่ใช้บริการ</div>
      <div class="c muted">SmartTable</div>`;
    $('#rc').hidden = false;
    $('#rc-actions').hidden = false;

    if (q.get('new') === '1' && r.status === 'paid') {
      $('#done').innerHTML = `<b>รับเงินแล้ว · ปิดโต๊ะ ${esc(r.table_label)}</b>`
        + (r.method === 'cash' && Number(r.change) ? `ทอนเงิน <b>฿${baht(r.change)}</b>` : '');
      $('#done').hidden = false;
    }
    $('#btn-void').hidden = !(canVoid && r.status === 'paid');
    $('#btn-slip').hidden = !r.has_slip;
    $('#btn-slip').onclick = async () => {
      const { data, error: e } = await sb.storage.from('st-slips').createSignedUrl(r.slip_path, 300);
      if (e) return showMsg('เปิดสลิปไม่ได้: ' + thaiError(e));
      window.open(data.signedUrl, '_blank');
    };
  }

  $('#btn-print').addEventListener('click', () => window.print());
  $('#btn-void').addEventListener('click', async () => {
    const reason = prompt('เหตุผลที่ยกเลิกใบเสร็จนี้ (บังคับ)');
    if (reason === null) return;
    if (!reason.trim()) return showMsg('กรุณาใส่เหตุผล');
    const { error } = await sb.rpc('st_void_payment', { p_payment: pid, p_reason: reason.trim() });
    if (error) return showMsg(thaiError(error));
    showMsg('ยกเลิกใบเสร็จแล้ว (ยอดนี้จะไม่นับในรายงาน)', 'ok');
    $('#done').hidden = true;
    load();
  });

  await load();
})();
