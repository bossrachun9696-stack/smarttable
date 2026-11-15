// ===== หน้า โต๊ะและ QR (tables.html?id=<shop_id>) =====
(async function () {
  const { sb, configOk, $, esc, ROLE_TH, thaiError, pageUrl, showMsg, requireUser, copyText } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('index.html'); });

  const shopId = new URLSearchParams(location.search).get('id');
  if (!shopId) return location.replace('home.html');
  $('#back').href = 'shop.html?id=' + encodeURIComponent(shopId);
  $('#link-orders').href = 'orders.html?id=' + encodeURIComponent(shopId);
  $('#btn-print').href = 'print.html?id=' + encodeURIComponent(shopId);

  const [{ data: shop }, { data: me }] = await Promise.all([
    sb.from('st_shops').select('id, name, order_mode, is_open').eq('id', shopId).maybeSingle(),
    sb.from('st_shop_members').select('role').eq('shop_id', shopId).eq('user_id', user.id).maybeSingle()
  ]);
  if (!shop || !me) { $('#shop-sub').textContent = ''; return showMsg('ไม่พบร้านนี้ หรือคุณไม่ได้เป็นพนักงานของร้าน'); }

  const role = me.role;
  const canManage = role === 'owner' || role === 'manager';
  const canOperate = role !== 'kitchen';
  $('#shop-sub').textContent = shop.name;
  $('#my-role').textContent = 'คุณ: ' + ROLE_TH[role];
  document.title = 'โต๊ะ · ' + shop.name;

  $('#mode-banner').innerHTML = (shop.order_mode === 'instant'
    ? '<b>สั่งได้ทันทีเมื่อสแกน</b> · โต๊ะจะเปิดเองเมื่อลูกค้าสแกน QR พนักงานกด "ปิดโต๊ะ" เมื่อลูกค้ากลับ'
    : '<b>รอพนักงานเปิดโต๊ะ</b> · ลูกค้าสแกนแล้วดูเมนูได้ แต่สั่งได้หลังพนักงานกด "เปิดโต๊ะ"')
    + (shop.is_open ? '' : '<br><b class="st-bad">ร้านปิดอยู่</b> ลูกค้าจะสั่งไม่ได้ (เปิดได้ที่หน้าข้อมูลร้าน)');

  const tableUrl = (qr) => pageUrl('table.html') + '?t=' + encodeURIComponent(qr);
  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const ORDER_TH = { new: 'ใหม่', accepted: 'รับแล้ว', cooking: 'กำลังทำ', served: 'เสิร์ฟแล้ว', cancelled: 'ยกเลิก' };
  const CALL_TH = { call: '🙋 เรียกพนักงาน', bill: '🧾 ขอเช็กบิล' };
  const canCancel = role !== 'kitchen';
  let tables = [];
  let floor = { calls: [], sessions: [] };
  let detail = null;        // รายละเอียดรอบของโต๊ะที่เปิดแผ่นอยู่

  // ---------- เวลา ----------
  function since(iso) {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 60) return min + ' นาที';
    return Math.floor(min / 60) + ' ชม.' + (min % 60 ? ' ' + (min % 60) + ' นาที' : '');
  }
  const stateOf = (t) => !t.session ? 'free' : t.session.status;   // free | open | billing
  const STATE_TH = { free: 'ว่าง', open: 'มีลูกค้า', billing: 'รอเช็กบิล' };

  // ---------- โหลดและแสดงผังโต๊ะ ----------
  async function load() {
    const [{ data, error }, fl] = await Promise.all([
      sb.rpc('st_tables_board', { p_shop: shopId }),
      sb.rpc('st_floor_status', { p_shop: shopId })
    ]);
    if (error) return showMsg(thaiError(error));
    tables = data;
    if (!fl.error) floor = fl.data;
    render();
    if (!$('#sheet').hidden && openId && sheetMode === 'actions') loadDetail();   // อัปเดตแผ่นที่เปิดอยู่ (ไม่ทับฟอร์มที่กำลังพิมพ์)
  }

  async function loadDetail() {
    const id = openId;
    const { data, error } = await sb.rpc('st_session_detail', { p_table: id });
    if (id !== openId || sheetMode !== 'actions') return;
    if (error) return sheetMsg(thaiError(error));
    detail = data;
    renderSheet();
  }

  // การเรียกจากลูกค้า (แถบด้านบน)
  function renderCalls() {
    $('#calls').innerHTML = floor.calls.map(c => `
      <div class="st-call st-call--${c.kind}" data-call="${esc(c.id)}">
        <span><b>โต๊ะ ${esc(c.table_label)}</b> ${CALL_TH[c.kind]} · ${since(c.created_at)}</span>
        <button type="button" class="st-chip" data-act="call-done">รับทราบ</button>
      </div>`).join('');
  }
  $('#calls').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act="call-done"]');
    if (!b) return;
    b.disabled = true;
    const { error } = await sb.rpc('st_handle_call', { p_call: b.closest('[data-call]').dataset.call });
    if (error) { b.disabled = false; return showMsg(thaiError(error)); }
    load();
  });

  function render() {
    renderCalls();
    const sessBy = Object.fromEntries(floor.sessions.map(x => [x.table_id, x]));
    const callsBy = {};
    floor.calls.forEach(c => { (callsBy[c.table_id] = callsBy[c.table_id] || []).push(c.kind); });
    const active = tables.filter(t => t.is_active);
    const zones = [...new Set(active.map(t => t.zone || ''))];
    $('#board').innerHTML = active.length ? zones.map(z => `
      ${zones.length > 1 || z ? `<h3 class="st-zone">${esc(z || 'ไม่ระบุโซน')}</h3>` : ''}
      <div class="st-board">
        ${active.filter(t => (t.zone || '') === z).map(t => {
          const s = stateOf(t);
          const info = s === 'free' ? `${t.seats} ที่นั่ง`
            : (t.session.guest_count ? t.session.guest_count + ' คน · ' : '') + since(t.session.opened_at);
          const fs = sessBy[t.id];
          const calls = callsBy[t.id] || [];
          return `<button type="button" class="st-tile st-tile--${s}${calls.length ? ' st-tile--alert' : ''}" data-id="${esc(t.id)}">
              <b>${esc(t.label)}${calls.map(k => `<i>${k === 'bill' ? '🧾' : '🙋'}</i>`).join('')}</b>
              <span>${esc(STATE_TH[s])}${fs && fs.new_orders ? ` · ใหม่ ${fs.new_orders}` : ''}</span>
              <small>${esc(info)}${fs && Number(fs.subtotal) ? ' · ' + baht(fs.subtotal) : ''}</small>
            </button>`;
        }).join('')}
      </div>`).join('')
      : `<div class="st-empty"><b>ยังไม่มีโต๊ะ</b>${canManage ? 'เพิ่มโต๊ะได้ที่ "จัดการโต๊ะ" ด้านล่าง' : 'ให้เจ้าของร้านหรือผู้จัดการเพิ่มโต๊ะ'}</div>`;

    if (canManage) {
      $('#table-count').textContent = `(${tables.length})`;
      $('#table-list').innerHTML = tables.length ? tables.map(t => `
        <div class="st-item" data-id="${esc(t.id)}" data-act="edit" role="button" tabindex="0">
          <div class="st-logo">${esc(t.label.slice(0, 3))}</div>
          <div class="st-item-main"><b>โต๊ะ ${esc(t.label)}</b>
            <small>${esc([t.zone, t.seats + ' ที่นั่ง'].filter(Boolean).join(' · '))}</small></div>
          ${t.is_active ? '' : '<span class="st-badge st-badge--muted">ปิดใช้งาน</span>'}
          <span class="st-arrow" aria-hidden="true">›</span>
        </div>`).join('') : '<p class="st-sub">ยังไม่มีโต๊ะ</p>';
    }
  }

  // ---------- แผ่นด้านล่าง ----------
  const sheet = $('#sheet');
  let openId = null;     // โต๊ะที่เปิดแผ่นอยู่
  let sheetMode = null;  // 'actions' | 'qr' | 'edit'
  let guests = 2;

  const sheetMsg = (text, type = 'error') => {
    const b = $('#sheet-msg'); b.textContent = text; b.className = 'st-msg st-msg--' + type; b.hidden = false;
  };
  function openSheet(id, mode) {
    openId = id; sheetMode = mode;
    const t = tables.find(x => x.id === id);
    guests = t ? Math.min(t.seats, 2) : 2;
    $('#sheet-msg').hidden = true;
    detail = null;
    renderSheet();
    sheet.hidden = false;
    document.body.classList.add('st-noscroll');
    if (mode === 'actions') loadDetail();
  }
  function closeSheet() {
    sheet.hidden = true; openId = null; sheetMode = null;
    document.body.classList.remove('st-noscroll');
  }
  $('#sheet-close').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

  function renderSheet() {
    const t = tables.find(x => x.id === openId);
    const body = $('#sheet-body');

    if (sheetMode === 'edit') {
      $('#sheet-title').textContent = t ? `แก้ไขโต๊ะ ${t.label}` : 'เพิ่มโต๊ะ';
      body.innerHTML = `
        <form id="form-table" novalidate>
          <label class="st-field"><span>ชื่อ / เลขโต๊ะ</span>
            <input name="label" type="text" maxlength="20" required value="${esc(t ? t.label : '')}" placeholder="เช่น 5 หรือ A1"></label>
          <div class="st-grid2">
            <label class="st-field"><span>โซน</span>
              <input name="zone" type="text" maxlength="40" value="${esc(t?.zone || '')}" placeholder="เช่น ระเบียง"></label>
            <label class="st-field"><span>จำนวนที่นั่ง</span>
              <input name="seats" type="number" min="1" max="50" inputmode="numeric" value="${t ? t.seats : 4}"></label>
          </div>
          <label class="st-check"><input type="checkbox" name="active" ${!t || t.is_active ? 'checked' : ''}> <span>ใช้งานอยู่ (ปิดไว้ = ลูกค้าสแกนไม่ได้)</span></label>
          <button class="st-btn" type="submit">บันทึก</button>
        </form>
        ${t ? `
          <div class="st-sheet-actions">
            <a class="st-btn st-btn--ghost st-btn-link" href="print.html?id=${encodeURIComponent(shopId)}&table=${encodeURIComponent(t.id)}">พิมพ์ QR โต๊ะนี้</a>
            <button class="st-btn st-btn--ghost" type="button" data-act="reset-qr">สร้าง QR ใหม่ (QR เก่าใช้ไม่ได้)</button>
            <button class="st-btn st-btn--ghost st-danger" type="button" data-act="delete">ลบโต๊ะ</button>
          </div>` : ''}`;
      return;
    }

    if (!t) return closeSheet();
    const s = stateOf(t);
    $('#sheet-title').textContent = `โต๊ะ ${t.label}`;

    if (sheetMode === 'qr') {
      const url = tableUrl(t.qr_token);
      body.innerHTML = `
        <div class="st-qr-big">${STQR.svg(url, { margin: 2 })}</div>
        <p class="st-center st-sub">ให้ลูกค้าสแกนด้วยกล้องมือถือ</p>
        <div class="st-grid2">
          <button class="st-btn st-btn--ghost" type="button" data-act="copy-link">คัดลอกลิงก์</button>
          <button class="st-btn st-btn--ghost" type="button" data-act="back">‹ กลับ</button>
        </div>`;
      return;
    }

    // actions
    const sess = t.session;
    const info = s === 'free' ? `ว่าง · ${t.seats} ที่นั่ง${t.zone ? ' · ' + esc(t.zone) : ''}`
      : `${STATE_TH[s]}${sess.guest_count ? ' · ' + sess.guest_count + ' คน' : ''} · เปิดมา ${since(sess.opened_at)}`
        + (sess.opened_via === 'auto' ? ' · เปิดเองจากการสแกน' : '');
    let actions = '';
    if (!t.is_active) {
      actions = '<p class="st-sub">โต๊ะนี้ปิดใช้งานอยู่</p>';
    } else if (!canOperate) {
      actions = '<p class="st-sub">ตำแหน่งครัวดูสถานะได้อย่างเดียว</p>';
    } else if (s === 'free') {
      actions = `
        <div class="st-stepper">
          <span>จำนวนลูกค้า</span>
          <button type="button" data-act="minus" aria-label="ลด">−</button>
          <b id="guest-n">${guests}</b>
          <button type="button" data-act="plus" aria-label="เพิ่ม">+</button>
        </div>
        <button class="st-btn" type="button" data-act="open">เปิดโต๊ะ</button>`;
    } else if (s === 'open') {
      actions = `
        <button class="st-btn" type="button" data-act="billing">เรียกเช็กบิล</button>
        <button class="st-btn st-btn--ghost" type="button" data-act="close">ปิดโต๊ะ (ลูกค้ากลับแล้ว)</button>`;
    } else {
      actions = `
        <button class="st-btn" type="button" data-act="close">ปิดโต๊ะ (จ่ายเงินแล้ว)</button>
        <button class="st-btn st-btn--ghost" type="button" data-act="reopen">กลับไปให้สั่งเพิ่มได้</button>`;
    }
    body.innerHTML = `
      <p class="st-sheet-info st-tile--${s}">${info}</p>
      ${s === 'free' ? '' : detailHtml()}
      <div class="st-sheet-actions">${actions}
        <button class="st-btn st-btn--ghost" type="button" data-act="show-qr">แสดง QR ให้ลูกค้าสแกน</button>
      </div>`;
  }

  // ออร์เดอร์ + ยอดของรอบนี้
  function detailHtml() {
    if (!detail) return '<p class="st-sub" style="margin:12px 0 0">กำลังโหลดรายการ…</p>';
    const b = detail.bill;
    const calls = detail.calls.map(c => `
      <div class="st-call st-call--${c.kind}" data-call="${esc(c.id)}">
        <span>${CALL_TH[c.kind]} · ${since(c.created_at)}</span>
        <button type="button" class="st-chip" data-act="call-done">รับทราบ</button>
      </div>`).join('');
    const orders = detail.orders.slice().reverse().map(o => `
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
        ${canCancel && o.status !== 'cancelled' ? `<div class="st-order-act"><button type="button" class="st-chip" data-act="cancel-order" data-order="${esc(o.id)}" data-no="${o.order_no}">ยกเลิกออร์เดอร์</button></div>` : ''}
      </div>`).join('');
    return `
      ${calls}
      <h4>รายการที่สั่ง (${detail.orders.filter(o => o.status !== 'cancelled').length})</h4>
      ${orders || '<p class="st-sub">ยังไม่มีออร์เดอร์</p>'}
      ${detail.orders.length ? `
        <div class="st-bill">
          <div><span>ค่าอาหาร</span><span>${baht(b.subtotal)}</span></div>
          ${Number(b.service_pct) ? `<div><span>ค่าบริการ ${Number(b.service_pct)}%</span><span>${baht(b.service)}</span></div>` : ''}
          ${Number(b.vat_pct) ? `<div><span>VAT ${Number(b.vat_pct)}%${b.vat_included ? ' (รวมแล้ว)' : ''}</span><span>${baht(b.vat)}</span></div>` : ''}
          <div class="st-bill-total"><span>รวมทั้งหมด</span><b>${baht(b.total)}</b></div>
        </div>` : ''}`;
  }

  // ---------- การกดในแผ่น ----------
  $('#sheet-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const t = tables.find(x => x.id === openId);
    const act = btn.dataset.act;

    if (act === 'minus' || act === 'plus') {
      guests = Math.min(99, Math.max(1, guests + (act === 'plus' ? 1 : -1)));
      $('#guest-n').textContent = guests;
      return;
    }
    if (act === 'show-qr') { sheetMode = 'qr'; return renderSheet(); }
    if (act === 'back') { sheetMode = 'actions'; renderSheet(); return loadDetail(); }
    if (act === 'call-done') {
      btn.disabled = true;
      const { error: e1 } = await sb.rpc('st_handle_call', { p_call: btn.closest('[data-call]').dataset.call });
      if (e1) { btn.disabled = false; return sheetMsg(thaiError(e1)); }
      return load();
    }
    if (act === 'cancel-order') {
      if (!confirm(`ยกเลิกออร์เดอร์ #${btn.dataset.no}? ยอดจะถูกหักออกจากบิล`)) return;
      btn.disabled = true;
      const { error: e2 } = await sb.rpc('st_set_order_status', { p_order: btn.dataset.order, p_status: 'cancelled' });
      if (e2) { btn.disabled = false; return sheetMsg(thaiError(e2)); }
      sheetMsg(`ยกเลิกออร์เดอร์ #${btn.dataset.no} แล้ว`, 'ok');
      return load();
    }
    if (act === 'copy-link') {
      return (await copyText(tableUrl(t.qr_token))) ? sheetMsg('คัดลอกลิงก์แล้ว', 'ok') : sheetMsg('คัดลอกไม่ได้');
    }

    let error, okText;
    btn.disabled = true;
    if (act === 'open') {
      ({ error } = await sb.rpc('st_open_table', { p_table: t.id, p_guests: guests }));
      okText = `เปิดโต๊ะ ${t.label} แล้ว`;
    } else if (act === 'billing' || act === 'reopen') {
      ({ error } = await sb.rpc('st_set_table_status', { p_table: t.id, p_status: act === 'billing' ? 'billing' : 'open', p_guests: null }));
      okText = act === 'billing' ? `โต๊ะ ${t.label} รอเช็กบิล` : `โต๊ะ ${t.label} สั่งเพิ่มได้แล้ว`;
    } else if (act === 'close') {
      if (!confirm(`ปิดโต๊ะ ${t.label}? ลูกค้ากลุ่มนี้จะสั่งต่อจากมือถือไม่ได้`)) { btn.disabled = false; return; }
      ({ error } = await sb.rpc('st_close_table', { p_table: t.id }));
      okText = `ปิดโต๊ะ ${t.label} แล้ว`;
    } else if (act === 'reset-qr') {
      if (!confirm(`สร้าง QR ใหม่ให้โต๊ะ ${t.label}?\nQR ที่พิมพ์ไว้แล้วจะใช้ไม่ได้ทันที ต้องพิมพ์ใหม่`)) { btn.disabled = false; return; }
      ({ error } = await sb.rpc('st_reset_table_qr', { p_table: t.id }));
      okText = `สร้าง QR ใหม่ให้โต๊ะ ${t.label} แล้ว อย่าลืมพิมพ์ใหม่`;
    } else if (act === 'delete') {
      if (!confirm(`ลบโต๊ะ ${t.label}?`)) { btn.disabled = false; return; }
      ({ error } = await sb.rpc('st_delete_table', { p_table: t.id }));
      okText = `ลบโต๊ะ ${t.label} แล้ว`;
    } else { btn.disabled = false; return; }

    btn.disabled = false;
    if (error) return sheetMsg(thaiError(error));
    closeSheet();
    showMsg(okText, 'ok');
    load();
  });

  // บันทึกฟอร์มโต๊ะ
  $('#sheet-body').addEventListener('submit', async (e) => {
    if (e.target.id !== 'form-table') return;
    e.preventDefault();
    const f = e.target;
    const label = f.label.value.trim();
    if (!label) return sheetMsg('กรุณาใส่ชื่อหรือเลขโต๊ะ');
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    const { error } = await sb.rpc('st_save_table', {
      p_shop: shopId, p_id: openId, p_label: label, p_zone: f.zone.value.trim() || null,
      p_seats: parseInt(f.seats.value, 10) || 4, p_active: f.active.checked
    });
    btn.disabled = false;
    if (error) return sheetMsg(thaiError(error));
    closeSheet();
    showMsg(`บันทึกโต๊ะ ${label} แล้ว`, 'ok');
    load();
  });

  // ---------- ผังโต๊ะ / รายการโต๊ะ ----------
  $('#board').addEventListener('click', (e) => {
    const tile = e.target.closest('.st-tile');
    if (tile) openSheet(tile.dataset.id, 'actions');
  });
  $('#btn-refresh').addEventListener('click', load);

  if (canManage) {
    $('#manage').hidden = false;
    $('#btn-new').addEventListener('click', () => openSheet(null, 'edit'));
    $('#table-list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-act="edit"]');
      if (row) openSheet(row.dataset.id, 'edit');
    });
    $('#table-list').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.dataset.act === 'edit') e.target.click();
    });

    $('#form-many').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const from = parseInt(f.from.value, 10), to = parseInt(f.to.value, 10);
      if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return showMsg('ใส่เลขเริ่มต้นและเลขสุดท้ายให้ถูกต้อง');
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      const { data: n, error } = await sb.rpc('st_add_tables', {
        p_shop: shopId, p_prefix: f.prefix.value.trim(), p_from: from, p_to: to,
        p_zone: f.zone.value.trim() || null, p_seats: 4
      });
      btn.disabled = false;
      if (error) return showMsg(thaiError(error));
      showMsg(n ? `เพิ่มแล้ว ${n} โต๊ะ` : 'ไม่ได้เพิ่ม เพราะมีโต๊ะชื่อเหล่านี้อยู่แล้ว', n ? 'ok' : 'error');
      load();
    });
  }

  // ---------- Realtime: มีออร์เดอร์ / การเรียก / เปิดปิดโต๊ะ -> โหลดใหม่ ----------
  let rt;
  const schedule = () => { clearTimeout(rt); rt = setTimeout(load, 400); };
  const filter = `shop_id=eq.${shopId}`;
  sb.channel('st-tables-' + shopId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_orders', filter }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_service_calls', filter }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_table_sessions', filter }, schedule)
    .subscribe();

  // ---------- เริ่มต้น + รีเฟรชอัตโนมัติ (สำรอง) ----------
  await load();
  $('#tables-body').hidden = false;
  setInterval(() => { if (!document.hidden) load(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
