// ===== หน้า ใบเสร็จ (receipt.html?id=<shop_id>&p=<payment_id>[&new=1]) =====
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, requireUser } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;

  const q = new URLSearchParams(location.search);
  const shopId = q.get('id'), pid = q.get('p');
  if (!shopId || !pid) return location.replace('home.html');
  const fromQueue = new URLSearchParams(location.search).get('from') === 'queue';
  $('#back').href = (fromQueue ? 'queue.html?id=' : 'tables.html?id=') + encodeURIComponent(shopId);
  if (fromQueue) $('#back').textContent = '‹ คิวกลับบ้าน';
  $('#btn-list').href = 'receipts.html?id=' + encodeURIComponent(shopId);

  const { data: me } = await sb.from('st_shop_members').select('role')
    .eq('shop_id', shopId).eq('user_id', user.id).maybeSingle();
  const canVoid = me && ['owner', 'manager'].includes(me.role);

  const baht = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const METHOD = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', transfer: 'โอนเงิน', card: 'บัตร', mixed: 'หลายช่องทาง' };
  const nextUrl = q.get('next') && /^bill\.html\?/.test(q.get('next')) ? q.get('next') : null;

  const fmtTax = (id) => String(id || '').replace(/^(\d)(\d{4})(\d{5})(\d{2})(\d)$/, '$1-$2-$3-$4-$5');

  async function load() {
    const { data: r, error } = await sb.rpc('st_receipt', { p_payment: pid });
    if (error) return showMsg(thaiError(error));
    const at = new Date(r.created_at);
    const ymd = at.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).replace(/-/g, '');
    document.title = `ใบเสร็จ ${ymd}-${String(r.receipt_no).padStart(3, '0')}`;

    const tax = r.tax;                                   // มี = ใบกำกับภาษีอย่างย่อ
    const tenders = Array.isArray(r.tenders) && r.tenders.length ? r.tenders
      : [{ method: r.method, amount: r.total, received: r.received, change: r.change }];
    const split = r.parts > 1 || r.portion !== 'full' || r.part_no > 1;
    $('#rc').innerHTML = `
      ${r.status === 'void' ? '<div class="void">ยกเลิก</div>' : ''}
      <h1>${esc(r.shop.name)}</h1>
      ${tax && tax.name && tax.name !== r.shop.name ? `<div class="c">${esc(tax.name)}</div>` : ''}
      ${(tax && tax.address) || r.shop.address ? `<div class="c muted">${esc((tax && tax.address) || r.shop.address)}</div>` : ''}
      ${r.shop.phone ? `<div class="c muted">โทร ${esc(r.shop.phone)}</div>` : ''}
      ${tax ? `<div class="c muted">เลขประจำตัวผู้เสียภาษี ${esc(fmtTax(tax.tax_id))}${tax.branch ? ` (${esc(tax.branch)})` : ''}</div>
               ${tax.pos_id ? `<div class="c muted">POS ID ${esc(tax.pos_id)}</div>` : ''}` : ''}
      <div class="title">${tax ? 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ' : 'ใบเสร็จรับเงิน'}</div>
      <div class="row"><span>เลขที่</span><span>${ymd}-${String(r.receipt_no).padStart(3, '0')}</span></div>
      <div class="row"><span>วันที่</span><span>${at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} ${at.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="row"><span>โต๊ะ</span><span>${esc(r.table_label)}${r.guest_count ? ` · ${r.guest_count} คน` : ''}</span></div>
      ${split ? `<div class="row"><span>แยกจ่าย</span><span>ใบที่ ${r.part_no}</span></div>` : ''}
      ${r.cashier ? `<div class="row"><span>พนักงาน</span><span>${esc(r.cashier)}</span></div>` : ''}
      <hr>
      ${r.share ? `<div class="muted">รายการทั้งโต๊ะ (ค่าอาหารรวม ${baht(r.session_subtotal)})</div>` : ''}
      ${r.items.map(i => `
        <div class="item">
          <div class="row"><span>${i.qty} ${esc(i.name)}</span><span>${baht(i.line_total)}</span></div>
          ${i.options ? `<small>${esc(i.options)}</small>` : ''}
        </div>`).join('')}
      <hr>
      <div class="row"><span>${r.share ? 'ค่าอาหารส่วนที่ชำระ' : 'รวมค่าอาหาร'}</span><span>${baht(r.subtotal)}</span></div>
      ${Number(r.discount) ? `<div class="row"><span>ส่วนลด</span><span>-${baht(r.discount)}</span></div>` : ''}
      ${Number(r.service_pct) ? `<div class="row"><span>ค่าบริการ ${Number(r.service_pct)}%</span><span>${baht(r.service)}</span></div>` : ''}
      ${Number(r.vat_pct) && !r.vat_included ? `<div class="row"><span>VAT ${Number(r.vat_pct)}%</span><span>${baht(r.vat)}</span></div>` : ''}
      <div class="row total"><span>ยอดสุทธิ</span><span>${baht(r.total)}</span></div>
      ${Number(r.vat_pct) && (r.vat_included || tax) ? `<div class="row muted"><span>${tax ? 'ราคารวมภาษีมูลค่าเพิ่มแล้ว (VAT Included)' : `ราคารวม VAT ${Number(r.vat_pct)}% แล้ว`}</span><span>${tax ? '' : baht(r.vat)}</span></div>` : ''}
      ${tax ? `<div class="row muted"><span>ภาษีมูลค่าเพิ่ม ${Number(r.vat_pct)}%</span><span>${baht(r.vat)}</span></div>
               <div class="row muted"><span>มูลค่าก่อนภาษี</span><span>${baht(Number(r.total) - Number(r.vat))}</span></div>` : ''}
      <hr>
      ${tenders.map(t => `
        <div class="row"><span>${tenders.length > 1 ? '· ' : 'ชำระโดย '}${METHOD[t.method] || t.method}</span><span>${tenders.length > 1 || t.method !== 'cash' ? baht(t.amount) : ''}</span></div>
        ${t.method === 'cash' && Number(t.received) > Number(t.amount) ? `
          <div class="row muted"><span>&nbsp; รับเงิน</span><span>${baht(t.received)}</span></div>
          <div class="row muted"><span>&nbsp; เงินทอน</span><span>${baht(t.change)}</span></div>` : ''}`).join('')}
      ${tenders.length === 1 && tenders[0].method === 'cash' && !(Number(tenders[0].received) > Number(tenders[0].amount)) ? `<div class="row"><span>รับเงิน</span><span>${baht(r.received)}</span></div>` : ''}
      ${r.self_pay ? '<div class="muted">ลูกค้าโอนพร้อมเพย์เองจากหน้าโต๊ะ</div>' : ''}
      ${r.note ? `<div class="muted">หมายเหตุ: ${esc(r.note)}</div>` : ''}
      ${r.status === 'void' ? `<div class="muted">ยกเลิกเพราะ: ${esc(r.void_reason || '')}</div>` : ''}
      <hr>
      <div class="c">ขอบคุณที่ใช้บริการ</div>
      <div class="c muted">SmartTable</div>`;
    $('#rc').hidden = false;
    $('#rc-actions').hidden = false;

    if (q.get('new') === '1' && r.status === 'paid') {
      $('#done').innerHTML = (r.session_open && Number(r.remaining) > 0
          ? `<b>รับเงินแล้ว · ใบที่ ${r.part_no}</b>โต๊ะ ${esc(r.table_label)} ยังเหลือค่าอาหาร ฿${baht(r.remaining)}<br>`
          : r.session_open ? `<b>รับเงินครบแล้ว · ${esc(r.table_label)}</b>รอลูกค้ารับอาหาร<br>`
          : `<b>รับเงินแล้ว · ปิดโต๊ะ ${esc(r.table_label)}</b>`)
        + (Number(r.change) ? `ทอนเงิน <b>฿${baht(r.change)}</b>` : '');
      $('#done').hidden = false;
    }
    const nx = r.session_open && r.status === 'paid' && Number(r.remaining) > 0
      ? (nextUrl || `bill.html?id=${encodeURIComponent(shopId)}&table=${encodeURIComponent(r.table_id)}`) : null;
    $('#btn-next').hidden = !nx;
    if (nx) { $('#btn-next').href = nx; $('#btn-next').textContent = `เก็บเงินส่วนถัดไป (เหลือ ฿${baht(r.remaining)})`; }
    $('#btn-void').hidden = !(canVoid && r.status === 'paid');
    const slips = r.slips && r.slips.length ? r.slips : (r.slip_path ? [r.slip_path] : []);
    $('#slips').innerHTML = slips.map((p, i) => `<button type="button" class="st-btn st-btn--ghost" data-slip="${esc(p)}">ดูรูปสลิป${slips.length > 1 ? ' ' + (i + 1) : ''}</button>`).join('');
  }

  $('#btn-print').addEventListener('click', () => window.print());
  $('#slips').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-slip]');
    if (!b) return;
    const w = window.open('', '_blank');                 // เปิดก่อน await กัน Safari บล็อกป๊อปอัป
    const { data, error: er } = await sb.storage.from('st-slips').createSignedUrl(b.dataset.slip, 300);
    if (er) { if (w) w.close(); return showMsg('เปิดสลิปไม่ได้: ' + thaiError(er)); }
    if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
  });
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
