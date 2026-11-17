// ===== จอเรียกคิว (queue-tv.html?t=<qr สั่งกลับบ้าน>) · เปิดบนทีวี / แท็บเล็ตหน้าร้าน ไม่ต้องล็อกอิน =====
// แสดงเฉพาะเลขคิว · คิวที่เพิ่งพร้อมจะกะพริบ + มีเสียง (ต้องแตะเปิดเสียง 1 ครั้ง) · อัปเดตทุก 6 วินาที
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, applyTheme } = ST;
  if (!configOk) return;
  const qr = new URLSearchParams(location.search).get('t');
  if (!qr) return showMsg('ลิงก์ไม่ถูกต้อง เปิดจากหน้า "สั่งกลับบ้าน / คิว" ของร้าน');

  let audio = null;
  function chime() {
    if (!audio) return;
    let t = audio.currentTime + 0.02;
    for (const f of [784, 988, 1319]) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(audio.destination);
      o.start(t); o.stop(t + 0.5);
      t += 0.22;
    }
  }
  $('#tv-sound').addEventListener('click', async () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audio) { audio = new AC(); await audio.resume(); chime(); }
    $('#tv-sound').hidden = true;
  });

  let seen = null, branded = false;
  const fresh = new Map();          // เลขที่เพิ่งพร้อม -> เวลา (กะพริบ 20 วินาที)
  async function load() {
    const { data, error } = await sb.rpc('st_public_queue', { p_hub_qr: qr });
    if (error) return showMsg(thaiError(error));
    if (!branded) {
      branded = true;
      $('#tv-shop').textContent = data.shop.name;
      document.title = 'จอเรียกคิว · ' + data.shop.name;
      if (data.shop.theme_color) applyTheme(data.shop.theme_color);
      if (data.shop.logo_path) {
        $('#tv-logo').src = sb.storage.from('st-images').getPublicUrl(data.shop.logo_path).data.publicUrl;
        $('#tv-logo').hidden = false;
      }
    }
    const now = Date.now();
    if (seen) {
      const newOnes = data.ready.filter(n => !seen.has(n));
      newOnes.forEach(n => fresh.set(n, now));
      if (newOnes.length) chime();
    }
    seen = new Set(data.ready);
    for (const [n, at] of fresh) if (now - at > 20000 || !seen.has(n)) fresh.delete(n);
    $('#tv-ready').innerHTML = data.ready.length
      ? data.ready.map(n => `<b class="${fresh.has(n) ? 'new' : ''}">${esc(n)}</b>`).join('')
      : '<p>—</p>';
    $('#tv-prep').innerHTML = data.preparing.length ? data.preparing.map(n => `<b>${esc(n)}</b>`).join('') : '<p>—</p>';
  }
  const tick = () => { $('#tv-clock').textContent = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); };
  tick(); setInterval(tick, 10000);
  await load();
  setInterval(load, 6000);
})();
