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
  $('#link-layout').href = 'settings.html?back=' + encodeURIComponent('shop.html?id=' + shopId);
  applyLayout(getPrefs().layout);
  $('#shop-body').hidden = false;

  // ---------- รูปแบบหน้า (ตั้งที่ ⚙️ ตั้งค่า): รายการ / ช่องใหญ่ / ไอคอน / แบ่งหมวด ----------
  // ลำดับปุ่ม (ตั้งเองได้ด้วยปุ่ม "จัดลำดับ" · จำไว้ในบัญชี)
  // (ใช้ function เพื่อให้เรียกได้ก่อนบรรทัดนี้ — applyLayout ถูกเรียกตั้งแต่ด้านบน)
  function linkOrder() {
    const def = ['orders', 'tables', 'queue', 'receipts', 'menu', 'promos', 'reports', 'audit'];
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
      ['งานหน้าร้าน', ['link-orders', 'link-tables', 'link-queue', 'link-receipts']],
      ['จัดการร้าน', ['link-menu', 'link-promos']],
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
    fs.is_open.checked = !!current.is_open;
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
      is_open: fs.is_open.checked,
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
})();
