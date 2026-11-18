// ===== หน้า ประวัติการทำงาน (audit.html?id=<shop_id>) — เจ้าของ / ผู้จัดการ =====
(async function () {
  const { sb, configOk, $, esc, ROLE_TH, thaiError, showMsg, hideMsg, requireUser } = ST;
  if (!configOk) return;
  if (!(await requireUser())) return;
  const shopId = new URLSearchParams(location.search).get('id');
  if (!shopId) return location.replace('home.html');
  ST.markSeen(shopId, 'audit');
  $('#back').href = 'shop.html?id=' + encodeURIComponent(shopId);

  const money = (n) => '฿' + Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ACTION = {
    order_cancel:      { th: 'ยกเลิกออร์เดอร์', icon: '✕', risk: 1 },
    discount:          { th: 'ให้ส่วนลด', icon: '％', risk: 1 },
    close_unpaid:      { th: 'ปิดโต๊ะโดยไม่เก็บเงิน', icon: '⚠️', risk: 2 },
    auto_close_unpaid: { th: 'ระบบปิดโต๊ะที่ลืม (ยังไม่เก็บเงิน)', icon: '⏱', risk: 2 },
    payment_void:      { th: 'ยกเลิกใบเสร็จ', icon: '🧾', risk: 2 },
    promptpay_change:  { th: 'เปลี่ยนเลขพร้อมเพย์', icon: '📱', risk: 2 },
    tax_change:        { th: 'เปลี่ยนค่าบริการ / VAT', icon: '⚙️', risk: 1 },
    price_change:      { th: 'เปลี่ยนราคาเมนู', icon: '฿', risk: 0 },
    table_move:        { th: 'ย้ายโต๊ะ', icon: '↔', risk: 0 },
    table_merge:       { th: 'รวมโต๊ะ', icon: '⇉', risk: 0 },
    member_add:        { th: 'เพิ่มพนักงาน', icon: '+', risk: 0 },
    member_role:       { th: 'เปลี่ยนตำแหน่งพนักงาน', icon: '↻', risk: 1 },
    member_remove:     { th: 'นำพนักงานออก', icon: '−', risk: 1 }
  };
  const role = (r) => ROLE_TH[r] || r || '';
  function detailText(e) {
    const d = e.detail || {};
    switch (e.action) {
      case 'order_cancel': return `ออร์เดอร์ #${d.order_no} · ${money(e.amount)}`;
      case 'discount': return `ใบเสร็จ #${d.receipt_no} · ลด ${money(e.amount)} จาก ${money(d.subtotal)}`;
      case 'close_unpaid':
      case 'auto_close_unpaid': return `ค้างจ่าย ${money(e.amount)}`;
      case 'payment_void': return `ใบเสร็จ #${d.receipt_no} · ${money(e.amount)} · เหตุผล: ${d.reason || '-'}`;
      case 'promptpay_change': return `${d.old || '(ว่าง)'} → ${d.new || '(ว่าง)'}`;
      case 'tax_change': return `ค่าบริการ ${d.service_pct?.[0]}% → ${d.service_pct?.[1]}% · VAT ${d.vat_pct?.[0]}% → ${d.vat_pct?.[1]}%`;
      case 'price_change': return `${d.name}: ${money(d.old_price)} → ${money(d.new_price)}`;
      case 'table_move': return `โต๊ะ ${d.from} → ${d.to}`;
      case 'table_merge': return `โต๊ะ ${d.from} → รวมเข้าโต๊ะ ${d.into}`;
      case 'member_add': return `${d.member || ''} (${role(d.role)})`;
      case 'member_role': return `${d.member || ''}: ${role(d.old_role)} → ${role(d.new_role)}`;
      case 'member_remove': return `${d.member || ''} (${role(d.role)})`;
      default: return '';
    }
  }

  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  let data = null, kind = 'all';

  function setPreset(p) {
    const t = today();
    const n = Number(p);
    $('#d-from').value = n === 1 ? addDays(t, -1) : addDays(t, -Math.max(0, n - 1));
    $('#d-to').value = n === 1 ? addDays(t, -1) : t;
    document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === String(p))));
    load();
  }
  $('#presets').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) setPreset(b.dataset.p); });
  const onDate = () => {
    document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', 'false'));
    if ($('#d-from').value && $('#d-to').value) load();
  };
  $('#d-from').addEventListener('change', onDate);
  $('#d-to').addEventListener('change', onDate);

  async function load() {
    let f = $('#d-from').value, t = $('#d-to').value;
    if (t < f) [f, t] = [t, f];
    hideMsg();
    const { data: d, error } = await sb.rpc('st_audit_report', { p_shop: shopId, p_from: f, p_to: t });
    if (error) {
      $('#a-body').hidden = true;
      return showMsg(error.message === 'st_forbidden' ? 'ประวัติการทำงานดูได้เฉพาะเจ้าของร้านและผู้จัดการ'
        : error.message === 'st_bad_date_range' ? 'ช่วงวันที่ไม่ถูกต้อง (ดูได้ไม่เกิน 366 วัน)' : thaiError(error));
    }
    data = d;
    render();
    $('#a-body').hidden = false;
  }

  function render() {
    const s = data.by_staff;
    $('#by-staff').innerHTML = s.length ? `<div class="st-scroll"><table class="st-tbl st-tbl--staff">
      <thead><tr><th>พนักงาน</th><th>ยกเลิกออร์เดอร์</th><th>ส่วนลด</th><th>ปิดไม่เก็บเงิน</th><th>ยกเลิกใบเสร็จ</th></tr></thead><tbody>
      ${s.map(r => `<tr><td>${esc(r.who)}</td>
        <td>${r.cancels ? `${r.cancels} · ${money(r.cancel_amount)}` : '–'}</td>
        <td>${r.discounts ? `${r.discounts} · ${money(r.discount_amount)}` : '–'}</td>
        <td class="${r.unpaid ? 'st-bad' : ''}">${r.unpaid ? `${r.unpaid} · ${money(r.unpaid_amount)}` : '–'}</td>
        <td class="${r.voids ? 'st-bad' : ''}">${r.voids ? `${r.voids} · ${money(r.void_amount)}` : '–'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="st-sub">ไม่มีรายการที่เกี่ยวกับเงินในช่วงนี้ 👍</p>';

    const counts = {};
    data.events.forEach(e => { counts[e.action] = (counts[e.action] || 0) + 1; });
    $('#kinds').innerHTML = `<button type="button" data-k="all" aria-pressed="${kind === 'all'}">ทั้งหมด ${data.events.length}</button>`
      + Object.keys(counts).map(k => `<button type="button" data-k="${k}" aria-pressed="${kind === k}">${esc(ACTION[k]?.th || k)} ${counts[k]}</button>`).join('');

    const list = data.events.filter(e => kind === 'all' || e.action === kind);
    $('#events').innerHTML = list.length ? list.map(e => {
      const a = ACTION[e.action] || { th: e.action, icon: '•', risk: 0 };
      const at = new Date(e.at);
      return `<div class="st-ev st-ev--r${a.risk}">
        <span class="st-ev-icon" aria-hidden="true">${a.icon}</span>
        <div class="st-ev-main">
          <b>${esc(a.th)}${e.table_label ? ` · โต๊ะ ${esc(e.table_label)}` : ''}</b>
          <small>${esc(detailText(e))}</small>
          <small>${esc(e.who)} · ${at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} ${at.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</small>
        </div></div>`;
    }).join('') : '<p class="st-sub">ไม่มีรายการ</p>';
  }
  $('#kinds').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { kind = b.dataset.k; render(); } });

  setPreset(7);
})();
