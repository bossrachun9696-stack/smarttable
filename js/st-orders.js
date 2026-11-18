// ===== หน้า กระดานออร์เดอร์ / จอครัว (orders.html?id=<shop_id>) =====
// เลือกสถานี (ครัว / บาร์ …) ต่อเครื่อง · แตะช่องหน้าจานเพื่อติ๊กเสร็จ · คิวกลับบ้านแสดง 🛍
// ออร์เดอร์ใหม่เด้งทันทีผ่าน Supabase Realtime + เสียงแจ้งเตือน · สำรองด้วยการรีเฟรชทุก 30 วินาที
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, requireUser } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('index.html'); });

  const shopId = new URLSearchParams(location.search).get('id');
  if (!shopId) return location.replace('home.html');
  $('#back').href = 'shop.html?id=' + encodeURIComponent(shopId);

  const [{ data: shop }, { data: me }] = await Promise.all([
    sb.from('st_shops').select('id, name').eq('id', shopId).maybeSingle(),
    sb.from('st_shop_members').select('role').eq('shop_id', shopId).eq('user_id', user.id).maybeSingle()
  ]);
  if (!shop || !me) return showMsg('ไม่พบร้านนี้ หรือคุณไม่ได้เป็นพนักงานของร้าน');
  const role = me.role;
  const canCancel = role !== 'kitchen';
  $('#shop-sub').textContent = shop.name;
  document.title = 'ออร์เดอร์ · ' + shop.name;

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ไม่เป็นไร */ } }
  };
  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const COL = { new: 'new', accepted: 'cooking', cooking: 'cooking', served: 'served', cancelled: 'served' };
  const CALL_TH = { call: '🙋 เรียกพนักงาน', bill: '🧾 ขอเช็กบิล', slip: '💸 แนบสลิปรอตรวจ', open: '🆕 ลูกค้าเปิดโต๊ะเอง' };
  // สลิปรอตรวจ: ไปหน้าเช็กบิลเพื่อยืนยัน / ปฏิเสธ (กด รับทราบ ไม่ได้)
  // ลูกค้าเปิดโต๊ะเอง (โหมด "ร้านยืนยัน"): ยืนยัน / ปฏิเสธ
  const CAN_CONFIRM = ['owner', 'manager', 'cashier', 'waiter'].includes(role);
  const callBtn = (c) => c.kind === 'open'
    ? (CAN_CONFIRM
        ? `<span class="st-confirm-actions"><button type="button" class="st-chip st-chip--accent" data-act="tbl-ok" data-table="${esc(c.table_id)}">✓ ยืนยัน</button><button type="button" class="st-chip" data-act="tbl-no" data-table="${esc(c.table_id)}">✗ ปฏิเสธ</button></span>`
        : '<small>รอพนักงานยืนยัน</small>')
    : c.kind === 'slip'
    ? `<a class="st-chip st-chip--accent" href="bill.html?id=${encodeURIComponent(shopId)}&table=${encodeURIComponent(c.table_id)}">ตรวจสลิป</a>`
    : '<button type="button" class="st-chip" data-act="call-done">รับทราบ</button>';

  let orders = [];
  let calls = [];
  let stations = [];
  // สถานีที่จอนี้ดู ('' = ทุกสถานี) · จำแยกเครื่อง
  const KEY_STATION = 'st-station:' + shopId;
  let station = ls.get(KEY_STATION) || '';
  let offset = 0;                 // เวลาเซิร์ฟเวอร์ - เวลาเครื่อง
  let seenOrders = null;          // id ที่เคยเห็น (null = ยังไม่โหลดครั้งแรก)
  let seenCalls = null;
  let tab = 'new';

  // ---------- โหมดครัว (ตัวใหญ่ ไม่แสดงราคา) ----------
  let kitchen = ls.get('st-kitchen-mode') ? ls.get('st-kitchen-mode') === '1' : role === 'kitchen';
  const applyMode = () => {
    document.body.classList.toggle('st-kitchen', kitchen);
    $('#btn-mode').textContent = kitchen ? 'โหมดปกติ' : 'โหมดครัว';
  };
  $('#btn-mode').addEventListener('click', () => { kitchen = !kitchen; ls.set('st-kitchen-mode', kitchen ? '1' : '0'); applyMode(); });
  applyMode();

  // ---------- เสียงแจ้งเตือน (ต้องแตะเปิด 1 ครั้งตามกติกาของเบราว์เซอร์) ----------
  let audio = null;
  function beep(kind) {
    if (!audio) return;
    const tones = kind === 'call' ? [660, 520, 660] : [880, 1175];
    let t = audio.currentTime + 0.02;
    for (const f of tones) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(audio.destination);
      o.start(t); o.stop(t + 0.3);
      t += 0.32;
    }
  }
  $('#sound-hint').hidden = false;
  $('#btn-sound').addEventListener('click', async () => {
    if (audio) { audio.close(); audio = null; }
    else {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return showMsg('เครื่องนี้เล่นเสียงแจ้งเตือนไม่ได้');
      audio = new AC();
      await audio.resume();
      beep('order');
    }
    $('#btn-sound').textContent = audio ? '🔔 เสียงเปิด' : '🔕 เปิดเสียง';
    $('#sound-hint').hidden = !!audio;
  });

  // ---------- จอไม่ดับ (Wake Lock) · ระบบปล่อยเองเมื่อสลับแอป จึงขอใหม่เมื่อกลับมา ----------
  let wake = null, wantWake = false;
  if ('wakeLock' in navigator) {
    const btn = $('#btn-wake');
    btn.hidden = false;
    const renderWake = () => { btn.textContent = wake ? '☀️ จอไม่ดับ: เปิด' : 'จอไม่ดับ'; };
    const acquire = async () => {
      try {
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => { wake = null; renderWake(); });
      } catch {
        wake = null;
        showMsg('เปิดโหมดจอไม่ดับไม่ได้ ใช้ตั้งค่า > จอภาพ > ล็อกอัตโนมัติ > "ไม่ใช้" แทนได้');
      }
      renderWake();
    };
    btn.addEventListener('click', async () => {
      wantWake = !wake;
      if (wantWake) await acquire();
      else { await wake.release(); wake = null; renderWake(); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && wantWake && !wake) acquire(); });
  }

  // ---------- เวลา ----------
  const nowMs = () => Date.now() + offset;
  const mins = (iso) => Math.max(0, Math.floor((nowMs() - new Date(iso).getTime()) / 60000));
  const ageText = (m) => m < 1 ? 'เมื่อกี้' : m < 60 ? m + ' นาที' : Math.floor(m / 60) + ' ชม. ' + (m % 60) + ' นาที';

  // ---------- โหลด ----------
  let loading = false, again = false;
  async function load() {
    if (loading) { again = true; return; }
    loading = true;
    const [b, f] = await Promise.all([
      sb.rpc('st_order_board', { p_shop: shopId }),
      sb.rpc('st_floor_status', { p_shop: shopId })
    ]);
    loading = false;
    if (b.error) { showMsg(thaiError(b.error)); }
    else {
      offset = new Date(b.data.now).getTime() - Date.now();
      orders = b.data.orders;
      stations = b.data.stations || [];
      if (station && !stations.some(x => x.id === station)) station = '';
      const ids = new Set(orders.map(o => o.id));
      if (seenOrders && orders.some(o => o.status === 'new' && !seenOrders.has(o.id))) {
        beep('order');
        flash();
      }
      seenOrders = ids;
    }
    if (!f.error) {
      calls = f.data.calls;
      const cids = new Set(calls.map(c => c.id));
      if (seenCalls && calls.some(c => !seenCalls.has(c.id))) beep('call');
      seenCalls = cids;
    }
    render();
    $('#board').hidden = false;
    if (again) { again = false; load(); }
  }
  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 300); };

  function flash() {
    document.body.classList.remove('st-flash');
    void document.body.offsetWidth;
    document.body.classList.add('st-flash');
  }

  // ---------- แสดงผล ----------
  // จานของสถานีที่เลือก (จานที่ไม่มีสถานี = ขึ้นทุกสถานี)
  const myItems = (o) => station ? o.items.filter(i => !i.station_id || i.station_id === station) : o.items;
  function colOf(o) {
    if (o.status === 'cancelled') return 'served';
    if (station) {
      const its = myItems(o);
      if (its.length && its.every(i => i.done)) return 'served';
      return o.status === 'new' ? 'new' : 'cooking';
    }
    return COL[o.status];
  }
  const hhmm = (iso) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  const isTicket = (o) => o.order_type === 'takeaway';
  const placeLabel = (o) => isTicket(o) ? `🛍 คิว ${o.queue_no}` : `โต๊ะ ${esc(o.table_label)}`;

  function card(o) {
    const m = mins(o.created_at);
    const open = o.status === 'new' || o.status === 'accepted' || o.status === 'cooking';
    const col = colOf(o);
    const its = myItems(o);
    const left = its.filter(i => !i.done);
    const age = col === 'served' ? '' : m >= 20 ? ' st-ocard--late' : m >= 10 ? ' st-ocard--slow' : '';
    let btns = '';
    if (o.status === 'new') btns = `<button type="button" class="st-btn" data-set="cooking">รับ · เริ่มทำ</button>`;
    else if (station && open && left.length) btns = `<button type="button" class="st-btn st-btn--ok" data-done-all>เสร็จ ${left.length} จาน ✓</button>`;
    else if (!station && (o.status === 'accepted' || o.status === 'cooking')) btns = `<button type="button" class="st-btn st-btn--ok" data-set="served">เสิร์ฟแล้ว ✓</button>`;
    else if (o.status === 'served' && !station) btns = `<button type="button" class="st-chip" data-set="cooking">ย้อนกลับไปกำลังทำ</button>`;
    if (canCancel && open && !station) btns += `<button type="button" class="st-chip" data-set="cancelled">ยกเลิก</button>`;
    const pickSoon = o.pickup_at ? `<span class="st-pickup">รับ ${hhmm(o.pickup_at)}</span>` : '';
    const others = station ? o.items.length - its.length : 0;
    return `
      <article class="st-ocard st-ocard--${o.status}${age}${isTicket(o) ? ' st-ocard--ta' : ''}" data-id="${esc(o.id)}" data-no="${o.order_no}">
        <header>
          <b class="st-ocard-table">${placeLabel(o)}</b>
          <span class="st-ocard-no">#${o.order_no}</span>
          <time>${o.status === 'cancelled' ? 'ยกเลิก' : col !== 'served' ? ageText(m) : 'เสร็จแล้ว'}</time>
        </header>
        <div class="st-ocard-meta">${hhmm(o.created_at)}${isTicket(o) ? ' · กลับบ้าน' + (o.contact_name ? ' · ' + esc(o.contact_name) : '') : ''}${o.guest_name && !isTicket(o) ? ' · ' + esc(o.guest_name) : ''}${o.zone ? ' · ' + esc(o.zone) : ''}${o.source === 'staff' ? ' · พนักงานสั่ง' : ''} ${pickSoon}${o.confirm_pending && o.status !== 'cancelled' ? ' <em class="st-badge st-badge--wait">⚠ โต๊ะยังไม่ยืนยัน</em>' : ''}</div>
        <ul class="st-ocard-items">
          ${its.map(i => `
            <li class="${i.done ? 'done' : ''}">
              <button type="button" class="st-dish" data-item="${esc(i.id)}" ${o.status === 'cancelled' ? 'disabled' : ''} aria-pressed="${i.done}" aria-label="${i.done ? 'เอาติ๊กออก' : 'ติ๊กว่าเสร็จ'}">${i.done ? '✓' : ''}</button>
              <b>${i.qty}×</b> <span>${esc(i.name)}
              ${i.options.length ? `<small>${esc(i.options.map(x => x.name).join(' · '))}</small>` : ''}
              ${i.note ? `<em>📝 ${esc(i.note)}</em>` : ''}</span></li>`).join('')}
        </ul>
        ${others ? `<p class="st-ocard-other">+ อีก ${others} รายการที่สถานีอื่น</p>` : ''}
        ${o.note ? `<p class="st-ocard-note">📝 ${esc(o.note)}</p>` : ''}
        <footer>${btns}<span class="st-ocard-sum">${station ? '' : baht(o.subtotal)}</span></footer>
      </article>`;
  }

  function renderStations() {
    const box = $('#stations');
    box.hidden = !stations.length;
    if (!stations.length) return;
    box.innerHTML = [{ id: '', name: 'ทุกสถานี' }, ...stations].map(x =>
      `<button type="button" class="st-chip" data-station="${esc(x.id)}" aria-pressed="${x.id === station}">${esc(x.name)}</button>`).join('');
  }

  function render() {
    // การเรียก
    $('#calls').innerHTML = calls.map(c => `
      <div class="st-call st-call--${c.kind}" data-call="${esc(c.id)}">
        <span><b>${/^คิว /.test(c.table_label) ? '🛍 ' + esc(c.table_label.replace(/ \(.*\)$/, '')) : 'โต๊ะ ' + esc(c.table_label)}</b> ${CALL_TH[c.kind]} · ${ageText(mins(c.created_at))}</span>
        ${callBtn(c)}
      </div>`).join('');

    renderStations();
    const cols = { new: [], cooking: [], served: [] };
    orders.filter(o => myItems(o).length).forEach(o => cols[colOf(o)].push(o));
    cols.served.reverse();                                // เสร็จล่าสุดอยู่บน
    for (const k of Object.keys(cols)) {
      const sec = document.querySelector(`[data-col="${k}"]`);
      sec.querySelector('.n').textContent = cols[k].length || '';
      sec.querySelector('.st-col-list').innerHTML = cols[k].length ? cols[k].map(card).join('')
        : `<p class="st-col-empty">${k === 'new' ? 'ยังไม่มีออร์เดอร์ใหม่' : k === 'cooking' ? 'ไม่มีรายการที่กำลังทำ' : 'ยังไม่มีรายการที่เสร็จ'}</p>`;
      sec.classList.toggle('on', tab === k);
      $('#n-' + k).textContent = cols[k].filter(o => o.status !== 'cancelled').length;
    }
    document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  }

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    render();
  });

  // ---------- ปุ่มบนการ์ด ----------
  $('#stations').addEventListener('click', (e) => {
    const b = e.target.closest('[data-station]');
    if (!b) return;
    station = b.dataset.station;
    ls.set(KEY_STATION, station || null);
    render();
  });

  // ติ๊กเสร็จรายจาน / ทั้งสถานี
  async function setDone(ids, done, cardEl) {
    if (!ids.length) return;
    cardEl.querySelectorAll('button').forEach(x => x.disabled = true);
    const { error } = await sb.rpc('st_set_items_done', { p_items: ids, p_done: done });
    if (error) {
      cardEl.querySelectorAll('button').forEach(x => x.disabled = false);
      return showMsg(thaiError(error));
    }
    const o = orders.find(x => x.id === cardEl.dataset.id);
    if (o) {
      o.items.forEach(i => { if (ids.includes(i.id)) i.done = done; });
      if (o.items.every(i => i.done)) o.status = 'served';
      else if (o.status === 'served' || (done && ['new', 'accepted'].includes(o.status))) o.status = 'cooking';
      o.updated_at = new Date(nowMs()).toISOString();
    }
    render();
    schedule();
  }

  $('#board').addEventListener('click', async (e) => {
    const dish = e.target.closest('[data-item]');
    if (dish) {
      const cardEl = dish.closest('[data-id]');
      return setDone([dish.dataset.item], dish.getAttribute('aria-pressed') !== 'true', cardEl);
    }
    const all = e.target.closest('[data-done-all]');
    if (all) {
      const cardEl = all.closest('[data-id]');
      const o = orders.find(x => x.id === cardEl.dataset.id);
      return setDone(myItems(o).filter(i => !i.done).map(i => i.id), true, cardEl);
    }
    const b = e.target.closest('[data-set]');
    if (!b) return;
    const cardEl = b.closest('[data-id]');
    const st = b.dataset.set;
    if (st === 'cancelled' && !confirm(`ยกเลิกออร์เดอร์ #${cardEl.dataset.no}? ยอดจะถูกหักออกจากบิล`)) return;
    cardEl.querySelectorAll('button').forEach(x => x.disabled = true);
    const { error } = await sb.rpc('st_set_order_status', { p_order: cardEl.dataset.id, p_status: st });
    if (error) {
      cardEl.querySelectorAll('button').forEach(x => x.disabled = false);
      return showMsg(thaiError(error));
    }
    const o = orders.find(x => x.id === cardEl.dataset.id);
    if (o) { o.status = st; o.updated_at = new Date(nowMs()).toISOString(); if (st === 'served') o.items.forEach(i => { i.done = true; }); }   // แสดงทันที ไม่ต้องรอ
    render();
    schedule();
  });


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
    calls = calls.filter(c => c.id !== b.closest('[data-call]').dataset.call);
    render();
    schedule();
  });

  // ---------- Realtime ----------
  const live = $('#live');
  const setLive = (ok) => { live.textContent = ok ? '● สด' : '○ กำลังเชื่อมต่อ…'; live.classList.toggle('on', ok); };
  const filter = `shop_id=eq.${shopId}`;
  sb.channel('st-orders-' + shopId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_orders', filter }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'st_service_calls', filter }, schedule)
    .subscribe((status) => {
      setLive(status === 'SUBSCRIBED');
      if (status === 'SUBSCRIBED') schedule();            // ต่อใหม่ได้ = โหลดใหม่ กันพลาดช่วงหลุด
    });

  await load();
  setInterval(() => { if (!document.hidden) load(); }, 30000);   // สำรองกรณี Realtime หลุด
  setInterval(render, 30000);                                       // อัปเดตจำนวนนาที
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
