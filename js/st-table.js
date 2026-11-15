// ===== หน้า ลูกค้าสแกน QR (table.html?t=<qr_token>) — ไม่ต้องล็อกอิน =====
// ดูเมนู · ตะกร้า · ส่งรายการเข้าร้าน · ดูที่สั่งแล้วและยอดบิล · เรียกพนักงาน / ขอเช็กบิล
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg } = ST;
  if (!configOk) return;

  const qr = new URLSearchParams(location.search).get('t') || '';
  const KEY_SESSION = 'st-session:' + qr;
  const KEY_CART = 'st-cart:' + qr;
  const KEY_NAME = 'st-guest-name';
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ไม่เป็นไร */ } }
  };
  const imgUrl = (path) => sb.storage.from('st-images').getPublicUrl(path).data.publicUrl;
  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const plus = (n) => Number(n) > 0 ? '+' + baht(n) : Number(n) < 0 ? '−' + baht(-n) : '';
  const rand = () => (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(36).slice(2));
  const SPICY = ['', '🌶', '🌶🌶', '🌶🌶🌶'];
  const ORDER_TH = { new: 'รอร้านรับ', accepted: 'ร้านรับแล้ว', cooking: 'กำลังทำ', served: 'เสิร์ฟแล้ว', cancelled: 'ยกเลิก' };

  const STATES = {
    open:        { cls: 'ok',   title: 'โต๊ะพร้อมสั่งอาหาร', text: 'แตะเมนูเพื่อใส่ตะกร้า แล้วกด "ดูตะกร้า" เพื่อส่งเข้าร้าน' },
    waiting:     { cls: 'wait', title: 'รอพนักงานเปิดโต๊ะ', text: 'ดูเมนูได้ก่อน สั่งได้เมื่อพนักงานเปิดโต๊ะให้ (หน้านี้จะอัปเดตเอง)' },
    billing:     { cls: 'wait', title: 'กำลังเช็กบิล', text: 'สั่งเพิ่มไม่ได้แล้ว ถ้าต้องการสั่งเพิ่มกรุณาแจ้งพนักงาน' },
    shop_closed: { cls: 'off',  title: 'ร้านปิดอยู่ตอนนี้', text: 'ดูเมนูได้ แต่ยังสั่งอาหารไม่ได้' },
    ended:       { cls: 'off',  title: 'โต๊ะนี้ปิดรอบแล้ว', text: 'ถ้ายังนั่งอยู่ที่ร้าน สแกน QR ที่โต๊ะอีกครั้งเพื่อสั่งต่อ' }
  };

  let state = null;
  let token = null;
  let menu = { categories: [], items: [] };
  let cart = [];            // [{key, item_id, name, unit, qty, choices, labels, note}]
  let pendingRef = null;    // รหัสกันส่งซ้ำ ใช้ซ้ำได้จนกว่าจะสำเร็จ หรือแก้ตะกร้า
  let guestInfo = null;     // ผลล่าสุดจาก st_guest_orders

  const canOrder = () => state === 'open' && !!token;

  // ---------- ข้อความลอยด้านล่าง ----------
  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- ตะกร้า (เก็บในเครื่อง ผูกกับรอบของโต๊ะ) ----------
  function loadCart() {
    try {
      const c = JSON.parse(ls.get(KEY_CART) || 'null');
      cart = c && c.token === token && Array.isArray(c.lines) ? c.lines : [];
    } catch { cart = []; }
  }
  function saveCart() {
    pendingRef = null;
    ls.set(KEY_CART, cart.length ? JSON.stringify({ token, lines: cart }) : null);
    renderCartBar();
  }
  const cartTotal = () => cart.reduce((s, l) => s + l.unit * l.qty, 0);
  const cartCount = () => cart.reduce((s, l) => s + l.qty, 0);

  function renderCartBar() {
    const show = canOrder() && cart.length > 0;
    $('#cart-bar').hidden = !show;
    document.body.classList.toggle('st-has-cart', show);
    if (show) {
      $('#cart-n').textContent = cartCount();
      $('#cart-total').textContent = baht(cartTotal());
    }
  }

  // ---------- สแกน / สถานะ ----------
  // autoOpen = true เฉพาะตอนเปิดหน้าจากการสแกนจริง · เช็กสถานะเป็นระยะใช้ false
  async function scan(autoOpen) {
    const { data, error } = await sb.rpc('st_scan', { p_qr: qr, p_auto_open: !!autoOpen });
    if (error) {
      $('#g-shop').textContent = $('#g-shop').textContent === 'กำลังโหลด…' ? 'SmartTable' : $('#g-shop').textContent;
      showMsg(thaiError(error));
      return null;
    }
    const newToken = data.session_token || null;
    if (newToken !== token) {
      token = newToken;
      ls.set(KEY_SESSION, token);
      loadCart();                                     // รอบใหม่ = ตะกร้าใหม่
      guestInfo = null;
    }
    state = data.state;
    $('#g-shop').textContent = data.shop.name;
    $('#g-sub').textContent = data.table.zone || '';
    $('#g-table').textContent = 'โต๊ะ ' + data.table.label;
    $('#g-table').hidden = false;
    document.title = data.shop.name + ' · โต๊ะ ' + data.table.label;
    const s = STATES[state];
    $('#g-state').className = 'st-state st-state--' + s.cls;
    $('#g-state').innerHTML = `<b>${esc(s.title)}</b><span>${esc(s.text)}</span>`;
    $('#g-state').hidden = false;
    $('#g-actions').hidden = !token;
    renderCartBar();
    if (token) refreshGuest();
    return data;
  }

  async function refreshGuest() {
    if (!token) return;
    const { data, error } = await sb.rpc('st_guest_orders', { p_qr: qr, p_session_token: token });
    if (error) return;
    guestInfo = data;
    const n = data.orders.filter(o => o.status !== 'cancelled').length;
    $('#orders-count').textContent = n ? `(${n})` : '';
    const pend = data.pending_calls || [];
    const bCall = document.querySelector('[data-call="call"]');
    const bBill = document.querySelector('[data-call="bill"]');
    bCall.disabled = pend.includes('call');
    bCall.textContent = pend.includes('call') ? '🙋 เรียกแล้ว รอสักครู่' : '🙋 เรียกพนักงาน';
    bBill.disabled = pend.includes('bill') || state === 'billing';
    bBill.textContent = bBill.disabled ? '💳 ขอเช็กบิลแล้ว' : '💳 ขอเช็กบิล';
    if (sheetMode === 'orders') renderOrders();
  }

  // ---------- เมนู ----------
  let activeCat = '';
  function renderMenu() {
    const term = $('#g-search').value.trim().toLowerCase();
    const cats = menu.categories.filter(c => menu.items.some(i => i.category_id === c.id));
    const loose = menu.items.filter(i => !i.category_id);
    const groups = cats.map(c => ({ id: c.id, name: c.name, items: menu.items.filter(i => i.category_id === c.id) }));
    if (loose.length) groups.push({ id: 'none', name: cats.length ? 'อื่น ๆ' : 'เมนู', items: loose });

    $('#g-cats').innerHTML = groups.length > 1 ? groups.map(g =>
      `<button type="button" data-cat="${esc(g.id)}" class="${g.id === activeCat ? 'on' : ''}">${esc(g.name)}</button>`).join('') : '';

    const shown = groups.map(g => ({
      ...g, items: g.items.filter(i => !term || i.name.toLowerCase().includes(term) || (i.description || '').toLowerCase().includes(term))
    })).filter(g => g.items.length);

    const inCart = (id) => cart.filter(l => l.item_id === id).reduce((s, l) => s + l.qty, 0);
    $('#g-items').innerHTML = shown.length ? shown.map(g => `
      <section class="st-gsec" id="cat-${esc(g.id)}">
        <h2>${esc(g.name)}</h2>
        ${g.items.map(i => `
          <article class="st-gitem${i.is_available ? '' : ' st-gitem--off'}" data-id="${esc(i.id)}" role="button" tabindex="0">
            <div class="st-gimg">${i.image_path ? `<img src="${esc(imgUrl(i.image_path))}" alt="" loading="lazy">` : ''}</div>
            <div class="st-gbody">
              <h3>${esc(i.name)}</h3>
              ${i.description ? `<p>${esc(i.description)}</p>` : ''}
              <div class="st-gmeta">
                <b>${baht(i.price)}</b>
                ${i.is_recommended ? '<span class="st-tag st-tag--rec">⭐ แนะนำ</span>' : ''}
                ${i.spicy_level ? `<span class="st-tag">${SPICY[i.spicy_level]}</span>` : ''}
                ${i.is_available ? '' : '<span class="st-tag st-tag--off">หมด</span>'}
                ${inCart(i.id) ? `<span class="st-tag st-tag--cart">ในตะกร้า ${inCart(i.id)}</span>` : ''}
              </div>
            </div>
          </article>`).join('')}
      </section>`).join('')
      : `<div class="st-empty">${term ? 'ไม่พบเมนูที่ค้นหา' : 'ร้านยังไม่ได้เพิ่มเมนู'}</div>`;
  }
  async function loadMenu() {
    const { data, error } = await sb.rpc('st_public_menu', { p_qr: qr });
    if (error) { showMsg(thaiError(error)); return false; }
    menu = data;
    renderMenu();
    return true;
  }

  $('#g-search').addEventListener('input', renderMenu);
  $('#g-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    activeCat = b.dataset.cat;
    $('#g-search').value = '';
    renderMenu();
    document.getElementById('cat-' + activeCat)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#g-items').addEventListener('click', (e) => {
    const card = e.target.closest('.st-gitem');
    if (card) openItem(card.dataset.id);
  });
  $('#g-items').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('st-gitem')) openItem(e.target.dataset.id);
  });

  // ---------- แผ่นด้านล่าง ----------
  const sheet = $('#sheet');
  let sheetMode = null;          // 'item' | 'cart' | 'orders'
  let current = null;            // เมนูที่เปิดอยู่
  let qty = 1;

  const sheetMsg = (text, type = 'error') => {
    const b = $('#sheet-msg'); b.textContent = text; b.className = 'st-msg st-msg--' + type; b.hidden = false;
    b.scrollIntoView({ block: 'nearest' });
  };
  function openSheet(mode, title) {
    sheetMode = mode;
    $('#toast').hidden = true;
    $('#sheet-title').textContent = title;
    $('#sheet-msg').hidden = true;
    sheet.hidden = false;
    document.body.classList.add('st-noscroll');
    sheet.querySelector('.st-sheet-panel').scrollTop = 0;
  }
  function closeSheet() {
    sheet.hidden = true; sheetMode = null; current = null;
    document.body.classList.remove('st-noscroll');
  }
  $('#sheet-close').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

  // ----- เลือกเมนู -----
  const ruleText = (g) => g.max_select === 1
    ? (g.min_select >= 1 ? 'ต้องเลือก 1' : 'เลือกได้ 1 · ไม่บังคับ')
    : (g.min_select >= 1 ? `เลือก ${g.min_select}–${g.max_select}` : `เลือกได้สูงสุด ${g.max_select}`);

  function openItem(id) {
    const it = menu.items.find(x => x.id === id);
    if (!it) return;
    current = it; qty = 1;
    const blocked = !it.is_available ? 'เมนูนี้หมดแล้ว'
      : !canOrder() ? (STATES[state]?.title || 'ยังสั่งไม่ได้') : '';
    $('#sheet-body').innerHTML = `
      ${it.image_path ? `<div class="st-hero"><img src="${esc(imgUrl(it.image_path))}" alt=""></div>` : ''}
      <h2 class="st-hero-name">${esc(it.name)}</h2>
      ${it.description ? `<p class="st-sub">${esc(it.description)}</p>` : ''}
      <p class="st-hero-price">${baht(it.price)}</p>
      <form id="form-add" novalidate>
        ${it.options.map(g => `
          <fieldset class="st-optg" data-g="${esc(g.id)}" data-min="${g.min_select}" data-max="${g.max_select}" data-name="${esc(g.name)}">
            <legend>${esc(g.name)} <small class="${g.min_select ? 'req' : ''}">${ruleText(g)}</small></legend>
            ${g.choices.map(c => `
              <label class="st-optc">
                <input type="checkbox" value="${esc(c.id)}" data-delta="${Number(c.price_delta)}" data-name="${esc(c.name)}">
                <span>${esc(c.name)}</span><em>${plus(c.price_delta)}</em>
              </label>`).join('')}
          </fieldset>`).join('')}
        <label class="st-field"><span>หมายเหตุถึงครัว (ไม่บังคับ)</span>
          <input name="note" type="text" maxlength="140" placeholder="เช่น ไม่ใส่ผัก แยกน้ำ">
        </label>
        ${blocked ? `<p class="st-msg st-msg--error">${esc(blocked)}</p>` : `
        <div class="st-add-row">
          <div class="st-qty">
            <button type="button" data-q="-1" aria-label="ลด">−</button><b id="q-n">1</b><button type="button" data-q="1" aria-label="เพิ่ม">+</button>
          </div>
          <button class="st-btn" type="submit" id="btn-add">ใส่ตะกร้า</button>
        </div>`}
      </form>`;
    openSheet('item', it.name);
    updateAddPrice();
  }

  function selectedChoices() {
    return [...$('#sheet-body').querySelectorAll('.st-optc input:checked')];
  }
  function updateAddPrice() {
    const btn = $('#btn-add');
    if (!btn || !current) return;
    const unit = Number(current.price) + selectedChoices().reduce((s, i) => s + Number(i.dataset.delta), 0);
    btn.textContent = `ใส่ตะกร้า · ${baht(Math.max(unit, 0) * qty)}`;
  }

  $('#sheet-body').addEventListener('change', (e) => {
    const input = e.target.closest('.st-optc input');
    if (!input) return;
    const fs = input.closest('.st-optg');
    const max = Number(fs.dataset.max);
    const boxes = [...fs.querySelectorAll('input')];
    if (max === 1 && input.checked) boxes.forEach(b => { if (b !== input) b.checked = false; });
    if (max > 1) {
      const n = boxes.filter(b => b.checked).length;
      boxes.forEach(b => { if (!b.checked) b.disabled = n >= max; });
    }
    updateAddPrice();
  });

  $('#sheet-body').addEventListener('submit', (e) => {
    if (e.target.id !== 'form-add') return;
    e.preventDefault();
    for (const fs of $('#sheet-body').querySelectorAll('.st-optg')) {
      const n = fs.querySelectorAll('input:checked').length;
      if (n < Number(fs.dataset.min)) return sheetMsg(`กรุณาเลือก "${fs.dataset.name}"`);
    }
    const picked = selectedChoices();
    const choices = picked.map(i => i.value).sort();
    const note = e.target.note.value.trim().slice(0, 140);
    const unit = Math.max(Number(current.price) + picked.reduce((s, i) => s + Number(i.dataset.delta), 0), 0);
    const key = [current.id, choices.join(','), note].join('|');
    const same = cart.find(l => l.key === key);
    if (same) same.qty = Math.min(20, same.qty + qty);
    else cart.push({ key, item_id: current.id, name: current.name, unit, qty, choices,
                     labels: picked.map(i => i.dataset.name), note });
    saveCart();
    renderMenu();
    const name = current.name;
    closeSheet();
    toast(`เพิ่ม ${name} ×${qty} แล้ว`);
  });

  // ----- ตะกร้า -----
  function renderCart() {
    if (!cart.length) {
      $('#sheet-body').innerHTML = '<div class="st-empty">ตะกร้าว่าง แตะเมนูเพื่อเพิ่ม</div>';
      return;
    }
    $('#sheet-body').innerHTML = `
      <div class="st-lines">
        ${cart.map(l => `
          <div class="st-line" data-k="${esc(l.key)}">
            <div class="st-line-main">
              <b>${esc(l.name)}</b>
              ${l.labels.length ? `<small>${esc(l.labels.join(' · '))}</small>` : ''}
              ${l.note ? `<small>📝 ${esc(l.note)}</small>` : ''}
              <span class="st-line-price">${baht(l.unit * l.qty)}</span>
            </div>
            <div class="st-qty st-qty--sm">
              <button type="button" data-d="-1" aria-label="ลด">${l.qty === 1 ? '🗑' : '−'}</button><b>${l.qty}</b><button type="button" data-d="1" aria-label="เพิ่ม">+</button>
            </div>
          </div>`).join('')}
      </div>
      <form id="form-send" novalidate>
        <label class="st-field"><span>ชื่อเล่นของคุณ (ไม่บังคับ)</span>
          <input name="guest_name" type="text" maxlength="30" placeholder="ให้พนักงานรู้ว่าใครสั่ง" value="${esc(ls.get(KEY_NAME) || '')}">
        </label>
        <label class="st-field"><span>หมายเหตุถึงร้าน (ไม่บังคับ)</span>
          <input name="note" type="text" maxlength="200" placeholder="เช่น เสิร์ฟพร้อมกัน">
        </label>
        <div class="st-sum"><span>รวมค่าอาหาร</span><b>${baht(cartTotal())}</b></div>
        <p class="st-sub" style="margin-top:4px">ค่าบริการ / VAT (ถ้ามี) คิดตอนเช็กบิล</p>
        <button class="st-btn" type="submit" id="btn-send">ส่งรายการให้ร้าน · ${cartCount()} รายการ</button>
      </form>`;
  }
  $('#btn-cart').addEventListener('click', () => { openSheet('cart', 'ตะกร้าของฉัน'); renderCart(); });

  $('#sheet-body').addEventListener('click', (e) => {
    const qb = e.target.closest('[data-q]');
    if (qb) {
      qty = Math.min(20, Math.max(1, qty + Number(qb.dataset.q)));
      $('#q-n').textContent = qty;
      return updateAddPrice();
    }
    const db = e.target.closest('[data-d]');
    if (db) {
      const line = cart.find(l => l.key === db.closest('[data-k]').dataset.k);
      if (!line) return;
      line.qty += Number(db.dataset.d);
      if (line.qty <= 0) cart = cart.filter(l => l !== line);
      line.qty = Math.min(20, line.qty);
      saveCart(); renderMenu(); renderCart();
    }
  });

  $('#sheet-body').addEventListener('submit', async (e) => {
    if (e.target.id !== 'form-send') return;
    e.preventDefault();
    if (!canOrder()) return sheetMsg(STATES[state]?.title || 'ยังสั่งไม่ได้');
    const f = e.target;
    const guestName = f.guest_name.value.trim().slice(0, 30);
    ls.set(KEY_NAME, guestName || null);
    if (!pendingRef) pendingRef = rand();
    const btn = $('#btn-send');
    btn.disabled = true; btn.textContent = 'กำลังส่ง…';
    const { data, error } = await sb.rpc('st_place_order', {
      p_qr: qr, p_session_token: token,
      p_items: cart.map(l => ({ item_id: l.item_id, qty: l.qty, choices: l.choices, note: l.note || null })),
      p_note: f.note.value.trim() || null, p_guest_name: guestName || null, p_client_ref: pendingRef
    });
    if (error) {
      btn.disabled = false; btn.textContent = `ส่งรายการให้ร้าน · ${cartCount()} รายการ`;
      const code = error.message || '';
      if (code.startsWith('st_')) pendingRef = null;            // ร้านปฏิเสธ = ยังไม่ได้สร้างออร์เดอร์
      if (['st_item_sold_out', 'st_item_gone', 'st_options_changed', 'st_options_required'].includes(code)) loadMenu();
      if (['st_session_invalid', 'st_session_billing', 'st_shop_closed'].includes(code)) scan(false);
      return sheetMsg(thaiError(error));
    }
    cart = []; saveCart(); renderMenu();
    await refreshGuest();
    openSheet('orders', 'ที่สั่งแล้ว');
    renderOrders();
    sheetMsg(`ส่งรายการแล้ว · ออร์เดอร์ #${data.order_no} ร้านกำลังรับรายการ`, 'ok');
  });

  // ----- ที่สั่งแล้ว + ยอดบิล -----
  function renderOrders() {
    const info = guestInfo;
    if (!info) { $('#sheet-body').innerHTML = '<p class="st-sub">กำลังโหลด…</p>'; return; }
    const orders = info.orders.slice().reverse();
    const b = info.bill;
    $('#sheet-body').innerHTML = `
      ${orders.length ? orders.map(o => `
        <div class="st-order st-order--${o.status}">
          <div class="st-order-head">
            <b>#${o.order_no}</b>
            <span>${new Date(o.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}${o.guest_name ? ' · ' + esc(o.guest_name) : ''}</span>
            <em class="st-ostat st-ostat--${o.status}">${ORDER_TH[o.status]}</em>
          </div>
          ${o.items.map(i => `
            <div class="st-oline">
              <span>${i.qty}× ${esc(i.name)}${i.options.length ? `<small>${esc(i.options.map(x => x.name).join(' · '))}</small>` : ''}${i.note ? `<small>📝 ${esc(i.note)}</small>` : ''}</span>
              <span>${baht(i.line_total)}</span>
            </div>`).join('')}
          ${o.note ? `<p class="st-sub" style="margin:4px 0 0">📝 ${esc(o.note)}</p>` : ''}
        </div>`).join('') : '<div class="st-empty">ยังไม่ได้สั่งอะไร</div>'}
      ${orders.length ? `
        <div class="st-bill">
          <div><span>ค่าอาหาร</span><span>${baht(b.subtotal)}</span></div>
          ${Number(b.service_pct) ? `<div><span>ค่าบริการ ${Number(b.service_pct)}%</span><span>${baht(b.service)}</span></div>` : ''}
          ${Number(b.vat_pct) ? `<div><span>VAT ${Number(b.vat_pct)}%${b.vat_included ? ' (รวมในราคาแล้ว)' : ''}</span><span>${b.vat_included ? '' : baht(b.vat)}${b.vat_included ? `<small>${baht(b.vat)}</small>` : ''}</span></div>` : ''}
          <div class="st-bill-total"><span>รวมทั้งหมด</span><b>${baht(b.total)}</b></div>
        </div>` : ''}`;
  }
  $('#btn-orders').addEventListener('click', async () => {
    openSheet('orders', 'ที่สั่งแล้ว');
    renderOrders();
    await refreshGuest();
    renderOrders();
  });

  // ----- เรียกพนักงาน / ขอเช็กบิล -----
  $('#g-actions').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-call]');
    if (!b || !token) return;
    const kind = b.dataset.call;
    if (kind === 'bill' && !confirm('ขอเช็กบิล?\nหลังจากนี้จะสั่งอาหารเพิ่มจากมือถือไม่ได้')) return;
    b.disabled = true;
    const { error } = await sb.rpc('st_guest_call', { p_qr: qr, p_session_token: token, p_kind: kind });
    if (error) {
      b.disabled = false;
      if (error.message === 'st_session_invalid') scan(false);
      return showMsg(thaiError(error));
    }
    toast(kind === 'bill' ? 'แจ้งขอเช็กบิลแล้ว พนักงานกำลังมา' : 'เรียกพนักงานแล้ว รอสักครู่');
    await scan(false);
  });

  // ---------- เริ่มต้น ----------
  if (!qr) { $('#g-shop').textContent = 'SmartTable'; return showMsg('ลิงก์ไม่ครบ กรุณาสแกน QR ที่โต๊ะอีกครั้ง'); }
  const first = await scan(true);
  if (!first) return;
  if (!(await loadMenu())) return;
  $('#g-menu').hidden = false;

  // อัปเดตสถานะ + ที่สั่งแล้ว ทุก 20 วินาที
  setInterval(() => { if (!document.hidden) scan(false); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scan(false); });
})();
