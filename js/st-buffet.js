// ===== หน้า แพ็กเกจบุฟเฟ่ต์ (buffet.html?id=<shop_id>) — เจ้าของ / ผู้จัดการ =====
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, requireUser } = ST;
  if (!configOk) return;
  if (!(await requireUser())) return;
  const shopId = new URLSearchParams(location.search).get('id');
  if (!shopId) return location.replace('home.html');
  $('#back').href = 'shop.html?id=' + encodeURIComponent(shopId);

  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  let pkgs = [];
  let menu = { categories: [], items: [] };

  async function load() {
    const [p, m, sh] = await Promise.all([
      sb.from('st_buffet_packages').select('*').eq('shop_id', shopId).order('sort').order('created_at'),
      sb.rpc('st_menu_admin', { p_shop: shopId }),
      sb.from('st_shops').select('name, shop_type').eq('id', shopId).maybeSingle()
    ]);
    if (m.error) return showMsg(m.error.message === 'st_forbidden' ? 'หน้านี้ใช้ได้เฉพาะเจ้าของร้านและผู้จัดการ' : thaiError(m.error));
    if (p.error) return showMsg('ยังไม่ได้รัน sql/st-17-buffet.sql ใน Supabase');
    pkgs = p.data || []; menu = m.data || menu;
    $('#shop-sub').textContent = sh.data ? sh.data.name : '';
    const tw = $('#type-warn');
    tw.hidden = !sh.data || sh.data.shop_type === 'buffet';
    tw.innerHTML = 'ร้านนี้ยังไม่ได้ตั้งเป็น <b>ร้านบุฟเฟ่ต์</b> — ไปที่หน้าร้าน → <b>ประเภทร้าน</b> → เลือก "บุฟเฟ่ต์" ก่อน ลูกค้าจึงจะเห็นแพ็กเกจ';
    render();
    $('#b-body').hidden = false;
  }

  function scopeText(p) {
    if (p.include_all) return 'ทุกเมนู';
    const cats = p.category_ids.map(id => menu.categories.find(c => c.id === id)?.name).filter(Boolean);
    const items = p.item_ids.map(id => menu.items.find(i => i.id === id)?.name).filter(Boolean);
    return [...cats.map(c => 'หมวด ' + c), ...items].join(', ') || '(ยังไม่ได้เลือกเมนู)';
  }
  function ruleText(p) {
    const r = [p.time_limit_min ? `⏱ ${p.time_limit_min} นาที${p.last_order_min ? ` (หยุดสั่งก่อนหมด ${p.last_order_min} นาที)` : ''}` : '⏱ ไม่จำกัดเวลา'];
    if (p.time_limit_min && Number(p.overtime_fee)) r.push(`เกินเวลาคนละ ${baht(p.overtime_fee)} / ${p.overtime_block_min} นาที`);
    if (p.round_limit) r.push(`รอบละ ${p.round_limit} จาน/คน`);
    if (p.round_gap_min) r.push(`เว้น ${p.round_gap_min} นาที/รอบ`);
    return r.join(' · ');
  }
  function render() {
    const list = pkgs.filter(p => (p.kind || 'package') === 'package');
    const adds = pkgs.filter(p => p.kind === 'addon');
    $('#addon-list').innerHTML = adds.length ? adds.map(p => `
      <div class="st-item st-item--deal st-item--wrap${p.is_active ? ' st-item--on' : ' st-item--void'}" data-pkg="${esc(p.id)}">
        <div class="st-logo">🥤</div>
        <div class="st-item-main" data-act="edit" role="button" tabindex="0"><b>${esc(p.name)}</b>
          <small><span class="st-onoff st-onoff--${p.is_active ? 'on' : 'off'}">${p.is_active ? '● เปิดใช้งาน' : '○ ปิดอยู่'}</span></small>
          <small><b>${baht(p.price_adult)} ${p.per_head ? 'ต่อคน' : 'ต่อโต๊ะ'}</b></small>
          <small>เมนูที่ได้ฟรี: ${esc(scopeText(p))}</small>
          ${p.rules ? `<small>💬 ${esc(p.rules)}</small>` : ''}</div>
        <label class="st-switch"><input type="checkbox" data-act="toggle" ${p.is_active ? 'checked' : ''} aria-label="เปิดใช้"><span></span><em>${p.is_active ? 'เปิด' : 'ปิด'}</em></label>
      </div>`).join('') : '<p class="st-sub">ยังไม่มีรีฟิล · กด "+ เพิ่มรีฟิล"</p>';
    $('#pkg-list').innerHTML = list.length ? list.map(p => `
      <div class="st-item st-item--deal st-item--wrap${p.is_active ? ' st-item--on' : ' st-item--void'}" data-pkg="${esc(p.id)}">
        <div class="st-logo">🍖</div>
        <div class="st-item-main" data-act="edit" role="button" tabindex="0"><b>${esc(p.name)}</b>
          <small><span class="st-onoff st-onoff--${p.is_active ? 'on' : 'off'}">${p.is_active ? '● เปิดใช้งาน' : '○ ปิดอยู่'}</span></small>
          <small><b>ผู้ใหญ่ ${baht(p.price_adult)}</b>${p.price_child != null ? ` · เด็ก ${baht(p.price_child)}` : ''}${p.child_note ? ` (${esc(p.child_note)})` : ''}</small>
          <small>${esc(ruleText(p))}</small>
          <small>เมนูในแพ็กเกจ: ${esc(scopeText(p))}</small>
          ${p.rules ? `<small>💬 ${esc(p.rules)}</small>` : ''}</div>
        <label class="st-switch"><input type="checkbox" data-act="toggle" ${p.is_active ? 'checked' : ''} aria-label="เปิดใช้"><span></span><em>${p.is_active ? 'เปิด' : 'ปิด'}</em></label>
      </div>`).join('') : '<p class="st-sub">ยังไม่มีแพ็กเกจ · กด "+ เพิ่มแพ็กเกจ"</p>';
  }

  function addonForm(p) {
    p = p || { kind: 'addon', name: '', price_adult: 39, per_head: true, category_ids: [], item_ids: [], rules: '', is_active: true };
    const scope = p.item_ids.length && !p.category_ids.length ? 'items' : 'cats';
    open(p.id ? 'แก้ไขรีฟิล' : 'เพิ่มรีฟิล / ตัวเลือกเสริม', `
      <form id="f-pkg" data-id="${esc(p.id || '')}" data-kind="addon" novalidate>
        <label class="st-field"><span>ชื่อ (ลูกค้าเห็น)</span><input name="pname" maxlength="60" required value="${esc(p.name)}" placeholder="เช่น น้ำรีฟิล / ไอศกรีมไม่อั้น"></label>
        <label class="st-field"><span>ราคา</span><input name="adult" type="number" min="0" step="1" inputmode="decimal" value="${p.price_adult ?? ''}"></label>
        <div class="st-seg st-seg--2">
          <label><input type="radio" name="perhead" value="1"${p.per_head ? ' checked' : ''}><span>👤 ต่อคน</span></label>
          <label><input type="radio" name="perhead" value="0"${p.per_head ? '' : ' checked'}><span>🍽 ต่อโต๊ะ</span></label>
        </div>
        <div class="st-field"><span>เมนูที่ได้ฟรีเมื่อเอารีฟิลนี้</span>
          <div class="st-seg st-seg--2">
            <label><input type="radio" name="scope" value="cats"${scope === 'cats' ? ' checked' : ''}><span>บางหมวด</span></label>
            <label><input type="radio" name="scope" value="items"${scope === 'items' ? ' checked' : ''}><span>บางเมนู</span></label>
          </div>
        </div>
        <div data-scope="cats" class="st-tagpick"${scope === 'cats' ? '' : ' hidden'}>${menu.categories.map(c => `<label class="st-tagchip"><input type="checkbox" name="cat" value="${esc(c.id)}"${p.category_ids.includes(c.id) ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('') || '<p class="st-sub">ยังไม่มีหมวด</p>'}</div>
        <div data-scope="items" class="st-tagpick"${scope === 'items' ? '' : ' hidden'}>${menu.items.map(i => `<label class="st-tagchip"><input type="checkbox" name="item" value="${esc(i.id)}"${p.item_ids.includes(i.id) ? ' checked' : ''}><span>${esc(i.name)}</span></label>`).join('') || '<p class="st-sub">ยังไม่มีเมนู</p>'}</div>
        <p class="st-sub" style="margin-top:-6px">โต๊ะที่ไม่เอารีฟิล สั่งเมนูเหล่านี้ได้ตามปกติ แต่คิดเงินตามราคาเมนู</p>
        <label class="st-field"><span>รายละเอียดที่ลูกค้าเห็น (ไม่บังคับ)</span><textarea name="rules" maxlength="400" rows="2" placeholder="เช่น น้ำอัดลม ชาเย็น น้ำแข็ง เติมได้ไม่อั้น">${esc(p.rules || '')}</textarea></label>
        <label class="st-check"><input type="checkbox" name="active"${p.is_active ? ' checked' : ''}> <span>เปิดใช้งาน</span></label>
        <button class="st-btn" type="submit">บันทึกรีฟิล</button>
        ${p.id ? '<button class="st-btn st-btn--ghost st-danger" type="button" data-act="del">ลบรีฟิลนี้</button>' : ''}
      </form>`);
  }

  // ---------- แผ่นแก้ไข ----------
  const sheet = $('#sheet');
  const sheetMsg = (t) => { const b = $('#sheet-msg'); b.textContent = t; b.className = 'st-msg st-msg--error'; b.hidden = false; b.scrollIntoView({ block: 'nearest' }); };
  const open = (title, html) => { $('#sheet-title').textContent = title; $('#sheet-msg').hidden = true; $('#sheet-body').innerHTML = html; sheet.hidden = false; document.body.classList.add('st-noscroll'); };
  const close = () => { sheet.hidden = true; document.body.classList.remove('st-noscroll'); };
  $('#sheet-close').addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

  function form(p) {
    p = p || { name: '', price_adult: 299, price_child: null, child_note: '', time_limit_min: 90, last_order_min: 15, overtime_block_min: 15,
               overtime_fee: 0, round_limit: null, round_gap_min: null, include_all: true, category_ids: [], item_ids: [], rules: '', is_active: true };
    const scope = p.include_all ? 'all' : p.item_ids.length && !p.category_ids.length ? 'items' : 'cats';
    const v = (x) => x == null ? '' : x;
    open(p.id ? 'แก้ไขแพ็กเกจ' : 'เพิ่มแพ็กเกจบุฟเฟ่ต์', `
      <form id="f-pkg" data-id="${esc(p.id || '')}" novalidate>
        <label class="st-field"><span>ชื่อแพ็กเกจ (ลูกค้าเห็น)</span><input name="pname" maxlength="60" required value="${esc(p.name)}" placeholder="เช่น หมูกระทะ ปกติ / พรีเมียม"></label>
        <div class="st-grid2">
          <label class="st-field"><span>ราคาผู้ใหญ่ / คน</span><input name="adult" type="number" min="0" step="1" inputmode="decimal" value="${v(p.price_adult)}"></label>
          <label class="st-field"><span>ราคาเด็ก / คน</span><input name="child" type="number" min="0" step="1" inputmode="decimal" value="${v(p.price_child)}" placeholder="เว้นว่าง = ราคาผู้ใหญ่"></label>
        </div>
        <label class="st-field"><span>เงื่อนไขเด็ก (ไม่บังคับ)</span><input name="cnote" maxlength="60" value="${esc(p.child_note || '')}" placeholder="เช่น สูงไม่เกิน 130 ซม. · ต่ำกว่า 90 ซม. ฟรี"></label>

        <h4 class="st-form-h">เวลา</h4>
        <div class="st-seg st-seg--2">
          <label><input type="radio" name="timed" value="1"${p.time_limit_min ? ' checked' : ''}><span>⏱ จำกัดเวลา</span></label>
          <label><input type="radio" name="timed" value="0"${p.time_limit_min ? '' : ' checked'}><span>♾ ไม่จำกัดเวลา</span></label>
        </div>
        <div data-timed${p.time_limit_min ? '' : ' hidden'}>
          <div class="st-grid2">
            <label class="st-field"><span>นานกี่นาที</span><input name="limit" type="number" min="10" max="720" step="5" inputmode="numeric" value="${v(p.time_limit_min || 90)}"></label>
            <label class="st-field"><span>หยุดรับออร์เดอร์ก่อนหมด (นาที)</span><input name="last" type="number" min="0" max="120" step="5" inputmode="numeric" value="${v(p.last_order_min)}"></label>
          </div>
          <div class="st-grid2">
            <label class="st-field"><span>ค่าเกินเวลา / คน (บาท)</span><input name="otfee" type="number" min="0" step="1" inputmode="decimal" value="${v(p.overtime_fee)}" placeholder="0 = ไม่คิด"></label>
            <label class="st-field"><span>ทุก ๆ กี่นาที</span><input name="otblk" type="number" min="5" max="120" step="5" inputmode="numeric" value="${v(p.overtime_block_min)}"></label>
          </div>
        </div>

        <h4 class="st-form-h">การสั่ง</h4>
        <div class="st-grid2">
          <label class="st-field"><span>สั่งได้รอบละกี่จาน / คน</span><input name="round" type="number" min="1" max="50" inputmode="numeric" value="${v(p.round_limit)}" placeholder="เว้นว่าง = ไม่จำกัด"></label>
          <label class="st-field"><span>เว้นระหว่างรอบ (นาที)</span><input name="gap" type="number" min="1" max="60" inputmode="numeric" value="${v(p.round_gap_min)}" placeholder="เว้นว่าง = ไม่ต้องเว้น"></label>
        </div>
        <div class="st-field"><span>เมนูที่รวมในแพ็กเกจ (0 บาท)</span>
          <div class="st-seg st-seg--3">
            <label><input type="radio" name="scope" value="all"${scope === 'all' ? ' checked' : ''}><span>ทุกเมนู</span></label>
            <label><input type="radio" name="scope" value="cats"${scope === 'cats' ? ' checked' : ''}><span>บางหมวด</span></label>
            <label><input type="radio" name="scope" value="items"${scope === 'items' ? ' checked' : ''}><span>บางเมนู</span></label>
          </div>
        </div>
        <div data-scope="cats" class="st-tagpick"${scope === 'cats' ? '' : ' hidden'}>${menu.categories.map(c => `<label class="st-tagchip"><input type="checkbox" name="cat" value="${esc(c.id)}"${p.category_ids.includes(c.id) ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('') || '<p class="st-sub">ยังไม่มีหมวด</p>'}</div>
        <div data-scope="items" class="st-tagpick"${scope === 'items' ? '' : ' hidden'}>${menu.items.map(i => `<label class="st-tagchip"><input type="checkbox" name="item" value="${esc(i.id)}"${p.item_ids.includes(i.id) ? ' checked' : ''}><span>${esc(i.name)}</span></label>`).join('') || '<p class="st-sub">ยังไม่มีเมนู</p>'}</div>
        <p class="st-sub" style="margin-top:-6px">เมนูที่ไม่ได้เลือก (เช่น เครื่องดื่ม แอลกอฮอล์) ลูกค้าสั่งได้ แต่คิดเงินตามราคา</p>
        <label class="st-field"><span>กติกาที่ลูกค้าเห็น (ไม่บังคับ)</span><textarea name="rules" maxlength="400" rows="3" placeholder="เช่น อาหารเหลือคิดขีดละ 20 บาท · ห้ามนำอาหารกลับบ้าน">${esc(p.rules || '')}</textarea></label>
        <label class="st-check"><input type="checkbox" name="active"${p.is_active ? ' checked' : ''}> <span>เปิดใช้งาน</span></label>
        <button class="st-btn" type="submit">บันทึกแพ็กเกจ</button>
        ${p.id ? '<button class="st-btn st-btn--ghost st-danger" type="button" data-act="del">ลบแพ็กเกจนี้</button>' : ''}
      </form>`);
  }

  $('#add-pkg').addEventListener('click', () => form(null));
  $('#add-addon').addEventListener('click', () => addonForm(null));
  const onList = async (e) => {
    const row = e.target.closest('[data-pkg]');
    if (!row) return;
    const p = pkgs.find(x => x.id === row.dataset.pkg);
    const tg = e.target.closest('[data-act="toggle"]');
    if (tg) {
      const { error } = await sb.rpc('st_save_buffet_package', { p_shop: shopId, p: { ...p, is_active: tg.checked } });
      if (error) { tg.checked = !tg.checked; return showMsg(thaiError(error)); }
      return load();
    }
    if (e.target.closest('[data-act="edit"]')) (p.kind === 'addon' ? addonForm : form)(p);
  };
  $('#pkg-list').addEventListener('click', onList);
  $('#addon-list').addEventListener('click', onList);
  $('#sheet-body').addEventListener('change', (e) => {
    if (e.target.name === 'scope') document.querySelectorAll('[data-scope]').forEach(d => { d.hidden = d.dataset.scope !== e.target.value; });
    if (e.target.name === 'timed') document.querySelector('[data-timed]').hidden = e.target.value !== '1';
  });
  $('#sheet-body').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-act="del"]')) return;
    const id = $('#f-pkg').dataset.id;
    if (!confirm('ลบรายการนี้? (โต๊ะที่กำลังกินอยู่ไม่กระทบ)')) return;
    const { error } = await sb.rpc('st_delete_buffet_package', { p_id: id });
    if (error) return sheetMsg(thaiError(error));
    close(); showMsg('ลบแพ็กเกจแล้ว', 'ok'); load();
  });
  $('#sheet-body').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const num = (x) => x.value.trim() === '' ? null : Number(x.value);
    if (f.dataset.kind === 'addon') {
      const sc = f.querySelector('[name=scope]:checked').value;
      const ap = { id: f.dataset.id || null, kind: 'addon', name: f.pname.value.trim(), price_adult: num(f.adult),
        per_head: f.querySelector('[name=perhead]:checked').value === '1', include_all: false,
        category_ids: sc === 'cats' ? [...f.querySelectorAll('[name=cat]:checked')].map(i => i.value) : [],
        item_ids: sc === 'items' ? [...f.querySelectorAll('[name=item]:checked')].map(i => i.value) : [],
        rules: f.rules.value.trim(), is_active: f.active.checked };
      if (!ap.name) return sheetMsg('ใส่ชื่อรีฟิล');
      if (ap.price_adult == null || ap.price_adult < 0) return sheetMsg('ใส่ราคา');
      if (!ap.category_ids.length && !ap.item_ids.length) return sheetMsg('เลือกหมวดหรือเมนูที่ได้ฟรีเมื่อเอารีฟิล');
      const b2 = f.querySelector('button[type=submit]'); b2.disabled = true;
      const { error: er } = await sb.rpc('st_save_buffet_package', { p_shop: shopId, p: ap });
      b2.disabled = false;
      if (er) return sheetMsg(thaiError(er));
      close(); showMsg('บันทึกรีฟิลแล้ว', 'ok'); return load();
    }
    const timed = f.querySelector('[name=timed]:checked').value === '1';
    const scope = f.querySelector('[name=scope]:checked').value;
    const payload = {
      id: f.dataset.id || null, kind: 'package', name: f.pname.value.trim(), price_adult: num(f.adult), price_child: num(f.child),
      child_note: f.cnote.value.trim(), time_limit_min: timed ? num(f.limit) : null, last_order_min: timed ? (num(f.last) || 0) : 0,
      overtime_fee: timed ? (num(f.otfee) || 0) : 0, overtime_block_min: num(f.otblk) || 15,
      round_limit: num(f.round), round_gap_min: num(f.gap), include_all: scope === 'all',
      category_ids: scope === 'cats' ? [...f.querySelectorAll('[name=cat]:checked')].map(i => i.value) : [],
      item_ids: scope === 'items' ? [...f.querySelectorAll('[name=item]:checked')].map(i => i.value) : [],
      rules: f.rules.value.trim(), is_active: f.active.checked
    };
    if (!payload.name) return sheetMsg('ใส่ชื่อแพ็กเกจ');
    if (payload.price_adult == null || payload.price_adult < 0) return sheetMsg('ใส่ราคาผู้ใหญ่');
    if (timed && !(payload.time_limit_min >= 10 && payload.time_limit_min <= 720)) return sheetMsg('เวลาต้องอยู่ระหว่าง 10–720 นาที');
    if (scope !== 'all' && !payload.category_ids.length && !payload.item_ids.length) return sheetMsg('เลือกหมวดหรือเมนูที่รวมในแพ็กเกจ');
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    const { error } = await sb.rpc('st_save_buffet_package', { p_shop: shopId, p: payload });
    btn.disabled = false;
    if (error) return sheetMsg(thaiError(error));
    close(); showMsg('บันทึกแพ็กเกจแล้ว', 'ok'); load();
  });

  await load();
})();
