// ===== หน้า สั่งกลับบ้าน / คิว (queue.html?id=<shop_id>) =====
// ตั้งค่า + QR สั่งกลับบ้าน · ออกบัตรคิวหน้าร้าน · ติดตามคิว: กำลังทำ / พร้อมรับ / เสร็จแล้ว
(async function () {
  const { sb, configOk, $, esc, thaiError, pageUrl, showMsg, requireUser, copyText } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;

  const shopId = new URLSearchParams(location.search).get('id');
  if (!shopId) return location.replace('home.html');
  $('#back').href = 'shop.html?id=' + encodeURIComponent(shopId);

  const [{ data: shop }, { data: me }] = await Promise.all([
    sb.from('st_shops').select('id, name').eq('id', shopId).maybeSingle(),
    sb.from('st_shop_members').select('role').eq('shop_id', shopId).eq('user_id', user.id).maybeSingle()
  ]);
  if (!shop || !me) { $('#shop-sub').textContent = ''; return showMsg('ไม่พบร้านนี้ หรือคุณไม่ได้เป็นพนักงานของร้าน'); }
  const role = me.role;
  const canManage = role === 'owner' || role === 'manager';
  const canCash = role !== 'kitchen';
  $('#shop-sub').textContent = shop.name;
  $('#qp-shop').textContent = shop.name;
  document.title = 'คิวกลับบ้าน · ' + shop.name;

  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hhmm = (iso) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (iso) => {
    const d = new Date(iso), now = new Date();
    return d.toDateString() === now.toDateString() ? '' : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) + ' ';
  };
  const tableUrl = (qr) => pageUrl('table.html') + '?t=' + encodeURIComponent(qr);

  let board = null;
  let tab = 'cooking';
  let offset = 0;
  let deliv = new Map();
  let dcfg = {};                                       // table_id -> ข้อมูลรับ/ส่ง (ร้านขายของชำ)
  const mins = (iso) => Math.max(0, Math.floor((Date.now() + offset - new Date(iso).getTime()) / 60000));

  // ---------- โหลด ----------
  let loading = false, again = false;
  async function load() {
    if (loading) { again = true; return; }
    loading = true;
    const [{ data, error }, dv] = await Promise.all([
      sb.rpc('st_queue_board', { p_shop: shopId }),
      sb.rpc('st_delivery_board', { p_shop: shopId })            // รอบ M: ร้านขายของชำ (ยังไม่รัน st-21 = ข้าม)
    ]);
    loading = false;
    if (error) { showMsg(thaiError(error)); }
    else {
      board = data;
      deliv = new Map(((dv && !dv.error && dv.data && dv.data.list) || []).map(x => [x.table_id, x]));
      dcfg = (dv && !dv.error && dv.data && dv.data.cfg) || {};
      offset = new Date(data.now).getTime() - Date.now();
      render();
      $('#q-body').hidden = false;
    }
    if (again) { again = false; load(); }
  }
  let t0;
  const schedule = () => { clearTimeout(t0); t0 = setTimeout(load, 400); };

  // ---------- ตั้งค่า / QR ----------
  function renderSetup() {
    $('#q-setup').hidden = !canManage && !board.hub;
    $('#q-enabled').checked = !!board.takeaway_enabled;
    $('#q-preorder').checked = !!board.preorder_enabled;
    $('#q-enabled').disabled = $('#q-preorder').disabled = !canManage;
    $('#q-preorder').closest('label').hidden = !board.takeaway_enabled;
    $('#q-reset').hidden = !canManage;
    const hub = board.hub;
    $('#q-hub').hidden = !hub || !board.takeaway_enabled;
    if (hub) {
      const url = tableUrl(hub.qr_token);
      if ($('#q-link').textContent !== url) {
        $('#q-link').textContent = url;
        $('#q-qr').innerHTML = STQR.svg(url, { margin: 1 });
        $('#qp-qr').innerHTML = STQR.svg(url, { margin: 1 });
      }
      $('#q-tv').href = 'queue-tv.html?t=' + encodeURIComponent(hub.qr_token);
    }
  }
  async function saveSetup() {
    const { error } = await sb.rpc('st_takeaway_settings', {
      p_shop: shopId, p_enabled: $('#q-enabled').checked, p_preorder: $('#q-enabled').checked && $('#q-preorder').checked
    });
    if (error) showMsg(thaiError(error));
    else showMsg($('#q-enabled').checked ? 'เปิดรับสั่งกลับบ้านแล้ว พิมพ์ QR หรือแชร์ลิงก์ให้ลูกค้าได้เลย' : 'ปิดรับสั่งกลับบ้านแล้ว (คิวที่ค้างอยู่ยังทำต่อได้)', 'ok');
    load();
  }
  $('#q-enabled').addEventListener('change', saveSetup);
  $('#q-preorder').addEventListener('change', saveSetup);
  $('#q-copy').addEventListener('click', async () => {
    if (await copyText($('#q-link').textContent)) showMsg('คัดลอกลิงก์แล้ว', 'ok');
  });
  $('#q-print').addEventListener('click', () => { document.body.classList.add('st-print-hub'); window.print(); });
  window.addEventListener('afterprint', () => document.body.classList.remove('st-print-hub'));
  $('#q-reset').addEventListener('click', async () => {
    if (!confirm('สร้าง QR สั่งกลับบ้านใหม่?\nQR / ลิงก์เดิมที่พิมพ์หรือแชร์ไว้จะใช้ไม่ได้ทันที')) return;
    const { error } = await sb.rpc('st_reset_table_qr', { p_table: board.hub.id });
    if (error) return showMsg(thaiError(error));
    showMsg('สร้าง QR ใหม่แล้ว อย่าลืมพิมพ์ใหม่ / แชร์ลิงก์ใหม่', 'ok');
    load();
  });

  // ---------- ออกบัตรคิวหน้าร้าน ----------
  function pickupOptions() {
    const out = ['<option value="">เร็วที่สุด</option>'];
    const d = new Date(Date.now() + 15 * 60000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    for (let k = 0; k < 48; k++) {
      const x = new Date(d.getTime() + k * 15 * 60000);
      out.push(`<option value="${x.toISOString()}">${dayLabel(x)}${hhmm(x)}</option>`);
    }
    return out.join('');
  }
  $('#q-new').hidden = !canCash;
  $('#q-new').addEventListener('click', () => {
    const f = $('#q-new-form');
    f.pickup.innerHTML = pickupOptions();
    f.hidden = false; $('#q-new').hidden = true;
    f.name.focus();
  });
  $('#q-new-cancel').addEventListener('click', () => { $('#q-new-form').hidden = true; $('#q-new').hidden = false; });
  $('#q-new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    const { data, error } = await sb.rpc('st_takeaway_new', {
      p_shop: shopId, p_name: f.name.value.trim() || null, p_phone: f.phone.value.trim() || null,
      p_pickup_at: f.pickup.value || null
    });
    btn.disabled = false;
    if (error) return showMsg(thaiError(error));
    location.href = 'table.html?t=' + encodeURIComponent(data.qr_token) + '&staff=1';
  });

  // ---------- รายการคิว ----------
  const tabOf = (k) => k.status === 'closed' ? 'done' : k.ready_at ? 'ready' : 'cooking';
  // รอบ M: ส่งถึงบ้าน / มารับเอง
  function deliverHtml(k) {
    const d = deliv.get(k.table_id);
    if (!d || !d.fulfil) return dcfg.delivery && k.status !== 'closed' && canCash
      ? '<p class="st-deliver"><button type="button" class="st-chip st-chip--sm" data-act="deliver">🛵 ตั้งเป็นส่งถึงบ้าน</button></p>' : '';
    if (d.fulfil === 'pickup') return `<p class="st-deliver">🏪 มารับที่ร้าน${k.status !== 'closed' && canCash ? ' · <button type="button" class="st-chip st-chip--sm" data-act="deliver">เปลี่ยนเป็นส่ง</button>' : ''}</p>`;
    const map = d.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}` : '';
    return `<div class="st-deliver"><b>🛵 ส่งถึงบ้าน</b>${d.km != null ? ` · ${Number(d.km)} กม.` : ''} · ค่าส่ง ${baht(d.fee || 0)}
      ${d.address ? `<br>📍 ${esc(d.address)}` : ''}
      <br>${map ? `<a href="${map}" target="_blank" rel="noopener">🗺 นำทาง</a> · ` : ''}${d.phone ? `<a href="tel:${esc(d.phone)}">📞 โทร</a>` : ''}
      ${k.status !== 'closed' && canCash ? ' · <button type="button" class="st-chip st-chip--sm" data-act="deliver">แก้ค่าส่ง</button>' : ''}</div>`;
  }
  function card(k) {
    const closed = k.status === 'closed';
    const due = Number(k.due);
    const paid = Number(k.money.paid_total) > 0 && due <= 0;
    const empty = !k.orders;
    const late = !closed && !k.ready_at && k.unfinished && mins(k.opened_at) >= 20 && (!k.pickup_at || new Date(k.pickup_at) < new Date());
    const pay = empty ? '<span class="st-badge">ยังไม่มีรายการ</span>'
      : paid ? '<span class="st-badge st-badge--ok">✓ ชำระแล้ว</span>'
      : `<span class="st-badge st-badge--warn">ค้างจ่าย ${baht(due)}</span>`;
    let btns = '';
    if (!closed) {
      if (canCash) btns += `<a class="st-chip" href="table.html?t=${encodeURIComponent(k.qr_token)}&staff=1">+ สั่งเพิ่ม</a>`;
      if (canCash && due > 0) btns += `<a class="st-chip st-chip--accent" href="bill.html?id=${encodeURIComponent(shopId)}&table=${encodeURIComponent(k.table_id)}&from=queue">${k.slip_pending ? '💸 ตรวจสลิป' : 'เก็บเงิน'}</a>`;
      if (k.orders) btns += k.ready_at
        ? '<button type="button" class="st-chip" data-act="unready">ยังไม่พร้อม</button>'
        : '<button type="button" class="st-chip" data-act="ready">พร้อมรับ ✓</button>';
      if (canCash) btns += `<button type="button" class="st-btn st-btn--ok st-btn--sm" data-act="pickup">รับของแล้ว</button>`;
      if (canCash && !Number(k.money.paid_total)) btns += '<button type="button" class="st-chip st-danger" data-act="cancel">ยกเลิกคิว</button>';
    }
    return `
      <article class="st-qcard${closed ? ' st-qcard--done' : k.ready_at ? ' st-qcard--ready' : ''}${late ? ' st-qcard--late' : ''}"
               data-table="${esc(k.table_id)}" data-no="${k.queue_no}">
        <div class="st-qno"><small>คิว</small><b>${k.queue_no}</b></div>
        <div class="st-qmain">
          <div class="st-qhead">
            <b>${esc(k.contact_name || '—')}</b>
            ${k.contact_phone ? `<a href="tel:${esc(k.contact_phone)}">📞 ${esc(k.contact_phone)}</a>` : ''}
            ${pay}
            ${k.slip_pending ? '<span class="st-badge st-badge--warn">💸 สลิปรอตรวจ</span>' : ''}
          </div>
          <div class="st-qmeta">
            ${k.pickup_at ? `<span class="st-pickup">รับ ${dayLabel(k.pickup_at)}${hhmm(k.pickup_at)}</span>` : 'รับเร็วที่สุด'}
            · สั่ง ${hhmm(k.opened_at)}${k.opened_via === 'staff' ? ' (หน้าร้าน)' : ' (ออนไลน์)'}
            ${closed ? ` · ${k.picked_up_at ? 'รับของ ' + hhmm(k.picked_up_at) : 'ยกเลิก / ปิด ' + hhmm(k.closed_at)}`
                     : k.ready_at ? ` · <b class="st-ok-text">พร้อมรับตั้งแต่ ${hhmm(k.ready_at)}</b>`
                     : k.unfinished ? ` · กำลังทำ ${k.unfinished} ออร์เดอร์` : ''}
          </div>
          ${deliverHtml(k)}
          <p class="st-qitems">${k.items.filter(i => !/^🛵 /.test(i.name)).map(i => `${i.qty}× ${esc(i.name)}`).join(' · ') || '—'}</p>
          ${btns ? `<div class="st-qactions">${btns}</div>` : ''}
        </div>
      </article>`;
  }

  function render() {
    renderSetup();
    const groups = { cooking: [], ready: [], done: [] };
    board.tickets.forEach(k => groups[tabOf(k)].push(k));
    for (const g of Object.keys(groups)) $('#n-' + g).textContent = groups[g].length || '';
    document.querySelectorAll('#q-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const list = groups[tab];
    $('#q-list').innerHTML = list.length ? list.map(card).join('')
      : `<p class="st-col-empty">${tab === 'cooking' ? 'ไม่มีคิวที่กำลังทำ' : tab === 'ready' ? 'ไม่มีคิวที่รอรับ' : 'ยังไม่มีคิวที่เสร็จใน 2 ชั่วโมงล่าสุด'}</p>`;
  }
  $('#q-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    render();
  });

  $('#q-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const el = b.closest('[data-table]');
    const k = board.tickets.find(x => x.table_id === el.dataset.table);
    if (b.dataset.act === 'deliver') {
      const d = deliv.get(k.table_id) || {};
      const fee = prompt(d.fulfil === 'delivery' ? 'ค่าส่ง (บาท) · ใส่ "รับเอง" ถ้าลูกค้าจะมารับที่ร้าน' : 'ค่าส่ง (บาท) — เปลี่ยนเป็นส่งถึงบ้าน', d.fee != null ? Number(d.fee) : '');
      if (fee === null) return;
      const pickup = /รับเอง|pickup/i.test(fee);
      let addr = null;
      if (!pickup && !d.address) { addr = prompt('ที่อยู่สำหรับส่ง'); if (addr === null) return; }
      if (!pickup && !(Number(fee) >= 0)) return showMsg('ใส่ค่าส่งเป็นตัวเลข');
      const { error } = await sb.rpc('st_delivery_set', { p_table: k.table_id, p_fulfil: pickup ? 'pickup' : 'delivery', p_address: addr, p_fee: pickup ? null : Number(fee) });
      if (error) return showMsg(thaiError(error));
      showMsg('บันทึกแล้ว ✓', 'ok');
      return load();
    }
    const act = b.dataset.act;
    let error;
    if (act === 'ready' || act === 'unready') {
      ({ error } = await sb.rpc('st_takeaway_ready', { p_table: k.table_id, p_ready: act === 'ready' }));
    } else if (act === 'pickup') {
      let mode = 'pickup';
      if (Number(k.due) > 0) {
        if (!confirm(`คิว ${k.queue_no} ยังค้างจ่าย ${baht(k.due)}\nปิดคิวทั้งที่ยังไม่ได้เก็บเงิน? (บันทึกลงประวัติการทำงาน)`)) return;
        mode = 'force';
      } else if (!confirm(`คิว ${k.queue_no} ลูกค้ารับของแล้ว?`)) return;
      ({ error } = await sb.rpc('st_takeaway_close', { p_table: k.table_id, p_mode: mode }));
    } else if (act === 'cancel') {
      if (!confirm(`ยกเลิกคิว ${k.queue_no}? ออร์เดอร์ทั้งหมดของคิวนี้จะถูกยกเลิก`)) return;
      ({ error } = await sb.rpc('st_takeaway_close', { p_table: k.table_id, p_mode: 'cancel' }));
    }
    if (error) return showMsg(thaiError(error));
    load();
  });

  // ---------- Realtime ----------
  const live = $('#live');
  const filter = `shop_id=eq.${shopId}`;
  sb.channel('st-queue-' + shopId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_table_sessions', filter }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_orders', filter }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_payments', filter }, schedule)
    .subscribe((status) => {
      const ok = status === 'SUBSCRIBED';
      live.textContent = ok ? '● สด' : '○ กำลังเชื่อมต่อ…';
      live.classList.toggle('on', ok);
      if (ok) schedule();
    });

  await load();
  setInterval(() => { if (!document.hidden) load(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
