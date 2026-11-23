// ===== หน้า เมนูอาหาร / สินค้า (menu.html?id=<shop_id>) =====
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
    sb.from('st_shops').select('id, name, languages, shop_type').eq('id', shopId).maybeSingle(),
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
  let stations = [];
  // รอบ N: แสดงตามประเภทร้าน
  const TYPES = [['restaurant', '🍽 ร้านอาหาร'], ['buffet', '🍖 บุฟเฟ่ต์'], ['grocery', '🛒 ของชำ'], ['queue', '🧋 ร้านน้ำ/คิว'], ['small', '⚡ ร้านเล็ก']];
  const TYPE_TH = Object.fromEntries(TYPES);
  const shopType = shop.shop_type || 'restaurant';
  const shownNow = (it) => !(it.show_types && it.show_types.length) || it.show_types.includes(shopType);
  let typeFilter = 'all';
  let picking = false;
  const picked = new Set();
  const typeBoxes = (sel, name) => TYPES.map(([k, l]) =>
    `<label class="st-tagchip"><input type="checkbox" name="${name}" value="${k}"${sel.includes(k) ? ' checked' : ''}><span>${l}${k === shopType ? ' (ตอนนี้)' : ''}</span></label>`).join('');

  // ---------- โหลดและแสดงผล ----------
  async function load() {
    const [{ data: d, error }, st] = await Promise.all([
      sb.rpc('st_menu_admin', { p_shop: shopId }),
      sb.from('st_stations').select('id, name, sort').eq('shop_id', shopId).order('sort')
    ]);
    if (error) return showMsg(thaiError(error));
    data = d;
    stations = (st && Array.isArray(st.data)) ? st.data : [];
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
        ${stations.length ? `<select class="st-cat-station" data-act="cat-station" aria-label="สถานี">
          <option value="">${esc(stations[0].name)} (แรก)</option>
          ${stations.slice(1).map(x => `<option value="${esc(x.id)}" ${c.station_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select>` : ''}
        <button type="button" class="st-chip" data-act="cat-rename">แก้ชื่อ</button>
        ${LANGS.length ? `<button type="button" class="st-chip" data-act="cat-i18n" title="คำแปล">🌐</button>` : ''}
        <button type="button" class="st-icon-btn" data-act="cat-delete" aria-label="ลบหมวด">✕</button>
      </div>`).join('') : '<p class="st-sub">ยังไม่มีหมวดหมู่ ลองเพิ่ม เช่น "อาหารจานเดียว" "เครื่องดื่ม"</p>';

    // สถานี
    $('#station-list').innerHTML = stations.map((x, i) => `
      <div class="st-item" data-station="${esc(x.id)}">
        <div class="st-item-main"><b>${i === 0 ? '⭐ ' : ''}${esc(x.name)}</b>
          <small>${i === 0 ? 'สถานีแรก · ' : ''}${cats.filter(c => (c.station_id || stations[0].id) === x.id).length} หมวด</small></div>
        <div class="st-updown">
          <button type="button" data-act="st-up" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">↑</button>
          <button type="button" data-act="st-down" ${i === stations.length - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">↓</button>
        </div>
        <button type="button" class="st-chip" data-act="st-rename">แก้ชื่อ</button>
        <button type="button" class="st-icon-btn" data-act="st-delete" aria-label="ลบสถานี">✕</button>
      </div>`).join('') || '<p class="st-sub">ยังไม่มีสถานี (ทุกจานขึ้นจอเดียวกัน)</p>';

    // ตัวเลือกหมวดในแผ่นแก้ไข
    $('#form-item').category_id.innerHTML = '<option value="">ไม่มีหมวด</option>' +
      cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

    // เมนูแยกตามหมวด
    const groups = cats.map(c => ({ id: c.id, name: c.name, items: data.items.filter(it => it.category_id === c.id) }));
    const loose = data.items.filter(it => !it.category_id);
    if (loose.length || !cats.length) groups.push({ id: '', name: cats.length ? 'ไม่มีหมวด' : 'เมนูทั้งหมด', items: loose });

    $('#item-count').textContent = `(${data.items.length})`;
    const hiddenN = data.items.filter(it => !shownNow(it)).length;
    $('#type-now').innerHTML = `ร้านตอนนี้เป็น <b>${esc(TYPE_TH[shopType] || shopType)}</b> · ลูกค้าเห็น ${data.items.length - hiddenN} เมนู${hiddenN ? ` · ซ่อน ${hiddenN} เมนู` : ''}`;
    groups.forEach(g => { g.items = g.items.filter(it => typeFilter === 'all' || (typeFilter === 'shown') === shownNow(it)); });
    $('#item-groups').innerHTML = groups.filter(g => typeFilter === 'all' || g.items.length).map(g => `
      <section class="st-card st-menu-group" data-group="${esc(g.id)}">
        <h3>${picking && g.items.length ? `<label class="st-check"><input type="checkbox" data-act="pick-group"${g.items.every(it => picked.has(it.id)) ? ' checked' : ''}> ` : ''}${esc(g.name)}${picking && g.items.length ? '</label>' : ''}</h3>
        ${g.items.length ? g.items.map((it, i) => itemRow(it, i, g.items.length)).join('')
          : `<p class="st-sub">${canEdit ? 'ยังไม่มีเมนูในหมวดนี้ กด "+ เพิ่มเมนู"' : 'ยังไม่มีเมนู'}</p>`}
      </section>`).join('');
  }

  function itemRow(it, i, n) {
    const tags = [baht(it.price)];
    if (it.is_recommended) tags.push('⭐ แนะนำ');
    if (it.spicy_level) tags.push(SPICY[it.spicy_level]);
    if (it.options.length) tags.push(`${it.options.length} กลุ่มตัวเลือก`);
    if (it.show_types && it.show_types.length) tags.push('👁 ' + it.show_types.map(t => (TYPE_TH[t] || t).replace(/^\S+ /, '')).join(', '));
    if (!shownNow(it)) tags.push('🙈 ลูกค้าไม่เห็นตอนนี้');
    (it.tags || []).forEach(t => TAGS[t] && tags.push(TAGS[t].icon + ' ' + TAGS[t].th));
    return `
      <div class="st-mi${it.is_available ? '' : ' st-mi--off'}${shownNow(it) ? '' : ' st-mi--hidden'}" data-id="${esc(it.id)}">
        ${picking ? `<input type="checkbox" class="st-pick" data-act="pick" aria-label="เลือก ${esc(it.name)}"${picked.has(it.id) ? ' checked' : ''}>` : ''}
        <div class="st-thumb">${it.image_path ? ST.thumbImg(it.image_path) : esc(it.name.charAt(0))}</div>
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
      if (!btn || btn.dataset.act === 'cat-station') return;
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
    // ----- สถานี -----
    $('#station-card').hidden = false;
    $('#form-station').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const name = f.station_name.value.trim();
      if (!name) return;
      setBusy(f, true, '…');
      const { error } = await sb.rpc('st_save_station', { p_shop: shopId, p_id: null, p_name: name, p_sort: null });
      setBusy(f, false);
      if (error) return showMsg(thaiError(error));
      f.station_name.value = '';
      load();
    });
    $('#station-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.closest('[data-station]').dataset.station;
      const x = stations.find(s2 => s2.id === id);
      const act = btn.dataset.act;
      let error;
      if (act === 'st-rename') {
        const name = prompt('ชื่อสถานีใหม่', x.name);
        if (!name || !name.trim() || name.trim() === x.name) return;
        ({ error } = await sb.rpc('st_save_station', { p_shop: shopId, p_id: id, p_name: name.trim(), p_sort: null }));
      } else if (act === 'st-delete') {
        if (!confirm(`ลบสถานี "${x.name}"?\nหมวดที่ใช้สถานีนี้จะไปที่สถานีแรกแทน`)) return;
        ({ error } = await sb.rpc('st_delete_station', { p_id: id }));
      } else {
        const ids = stations.map(s2 => s2.id);
        const i = ids.indexOf(id), j = act === 'st-up' ? i - 1 : i + 1;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        for (let k = 0; k < ids.length && !error; k++) {
          const s2 = stations.find(z => z.id === ids[k]);
          ({ error } = await sb.rpc('st_save_station', { p_shop: shopId, p_id: s2.id, p_name: s2.name, p_sort: k + 1 }));
        }
      }
      if (error) showMsg(thaiError(error));
      load();
    });
    $('#cat-list').addEventListener('change', async (e) => {
      if (e.target.dataset.act !== 'cat-station') return;
      const id = e.target.closest('[data-cat]').dataset.cat;
      const { error } = await sb.rpc('st_set_category_station', { p_category: id, p_station: e.target.value || null });
      if (error) showMsg(thaiError(error)); else showMsg('บันทึกสถานีของหมวดแล้ว', 'ok');
      load();
    });
  } else {
    $('#staff-hint').hidden = false;
  }

  // ---------- รายการเมนู: หมด/มี, เลื่อน, แก้ไข ----------
  // ---------- รอบ N: กรอง / เลือกหลายเมนู ตั้งประเภทร้าน ----------
  if (canEdit) $('#type-bar').hidden = false;
  $('#type-filter').addEventListener('change', (e) => { typeFilter = e.target.value; render(); });
  function pickUi() {
    $('#pick-bar').hidden = !picking;
    document.body.classList.toggle('st-picking', picking);
    $('#pick-count').textContent = `เลือก ${picked.size} เมนู`;
    $('#pick-save').disabled = !picked.size;
    $('#btn-pick').textContent = picking ? '✕ เลิกเลือก' : '☑ เลือกหลายเมนู ตั้งประเภทร้านพร้อมกัน';
  }
  $('#btn-pick').addEventListener('click', () => {
    picking = !picking;
    picked.clear();
    if (picking) $('#pick-types').innerHTML = typeBoxes([], 'pick_type');
    render(); pickUi();
  });
  $('#pick-cancel').addEventListener('click', () => { picking = false; picked.clear(); render(); pickUi(); });
  $('#pick-save').addEventListener('click', async () => {
    const types = [...$('#pick-types').querySelectorAll('input:checked')].map(i => i.value);
    const what = types.length ? 'แสดงเฉพาะร้าน: ' + types.map(t => TYPE_TH[t]).join(', ') : 'แสดงทุกประเภทร้าน';
    if (!confirm(`ตั้ง ${picked.size} เมนู → ${what}?`)) return;
    $('#pick-save').disabled = true;
    const { data: n, error } = await sb.rpc('st_set_items_types', { p_shop: shopId, p_items: [...picked], p_types: types });
    $('#pick-save').disabled = false;
    if (error) return showMsg(thaiError(error));
    picking = false; picked.clear(); pickUi();
    showMsg(`ตั้งแล้ว ${n} เมนู ✓`, 'ok');
    load();
  });
  $('#item-groups').addEventListener('change', (e) => {
    const a = e.target.dataset.act;
    if (a === 'pick') {
      const id = e.target.closest('[data-id]').dataset.id;
      if (e.target.checked) picked.add(id); else picked.delete(id);
      pickUi();
    }
    if (a === 'pick-group') {
      e.target.closest('.st-menu-group').querySelectorAll('[data-act=pick]').forEach(c => {
        c.checked = e.target.checked;
        const id = c.closest('[data-id]').dataset.id;
        if (e.target.checked) picked.add(id); else picked.delete(id);
      });
      pickUi();
    }
  });

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
    if (!el || el.dataset.act === 'avail' || el.dataset.act === 'pick' || el.dataset.act === 'pick-group') return;
    const id = el.closest('[data-id]')?.dataset.id;
    if (!id) return;
    if (el.dataset.act === 'edit' && picking) {
      const cb = el.closest('[data-id]').querySelector('[data-act=pick]');
      cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
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
  let pendingThumb = null;  // รูปย่อ 320px (ใช้ในรายการเมนู ตะกร้า จอครัว)
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
    pendingBlob = null; pendingThumb = null; removeImage = false;
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
    fillBiz(item);
    $('#item-types').innerHTML = typeBoxes((item && item.show_types) || [], 'show_type');
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
    sheet.querySelector('.st-sheet-scroll').scrollTop = 0;
  }
  // ---------- ต้นทุน / ชุดคอมโบ / ขายพ่วง (รอบ M) ----------
  const bzOthers = (item) => data.items.filter(x => !item || x.id !== item.id);
  function fillBiz(item) {
    fi.cost.value = item && item.cost != null ? Number(item.cost) : '';
    const combo = (item && item.combo) || [];
    fi.is_combo.checked = combo.length > 0;
    const inCombo = new Map(combo.map(c => [c.id, c.qty]));
    // เมนูที่อยู่ในชุดอื่น เป็นชุดเองไม่ได้ · ชุดใส่ในชุดไม่ได้
    const usedInCombo = item && data.items.some(x => (x.combo || []).some(c => c.id === item.id));
    fi.is_combo.disabled = !!usedInCombo;
    $('#combo-pick').innerHTML = bzOthers(item).filter(x => !(x.combo && x.combo.length)).map(x => `
      <label><input type="checkbox" value="${esc(x.id)}"${inCombo.has(x.id) ? ' checked' : ''}>
        <span>${esc(x.name)} <small>฿${Number(x.price)}</small></span>
        <input type="number" min="1" max="9" step="1" value="${inCombo.get(x.id) || 1}" aria-label="จำนวน ${esc(x.name)}" data-q="${esc(x.id)}"></label>`).join('')
      || '<p class="st-sub">ยังไม่มีเมนูอื่นให้ใส่ในชุด</p>';
    const up = new Set((item && item.upsell_ids) || []);
    $('#upsell-pick').innerHTML = bzOthers(item).map(x =>
      `<label class="st-tagchip"><input type="checkbox" value="${esc(x.id)}"${up.has(x.id) ? ' checked' : ''}><span>${esc(x.name)}</span></label>`).join('');
    bizUi();
  }
  function bizUi() {
    $('#combo-box').hidden = !fi.is_combo.checked;
    const price = Number(fi.price.value) || 0;
    const cost = fi.cost.value === '' ? null : Number(fi.cost.value);
    let comboCost = 0, comboFull = 0, anyCost = true;
    $('#combo-pick').querySelectorAll('input[type=checkbox]:checked').forEach(c => {
      const it = data.items.find(x => x.id === c.value);
      const q = Number($('#combo-pick').querySelector(`[data-q="${c.value}"]`).value) || 1;
      if (!it) return;
      comboFull += Number(it.price) * q;
      if (it.cost == null) anyCost = false; else comboCost += Number(it.cost) * q;
    });
    $('#combo-sum').textContent = fi.is_combo.checked && comboFull
      ? `ซื้อแยก ฿${comboFull} · ราคาชุด ฿${price} · ลูกค้าประหยัด ฿${Math.max(0, comboFull - price)}${anyCost ? ` · ต้นทุนรวมเมนูในชุด ฿${comboCost}` : ''}` : '';
    $('#cost-margin').textContent = cost != null && price
      ? `กำไรต่อจาน ฿${(price - cost).toFixed(2).replace(/\.00$/, '')} (${Math.round((price - cost) / price * 100)}%)` : '';
    const n = $('#upsell-pick').querySelectorAll('input:checked').length;
    $('#upsell-pick').querySelectorAll('input:not(:checked)').forEach(b => { b.disabled = n >= 6; });
  }
  function collectBiz() {
    const combo = fi.is_combo.checked ? [...$('#combo-pick').querySelectorAll('input[type=checkbox]:checked')].map(c => ({
      id: c.value, qty: Math.max(1, Math.min(9, Number($('#combo-pick').querySelector(`[data-q="${c.value}"]`).value) || 1)) })) : [];
    return {
      cost: fi.cost.value === '' ? null : Math.max(0, Number(fi.cost.value)),
      combo: combo.length ? combo : null,
      upsell: [...$('#upsell-pick').querySelectorAll('input:checked')].map(c => c.value)
    };
  }
  ['#combo-pick', '#upsell-pick'].forEach(sel => { $(sel).addEventListener('change', bizUi); $(sel).addEventListener('input', bizUi); });
  fi.cost.addEventListener('input', bizUi);
  fi.price.addEventListener('input', bizUi);
  fi.is_combo.addEventListener('change', bizUi);

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
      pendingThumb = await shrink(pendingBlob, 320).catch(() => null);
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
      if (pendingThumb) await sb.storage.from(BUCKET)
        .upload(ST.thumbPath(newPath), pendingThumb, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true });
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
      if (newPath) sb.storage.from(BUCKET).remove([newPath, ST.thumbPath(newPath)]);
      return sheetMsg(thaiError(error));
    }
    if (oldPath && oldPath !== imagePath) sb.storage.from(BUCKET).remove([oldPath, ST.thumbPath(oldPath)]);
    const stockRaw = fi.stock_left.value.trim();
    const { error: exErr } = await sb.rpc('st_set_item_extras', {
      p_item: savedId,
      p_tags: [...$('#tag-picks').querySelectorAll('input:checked')].map(i => i.value),
      p_stock: stockRaw === '' ? null : Math.max(0, parseInt(stockRaw, 10) || 0)
    });
    if (exErr) { showMsg('บันทึกเมนูแล้ว แต่บันทึกป้าย/จำนวนไม่สำเร็จ: ' + thaiError(exErr)); }
    const types = [...$('#item-types').querySelectorAll('input:checked')].map(i => i.value);
    const { error: tyErr } = await sb.rpc('st_set_items_types', { p_shop: shopId, p_items: [savedId], p_types: types });
    if (tyErr && !/st_set_items_types|PGRST202|function/i.test(tyErr.message || '')) showMsg('บันทึกเมนูแล้ว แต่ตั้งประเภทร้านไม่สำเร็จ: ' + thaiError(tyErr));
    const biz = collectBiz();
    const { error: bzErr } = await sb.rpc('st_set_item_biz', { p_item: savedId, p_cost: biz.cost, p_combo: biz.combo, p_upsell: biz.upsell });
    if (bzErr && !/st_set_item_biz|PGRST202|function/i.test(bzErr.message || '')) showMsg('บันทึกเมนูแล้ว แต่บันทึกต้นทุน/ชุด/ขายพ่วงไม่สำเร็จ: ' + thaiError(bzErr));
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
    if (img) sb.storage.from(BUCKET).remove([img, ST.thumbPath(img)]);
    closeSheet();
    showMsg(`ลบ "${editing.name}" แล้ว`, 'ok');
    load();
  });

  await load();
  $('#menu-body').hidden = false;

  // ---------- ทำรูปย่อให้เมนูเดิม (ครั้งเดียวต่อร้านต่อเครื่อง · ทำเบื้องหลัง) ----------
  // เมนูที่อัปโหลดก่อนรอบนี้มีแต่รูปเต็ม 1200px -> หน้าลูกค้าโหลดช้า · สร้างรูปย่อ 320px ให้
  (async function makeThumbs() {
    const KEY = 'st-thumbs-v1:' + shopId;
    try { if (localStorage.getItem(KEY)) return; } catch { return; }
    const todo = data.items.filter(it => it.image_path && ST.thumbPath(it.image_path) !== it.image_path);
    if (!todo.length) { try { localStorage.setItem(KEY, '1'); } catch { /* */ } return; }
    let done = 0, failed = 0;
    for (const it of todo) {
      try {
        const res = await fetch(imgUrl(it.image_path), { cache: 'no-store' });
        if (!res.ok) throw new Error('fetch');
        const small = await shrink(await res.blob(), 320);
        const { error } = await sb.storage.from(BUCKET)
          .upload(ST.thumbPath(it.image_path), small, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: true });
        if (error) throw error;
        done++;
      } catch { failed++; }
    }
    if (!failed) { try { localStorage.setItem(KEY, '1'); } catch { /* */ } }
    if (done) showMsg(`ทำรูปย่อให้เมนู ${done} รายการแล้ว — หน้าลูกค้าจะโหลดรูปเร็วขึ้น`, 'ok');
  })();
})();
