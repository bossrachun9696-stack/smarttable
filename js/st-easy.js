// ===== หน้าร้านรวม (easy.html?id=<shop_id>) — โหมดร้านเล็ก ทำกัน 2 คน ไม่มีพนักงาน =====
// รวม: เรื่องที่ลูกค้ารอ (เรียก / เช็กบิล / สลิป / เปิดโต๊ะ / คูปอง) · ออร์เดอร์ที่ต้องทำ · โต๊ะที่มีลูกค้า → เช็กบิล
// ใช้ RPC เดิมทั้งหมด (st_order_board, st_floor_status, st_tables_board, st_set_order_status, st_handle_call, st_confirm_table)
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, requireUser } = ST;
  if (!configOk) return;
  if (!(await requireUser())) return;
  const shopId = new URLSearchParams(location.search).get('id');
  if (!shopId) return location.replace('home.html');
  const q = encodeURIComponent(shopId);
  $('#back').href = 'shop.html?id=' + q;
  $('#to-orders').href = 'orders.html?id=' + q;
  $('#to-tables').href = 'tables.html?id=' + q;
  $('#q-menu').href = 'menu.html?id=' + q;
  $('#q-receipts').href = 'receipts.html?id=' + q;
  $('#q-reports').href = 'reports.html?id=' + q;
  $('#q-queue').href = 'queue.html?id=' + q;

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ไม่เป็นไร */ } }
  };
  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const mins = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  const ago = (m) => m < 1 ? 'เมื่อกี้' : m < 60 ? m + ' นาที' : Math.floor(m / 60) + ' ชม. ' + (m % 60) + ' น.';

  const { data: shop } = await sb.from('st_shops').select('id, name, takeaway_enabled').eq('id', shopId).maybeSingle();
  if (!shop) return showMsg('ไม่พบร้าน หรือคุณไม่มีสิทธิ์ในร้านนี้');
  $('#shop-sub').textContent = shop.name;
  $('#q-queue').hidden = !shop.takeaway_enabled;

  let board = { orders: [] }, floor = { calls: [], sessions: [] }, tables = [];

  // ---------- เสียง + จอไม่ดับ (เปิดเป็นค่าเริ่มต้น · แตะจอ 1 ครั้ง) ----------
  let audio = null, wake = null;
  let wantSound = ls.get('st-sound') !== '0';
  const wantWake = ls.get('st-wake') !== '0';
  function beep(kind) {
    if (!audio || audio.state !== 'running') return;
    let t0 = audio.currentTime + 0.02;
    for (const f of kind === 'call' ? [660, 520, 660] : [880, 1175]) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 0.3);
      t0 += 0.32;
    }
  }
  function renderSound() {
    const on = wantSound && audio && audio.state === 'running';
    $('#btn-sound').textContent = !wantSound ? '🔕 เสียงปิด' : on ? '🔔 เสียงเปิด' : '🔔 แตะจอเพื่อเปิดเสียง';
    $('#sound-hint').hidden = !wantSound || on;
  }
  async function startAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audio) { audio = new AC(); audio.onstatechange = renderSound; }
    try { await audio.resume(); } catch { /* รอแตะจอ */ }
    renderSound();
  }
  async function acquireWake() {
    if (!('wakeLock' in navigator) || wake || !wantWake || document.hidden) return;
    try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch { wake = null; }
    $('#btn-wake').hidden = false;
    $('#btn-wake').textContent = wake ? '☀️ จอไม่ดับ' : '☀️ แตะจอ';
  }
  $('#btn-sound').addEventListener('click', async (e) => {
    e.stopPropagation();
    wantSound = !(wantSound && audio && audio.state === 'running');
    ls.set('st-sound', wantSound ? '1' : '0');
    if (wantSound) { await startAudio(); beep('order'); } else if (audio) await audio.suspend().catch(() => {});
    renderSound();
  });
  const kick = () => { if (wantSound && (!audio || audio.state !== 'running')) startAudio(); if (wantWake && !wake) acquireWake(); };
  ['pointerdown', 'keydown', 'touchend'].forEach(ev => document.addEventListener(ev, kick, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { acquireWake(); load(); } });
  if (wantSound) startAudio();
  acquireWake();
  renderSound();

  // ---------- โหลด ----------
  let seenOrders = null, seenCalls = null;
  async function load() {
    const [b, f, tb] = await Promise.all([
      sb.rpc('st_order_board', { p_shop: shopId }),
      sb.rpc('st_floor_status', { p_shop: shopId }),
      sb.rpc('st_tables_board', { p_shop: shopId })
    ]);
    if (b.error) return showMsg(thaiError(b.error));
    board = b.data || board; floor = f.data || floor; tables = tb.data || [];
    // เสียงเมื่อมีของใหม่
    const oIds = new Set(board.orders.filter(o => o.status === 'new').map(o => o.id));
    const cIds = new Set(floor.calls.map(c => c.id));
    if (seenOrders && [...oIds].some(id => !seenOrders.has(id))) beep('order');
    else if (seenCalls && [...cIds].some(id => !seenCalls.has(id))) beep('call');
    seenOrders = oIds; seenCalls = cIds;
    render();
  }

  const CALL = { open: '🆕 ลูกค้าเปิดโต๊ะ รอยืนยัน', call: '🙋 เรียกพนักงาน', bill: '🧾 ขอเช็กบิล', slip: '💸 แนบสลิป รอตรวจ', coupon: '🎟 คูปอง' };
  const billUrl = (tableId) => `bill.html?id=${q}&table=${encodeURIComponent(tableId)}`;
  function render() {
    // เรื่องที่ลูกค้ารอ
    const calls = floor.calls.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    $('#e-calls').hidden = !calls.length;
    $('#e-calls').innerHTML = calls.map(c => `
      <div class="st-easy-call st-easy-call--${esc(c.kind)}" data-call="${esc(c.id)}" data-table="${esc(c.table_id)}">
        <div><b>โต๊ะ ${esc(c.table_label)} · ${CALL[c.kind] || esc(c.kind)}</b>
          <small>${c.detail ? esc(c.detail) + ' · ' : ''}${ago(mins(c.created_at))}</small></div>
        <div class="st-easy-acts">
          ${c.kind === 'open' ? `<button class="st-btn st-btn--ok" type="button" data-act="ok">✓ ยืนยัน</button><button class="st-chip" type="button" data-act="no">✗</button>`
          : c.kind === 'bill' || c.kind === 'slip' ? `<a class="st-btn" href="${billUrl(c.table_id)}">${c.kind === 'slip' ? 'ตรวจสลิป' : 'เช็กบิล'}</a><button class="st-chip" type="button" data-act="done">รับทราบ</button>`
          : `<button class="st-btn" type="button" data-act="done">รับทราบ</button>`}
        </div>
      </div>`).join('');

    // ออร์เดอร์ที่ต้องทำ (เก่าสุดก่อน)
    const active = board.orders.filter(o => ['new', 'accepted', 'cooking'].includes(o.status))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    $('#n-orders').textContent = active.length || '';
    $('#e-orders').innerHTML = active.length ? active.map(o => {
      const m = mins(o.created_at);
      const where = o.order_type === 'takeaway' ? `🛍 คิว ${esc(o.queue_no ?? o.table_label)}` : `โต๊ะ ${esc(o.table_label)}`;
      return `<article class="st-easy-order${o.status === 'new' ? ' st-easy-order--new' : ''}${m >= 20 ? ' st-easy-order--late' : ''}" data-id="${esc(o.id)}">
        <header><b>${where}</b><span>#${esc(o.order_no)} · ${ago(m)}</span></header>
        <ul>${o.items.map(i => `<li class="${i.done ? 'done' : ''}">
          ${i.image ? `<span class="st-dish-img">${ST.thumbImg(i.image)}</span>` : ''}<b>${i.qty}×</b> <span>${esc(i.name)}${(i.options || []).length ? ` <small>${esc(i.options.map(x => x.name || x).join(', '))}</small>` : ''}${i.note ? ` <small>📝 ${esc(i.note)}</small>` : ''}</span></li>`).join('')}</ul>
        ${o.note ? `<p class="st-sub">📝 ${esc(o.note)}</p>` : ''}
        <div class="st-easy-acts">${o.status === 'new'
          ? `<button class="st-btn" type="button" data-set="cooking">รับ · เริ่มทำ</button>`
          : `<button class="st-btn st-btn--ok" type="button" data-set="served">เสิร์ฟแล้ว ✓</button>`}</div>
      </article>`;
    }).join('') : '<p class="st-col-empty">ไม่มีออร์เดอร์ค้าง 👍</p>';

    // โต๊ะที่มีลูกค้า
    const sess = Object.fromEntries(floor.sessions.map(s => [s.table_id, s]));
    const callT = new Set(floor.calls.map(c => c.table_id));
    const busy = tables.filter(t => t.session);
    $('#n-tables').textContent = busy.length || '';
    $('#e-tables').innerHTML = busy.length ? `<div class="st-easy-tables">${busy.map(t => {
      const s = sess[t.id] || {};
      return `<a class="st-easy-table${callT.has(t.id) ? ' st-tile--alert' : ''}${t.session.status === 'billing' ? ' st-easy-table--bill' : ''}" href="${billUrl(t.id)}">
        <b>${esc(t.label)}</b>
        <span>${baht(s.subtotal || 0)}</span>
        <small>${ago(mins(t.session.opened_at))}${s.new_orders ? ` · ใหม่ ${s.new_orders}` : ''}${t.session.status === 'billing' ? ' · ขอบิล' : ''}</small>
      </a>`;
    }).join('')}</div><p class="st-sub" style="margin:8px 0 0">แตะโต๊ะ = เปิดหน้าเช็กบิล / รับเงิน</p>` : '<p class="st-col-empty">ยังไม่มีโต๊ะที่มีลูกค้า</p>';

    const urgent = active.filter(o => o.status === 'new').length + calls.length;
    document.title = (urgent ? `(${urgent}) ` : '') + 'หน้าร้านรวม · ' + shop.name;
  }

  // ---------- ปุ่ม ----------
  document.addEventListener('click', async (e) => {
    const set = e.target.closest('[data-set]');
    if (set) {
      set.disabled = true;
      const { error } = await sb.rpc('st_set_order_status', { p_order: set.closest('[data-id]').dataset.id, p_status: set.dataset.set });
      if (error) { set.disabled = false; return showMsg(thaiError(error)); }
      return load();
    }
    const act = e.target.closest('[data-act]');
    if (!act || !act.closest('[data-call]')) return;
    const row = act.closest('[data-call]');
    if (act.dataset.act === 'no' && !confirm('ปฏิเสธการเปิดโต๊ะนี้? ออร์เดอร์ที่สั่งไว้จะถูกยกเลิก')) return;
    act.disabled = true;
    const { error } = act.dataset.act === 'done'
      ? await sb.rpc('st_handle_call', { p_call: row.dataset.call })
      : await sb.rpc('st_confirm_table', { p_table: row.dataset.table, p_ok: act.dataset.act === 'ok' });
    if (error) { act.disabled = false; return showMsg(thaiError(error)); }
    load();
  });

  // ---------- Realtime + ดึงซ้ำสำรอง ----------
  let tmr;
  const schedule = () => { clearTimeout(tmr); tmr = setTimeout(load, 400); };
  const live = $('#live');
  const filter = `shop_id=eq.${shopId}`;
  sb.channel('st-easy-' + shopId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_orders', filter }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_service_calls', filter }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_table_sessions', filter }, schedule)
    .subscribe((status) => {
      const ok = status === 'SUBSCRIBED';
      live.textContent = ok ? '● สด' : '○ กำลังเชื่อมต่อ…';
      live.classList.toggle('on', ok);
    });
  await load();
  setInterval(() => { if (!document.hidden) load(); }, 20000);
})();
