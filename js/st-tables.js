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
    sb.from('st_shops').select('id, name, order_mode, is_open, shop_type').eq('id', shopId).maybeSingle(),
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
    : shop.order_mode === 'confirm'
    ? '<b>ลูกค้าเปิดโต๊ะเอง ร้านยืนยัน</b> · ลูกค้าสแกนแล้วสั่งได้เลย จะมีแจ้งเตือน 🆕 ด้านบนให้กด ✓ ยืนยัน หรือ ✗ ปฏิเสธ (ปฏิเสธ = ยกเลิกออร์เดอร์และปิดโต๊ะ)'
    : '<b>รอพนักงานเปิดโต๊ะ</b> · ลูกค้าสแกนแล้วดูเมนูได้ แต่สั่งได้หลังพนักงานกด "เปิดโต๊ะ"')
    + (shop.is_open ? '' : '<br><b class="st-bad">ร้านปิดอยู่</b> ลูกค้าจะสั่งไม่ได้ (เปิดได้ที่หน้าข้อมูลร้าน)');

  const tableUrl = (qr) => pageUrl('table.html') + '?t=' + encodeURIComponent(qr);
  const billUrl = (t) => `bill.html?id=${encodeURIComponent(shopId)}&table=${encodeURIComponent(t.id)}`;
  const staffOrderUrl = (t) => `table.html?t=${encodeURIComponent(t.qr_token)}&staff=1`;
  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const ORDER_TH = { new: 'ใหม่', accepted: 'รับแล้ว', cooking: 'กำลังทำ', served: 'เสิร์ฟแล้ว', cancelled: 'ยกเลิก' };
  const CALL_TH = { call: '🙋 เรียกพนักงาน', bill: '🧾 ขอเช็กบิล', slip: '💸 แนบสลิปรอตรวจ', open: '🆕 ลูกค้าเปิดโต๊ะ รอยืนยัน', coupon: '🎟 คูปอง' };
  // สลิปรอตรวจ: ไปหน้าเช็กบิลเพื่อยืนยัน / ปฏิเสธ (กด รับทราบ ไม่ได้)
  // ลูกค้าเปิดโต๊ะเอง (โหมด "ร้านยืนยัน"): ยืนยัน / ปฏิเสธ
  const CAN_CONFIRM = ['owner', 'manager', 'cashier', 'waiter'].includes(role);
  const callBtn = (c) => c.kind === 'open'
    ? (CAN_CONFIRM
        ? `<span class="st-confirm-actions"><button type="button" class="st-chip st-chip--accent" data-act="tbl-ok" data-table="${esc(c.table_id || (typeof openId !== "undefined" ? openId : ""))}">✓ ยืนยัน</button><button type="button" class="st-chip" data-act="tbl-no" data-table="${esc(c.table_id || (typeof openId !== "undefined" ? openId : ""))}">✗ ปฏิเสธ</button></span>`
        : '<small>รอพนักงานยืนยัน</small>')
    : c.kind === 'slip'
    ? `<a class="st-chip st-chip--accent" href="bill.html?id=${encodeURIComponent(shopId)}&table=${encodeURIComponent(c.table_id || (typeof openId !== "undefined" ? openId : ""))}">ตรวจสลิป</a>`
    : '<button type="button" class="st-chip" data-act="call-done">รับทราบ</button>';
  const canCancel = role !== 'kitchen';
  let tables = [];
  let floor = { calls: [], sessions: [] };
  // ---------- บุฟเฟ่ต์ (st-17) ----------
  const isBuffet = shop.shop_type === 'buffet';
  let bboard = { packages: [], tables: {} };
  let bSkew = 0, bPkg = null, bAdults = 2, bChildren = 0;
  let bAdds = {};                                  // รีฟิลที่เลือก { addon_id: จำนวนคน }
  const ALA = '__alacarte';
  const bNow = () => Date.now() + bSkew;
  function bLeft(b) {                       // นาทีที่เหลือจนหมดเวลา (ติดลบ = เกิน) · null = ไม่จำกัด
    if (!b || b.mode !== 'package' || !b.ends_at) return null;
    return (Date.parse(b.ends_at) - bNow()) / 60000;
  }
  const fmtMin = (m) => { const a = Math.abs(Math.round(m)); return a >= 60 ? Math.floor(a / 60) + ' ชม. ' + (a % 60) + ' น.' : a + ' นาที'; };
  function bTileHtml(t) {
    if (!isBuffet || !t.session) return '';
    const b = bboard.tables[t.id];
    if (!b) return '<small class="st-bf-tile st-bf-tile--wait">🍖 รอเริ่มบุฟเฟ่ต์</small>';
    if (b.mode !== 'package') return '<small class="st-bf-tile">สั่งตามเมนู</small>';
    const left = bLeft(b), heads = (b.adults || 0) + (b.children || 0);
    if (left == null) return `<small class="st-bf-tile">🍖 ${heads} คน · ไม่จำกัดเวลา</small>`;
    if (left <= 0) return `<small class="st-bf-tile st-bf-tile--over">⏰ เกิน ${fmtMin(left)} · ${heads} คน</small>`;
    return `<small class="st-bf-tile${left <= 15 ? ' st-bf-tile--warn' : ''}">⏱ เหลือ ${fmtMin(left)} · ${heads} คน</small>`;
  }
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
      sb.rpc('st_floor_status', { p_shop: shopId }),
      isBuffet ? sb.rpc('st_buffet_board', { p_shop: shopId }) : Promise.resolve({ data: null })
    ]).then(r => { const bb = r[2]; if (bb && bb.data) { bboard = bb.data; if (bb.data.now) bSkew = Date.parse(bb.data.now) - Date.now(); } return r; });
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
        <span><b>${/^คิว /.test(c.table_label) ? '🛍 ' + esc(c.table_label.replace(/ \(.*\)$/, '')) : 'โต๊ะ ' + esc(c.table_label)}</b> ${CALL_TH[c.kind] || esc(c.kind)}${c.detail ? ' <small class="st-call-detail">' + esc(c.detail) + '</small>' : ''} · ${since(c.created_at)}</span>
        ${callBtn(c)}
      </div>`).join('');
  }

  // ยืนยัน / ปฏิเสธโต๊ะที่ลูกค้าเปิดเอง · คืน true ถ้าทำแล้ว
  async function confirmTable(btn, onErr) {
    const ok = btn.dataset.act === 'tbl-ok';
    const label = (btn.closest('[data-call]') || btn).querySelector('b');
    if (!ok && !confirm(`ปฏิเสธการเปิดโต๊ะ${label ? ' ' + label.textContent : ''}?\nออร์เดอร์ที่ลูกค้าสั่งไว้จะถูกยกเลิก และโต๊ะจะว่าง`)) return false;
    btn.disabled = true;
    const { error } = await sb.rpc('st_confirm_table', { p_table: btn.dataset.table, p_ok: ok });
    if (error) { btn.disabled = false; (onErr || showMsg)(thaiError(error)); return false; }
    showMsg(ok ? 'ยืนยันโต๊ะแล้ว ✓' : 'ปฏิเสธแล้ว ยกเลิกออร์เดอร์และปิดโต๊ะให้', 'ok');
    return true;
  }
  $('#calls').addEventListener('click', async (e) => {
    const cb = e.target.closest('[data-act="tbl-ok"], [data-act="tbl-no"]');
    if (cb) { if (await confirmTable(cb)) load(); return; }
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
          const bOver = isBuffet && t.session && bLeft(bboard.tables[t.id]) != null && bLeft(bboard.tables[t.id]) <= 0;
          return `<button type="button" class="st-tile st-tile--${s}${calls.length || bOver ? ' st-tile--alert' : ''}" data-id="${esc(t.id)}">
              <b>${esc(t.label)}${calls.map(k => `<i>${k === 'bill' ? '🧾' : k === 'slip' ? '💸' : k === 'open' ? '🆕' : k === 'coupon' ? '🎟' : '🙋'}</i>`).join('')}</b>
              <span>${t.session && t.session.confirm_status === 'pending' ? '<em class="st-badge st-badge--wait">รอยืนยัน</em> ' : ''}${esc(STATE_TH[s])}${fs && fs.new_orders ? ` · ใหม่ ${fs.new_orders}` : ''}</span>
              <small>${esc(info)}${fs && Number(fs.subtotal) ? ' · ' + baht(fs.subtotal) : ''}</small>
              ${bTileHtml(t)}
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

    if (sheetMode === 'move' || sheetMode === 'merge') {
      const isMove = sheetMode === 'move';
      const cands = tables.filter(x => x.id !== t.id && x.is_active && (isMove ? !x.session : !!x.session));
      body.innerHTML = `
        <p class="st-sub">${isMove ? `ย้ายลูกค้าและออร์เดอร์ทั้งหมดของโต๊ะ ${esc(t.label)} ไปโต๊ะที่ว่าง`
                                   : `รวมออร์เดอร์ทั้งหมดของโต๊ะ ${esc(t.label)} เข้ากับโต๊ะที่มีลูกค้า (เช็กบิลรวมกัน)`}</p>
        <div class="st-board">${cands.length ? cands.map(x => `
          <button type="button" class="st-tile st-tile--${stateOf(x)}" data-act="${isMove ? 'do-move' : 'do-merge'}" data-to="${esc(x.id)}" data-label="${esc(x.label)}">
            <b>${esc(x.label)}</b><span>${esc(STATE_TH[stateOf(x)])}</span><small>${esc(x.zone || '')}</small>
          </button>`).join('') : `<p class="st-sub">${isMove ? 'ไม่มีโต๊ะว่าง' : 'ไม่มีโต๊ะอื่นที่มีลูกค้า'}</p>`}</div>
        <p class="st-sub" style="margin-top:12px">ลูกค้าที่ใช้มือถือสั่งอยู่ ต้องสแกน QR ของโต๊ะ${isMove ? 'ใหม่' : 'ที่รวม'}อีกครั้ง</p>
        <button class="st-btn st-btn--ghost" type="button" data-act="back">‹ กลับ</button>`;
      return;
    }

    if (sheetMode === 'buffet') {
      const cur = bboard.tables[t.id];
      const pk = bboard.packages.filter(p => (p.kind || 'package') === 'package');
      const adds = bboard.packages.filter(p => p.kind === 'addon');
      if (!bPkg) bPkg = cur && cur.mode === 'alacarte' ? ALA : (cur && cur.package_id && pk.some(p => p.id === cur.package_id)) ? cur.package_id : (pk[0] ? pk[0].id : ALA);
      const sel = pk.find(p => p.id === bPkg);
      const heads = bAdults + bChildren;
      const headTotal = sel ? Number(sel.price_adult) * bAdults + Number(sel.price_child ?? sel.price_adult) * bChildren : 0;
      const addTotal = adds.reduce((sum, a) => sum + (bAdds[a.id] ? Number(a.price_adult) * (a.per_head ? bAdds[a.id] : 1) : 0), 0);
      const isEdit = cur && (cur.mode === 'package' || cur.mode === 'alacarte');
      body.innerHTML = `
        <h4 style="margin:0 0 8px">เลือกแพ็กเกจ</h4>
        <div class="st-bf-pkgs">${pk.map(p => `
          <button type="button" class="st-bf-pkg" data-act="bf-pkg" data-pkg="${esc(p.id)}" aria-checked="${p.id === bPkg}">
            <b>${esc(p.name)}</b>
            <span>ผู้ใหญ่ ${baht(p.price_adult)}${p.price_child != null ? ' · เด็ก ' + baht(p.price_child) : ''}</span>
            <small>${p.time_limit_min ? '⏱ ' + p.time_limit_min + ' นาที' : 'ไม่จำกัดเวลา'}${p.round_limit ? ' · รอบละ ' + p.round_limit + ' จาน/คน' : ''}</small>
          </button>`).join('')}
          <button type="button" class="st-bf-pkg" data-act="bf-pkg" data-pkg="${ALA}" aria-checked="${bPkg === ALA}">
            <b>🍽 สั่งตามเมนู (ไม่ใช่บุฟเฟ่ต์)</b><small>คิดเงินตามจาน · ยังเลือกรีฟิลได้</small>
          </button>
        </div>
        ${!pk.length ? `<p class="st-sub">ยังไม่มีแพ็กเกจที่เปิดใช้ ${canManage ? '— ตั้งได้ที่หน้าร้าน → แพ็กเกจบุฟเฟ่ต์' : ''}</p>` : ''}
        <div class="st-stepper"><span>ผู้ใหญ่</span>
          <button type="button" data-act="bf-a" data-d="-1" aria-label="ลด">−</button><b>${bAdults}</b><button type="button" data-act="bf-a" data-d="1" aria-label="เพิ่ม">+</button></div>
        <div class="st-stepper"><span>เด็ก${sel && sel.child_note ? ` <small>(${esc(sel.child_note)})</small>` : ''}</span>
          <button type="button" data-act="bf-c" data-d="-1" aria-label="ลด">−</button><b>${bChildren}</b><button type="button" data-act="bf-c" data-d="1" aria-label="เพิ่ม">+</button></div>
        ${sel && sel.price_child == null && bChildren ? '<p class="st-sub">แพ็กเกจนี้ไม่ได้ตั้งราคาเด็ก — เด็กคิดราคาผู้ใหญ่</p>' : ''}
        ${adds.length ? `<h4 style="margin:14px 0 8px">🥤 รีฟิล / ตัวเลือกเสริม</h4>` + adds.map(a => `
          <div class="st-bf-add${bAdds[a.id] ? ' st-bf-add--on' : ''}">
            <label class="st-check"><input type="checkbox" data-act="bf-add" data-add="${esc(a.id)}"${bAdds[a.id] ? ' checked' : ''}>
              <span><b>${esc(a.name)}</b> ${baht(a.price_adult)} ${a.per_head ? '/คน' : '/โต๊ะ'}</span></label>
            ${a.per_head && bAdds[a.id] ? `<div class="st-stepper st-stepper--sm"><span>กี่คน</span>
              <button type="button" data-act="bf-addq" data-add="${esc(a.id)}" data-d="-1" aria-label="ลด">−</button><b>${bAdds[a.id]}</b>
              <button type="button" data-act="bf-addq" data-add="${esc(a.id)}" data-d="1" aria-label="เพิ่ม">+</button></div>` : ''}
          </div>`).join('') : ''}
        <div class="st-bf-sum"><span>${sel ? 'ค่าบุฟเฟ่ต์ ' + baht(headTotal) : 'สั่งตามเมนู'}${addTotal ? ' + รีฟิล ' + baht(addTotal) : ''}</span><b>${baht(headTotal + addTotal)}</b></div>
        ${cur && cur.mode === 'package' ? '<p class="st-sub" style="margin-top:-6px">เวลาเริ่มเดิมไม่เปลี่ยน</p>' : ''}
        <button class="st-btn" type="button" data-act="bf-start"${(sel && heads > 0) || bPkg === ALA ? '' : ' disabled'}>${isEdit ? 'บันทึกการแก้ไข' : bPkg === ALA ? 'เริ่ม (สั่งตามเมนู)' : '🍖 เริ่มบุฟเฟ่ต์'}</button>
        <button class="st-btn st-btn--ghost" type="button" data-act="back">‹ กลับ</button>`;
      return;
    }

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
        <a class="st-btn st-btn-link" href="${billUrl(t)}">💵 เช็กบิล / รับเงิน</a>
        <a class="st-btn st-btn--ghost st-btn-link" href="${staffOrderUrl(t)}">🛎 สั่งแทนลูกค้า</a>
        <button class="st-btn st-btn--ghost" type="button" data-act="billing">ล็อกไม่ให้สั่งเพิ่ม (รอเช็กบิล)</button>
        <button class="st-btn st-btn--ghost" type="button" data-act="close">ปิดโต๊ะโดยไม่เก็บเงิน</button>`;
    } else {
      actions = `
        <a class="st-btn st-btn-link" href="${billUrl(t)}">💵 รับเงิน</a>
        <button class="st-btn st-btn--ghost" type="button" data-act="reopen">กลับไปให้สั่งเพิ่มได้</button>
        <button class="st-btn st-btn--ghost" type="button" data-act="close">ปิดโต๊ะโดยไม่เก็บเงิน</button>`;
    }
    body.innerHTML = `
      <p class="st-sheet-info st-tile--${s}">${info}</p>
      ${isBuffet && s !== 'free' ? bPanelHtml(t) : ''}
      ${s === 'free' ? '' : detailHtml()}
      <div class="st-sheet-actions">${actions}
        ${s !== 'free' && canOperate && t.is_active ? `<div class="st-grid2">
          <button class="st-btn st-btn--ghost" type="button" data-act="move">↔ ย้ายโต๊ะ</button>
          <button class="st-btn st-btn--ghost" type="button" data-act="merge">⇉ รวมโต๊ะ</button>
        </div>` : ''}
        <button class="st-btn st-btn--ghost" type="button" data-act="show-qr">แสดง QR ให้ลูกค้าสแกน</button>
      </div>`;
  }

  // แผงบุฟเฟ่ต์ในแผ่นโต๊ะ
  function bPanelHtml(t) {
    const b = bboard.tables[t.id];
    if (!canOperate) return '';
    if (!b) return `<div class="st-bf-panel st-bf-panel--wait"><b>🍖 ยังไม่ได้เริ่มบุฟเฟ่ต์</b>
      <span>ลูกค้ายังสั่งไม่ได้ · นับจำนวนคนแล้วเลือกแพ็กเกจ</span>
      <button class="st-btn" type="button" data-act="bf-form">เริ่มบุฟเฟ่ต์</button></div>`;
    const addTxt = (b.addons || []).map(a => `🥤 ${esc(a.name)}${a.per_head ? ' · ' + a.qty + ' คน' : ''}`).join(' · ');
    if (b.mode !== 'package') return `<div class="st-bf-panel"><b>สั่งตามเมนู (ไม่ใช่บุฟเฟ่ต์)</b>${addTxt ? `<span>${addTxt}</span>` : ''}
      <div class="st-bf-acts"><button class="st-chip" type="button" data-act="bf-form">เปลี่ยนเป็นบุฟเฟ่ต์ / เพิ่มรีฟิล</button></div></div>`;
    const left = bLeft(b), heads = (b.adults || 0) + (b.children || 0);
    const ot = left != null && left < 0 && Number(b.overtime_fee) ? Math.ceil(-left / (b.overtime_block_min || 15)) * Number(b.overtime_fee) * heads : 0;
    return `<div class="st-bf-panel${left != null && left <= 0 ? ' st-bf-panel--over' : ''}">
      <b>🍖 ${esc(b.name)} · ผู้ใหญ่ ${b.adults}${b.children ? ' · เด็ก ' + b.children : ''}</b>
      ${addTxt ? `<span>${addTxt}</span>` : ''}
      <span>${left == null ? 'ไม่จำกัดเวลา' : left > 0 ? `เหลือ ${fmtMin(left)} · หมดเวลา ${new Date(Date.parse(b.ends_at)).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`
        : `⏰ เกินเวลา ${fmtMin(left)}`} · เริ่ม ${new Date(Date.parse(b.started_at)).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>
      <div class="st-bf-acts">
        <button class="st-chip" type="button" data-act="bf-form">แก้แพ็กเกจ / จำนวนคน / รีฟิล</button>
        ${left != null ? `<button class="st-chip" type="button" data-act="bf-ext" data-min="15">+15 นาที</button><button class="st-chip" type="button" data-act="bf-ext" data-min="30">+30 นาที</button>` : ''}
        ${ot ? `<button class="st-chip st-chip--accent" type="button" data-act="bf-ot">คิดค่าเกินเวลา ${baht(ot)}</button>` : ''}
      </div></div>`;
  }

  // ออร์เดอร์ + ยอดของรอบนี้
  function detailHtml() {
    if (!detail) return '<p class="st-sub" style="margin:12px 0 0">กำลังโหลดรายการ…</p>';
    const b = detail.bill;
    const calls = detail.calls.map(c => `
      <div class="st-call st-call--${c.kind}" data-call="${esc(c.id)}">
        <span>${CALL_TH[c.kind] || esc(c.kind)}${c.detail ? ' <small class="st-call-detail">' + esc(c.detail) + '</small>' : ''} · ${since(c.created_at)}</span>
        ${callBtn(c)}
      </div>`).join('');
    const orders = detail.orders.slice().reverse().map(o => `
      <div class="st-order st-order--${o.status}">
        <div class="st-order-head">
          <b>#${o.order_no}</b>${o.to_go ? ' <em class="st-badge st-badge--togo">🛍 ห่อกลับบ้าน</em>' : ''}
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
    if (act === 'move' || act === 'merge') { sheetMode = act; return renderSheet(); }
    if (act === 'do-move' || act === 'do-merge') {
      const to = btn.dataset.label;
      const isMove = act === 'do-move';
      if (!confirm(isMove ? `ย้ายโต๊ะ ${t.label} ไปโต๊ะ ${to}?` : `รวมโต๊ะ ${t.label} เข้ากับโต๊ะ ${to}?\nออร์เดอร์ทั้งหมดจะไปอยู่ที่โต๊ะ ${to} และโต๊ะ ${t.label} จะว่าง`)) return;
      btn.disabled = true;
      const { error: em } = await sb.rpc(isMove ? 'st_move_table' : 'st_merge_tables',
        isMove ? { p_from: t.id, p_to: btn.dataset.to } : { p_from: t.id, p_into: btn.dataset.to });
      if (em) { btn.disabled = false; return sheetMsg(thaiError(em)); }
      closeSheet();
      showMsg(isMove ? `ย้ายโต๊ะ ${t.label} → ${to} แล้ว` : `รวมโต๊ะ ${t.label} เข้ากับ ${to} แล้ว`, 'ok');
      return load();
    }
    if (act === 'back') { sheetMode = 'actions'; renderSheet(); return loadDetail(); }
    if (act === 'tbl-ok' || act === 'tbl-no') {
      if (!(await confirmTable(btn, sheetMsg))) return;
      if (act === 'tbl-no') closeSheet();
      return load();
    }
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

    // ----- บุฟเฟ่ต์ -----
    if (act === 'bf-form') { const cur = bboard.tables[t.id]; bPkg = cur ? (cur.mode === 'alacarte' ? ALA : cur.package_id || null) : null;
      bAdds = Object.fromEntries(((cur && cur.addons) || []).map(a => [a.id, a.qty]));
      bAdults = cur && cur.mode === 'package' ? cur.adults : Math.max(1, t.session?.guest_count || 2); bChildren = cur && cur.mode === 'package' ? cur.children : 0;
      sheetMode = 'buffet'; return renderSheet(); }
    if (act === 'bf-pkg') { bPkg = btn.dataset.pkg; return renderSheet(); }
    if (act === 'bf-a') { bAdults = Math.min(99, Math.max(0, bAdults + Number(btn.dataset.d))); return renderSheet(); }
    if (act === 'bf-c') { bChildren = Math.min(99, Math.max(0, bChildren + Number(btn.dataset.d))); return renderSheet(); }
    if (act === 'bf-add') { const id = btn.dataset.add; if (btn.checked) bAdds[id] = Math.max(1, bAdults + bChildren); else delete bAdds[id]; return renderSheet(); }
    if (act === 'bf-addq') { const id = btn.dataset.add; bAdds[id] = Math.min(99, Math.max(1, (bAdds[id] || 1) + Number(btn.dataset.d))); return renderSheet(); }
    if (act === 'bf-start' || act === 'bf-alacarte' || act === 'bf-ext' || act === 'bf-ot') {
      if (act === 'bf-alacarte' && !confirm(`โต๊ะ ${t.label} สั่งตามเมนู ไม่ใช่บุฟเฟ่ต์?`)) return;
      btn.disabled = true;
      const r = act === 'bf-ext' ? await sb.rpc('st_buffet_extend', { p_table: t.id, p_minutes: Number(btn.dataset.min) })
        : act === 'bf-ot' ? await sb.rpc('st_buffet_overtime', { p_table: t.id })
        : await sb.rpc('st_buffet_start', { p_table: t.id, p_package: act === 'bf-alacarte' || bPkg === ALA ? null : bPkg, p_adults: bAdults, p_children: bChildren,
                                            p_addons: Object.entries(bAdds).map(([id, qty]) => ({ id, qty })) });
      btn.disabled = false;
      if (r.error) return sheetMsg(thaiError(r.error));
      sheetMode = 'actions';
      await load(); loadDetail();
      return showMsg(act === 'bf-ext' ? `ต่อเวลาโต๊ะ ${t.label} +${btn.dataset.min} นาทีแล้ว` : act === 'bf-ot' ? 'เพิ่มค่าเกินเวลาในบิลแล้ว'
        : act === 'bf-alacarte' || bPkg === ALA ? `โต๊ะ ${t.label} สั่งตามเมนู${Object.keys(bAdds).length ? ' + รีฟิล' : ''} ✓` : `เริ่มบุฟเฟ่ต์โต๊ะ ${t.label} แล้ว ✓ ลูกค้าสั่งได้เลย`, 'ok');
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
      const unpaid = detail && detail.orders.some(o => o.status !== 'cancelled');
      if (!confirm(unpaid ? `โต๊ะ ${t.label} ยังไม่ได้บันทึกการรับเงิน!\nปิดโต๊ะโดยไม่เก็บเงิน? (ยอดนี้จะไม่อยู่ในรายงานยอดขาย)`
                          : `ปิดโต๊ะ ${t.label}? ลูกค้ากลุ่มนี้จะสั่งต่อจากมือถือไม่ได้`)) { btn.disabled = false; return; }
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
    if (act === 'open' && isBuffet && canOperate) {          // ร้านบุฟเฟ่ต์: เปิดโต๊ะแล้วเลือกแพ็กเกจต่อเลย
      await load();
      bPkg = null; bAdults = Math.max(1, guests); bChildren = 0; bAdds = {};
      sheetMode = 'buffet'; renderSheet();
      return sheetMsg(okText + ' · เลือกแพ็กเกจและจำนวนคน', 'ok');
    }
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_payments', filter }, schedule)
    .subscribe();

  // ---------- เริ่มต้น + รีเฟรชอัตโนมัติ (สำรอง) ----------
  await load();
  $('#tables-body').hidden = false;
  setInterval(() => { if (!document.hidden) load(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
