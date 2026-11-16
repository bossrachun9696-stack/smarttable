// ===== หน้า เช็กบิล / รับเงิน (bill.html?id=<shop_id>&table=<table_id>) =====
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, requireUser } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;

  const q = new URLSearchParams(location.search);
  const shopId = q.get('id'), tableId = q.get('table');
  if (!shopId || !tableId) return location.replace('home.html');
  const backUrl = 'tables.html?id=' + encodeURIComponent(shopId);
  $('#back').href = backUrl;

  const { data: me } = await sb.from('st_shop_members').select('role')
    .eq('shop_id', shopId).eq('user_id', user.id).maybeSingle();
  const role = me ? me.role : null;
  const canDiscount = ['owner', 'manager', 'cashier'].includes(role);
  if (!canDiscount) $('#b-disc-wrap').hidden = true;

  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let data = null;        // ผล st_checkout_preview
  let method = 'cash';
  let slipBlob = null;

  // ---------- ส่วนลด: บาท / % / คูปอง ----------
  let unit = 'baht';
  let coupon = null;             // {coupon_id, code, discount, label}
  function discAmount() {
    if (!canDiscount) return 0;
    if (coupon) return Number(coupon.discount);
    const v = Math.max(0, parseFloat($('#b-disc').value) || 0);
    if (unit === 'pct') return data ? Math.round(Number(data.bill.subtotal) * Math.min(v, 100)) / 100 : 0;
    return v;
  }
  $('#b-unit').addEventListener('click', (e) => {
    const b = e.target.closest('[data-u]');
    if (!b) return;
    unit = b.dataset.u;
    document.querySelectorAll('#b-unit button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    $('#b-disc').max = unit === 'pct' ? 100 : '';
    load();
  });
  async function applyCoupon(code) {
    const { data: q, error } = await sb.rpc('st_coupon_quote', { p_table: tableId, p_code: code });
    if (error) {
      coupon = null;
      const MSG = { st_coupon_invalid: 'ไม่พบคูปองนี้ หรือถูกปิดแล้ว', st_coupon_expired: 'คูปองยังไม่ถึงวันใช้ หรือหมดอายุแล้ว',
                    st_coupon_used_up: 'คูปองนี้ถูกใช้ครบจำนวนแล้ว', st_coupon_min: 'ยอดยังไม่ถึงขั้นต่ำของคูปอง' };
      showMsg((MSG[error.message] || thaiError(error)) + (error.details && error.message === 'st_coupon_min' ? ` (${error.details} บาท)` : ''));
    } else {
      coupon = q;
    }
    renderCoupon();
    load();
  }
  function renderCoupon() {
    $('#b-coupon-on').hidden = !coupon;
    $('#b-disc').disabled = !!coupon;
    if (coupon) $('#b-coupon-on').innerHTML = `🎟 <b>${esc(coupon.code)}</b> · ${esc(coupon.label)} <button type="button" class="st-chip" id="b-coupon-off">เอาออก</button>`;
  }
  $('#b-coupon-apply').addEventListener('click', () => {
    const code = $('#b-coupon').value.trim().toUpperCase();
    if (code) applyCoupon(code);
  });
  $('#b-coupon-on').addEventListener('click', (e) => {
    if (e.target.id === 'b-coupon-off') { coupon = null; $('#b-coupon').value = ''; renderCoupon(); load(); }
  });

  // ---------- โหลด ----------
  async function load() {
    const disc = discAmount();
    const { data: d, error } = await sb.rpc('st_checkout_preview', { p_table: tableId, p_discount: disc });
    if (error) { $('#b-sub').textContent = ''; return showMsg(thaiError(error)); }
    if (!d) {
      $('#b-sub').textContent = '';
      $('#b-body').hidden = true;
      return showMsg('โต๊ะนี้ไม่ได้เปิดอยู่ หรือรับเงินไปแล้ว');
    }
    data = d;
    render();
    $('#b-body').hidden = false;
  }

  function render() {
    const d = data, b = d.bill;
    $('#b-title').textContent = `เช็กบิล โต๊ะ ${d.table_label}`;
    $('#b-sub').textContent = d.shop_name + (d.guest_count ? ` · ${d.guest_count} คน` : '');
    $('#b-time').textContent = 'เปิด ' + new Date(d.opened_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    document.title = `เช็กบิล โต๊ะ ${d.table_label}`;

    $('#b-warn').hidden = !d.unfinished;
    $('#b-warn').textContent = `มี ${d.unfinished} ออร์เดอร์ที่ยังไม่ได้เสิร์ฟ ตรวจกับครัวก่อนเก็บเงิน`;

    // รวมรายการซ้ำ (ชื่อ + ตัวเลือก + ราคาเดียวกัน)
    const lines = new Map();
    d.orders.filter(o => o.status !== 'cancelled').forEach(o => o.items.forEach(i => {
      const opts = i.options.map(x => x.name).join(' · ');
      const k = [i.name, opts, i.unit_price].join('|');
      const l = lines.get(k) || { name: i.name, opts, qty: 0, total: 0 };
      l.qty += i.qty; l.total += Number(i.line_total);
      lines.set(k, l);
    }));
    const cancelled = d.orders.filter(o => o.status === 'cancelled').length;
    $('#b-items').innerHTML = (lines.size ? [...lines.values()].map(l => `
      <div class="st-oline"><span>${l.qty}× ${esc(l.name)}${l.opts ? `<small>${esc(l.opts)}</small>` : ''}</span><span>${baht(l.total)}</span></div>`).join('')
      : '<p class="st-sub">ยังไม่มีรายการ</p>')
      + (cancelled ? `<p class="st-sub" style="margin:8px 0 0">ไม่นับ ${cancelled} ออร์เดอร์ที่ยกเลิก</p>` : '');

    $('#b-bill').innerHTML = `
      <div><span>ค่าอาหาร</span><span>${baht(b.subtotal)}</span></div>
      ${Number(b.discount) ? `<div><span>ส่วนลด</span><span>−${baht(b.discount)}</span></div>` : ''}
      ${Number(b.service_pct) ? `<div><span>ค่าบริการ ${Number(b.service_pct)}%</span><span>${baht(b.service)}</span></div>` : ''}
      ${Number(b.vat_pct) ? `<div><span>VAT ${Number(b.vat_pct)}%${b.vat_included ? ' (รวมในราคาแล้ว)' : ''}</span><span>${baht(b.vat)}</span></div>` : ''}
      <div class="st-bill-total"><span>ยอดที่ต้องชำระ</span><b>${baht(b.total)}</b></div>`;

    renderMethod();
  }

  // ---------- วิธีชำระ ----------
  function quickAmounts(total) {
    const out = [total];
    for (const step of [20, 50, 100, 500, 1000]) {
      const v = Math.ceil(total / step) * step;
      if (v > total && !out.includes(v)) out.push(v);
    }
    return out.slice(0, 5);
  }

  function renderMethod() {
    const total = Number(data.bill.total);
    document.querySelectorAll('#b-methods button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.m === method)));
    document.querySelector('[data-panel="cash"]').hidden = method !== 'cash';
    document.querySelector('[data-panel="promptpay"]').hidden = method !== 'promptpay';
    document.querySelector('[data-panel="slip"]').hidden = method === 'cash';

    if (method === 'cash') {
      $('#b-quick').innerHTML = quickAmounts(total).map((v, i) =>
        `<button type="button" class="st-chip" data-amt="${v}">${i === 0 ? 'พอดี ' : ''}${baht(v).replace('.00', '')}</button>`).join('');
      updateChange();
    }
    if (method === 'promptpay') {
      const pl = window.STPromptPay.payload(data.promptpay_id, total);
      $('#b-pp').innerHTML = pl ? `
          <div class="st-qr-big st-pp">${STQR.svg(pl, { margin: 2 })}</div>
          <p class="st-center"><b class="st-pp-amt">${baht(total)}</b><br>
          <span class="st-sub">พร้อมเพย์ ${esc(maskPP(data.promptpay_id))} · ให้ลูกค้าสแกนด้วยแอปธนาคาร แล้วตรวจยอดเข้าก่อนกดรับเงิน</span></p>`
        : `<p class="st-msg st-msg--error">ร้านยังไม่ได้ตั้งเลขพร้อมเพย์ ไปที่ ร้าน › ข้อมูลร้าน › พร้อมเพย์</p>`;
    }
    $('#b-pay').textContent = `รับเงิน ${baht(total)} · ปิดโต๊ะ`;
  }
  const maskPP = (id) => { const s = String(id || ''); return s.length > 4 ? s.slice(0, 3) + '•••' + s.slice(-3) : s; };

  function updateChange() {
    const total = Number(data.bill.total);
    const recv = parseFloat($('#b-recv').value);
    const ch = Number.isFinite(recv) ? recv - total : 0;
    $('#b-change').textContent = Number.isFinite(recv) ? (ch >= 0 ? baht(ch) : 'ยังขาด ' + baht(-ch)) : '—';
    $('#b-change').classList.toggle('st-bad', Number.isFinite(recv) && ch < 0);
  }

  $('#b-methods').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    method = b.dataset.m;
    renderMethod();
  });
  $('#b-quick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-amt]');
    if (!b) return;
    $('#b-recv').value = b.dataset.amt;
    updateChange();
  });
  $('#b-recv').addEventListener('input', updateChange);

  let dt;
  $('#b-disc').addEventListener('input', () => { clearTimeout(dt); dt = setTimeout(load, 400); });

  // ---------- สลิป ----------
  async function shrink(file, max = 1400) {
    let src, w, h;
    try { src = await createImageBitmap(file); w = src.width; h = src.height; }
    catch {
      src = await new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = URL.createObjectURL(file); });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    const s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
  }
  $('#slip-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      slipBlob = await shrink(file);
      $('#slip-preview').innerHTML = `<img src="${URL.createObjectURL(slipBlob)}" alt="">`;
      $('#slip-remove').hidden = false;
    } catch { showMsg('อ่านรูปนี้ไม่ได้ ลองรูปอื่น'); }
  });
  $('#slip-remove').addEventListener('click', () => {
    slipBlob = null;
    $('#slip-preview').textContent = 'ไม่บังคับ';
    $('#slip-remove').hidden = true;
  });

  // ---------- รับเงิน ----------
  $('#b-pay').addEventListener('click', async () => {
    const total = Number(data.bill.total);
    let received = null;
    if (method === 'cash') {
      received = parseFloat($('#b-recv').value);
      if (!Number.isFinite(received)) received = total;              // ไม่กรอก = รับพอดี
      if (received < total) return showMsg('รับเงินมาน้อยกว่ายอดที่ต้องจ่าย');
    }
    if (method === 'promptpay' && !window.STPromptPay.payload(data.promptpay_id, total)) {
      return showMsg('ร้านยังไม่ได้ตั้งเลขพร้อมเพย์');
    }
    const label = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', transfer: 'โอน', card: 'บัตร' }[method];
    if (!confirm(`ยืนยันรับเงิน ${baht(total)} (${label}) และปิดโต๊ะ ${data.table_label}?`)) return;

    const btn = $('#b-pay');
    btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
    let slipPath = null;
    if (slipBlob && method !== 'cash') {
      const rand = (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(36).slice(2));
      slipPath = `shops/${shopId}/slips/${rand}.jpg`;
      const { error: upErr } = await sb.storage.from('st-slips').upload(slipPath, slipBlob, { contentType: 'image/jpeg', upsert: false });
      if (upErr) { btn.disabled = false; renderMethod(); return showMsg('อัปโหลดสลิปไม่สำเร็จ: ' + thaiError(upErr)); }
    }
    const { data: res, error } = await sb.rpc('st_record_payment', {
      p_table: tableId, p_method: method,
      p_discount: discAmount(),
      p_received: received, p_slip_path: slipPath, p_note: $('#b-note').value.trim() || null
    });
    if (error) {
      btn.disabled = false; renderMethod();
      if (error.message === 'st_already_paid' || error.message === 'st_table_not_open') load();
      return showMsg(thaiError(error));
    }
    if (coupon && Number(res.total) >= 0) {
      const { error: cErr } = await sb.rpc('st_coupon_redeem', { p_payment: res.payment_id, p_coupon: coupon.coupon_id });
      if (cErr) alert('รับเงินแล้ว แต่บันทึกการใช้คูปองไม่สำเร็จ: ' + thaiError(cErr));
    }
    location.replace(`receipt.html?id=${encodeURIComponent(shopId)}&p=${encodeURIComponent(res.payment_id)}&new=1`);
  });

  await load();
})();
