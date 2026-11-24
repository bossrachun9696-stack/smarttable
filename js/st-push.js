// ===== แจ้งเตือน Push ของแอป SmartTable (st-31) =====
// ใช้กุญแจ VAPID ชุดเดียวกับ DarkChat (กุญแจสาธารณะ ใส่ในหน้าเว็บได้) · ส่งจาก Edge Function st-push
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg } = ST;
  if (!configOk) return;
  const card = $('#push-card');
  if (!card) return;
  const VAPID = 'BER6LQz_eP4lom4aKw1ibGZosJGSxBqjIwKEt3E9AeTfP1ptzKXiyGh7kWw__ebwkN7ar34LbYT6dnEpdpIrmIg';
  const text = $('#push-text'), btn = $('#push-btn'), shops = $('#push-shops');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  card.hidden = false;

  if (!ok) {
    btn.hidden = true;
    text.textContent = ios && !standalone
      ? 'iPhone/iPad: กดปุ่มแชร์ > "เพิ่มไปยังหน้าจอโฮม" แล้วเปิด SmartTable จากไอคอน จึงเปิดแจ้งเตือนได้'
      : 'เบราว์เซอร์นี้ไม่รองรับแจ้งเตือน ลองใช้ Chrome หรือติดตั้งเป็นแอป';
    return;
  }
  const b64 = (s) => {
    const p = '='.repeat((4 - s.length % 4) % 4);
    const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...r].map(c => c.charCodeAt(0)));
  };
  let reg = null;
  const getReg = async () => {
    if (reg) return reg;
    reg = await navigator.serviceWorker.getRegistration() || await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    return reg;
  };

  async function render() {
    let sub = null;
    try { sub = await (await getReg()).pushManager.getSubscription(); } catch { /* ยังไม่มี */ }
    const { data, error } = await sb.rpc('st_push_status', { p_endpoint: sub ? sub.endpoint : '' });
    if (error) { if (/st_push_status/.test(error.message || '')) card.hidden = true; return; }
    const on = !!(sub && data.on && Notification.permission === 'granted');
    btn.textContent = on ? 'ปิด' : 'เปิด';
    btn.className = 'st-btn st-btn--sm' + (on ? ' st-btn--ghost' : '');
    btn.disabled = false;
    if (Notification.permission === 'denied') {
      text.textContent = 'ถูกบล็อกการแจ้งเตือนไว้: เปิดได้ที่ตั้งค่าเว็บไซต์ของเบราว์เซอร์ > การแจ้งเตือน > อนุญาต';
    } else {
      text.textContent = on ? 'เปิดอยู่บนเครื่องนี้ · เลือกปิดเสียงรายร้านได้ด้านล่าง'
        : 'มีคนสั่งอาหาร เรียกพนักงาน หรือเปิดโต๊ะ เด้งแจ้งแม้ปิดแอปอยู่';
    }
    shops.hidden = !on || !(data.shops || []).length;
    shops.innerHTML = (data.shops || []).map(s => `
      <label class="st-check"><input type="checkbox" data-mute="${esc(s.id)}"${s.muted ? '' : ' checked'}>
        <span>${esc(s.name)}${s.role === 'kitchen' ? '<small>ครัว: แจ้งเฉพาะออร์เดอร์</small>' : ''}</span></label>`).join('');
    card.dataset.endpoint = sub ? sub.endpoint : '';
    card.dataset.on = on ? '1' : '';
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const r = await getReg();
      if (card.dataset.on) {
        const sub = await r.pushManager.getSubscription();
        if (sub) { await sb.rpc('st_push_remove', { p_endpoint: sub.endpoint }); await sub.unsubscribe().catch(() => null); }
        showMsg('ปิดแจ้งเตือนบนเครื่องนี้แล้ว', 'ok');
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { showMsg('ยังไม่ได้อนุญาตการแจ้งเตือน'); return render(); }
        let sub = await r.pushManager.getSubscription();
        if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID) });
        const j = sub.toJSON();
        const { error } = await sb.rpc('st_push_save', { p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
        if (error) { showMsg(thaiError(error)); return render(); }
        showMsg('เปิดแจ้งเตือนแล้ว ✓ ลองให้มีคนสั่งอาหารดู', 'ok');
      }
    } catch (e) {
      showMsg('เปิดแจ้งเตือนไม่ได้: ' + (e && e.message || e));
    }
    render();
  });

  shops.addEventListener('change', async (e) => {
    const cb = e.target.closest('[data-mute]');
    if (!cb) return;
    cb.disabled = true;
    const { error } = await sb.rpc('st_push_mute', { p_endpoint: card.dataset.endpoint, p_shop: cb.dataset.mute, p_muted: !cb.checked });
    cb.disabled = false;
    if (error) { cb.checked = !cb.checked; showMsg(thaiError(error)); }
  });

  render();
})();
