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

  // ---------- รอบ R: สิทธิ์ส่วนขยาย SmartTable (ซื้อ/ทดลองใน DarkChat) ----------
  let EXTS = null;
  async function loadExt() {
    const { data, error } = await sb.rpc('st_ext_status');
    if (error) { EXTS = null; return; }            // ยังไม่ได้รัน st-26 = ไม่มีด่าน
    EXTS = data;
    const card = $('#ext-card');
    const days = (t) => Math.max(0, Math.ceil((new Date(t) - Date.now()) / 864e5));
    const dc = esc(data.darkchat_url || 'https://bossrachun9696-stack.github.io/darkchat/');
    if (!data.ok) {
      const price = data.price ? `฿${Number(data.price).toLocaleString('th-TH')}` : '';
      card.innerHTML = `<h3>🔒 ${data.reason === 'trial_expired' ? 'หมดช่วงทดลองใช้แล้ว' : 'ยังไม่ได้เปิดใช้ SmartTable'}</h3>
        <p>SmartTable เป็นส่วนขยายของ DarkChat · เจ้าของร้านเปิดสิทธิ์ครั้งเดียว พนักงานในร้านใช้ได้ทุกคน ลูกค้าสแกน QR ไม่ต้องสมัคร</p>
        <p>${price ? `ราคา ${price}` : ''}${data.family_price ? ` · แบบครอบครัว ฿${Number(data.family_price).toLocaleString('th-TH')}` : ''}${data.trial_days && !data.trial_used ? ` · ทดลองฟรี ${data.trial_days} วัน` : ''}</p>
        <a class="st-btn" href="${dc}" target="_blank" rel="noopener">🧩 เปิด DarkChat เพื่อ${data.trial_days && !data.trial_used ? 'ทดลองใช้ / ' : ''}ซื้อสิทธิ์</a>
        <small>เปิดสิทธิ์แล้วกลับมาที่หน้านี้ กดรีเฟรช</small>`;
      card.hidden = false;
      $('#create-card').hidden = true;
    } else if (data.trial_until) {
      card.innerHTML = `<b>⏳ ทดลองใช้ SmartTable เหลือ ${days(data.trial_until)} วัน</b> · <a href="${dc}" target="_blank" rel="noopener">ซื้อสิทธิ์ที่ DarkChat</a>`;
      card.hidden = false;
    } else card.hidden = true;
  }
  await loadExt();

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
    // รอบ N: สวิตช์เปิด/ปิดร้าน + เวลาอัตโนมัติ
    const { data: hrs } = await sb.from('st_shops').select('id, hours').in('id', data.map(s => s.id));
    const H = new Map((Array.isArray(hrs) ? hrs : []).map(x => [x.id, x.hours || {}]));
    const today = String(new Date().getDay());
    const autoText = (h) => {
      if (!h || !h.auto) return '';
      const t = h.days && h.days[today];
      return ' · ⏰ ' + (t && t.on ? `${t.open}–${t.close}` : 'วันนี้ปิด');
    };
    const extBadge = (id) => {
      const x = EXTS && (EXTS.shops || []).find(r => r.shop_id === id);
      if (!x) return '';
      if (!x.licensed) return ' · <b style="color:var(--st-err)">🔒 หมดสิทธิ์ SmartTable (ลูกค้าสั่งไม่ได้)</b>';
      if (x.trial_until) return ` · ⏳ ทดลองเหลือ ${Math.max(0, Math.ceil((new Date(x.trial_until) - Date.now()) / 864e5))} วัน`;
      return '';
    };
    list.innerHTML = data.map(s => {
      const can = s.role === 'owner' || s.role === 'manager';
      return `
      <div class="st-shoprow${s.is_open ? '' : ' st-shoprow--closed'}" data-shop="${esc(s.id)}" data-name="${esc(s.name)}">
        <a class="st-item" href="shop.html?id=${encodeURIComponent(s.id)}">
          <div class="st-logo">${s.logo_path ? `<img src="${esc(ST.avatarUrl(s.logo_path))}" alt="" loading="lazy">` : esc(s.name.charAt(0))}</div>
          <div class="st-item-main">
            <b>${esc(s.name)}</b>
            <small>${esc(ROLE_TH[s.role] || s.role)} · <span data-state>${s.is_open ? '🟢 เปิดอยู่' : '🔴 ปิดร้าน'}</span>${esc(autoText(H.get(s.id)))}${s.status === 'suspended' ? ' · ถูกระงับ' : ''}${extBadge(s.id)}</small>
          </div>
          <span class="st-arrow" aria-hidden="true">›</span>
        </a>
        <label class="st-switch st-shop-switch" title="${can ? 'เปิด / ปิดร้าน' : 'เจ้าของ/ผู้จัดการเท่านั้น'}">
          <input type="checkbox" data-open${s.is_open ? ' checked' : ''}${can ? '' : ' disabled'} aria-label="เปิดร้าน ${esc(s.name)}">
          <span></span><em>${s.is_open ? 'เปิด' : 'ปิด'}</em>
        </label>
      </div>`;
    }).join('');
  }
  $('#shop-list').addEventListener('change', async (e) => {
    if (!e.target.matches('[data-open]')) return;
    const row = e.target.closest('[data-shop]');
    const want = e.target.checked;
    if (!want && !confirm(`ปิดร้าน "${row.dataset.name}" ตอนนี้?\nลูกค้าจะสแกน QR สั่งไม่ได้ จนกว่าจะเปิดอีกครั้ง`)) { e.target.checked = true; return; }
    e.target.disabled = true;
    const { data: r, error } = await sb.rpc('st_set_shop_open', { p_shop: row.dataset.shop, p_open: want });
    e.target.disabled = false;
    if (error) { e.target.checked = !want; return showMsg(thaiError(error)); }
    row.classList.toggle('st-shoprow--closed', !r.is_open);
    row.querySelector('[data-state]').textContent = r.is_open ? '🟢 เปิดอยู่' : '🔴 ปิดร้าน';
    row.querySelector('.st-shop-switch em').textContent = r.is_open ? 'เปิด' : 'ปิด';
    showMsg(`${row.dataset.name}: ${r.is_open ? 'เปิดร้านแล้ว ✓' : 'ปิดร้านแล้ว'}`, 'ok');
  });
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
