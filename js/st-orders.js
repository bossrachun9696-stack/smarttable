// ===== หน้า กระดานออร์เดอร์ / จอครัว (orders.html?id=<shop_id>) =====
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
  const CALL_TH = { call: '🙋 เรียกพนักงาน', bill: '🧾 ขอเช็กบิล' };

  let orders = [];
  let calls = [];
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
  function card(o) {
    const m = mins(o.created_at);
    const open = o.status === 'new' || o.status === 'accepted' || o.status === 'cooking';
    const age = !open ? '' : m >= 20 ? ' st-ocard--late' : m >= 10 ? ' st-ocard--slow' : '';
    let btns = '';
    if (o.status === 'new') btns = `<button type="button" class="st-btn" data-set="cooking">รับ · เริ่มทำ</button>`;
    else if (o.status === 'accepted' || o.status === 'cooking') btns = `<button type="button" class="st-btn st-btn--ok" data-set="served">เสิร์ฟแล้ว ✓</button>`;
    else if (o.status === 'served') btns = `<button type="button" class="st-chip" data-set="cooking">ย้อนกลับไปกำลังทำ</button>`;
    if (canCancel && open) btns += `<button type="button" class="st-chip" data-set="cancelled">ยกเลิก</button>`;
    return `
      <article class="st-ocard st-ocard--${o.status}${age}" data-id="${esc(o.id)}" data-no="${o.order_no}">
        <header>
          <b class="st-ocard-table">โต๊ะ ${esc(o.table_label)}</b>
          <span class="st-ocard-no">#${o.order_no}</span>
          <time>${o.status === 'cancelled' ? 'ยกเลิก' : open ? ageText(m) : 'เสิร์ฟแล้ว'}</time>
        </header>
        <div class="st-ocard-meta">${new Date(o.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}${o.guest_name ? ' · ' + esc(o.guest_name) : ''}${o.zone ? ' · ' + esc(o.zone) : ''}${o.source === 'staff' ? ' · พนักงานสั่ง' : ''}</div>
        <ul class="st-ocard-items">
          ${o.items.map(i => `
            <li><b>${i.qty}×</b> <span>${esc(i.name)}
              ${i.options.length ? `<small>${esc(i.options.map(x => x.name).join(' · '))}</small>` : ''}
              ${i.note ? `<em>📝 ${esc(i.note)}</em>` : ''}</span></li>`).join('')}
        </ul>
        ${o.note ? `<p class="st-ocard-note">📝 ${esc(o.note)}</p>` : ''}
        <footer>${btns}<span class="st-ocard-sum">${baht(o.subtotal)}</span></footer>
      </article>`;
  }

  function render() {
    // การเรียก
    $('#calls').innerHTML = calls.map(c => `
      <div class="st-call st-call--${c.kind}" data-call="${esc(c.id)}">
        <span><b>โต๊ะ ${esc(c.table_label)}</b> ${CALL_TH[c.kind]} · ${ageText(mins(c.created_at))}</span>
        <button type="button" class="st-chip" data-act="call-done">รับทราบ</button>
      </div>`).join('');

    const cols = { new: [], cooking: [], served: [] };
    orders.forEach(o => cols[COL[o.status]].push(o));
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
  $('#board').addEventListener('click', async (e) => {
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
    if (o) { o.status = st; o.updated_at = new Date(nowMs()).toISOString(); }   // แสดงทันที ไม่ต้องรอ
    render();
    schedule();
  });

  $('#calls').addEventListener('click', async (e) => {
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
