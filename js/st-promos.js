// ===== หน้า โปรโมชันและคูปอง (promos.html?id=<shop_id>) — เจ้าของ / ผู้จัดการ =====
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, requireUser } = ST;
  if (!configOk) return;
  if (!(await requireUser())) return;
  const shopId = new URLSearchParams(location.search).get('id');
  if (!shopId) return location.replace('home.html');
  $('#back').href = 'shop.html?id=' + encodeURIComponent(shopId);

  const ERR = {
    st_coupon_code_taken: 'มีโค้ดนี้อยู่แล้ว ใช้โค้ดอื่น',
    st_bad_coupon: 'ข้อมูลคูปองไม่ถูกต้อง: โค้ด A-Z 0-9 _ - ยาว 3–20 ตัว · ส่วนลด % ไม่เกิน 100',
    st_bad_promo: 'ข้อมูลโปรไม่ถูกต้อง: ส่วนลด 1–90% · เลือกวันอย่างน้อย 1 วัน · ใส่เวลาให้ครบ'
  };
  const err = (e) => ERR[e?.message] || thaiError(e);
  const DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const num = (n) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });

  let data = { coupons: [], promotions: [] };
  let menu = { categories: [], items: [] };

  async function load() {
    const [a, m] = await Promise.all([sb.rpc('st_promo_admin', { p_shop: shopId }), sb.rpc('st_menu_admin', { p_shop: shopId })]);
    if (a.error) return showMsg(a.error.message === 'st_forbidden' ? 'หน้านี้ใช้ได้เฉพาะเจ้าของร้านและผู้จัดการ' : err(a.error));
    data = a.data; menu = m.data || menu;
    render();
    $('#p-body').hidden = false;
  }

  const daysText = (d) => d.length === 7 ? 'ทุกวัน' : [...d].sort().map(x => DAYS[x]).join(' ');
  const timeText = (p) => `${p.start_time.slice(0, 5)}–${p.end_time.slice(0, 5)}`;
  function scopeText(p) {
    if (!p.item_ids.length && !p.category_ids.length) return 'ทั้งเมนู';
    const cats = p.category_ids.map(id => menu.categories.find(c => c.id === id)?.name).filter(Boolean);
    const items = p.item_ids.map(id => menu.items.find(i => i.id === id)?.name).filter(Boolean);
    return [...cats.map(c => 'หมวด ' + c), ...items].join(', ') || '(เมนูที่ถูกลบแล้ว)';
  }
  function couponText(c) {
    const parts = [c.kind === 'percent' ? `ลด ${num(c.value)}%${c.max_discount ? ` (สูงสุด ${baht(c.max_discount)})` : ''}` : `ลด ${baht(c.value)}`];
    if (Number(c.min_subtotal)) parts.push(`ขั้นต่ำ ${baht(c.min_subtotal)}`);
    if (c.starts_on || c.ends_on) parts.push(`${c.starts_on ? new Date(c.starts_on).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '…'} – ${c.ends_on ? new Date(c.ends_on).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '…'}`);
    parts.push(`ใช้แล้ว ${c.used_count}${c.usage_limit ? '/' + c.usage_limit : ''} ครั้ง`);
    return parts.join(' · ');
  }

  function render() {
    $('#promo-list').innerHTML = data.promotions.length ? data.promotions.map(p => `
      <div class="st-item${p.is_active ? '' : ' st-item--void'}" data-promo="${esc(p.id)}">
        <div class="st-logo">−${num(p.percent)}%</div>
        <div class="st-item-main" data-act="edit-promo" role="button" tabindex="0"><b>${esc(p.name)}</b>
          <small>${esc(daysText(p.days))} · ${esc(timeText(p))}</small><small>${esc(scopeText(p))}</small></div>
        <label class="st-switch"><input type="checkbox" data-act="toggle-promo" ${p.is_active ? 'checked' : ''} aria-label="เปิดใช้"><span></span><em>${p.is_active ? 'เปิด' : 'ปิด'}</em></label>
      </div>`).join('') : '<p class="st-sub">ยังไม่มีโปร</p>';
    $('#coupon-list').innerHTML = data.coupons.length ? data.coupons.map(c => `
      <div class="st-item${c.is_active ? '' : ' st-item--void'}" data-coupon="${esc(c.id)}">
        <div class="st-logo st-logo--code">🎟</div>
        <div class="st-item-main" data-act="edit-coupon" role="button" tabindex="0"><b class="st-code">${esc(c.code)}</b>
          <small>${esc(couponText(c))}</small>${c.note ? `<small>${esc(c.note)}</small>` : ''}</div>
        <label class="st-switch"><input type="checkbox" data-act="toggle-coupon" ${c.is_active ? 'checked' : ''} aria-label="เปิดใช้"><span></span><em>${c.is_active ? 'เปิด' : 'ปิด'}</em></label>
      </div>`).join('') : '<p class="st-sub">ยังไม่มีคูปอง</p>';
  }

  // ---------- แผ่นแก้ไข ----------
  const sheet = $('#sheet');
  const sheetMsg = (t) => { const b = $('#sheet-msg'); b.textContent = t; b.className = 'st-msg st-msg--error'; b.hidden = false; b.scrollIntoView({ block: 'nearest' }); };
  const open = (title, html) => { $('#sheet-title').textContent = title; $('#sheet-msg').hidden = true; $('#sheet-body').innerHTML = html; sheet.hidden = false; document.body.classList.add('st-noscroll'); };
  const close = () => { sheet.hidden = true; document.body.classList.remove('st-noscroll'); };
  $('#sheet-close').addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

  function promoForm(p) {
    p = p || { name: '', percent: 10, days: [0, 1, 2, 3, 4, 5, 6], start_time: '14:00', end_time: '17:00', category_ids: [], item_ids: [], is_active: true };
    const scope = p.item_ids.length ? 'items' : p.category_ids.length ? 'cats' : 'all';
    open(p.id ? 'แก้ไขโปร' : 'เพิ่มโปรตามเวลา', `
      <form id="f-promo" data-id="${esc(p.id || '')}" novalidate>
        <label class="st-field"><span>ชื่อโปร (ลูกค้าเห็น)</span><input name="pname" maxlength="60" required value="${esc(p.name)}" placeholder="เช่น Happy Hour เครื่องดื่ม"></label>
        <label class="st-field"><span>ลดกี่ %</span><input name="percent" type="number" min="1" max="90" step="1" inputmode="numeric" value="${num(p.percent)}"></label>
        <div class="st-field"><span>วัน</span><div class="st-tagpick">${DAYS.map((d, i) => `<label class="st-tagchip"><input type="checkbox" name="day" value="${i}"${p.days.includes(i) ? ' checked' : ''}><span>${d}</span></label>`).join('')}</div></div>
        <div class="st-grid2">
          <label class="st-field"><span>ตั้งแต่</span><input name="start" type="time" value="${p.start_time.slice(0, 5)}"></label>
          <label class="st-field"><span>ถึง</span><input name="end" type="time" value="${p.end_time.slice(0, 5)}"></label>
        </div>
        <p class="st-sub" style="margin-top:-8px">ข้ามเที่ยงคืนได้ เช่น 22:00–02:00</p>
        <div class="st-field"><span>ใช้กับ</span>
          <div class="st-seg st-seg--3">
            <label><input type="radio" name="scope" value="all"${scope === 'all' ? ' checked' : ''}><span>ทั้งเมนู</span></label>
            <label><input type="radio" name="scope" value="cats"${scope === 'cats' ? ' checked' : ''}><span>บางหมวด</span></label>
            <label><input type="radio" name="scope" value="items"${scope === 'items' ? ' checked' : ''}><span>บางเมนู</span></label>
          </div>
        </div>
        <div data-scope="cats" class="st-tagpick"${scope === 'cats' ? '' : ' hidden'}>${menu.categories.map(c => `<label class="st-tagchip"><input type="checkbox" name="cat" value="${esc(c.id)}"${p.category_ids.includes(c.id) ? ' checked' : ''}><span>${esc(c.name)}</span></label>`).join('') || '<p class="st-sub">ยังไม่มีหมวด</p>'}</div>
        <div data-scope="items" class="st-tagpick"${scope === 'items' ? '' : ' hidden'}>${menu.items.map(i => `<label class="st-tagchip"><input type="checkbox" name="item" value="${esc(i.id)}"${p.item_ids.includes(i.id) ? ' checked' : ''}><span>${esc(i.name)}</span></label>`).join('') || '<p class="st-sub">ยังไม่มีเมนู</p>'}</div>
        <label class="st-check"><input type="checkbox" name="active"${p.is_active ? ' checked' : ''}> <span>เปิดใช้งาน</span></label>
        <button class="st-btn" type="submit">บันทึกโปร</button>
        ${p.id ? '<button class="st-btn st-btn--ghost st-danger" type="button" data-act="del-promo">ลบโปรนี้</button>' : ''}
      </form>`);
  }
  function couponForm(c) {
    c = c || { code: '', kind: 'percent', value: 10, min_subtotal: 0, max_discount: null, starts_on: null, ends_on: null, usage_limit: null, is_active: true, note: '' };
    open(c.id ? 'แก้ไขคูปอง' : 'เพิ่มคูปอง', `
      <form id="f-coupon" data-id="${esc(c.id || '')}" novalidate>
        <label class="st-field"><span>โค้ด (ลูกค้าบอกแคชเชียร์)</span><input name="code" maxlength="20" required value="${esc(c.code)}" placeholder="เช่น HELLO10" autocapitalize="characters" style="text-transform:uppercase"></label>
        <div class="st-grid2">
          <label class="st-field"><span>แบบ</span><select name="kind"><option value="percent"${c.kind === 'percent' ? ' selected' : ''}>ลดเป็น %</option><option value="amount"${c.kind === 'amount' ? ' selected' : ''}>ลดเป็นบาท</option></select></label>
          <label class="st-field"><span>ลดเท่าไร</span><input name="value" type="number" min="1" step="1" inputmode="decimal" value="${num(c.value)}"></label>
        </div>
        <div class="st-grid2">
          <label class="st-field"><span>ยอดขั้นต่ำ (บาท)</span><input name="min" type="number" min="0" step="1" inputmode="decimal" value="${num(c.min_subtotal)}"></label>
          <label class="st-field" data-for="percent"><span>ลดสูงสุด (บาท)</span><input name="max" type="number" min="1" step="1" inputmode="decimal" value="${c.max_discount ?? ''}" placeholder="ไม่จำกัด"></label>
        </div>
        <div class="st-grid2">
          <label class="st-field"><span>เริ่มใช้ได้</span><input name="starts" type="date" value="${c.starts_on || ''}"></label>
          <label class="st-field"><span>หมดอายุ</span><input name="ends" type="date" value="${c.ends_on || ''}"></label>
        </div>
        <label class="st-field"><span>ใช้ได้กี่ครั้ง (ทั้งร้าน)</span><input name="limit" type="number" min="1" step="1" inputmode="numeric" value="${c.usage_limit ?? ''}" placeholder="ไม่จำกัด"></label>
        <label class="st-field"><span>หมายเหตุ (เห็นเฉพาะร้าน)</span><input name="note" maxlength="100" value="${esc(c.note || '')}" placeholder="เช่น แจกในเพจ"></label>
        <label class="st-check"><input type="checkbox" name="active"${c.is_active ? ' checked' : ''}> <span>เปิดใช้งาน</span></label>
        <button class="st-btn" type="submit">บันทึกคูปอง</button>
        ${c.id ? `<button class="st-btn st-btn--ghost st-danger" type="button" data-act="del-coupon">${c.used_count ? 'ปิดคูปองนี้ (เคยใช้แล้ว ลบไม่ได้)' : 'ลบคูปองนี้'}</button>` : ''}
      </form>`);
    const syncKind = () => { const f = $('#f-coupon'); f.querySelector('[data-for="percent"]').hidden = f.kind.value !== 'percent'; };
    $('#f-coupon').kind.addEventListener('change', syncKind); syncKind();
  }

  $('#add-promo').addEventListener('click', () => promoForm(null));
  $('#add-coupon').addEventListener('click', () => couponForm(null));
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'edit-promo') promoForm(data.promotions.find(p => p.id === el.closest('[data-promo]').dataset.promo));
    if (el.dataset.act === 'edit-coupon') couponForm(data.coupons.find(c => c.id === el.closest('[data-coupon]').dataset.coupon));
  });
  $('#sheet-body').addEventListener('change', (e) => {
    if (e.target.name === 'scope') document.querySelectorAll('[data-scope]').forEach(d => { d.hidden = d.dataset.scope !== e.target.value; });
  });

  // สลับเปิด/ปิดจากรายการ
  document.addEventListener('change', async (e) => {
    const act = e.target.dataset.act;
    if (act !== 'toggle-promo' && act !== 'toggle-coupon') return;
    const isPromo = act === 'toggle-promo';
    const row = e.target.closest(isPromo ? '[data-promo]' : '[data-coupon]');
    const obj = isPromo ? data.promotions.find(p => p.id === row.dataset.promo) : data.coupons.find(c => c.id === row.dataset.coupon);
    const payload = { ...obj, is_active: e.target.checked };
    const { error } = await sb.rpc(isPromo ? 'st_save_promotion' : 'st_save_coupon', { p_shop: shopId, p: payload });
    if (error) { showMsg(err(error)); }
    load();
  });

  $('#sheet-body').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    let rpc, payload;
    if (f.id === 'f-promo') {
      const scope = f.querySelector('[name=scope]:checked').value;
      payload = {
        id: f.dataset.id || null, name: f.pname.value.trim(), percent: Number(f.percent.value),
        days: [...f.querySelectorAll('[name=day]:checked')].map(i => Number(i.value)),
        start_time: f.start.value, end_time: f.end.value, is_active: f.active.checked,
        category_ids: scope === 'cats' ? [...f.querySelectorAll('[name=cat]:checked')].map(i => i.value) : [],
        item_ids: scope === 'items' ? [...f.querySelectorAll('[name=item]:checked')].map(i => i.value) : []
      };
      if (!payload.name) return sheetMsg('ใส่ชื่อโปร');
      if (!payload.days.length) return sheetMsg('เลือกวันอย่างน้อย 1 วัน');
      if (scope !== 'all' && !payload.category_ids.length && !payload.item_ids.length) return sheetMsg('เลือกหมวดหรือเมนูที่ใช้โปร');
      rpc = 'st_save_promotion';
    } else {
      payload = {
        id: f.dataset.id || null, code: f.code.value.trim().toUpperCase(), kind: f.kind.value, value: Number(f.value.value),
        min_subtotal: Number(f.min.value) || 0, max_discount: f.kind.value === 'percent' && f.max.value ? Number(f.max.value) : null,
        starts_on: f.starts.value || null, ends_on: f.ends.value || null, usage_limit: f.limit.value ? Number(f.limit.value) : null,
        is_active: f.active.checked, note: f.note.value.trim() || null
      };
      if (!/^[A-Z0-9_-]{3,20}$/.test(payload.code)) return sheetMsg(ERR.st_bad_coupon);
      rpc = 'st_save_coupon';
    }
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    const { error } = await sb.rpc(rpc, { p_shop: shopId, p: payload });
    btn.disabled = false;
    if (error) return sheetMsg(err(error));
    close(); showMsg('บันทึกแล้ว', 'ok'); load();
  });
  $('#sheet-body').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act="del-promo"], [data-act="del-coupon"]');
    if (!b) return;
    const f = b.closest('form');
    if (!confirm(b.textContent.trim() + '?')) return;
    const { error } = await sb.rpc(b.dataset.act === 'del-promo' ? 'st_delete_promotion' : 'st_delete_coupon', { p_id: f.dataset.id });
    if (error) return sheetMsg(err(error));
    close(); showMsg('เรียบร้อย', 'ok'); load();
  });

  await load();
})();
