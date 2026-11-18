// ===== หน้า ร้านของฉัน =====
(async function () {
  const { sb, configOk, $, esc, ROLE_TH, thaiError, showMsg, setBusy, ensureProfile, requireUser } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;
  history.replaceState(null, '', location.pathname);

  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('index.html'); });

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
    $('#email').textContent = (profile.public_id ? '@' + profile.public_id + ' · ' : '') + profile.email;
    const url = ST.avatarUrl(profile.avatar_path);
    $('#avatar').innerHTML = url ? `<img src="${esc(url)}" alt="">` : esc((profile.display_name || profile.email).trim().charAt(0).toUpperCase());
  };
  renderMe();
  // ไอดี / รูป / ธีม จากบัญชี (ไฟล์ st-14) — ถ้ายังไม่ได้รัน st-14 ก็ข้ามไป
  sb.rpc('st_my_profile').then(({ data }) => {
    if (!data) return;
    profile = Object.assign(profile, data);
    if (data.prefs && (data.prefs.theme || data.prefs.layout)) ST.setPrefs(data.prefs);
    renderMe();
  });

  // ---------- คำเชิญถึงฉัน ----------
  async function loadInvites() {
    const { data, error } = await sb.rpc('st_my_invites');
    const box = $('#my-invites');
    if (error || !data || !data.length) { box.hidden = true; return; }
    box.innerHTML = `<h3>📩 คำเชิญเข้าร้าน</h3>` + data.map(i => `
      <div class="st-item st-item--flat" data-invite="${esc(i.id)}" data-token="${esc(i.token)}">
        <div class="st-logo">${i.shop_logo ? `<img src="${esc(ST.avatarUrl(i.shop_logo))}" alt="">` : esc(i.shop_name.charAt(0))}</div>
        <div class="st-item-main"><b>${esc(i.shop_name)}</b>
          <small>เป็น${esc(ROLE_TH[i.role] || i.role)}${i.invited_by ? ' · เชิญโดย ' + esc(i.invited_by) : ''} · หมดอายุ ${new Date(i.expires_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</small></div>
        <button type="button" class="st-btn st-btn--sm" data-act="accept">รับ</button>
        <button type="button" class="st-chip" data-act="decline">ไม่รับ</button>
      </div>`).join('');
    box.hidden = false;
  }
  $('#my-invites').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const row = b.closest('[data-invite]');
    b.disabled = true;
    if (b.dataset.act === 'accept') {
      const { data, error } = await sb.rpc('st_accept_invite', { p_token: row.dataset.token });
      if (error) { b.disabled = false; return showMsg(thaiError(error)); }
      return location.href = 'shop.html?id=' + encodeURIComponent(data);
    }
    if (!confirm('ไม่รับคำเชิญนี้?')) { b.disabled = false; return; }
    const { error } = await sb.rpc('st_decline_invite', { p_invite: row.dataset.invite });
    if (error) { b.disabled = false; return showMsg(thaiError(error)); }
    showMsg('ปฏิเสธคำเชิญแล้ว', 'ok');
    loadInvites();
  });
  loadInvites();

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
        <div class="st-logo">${s.logo_path ? `<img src="${esc(ST.avatarUrl(s.logo_path))}" alt="" loading="lazy">` : esc(s.name.charAt(0))}</div>
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
