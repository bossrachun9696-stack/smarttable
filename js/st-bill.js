// ===== หน้า เช็กบิล / รับเงิน (bill.html?id=<shop_id>&table=<table_id>[&split=equal&n=3]) =====
// แยกบิล: ทั้งหมด / หารเท่ากัน / เลือกรายการ · ส่วนลด ฿ / % / คูปอง ต่อใบ · จ่ายหลายช่องทาง · ยืนยันสลิปที่ลูกค้าแนบ
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, requireUser } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;

  const q = new URLSearchParams(location.search);
  const shopId = q.get('id'), tableId = q.get('table');
  if (!shopId || !tableId) return location.replace('home.html');
  const fromQueue = q.get('from') === 'queue';
  const backUrl = (fromQueue ? 'queue.html?id=' : 'tables.html?id=') + encodeURIComponent(shopId);
  if (fromQueue) $('#back').textContent = '‹ คิวกลับบ้าน';
  $('#back').href = backUrl;

  const { data: me } = await sb.from('st_shop_members').select('role')
    .eq('shop_id', shopId).eq('user_id', user.id).maybeSingle();
  const role = me ? me.role : null;
  const canDiscount = ['owner', 'manager', 'cashier'].includes(role);
  if (!canDiscount) $('#b-disc-wrap').hidden = true;

  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const round2 = (n) => Math.round(n * 100) / 100;
  const METHOD = { cash: '💵 เงินสด', promptpay: '📱 พร้อมเพย์', transfer: '🏦 โอน', card: '💳 บัตร', mixed: '🔀 หลายช่องทาง' };
  const LABEL = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', transfer: 'โอน', card: 'บัตร' };

  let data = null;          // ผล st_bill_preview
  let method = 'cash';
  let multi = false;
  let tenders = [];         // หลายช่องทาง: [{method, amount}] (แถวสุดท้ายคิดยอดที่เหลือให้เอง)
  let slipBlob = null;

  // ---------- แบ่งจ่าย ----------
  let split = ['all', 'equal', 'items'].includes(q.get('split')) ? q.get('split') : 'all';
  let nEqual = Math.min(20, Math.max(2, parseInt(q.get('n'), 10) || 2));
  const sel = new Map();    // order_item_id -> qty ที่เลือกจ่าย

  const remaining = () => data ? Number(data.money.remaining) : 0;
  function part() {
    if (split === 'equal') return nEqual <= 1 ? null : { amount: round2(remaining() / nEqual) };
    if (split === 'items') {
      const items = [...sel].filter(([, n]) => n > 0).map(([id, n]) => ({ id, qty: n }));
      return items.length ? { items } : { items: [] };
    }
    return null;
  }
  function partSub() {                    // ค่าอาหารของใบนี้ (คำนวณในเครื่อง ไว้คิดส่วนลด %)
    if (!data) return 0;
    if (split === 'equal') return nEqual <= 1 ? remaining() : round2(remaining() / nEqual);
    if (split === 'items') {
      let s = 0;
      for (const l of data.lines) {
        const n = sel.get(l.id) || 0;
        if (!n) continue;
        const left = l.qty - l.paid_qty;
        s += n === left ? Number(l.line_total) - Number(l.paid_amount) : round2(Number(l.line_total) * n / l.qty);
      }
      return round2(s);
    }
    return remaining();
  }
  const noItemsPicked = () => split === 'items' && ![...sel.values()].some(n => n > 0);

  // ---------- ส่วนลด: บาท / % / คูปอง ----------
  let unit = 'baht';
  let coupon = null;             // {coupon_id, code, discount, label}
  function discAmount() {
    if (!canDiscount) return 0;
    if (coupon) return Number(coupon.discount);
    const v = Math.max(0, parseFloat($('#b-disc').value) || 0);
    if (unit === 'pct') return round2(partSub() * Math.min(v, 100) / 100);
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
  async function applyCoupon(code, quiet) {
    const p = noItemsPicked() ? null : part();
    const { data: cq, error } = await sb.rpc('st_coupon_quote', { p_table: tableId, p_code: code, p_part: p });
    if (error) {
      coupon = null;
      if (!quiet || error.message !== 'st_coupon_min') {
        showMsg(thaiError(error) + (error.details && error.message === 'st_coupon_min' ? ` (${error.details} บาท)` : ''));
      }
    } else coupon = cq;
    renderCoupon();
    return load();
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
  // เปลี่ยนส่วนที่จ่าย = คิดคูปองใหม่
  const partChanged = () => coupon ? applyCoupon(coupon.code, true) : load();

  // ---------- โหลด ----------
  let loading = 0;
  async function load() {
    const my = ++loading;
    const p = noItemsPicked() ? null : part();
    const { data: d, error } = await sb.rpc('st_bill_preview', { p_table: tableId, p_part: p, p_discount: discAmount() });
    if (my !== loading) return;
    if (error) {
      $('#b-sub').textContent = data ? $('#b-sub').textContent : '';
      if (error.message === 'st_split_mixed' && split === 'items') { split = 'all'; sel.clear(); showMsg(thaiError(error)); return load(); }
      if (error.message === 'st_item_paid' || error.message === 'st_item_gone') { sel.clear(); showMsg(thaiError(error)); return load(); }
      return showMsg(thaiError(error));
    }
    if (!d) {
      $('#b-sub').textContent = '';
      $('#b-body').hidden = true;
      return showMsg('โต๊ะนี้ไม่ได้เปิดอยู่ หรือรับเงินครบแล้ว');
    }
    data = d;
    // ตัดรายการที่เลือกไว้แต่จ่ายไปแล้ว
    for (const [id, n] of sel) {
      const l = d.lines.find(x => x.id === id);
      if (!l || n > l.qty - l.paid_qty) sel.delete(id);
    }
    render();
    $('#b-body').hidden = false;
  }

  function render() {
    const d = data, b = d.bill, m = d.money;
    $('#b-title').textContent = `เช็กบิล โต๊ะ ${d.table_label}`;
    $('#b-sub').textContent = d.shop_name + (d.guest_count ? ` · ${d.guest_count} คน` : '');
    $('#b-time').textContent = 'เปิด ' + new Date(d.opened_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    document.title = `เช็กบิล โต๊ะ ${d.table_label}`;

    $('#b-warn').hidden = !d.unfinished;
    $('#b-warn').textContent = `มี ${d.unfinished} ออร์เดอร์ที่ยังไม่ได้เสิร์ฟ ตรวจกับครัวก่อนเก็บเงิน`;

    renderRequests();

    // ใบที่จ่ายแล้ว
    $('#b-parts').hidden = !d.payments.length;
    if (d.payments.length) {
      $('#b-parts').innerHTML = `
        <h3>จ่ายแล้ว ${d.payments.length} ใบ</h3>
        ${d.payments.map(p => `
          <a class="st-oline st-link-line" href="receipt.html?id=${encodeURIComponent(shopId)}&p=${encodeURIComponent(p.id)}">
            <span>ใบที่ ${p.part_no} · เลขที่ ${p.receipt_no} · ${METHOD[p.method] || ''}</span><span>${baht(p.total)} ›</span></a>`).join('')}
        <div class="st-oline st-strong"><span>ค่าอาหารที่ยังไม่จ่าย</span><span>${baht(m.remaining)} <small>จาก ${baht(m.subtotal)}</small></span></div>`;
    }

    // แบ่งจ่าย
    const byAmount = m.by_amount;
    document.querySelectorAll('#b-split button').forEach(x => {
      x.setAttribute('aria-selected', String(x.dataset.s === split));
      x.disabled = x.dataset.s === 'items' && byAmount;
    });
    document.querySelectorAll('[data-split]').forEach(x => { x.hidden = x.dataset.split !== split; });
    $('#b-n').textContent = nEqual;
    if (split === 'equal') {
      $('#b-equal-note').textContent = `ใบนี้คิดค่าอาหาร ${baht(partSub())} จากที่เหลือ ${baht(m.remaining)}`
        + (nEqual > 1 ? ` · คนสุดท้ายจ่ายส่วนที่เหลือพอดี` : '');
    }
    renderItems();

    // บิล
    if (noItemsPicked()) {
      $('#b-bill').innerHTML = '<p class="st-sub" style="margin:0">เลือกรายการที่คนนี้จะจ่ายด้านบนก่อน</p>';
      return renderMethod();
    }
    $('#b-bill').innerHTML = `
      ${d.payments.length || split !== 'all' ? `<div><span>ค่าอาหารทั้งโต๊ะ</span><span>${baht(m.subtotal)}</span></div>` : ''}
      ${Number(m.paid_sub) ? `<div><span>จ่ายไปแล้ว (ค่าอาหาร)</span><span>−${baht(m.paid_sub)}</span></div>` : ''}
      <div><span>${split === 'all' && !d.payments.length ? 'ค่าอาหาร' : 'ค่าอาหารของใบนี้'}</span><span>${baht(b.subtotal)}</span></div>
      ${Number(b.discount) ? `<div><span>ส่วนลด</span><span>−${baht(b.discount)}</span></div>` : ''}
      ${Number(b.service_pct) ? `<div><span>ค่าบริการ ${Number(b.service_pct)}%</span><span>${baht(b.service)}</span></div>` : ''}
      ${Number(b.vat_pct) ? `<div><span>VAT ${Number(b.vat_pct)}%${b.vat_included ? ' (รวมในราคาแล้ว)' : ''}</span><span>${baht(b.vat)}</span></div>` : ''}
      <div class="st-bill-total"><span>ยอดที่ต้องชำระ</span><b>${baht(b.total)}</b></div>
      ${d.tax_invoice ? '<p class="st-sub" style="margin:6px 0 0">🧾 ออกเป็นใบกำกับภาษีอย่างย่อ</p>' : ''}`;

    renderMethod();
  }

  function renderItems() {
    const d = data;
    if (split !== 'items') {
      // รวมรายการซ้ำ (ชื่อ + ตัวเลือก + ราคาเดียวกัน)
      const lines = new Map();
      d.lines.forEach(i => {
        const k = [i.name, i.options || '', i.unit_price].join('|');
        const l = lines.get(k) || { name: i.name, opts: i.options, qty: 0, paid: 0, total: 0 };
        l.qty += i.qty; l.paid += i.paid_qty; l.total += Number(i.line_total);
        lines.set(k, l);
      });
      $('#b-items').innerHTML = (lines.size ? [...lines.values()].map(l => `
        <div class="st-oline${l.paid >= l.qty ? ' st-paid' : ''}"><span>${l.qty}× ${esc(l.name)}${l.opts ? `<small>${esc(l.opts)}</small>` : ''}${l.paid ? `<small>✓ จ่ายแล้ว ${l.paid}</small>` : ''}</span><span>${baht(l.total)}</span></div>`).join('')
        : '<p class="st-sub">ยังไม่มีรายการ</p>')
        + (d.cancelled ? `<p class="st-sub" style="margin:8px 0 0">ไม่นับ ${d.cancelled} ออร์เดอร์ที่ยกเลิก</p>` : '');
      return;
    }
    $('#b-items').innerHTML = d.lines.map(l => {
      const left = l.qty - l.paid_qty;
      const n = sel.get(l.id) || 0;
      if (left <= 0) {
        return `<div class="st-oline st-paid"><span>${l.qty}× ${esc(l.name)}${l.options ? `<small>${esc(l.options)}</small>` : ''}<small>✓ จ่ายแล้ว</small></span><span>${baht(l.line_total)}</span></div>`;
      }
      return `
        <div class="st-pick${n ? ' on' : ''}" data-line="${esc(l.id)}">
          <span><b>${esc(l.name)}</b>${l.options ? `<small>${esc(l.options)}</small>` : ''}
            <small>${baht(l.unit_price)} · เหลือ ${left}${l.paid_qty ? ` (จ่ายแล้ว ${l.paid_qty})` : ''}</small></span>
          <div class="st-qty st-qty--sm">
            <button type="button" data-pick="-1" aria-label="ลด" ${n ? '' : 'disabled'}>−</button><b>${n}</b><button type="button" data-pick="1" aria-label="เพิ่ม" ${n >= left ? 'disabled' : ''}>+</button>
          </div>
        </div>`;
    }).join('') + `<div class="st-row-between" style="margin-top:8px">
        <button type="button" class="st-chip" data-pick-all>เลือกที่เหลือทั้งหมด</button>
        <button type="button" class="st-chip" data-pick-none>ล้าง</button></div>`;
  }

  $('#b-split').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || b.disabled) return;
    split = b.dataset.s;
    partChanged();
  });
  document.querySelector('[data-split="equal"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-n]');
    if (!b) return;
    nEqual = Math.min(20, Math.max(1, nEqual + Number(b.dataset.n)));
    partChanged();
  });
  $('#b-items').addEventListener('click', (e) => {
    if (split !== 'items') return;
    if (e.target.closest('[data-pick-all]')) {
      data.lines.forEach(l => { if (l.qty > l.paid_qty) sel.set(l.id, l.qty - l.paid_qty); });
      return partChanged();
    }
    if (e.target.closest('[data-pick-none]')) { sel.clear(); return partChanged(); }
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const id = b.closest('[data-line]').dataset.line;
    const l = data.lines.find(x => x.id === id);
    const n = Math.min(l.qty - l.paid_qty, Math.max(0, (sel.get(id) || 0) + Number(b.dataset.pick)));
    if (n) sel.set(id, n); else sel.delete(id);
    renderItems();
    clearTimeout(pt); pt = setTimeout(partChanged, 250);
  });
  let pt;

  // ---------- คำขอจ่ายเองของลูกค้า (แนบสลิปพร้อมเพย์) ----------
  const slipUrls = new Map();
  async function renderRequests() {
    const reqs = data.requests || [];
    $('#b-req').hidden = !reqs.length;
    if (!reqs.length) return;
    $('#b-req').innerHTML = `<h3>💸 ลูกค้าแจ้งโอนพร้อมเพย์</h3>` + reqs.map(r => `
      <div class="st-req" data-req="${esc(r.id)}">
        <a class="st-req-slip" target="_blank" rel="noopener" data-slip="${esc(r.slip_path || '')}"><span>กำลังโหลดสลิป…</span></a>
        <div class="st-req-main">
          <b>${baht(r.amount)}</b>
          <small>ส่ง ${new Date(r.submitted_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · ตรวจยอดเข้าในแอปธนาคารก่อนยืนยัน</small>
          <div class="st-req-actions">
            <button type="button" class="st-btn" data-req-ok>✓ เงินเข้าแล้ว รับเงิน</button>
            <button type="button" class="st-btn st-btn--ghost st-danger" data-req-no>✗ ปฏิเสธ</button>
          </div>
        </div>
      </div>`).join('');
    for (const a of $('#b-req').querySelectorAll('[data-slip]')) {
      const path = a.dataset.slip;
      if (!path) { a.innerHTML = '<span>ไม่มีรูป</span>'; continue; }
      let url = slipUrls.get(path);
      if (!url) {
        const { data: u } = await sb.storage.from('st-slips').createSignedUrl(path, 600);
        url = u && u.signedUrl;
        if (url) slipUrls.set(path, url);
      }
      a.innerHTML = url ? `<img src="${esc(url)}" alt="สลิป">` : '<span>เปิดรูปไม่ได้</span>';
      if (url) a.href = url;
    }
  }
  $('#b-req').addEventListener('click', async (e) => {
    const box = e.target.closest('[data-req]');
    if (!box) return;
    const r = data.requests.find(x => x.id === box.dataset.req);
    if (!r) return;
    if (e.target.closest('[data-req-ok]')) {
      if (!confirm(`ตรวจในแอปธนาคารแล้ว เงินเข้า ${baht(r.amount)} จริง?\nกดตกลง = รับเงินและออกใบเสร็จ`)) return;
      e.target.disabled = true;
      const { data: res, error } = await sb.rpc('st_pay', { p_table: tableId, p_part: null, p_discount: 0, p_tenders: null, p_note: 'ลูกค้าจ่ายเอง (พร้อมเพย์)', p_request: r.id });
      if (error) { e.target.disabled = false; showMsg(thaiError(error) + (error.details ? ` (ยอดตอนนี้ ${baht(error.details)})` : '')); return load(); }
      return goReceipt(res);
    }
    if (e.target.closest('[data-req-no]')) {
      const reason = prompt('เหตุผลที่ปฏิเสธ (ลูกค้าจะเห็น) เช่น ยอดยังไม่เข้า / ยอดไม่ตรง');
      if (reason === null) return;
      if (!reason.trim()) return showMsg('กรุณาใส่เหตุผล');
      const { error } = await sb.rpc('st_reject_pay_request', { p_request: r.id, p_reason: reason.trim() });
      if (error) return showMsg(thaiError(error));
      showMsg('ปฏิเสธแล้ว ลูกค้าจะเห็นเหตุผลบนมือถือ', 'ok');
      load();
    }
  });

  // ---------- วิธีชำระ ----------
  function quickAmounts(total) {
    const out = [total];
    for (const step of [20, 50, 100, 500, 1000]) {
      const v = Math.ceil(total / step) * step;
      if (v > total && !out.includes(v)) out.push(v);
    }
    return out.slice(0, 5);
  }
  const total = () => data && !noItemsPicked() ? Number(data.bill.total) : 0;
  // หลายช่องทาง: แถวสุดท้าย = ยอดที่เหลือ
  function tenderAmounts() {
    const t = total();
    const out = tenders.map(x => round2(Math.max(0, parseFloat(x.amount) || 0)));
    if (out.length) out[out.length - 1] = round2(t - out.slice(0, -1).reduce((s, v) => s + v, 0));
    return out;
  }
  function renderTenders() {
    const amts = tenderAmounts();
    $('#b-tenders').innerHTML = tenders.map((x, i) => {
      const last = i === tenders.length - 1;
      return `<div class="st-tender" data-i="${i}">
        <select data-t="method">${Object.keys(LABEL).map(k => `<option value="${k}" ${x.method === k ? 'selected' : ''}>${LABEL[k]}</option>`).join('')}</select>
        ${last ? `<b class="st-tender-auto${amts[i] < 0 ? ' st-bad' : ''}">${baht(amts[i])}</b>`
               : `<input data-t="amount" type="number" min="0" step="1" inputmode="decimal" value="${esc(x.amount)}" placeholder="ยอด">`}
        ${tenders.length > 2 ? '<button type="button" class="st-chip" data-t="del" aria-label="ลบ">✕</button>' : ''}
      </div>`;
    }).join('') + `<div class="st-row-between">
        <small class="st-sub">แถวสุดท้ายคิดยอดที่เหลือให้เอง</small>
        ${tenders.length < 4 ? '<button type="button" class="st-chip" data-t="add">+ เพิ่มช่องทาง</button>' : ''}</div>`;
  }
  function multiCheck() {                 // คืนข้อความผิด หรือ null
    const amts = tenderAmounts();
    if (amts.some(a => a <= 0)) return 'ใส่ยอดแต่ละช่องทางให้ครบ และรวมแล้วต้องไม่เกินยอดที่ต้องชำระ';
    if (tenders.filter(x => x.method === 'cash').length > 1) return 'เงินสดใส่ได้ช่องเดียว';
    return null;
  }

  function renderMethod() {
    const t = total();
    $('#b-methods').hidden = multi;
    $('#b-tenders').hidden = !multi;
    document.querySelectorAll('#b-methods button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.m === method)));

    const ppAmt = multi ? tenders.reduce((s, x, i) => s + (x.method === 'promptpay' ? tenderAmounts()[i] : 0), 0)
                        : (method === 'promptpay' ? t : 0);
    const hasNonCash = multi ? tenders.some(x => x.method !== 'cash') : method !== 'cash';
    document.querySelector('[data-panel="cash"]').hidden = multi || method !== 'cash';
    document.querySelector('[data-panel="promptpay"]').hidden = !(ppAmt > 0);
    document.querySelector('[data-panel="slip"]').hidden = !hasNonCash;

    if (multi) renderTenders();
    if (!multi && method === 'cash') {
      $('#b-quick').innerHTML = quickAmounts(t).map((v, i) =>
        `<button type="button" class="st-chip" data-amt="${v}">${i === 0 ? 'พอดี ' : ''}${baht(v).replace('.00', '')}</button>`).join('');
      updateChange();
    }
    if (ppAmt > 0) {
      const pl = window.STPromptPay.payload(data.promptpay_id, ppAmt);
      $('#b-pp').innerHTML = pl ? `
          <div class="st-qr-big st-pp">${STQR.svg(pl, { margin: 2 })}</div>
          <p class="st-center"><b class="st-pp-amt">${baht(ppAmt)}</b><br>
          <span class="st-sub">พร้อมเพย์ ${esc(maskPP(data.promptpay_id))} · ให้ลูกค้าสแกนด้วยแอปธนาคาร แล้วตรวจยอดเข้าก่อนกดรับเงิน</span></p>`
        : `<p class="st-msg st-msg--error">ร้านยังไม่ได้ตั้งเลขพร้อมเพย์ ไปที่ ร้าน › ข้อมูลร้าน › พร้อมเพย์</p>`;
    }
    const closes = data.part.kind === 'full';
    const after = round2(Number(data.money.remaining) - Number(data.part.subtotal));
    $('#b-pay').disabled = noItemsPicked() || Number(data.part.subtotal) <= 0;
    $('#b-pay').textContent = noItemsPicked() ? 'เลือกรายการก่อน'
      : `รับเงิน ${baht(t)} · ${closes ? 'ปิดโต๊ะ' : `ค่าอาหารเหลือ ${baht(after)}`}`;
  }
  const maskPP = (id) => { const s = String(id || ''); return s.length > 4 ? s.slice(0, 3) + '•••' + s.slice(-3) : s; };

  function updateChange() {
    const t = total();
    const recv = parseFloat($('#b-recv').value);
    const ch = Number.isFinite(recv) ? recv - t : 0;
    $('#b-change').textContent = Number.isFinite(recv) ? (ch >= 0 ? baht(ch) : 'ยังขาด ' + baht(-ch)) : '—';
    $('#b-change').classList.toggle('st-bad', Number.isFinite(recv) && ch < 0);
  }

  $('#b-methods').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    method = b.dataset.m;
    renderMethod();
  });
  $('#b-multi').addEventListener('change', (e) => {
    multi = e.target.checked;
    if (multi && !tenders.length) tenders = [{ method: 'cash', amount: '' }, { method: method === 'cash' ? 'transfer' : method, amount: '' }];
    renderMethod();
  });
  $('#b-tenders').addEventListener('input', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row || e.target.dataset.t !== 'amount') return;
    tenders[Number(row.dataset.i)].amount = e.target.value;
    const last = $('#b-tenders').querySelector('.st-tender-auto');
    const a = tenderAmounts();
    if (last) { last.textContent = baht(a[a.length - 1]); last.classList.toggle('st-bad', a[a.length - 1] < 0); }
    const pp = tenders.some(x => x.method === 'promptpay');
    if (pp) { clearTimeout(tt); tt = setTimeout(renderMethod, 500); }
  });
  let tt;
  $('#b-tenders').addEventListener('change', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row || e.target.dataset.t !== 'method') return;
    tenders[Number(row.dataset.i)].method = e.target.value;
    renderMethod();
  });
  $('#b-tenders').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    if (b.dataset.t === 'add' && tenders.length < 4) tenders.push({ method: 'card', amount: '' });
    if (b.dataset.t === 'del') tenders.splice(Number(b.closest('[data-i]').dataset.i), 1);
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

  // ---------- สลิป (พนักงานถ่ายเก็บไว้) ----------
  $('#slip-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      slipBlob = await ST.shrinkImage(file, 1400, 0.85);
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
  function goReceipt(res) {
    let next = '';
    if (!res.closed) {
      const nx = new URLSearchParams({ id: shopId, table: tableId });
      if (split !== 'all') nx.set('split', split);
      if (split === 'equal') nx.set('n', String(Math.max(1, nEqual - 1)));
      if (fromQueue) nx.set('from', 'queue');
      next = '&next=' + encodeURIComponent('bill.html?' + nx.toString());
    }
    location.replace(`receipt.html?id=${encodeURIComponent(shopId)}&p=${encodeURIComponent(res.payment_id)}&new=1${next}${fromQueue ? '&from=queue' : ''}`);
  }

  $('#b-pay').addEventListener('click', async () => {
    const t = total();
    let list;
    if (multi) {
      const err = multiCheck();
      if (err) return showMsg(err);
      const a = tenderAmounts();
      list = tenders.map((x, i) => ({ method: x.method, amount: a[i] }));
    } else {
      let received = null;
      if (method === 'cash') {
        received = parseFloat($('#b-recv').value);
        if (!Number.isFinite(received)) received = t;              // ไม่กรอก = รับพอดี
        if (received < t) return showMsg('รับเงินมาน้อยกว่ายอดที่ต้องจ่าย');
      }
      if (method === 'promptpay' && !window.STPromptPay.payload(data.promptpay_id, t)) {
        return showMsg('ร้านยังไม่ได้ตั้งเลขพร้อมเพย์');
      }
      list = [{ method, amount: t, received }];
    }
    const how = list.map(x => `${LABEL[x.method]} ${baht(x.amount)}`).join(' + ');
    const closes = data.part.kind === 'full';
    if (!confirm(`ยืนยันรับเงิน ${baht(t)}\n(${how})\n${closes ? `และปิดโต๊ะ ${data.table_label}` : 'โต๊ะยังเปิดอยู่ เก็บส่วนที่เหลือต่อได้'}?`)) return;

    const btn = $('#b-pay');
    btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
    if (slipBlob) {
      const target = list.find(x => x.method !== 'cash');
      if (target) {
        const rand = (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(36).slice(2));
        const slipPath = `shops/${shopId}/slips/${rand}.jpg`;
        const { error: upErr } = await sb.storage.from('st-slips').upload(slipPath, slipBlob, { contentType: 'image/jpeg', upsert: false });
        if (upErr) { btn.disabled = false; renderMethod(); return showMsg('อัปโหลดสลิปไม่สำเร็จ: ' + thaiError(upErr)); }
        target.slip_path = slipPath;
      }
    }
    const { data: res, error } = await sb.rpc('st_pay', {
      p_table: tableId, p_part: noItemsPicked() ? null : part(), p_discount: discAmount(),
      p_tenders: list, p_note: $('#b-note').value.trim() || null, p_request: null
    });
    if (error) {
      btn.disabled = false; renderMethod();
      if (['st_table_not_open', 'st_item_paid', 'st_over_remaining', 'st_tender_mismatch', 'st_split_mixed'].includes(error.message)) load();
      return showMsg(thaiError(error) + (error.message === 'st_tender_mismatch' && error.details ? ` (ต้องได้ ${baht(error.details)})` : ''));
    }
    if (coupon) {
      const { error: cErr } = await sb.rpc('st_coupon_redeem', { p_payment: res.payment_id, p_coupon: coupon.coupon_id });
      if (cErr) alert('รับเงินแล้ว แต่บันทึกการใช้คูปองไม่สำเร็จ: ' + thaiError(cErr));
    }
    goReceipt(res);
  });

  // ---------- อัปเดตเมื่อลูกค้าแนบสลิป (Realtime) ----------
  let rt;
  sb.channel('st-bill-' + tableId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_pay_requests', filter: 'shop_id=eq.' + shopId },
        () => { clearTimeout(rt); rt = setTimeout(load, 400); })
    .subscribe();

  await load();
})();
