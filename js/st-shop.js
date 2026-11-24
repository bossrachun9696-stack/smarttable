// ===== หน้า จัดการร้าน =====
(async function () {
  const { sb, configOk, $, esc, ROLE_TH, thaiError, pageUrl, showMsg, setBusy, requireUser, copyText, shrinkImage, getPrefs, setPrefs, avatarUrl, getSeen, markSeen } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('index.html'); });

  const shopId = new URLSearchParams(location.search).get('id');
  if (!shopId) return location.replace('home.html');

  const { data: shop, error: shopErr } = await sb.from('st_shops').select('*').eq('id', shopId).maybeSingle();
  if (shopErr) return showMsg(thaiError(shopErr));
  if (!shop) { $('#shop-name').textContent = 'ไม่พบร้าน'; return showMsg('ไม่พบร้านนี้ หรือคุณไม่ได้เป็นพนักงานของร้าน'); }

  const { data: me } = await sb.from('st_shop_members').select('role')
    .eq('shop_id', shopId).eq('user_id', user.id).maybeSingle();
  const role = me ? me.role : null;
  const isOwner = role === 'owner';
  const canManage = isOwner || role === 'manager';
  let current = shop;
  $('#link-reports').hidden = !canManage;
  $('#link-audit').hidden = !canManage;
  $('#link-promos').hidden = !canManage;
  $('#link-buffet').hidden = !(canManage && shop.shop_type === 'buffet');
  $('#link-easy').href = 'easy.html?id=' + encodeURIComponent(shopId);
  applyType(shop.shop_type || 'restaurant');
  // ประเภทร้านเปลี่ยนสิ่งที่เห็นในหน้านี้ (ไม่ลบข้อมูล)
  function applyType(type) {
    $('#link-buffet').hidden = !(canManage && type === 'buffet');
    $('#link-easy').hidden = type !== 'small';
    $('#link-audit').dataset.typeHidden = type === 'small' ? '1' : '';
    if (type === 'small') $('#link-audit').hidden = true;
    else $('#link-audit').hidden = !canManage;
    const staff = document.getElementById('staff-card');
    if (staff) staff.hidden = type === 'small';
    // ร้านคิว / ร้านขายของชำ: ไม่ใช้โต๊ะ/จอครัว (จัดการทุกอย่างที่หน้า "สั่งกลับบ้าน / คิว")
    const noTables = type === 'queue' || type === 'grocery';
    $('#link-tables').hidden = noTables;
    $('#link-orders').hidden = noTables;
    const qb = $('#link-queue .st-item-main b');
    if (qb) qb.textContent = type === 'grocery' ? 'ออร์เดอร์สินค้า / ส่งของ' : 'สั่งกลับบ้าน / คิว';
    const gc = document.getElementById('grocery-card');
    if (gc) gc.hidden = !(canManage && type === 'grocery');
    // ปิดกะ: เจ้าของ ผู้จัดการ แคชเชียร์ (+ เสิร์ฟ ถ้าร้านตั้ง)
    const sh = document.getElementById('link-shift');
    if (sh) sh.hidden = !(canManage || role === 'cashier' || (role === 'waiter' && ((current || shop).tool_cfg || {}).shift_waiter));
  }

  $('#my-role').textContent = 'คุณ: ' + (ROLE_TH[role] || '-');
  const renderHead = () => {
    $('#shop-name').textContent = current.name;
    $('#shop-sub').textContent = `ลิงก์ร้าน: ${current.slug} · ${current.is_open ? 'เปิดรับออร์เดอร์' : 'ปิดร้าน'}`
      + (current.status === 'suspended' ? ' · ถูกระงับ' : '');
    document.title = current.name + ' · SmartTable';
  };
  renderHead();
  $('#link-menu').href = 'menu.html?id=' + encodeURIComponent(shopId);
  $('#link-orders').href = 'orders.html?id=' + encodeURIComponent(shopId);
  $('#link-queue').href = 'queue.html?id=' + encodeURIComponent(shopId);
  $('#link-reports').href = 'reports.html?id=' + encodeURIComponent(shopId);
  $('#link-audit').href = 'audit.html?id=' + encodeURIComponent(shopId);
  $('#link-promos').href = 'promos.html?id=' + encodeURIComponent(shopId);
  $('#link-receipts').href = 'receipts.html?id=' + encodeURIComponent(shopId);
  $('#link-tables').href = 'tables.html?id=' + encodeURIComponent(shopId);
  $('#link-buffet').href = 'buffet.html?id=' + encodeURIComponent(shopId);
  $('#link-shift').href = 'shift.html?id=' + encodeURIComponent(shopId);
  $('#link-layout').href = 'settings.html?back=' + encodeURIComponent('shop.html?id=' + shopId);
  applyLayout(getPrefs().layout);
  $('#shop-body').hidden = false;

  // ---------- รูปแบบหน้า (ตั้งที่ ⚙️ ตั้งค่า): รายการ / ช่องใหญ่ / ไอคอน / แบ่งหมวด ----------
  // ลำดับปุ่ม (ตั้งเองได้ด้วยปุ่ม "จัดลำดับ" · จำไว้ในบัญชี)
  // (ใช้ function เพื่อให้เรียกได้ก่อนบรรทัดนี้ — applyLayout ถูกเรียกตั้งแต่ด้านบน)
  function linkOrder() {
    const type = (current && current.shop_type) || 'restaurant';
    const def = type === 'queue' || type === 'grocery' ? ['queue', 'orders', 'receipts', 'menu', 'shift', 'promos', 'reports', 'tables', 'easy', 'buffet', 'audit']
      : type === 'small' ? ['easy', 'menu', 'tables', 'receipts', 'shift', 'reports', 'orders', 'queue', 'promos', 'buffet', 'audit']
      : ['orders', 'tables', 'buffet', 'queue', 'receipts', 'shift', 'menu', 'promos', 'reports', 'audit', 'easy'];
    const saved = (getPrefs().order || []).filter(k => def.includes(k));
    return [...saved, ...def.filter(k => !saved.includes(k))];
  }
  function rank(a) { const i = linkOrder().indexOf(a.id.replace('link-', '')); return i < 0 ? 99 : i; }
  function applyLayout(layout) {
    const nav = $('#shop-links');
    const links = [...nav.querySelectorAll('a.st-item')].sort((x, y) => rank(x) - rank(y));
    nav.className = 'st-list st-links st-links--' + (['tiles', 'icons', 'groups'].includes(layout) ? layout : 'list');
    nav.querySelectorAll('.st-links-group').forEach(g => g.remove());
    if (layout !== 'groups') { links.forEach(a => nav.appendChild(a)); return; }
    const GROUPS = [
      ['งานหน้าร้าน', ['link-easy', 'link-orders', 'link-tables', 'link-queue', 'link-receipts', 'link-shift']],
      ['จัดการร้าน', ['link-menu', 'link-buffet', 'link-promos']],
      ['ตัวเลข', ['link-reports', 'link-audit']]
    ];
    for (const [title, ids] of GROUPS) {
      const box = document.createElement('div');
      box.className = 'st-links-group';
      box.innerHTML = `<h4>${title}</h4><div class="st-links-grid"></div>`;
      ids.map(id => document.getElementById(id)).filter(Boolean).sort((x, y) => rank(x) - rank(y)).forEach(a => box.lastChild.appendChild(a));
      if ([...box.querySelectorAll('a.st-item')].some(a => !a.hidden)) nav.appendChild(box);
      else links.filter(a => ids.includes(a.id)).forEach(a => nav.appendChild(a));
    }
  }

  // ---------- จัดลำดับปุ่ม ----------
  let editing = false;
  const nav = $('#shop-links');
  function moveControls(on) {
    nav.querySelectorAll('a.st-item').forEach(a => {
      a.querySelector('.st-move')?.remove();
      if (on) a.insertAdjacentHTML('beforeend', '<span class="st-move"><button type="button" data-mv="-1" aria-label="เลื่อนขึ้น">▲</button><button type="button" data-mv="1" aria-label="เลื่อนลง">▼</button></span>');
    });
  }
  $('#btn-reorder').addEventListener('click', async () => {
    editing = !editing;
    $('#btn-reorder').textContent = editing ? '✓ เสร็จ' : '↕️ จัดลำดับ';
    $('#btn-reorder').classList.toggle('st-chip--accent', editing);
    if (editing) {
      applyLayout('list');
      nav.classList.add('st-links--edit');
      moveControls(true);
      showMsg('กด ▲ ▼ เพื่อเลื่อนปุ่ม แล้วกด "✓ เสร็จ"', 'ok');
      return;
    }
    moveControls(false);
    nav.classList.remove('st-links--edit');
    const order = [...nav.querySelectorAll('a.st-item')].map(a => a.id.replace('link-', ''));
    setPrefs({ order });
    applyLayout(getPrefs().layout);
    const { error } = await sb.rpc('st_update_profile', { p: { prefs: { order } } });
    showMsg(error ? 'จัดลำดับในเครื่องนี้แล้ว (บันทึกในบัญชีไม่สำเร็จ)' : 'บันทึกลำดับแล้ว ✓', error ? 'error' : 'ok');
  });
  nav.addEventListener('click', (e) => {
    if (!editing) {
      const a = e.target.closest('a.st-item');
      if (a && ['link-receipts', 'link-audit', 'link-promos'].includes(a.id)) markSeen(shopId, { 'link-receipts': 'receipts', 'link-audit': 'audit', 'link-promos': 'coupons' }[a.id]);
      return;
    }
    e.preventDefault();
    const b = e.target.closest('[data-mv]');
    if (!b) return;
    const a = b.closest('a.st-item');
    const all = [...nav.querySelectorAll('a.st-item')].filter(x => !x.hidden);
    const i = all.indexOf(a), j = i + Number(b.dataset.mv);
    if (j < 0 || j >= all.length) return;
    if (Number(b.dataset.mv) < 0) all[j].before(a); else all[j].after(a);
    a.classList.add('st-moved'); setTimeout(() => a.classList.remove('st-moved'), 400);
  });

  // ---------- แจ้งเตือนรวม: ตัวเลขกะพริบบนปุ่ม จนกว่าจะมีคนจัดการ ----------
  const CALL_LABEL = { open: '🆕 ลูกค้าเปิดโต๊ะรอยืนยัน', call: '🙋 เรียกพนักงาน', bill: '🧾 ขอเช็กบิล', slip: '💸 สลิปรอตรวจ', coupon: '🎟 คูปอง' };
  function setBadge(id, n, urgent) {
    const a = document.getElementById(id);
    if (!a) return;
    const logo = a.querySelector('.st-logo');
    let b = logo.querySelector('.st-nbadge');
    if (!n) { b?.remove(); a.classList.remove('st-blink', 'st-has-badge'); return; }
    if (!b) { b = document.createElement('span'); b.className = 'st-nbadge'; logo.appendChild(b); }
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('st-nbadge--info', !urgent);
    a.classList.add('st-has-badge');
    a.classList.toggle('st-blink', !!urgent);
  }
  let lastUrgent = 0;
  async function loadAlerts() {
    const { data: a, error } = await sb.rpc('st_shop_alerts', { p_shop: shopId, p_since: getSeen(shopId) });
    if (error || !a) return;
    const c = a.calls || {};
    const tableCalls = (c.call || 0) + (c.bill || 0) + (c.slip || 0) + (c.open || 0);
    setBadge('link-orders', a.orders_new, true);
    setBadge('link-queue', a.takeaway_new, true);
    setBadge('link-tables', tableCalls, true);
    setBadge('link-promos', (c.coupon || 0) + (a.coupons || 0), !!c.coupon);
    setBadge('link-receipts', a.receipts, false);
    setBadge('link-audit', a.audit, false);
    const href = (page) => page + '.html?id=' + encodeURIComponent(shopId);
    const parts = [];
    if (a.orders_new) parts.push(`<a href="${href('orders')}">🔔 ออร์เดอร์ใหม่ <b>${a.orders_new}</b></a>`);
    if (a.takeaway_new) parts.push(`<a href="${href('queue')}">🛍 สั่งกลับบ้าน <b>${a.takeaway_new}</b></a>`);
    for (const k of ['open', 'call', 'bill', 'slip']) if (c[k]) parts.push(`<a href="${href('tables')}">${CALL_LABEL[k]} <b>${c[k]}</b></a>`);
    if (c.coupon && canManage) parts.push(`<a href="${href('promos')}">${CALL_LABEL.coupon} <b>${c.coupon}</b></a>`);
    else if (c.coupon) parts.push(`<a href="${href('tables')}">${CALL_LABEL.coupon} <b>${c.coupon}</b></a>`);
    $('#alert-sum').innerHTML = parts.join('');
    $('#alert-sum').hidden = !parts.length;
    const urgent = a.orders_new + a.takeaway_new + tableCalls + (c.coupon || 0);
    document.title = (urgent ? `(${urgent}) ` : '') + current.name + ' · SmartTable';
    lastUrgent = urgent;
  }
  let alertT;
  const alertSoon = () => { clearTimeout(alertT); alertT = setTimeout(loadAlerts, 600); };
  try {
    const ch = sb.channel('st-hub-' + shopId);
    for (const table of ['st_orders', 'st_service_calls', 'st_payments', 'st_table_sessions']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: 'shop_id=eq.' + shopId }, alertSoon);
    }
    ch.subscribe();
  } catch { /* ไม่มี Realtime ก็ดึงซ้ำเป็นระยะ */ }
  setInterval(() => { if (!document.hidden) loadAlerts(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAlerts(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) loadAlerts(); });
  loadAlerts();

  // ---------- ประเภทร้าน (เจ้าของ / ผู้จัดการ) ----------
  if (canManage && 'shop_type' in shop) {
    $('#type-card').hidden = false;
    const ft = $('#form-type');
    ft.querySelectorAll('[name=shop_type]').forEach(r => { r.checked = r.value === (current.shop_type || 'restaurant'); });
    ft.addEventListener('change', async (e) => {
      const r = e.target;
      if (r.name !== 'shop_type') return;
      const prev = current.shop_type || 'restaurant';
      const ASK = {
        buffet: 'เปลี่ยนเป็นร้านบุฟเฟ่ต์?\nลูกค้าจะสั่งได้หลังพนักงาน "เริ่มบุฟเฟ่ต์" ที่โต๊ะ (เลือกแพ็กเกจ + นับคน)\nอย่าลืมตั้งแพ็กเกจก่อน',
        queue: 'เปลี่ยนเป็นร้านน้ำ / สั่งแล้วรอคิว?\nระบบจะเปิด "สั่งกลับบ้าน / คิว" ให้ · พิมพ์ QR หน้าร้านได้ที่หน้า "สั่งกลับบ้าน / คิว"',
        grocery: 'เปลี่ยนเป็นร้านขายของชำ?\nลูกค้าสแกน QR หน้าร้าน → เลือกสินค้า → รับที่ร้าน หรือส่งถึงบ้าน\nระบบจะเปิด "สั่งกลับบ้าน / คิว" ให้ · ตั้งค่าส่งและตำแหน่งร้านในการ์ด "รับที่ร้าน / ส่งถึงบ้าน"',
        small: 'เปลี่ยนเป็นร้านเล็ก 2 คน (โหมดง่าย)?\nซ่อนเรื่องพนักงาน และให้ลูกค้าสแกนแล้วสั่งได้ทันที (ไม่ต้องรอเปิดโต๊ะ)\nพนักงานเดิมยังอยู่ ไม่ถูกลบ'
      };
      if (ASK[r.value] && !confirm(ASK[r.value])) { ft.querySelector(`[value="${prev}"]`).checked = true; return; }
      const { data, error } = await sb.from('st_shops').update({ shop_type: r.value }).eq('id', shopId).select().single();
      if (error) { ft.querySelector(`[value="${prev}"]`).checked = true; return showMsg(thaiError(error)); }
      current = data;
      // ร้านคิว: เปิดสั่งกลับบ้าน/คิว + สร้าง QR หน้าร้าน · ร้านเล็ก: ลูกค้าสแกนแล้วสั่งได้ทันที
      if ((current.shop_type === 'queue' || current.shop_type === 'grocery') && !current.takeaway_enabled) {
        const tk = await sb.rpc('st_takeaway_settings', { p_shop: shopId, p_enabled: true, p_preorder: !!current.preorder_enabled });
        if (!tk.error) current.takeaway_enabled = true;
      }
      if (current.shop_type === 'small' && current.order_mode !== 'instant') {
        const om = await sb.from('st_shops').update({ order_mode: 'instant' }).eq('id', shopId).select().single();
        if (!om.error) { current = om.data; const rr = document.querySelector(`#form-mode [value="instant"]`); if (rr) rr.checked = true; }
      }
      applyType(current.shop_type);
      applyLayout(getPrefs().layout);
      showMsg({ buffet: 'ตั้งเป็นร้านบุฟเฟ่ต์แล้ว → กด "แพ็กเกจบุฟเฟ่ต์" เพื่อตั้งราคาและเวลา',
                queue: 'ตั้งเป็นร้านคิวแล้ว → กด "สั่งกลับบ้าน / คิว" เพื่อพิมพ์ QR หน้าร้าน',
                grocery: 'ตั้งเป็นร้านขายของชำแล้ว → ตั้ง "รับที่ร้าน / ส่งถึงบ้าน" ด้านล่าง แล้วพิมพ์ QR หน้าร้านที่ "ออร์เดอร์สินค้า / ส่งของ"',
                small: 'ตั้งเป็นร้านเล็กแล้ว → กด "⚡ หน้าร้านรวม" ทำทุกอย่างในหน้าเดียว',
                restaurant: 'ตั้งเป็นร้านอาหารแล้ว' }[current.shop_type] || 'บันทึกแล้ว', 'ok');
    });
  }

  // ---------- ร้านขายของชำ: รับที่ร้าน / ส่งถึงบ้าน (รอบ M) ----------
  if (canManage) {
    const fg = $('#form-grocery');
    const G = () => current.grocery_cfg || {};
    const num = (v) => v === '' || v == null ? null : Number(v);
    function fillGrocery() {
      const g = G();
      fg.pickup.checked = g.pickup !== false;
      fg.delivery.checked = !!g.delivery;
      fg.need_phone.checked = g.need_phone !== false;
      ['lat', 'lng', 'max_km', 'fee_flat', 'fee_base', 'fee_per_km', 'fee_free_km', 'fee_cap', 'min_order', 'min_delivery', 'free_over', 'eta_min']
        .forEach(k => { fg[k].value = g[k] ?? ''; });
      fg.note.value = g.note || '';
      const m = fg.querySelector(`[name=fee_mode][value="${g.fee_mode || 'free'}"]`);
      if (m) m.checked = true;
      groceryUi();
    }
    function groceryUi() {
      $('#gc-delivery').hidden = !fg.delivery.checked;
      const mode = (fg.querySelector('[name=fee_mode]:checked') || {}).value || 'free';
      fg.querySelectorAll('[data-fee]').forEach(d => { d.hidden = d.dataset.fee !== mode; });
      const lat = num(fg.lat.value), lng = num(fg.lng.value);
      $('#gc-loc-text').textContent = lat != null && lng != null ? `ตั้งแล้ว: ${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'ยังไม่ได้ตั้ง — ต้องตั้งก่อนจึงส่งถึงบ้านได้';
      const map = $('#gc-map');
      map.hidden = !(lat != null && lng != null);
      if (!map.hidden) map.href = `https://www.google.com/maps?q=${lat},${lng}`;
      // ตัวอย่างค่าส่ง
      const ex = (km) => {
        let f = 0;
        if (mode === 'flat') f = num(fg.fee_flat.value) || 0;
        if (mode === 'per_km') {
          f = (num(fg.fee_base.value) || 0) + Math.max(0, Math.ceil(km - (num(fg.fee_free_km.value) || 0))) * (num(fg.fee_per_km.value) || 0);
          if (num(fg.fee_cap.value) != null) f = Math.min(f, num(fg.fee_cap.value));
        }
        return f;
      };
      $('#gc-example').textContent = fg.delivery.checked
        ? `ตัวอย่างค่าส่ง: 1 กม. ฿${ex(1)} · 3 กม. ฿${ex(3)} · 5 กม. ฿${ex(5)}${num(fg.free_over.value) ? ` · ซื้อครบ ฿${num(fg.free_over.value)} ส่งฟรี` : ''} · ไกลเกิน ${num(fg.max_km.value) || 5} กม. = ให้มารับเอง`
        : '';
    }
    fg.addEventListener('input', groceryUi);
    fg.addEventListener('change', groceryUi);
    $('#gc-here').addEventListener('click', () => {
      if (!navigator.geolocation) return showMsg('เครื่องนี้หาตำแหน่งไม่ได้ — ใส่พิกัดเอง');
      $('#gc-here').disabled = true;
      navigator.geolocation.getCurrentPosition((pos) => {
        $('#gc-here').disabled = false;
        fg.lat.value = pos.coords.latitude.toFixed(6);
        fg.lng.value = pos.coords.longitude.toFixed(6);
        groceryUi();
        showMsg(`ได้ตำแหน่งแล้ว (คลาดเคลื่อนประมาณ ${Math.round(pos.coords.accuracy)} ม.) → กด "บันทึก"`, 'ok');
      }, (err) => {
        $('#gc-here').disabled = false;
        showMsg(err.code === 1 ? 'ไม่ได้อนุญาตตำแหน่ง — iPhone: ตั้งค่า → ความเป็นส่วนตัว → บริการหาตำแหน่ง → Safari → "ขณะใช้แอป"' : 'หาตำแหน่งไม่สำเร็จ ลองใหม่ หรือใส่พิกัดเอง');
      }, { enableHighAccuracy: true, timeout: 15000 });
    });
    fg.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cfg = {
        pickup: fg.pickup.checked, delivery: fg.delivery.checked, need_phone: fg.need_phone.checked,
        fee_mode: (fg.querySelector('[name=fee_mode]:checked') || {}).value || 'free',
        lat: num(fg.lat.value), lng: num(fg.lng.value), note: fg.note.value.trim()
      };
      ['max_km', 'fee_flat', 'fee_base', 'fee_per_km', 'fee_free_km', 'fee_cap', 'min_order', 'min_delivery', 'free_over', 'eta_min']
        .forEach(k => { cfg[k] = num(fg[k].value); });
      if (!cfg.pickup && !cfg.delivery) return showMsg('ต้องเปิดอย่างน้อย 1 แบบ: มารับที่ร้าน หรือ ส่งถึงบ้าน');
      if (cfg.delivery && (cfg.lat == null || cfg.lng == null)) return showMsg('ส่งถึงบ้านต้องตั้งตำแหน่งร้านก่อน');
      setBusy(fg, true);
      const { data, error } = await sb.rpc('st_save_grocery_cfg', { p_shop: shopId, p_cfg: cfg });
      setBusy(fg, false);
      if (error) return showMsg(thaiError(error));
      current.grocery_cfg = data;
      showMsg('บันทึกการรับ/ส่งแล้ว ✓', 'ok');
    });
    if ('grocery_cfg' in shop) fillGrocery();
  }

  // ---------- ตั้งค่าเพิ่มเติม: ขายพ่วง คอมโบ ปิดกะ ต้นทุน การพิมพ์ (รอบ M · บันทึกทันที) ----------
  if (canManage && 'tool_cfg' in shop) {
    const ftl = $('#form-tools');
    $('#tools-card').hidden = false;
    const T = () => current.tool_cfg || {};
    function fillTools() {
      const t = T(), p = t.print || {};
      const um = ftl.querySelector(`[name=upsell_mode][value="${t.upsell_mode || 'auto'}"]`);
      if (um) um.checked = true;
      ftl.upsell_max.value = String(t.upsell_max || 3);
      ftl.upsell_days.value = String(t.upsell_days || 60);
      ftl.combo_save.checked = t.combo_save !== false;
      ftl.combo_stock.checked = !!t.combo_stock;
      ftl.shift_required.checked = !!t.shift_required;
      ftl.shift_waiter.checked = !!t.shift_waiter;
      ftl.shift_blind.checked = !!t.shift_blind;
      ftl.cost_fallback.checked = t.cost_fallback !== false;
      ftl.togo_service.checked = !!t.togo_service;
      ftl.p_paper.value = p.paper || '58';
      ftl.p_font.value = p.font || 'm';
      ftl.p_copies.value = String(p.copies || 1);
      ftl.p_kitchen_big.checked = p.kitchen_big !== false;
      ftl.p_kitchen_price.checked = !!p.kitchen_price;
      ftl.p_header.value = p.header || '';
      ftl.p_footer.value = p.footer || '';
    }
    let tt = 0;
    async function saveTools(key) {
      const cfg = key === 'print' ? { print: {
          paper: ftl.p_paper.value, font: ftl.p_font.value, copies: Number(ftl.p_copies.value),
          kitchen_big: ftl.p_kitchen_big.checked, kitchen_price: ftl.p_kitchen_price.checked,
          header: ftl.p_header.value.trim(), footer: ftl.p_footer.value.trim() } }
        : key === 'upsell_mode' ? { upsell_mode: (ftl.querySelector('[name=upsell_mode]:checked') || {}).value || 'auto' }
        : ['upsell_max', 'upsell_days'].includes(key) ? { [key]: Number(ftl[key].value) }
        : { [key]: ftl[key].checked };
      const { data, error } = await sb.rpc('st_save_tool_cfg', { p_shop: shopId, p_cfg: cfg });
      if (error) { fillTools(); return showMsg(thaiError(error)); }
      current.tool_cfg = data;
      showMsg('บันทึกแล้ว ✓', 'ok');
    }
    ftl.addEventListener('change', (e) => {
      const n = e.target.name || '';
      if (n.startsWith('p_')) { if (e.target.type !== 'text') saveTools('print'); return; }
      if (n === 'togo_service') {               // รอบ P
        sb.rpc('st_set_togo_service', { p_shop: shopId, p_on: e.target.checked }).then(({ data, error }) => {
          if (error) { e.target.checked = !e.target.checked; return showMsg(thaiError(error)); }
          current.tool_cfg = data; showMsg('บันทึกแล้ว ✓', 'ok');
        });
        return;
      }
      saveTools(n);
    });
    ftl.addEventListener('input', (e) => {
      if (!['p_header', 'p_footer'].includes(e.target.name)) return;
      clearTimeout(tt); tt = setTimeout(() => saveTools('print'), 900);
    });
    fillTools();
  }

  // ---------- รูปแบบการสั่งอาหาร (บันทึกทันทีเมื่อเลือก) ----------
  const fm = $('#form-mode');
  fm.querySelectorAll('input[name=order_mode]').forEach(r => {
    r.checked = r.value === current.order_mode;
    r.disabled = !canManage;
    r.addEventListener('change', async () => {
      const { data, error } = await sb.from('st_shops').update({ order_mode: r.value })
        .eq('id', shopId).select().single();
      if (error) {
        fm.querySelector(`[value="${current.order_mode}"]`).checked = true;
        return showMsg(thaiError(error));
      }
      current = data;
      showMsg(r.value === 'confirm' ? 'บันทึกแล้ว — ลูกค้าสแกนแล้วเปิดโต๊ะรอไว้ ร้านกด ✓ ยืนยัน ที่ผังโต๊ะ / จอออร์เดอร์ แล้วลูกค้าจึงสั่งได้' : 'บันทึกรูปแบบการสั่งอาหารแล้ว', 'ok');
    });
  });

  // ---------- ข้อมูลร้าน ----------
  const fs = $('#form-shop');
  const fillShop = () => {
    fs.shop_name.value = current.name || '';
    fs.phone.value = current.phone || '';
    fs.address.value = current.address || '';
    fs.promptpay_id.value = current.promptpay_id || '';
    fs.service_pct.value = Number(current.service_pct || 0);
    fs.vat_pct.value = Number(current.vat_pct || 0);
    fs.vat_included.checked = !!current.vat_included;
    fs.self_pay.checked = !!current.self_pay;
    fs.shared_cart.checked = current.shared_cart !== false;
    fs.tax_id.value = current.tax_id || '';
    fs.tax_name.value = current.tax_name || '';
    fs.tax_branch.value = current.tax_branch || '';
    fs.pos_id.value = current.pos_id || '';
    $('#tax-state').textContent = current.tax_id ? (Number(current.vat_pct) > 0 ? '· เปิดใช้อยู่' : '· ต้องตั้ง VAT ก่อน') : '· ปิดอยู่';
  };
  // ตรวจเลขผู้เสียภาษี 13 หลัก (หลักสุดท้ายเป็นเลขตรวจสอบ)
  const taxIdOk = (id) => {
    if (!/^\d{13}$/.test(id)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
    return (11 - (sum % 11)) % 10 === Number(id[12]);
  };
  fillShop();
  if (!canManage) {
    fs.querySelectorAll('input').forEach(el => el.disabled = true);
    fs.querySelector('button[type=submit]').hidden = true;
  }

  fs.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pct = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
    const payload = {
      name: fs.shop_name.value.trim(),
      phone: fs.phone.value.trim() || null,
      address: fs.address.value.trim() || null,
      promptpay_id: fs.promptpay_id.value.replace(/\D/g, '') || null,
      service_pct: pct(fs.service_pct.value),
      vat_pct: pct(fs.vat_pct.value),
      vat_included: fs.vat_included.checked,
      self_pay: fs.self_pay.checked,
      shared_cart: fs.shared_cart.checked,
      tax_id: fs.tax_id.value.replace(/\D/g, '') || null,
      tax_name: fs.tax_name.value.trim() || null,
      tax_branch: fs.tax_branch.value.trim() || null,
      pos_id: fs.pos_id.value.trim() || null
    };
    if (payload.self_pay && !payload.promptpay_id) return showMsg('ให้ลูกค้าจ่ายเองได้ ต้องใส่เลขพร้อมเพย์ก่อน');
    if (payload.tax_id && payload.tax_id.length !== 13) return showMsg('เลขผู้เสียภาษีต้องมี 13 หลัก');
    if (payload.tax_id && !taxIdOk(payload.tax_id) && !confirm('เลขผู้เสียภาษีนี้อาจพิมพ์ผิด (เลขตรวจสอบไม่ตรง) บันทึกต่อไหม?')) return;
    const taxWarn = payload.tax_id && !(payload.vat_pct > 0) ? ' · VAT ยังเป็น 0% ใบเสร็จจะยังไม่เป็นใบกำกับภาษี' : '';
    if (!payload.name) return showMsg('กรุณาใส่ชื่อร้าน');
    if (payload.promptpay_id && !/^\d{10,15}$/.test(payload.promptpay_id)) return showMsg('พร้อมเพย์ต้องเป็นตัวเลข 10–15 หลัก');
    if ([payload.service_pct, payload.vat_pct].some(n => n < 0 || n > 30)) return showMsg('ค่าบริการและ VAT ต้องอยู่ระหว่าง 0–30%');

    setBusy(fs, true, 'กำลังบันทึก…');
    const { data, error } = await sb.from('st_shops').update(payload).eq('id', shopId).select().single();
    setBusy(fs, false);
    if (error) return showMsg(thaiError(error));
    current = data; fillShop(); renderHead();
    showMsg('บันทึกข้อมูลร้านแล้ว' + taxWarn, 'ok');
  });

  // ---------- หน้าตาร้าน: โลโก้ / รูปปก / สี ----------
  const imgUrl = (path) => sb.storage.from('st-images').getPublicUrl(path).data.publicUrl;
  const COLORS = ['#E4572E', '#C0392B', '#D4537E', '#8E44AD', '#2F6FD6', '#0F8B8D', '#2F7D5B', '#B7791F', '#5D4037', '#222222'];
  function renderBrand() {
    const set = (box, del, path, label) => {
      box.innerHTML = path ? `<img src="${esc(imgUrl(path))}" alt="">` : label;
      del.hidden = !path || !canManage;
    };
    set($('#logo-box'), $('#logo-del'), current.logo_path, 'โลโก้');
    set($('#cover-box'), $('#cover-del'), current.cover_path, 'รูปปก (แนวนอน)');
    const cur = (current.theme_color || '#E4572E').toUpperCase();
    $('#swatches').innerHTML = COLORS.map(c => `<button type="button" data-color="${c}" style="background:${c}"
        aria-label="สี ${c}" aria-pressed="${c === cur}"${canManage ? '' : ' disabled'}></button>`).join('')
      + (canManage ? `<label class="st-swatch-custom" title="เลือกสีเอง"><input type="color" value="${cur.toLowerCase()}"> อื่น ๆ</label>` : '');
  }
  async function saveBrand(patch, okText) {
    const { data, error } = await sb.from('st_shops').update(patch).eq('id', shopId).select().single();
    if (error) { showMsg(thaiError(error)); return false; }
    current = data; renderBrand(); showMsg(okText, 'ok');
    return true;
  }
  async function uploadBrand(file, kind) {
    const blob = await shrinkImage(file, kind === 'logo' ? 512 : 1600, 0.85);
    const path = `shops/${shopId}/brand/${kind}-${Date.now()}.jpg`;
    const { error } = await sb.storage.from('st-images').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (error) return showMsg('อัปโหลดไม่สำเร็จ: ' + thaiError(error));
    const old = current[kind + '_path'];
    if (await saveBrand({ [kind + '_path']: path }, kind === 'logo' ? 'เปลี่ยนโลโก้แล้ว' : 'เปลี่ยนรูปปกแล้ว') && old) {
      sb.storage.from('st-images').remove([old]);
    }
  }
  renderBrand();
  if (!canManage) {
    $('#brand-card').querySelectorAll('label.st-chip').forEach(l => { l.hidden = true; });
  } else {
    for (const kind of ['logo', 'cover']) {
      $(`#${kind}-input`).addEventListener('change', async (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (f) { try { await uploadBrand(f, kind); } catch { showMsg('อ่านรูปนี้ไม่ได้ ลองรูปอื่น'); } }
      });
      $(`#${kind}-del`).addEventListener('click', async () => {
        const old = current[kind + '_path'];
        if (!old || !confirm('ลบรูปนี้?')) return;
        if (await saveBrand({ [kind + '_path']: null }, 'ลบรูปแล้ว')) sb.storage.from('st-images').remove([old]);
      });
    }
    $('#swatches').addEventListener('click', (e) => {
      const b = e.target.closest('[data-color]');
      if (b) saveBrand({ theme_color: b.dataset.color }, 'เปลี่ยนสีร้านแล้ว');
    });
    $('#swatches').addEventListener('change', (e) => {
      if (e.target.type === 'color') saveBrand({ theme_color: e.target.value.toUpperCase() }, 'เปลี่ยนสีร้านแล้ว');
    });
  }

  // ภาษาสำหรับลูกค้า
  const langBoxes = [...document.querySelectorAll('#brand-card [data-lang]')];
  langBoxes.forEach(b => { b.checked = (current.languages || []).includes(b.dataset.lang); b.disabled = !canManage; });
  langBoxes.forEach(b => b.addEventListener('change', () => {
    const langs = langBoxes.filter(x => x.checked).map(x => x.dataset.lang);
    saveBrand({ languages: langs }, langs.length ? 'เปิดภาษาแล้ว — ใส่คำแปลได้ที่หน้าเมนูอาหาร' : 'ปิดภาษาอื่นแล้ว');
  }));

  // ---------- พนักงาน ----------
  const assignable = isOwner ? ['manager', 'cashier', 'kitchen', 'waiter'] : ['cashier', 'kitchen', 'waiter'];

  async function loadMembers() {
    const [{ data, error }, extra] = await Promise.all([
      sb.rpc('st_list_members', { p_shop: shopId }),
      sb.rpc('st_member_profiles', { p_shop: shopId })        // รูป + ไอดี (st-14)
    ]);
    if (error) return showMsg(thaiError(error));
    const xp = (extra && extra.data) || {};
    $('#member-list').innerHTML = data.map(m => {
      const self = m.user_id === user.id;
      const editable = !self && m.role !== 'owner' && (isOwner || (role === 'manager' && m.role !== 'manager'));
      const opts = assignable.map(r => `<option value="${r}"${r === m.role ? ' selected' : ''}>${ROLE_TH[r]}</option>`).join('');
      const name = m.display_name || 'ไม่มีชื่อ';
      return `
        <div class="st-item" data-user="${esc(m.user_id)}" data-name="${esc(name)}">
          <div class="st-logo st-logo--round">${xp[m.user_id] && xp[m.user_id].avatar_path
            ? `<img src="${esc(avatarUrl(xp[m.user_id].avatar_path))}" alt="">`
            : esc((m.display_name || m.email).charAt(0).toUpperCase())}</div>
          <div class="st-item-main"><b>${esc(name)}${self ? ' (คุณ)' : ''}</b><small>${xp[m.user_id] && xp[m.user_id].public_id ? '@' + esc(xp[m.user_id].public_id) + ' · ' : ''}${esc(m.email)}</small></div>
          ${editable
            ? `<select data-act="role" aria-label="ตำแหน่ง">${opts}</select>
               <button type="button" class="st-icon-btn" data-act="remove" aria-label="นำออกจากร้าน">✕</button>`
            : `<span class="st-badge">${esc(ROLE_TH[m.role] || m.role)}</span>`}
        </div>`;
    }).join('');
  }

  $('#member-list').addEventListener('change', async (e) => {
    if (e.target.dataset.act !== 'role') return;
    const row = e.target.closest('[data-user]');
    const { error } = await sb.rpc('st_set_member_role',
      { p_shop: shopId, p_user: row.dataset.user, p_role: e.target.value });
    if (error) showMsg(thaiError(error)); else showMsg('เปลี่ยนตำแหน่งแล้ว', 'ok');
    loadMembers();
  });

  $('#member-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="remove"]');
    if (!btn) return;
    const row = btn.closest('[data-user]');
    if (!confirm(`นำ ${row.dataset.name} ออกจากร้าน?`)) return;
    const { error } = await sb.rpc('st_remove_member', { p_shop: shopId, p_user: row.dataset.user });
    if (error) return showMsg(thaiError(error));
    showMsg('นำออกจากร้านแล้ว', 'ok');
    loadMembers();
  });

  await loadMembers();

  // ---------- คำเชิญ (เจ้าของ / ผู้จัดการ) ----------
  const inviteUrl = (token) => pageUrl('invite.html') + '?t=' + encodeURIComponent(token);
  let lastInvite = null;

  async function shareInvite(inv) {
    const url = inviteUrl(inv.token);
    // ใส่ลิงก์ไว้ในข้อความเลย (ไม่แยกเป็น url) ไม่งั้นบางแอป/ปุ่ม "คัดลอก" บน iPhone จะได้แต่ข้อความ ไม่มีลิงก์
    const text = `เชิญคุณเป็น${ROLE_TH[inv.role]}ที่ร้าน ${current.name} บน SmartTable\n${url}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'คำเชิญเข้าร้าน ' + current.name, text }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
    if (await copyText(text)) showMsg('คัดลอกข้อความเชิญพร้อมลิงก์แล้ว วางส่งให้พนักงานทาง DarkChat หรือ LINE ได้เลย', 'ok');
    else showMsg('คัดลอกไม่ได้ กรุณากดค้างที่ลิงก์แล้วคัดลอกเอง');
  }

  async function loadInvites() {
    const { data, error } = await sb.from('st_shop_invites')
      .select('id, email, role, token, expires_at')
      .eq('shop_id', shopId).is('accepted_at', null).is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (error) return showMsg(thaiError(error));
    const box = $('#invite-list');
    if (!data.length) { box.innerHTML = '<p class="st-sub">ไม่มีคำเชิญค้าง</p>'; return; }
    box.innerHTML = data.map(i => `
      <div class="st-item" data-id="${esc(i.id)}" data-token="${esc(i.token)}" data-role="${esc(i.role)}">
        <div class="st-item-main"><b>${esc(i.email)}${i.email.startsWith('@') ? ' <small class="st-badge st-badge--muted">ไอดี</small>' : ''}</b>
          <small>${esc(ROLE_TH[i.role])} · หมดอายุ ${new Date(i.expires_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</small></div>
        <button type="button" class="st-chip" data-act="share">ส่งลิงก์</button>
        <button type="button" class="st-icon-btn" data-act="revoke" aria-label="ยกเลิกคำเชิญ">✕</button>
      </div>`).join('');
  }

  if (canManage) {
    const fi = $('#form-invite');
    fi.role.innerHTML = assignable.map(r => `<option value="${r}">${ROLE_TH[r]}</option>`).join('');
    fi.role.value = 'waiter';
    $('#invite-box').hidden = false;

    // ----- เชิญด้วยไอดี / อีเมล -----
    const fid = $('#form-invite-id');
    fid.role.innerHTML = fi.role.innerHTML;
    fid.role.value = 'waiter';
    $('#invite-by').addEventListener('click', (e) => {
      const b = e.target.closest('[data-by]');
      if (!b) return;
      document.querySelectorAll('#invite-by button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
      fid.hidden = b.dataset.by !== 'id';
      fi.hidden = b.dataset.by !== 'email';
      $('#invite-result').hidden = true;
    });
    let found = null, ft;
    fid.public_id.addEventListener('input', () => {
      const v = fid.public_id.value.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_.]/g, '');
      if (v !== fid.public_id.value) fid.public_id.value = v;
      found = null;
      clearTimeout(ft);
      const box = $('#id-found');
      if (v.length < 4) { box.hidden = true; return; }
      ft = setTimeout(async () => {
        const { data } = await sb.rpc('st_find_user', { p_public_id: v });
        if (fid.public_id.value !== v) return;
        found = data;
        box.hidden = false;
        box.className = 'st-found' + (data ? '' : ' st-found--none');
        box.innerHTML = data
          ? `<span class="st-avatar st-avatar--sm">${data.avatar_path ? `<img src="${esc(avatarUrl(data.avatar_path))}" alt="">` : esc((data.display_name || data.public_id).charAt(0).toUpperCase())}</span>
             <span><b>${esc(data.display_name || 'ไม่มีชื่อ')}</b><small>@${esc(data.public_id)} · พบผู้ใช้นี้ ✓</small></span>`
          : '<span>ไม่พบไอดีนี้ ตรวจตัวสะกดอีกครั้ง</span>';
      }, 350);
    });
    fid.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = fid.public_id.value.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_.]{3,19}$/.test(v)) return showMsg(thaiError({ message: 'st_bad_public_id' }));
      setBusy(fid, true, 'กำลังส่งคำเชิญ…');
      const { data, error } = await sb.rpc('st_invite_staff_by_id', { p_shop: shopId, p_public_id: v, p_role: fid.role.value });
      setBusy(fid, false);
      if (error) return showMsg(thaiError(error));
      lastInvite = data;
      $('#invite-url').value = inviteUrl(data.token);
      $('#invite-result').hidden = false;
      showMsg(`ส่งคำเชิญถึง @${v}${found && found.display_name ? ' (' + found.display_name + ')' : ''} แล้ว — ขึ้นที่หน้า "ร้านของฉัน" ของเขา หรือส่งลิงก์ด้านล่างให้ก็ได้`, 'ok');
      fid.public_id.value = ''; $('#id-found').hidden = true; found = null;
      loadInvites();
    });

    fi.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = fi.email.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showMsg(thaiError({ message: 'st_bad_email' }));
      setBusy(fi, true, 'กำลังสร้างลิงก์…');
      const { data, error } = await sb.rpc('st_invite_staff', { p_shop: shopId, p_email: email, p_role: fi.role.value });
      setBusy(fi, false);
      if (error) return showMsg(thaiError(error));
      lastInvite = data;
      $('#invite-url').value = inviteUrl(data.token);
      $('#invite-result').hidden = false;
      fi.email.value = '';
      showMsg(`สร้างลิงก์คำเชิญสำหรับ ${email} แล้ว`, 'ok');
      loadInvites();
    });

    $('#invite-url').addEventListener('focus', (e) => e.target.select());
    $('#btn-copy').addEventListener('click', async () => {
      if (await copyText($('#invite-url').value)) showMsg('คัดลอกลิงก์แล้ว ส่งให้พนักงานทาง LINE ได้เลย', 'ok');
      else { $('#invite-url').select(); showMsg('กดค้างที่ลิงก์แล้วเลือกคัดลอก'); }
    });
    $('#btn-share').addEventListener('click', () => lastInvite && shareInvite(lastInvite));

    $('#invite-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const row = btn.closest('[data-id]');
      if (btn.dataset.act === 'share') return shareInvite({ token: row.dataset.token, role: row.dataset.role });
      if (!confirm('ยกเลิกคำเชิญนี้? ลิงก์เดิมจะใช้ไม่ได้')) return;
      const { error } = await sb.rpc('st_revoke_invite', { p_invite: row.dataset.id });
      if (error) return showMsg(thaiError(error));
      showMsg('ยกเลิกคำเชิญแล้ว', 'ok');
      loadInvites();
    });

    await loadInvites();
  }

  // ---------- ลบร้าน (เจ้าของ) ----------
  // ลบไฟล์ใน Storage ก่อน (รูปเมนู โลโก้ สลิป) แล้วค่อยลบข้อมูลในฐานข้อมูล
  async function listAll(bucket, prefix) {
    const out = [];
    const walk = async (dir, depth) => {
      if (depth > 4) return;
      for (let offset = 0; offset < 5000; offset += 100) {
        const { data, error } = await sb.storage.from(bucket).list(dir, { limit: 100, offset });
        if (error || !data || !data.length) return;
        for (const f of data) {
          const path = dir + '/' + f.name;
          if (f.id) out.push(path); else await walk(path, depth + 1);
        }
        if (data.length < 100) return;
      }
    };
    await walk(prefix, 0);
    return out;
  }
  if (isOwner) {
    $('#danger-card').hidden = false;
    $('#btn-delete-shop').addEventListener('click', async () => {
      const typed = prompt(`ลบร้าน "${current.name}" ถาวร กู้คืนไม่ได้\nพิมพ์ชื่อร้านให้ตรงเพื่อยืนยัน:`);
      if (typed === null) return;
      if (typed.trim() !== current.name.trim()) return showMsg(thaiError({ message: 'st_confirm_name' }));
      const btn = $('#btn-delete-shop');
      btn.disabled = true; btn.textContent = 'กำลังลบรูปและไฟล์…';
      try {
        for (const bucket of ['st-images', 'st-slips']) {
          const files = await listAll(bucket, 'shops/' + shopId);
          for (let i = 0; i < files.length; i += 100) await sb.storage.from(bucket).remove(files.slice(i, i + 100));
        }
      } catch { /* ลบไฟล์ไม่ครบไม่เป็นไร ลบข้อมูลต่อ */ }
      btn.textContent = 'กำลังลบข้อมูลร้าน…';
      const { error } = await sb.rpc('st_delete_shop', { p_shop: shopId, p_confirm_name: typed.trim() });
      if (error) { btn.disabled = false; btn.textContent = 'ลบร้านนี้…'; return showMsg(thaiError(error)); }
      alert(`ลบร้าน "${current.name}" แล้ว`);
      location.replace('home.html');
    });
  }

  // ---------- ออกจากร้าน (ไม่ใช่เจ้าของ) ----------
  if (role && !isOwner) {
    const leave = $('#btn-leave');
    leave.hidden = false;
    leave.addEventListener('click', async () => {
      if (!confirm(`ออกจากร้าน ${current.name}? ต้องให้ร้านเชิญใหม่ถึงจะกลับมาได้`)) return;
      const { error } = await sb.rpc('st_remove_member', { p_shop: shopId, p_user: user.id });
      if (error) return showMsg(thaiError(error));
      location.replace('home.html');
    });
  }

  // ---------- รอบ N: เปิด/ปิดร้าน + ตั้งเวลา ----------
  const DAYS = [['1', 'จันทร์'], ['2', 'อังคาร'], ['3', 'พุธ'], ['4', 'พฤหัสฯ'], ['5', 'ศุกร์'], ['6', 'เสาร์'], ['0', 'อาทิตย์']];
  const fh = $('#form-hours');
  function hoursText(h) {
    if (!h || !h.auto) return 'เปิด/ปิดเอง';
    const d = String(new Date().getDay());
    const t = h.days && h.days[d];
    return '⏰ อัตโนมัติ · วันนี้ ' + (t && t.on ? `${t.open}–${t.close}` : 'ปิดทั้งวัน');
  }
  function renderOpen() {
    $('#open-now').checked = !!current.is_open;
    $('#open-text').textContent = current.is_open ? '🟢 เปิดร้านอยู่' : '🔴 ปิดร้านอยู่';
    $('#open-sub').textContent = hoursText(current.hours);
    renderHead();
  }
  function fillHours() {
    const h = current.hours || {};
    fh.auto.checked = !!h.auto;
    $('#hours-days').innerHTML = DAYS.map(([k, n]) => {
      const d = (h.days && h.days[k]) || { on: true, open: '09:00', close: '21:00' };
      return `<div class="st-hour-row" data-d="${k}">
        <label class="st-check"><input type="checkbox" data-h="on"${d.on ? ' checked' : ''}> <span>${n}</span></label>
        <input type="time" data-h="open" value="${esc(d.open)}" aria-label="เปิด ${n}">
        <span aria-hidden="true">–</span>
        <input type="time" data-h="close" value="${esc(d.close)}" aria-label="ปิด ${n}">
      </div>`;
    }).join('');
    hoursUi();
  }
  function hoursUi() {
    $('#hours-days').classList.toggle('st-off', !fh.auto.checked);
    $('#hours-days').querySelectorAll('.st-hour-row').forEach(r => {
      const on = r.querySelector('[data-h=on]').checked;
      r.querySelectorAll('input[type=time]').forEach(i => { i.disabled = !on || !fh.auto.checked || !canManage; });
    });
  }
  if ('hours' in shop) {
    fillHours();
    renderOpen();
    if (!canManage) {
      $('#open-now').disabled = true;
      fh.querySelectorAll('input,button').forEach(el => { el.disabled = true; });
    }
    fh.addEventListener('change', hoursUi);
    $('#hours-copy').addEventListener('click', () => {
      const mon = $('#hours-days').querySelector('[data-d="1"]');
      $('#hours-days').querySelectorAll('.st-hour-row').forEach(r => {
        r.querySelector('[data-h=open]').value = mon.querySelector('[data-h=open]').value;
        r.querySelector('[data-h=close]').value = mon.querySelector('[data-h=close]').value;
      });
    });
    $('#open-now').addEventListener('change', async (e) => {
      const want = e.target.checked;
      if (!want && !confirm('ปิดร้านตอนนี้? ลูกค้าจะสแกน QR สั่งไม่ได้')) { e.target.checked = true; return; }
      const { data, error } = await sb.rpc('st_set_shop_open', { p_shop: shopId, p_open: want });
      if (error) { e.target.checked = !want; return showMsg(thaiError(error)); }
      current.is_open = data.is_open;
      renderOpen();
      showMsg((data.is_open ? 'เปิดร้านแล้ว ✓' : 'ปิดร้านแล้ว') + (data.auto && data.scheduled !== data.is_open ? ' · ตั้งเวลาไว้ ระบบจะเปลี่ยนเองอีกครั้งตอนถึงเวลาเปิด/ปิดรอบถัดไป' : ''), 'ok');
    });
    fh.addEventListener('submit', async (e) => {
      e.preventDefault();
      const days = {};
      for (const r of $('#hours-days').querySelectorAll('.st-hour-row')) {
        const o = r.querySelector('[data-h=open]').value, c = r.querySelector('[data-h=close]').value;
        const on = r.querySelector('[data-h=on]').checked;
        if (on && (!o || !c || o === c)) return showMsg('ใส่เวลาเปิดและปิดให้ครบ (เวลาเปิดกับปิดต้องไม่เท่ากัน)');
        days[r.dataset.d] = { on, open: o || '09:00', close: c || '21:00' };
      }
      if (fh.auto.checked && !Object.values(days).some(d => d.on)) return showMsg('ติ๊กอย่างน้อย 1 วันที่เปิด');
      setBusy(fh, true);
      const { data, error } = await sb.rpc('st_save_shop_hours', { p_shop: shopId, p_hours: { auto: fh.auto.checked, days } });
      setBusy(fh, false);
      if (error) return showMsg(thaiError(error));
      current.hours = data.hours; current.is_open = data.is_open;
      renderOpen();
      showMsg(fh.auto.checked ? `บันทึกเวลาแล้ว ✓ ตอนนี้ร้าน${data.is_open ? 'เปิด' : 'ปิด'}ตามเวลา` : 'บันทึกแล้ว ✓ (เปิด/ปิดเอง)', 'ok');
    });
  } else {
    $('#hours-card').hidden = true;
  }

  // ---------- รอบ N: ล้างข้อมูลร้าน (เจ้าของ + รหัสผ่าน) ----------
  if (isOwner) {
    const fr = $('#form-reset');
    $('#reset-card').hidden = false;
    $('#reset-email').textContent = '(' + (user.email || '') + ')';
    $('#reset-export').href = 'reports.html?id=' + encodeURIComponent(shopId);
    const KIND_TH = { sales: 'ประวัติการขาย', shifts: 'ประวัติปิดกะ', audit: 'ประวัติการทำงาน', menu: 'เมนูอาหาร/สินค้า', tables: 'โต๊ะและ QR', promos: 'โปรโมชันและคูปอง', buffet: 'แพ็กเกจบุฟเฟ่ต์' };
    fr.addEventListener('submit', async (e) => {
      e.preventDefault();
      const kinds = [...fr.querySelectorAll('.st-reset-kinds input:checked')].map(i => i.value);
      if (!kinds.length) return showMsg('เลือกอย่างน้อย 1 อย่างที่จะล้าง');
      if (!fr.password.value) { fr.password.focus(); return showMsg('ใส่รหัสผ่านบัญชีเจ้าของร้าน'); }
      if (!confirm(`ล้างข้อมูลถาวร กู้คืนไม่ได้:\n• ${kinds.map(k => KIND_TH[k]).join('\n• ')}\n\nร้าน "${current.name}" · ยืนยัน?`)) return;
      setBusy(fr, true, 'กำลังล้าง…');
      const { data, error } = await sb.rpc('st_shop_reset', { p_shop: shopId, p_password: fr.password.value, p_kinds: kinds });
      if (error) { setBusy(fr, false); return showMsg(thaiError(error)); }
      if (!data.ok) { setBusy(fr, false); fr.password.select(); return showMsg(thaiError({ message: data.reason })); }
      // ลบไฟล์ที่ไม่ใช้แล้ว (สลิป / รูปเมนู) · ลบไม่ครบไม่เป็นไร
      try {
        const dirs = [];
        if (kinds.includes('sales')) dirs.push(['st-slips', 'shops/' + shopId]);
        if (kinds.includes('menu')) dirs.push(['st-images', 'shops/' + shopId + '/menu']);
        for (const [bucket, dir] of dirs) {
          const files = await listAll(bucket, dir);
          for (let i = 0; i < files.length; i += 100) await sb.storage.from(bucket).remove(files.slice(i, i + 100));
        }
      } catch { /* ไม่เป็นไร */ }
      setBusy(fr, false);
      fr.reset();
      const d = data.deleted || {};
      showMsg('ล้างแล้ว ✓ ' + Object.keys(d).map(k => `${KIND_TH[k]} ${d[k]} รายการ`).join(' · '), 'ok');
    });
  }

  // ---------- รอบ N: หมวดการตั้งค่า (แท็บ) ----------
  const TAB_KEY = 'st-shop-tab';
  function tabHas(t) {
    return [...document.querySelectorAll(`#shop-body [data-tab="${t}"]`)].some(el => !el.hidden);
  }
  function showTab(t) {
    const btns = [...document.querySelectorAll('#set-tabs [data-tab]')];
    btns.forEach(b => { b.hidden = !tabHas(b.dataset.tab); });
    if (!tabHas(t)) t = (btns.find(b => !b.hidden) || {}).dataset?.tab;
    btns.forEach(b => { b.setAttribute('aria-selected', String(b.dataset.tab === t)); });
    document.querySelectorAll('#shop-body section[data-tab]').forEach(el => el.classList.toggle('st-tabhide', el.dataset.tab !== t));
    try { localStorage.setItem(TAB_KEY, t); } catch { /* ไม่เป็นไร */ }
  }
  $('#set-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
  window.ST_SHOP_TAB = showTab;
  showTab((() => { try { return localStorage.getItem(TAB_KEY); } catch { return null; } })() || 'open');
})();
