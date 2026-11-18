// ===== หน้า ลูกค้าสแกน QR (table.html?t=<qr_token>) — ไม่ต้องล็อกอิน =====
// ดูเมนู (3 ภาษา) · โปรตามเวลา · ตะกร้า · ส่งรายการ · ที่สั่งแล้ว/ยอดบิล · เรียกพนักงาน / ขอเช็กบิล · ให้คะแนน
// จ่ายเองด้วยพร้อมเพย์ + แนบสลิป (ร้านต้องเปิดใช้)
// QR สั่งกลับบ้าน (hub) -> สั่งครั้งแรกได้บัตรคิว (ticket) -> หน้านี้ของบัตรคิว แจ้งเตือนเมื่ออาหารพร้อม
// ตะกร้าร่วมทั้งโต๊ะ (เก็บในฐานข้อมูล + Realtime Broadcast บอกเครื่องอื่น) · ร้านปิดได้ -> ตะกร้าในเครื่อง
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, TAGS, applyTheme } = ST;
  if (!configOk) return;

  const params = new URLSearchParams(location.search);
  const qr = params.get('t') || '';
  const staffMode = params.get('staff') === '1';     // พนักงานสั่งแทนลูกค้า (ต้องล็อกอิน)
  if (staffMode) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      location.replace('index.html?next=' + encodeURIComponent('table.html?t=' + qr + '&staff=1'));
      return;
    }
    document.body.classList.add('st-staff-mode');
  }
  const KEY_SESSION = 'st-session:' + qr;
  const KEY_CART = (staffMode ? 'st-cart-staff:' : 'st-cart:') + qr;
  const KEY_NAME = 'st-guest-name';
  const KEY_PHONE = 'st-guest-phone';
  const KEY_TICKET = 'st-ticket:' + qr;              // บนหน้า QR สั่งกลับบ้าน: บัตรคิวล่าสุด {qr, no, at}
  const KEY_LAST = 'st-last:' + qr;                 // รอบล่าสุดที่สั่งอาหาร (ไว้ให้คะแนนหลังจ่าย)
  const KEY_PAY = 'st-pay:' + qr;                   // คำขอจ่ายเองล่าสุด {token, req, at}
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ไม่เป็นไร */ } }
  };
  const imgUrl = (path) => sb.storage.from('st-images').getPublicUrl(path).data.publicUrl;
  const round2 = (n) => Math.round(n * 100) / 100;
  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const plus = (n) => Number(n) > 0 ? '+' + baht(n) : Number(n) < 0 ? '−' + baht(-n) : '';
  const rand = () => (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(36).slice(2));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> (c / 4)).toString(16)));
  const DEVICE = (() => {                           // รหัสเครื่อง (บอกว่ารายการไหนในตะกร้าโต๊ะเป็น "ของคุณ")
    let d = ls.get('st-device');
    if (!d) { d = String(rand()).slice(0, 36); ls.set('st-device', d); }
    return d;
  })();
  const SPICY = ['', '🌶', '🌶🌶', '🌶🌶🌶'];

  // ---------- ภาษา ----------
  let lang = 'th';
  let languages = ['th'];
  const t = (k, vars) => {
    let s = (ST_I18N[lang] && ST_I18N[lang][k]) ?? ST_I18N.th[k] ?? k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.split('{' + a + '}').join(b);
    return s;
  };
  const tr = (i, field) => (lang !== 'th' && i.i18n && i.i18n[lang] && i.i18n[lang][field]) || i[field];
  const iname = (i) => tr(i, 'name');
  const idesc = (i) => tr(i, 'description');
  const oname = (i, s) => (lang !== 'th' && i && i.i18n && i.i18n[lang] && i.i18n[lang].opts && i.i18n[lang].opts[s]) || s;
  const cname = (c) => (lang !== 'th' && c.i18n && c.i18n[lang]) || c.name;
  const byThaiName = (name) => menu.items.find(x => x.name === name);
  const gErr = (error) => (lang !== 'th' && ST_I18N_ERR[lang] && ST_I18N_ERR[lang][error?.message]) || thaiError(error);
  const LANG_LABEL = { th: 'ไทย', en: 'EN', zh: '中文' };

  function pickLang(avail) {
    languages = ['th', ...avail.filter(l => l === 'en' || l === 'zh')];
    const saved = ls.get('st-lang');
    const nav = (navigator.language || '').toLowerCase();
    lang = languages.includes(saved) ? saved
      : nav.startsWith('zh') && languages.includes('zh') ? 'zh'
      : nav.startsWith('en') && languages.includes('en') ? 'en' : 'th';
    renderLang();
  }
  function renderLang() {
    $('#g-lang').hidden = languages.length < 2 || staffMode;
    $('#g-lang').innerHTML = languages.map(l => `<button type="button" data-lang="${l}" aria-pressed="${l === lang}">${LANG_LABEL[l]}</button>`).join('');
    document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang;
    $('#g-search').placeholder = t('search');
    $('#btn-orders').firstChild.textContent = t('orders') + ' ';
    $('#cart-label').textContent = t('view_cart');
    $('#sheet-close').textContent = t('close');
  }
  $('#g-lang').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    lang = b.dataset.lang;
    ls.set('st-lang', lang);
    renderLang(); renderState(); renderTicket(); renderDiet(); renderMenu(); renderButtons(); renderRate(); renderPay();
    if (sheetMode === 'cart') renderCart();
    if (sheetMode === 'orders') renderOrders();
    if (sheetMode === 'item' && current) openItem(current.id);
    if (sheetMode === 'pay') renderPaySheet();
  });

  let state = null;
  let brandDone = false;
  let lastScan = null;
  const diet = new Set();        // ตัวกรองป้ายอาหารที่ลูกค้าเลือก
  let token = null;
  let menu = { categories: [], items: [] };
  let promos = [];
  let cart = [];            // [{key, item_id, name, unit, qty, choices, labels, note}]
  let pendingRef = null;    // รหัสกันส่งซ้ำ ใช้ซ้ำได้จนกว่าจะสำเร็จ หรือแก้ตะกร้า
  let shared = false;            // ตะกร้าร่วมทั้งโต๊ะ: ร้านเปิด และรอบนี้ใช้อยู่
  let cartSig = '';
  let cartCh = null, cartTopic = null;
  let guestInfo = null;     // ผลล่าสุดจาก st_guest_orders

  const isHub = () => !!lastScan && lastScan.table.kind === 'hub';
  const ticket = () => lastScan && lastScan.ticket;
  const canOrder = () => (state === 'open' && !!token) || (state === 'takeaway' && !staffMode);
  const remaining = (it) => it.stock_left == null ? Infinity
    : it.stock_left - cart.filter(l => l.item_id === it.id).reduce((s, l) => s + l.qty, 0);
  const maxQty = (it) => Math.max(1, Math.min(20, remaining(it)));

  // ---------- โปรตามเวลา (แสดงผล · ราคาจริงคิดที่เซิร์ฟเวอร์ตอนส่ง) ----------
  function promoFor(i) {
    let best = null;
    for (const p of promos) {
      const all = !p.item_ids.length && !p.category_ids.length;
      if ((all || p.item_ids.includes(i.id) || (i.category_id && p.category_ids.includes(i.category_id)))
          && (!best || Number(p.percent) > Number(best.percent))) best = p;
    }
    return best;
  }
  const applyPromo = (i, amount) => { const p = promoFor(i); return p ? round2(amount * (100 - Number(p.percent)) / 100) : amount; };
  function priceHtml(i) {
    const p = promoFor(i);
    return p ? `<s class="st-was">${baht(i.price)}</s> <b>${baht(applyPromo(i, Number(i.price)))}</b> <span class="st-tag st-tag--promo">−${Number(p.percent)}%</span>`
             : `<b>${baht(i.price)}</b>`;
  }
  async function loadPromos() {
    const { data } = await sb.rpc('st_public_promos', { p_qr: qr });
    promos = Array.isArray(data) ? data : [];
  }

  // ---------- ข้อความลอยด้านล่าง ----------
  let toastTimer;
  function toast(text) {
    const tt = $('#toast');
    tt.textContent = text; tt.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { tt.hidden = true; }, 2600);
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
    if (!sharedOn()) ls.set(KEY_CART, cart.length ? JSON.stringify({ token, lines: cart }) : null);
    renderCartBar();
  }
  const cartTotal = () => cart.reduce((s, l) => s + l.unit * l.qty, 0);
  const cartCount = () => cart.reduce((s, l) => s + l.qty, 0);

  function renderCartBar() {
    const show = canOrder() && cart.length > 0;
    $('#cart-bar').hidden = !show;
    document.body.classList.toggle('st-has-cart', show);
    $('#cart-label').textContent = sharedOn() ? t('table_cart') : t('view_cart');
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
      if (!lastScan) $('#g-shop').textContent = 'SmartTable';
      showMsg(gErr(error));
      return null;
    }
    const wasPending = !!(lastScan && lastScan.confirm === 'pending' && token);
    lastScan = data;
    const newToken = data.session_token || null;
    // โหมด "ลูกค้าเปิดโต๊ะเอง ร้านยืนยัน" (st-14)
    if (!staffMode) {
      if (data.confirm === 'pending' && newToken && newToken !== token) showMsg(t('cf_opened'), 'ok');
      else if (wasPending && newToken && newToken === token && data.confirm === 'confirmed') showMsg(t('cf_confirmed'), 'ok');
      else if (wasPending && !newToken) showMsg(t('cf_rejected'));
    }
    if (newToken !== token) {
      token = newToken;
      if (!staffMode) ls.set(KEY_SESSION, token);
      loadCart();                                     // รอบใหม่ = ตะกร้าใหม่
      guestInfo = null;
      shared = false;
      initShared();
    }
    state = data.state;
    if (!brandDone) {
      brandDone = true;
      applyTheme(data.shop.theme_color);
      if (data.shop.cover_path) { $('#g-cover').style.backgroundImage = `url("${imgUrl(data.shop.cover_path)}")`; $('#g-cover').hidden = false; }
      if (data.shop.logo_path) { $('#g-logo').src = imgUrl(data.shop.logo_path); $('#g-logo').hidden = false; }
      pickLang(data.shop.languages || []);
    }
    renderState();
    renderTicket();
    renderCartBar();
    if (token) refreshGuest(); else { renderButtons(); renderRate(); renderPay(); }
    return data;
  }

  function renderState() {
    const data = lastScan;
    if (!data) return;
    $('#g-shop').textContent = data.shop.name;
    $('#g-sub').textContent = data.table.zone || '';
    const place = isHub() ? '🛍 ' + t('ta_title') : ticket() ? '🛍 ' + t('queue_no', { n: ticket().queue_no })
      : t('table') + ' ' + data.table.label;
    $('#g-table').textContent = place;
    $('#g-table').hidden = false;
    document.title = data.shop.name + ' · ' + place;
    const cls = { open: 'ok', waiting: 'wait', billing: 'wait', shop_closed: 'off', ended: 'off', takeaway: 'ok', takeaway_off: 'off' }[state];
    $('#g-state').className = 'st-state st-state--' + cls;
    if (state === 'open' && data.confirm === 'pending' && token) {
      $('#g-state').className = 'st-state st-state--ok';
      $('#g-state').innerHTML = `<b>${esc(t('cf_pending_t'))}</b><span><i class="st-dot-inline"></i>${esc(t('cf_pending'))}</span>`;
    } else
    $('#g-state').innerHTML = `<b>${esc(t('st_' + state + '_t'))}</b><span>${esc(t('st_' + state))}</span>`;
    $('#g-state').hidden = !!ticket();                // บัตรคิวมีการ์ดบอกสถานะแทน
    $('#g-actions').hidden = !token;
    if (staffMode) {
      document.querySelectorAll('[data-call]').forEach(b => { b.hidden = true; });
      $('#g-staff').innerHTML = ticket()
        ? `🛎 <b>โหมดพนักงาน</b> · สั่งกลับบ้าน คิว ${esc(ticket().queue_no)}${ticket().contact_name ? ' (' + esc(ticket().contact_name) + ')' : ''} · <a href="queue.html?id=${encodeURIComponent(data.shop.id)}">กลับหน้าคิว</a>`
        : `🛎 <b>โหมดพนักงาน</b> · สั่งแทนลูกค้าโต๊ะ ${esc(data.table.label)} · <a href="tables.html?id=${encodeURIComponent(data.shop.id)}">กลับผังโต๊ะ</a>`;
      $('#g-staff').hidden = false;
      if (state === 'waiting') $('#g-state').innerHTML = '<b>โต๊ะนี้ยังไม่ได้เปิด</b><span>เปิดโต๊ะที่ผังโต๊ะก่อน แล้วกลับมาหน้านี้</span>';
    }
  }

  function renderButtons() {
    const pend = (guestInfo && guestInfo.pending_calls) || [];
    const n = guestInfo ? guestInfo.orders.filter(o => o.status !== 'cancelled').length : 0;
    $('#orders-count').textContent = n ? `(${n})` : '';
    const bCall = document.querySelector('[data-call="call"]');
    const bBill = document.querySelector('[data-call="bill"]');
    bCall.disabled = pend.includes('call');
    bCall.textContent = pend.includes('call') ? t('called') : t('call');
    bBill.disabled = pend.includes('bill') || state === 'billing';
    bBill.textContent = bBill.disabled ? t('billed') : t('bill');
  }

  async function refreshGuest() {
    if (!token) return;
    const { data, error } = await sb.rpc('st_guest_orders', { p_qr: qr, p_session_token: token });
    if (error) return;
    guestInfo = data;
    if (!staffMode && data.orders.some(o => o.status !== 'cancelled')) {
      ls.set(KEY_LAST, JSON.stringify({ token, at: Date.now() }));
    }
    renderButtons();
    renderRate();
    renderPay();
    if (sheetMode === 'orders') renderOrders();
  }

  // ---------- ให้คะแนน (ตอนเช็กบิล หรือภายใน 3 ชม. หลังจ่ายเงิน) ----------
  let stars = 0;
  function rateToken() {
    if (staffMode) return null;
    if (token && state === 'billing' && guestInfo && guestInfo.orders.some(o => o.status !== 'cancelled')) return token;
    if (!token) {
      try {
        const last = JSON.parse(ls.get(KEY_LAST) || 'null');
        if (last && Date.now() - last.at < 3 * 3600 * 1000) return last.token;
      } catch { /* ไม่เป็นไร */ }
    }
    return null;
  }
  function renderRate() {
    const tok = rateToken();
    const box = $('#g-rate');
    if (!tok || ls.get('st-rated:' + tok)) { if (!box.dataset.thanks) box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `
      <b>${esc(t('rate_t'))}</b>
      <div class="st-stars" role="radiogroup" aria-label="${esc(t('rate_pick'))}">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}" aria-label="${n}" aria-pressed="${n <= stars}">★</button>`).join('')}
      </div>
      <textarea id="rate-comment" maxlength="300" rows="2" placeholder="${esc(t('rate_ph'))}"></textarea>
      <button id="rate-send" class="st-btn" type="button" ${stars ? '' : 'disabled'}>${esc(t('rate_send'))}</button>`;
  }
  $('#g-rate').addEventListener('click', async (e) => {
    const s = e.target.closest('[data-star]');
    if (s) {
      stars = Number(s.dataset.star);
      $('#g-rate').querySelectorAll('[data-star]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.star) <= stars)));
      $('#rate-send').disabled = false;
      return;
    }
    if (e.target.id !== 'rate-send') return;
    const tok = rateToken();
    if (!tok || !stars) return;
    e.target.disabled = true;
    const { error } = await sb.rpc('st_guest_rate', { p_qr: qr, p_session_token: tok, p_stars: stars, p_comment: $('#rate-comment').value.trim() || null });
    if (error) { e.target.disabled = false; return showMsg(gErr(error)); }
    ls.set('st-rated:' + tok, '1');
    const box = $('#g-rate');
    box.dataset.thanks = '1';
    box.innerHTML = `<b>${esc(t('rate_thanks'))}</b>`;
    setTimeout(() => { box.hidden = true; delete box.dataset.thanks; }, 4000);
  });

  // ---------- เมนู ----------
  let activeCat = '';
  // ตัวกรอง: อาหารประเภท (ต้องมีป้าย) / ไม่มีสารก่อแพ้ (ต้องไม่มีป้าย)
  const passDiet = (i) => [...diet].every(k => TAGS[k].kind === 'diet' ? (i.tags || []).includes(k) : !(i.tags || []).includes(k));
  const tagLabel = (k) => t('tag_' + k);
  function renderDiet() {
    const used = new Set(menu.items.flatMap(i => i.tags || []));
    const keys = Object.keys(TAGS).filter(k => used.has(k));
    $('#g-diet').innerHTML = keys.map(k => `<button type="button" data-diet="${k}" aria-pressed="${diet.has(k)}">${TAGS[k].kind === 'diet' ? TAGS[k].icon + ' ' + esc(tagLabel(k)) : '🚫 ' + esc(t('none_' + k))}</button>`).join('');
    $('#g-diet').hidden = !keys.length;
  }
  function renderMenu() {
    const term = $('#g-search').value.trim().toLowerCase();
    const cats = menu.categories.filter(c => menu.items.some(i => i.category_id === c.id));
    const loose = menu.items.filter(i => !i.category_id);
    const groups = cats.map(c => ({ id: c.id, name: cname(c), items: menu.items.filter(i => i.category_id === c.id) }));
    if (loose.length) groups.push({ id: 'none', name: cats.length ? t('other') : t('menu'), items: loose });

    $('#g-cats').innerHTML = groups.length > 1 ? groups.map(g =>
      `<button type="button" data-cat="${esc(g.id)}" class="${g.id === activeCat ? 'on' : ''}">${esc(g.name)}</button>`).join('') : '';

    const hit = (i) => !term || [i.name, i.description, iname(i), idesc(i)].some(x => (x || '').toLowerCase().includes(term));
    const shown = groups.map(g => ({ ...g, items: g.items.filter(i => hit(i) && passDiet(i)) })).filter(g => g.items.length);

    const inCart = (id) => cart.filter(l => l.item_id === id).reduce((s, l) => s + l.qty, 0);
    $('#g-items').innerHTML = shown.length ? shown.map(g => `
      <section class="st-gsec" id="cat-${esc(g.id)}">
        <h2>${esc(g.name)}</h2>
        ${g.items.map(i => `
          <article class="st-gitem${i.is_available ? '' : ' st-gitem--off'}" data-id="${esc(i.id)}" role="button" tabindex="0">
            <div class="st-gimg">${i.image_path ? `<img src="${esc(imgUrl(i.image_path))}" alt="" loading="lazy">` : ''}</div>
            <div class="st-gbody">
              <h3>${esc(iname(i))}</h3>
              ${idesc(i) ? `<p>${esc(idesc(i))}</p>` : ''}
              <div class="st-gmeta">
                ${priceHtml(i)}
                ${i.is_recommended ? `<span class="st-tag st-tag--rec">${esc(t('recommended'))}</span>` : ''}
                ${i.spicy_level ? `<span class="st-tag">${SPICY[i.spicy_level]}</span>` : ''}
                ${i.is_available ? '' : `<span class="st-tag st-tag--off">${esc(t('sold_out'))}</span>`}
                ${i.is_available && i.stock_left != null && i.stock_left <= 5 ? `<span class="st-tag st-tag--low">${esc(t('left', { n: i.stock_left }))}</span>` : ''}
                ${(i.tags || []).map(k => TAGS[k] ? `<span class="st-tag st-tag--${TAGS[k].kind}" title="${esc(tagLabel(k))}">${TAGS[k].icon}${TAGS[k].kind === 'diet' ? ' ' + esc(tagLabel(k)) : ''}</span>` : '').join('')}
                ${inCart(i.id) ? `<span class="st-tag st-tag--cart">${esc(t('in_cart', { n: inCart(i.id) }))}</span>` : ''}
              </div>
            </div>
          </article>`).join('')}
      </section>`).join('')
      : `<div class="st-empty">${esc(term ? t('no_result') : t('no_menu'))}</div>`;
  }
  async function loadMenu() {
    const [{ data, error }] = await Promise.all([sb.rpc('st_public_menu', { p_qr: qr }), loadPromos()]);
    if (error) { showMsg(gErr(error)); return false; }
    menu = data;
    renderDiet();
    renderMenu();
    return true;
  }

  $('#g-search').addEventListener('input', renderMenu);
  $('#g-diet').addEventListener('click', (e) => {
    const b = e.target.closest('[data-diet]');
    if (!b) return;
    diet.has(b.dataset.diet) ? diet.delete(b.dataset.diet) : diet.add(b.dataset.diet);
    renderDiet(); renderMenu();
  });
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
  let sheetHist = false;              // เปิดแผ่นแล้วดัน history 1 ขั้น -> ปุ่มย้อนกลับ / ปัดย้อนกลับ = ปิดแผ่น
  function openSheet(mode, title) {
    if (sheet.hidden && !sheetHist) {
      try { history.pushState({ stSheet: 1 }, ''); sheetHist = true; } catch { /* ไม่เป็นไร */ }
    }
    sheetMode = mode;
    $('#toast').hidden = true;
    $('#sheet-title').textContent = title;
    $('#sheet-msg').hidden = true;
    sheet.hidden = false;
    document.body.classList.add('st-noscroll');
    sheet.querySelector('.st-sheet-scroll').scrollTop = 0;
  }
  function hideSheet() {
    sheet.hidden = true; sheetMode = null; current = null;
    panel.style.transform = '';
    document.body.classList.remove('st-noscroll');
  }
  function closeSheet() {
    if (sheet.hidden) return;
    hideSheet();
    if (sheetHist) { sheetHist = false; try { history.back(); } catch { /* ไม่เป็นไร */ } }
  }
  window.addEventListener('popstate', () => { if (sheetHist) { sheetHist = false; hideSheet(); } });
  const panel = sheet.querySelector('.st-sheet-panel');
  $('#sheet-close').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  // ปัดหัวแผ่นลงเพื่อปิด
  (function () {
    const head = sheet.querySelector('.st-sheet-head');
    let y0 = null, dy = 0;
    head.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      y0 = e.touches[0].clientY; dy = 0; panel.style.transition = 'none';
    }, { passive: true });
    head.addEventListener('touchmove', (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      panel.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    head.addEventListener('touchend', () => {
      if (y0 === null) return;
      y0 = null; panel.style.transition = 'transform .18s ease-out';
      if (dy > 90) closeSheet(); else panel.style.transform = '';
    });
  })();

  // ----- เลือกเมนู -----
  const ruleText = (g) => g.max_select === 1
    ? (g.min_select >= 1 ? t('must1') : t('opt1'))
    : (g.min_select >= 1 ? t('range', { a: g.min_select, b: g.max_select }) : t('upto', { b: g.max_select }));

  function openItem(id) {
    const it = menu.items.find(x => x.id === id);
    if (!it) return;
    current = it; qty = 1;
    const blocked = !it.is_available ? t('item_sold_out') : !canOrder() ? (t('st_' + state + '_t') || t('cant_order')) : '';
    const p = promoFor(it);
    $('#sheet-body').innerHTML = `
      ${it.image_path ? `<div class="st-hero"><img src="${esc(imgUrl(it.image_path))}" alt="" decoding="async"></div>` : ''}
      <h2 class="st-hero-name">${esc(iname(it))}</h2>
      ${lang !== 'th' && iname(it) !== it.name ? `<p class="st-sub" style="margin:-2px 0 4px">${esc(it.name)}</p>` : ''}
      ${idesc(it) ? `<p class="st-sub">${esc(idesc(it))}</p>` : ''}
      <p class="st-hero-price">${priceHtml(it)}${it.stock_left != null && it.is_available ? ` <small class="st-sub">· ${esc(t('left', { n: it.stock_left }))}</small>` : ''}</p>
      ${p ? `<p class="st-promo-line">🏷 ${esc(t('promo_until', { x: p.name, t: p.end_time }))}</p>` : ''}
      ${(it.tags || []).length ? `<p class="st-hero-tags">${it.tags.map(k => TAGS[k] ? `<span class="st-tag st-tag--${TAGS[k].kind}">${TAGS[k].icon} ${esc(tagLabel(k))}</span>` : '').join(' ')}</p>` : ''}
      <form id="form-add" novalidate>
        ${it.options.map(g => `
          <fieldset class="st-optg" data-g="${esc(g.id)}" data-min="${g.min_select}" data-max="${g.max_select}" data-name="${esc(oname(it, g.name))}">
            <legend>${esc(oname(it, g.name))} <small class="${g.min_select ? 'req' : ''}">${esc(ruleText(g))}</small></legend>
            ${g.choices.map(c => `
              <label class="st-optc">
                <input type="checkbox" value="${esc(c.id)}" data-delta="${Number(c.price_delta)}" data-name="${esc(c.name)}">
                <span>${esc(oname(it, c.name))}</span><em>${plus(c.price_delta)}</em>
              </label>`).join('')}
          </fieldset>`).join('')}
        <label class="st-field"><span>${esc(t('note_kitchen'))}</span>
          <input name="note" type="text" maxlength="140" placeholder="${esc(t('note_kitchen_ph'))}">
        </label>
        ${blocked ? `<p class="st-msg st-msg--error">${esc(blocked)}</p>` : `
        <div class="st-add-row">
          <div class="st-qty">
            <button type="button" data-q="-1" aria-label="−">−</button><b id="q-n">1</b><button type="button" data-q="1" aria-label="+">+</button>
          </div>
          <button class="st-btn" type="submit" id="btn-add">${esc(t('add'))}</button>
        </div>`}
      </form>`;
    openSheet('item', iname(it));
    updateAddPrice();
  }

  function selectedChoices() {
    return [...$('#sheet-body').querySelectorAll('.st-optc input:checked')];
  }
  const unitFor = (it, picked) => applyPromo(it, Math.max(Number(it.price) + picked.reduce((s, i) => s + Number(i.dataset.delta), 0), 0));
  function updateAddPrice() {
    const btn = $('#btn-add');
    if (!btn || !current) return;
    btn.textContent = `${t('add')} · ${baht(unitFor(current, selectedChoices()) * qty)}`;
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
      if (n < Number(fs.dataset.min)) return sheetMsg(t('please_pick', { x: fs.dataset.name }));
    }
    const picked = selectedChoices();
    const choices = picked.map(i => i.value).sort();
    const note = e.target.note.value.trim().slice(0, 140);
    const unit = unitFor(current, picked);
    const key = [current.id, choices.join(','), note, sharedOn() ? DEVICE : ''].join('|');
    let same = cart.find(l => l.key === key);
    if (qty > remaining(current)) return sheetMsg(t('not_enough', { x: iname(current) }));
    if (same) { same.qty = Math.min(20, same.qty + qty); same.unit = unit; }
    else {
      same = { id: uuid(), key, item_id: current.id, name: current.name, unit, qty, choices,
               labels: picked.map(i => i.dataset.name), note, mine: true };
      cart.push(same);
    }
    saveCart();
    if (sharedOn()) putLine(same);
    renderMenu();
    const name = iname(current);
    closeSheet();
    toast(t('added', { x: name, n: qty }));
  });

  // ----- ตะกร้า -----
  function renderCart() {
    if (!cart.length) {
      $('#sheet-body').innerHTML = `<div class="st-empty">${esc(t('cart_empty'))}</div>`;
      return;
    }
    $('#sheet-body').innerHTML = `
      ${sharedOn() ? `<p class="st-shared-hint">👥 ${esc(t('shared_hint'))}</p>` : ''}
      <div class="st-lines">${linesHtml()}</div>
      ${sendFormHtml()}`;
  }
  function linesHtml() {
    return cart.map(l => {
          const it = menu.items.find(x => x.id === l.item_id);
          return `
          <div class="st-line" data-k="${esc(l.key)}">
            <div class="st-line-main">
              <b>${esc(it ? iname(it) : l.name)}</b>
              ${l.labels.length ? `<small>${esc(l.labels.map(s => oname(it, s)).join(' · '))}</small>` : ''}
              ${l.note ? `<small>📝 ${esc(l.note)}</small>` : ''}
              ${sharedOn() ? `<small class="st-line-by">${l.mine ? '🙋 ' + esc(t('by_you')) : l.by ? '👤 ' + esc(t('by_x', { x: l.by })) : '👤 ' + esc(t('by_other'))}</small>` : ''}
              <span class="st-line-price">${baht(l.unit * l.qty)}</span>
            </div>
            <div class="st-qty st-qty--sm">
              <button type="button" data-d="-1" aria-label="−">${l.qty === 1 ? '🗑' : '−'}</button><b>${l.qty}</b><button type="button" data-d="1" aria-label="+">+</button>
            </div>
          </div>`;
        }).join('');
  }
  function sendFormHtml() {
    return `
      <form id="form-send" novalidate>
        ${state === 'takeaway' ? `
        <label class="st-field"><span>${esc(t('ta_name'))} *</span>
          <input name="ta_name" type="text" maxlength="40" required autocomplete="name" placeholder="${esc(t('ta_name_ph'))}" value="${esc(ls.get(KEY_NAME) || '')}">
        </label>
        <label class="st-field"><span>${esc(t('ta_phone'))}</span>
          <input name="ta_phone" type="tel" maxlength="16" inputmode="tel" autocomplete="tel" value="${esc(ls.get(KEY_PHONE) || '')}">
        </label>
        ${lastScan.takeaway && lastScan.takeaway.preorder ? `
        <label class="st-field"><span>${esc(t('ta_pickup'))}</span>
          <select name="ta_pickup">${pickupOptions()}</select>
        </label>` : ''}` : `
        <label class="st-field"${staffMode ? ' hidden' : ''}><span>${esc(t('nickname'))}</span>
          <input name="guest_name" type="text" maxlength="30" placeholder="${esc(t('nickname_ph'))}" value="${esc(ls.get(KEY_NAME) || '')}">
        </label>`}
        <label class="st-field"><span>${esc(t('note_shop'))}</span>
          <input name="note" type="text" maxlength="200" placeholder="${esc(t('note_shop_ph'))}">
        </label>
        <div class="st-sum"><span>${esc(t('food_total'))}</span><b>${baht(cartTotal())}</b></div>
        <p class="st-sub" style="margin-top:4px">${esc(t('fees_later'))}${promos.length ? ' · ' + esc(t('promo_note')) : ''}</p>
        <button class="st-btn" type="submit" id="btn-send">${esc(sendLabel())}</button>
      </form>`;
  }
  const sendLabel = () => t(state === 'takeaway' ? 'ta_send' : sharedOn() ? 'send_all' : 'send', { n: cartCount() });
  // อัปเดตเฉพาะรายการ + ยอด (ไม่ล้างช่องที่กำลังพิมพ์)
  function updateCartSheet() {
    if (sheetMode !== 'cart') return;
    if (!cart.length || !$('#sheet-body .st-lines')) return renderCart();
    $('#sheet-body .st-lines').innerHTML = linesHtml();
    const sum = $('#sheet-body .st-sum b');
    if (sum) sum.textContent = baht(cartTotal());
    const btn = $('#btn-send');
    if (btn && !btn.disabled) btn.textContent = sendLabel();
  }
  $('#btn-cart').addEventListener('click', () => {
    openSheet('cart', sharedOn() ? t('table_cart') : t('my_cart'));
    renderCart();
    if (sharedOn()) pullCart();
  });

  $('#sheet-body').addEventListener('click', (e) => {
    const qb = e.target.closest('[data-q]');
    if (qb) {
      qty = Math.min(maxQty(current), Math.max(1, qty + Number(qb.dataset.q)));
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
      const it = menu.items.find(x => x.id === line.item_id);
      if (Number(db.dataset.d) > 0 && it && remaining(it) < 0) { line.qty -= 1; sheetMsg(t('not_enough', { x: iname(it) })); }
      saveCart(); renderMenu(); renderCart();
      if (sharedOn()) putLine(line);
    }
  });

  $('#sheet-body').addEventListener('submit', async (e) => {
    if (e.target.id !== 'form-send') return;
    e.preventDefault();
    if (!canOrder()) return sheetMsg(t('st_' + state + '_t') || t('cant_order'));
    const f = e.target;
    if (state === 'takeaway') return sendTakeaway(f);
    const guestName = f.guest_name.value.trim().slice(0, 30);
    ls.set(KEY_NAME, guestName || null);
    if (!pendingRef) pendingRef = rand();
    const btn = $('#btn-send');
    btn.disabled = true; btn.textContent = t('sending');
    const items = cart.map(l => ({ item_id: l.item_id, qty: l.qty, choices: l.choices, note: l.note || null }));
    const isShared = sharedOn();
    const { data, error } = staffMode
      ? await sb.rpc('st_staff_order', { p_qr: qr, p_items: items, p_note: f.note.value.trim() || null, p_client_ref: pendingRef })
      : isShared
      ? await sb.rpc('st_cart_send', {
          p_qr: qr, p_session_token: token, p_note: f.note.value.trim() || null,
          p_guest_name: guestName || null, p_client_ref: pendingRef
        })
      : await sb.rpc('st_place_order', {
          p_qr: qr, p_session_token: token, p_items: items,
          p_note: f.note.value.trim() || null, p_guest_name: guestName || null, p_client_ref: pendingRef
        });
    if (error) {
      btn.disabled = false; btn.textContent = sendLabel();
      const code = error.message || '';
      if (code.startsWith('st_')) pendingRef = null;            // ร้านปฏิเสธ = ยังไม่ได้สร้างออร์เดอร์
      if (isShared) pullCart();
      if (['st_item_sold_out', 'st_item_gone', 'st_options_changed', 'st_options_required', 'st_out_of_stock'].includes(code)) loadMenu();
      if (['st_session_invalid', 'st_session_billing', 'st_shop_closed', 'st_table_not_open'].includes(code)) scan(false);
      return sheetMsg(gErr(error));
    }
    if (isShared) { ping('sent'); await pullCart(); } else { cart = []; saveCart(); }
    renderMenu();
    await refreshGuest();
    openSheet('orders', t('ordered'));
    renderOrders();
    sheetMsg(t('sent', { n: data.order_no }), 'ok');
  });

  // ----- ที่สั่งแล้ว + ยอดบิล -----
  function renderOrders() {
    const info = guestInfo;
    if (!info) { $('#sheet-body').innerHTML = `<p class="st-sub">${esc(t('loading'))}</p>`; return; }
    const orders = info.orders.slice().reverse();
    const b = info.bill;
    $('#sheet-body').innerHTML = `
      ${orders.length ? orders.map(o => `
        <div class="st-order st-order--${o.status}">
          <div class="st-order-head">
            <b>#${o.order_no}</b>
            <span>${new Date(o.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}${o.guest_name ? ' · ' + esc(o.guest_name) : ''}</span>
            <em class="st-ostat st-ostat--${o.status}">${esc(t('o_' + o.status))}</em>
          </div>
          ${o.items.map(i => {
            const it = byThaiName(i.name);
            return `
            <div class="st-oline">
              <span>${i.done && o.status !== 'served' && o.status !== 'cancelled' ? `<i class="st-dish-ok">✓ ${esc(t('dish_done'))}</i> ` : ''}${i.qty}× ${esc(it ? iname(it) : i.name)}${i.options.length ? `<small>${esc(i.options.map(x => oname(it, x.name)).join(' · '))}</small>` : ''}${i.note ? `<small>📝 ${esc(i.note)}</small>` : ''}</span>
              <span>${baht(i.line_total)}</span>
            </div>`;
          }).join('')}
          ${o.note ? `<p class="st-sub" style="margin:4px 0 0">📝 ${esc(o.note)}</p>` : ''}
        </div>`).join('') : `<div class="st-empty">${esc(t('nothing_yet'))}</div>`}
      ${orders.length ? `
        <div class="st-bill">
          <div><span>${esc(t('b_food'))}</span><span>${baht(b.subtotal)}</span></div>
          ${Number(b.service_pct) ? `<div><span>${esc(t('b_service', { p: Number(b.service_pct) }))}</span><span>${baht(b.service)}</span></div>` : ''}
          ${Number(b.vat_pct) ? `<div><span>${esc(t('b_vat', { p: Number(b.vat_pct) }))}${b.vat_included ? esc(t('b_vat_inc')) : ''}</span><span>${b.vat_included ? `<small>${baht(b.vat)}</small>` : baht(b.vat)}</span></div>` : ''}
          <div class="st-bill-total"><span>${esc(t('b_total'))}</span><b>${baht(b.total)}</b></div>
          ${info.pay && Number(info.pay.paid_total) > 0 ? `
            <div><span>${esc(t('pay_paid'))}</span><span>−${baht(info.pay.paid_total)}</span></div>
            <div class="st-bill-total"><span>${esc(t('pay_left'))}</span><b>${baht(info.pay.remaining.total)}</b></div>` : ''}
        </div>` : ''}`;
  }
  $('#btn-orders').addEventListener('click', async () => {
    openSheet('orders', t('ordered'));
    renderOrders();
    await refreshGuest();
    renderOrders();
  });

  // ----- เรียกพนักงาน / ขอเช็กบิล -----
  $('#g-actions').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-call]');
    if (!b || !token) return;
    const kind = b.dataset.call;
    if (kind === 'bill' && !confirm(t('confirm_bill'))) return;
    b.disabled = true;
    const { error } = await sb.rpc('st_guest_call', { p_qr: qr, p_session_token: token, p_kind: kind });
    if (error) {
      b.disabled = false;
      if (error.message === 'st_session_invalid') scan(false);
      return showMsg(gErr(error));
    }
    toast(kind === 'bill' ? t('toast_bill') : t('toast_call'));
    await scan(false);
  });

  // ---------- ตะกร้าร่วมทั้งโต๊ะ ----------
  function sharedOn() { return shared && !staffMode && !!token && state === 'open'; }

  function fromServer(l) {
    const m = l.meta || {};
    const it = menu.items.find(x => x.id === l.item_id);
    const choices = Array.isArray(l.choices) ? l.choices : [];
    return {
      id: l.id, item_id: l.item_id, qty: l.qty, choices, note: l.note || '',
      key: [l.item_id, choices.slice().sort().join(','), l.note || '', l.device || ''].join('|'),
      name: m.name || (it ? it.name : ''), unit: Number(m.unit) || (it ? Number(it.price) : 0),
      labels: Array.isArray(m.labels) ? m.labels : [], by: l.added_by || '', mine: l.device === DEVICE
    };
  }
  function setShared(lines) {
    const sig = JSON.stringify(lines.map(l => [l.id, l.qty, l.updated_at]));
    if (sig === cartSig) return;
    cartSig = sig;
    cart = lines.map(fromServer);
    renderCartBar();
    renderMenu();
    updateCartSheet();
  }

  // ร้านเปิดตะกร้าร่วมไหม -> ย้ายของในตะกร้าเครื่องนี้ (ถ้ามี) ขึ้นตะกร้าโต๊ะ -> ฟังสัญญาณจากเครื่องอื่น
  async function initShared() {
    if (staffMode || !token) return;
    const myToken = token;
    const { data, error } = await sb.rpc('st_cart_get', { p_qr: qr, p_session_token: token });
    if (error || myToken !== token || !data || !data.enabled) return;
    shared = true;
    cartSig = '';
    const local = cart.slice();
    if (local.length && state === 'open') {
      for (const l of local) { l.id = uuid(); l.mine = true; await putLine(l, true); }
      ls.set(KEY_CART, null);
      const again = await sb.rpc('st_cart_get', { p_qr: qr, p_session_token: token });
      if (again.data) setShared(again.data.lines);
      ping();
    } else setShared(data.lines);
    joinChannel();
    if (sheetMode === 'cart') renderCart();
  }

  async function pullCart() {
    if (!shared || !token) return;
    const { data, error } = await sb.rpc('st_cart_get', { p_qr: qr, p_session_token: token });
    if (error || !data) return;
    if (!data.enabled) {                        // ร้านเพิ่งปิดตะกร้าร่วม -> กลับไปใช้ตะกร้าในเครื่อง
      shared = false; cart = []; loadCart(); renderCartBar(); renderMenu(); updateCartSheet();
      return;
    }
    setShared(data.lines);
  }

  async function putLine(l, quiet) {
    const { data, error } = await sb.rpc('st_cart_put', {
      p_qr: qr, p_session_token: token,
      p_line: {
        id: l.id, item_id: l.item_id, qty: l.qty, choices: l.choices, note: l.note || null,
        added_by: l.mine ? (ls.get(KEY_NAME) || null) : null, device: DEVICE,
        meta: { name: l.name, unit: l.unit, labels: l.labels || [] }
      }
    });
    if (quiet) return;
    if (error) {
      (sheetMode ? sheetMsg : showMsg)(gErr(error));
      if (['st_session_invalid', 'st_session_billing'].includes(error.message)) scan(false);
      return pullCart();
    }
    cartSig = '';
    setShared(data);
    ping();
  }

  // ช่อง Broadcast ของโต๊ะ: ชื่อมาจาก session_token ที่แฮชแล้ว (คนนอกโต๊ะเดาไม่ได้)
  async function joinChannel() {
    try {
      if (!token || !window.crypto || !crypto.subtle || typeof sb.channel !== 'function') return;
      const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('st-cart:' + token));
      const topic = 'st-cart-' + Array.from(new Uint8Array(h)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
      if (topic === cartTopic) return;
      if (cartCh && typeof sb.removeChannel === 'function') sb.removeChannel(cartCh);
      cartTopic = topic;
      cartCh = sb.channel(topic, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'cart' }, (msg) => {
          pullCart();
          if (msg && msg.payload && msg.payload.k === 'sent') { refreshGuest(); toast(t('cart_sent_other')); }
        })
        .subscribe();
    } catch { /* ไม่มี Realtime ก็ยังดึงซ้ำเป็นระยะได้ */ }
  }
  function ping(k) {
    try { if (cartCh && cartCh.send) cartCh.send({ type: 'broadcast', event: 'cart', payload: { k: k || 'cart' } }); }
    catch { /* ไม่เป็นไร */ }
  }
  // ดึงตะกร้าโต๊ะซ้ำเป็นระยะ (เผื่อ Realtime หลุด) — เร็วขึ้นตอนเปิดดูตะกร้า
  let pullTick = 0;
  setInterval(() => {
    if (!sharedOn() || document.hidden) return;
    pullTick++;
    if (sheetMode === 'cart' || pullTick % 3 === 0) pullCart();
  }, 5000);

  // ---------- สั่งกลับบ้าน ----------
  const lhhmm = (d) => new Date(d).toLocaleTimeString(lang === 'th' ? 'th-TH' : lang === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  function pickupOptions() {
    const out = [`<option value="">${esc(t('ta_asap'))}</option>`];
    const d = new Date(Date.now() + 15 * 60000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    const today = new Date().toDateString();
    for (let k = 0; k < 92; k++) {                     // 23 ชั่วโมงข้างหน้า ทีละ 15 นาที
      const x = new Date(d.getTime() + k * 15 * 60000);
      const day = x.toDateString() === today ? '' : x.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short' }) + ' ';
      out.push(`<option value="${x.toISOString()}">${esc(day + lhhmm(x))}</option>`);
    }
    return out.join('');
  }

  async function sendTakeaway(f) {
    const name = f.ta_name.value.trim().slice(0, 40);
    const phone = f.ta_phone.value.trim();
    if (!name) { f.ta_name.focus(); return sheetMsg(t('ta_need_name')); }
    ls.set(KEY_NAME, name);
    ls.set(KEY_PHONE, phone || null);
    if (!pendingRef) pendingRef = rand();
    const btn = $('#btn-send');
    btn.disabled = true; btn.textContent = t('sending');
    const items = cart.map(l => ({ item_id: l.item_id, qty: l.qty, choices: l.choices, note: l.note || null }));
    const { data, error } = await sb.rpc('st_takeaway_order', {
      p_hub_qr: qr, p_items: items, p_name: name, p_phone: phone || null,
      p_pickup_at: (f.ta_pickup && f.ta_pickup.value) || null,
      p_note: f.note.value.trim() || null, p_client_ref: pendingRef
    });
    if (error) {
      btn.disabled = false; btn.textContent = t('ta_send', { n: cartCount() });
      const code = error.message || '';
      if (code.startsWith('st_')) pendingRef = null;
      if (['st_item_sold_out', 'st_item_gone', 'st_options_changed', 'st_options_required', 'st_out_of_stock'].includes(code)) loadMenu();
      if (['st_shop_closed', 'st_takeaway_off'].includes(code)) scan(false);
      return sheetMsg(gErr(error));
    }
    cart = []; saveCart();
    ls.set(KEY_TICKET, JSON.stringify({ qr: data.qr_token, no: data.queue_no, at: Date.now() }));
    ls.set('st-session:' + data.qr_token, data.session_token);
    location.replace('table.html?t=' + encodeURIComponent(data.qr_token));
  }

  // หน้า QR สั่งกลับบ้าน: ลิงก์กลับไปบัตรคิวล่าสุด (12 ชม.)
  function renderMine() {
    const a = $('#g-mine');
    a.hidden = true;
    if (!isHub() || staffMode) return;
    try {
      const v = JSON.parse(ls.get(KEY_TICKET) || 'null');
      if (v && Date.now() - v.at < 12 * 3600 * 1000) {
        a.href = 'table.html?t=' + encodeURIComponent(v.qr);
        a.textContent = '🛍 ' + t('tk_mine', { n: v.no });
        a.hidden = false;
      }
    } catch { /* ไม่เป็นไร */ }
  }

  // บัตรคิว: เลขคิว + สถานะ + เวลามารับ · แจ้งเตือนเมื่อพร้อม
  let wasReady = null;
  function renderTicket() {
    renderMine();
    const box = $('#g-ticket');
    const k = ticket();
    if (!k) { box.hidden = true; return; }
    const ready = !!k.ready_at && !k.closed;
    if (wasReady === false && ready && !staffMode) {
      try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 500]); } catch { /* ไม่เป็นไร */ }
      toast(t('tk_ready_t'));
    }
    wasReady = ready;
    const pick = k.pickup_at ? t('tk_pickup', { t: lhhmm(k.pickup_at) }) : t('tk_asap');
    let head, sub, cls;
    if (k.closed) {
      cls = 'done'; head = k.picked_up_at ? t('tk_done_t') : t('tk_cancel_t'); sub = '';
    } else if (ready) {
      cls = 'ready'; head = t('tk_ready_t'); sub = t('tk_ready', { n: k.queue_no });
    } else {
      cls = 'prep'; head = t('tk_prep_t', { n: k.queue_no }); sub = t('tk_keep');
    }
    box.className = 'st-ticket st-ticket--' + cls;
    box.innerHTML = `
      <div class="st-ticket-no"><small>${esc(t('queue_no', { n: '' }).trim())}</small><b>${esc(k.queue_no)}</b></div>
      <div class="st-ticket-main">
        <b>${esc(head)}</b>
        ${sub ? `<span>${esc(sub)}</span>` : ''}
        <small>${esc(k.contact_name || '')}${k.contact_name ? ' · ' : ''}${esc(pick)}${k.closed ? '' : ' · ' + esc(k.paid ? t('tk_paid') : t('tk_unpaid'))}</small>
        ${k.closed && k.hub_qr && !staffMode ? `<a class="st-chip" href="table.html?t=${encodeURIComponent(k.hub_qr)}">🛍 ${esc(t('tk_new'))}</a>` : ''}
      </div>`;
    box.hidden = false;
  }

  // ---------- จ่ายเองด้วยพร้อมเพย์ + แนบสลิป ----------
  const money = (n) => '฿' + Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let payStart = null;      // ผล st_guest_pay_start {request_id, amount, promptpay_id, shop_name, upload_path}
  let payQrUrl = null;      // รูป QR (PNG) สำหรับบันทึก
  let slipBlob = null;
  let doneStatus = null;    // สถานะคำขอหลังโต๊ะปิด (ชำระเรียบร้อย)
  let doneFor = null;

  function savedPay() {
    try {
      const v = JSON.parse(ls.get(KEY_PAY) || 'null');
      return v && Date.now() - v.at < 3 * 3600 * 1000 ? v : null;
    } catch { return null; }
  }

  async function renderPay() {
    const box = $('#g-pay');
    if (staffMode) { box.hidden = true; return; }
    const info = token && guestInfo ? guestInfo.pay : null;

    if (!token) {                                  // โต๊ะปิดแล้ว: ถ้าเพิ่งจ่ายเองจากเครื่องนี้ แสดงว่าชำระเรียบร้อย
      const sp = savedPay();
      if (!sp) { box.hidden = true; return; }
      if (doneFor !== sp.req) {
        doneFor = sp.req;
        const { data } = await sb.rpc('st_guest_pay_status', { p_qr: qr, p_session_token: sp.token, p_request: sp.req });
        doneStatus = data || null;
      }
      if (doneStatus && doneStatus.status === 'confirmed') {
        box.className = 'st-paycard st-paycard--ok';
        box.innerHTML = `<b>${esc(t('pay_done_t'))}</b><span>${esc(t('pay_done', { n: doneStatus.receipt_no }))} · ${money(doneStatus.amount)}</span>`;
        box.hidden = false;
      } else box.hidden = true;
      return;
    }
    if (!info) { box.hidden = true; return; }
    const req = info.request;
    const left = Number(info.remaining.total);
    const hasOrders = guestInfo.orders.some(o => o.status !== 'cancelled');

    if (req && req.status === 'pending') {
      box.className = 'st-paycard st-paycard--wait';
      box.innerHTML = `<b>⏳ ${esc(t('pay_pending_t'))} · ${money(req.amount)}</b><span>${esc(t('pay_pending'))}</span>
        <button type="button" class="st-chip" data-pay="cancel">${esc(t('pay_cancel'))}</button>`;
      box.hidden = false;
      return;
    }
    if (!info.self_pay || !hasOrders || left <= 0) { box.hidden = true; return; }
    const rejected = req && req.status === 'rejected';
    box.className = 'st-paycard' + (rejected ? ' st-paycard--bad' : '');
    box.innerHTML = `
      ${rejected ? `<b>${esc(t('pay_rejected_t'))}</b><span>${esc(t('pay_rejected', { x: req.reject_reason || '' }))}</span>` : ''}
      <div class="st-paycard-row">
        <span>${esc(t('pay_left_t'))}${Number(info.paid_total) > 0 ? ` <small>(${esc(t('pay_paid'))} ${money(info.paid_total)})</small>` : ''}</span>
        <b>${money(left)}</b>
      </div>
      <button type="button" class="st-btn" data-pay="open">${esc(rejected ? t('pay_retry') : t('pay_btn'))}</button>`;
    box.hidden = false;
  }

  // QR -> PNG พร้อมชื่อร้านและยอด (ลูกค้าบันทึกรูปไปสแกนในแอปธนาคารได้)
  function qrPng(payload, title, amountText) {
    return new Promise((ok) => {
      const svg = STQR.svg(payload, { margin: 2 });
      const img = new Image();
      img.onload = () => {
        const W = 720, Q = 560;
        const c = document.createElement('canvas');
        c.width = W; c.height = 860;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, W, c.height);
        g.fillStyle = '#0B3D6B'; g.fillRect(0, 0, W, 90);
        g.fillStyle = '#fff'; g.font = '700 40px sans-serif'; g.textAlign = 'center';
        g.fillText('PromptPay', W / 2, 60);
        g.imageSmoothingEnabled = false;
        g.drawImage(img, (W - Q) / 2, 120, Q, Q);
        g.fillStyle = '#111'; g.font = '700 52px sans-serif';
        g.fillText(amountText, W / 2, 760);
        g.fillStyle = '#555'; g.font = '30px sans-serif';
        g.fillText(title.slice(0, 32), W / 2, 815);
        ok(c.toDataURL('image/png'));
      };
      img.onerror = () => ok(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  function renderPaySheet() {
    const p = payStart;
    if (!p) { $('#sheet-body').innerHTML = `<p class="st-sub">${esc(t('loading'))}</p>`; return; }
    const pp = String(p.promptpay_id);
    $('#sheet-body').innerHTML = `
      <div class="st-pay-amt"><span>${esc(t('pay_amount'))}</span><b>${money(p.amount)}</b></div>
      <p class="st-pay-step">${esc(t('pay_s1'))}</p>
      <div class="st-pay-qr">${payQrUrl ? `<img src="${payQrUrl}" alt="PromptPay QR">` : STQR.svg(window.STPromptPay.payload(pp, p.amount), { margin: 2 })}</div>
      <div class="st-pay-tools">
        ${payQrUrl ? `<a class="st-chip" href="${payQrUrl}" download="promptpay-${Number(p.amount).toFixed(2)}.png">${esc(t('pay_save'))}</a>` : ''}
        <button type="button" class="st-chip" data-pay="copy">${esc(t('pay_copy'))} · ${esc(pp)}</button>
      </div>
      <p class="st-pay-step">${esc(t('pay_s2'))}</p>
      <div class="st-photo">
        <div id="pay-slip" class="st-photo-box">${slipBlob ? `<img src="${URL.createObjectURL(slipBlob)}" alt="">` : '🧾'}</div>
        <div class="st-photo-actions">
          <label class="st-chip">${esc(slipBlob ? t('pay_change') : t('pay_attach'))}
            <input id="pay-file" type="file" accept="image/*" hidden>
          </label>
        </div>
      </div>
      <button id="pay-send" class="st-btn" type="button" ${slipBlob ? '' : 'disabled'}>${esc(t('pay_send'))}</button>
      <p class="st-sub" style="margin-top:8px">${esc(t('pay_note'))}</p>
      <button type="button" class="st-btn st-btn--ghost" data-pay="cancel" style="margin-top:6px">${esc(t('pay_cancel'))}</button>`;
  }

  async function openPay() {
    if (!token) return;
    openSheet('pay', t('pay_t'));
    payStart = null; payQrUrl = null; slipBlob = null;
    renderPaySheet();
    const { data, error } = await sb.rpc('st_guest_pay_start', { p_qr: qr, p_session_token: token });
    if (error) {
      $('#sheet-body').innerHTML = '';
      if (['st_session_invalid'].includes(error.message)) scan(false);
      if (error.message === 'st_request_pending') { closeSheet(); refreshGuest(); }
      return sheetMsg(gErr(error));
    }
    payStart = data;
    state = 'billing';
    renderState(); renderCartBar();
    renderPaySheet();
    const pl = window.STPromptPay.payload(String(data.promptpay_id), data.amount);
    payQrUrl = pl ? await qrPng(pl, data.shop_name || '', money(data.amount)) : null;
    if (sheetMode === 'pay') renderPaySheet();
  }

  async function cancelPay(reqId) {
    if (!reqId || !confirm(t('pay_confirm_cancel'))) return;
    const { error } = await sb.rpc('st_guest_pay_cancel', { p_qr: qr, p_session_token: token, p_request: reqId });
    if (error && error.message !== 'st_request_handled') return showMsg(gErr(error));
    ls.set(KEY_PAY, null);
    if (sheetMode === 'pay') closeSheet();
    await scan(false);
  }

  $('#g-pay').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pay]');
    if (!b) return;
    if (b.dataset.pay === 'open') openPay();
    if (b.dataset.pay === 'cancel') cancelPay(guestInfo && guestInfo.pay && guestInfo.pay.request && guestInfo.pay.request.id);
  });
  $('#sheet-body').addEventListener('click', async (e) => {
    if (sheetMode !== 'pay') return;
    const b = e.target.closest('[data-pay]');
    if (b && b.dataset.pay === 'copy' && payStart) {
      if (await ST.copyText(String(payStart.promptpay_id))) toast(t('pay_copied'));
    }
    if (b && b.dataset.pay === 'cancel' && payStart) cancelPay(payStart.request_id);
    if (e.target.id === 'pay-send') sendSlip();
  });
  $('#sheet-body').addEventListener('change', async (e) => {
    if (e.target.id !== 'pay-file') return;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { slipBlob = await ST.shrinkImage(file, 1400, 0.85); renderPaySheet(); }
    catch { sheetMsg(t('pay_bad_img')); }
  });

  async function sendSlip() {
    if (!payStart) return;
    if (!slipBlob) return sheetMsg(t('pay_need_slip'));
    const btn = $('#pay-send');
    btn.disabled = true; btn.textContent = t('pay_sending');
    const { error: upErr } = await sb.storage.from('st-slips')
      .upload(payStart.upload_path, slipBlob, { contentType: 'image/jpeg', upsert: false });
    // อัปโหลดไปแล้วรอบก่อน (กดส่งซ้ำ) = ใช้ไฟล์เดิม
    if (upErr && !/exist|duplicate|409/i.test((upErr.message || '') + (upErr.statusCode || '') + (upErr.error || ''))) {
      btn.disabled = false; btn.textContent = t('pay_send');
      return sheetMsg(gErr({ message: 'st_slip_missing' }));
    }
    const { error } = await sb.rpc('st_guest_pay_submit', { p_qr: qr, p_session_token: token, p_request: payStart.request_id });
    if (error) {
      btn.disabled = false; btn.textContent = t('pay_send');
      return sheetMsg(gErr(error));
    }
    ls.set(KEY_PAY, JSON.stringify({ token, req: payStart.request_id, at: Date.now() }));
    closeSheet();
    toast(t('pay_pending_t'));
    await refreshGuest();
  }

  // ---------- เริ่มต้น ----------
  if (!qr) { $('#g-shop').textContent = 'SmartTable'; return showMsg(t('bad_link')); }
  const first = await scan(!staffMode);
  if (!first) return;
  if (!(await loadMenu())) return;
  $('#g-menu').hidden = false;

  // อัปเดตสถานะ + ที่สั่งแล้ว: ทุก 8 วินาทีถ้ามีอาหารกำลังทำ ไม่งั้นทุก 20 วินาที · โปรทุก 5 นาที
  const busy = () => (ticket() && !ticket().closed && !ticket().ready_at) || !!guestInfo && (guestInfo.orders.some(o => ['new', 'accepted', 'cooking'].includes(o.status))
                                     || (guestInfo.pay && guestInfo.pay.request && guestInfo.pay.request.status === 'pending'));
  let lastPoll = Date.now(), lastPromo = Date.now();
  setInterval(async () => {
    if (document.hidden) return;
    if (Date.now() - lastPoll >= (busy() ? 8000 : 20000)) { lastPoll = Date.now(); scan(false); }
    if (Date.now() - lastPromo >= 300000) { lastPromo = Date.now(); await loadPromos(); renderMenu(); }
  }, 2000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scan(false); });
})();
