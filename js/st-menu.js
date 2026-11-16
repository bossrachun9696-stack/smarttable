// ===== หน้า เมนูอาหาร (menu.html?id=<shop_id>) =====
(async function () {
  const { sb, configOk, $, esc, ROLE_TH, thaiError, showMsg, setBusy, requireUser, TAGS } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('index.html'); });

  const shopId = new URLSearchParams(location.search).get('id');
  if (!shopId) return location.replace('home.html');
  $('#back').href = 'shop.html?id=' + encodeURIComponent(shopId);

  const [{ data: shop }, { data: me }] = await Promise.all([
    sb.from('st_shops').select('id, name, languages').eq('id', shopId).maybeSingle(),
    sb.from('st_shop_members').select('role').eq('shop_id', shopId).eq('user_id', user.id).maybeSingle()
  ]);
  if (!shop || !me) { $('#shop-sub').textContent = ''; return showMsg('ไม่พบร้านนี้ หรือคุณไม่ได้เป็นพนักงานของร้าน'); }

  const role = me.role;
  const canEdit = role === 'owner' || role === 'manager';
  $('#shop-sub').textContent = shop.name;
  $('#my-role').textContent = 'คุณ: ' + ROLE_TH[role];
  document.title = 'เมนู · ' + shop.name;
  const LANGS = (shop.languages || []).filter(l => l === 'en' || l === 'zh');
  const LANG_TH = { en: 'ภาษาอังกฤษ', zh: 'ภาษาจีน' };

  const BUCKET = 'st-images';
  const imgUrl = (path) => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const SPICY = ['', '🌶', '🌶🌶', '🌶🌶🌶'];
  let data = { categories: [], items: [] };

  // ---------- โหลดและแสดงผล ----------
  async function load() {
    const { data: d, error } = await sb.rpc('st_menu_admin', { p_shop: shopId });
    if (error) return showMsg(thaiError(error));
    data = d;
    render();
  }

  function render() {
    // หมวดหมู่
    const cats = data.categories;
    $('#cat-list').innerHTML = cats.length ? cats.map((c, i) => `
      <div class="st-item" data-cat="${esc(c.id)}">
        <div class="st-item-main"><b>${esc(c.name)}</b>
          <small>${data.items.filter(it => it.category_id === c.id).length} เมนู</small></div>
        <div class="st-updown">
          <button type="button" data-act="cat-up" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">↑</button>
          <button type="button" data-act="cat-down" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">↓</button>
        </div>
        <button type="button" class="st-chip" data-act="cat-rename">แก้ชื่อ</button>
        ${LANGS.length ? `<button type="button" class="st-chip" data-act="cat-i18n" title="คำแปล">🌐</button>` : ''}
        <button type="button" class="st-icon-btn" data-act="cat-delete" aria-label="ลบหมวด">✕</button>
      </div>`).join('') : '<p class="st-sub">ยังไม่มีหมวดหมู่ ลองเพิ่ม เช่น "อาหารจานเดียว" "เครื่องดื่ม"</p>';

    // ตัวเลือกหมวดในแผ่นแก้ไข
    $('#form-item').category_id.innerHTML = '<option value="">ไม่มีหมวด</option>' +
      cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

    // เมนูแยกตามหมวด
    const groups = cats.map(c => ({ id: c.id, name: c.name, items: data.items.filter(it => it.category_id === c.id) }));
    const loose = data.items.filter(it => !it.category_id);
    if (loose.length || !cats.length) groups.push({ id: '', name: cats.length ? 'ไม่มีหมวด' : 'เมนูทั้งหมด', items: loose });

    $('#item-count').textContent = `(${data.items.length})`;
    $('#item-groups').innerHTML = groups.map(g => `
      <section class="st-card st-menu-group" data-group="${esc(g.id)}">
        <h3>${esc(g.name)}</h3>
        ${g.items.length ? g.items.map((it, i) => itemRow(it, i, g.items.length)).join('')
          : `<p class="st-sub">${canEdit ? 'ยังไม่มีเมนูในหมวดนี้ กด "+ เพิ่มเมนู"' : 'ยังไม่มีเมนู'}</p>`}
      </section>`).join('');
  }

  function itemRow(it, i, n) {
    const tags = [baht(it.price)];
    if (it.is_recommended) tags.push('⭐ แนะนำ');
    if (it.spicy_level) tags.push(SPICY[it.spicy_level]);
    if (it.options.length) tags.push(`${it.options.length} กลุ่มตัวเลือก`);
    (it.tags || []).forEach(t => TAGS[t] && tags.push(TAGS[t].icon + ' ' + TAGS[t].th));
    return `
      <div class="st-mi${it.is_available ? '' : ' st-mi--off'}" data-id="${esc(it.id)}">
        <div class="st-thumb">${it.image_path ? `<img src="${esc(imgUrl(it.image_path))}" alt="" loading="lazy">` : esc(it.name.charAt(0))}</div>
        <div class="st-item-main"${canEdit ? ' data-act="edit" role="button" tabindex="0"' : ''}>
          <b>${esc(it.name)}</b><small>${esc(tags.join(' · '))}</small>
        </div>
        <button type="button" class="st-stock${it.stock_left != null && it.stock_left <= 5 ? ' low' : ''}" data-act="stock"
          title="ตั้งจำนวนที่เหลือ">${it.stock_left == null ? '∞' : 'เหลือ ' + it.stock_left}</button>
        <label class="st-switch" title="มี / หมด">
          <input type="checkbox" data-act="avail" ${it.is_available ? 'checked' : ''} aria-label="มีขาย">
          <span></span><em>${it.is_available ? 'มี' : 'หมด'}</em>
        </label>
        ${canEdit ? `<div class="st-updown">
          <button type="button" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">↑</button>
          <button type="button" data-act="down" ${i === n - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">↓</button>
        </div>` : ''}
      </div>`;
  }

  // ---------- หมวดหมู่ ----------
  if (canEdit) {
    $('#cat-card').hidden = false;
    $('#btn-add').hidden = false;

    $('#form-cat').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const name = f.cat_name.value.trim();
      if (!name) return;
      setBusy(f, true, '…');
      const { error } = await sb.rpc('st_save_category', { p_shop: shopId, p_id: null, p_name: name });
      setBusy(f, false);
      if (error) return showMsg(thaiError(error));
      f.cat_name.value = '';
      load();
    });

    $('#cat-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.closest('[data-cat]').dataset.cat;
      const cat = data.categories.find(c => c.id === id);
      const act = btn.dataset.act;
      let error;
      if (act === 'cat-i18n') {
        const next = { ...(cat.i18n || {}) };
        for (const l of LANGS) {
          const v = prompt(`ชื่อหมวด "${cat.name}" เป็น${LANG_TH[l]}`, next[l] || '');
          if (v === null) return;
          if (v.trim()) next[l] = v.trim().slice(0, 60); else delete next[l];
        }
        ({ error } = await sb.rpc('st_set_category_i18n', { p_cat: id, p_i18n: next }));
      } else if (act === 'cat-rename') {
        const name = prompt('ชื่อหมวดใหม่', cat.name);
        if (!name || !name.trim() || name.trim() === cat.name) return;
        ({ error } = await sb.rpc('st_save_category', { p_shop: shopId, p_id: id, p_name: name.trim() }));
      } else if (act === 'cat-delete') {
        if (!confirm(`ลบหมวด "${cat.name}"?\nเมนูในหมวดนี้จะยังอยู่ แต่จะย้ายไป "ไม่มีหมวด"`)) return;
        ({ error } = await sb.rpc('st_delete_category', { p_shop: shopId, p_id: id }));
      } else {
        const ids = data.categories.map(c => c.id);
        const i = ids.indexOf(id), j = act === 'cat-up' ? i - 1 : i + 1;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        ({ error } = await sb.rpc('st_reorder', { p_shop: shopId, p_kind: 'category', p_ids: ids }));
      }
      if (error) return showMsg(thaiError(error));
      load();
    });
  } else {
    $('#staff-hint').hidden = false;
  }

  // ---------- รายการเมนู: หมด/มี, เลื่อน, แก้ไข ----------
  $('#item-groups').addEventListener('change', async (e) => {
    if (e.target.dataset.act !== 'avail') return;
    const row = e.target.closest('[data-id]');
    const on = e.target.checked;
    row.classList.toggle('st-mi--off', !on);
    row.querySelector('.st-switch em').textContent = on ? 'มี' : 'หมด';
    const { error } = await sb.rpc('st_set_item_available', { p_item: row.dataset.id, p_available: on });
    if (error) { showMsg(thaiError(error)); return load(); }
    const it = data.items.find(x => x.id === row.dataset.id);
    if (it) it.is_available = on;
  });

  $('#item-groups').addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.dataset.act === 'avail') return;
    const id = el.closest('[data-id]')?.dataset.id;
    if (!id) return;
    if (el.dataset.act === 'edit') return openSheet(data.items.find(x => x.id === id));
    if (el.dataset.act === 'stock') {
      const it = data.items.find(x => x.id === id);
      const v = prompt(`จำนวน "${it.name}" ที่เหลือขาย\n(เว้นว่าง = ไม่จำกัด · 0 = หมด)`, it.stock_left ?? '');
      if (v === null) return;
      const n = v.trim() === '' ? null : parseInt(v, 10);
      if (n !== null && (!Number.isInteger(n) || n < 0)) return showMsg('ใส่เป็นตัวเลข 0 ขึ้นไป หรือเว้นว่าง');
      const { error } = await sb.rpc('st_set_item_stock', { p_item: id, p_stock: n });
      if (error) return showMsg(thaiError(error));
      showMsg(n === null ? `"${it.name}" ไม่จำกัดจำนวน` : `"${it.name}" เหลือ ${n}`, 'ok');
      return load();
    }
    if (el.dataset.act === 'up' || el.dataset.act === 'down') {
      const it = data.items.find(x => x.id === id);
      const ids = data.items.filter(x => (x.category_id || '') === (it.category_id || '')).map(x => x.id);
      const i = ids.indexOf(id), j = el.dataset.act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      const { error } = await sb.rpc('st_reorder', { p_shop: shopId, p_kind: 'item', p_ids: ids });
      if (error) return showMsg(thaiError(error));
      load();
    }
  });
  $('#item-groups').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.act === 'edit') e.target.click();
  });

  // ---------- แผ่นแก้ไขเมนู ----------
  const sheet = $('#sheet');
  const fi = $('#form-item');
  let editing = null;       // เมนูที่กำลังแก้ (null = เพิ่มใหม่)
  let pendingBlob = null;   // รูปใหม่ที่ยังไม่อัปโหลด
  let removeImage = false;

  const sheetMsg = (text, type = 'error') => {
    const b = $('#sheet-msg'); b.textContent = text; b.className = 'st-msg st-msg--' + type; b.hidden = false;
    b.scrollIntoView({ block: 'nearest' });
  };

  function setPreview() {
    const box = $('#photo-preview');
    const path = removeImage ? null : editing && editing.image_path;
    if (pendingBlob) box.innerHTML = `<img src="${URL.createObjectURL(pendingBlob)}" alt="">`;
    else if (path) box.innerHTML = `<img src="${esc(imgUrl(path))}" alt="">`;
    else box.textContent = 'ยังไม่มีรูป';
    $('#photo-remove').hidden = !(pendingBlob || path);
  }

  function openSheet(item) {
    editing = item || null;
    pendingBlob = null; removeImage = false;
    $('#sheet-msg').hidden = true;
    $('#sheet-title').textContent = item ? 'แก้ไขเมนู' : 'เพิ่มเมนู';
    $('#btn-delete').hidden = !item;
    fi.item_name.value = item ? item.name : '';
    fi.price.value = item ? Number(item.price) : '';
    fi.description.value = item ? item.description || '' : '';
    fi.category_id.value = item ? item.category_id || '' : (data.categories[0]?.id || '');
    fi.spicy_level.value = item ? String(item.spicy_level) : '0';
    fi.is_recommended.checked = item ? item.is_recommended : false;
    fi.stock_left.value = item && item.stock_left != null ? item.stock_left : '';
    i18nDraft = JSON.parse(JSON.stringify((item && item.i18n) || {}));
    renderI18n();
    const have = new Set(item ? item.tags || [] : []);
    $('#tag-picks').innerHTML = Object.entries(TAGS).map(([k, t]) =>
      `<label class="st-tagchip"><input type="checkbox" value="${k}"${have.has(k) ? ' checked' : ''}><span>${t.icon} ${t.th}</span></label>`).join('');
    $('#opt-groups').innerHTML = '';
    (item ? item.options : []).forEach(addGroup);
    setPreview();
    sheet.hidden = false;
    document.body.classList.add('st-noscroll');
    sheet.querySelector('.st-sheet-panel').scrollTop = 0;
  }
  function closeSheet() {
    sheet.hidden = true;
    document.body.classList.remove('st-noscroll');
  }
  $('#btn-add').addEventListener('click', () => openSheet(null));
  $('#sheet-close').addEventListener('click', closeSheet);

  // ---------- รูป: ย่อก่อนอัปโหลด ----------
  async function shrink(file, max = 1200) {
    let src, w, h;
    try {
      src = await createImageBitmap(file); w = src.width; h = src.height;
    } catch {
      src = await new Promise((ok, fail) => {
        const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = URL.createObjectURL(file);
      });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    const s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
  }

  $('#photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      pendingBlob = await shrink(file);
      if (!pendingBlob) throw new Error('empty');
      removeImage = false;
      setPreview();
    } catch {
      sheetMsg('อ่านรูปนี้ไม่ได้ ลองรูปอื่น (รองรับ JPG / PNG / รูปจากกล้อง iPhone)');
    }
  });
  $('#photo-remove').addEventListener('click', () => {
    pendingBlob = null; removeImage = true; setPreview();
  });

  // ---------- กลุ่มตัวเลือก ----------
  const typeOf = (g) => g.min_select >= 1 ? 'one_required' : (g.max_select === 1 ? 'one_optional' : 'multi');

  function addGroup(g) {
    const box = document.createElement('div');
    box.className = 'st-og';
    box.innerHTML = `
      <div class="st-og-head">
        <input class="og-name" type="text" maxlength="60" placeholder="ชื่อกลุ่ม เช่น ไข่ / ความเผ็ด" value="${esc(g?.name || '')}">
        <button type="button" class="st-icon-btn" data-act="del-group" aria-label="ลบกลุ่ม">✕</button>
      </div>
      <select class="og-type">
        <option value="one_required">ลูกค้าต้องเลือก 1 อย่าง</option>
        <option value="one_optional">เลือกได้ 1 อย่าง (ไม่บังคับ)</option>
        <option value="multi">เลือกได้หลายอย่าง</option>
      </select>
      <div class="og-choices"></div>
      <button type="button" class="st-chip" data-act="add-choice">+ เพิ่มตัวเลือก</button>`;
    box.querySelector('.og-type').value = g ? typeOf(g) : 'one_optional';
    (g?.choices?.length ? g.choices : [null, null]).forEach(c => addChoice(box, c));
    $('#opt-groups').appendChild(box);
    return box;
  }
  function addChoice(box, c) {
    const row = document.createElement('div');
    row.className = 'st-oc';
    row.innerHTML = `
      <input class="oc-name" type="text" maxlength="60" placeholder="เช่น ไข่ดาว" value="${esc(c?.name || '')}">
      <input class="oc-price" type="number" step="0.25" inputmode="decimal" placeholder="+0 บาท"
             value="${c && Number(c.price_delta) ? Number(c.price_delta) : ''}">
      <button type="button" class="st-icon-btn" data-act="del-choice" aria-label="ลบตัวเลือก">✕</button>`;
    box.querySelector('.og-choices').appendChild(row);
    return row;
  }
  $('#btn-add-group').addEventListener('click', () => {
    if ($('#opt-groups').children.length >= 10) return sheetMsg('มีได้ไม่เกิน 10 กลุ่ม');
    addGroup(null).querySelector('.og-name').focus();
  });
  $('#opt-groups').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const box = btn.closest('.st-og');
    if (btn.dataset.act === 'del-group') box.remove();
    if (btn.dataset.act === 'del-choice') btn.closest('.st-oc').remove();
    if (btn.dataset.act === 'add-choice') {
      if (box.querySelectorAll('.st-oc').length >= 20) return sheetMsg('กลุ่มหนึ่งมีได้ไม่เกิน 20 ตัวเลือก');
      addChoice(box, null).querySelector('.oc-name').focus();
    }
  });

  function collectOptions() {
    const out = [];
    for (const box of $('#opt-groups').querySelectorAll('.st-og')) {
      const name = box.querySelector('.og-name').value.trim();
      const choices = [...box.querySelectorAll('.st-oc')]
        .map(r => ({ name: r.querySelector('.oc-name').value.trim(), price_delta: parseFloat(r.querySelector('.oc-price').value) || 0 }))
        .filter(c => c.name);
      if (!name && !choices.length) continue;                 // กลุ่มว่าง ข้ามไป
      if (!name) throw new Error('ใส่ชื่อกลุ่มตัวเลือกให้ครบ');
      if (!choices.length) throw new Error(`กลุ่ม "${name}" ยังไม่มีตัวเลือก`);
      const type = box.querySelector('.og-type').value;
      out.push({
        name, choices,
        min_select: type === 'one_required' ? 1 : 0,
        max_select: type === 'multi' ? choices.length : 1
      });
    }
    return out;
  }

  // ---------- คำแปล (ภาษาที่ร้านเปิด) ----------
  let i18nDraft = {};
  const optStrings = () => {
    const out = [];
    $('#opt-groups').querySelectorAll('.og-name, .oc-name').forEach(i => { const v = i.value.trim(); if (v && !out.includes(v)) out.push(v); });
    return out;
  };
  function keepI18nInputs() {
    $('#i18n-fields').querySelectorAll('[data-l]').forEach(inp => {
      const l = inp.dataset.l, f = inp.dataset.f, k = inp.dataset.k;
      i18nDraft[l] = i18nDraft[l] || {};
      if (f === 'opts') { i18nDraft[l].opts = i18nDraft[l].opts || {}; i18nDraft[l].opts[k] = inp.value; }
      else i18nDraft[l][f] = inp.value;
    });
  }
  function renderI18n() {
    $('#i18n-box').hidden = !LANGS.length;
    if (!LANGS.length) return;
    const opts = optStrings();
    $('#i18n-fields').innerHTML = LANGS.map(l => {
      const d = i18nDraft[l] || {};
      return `<fieldset class="st-i18n"><legend>${LANG_TH[l]}</legend>
        <label class="st-field"><span>ชื่อเมนู</span><input data-l="${l}" data-f="name" maxlength="80" value="${esc(d.name || '')}" placeholder="${l === 'en' ? 'e.g. Crispy pork basil' : '例如：罗勒炒脆皮猪肉'}"></label>
        <label class="st-field"><span>คำอธิบาย</span><input data-l="${l}" data-f="description" maxlength="300" value="${esc(d.description || '')}"></label>
        ${opts.length ? `<div class="st-i18n-opts"><small>ตัวเลือก</small>${opts.map(s => `
          <label><span>${esc(s)}</span><input data-l="${l}" data-f="opts" data-k="${esc(s)}" maxlength="60" value="${esc((d.opts || {})[s] || '')}"></label>`).join('')}</div>` : ''}
      </fieldset>`;
    }).join('') + `<button type="button" class="st-chip" id="i18n-refresh">↻ อัปเดตรายการตัวเลือกที่ต้องแปล</button>`;
  }
  function collectI18n() {
    keepI18nInputs();
    const opts = optStrings();
    const out = {};
    for (const l of LANGS) {
      const d = i18nDraft[l] || {};
      const o = {};
      opts.forEach(s => { const v = ((d.opts || {})[s] || '').trim(); if (v) o[s] = v.slice(0, 60); });
      const entry = {};
      if ((d.name || '').trim()) entry.name = d.name.trim().slice(0, 80);
      if ((d.description || '').trim()) entry.description = d.description.trim().slice(0, 300);
      if (Object.keys(o).length) entry.opts = o;
      if (Object.keys(entry).length) out[l] = entry;
    }
    return out;
  }
  $('#i18n-box').addEventListener('click', (e) => {
    if (e.target.id === 'i18n-refresh') { keepI18nInputs(); renderI18n(); }
  });

  // ---------- บันทึก / ลบ ----------
  fi.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = fi.item_name.value.trim();
    const price = parseFloat(fi.price.value);
    if (!name) return sheetMsg('กรุณาใส่ชื่อเมนู');
    if (!Number.isFinite(price) || price < 0) return sheetMsg('กรุณาใส่ราคา');
    let options;
    try { options = collectOptions(); } catch (err) { return sheetMsg(err.message); }

    setBusy(fi, true, 'กำลังบันทึก…');
    const oldPath = editing ? editing.image_path : null;
    let newPath = null;
    if (pendingBlob) {
      const rand = (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(36).slice(2));
      newPath = `shops/${shopId}/menu/${rand}.jpg`;
      const { error: upErr } = await sb.storage.from(BUCKET)
        .upload(newPath, pendingBlob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
      if (upErr) { setBusy(fi, false); return sheetMsg('อัปโหลดรูปไม่สำเร็จ: ' + thaiError(upErr)); }
    }
    const imagePath = newPath || (removeImage ? null : oldPath);

    const { data: savedId, error } = await sb.rpc('st_save_item', {
      p_shop: shopId,
      p_item: {
        id: editing ? editing.id : null,
        category_id: fi.category_id.value || null,
        name, price,
        description: fi.description.value.trim() || null,
        image_path: imagePath,
        is_recommended: fi.is_recommended.checked,
        spicy_level: Number(fi.spicy_level.value),
        options
      }
    });
    setBusy(fi, false);
    if (error) {
      if (newPath) sb.storage.from(BUCKET).remove([newPath]);
      return sheetMsg(thaiError(error));
    }
    if (oldPath && oldPath !== imagePath) sb.storage.from(BUCKET).remove([oldPath]);
    const stockRaw = fi.stock_left.value.trim();
    const { error: exErr } = await sb.rpc('st_set_item_extras', {
      p_item: savedId,
      p_tags: [...$('#tag-picks').querySelectorAll('input:checked')].map(i => i.value),
      p_stock: stockRaw === '' ? null : Math.max(0, parseInt(stockRaw, 10) || 0)
    });
    if (exErr) { showMsg('บันทึกเมนูแล้ว แต่บันทึกป้าย/จำนวนไม่สำเร็จ: ' + thaiError(exErr)); }
    if (LANGS.length) {
      const { error: trErr } = await sb.rpc('st_set_item_i18n', { p_item: savedId, p_i18n: collectI18n() });
      if (trErr) showMsg('บันทึกเมนูแล้ว แต่บันทึกคำแปลไม่สำเร็จ: ' + thaiError(trErr));
    }
    closeSheet();
    showMsg(editing ? `บันทึก "${name}" แล้ว` : `เพิ่ม "${name}" แล้ว`, 'ok');
    load();
  });

  $('#btn-delete').addEventListener('click', async () => {
    if (!editing || !confirm(`ลบเมนู "${editing.name}"? ลบแล้วกู้คืนไม่ได้`)) return;
    const { data: img, error } = await sb.rpc('st_delete_item', { p_item: editing.id });
    if (error) return sheetMsg(thaiError(error));
    if (img) sb.storage.from(BUCKET).remove([img]);
    closeSheet();
    showMsg(`ลบ "${editing.name}" แล้ว`, 'ok');
    load();
  });

  await load();
  $('#menu-body').hidden = false;
})();
