// ===== หน้า จัดการร้าน =====
(async function () {
  const { sb, configOk, $, esc, ROLE_TH, thaiError, pageUrl, showMsg, setBusy, requireUser, copyText, shrinkImage } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('index.html'); });

  const shopId = new URLSearchParams(location.search).get('id');
  if (!shopId) return location.replace('home.html');

  const { data: shop, error: shopErr } = await sb.from('st_shops').select('*').eq('id', shopId).maybeSingle();
  if (shopErr) return showMsg(thaiError(shopErr));
  if (!shop) { $('#shop-name').textContent = 'ไม่พบร้าน'; return showMsg('ไม่พบร้านนี้ หรือคุณไม่ได้เป็นพนักงานของร้าน'); }

  const { data: me } = await sb.from('st_shop_members').select('role')
    .eq('shop_id', shopId).eq('user_id', user.id).maybeSingle();
  const role = me ? me.role : null;
  const isOwner = role === 'owner';
  const canManage = isOwner || role === 'manager';
  let current = shop;
  $('#link-reports').hidden = !canManage;
  $('#link-audit').hidden = !canManage;

  $('#my-role').textContent = 'คุณ: ' + (ROLE_TH[role] || '-');
  const renderHead = () => {
    $('#shop-name').textContent = current.name;
    $('#shop-sub').textContent = `ลิงก์ร้าน: ${current.slug} · ${current.is_open ? 'เปิดรับออร์เดอร์' : 'ปิดร้าน'}`
      + (current.status === 'suspended' ? ' · ถูกระงับ' : '');
    document.title = current.name + ' · SmartTable';
  };
  renderHead();
  $('#link-menu').href = 'menu.html?id=' + encodeURIComponent(shopId);
  $('#link-orders').href = 'orders.html?id=' + encodeURIComponent(shopId);
  $('#link-reports').href = 'reports.html?id=' + encodeURIComponent(shopId);
  $('#link-audit').href = 'audit.html?id=' + encodeURIComponent(shopId);
  $('#link-receipts').href = 'receipts.html?id=' + encodeURIComponent(shopId);
  $('#link-tables').href = 'tables.html?id=' + encodeURIComponent(shopId);
  $('#shop-body').hidden = false;

  // ---------- รูปแบบการสั่งอาหาร (บันทึกทันทีเมื่อเลือก) ----------
  const fm = $('#form-mode');
  fm.querySelectorAll('input[name=order_mode]').forEach(r => {
    r.checked = r.value === current.order_mode;
    r.disabled = !canManage;
    r.addEventListener('change', async () => {
      const { data, error } = await sb.from('st_shops').update({ order_mode: r.value })
        .eq('id', shopId).select().single();
      if (error) {
        fm.querySelector(`[value="${current.order_mode}"]`).checked = true;
        return showMsg(thaiError(error));
      }
      current = data;
      showMsg('บันทึกรูปแบบการสั่งอาหารแล้ว', 'ok');
    });
  });

  // ---------- ข้อมูลร้าน ----------
  const fs = $('#form-shop');
  const fillShop = () => {
    fs.shop_name.value = current.name || '';
    fs.phone.value = current.phone || '';
    fs.address.value = current.address || '';
    fs.promptpay_id.value = current.promptpay_id || '';
    fs.service_pct.value = Number(current.service_pct || 0);
    fs.vat_pct.value = Number(current.vat_pct || 0);
    fs.vat_included.checked = !!current.vat_included;
    fs.is_open.checked = !!current.is_open;
  };
  fillShop();
  if (!canManage) {
    fs.querySelectorAll('input').forEach(el => el.disabled = true);
    fs.querySelector('button[type=submit]').hidden = true;
  }

  fs.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pct = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
    const payload = {
      name: fs.shop_name.value.trim(),
      phone: fs.phone.value.trim() || null,
      address: fs.address.value.trim() || null,
      promptpay_id: fs.promptpay_id.value.replace(/\D/g, '') || null,
      service_pct: pct(fs.service_pct.value),
      vat_pct: pct(fs.vat_pct.value),
      vat_included: fs.vat_included.checked,
      is_open: fs.is_open.checked
    };
    if (!payload.name) return showMsg('กรุณาใส่ชื่อร้าน');
    if (payload.promptpay_id && !/^\d{10,15}$/.test(payload.promptpay_id)) return showMsg('พร้อมเพย์ต้องเป็นตัวเลข 10–15 หลัก');
    if ([payload.service_pct, payload.vat_pct].some(n => n < 0 || n > 30)) return showMsg('ค่าบริการและ VAT ต้องอยู่ระหว่าง 0–30%');

    setBusy(fs, true, 'กำลังบันทึก…');
    const { data, error } = await sb.from('st_shops').update(payload).eq('id', shopId).select().single();
    setBusy(fs, false);
    if (error) return showMsg(thaiError(error));
    current = data; fillShop(); renderHead();
    showMsg('บันทึกข้อมูลร้านแล้ว', 'ok');
  });

  // ---------- หน้าตาร้าน: โลโก้ / รูปปก / สี ----------
  const imgUrl = (path) => sb.storage.from('st-images').getPublicUrl(path).data.publicUrl;
  const COLORS = ['#E4572E', '#C0392B', '#D4537E', '#8E44AD', '#2F6FD6', '#0F8B8D', '#2F7D5B', '#B7791F', '#5D4037', '#222222'];
  function renderBrand() {
    const set = (box, del, path, label) => {
      box.innerHTML = path ? `<img src="${esc(imgUrl(path))}" alt="">` : label;
      del.hidden = !path || !canManage;
    };
    set($('#logo-box'), $('#logo-del'), current.logo_path, 'โลโก้');
    set($('#cover-box'), $('#cover-del'), current.cover_path, 'รูปปก (แนวนอน)');
    const cur = (current.theme_color || '#E4572E').toUpperCase();
    $('#swatches').innerHTML = COLORS.map(c => `<button type="button" data-color="${c}" style="background:${c}"
        aria-label="สี ${c}" aria-pressed="${c === cur}"${canManage ? '' : ' disabled'}></button>`).join('')
      + (canManage ? `<label class="st-swatch-custom" title="เลือกสีเอง"><input type="color" value="${cur.toLowerCase()}"> อื่น ๆ</label>` : '');
  }
  async function saveBrand(patch, okText) {
    const { data, error } = await sb.from('st_shops').update(patch).eq('id', shopId).select().single();
    if (error) { showMsg(thaiError(error)); return false; }
    current = data; renderBrand(); showMsg(okText, 'ok');
    return true;
  }
  async function uploadBrand(file, kind) {
    const blob = await shrinkImage(file, kind === 'logo' ? 512 : 1600, 0.85);
    const path = `shops/${shopId}/brand/${kind}-${Date.now()}.jpg`;
    const { error } = await sb.storage.from('st-images').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (error) return showMsg('อัปโหลดไม่สำเร็จ: ' + thaiError(error));
    const old = current[kind + '_path'];
    if (await saveBrand({ [kind + '_path']: path }, kind === 'logo' ? 'เปลี่ยนโลโก้แล้ว' : 'เปลี่ยนรูปปกแล้ว') && old) {
      sb.storage.from('st-images').remove([old]);
    }
  }
  renderBrand();
  if (!canManage) {
    $('#brand-card').querySelectorAll('label.st-chip').forEach(l => { l.hidden = true; });
  } else {
    for (const kind of ['logo', 'cover']) {
      $(`#${kind}-input`).addEventListener('change', async (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (f) { try { await uploadBrand(f, kind); } catch { showMsg('อ่านรูปนี้ไม่ได้ ลองรูปอื่น'); } }
      });
      $(`#${kind}-del`).addEventListener('click', async () => {
        const old = current[kind + '_path'];
        if (!old || !confirm('ลบรูปนี้?')) return;
        if (await saveBrand({ [kind + '_path']: null }, 'ลบรูปแล้ว')) sb.storage.from('st-images').remove([old]);
      });
    }
    $('#swatches').addEventListener('click', (e) => {
      const b = e.target.closest('[data-color]');
      if (b) saveBrand({ theme_color: b.dataset.color }, 'เปลี่ยนสีร้านแล้ว');
    });
    $('#swatches').addEventListener('change', (e) => {
      if (e.target.type === 'color') saveBrand({ theme_color: e.target.value.toUpperCase() }, 'เปลี่ยนสีร้านแล้ว');
    });
  }

  // ---------- พนักงาน ----------
  const assignable = isOwner ? ['manager', 'cashier', 'kitchen', 'waiter'] : ['cashier', 'kitchen', 'waiter'];

  async function loadMembers() {
    const { data, error } = await sb.rpc('st_list_members', { p_shop: shopId });
    if (error) return showMsg(thaiError(error));
    $('#member-list').innerHTML = data.map(m => {
      const self = m.user_id === user.id;
      const editable = !self && m.role !== 'owner' && (isOwner || (role === 'manager' && m.role !== 'manager'));
      const opts = assignable.map(r => `<option value="${r}"${r === m.role ? ' selected' : ''}>${ROLE_TH[r]}</option>`).join('');
      const name = m.display_name || 'ไม่มีชื่อ';
      return `
        <div class="st-item" data-user="${esc(m.user_id)}" data-name="${esc(name)}">
          <div class="st-logo">${esc((m.display_name || m.email).charAt(0).toUpperCase())}</div>
          <div class="st-item-main"><b>${esc(name)}${self ? ' (คุณ)' : ''}</b><small>${esc(m.email)}</small></div>
          ${editable
            ? `<select data-act="role" aria-label="ตำแหน่ง">${opts}</select>
               <button type="button" class="st-icon-btn" data-act="remove" aria-label="นำออกจากร้าน">✕</button>`
            : `<span class="st-badge">${esc(ROLE_TH[m.role] || m.role)}</span>`}
        </div>`;
    }).join('');
  }

  $('#member-list').addEventListener('change', async (e) => {
    if (e.target.dataset.act !== 'role') return;
    const row = e.target.closest('[data-user]');
    const { error } = await sb.rpc('st_set_member_role',
      { p_shop: shopId, p_user: row.dataset.user, p_role: e.target.value });
    if (error) showMsg(thaiError(error)); else showMsg('เปลี่ยนตำแหน่งแล้ว', 'ok');
    loadMembers();
  });

  $('#member-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="remove"]');
    if (!btn) return;
    const row = btn.closest('[data-user]');
    if (!confirm(`นำ ${row.dataset.name} ออกจากร้าน?`)) return;
    const { error } = await sb.rpc('st_remove_member', { p_shop: shopId, p_user: row.dataset.user });
    if (error) return showMsg(thaiError(error));
    showMsg('นำออกจากร้านแล้ว', 'ok');
    loadMembers();
  });

  await loadMembers();

  // ---------- คำเชิญ (เจ้าของ / ผู้จัดการ) ----------
  const inviteUrl = (token) => pageUrl('invite.html') + '?t=' + encodeURIComponent(token);
  let lastInvite = null;

  async function shareInvite(inv) {
    const url = inviteUrl(inv.token);
    const text = `เชิญคุณเป็น${ROLE_TH[inv.role]}ที่ร้าน ${current.name} บน SmartTable`;
    if (navigator.share) {
      try { await navigator.share({ title: 'คำเชิญเข้าร้าน ' + current.name, text, url }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
    if (await copyText(url)) showMsg('คัดลอกลิงก์แล้ว ส่งให้พนักงานทาง LINE ได้เลย', 'ok');
    else showMsg('คัดลอกไม่ได้ กรุณากดค้างที่ลิงก์แล้วคัดลอกเอง');
  }

  async function loadInvites() {
    const { data, error } = await sb.from('st_shop_invites')
      .select('id, email, role, token, expires_at')
      .eq('shop_id', shopId).is('accepted_at', null).is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (error) return showMsg(thaiError(error));
    const box = $('#invite-list');
    if (!data.length) { box.innerHTML = '<p class="st-sub">ไม่มีคำเชิญค้าง</p>'; return; }
    box.innerHTML = data.map(i => `
      <div class="st-item" data-id="${esc(i.id)}" data-token="${esc(i.token)}" data-role="${esc(i.role)}">
        <div class="st-item-main"><b>${esc(i.email)}</b>
          <small>${esc(ROLE_TH[i.role])} · หมดอายุ ${new Date(i.expires_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</small></div>
        <button type="button" class="st-chip" data-act="share">ส่งลิงก์</button>
        <button type="button" class="st-icon-btn" data-act="revoke" aria-label="ยกเลิกคำเชิญ">✕</button>
      </div>`).join('');
  }

  if (canManage) {
    const fi = $('#form-invite');
    fi.role.innerHTML = assignable.map(r => `<option value="${r}">${ROLE_TH[r]}</option>`).join('');
    fi.role.value = 'waiter';
    $('#invite-box').hidden = false;

    fi.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = fi.email.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showMsg(thaiError({ message: 'st_bad_email' }));
      setBusy(fi, true, 'กำลังสร้างลิงก์…');
      const { data, error } = await sb.rpc('st_invite_staff', { p_shop: shopId, p_email: email, p_role: fi.role.value });
      setBusy(fi, false);
      if (error) return showMsg(thaiError(error));
      lastInvite = data;
      $('#invite-url').value = inviteUrl(data.token);
      $('#invite-result').hidden = false;
      fi.email.value = '';
      showMsg(`สร้างลิงก์คำเชิญสำหรับ ${email} แล้ว`, 'ok');
      loadInvites();
    });

    $('#invite-url').addEventListener('focus', (e) => e.target.select());
    $('#btn-copy').addEventListener('click', async () => {
      if (await copyText($('#invite-url').value)) showMsg('คัดลอกลิงก์แล้ว ส่งให้พนักงานทาง LINE ได้เลย', 'ok');
      else { $('#invite-url').select(); showMsg('กดค้างที่ลิงก์แล้วเลือกคัดลอก'); }
    });
    $('#btn-share').addEventListener('click', () => lastInvite && shareInvite(lastInvite));

    $('#invite-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const row = btn.closest('[data-id]');
      if (btn.dataset.act === 'share') return shareInvite({ token: row.dataset.token, role: row.dataset.role });
      if (!confirm('ยกเลิกคำเชิญนี้? ลิงก์เดิมจะใช้ไม่ได้')) return;
      const { error } = await sb.rpc('st_revoke_invite', { p_invite: row.dataset.id });
      if (error) return showMsg(thaiError(error));
      showMsg('ยกเลิกคำเชิญแล้ว', 'ok');
      loadInvites();
    });

    await loadInvites();
  }

  // ---------- ออกจากร้าน (ไม่ใช่เจ้าของ) ----------
  if (role && !isOwner) {
    const leave = $('#btn-leave');
    leave.hidden = false;
    leave.addEventListener('click', async () => {
      if (!confirm(`ออกจากร้าน ${current.name}? ต้องให้ร้านเชิญใหม่ถึงจะกลับมาได้`)) return;
      const { error } = await sb.rpc('st_remove_member', { p_shop: shopId, p_user: user.id });
      if (error) return showMsg(thaiError(error));
      location.replace('home.html');
    });
  }
})();
