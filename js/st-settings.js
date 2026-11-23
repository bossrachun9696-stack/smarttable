// ===== หน้า ตั้งค่า (settings.html) =====
// โปรไฟล์: รูป ชื่อ ไอดี (ให้ร้านเพิ่มเป็นพนักงานด้วยไอดี) · ธีม · รูปแบบหน้าจัดการร้าน · ออกจากระบบ
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, setBusy, requireUser, copyText, shrinkImage,
          getPrefs, setPrefs, avatarUrl } = ST;
  if (!configOk) return;
  const user = await requireUser();
  if (!user) return;
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('index.html'); });
  const back = new URLSearchParams(location.search).get('back');
  if (back && /^[a-z-]+\.html(\?[\w=&%.-]*)?$/.test(back)) $('#back').href = back;

  const { data: prof, error } = await sb.rpc('st_my_profile');
  if (error) return showMsg(thaiError(error));
  let me = prof;
  // ค่าที่บันทึกไว้ในบัญชีชนะค่าในเครื่อง (ล็อกอินเครื่องใหม่ได้ธีมเดิม)
  if (me.prefs && (me.prefs.theme || me.prefs.layout)) setPrefs(me.prefs);

  const f = $('#form-prof');
  function render() {
    const url = avatarUrl(me.avatar_path);
    $('#av-box').innerHTML = url ? `<img src="${esc(url)}" alt="">` : esc((me.display_name || me.email || '·').trim().charAt(0).toUpperCase());
    $('#av-del').hidden = !me.avatar_path;
    f.display_name.value = me.display_name || '';
    f.public_id.value = me.public_id || '';
    $('#me-email').value = me.email || '';
    const p = getPrefs();
    document.querySelectorAll('#theme-opts [data-theme]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.theme === p.theme)));
    document.querySelectorAll('#layout-opts [data-layout]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.layout === p.layout)));
    document.querySelectorAll('#width-opts [data-width]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.width === ST.getWidth())));
  }
  render();
  $('#set-body').hidden = false;

  // ---------- ชื่อ + ไอดี ----------
  f.public_id.addEventListener('input', () => {
    const v = f.public_id.value.toLowerCase().replace(/[^a-z0-9_.]/g, '');
    if (v !== f.public_id.value) f.public_id.value = v;
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pid = f.public_id.value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.]{3,19}$/.test(pid)) return showMsg(thaiError({ message: 'st_bad_public_id' }));
    setBusy(f, true, 'กำลังบันทึก…');
    const { data, error: err } = await sb.rpc('st_update_profile', { p: { display_name: f.display_name.value.trim(), public_id: pid } });
    setBusy(f, false);
    if (err) return showMsg(thaiError(err));
    me = data; render();
    showMsg('บันทึกโปรไฟล์แล้ว', 'ok');
  });
  const idText = () => `ไอดี SmartTable ของฉัน: @${me.public_id}\nใช้เพิ่มฉันเป็นพนักงานที่ร้าน → หน้าร้าน › พนักงาน › เชิญด้วยไอดี`;
  $('#id-copy').addEventListener('click', async () => {
    if (await copyText(me.public_id)) showMsg('คัดลอกไอดีแล้ว', 'ok');
  });
  $('#id-share').addEventListener('click', async () => {
    const text = idText();
    if (navigator.share) {
      try { await navigator.share({ title: 'ไอดี SmartTable', text }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
    if (await copyText(text)) showMsg('คัดลอกข้อความพร้อมไอดีแล้ว วางส่งให้ร้านทาง DarkChat หรือ LINE ได้เลย', 'ok');
  });

  // ---------- รูปโปรไฟล์ ----------
  $('#av-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let blob;
    try { blob = await shrinkImage(file, 400, 0.85); } catch { return showMsg('อ่านรูปนี้ไม่ได้ ลองรูปอื่น'); }
    showMsg('กำลังอัปโหลด…', 'ok');
    const path = `users/${user.id}/avatar-${Date.now()}.jpg`;
    const { error: upErr } = await sb.storage.from('st-images').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (upErr) return showMsg('อัปโหลดไม่สำเร็จ: ' + thaiError(upErr));
    const old = me.avatar_path;
    const { data, error: err } = await sb.rpc('st_update_profile', { p: { avatar_path: path } });
    if (err) return showMsg(thaiError(err));
    me = data; render();
    if (old) sb.storage.from('st-images').remove([old]);
    showMsg('เปลี่ยนรูปโปรไฟล์แล้ว', 'ok');
  });
  $('#av-del').addEventListener('click', async () => {
    if (!me.avatar_path || !confirm('ลบรูปโปรไฟล์?')) return;
    const old = me.avatar_path;
    const { data, error: err } = await sb.rpc('st_update_profile', { p: { avatar_path: null } });
    if (err) return showMsg(thaiError(err));
    me = data; render();
    sb.storage.from('st-images').remove([old]);
    showMsg('ลบรูปแล้ว', 'ok');
  });

  // ---------- ธีม / รูปแบบหน้าร้าน (ใช้ทันที + บันทึกลงบัญชี) ----------
  async function savePrefs(patch, okText) {
    setPrefs(patch);
    render();
    const { error: err } = await sb.rpc('st_update_profile', { p: { prefs: patch } });
    showMsg(err ? 'ใช้กับเครื่องนี้แล้ว แต่บันทึกลงบัญชีไม่สำเร็จ: ' + thaiError(err) : okText, err ? undefined : 'ok');
  }
  $('#theme-opts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]');
    if (b) savePrefs({ theme: b.dataset.theme }, 'เปลี่ยนธีมแล้ว');
  });
  $('#width-opts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-width]');
    if (!b) return;
    ST.setWidth(b.dataset.width);
    render();
    showMsg('เปลี่ยนขนาดหน้าจอแล้ว (เครื่องนี้)', 'ok');
  });
  $('#layout-opts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-layout]');
    if (b) savePrefs({ layout: b.dataset.layout }, 'เปลี่ยนรูปแบบแล้ว — เปิดหน้าร้านเพื่อดู');
  });

  $('#btn-logout').addEventListener('click', () => { if (confirm('ออกจากระบบ?')) sb.auth.signOut(); });
})();
