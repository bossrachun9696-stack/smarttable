// ===== หน้า ร้านของฉัน =====
(async function () {
  const { sb, configOk, $, esc, ROLE_TH, thaiError, showMsg, setBusy, ensureProfile, requireUser } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;
  history.replaceState(null, '', location.pathname);

  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('index.html'); });
  $('#btn-logout').addEventListener('click', () => sb.auth.signOut());

  // ---------- โปรไฟล์ ----------
  let profile;
  try {
    profile = await ensureProfile();
  } catch (err) {
    $('#hello').textContent = 'สวัสดี';
    $('#email').textContent = user.email;
    return showMsg(thaiError(err));
  }
  const renderMe = () => {
    $('#hello').textContent = 'สวัสดี ' + (profile.display_name || 'คุณ');
    $('#email').textContent = profile.email;
    $('#avatar').textContent = (profile.display_name || profile.email).trim().charAt(0).toUpperCase();
    $('#form-name').display_name.value = profile.display_name || '';
  };
  renderMe();
  $('#btn-edit-name').hidden = false;
  $('#btn-edit-name').addEventListener('click', () => { $('#form-name').hidden = !$('#form-name').hidden; });

  $('#form-name').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    setBusy(f, true, 'กำลังบันทึก…');
    const { data, error } = await sb.from('st_profiles')
      .update({ display_name: f.display_name.value.trim().slice(0, 60) || null })
      .eq('user_id', user.id).select().single();
    setBusy(f, false);
    if (error) return showMsg(thaiError(error));
    profile = data; renderMe(); f.hidden = true;
    showMsg('บันทึกชื่อแล้ว', 'ok');
  });

  // ---------- รายการร้าน ----------
  async function loadShops() {
    const { data, error } = await sb.rpc('st_my_shops');
    if (error) return showMsg(thaiError(error));
    const list = $('#shop-list');
    if (!data.length) {
      list.innerHTML = `<div class="st-empty"><b>ยังไม่มีร้าน</b>
        สร้างร้านแรกของคุณด้านล่าง หรือถ้าเป็นพนักงานที่ได้ลิงก์คำเชิญจากร้าน ให้เปิดลิงก์นั้น</div>`;
      return;
    }
    list.innerHTML = data.map(s => `
      <a class="st-item" href="shop.html?id=${encodeURIComponent(s.id)}">
        <div class="st-logo">${esc(s.name.charAt(0))}</div>
        <div class="st-item-main">
          <b>${esc(s.name)}</b>
          <small>${esc(ROLE_TH[s.role] || s.role)} · ${s.is_open ? 'เปิดอยู่' : 'ปิดร้าน'}${s.status === 'suspended' ? ' · ถูกระงับ' : ''}</small>
        </div>
        <span class="st-arrow" aria-hidden="true">›</span>
      </a>`).join('');
  }
  await loadShops();
  $('#home-body').hidden = false;

  // ---------- สร้างร้าน ----------
  const fs = $('#form-shop');
  const slugStatus = $('#slug-status');
  const slugHint = slugStatus.textContent;
  let timer;
  fs.slug.addEventListener('input', () => {
    const clean = fs.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (clean !== fs.slug.value) fs.slug.value = clean;
    clearTimeout(timer);
    slugStatus.className = '';
    if (clean.length < 3) { slugStatus.textContent = slugHint; return; }
    slugStatus.textContent = 'กำลังตรวจ…';
    timer = setTimeout(async () => {
      const { data, error } = await sb.rpc('st_slug_available', { p_slug: clean });
      if (fs.slug.value !== clean) return;
      if (error) { slugStatus.textContent = thaiError(error); return; }
      slugStatus.textContent = data ? '✓ ใช้ชื่อนี้ได้' : '✗ ใช้ไม่ได้ (มีคนใช้แล้ว หรือรูปแบบไม่ถูก)';
      slugStatus.className = data ? 'st-good' : 'st-bad';
    }, 400);
  });

  fs.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = fs.shop_name.value.trim();
    const slug = fs.slug.value.trim();
    if (!name) return showMsg('กรุณาใส่ชื่อร้าน');
    if (slug.length < 3) return showMsg(thaiError({ message: 'st_bad_slug' }));
    setBusy(fs, true, 'กำลังสร้างร้าน…');
    const { data, error } = await sb.rpc('st_create_shop', { p_name: name, p_slug: slug });
    setBusy(fs, false);
    if (error) return showMsg(thaiError(error));
    location.href = 'shop.html?id=' + encodeURIComponent(data.id);
  });
})();
