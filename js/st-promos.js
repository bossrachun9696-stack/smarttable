// ===== หน้า โปรโมชันและคูปอง (promos.html?id=<shop_id>) — เจ้าของ / ผู้จัดการ =====
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, requireUser, pageUrl, copyText } = ST;
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
  let stats = {};
  try { ST.markSeen && ST.markSeen(shopId, 'coupons'); } catch { /* ไม่เป็นไร */ }
  const MODE = { show: '👀 ลูกค้าเห็นโค้ด กดใช้เองได้', call: '🙋 ลูกค้าเห็น แต่ต้องเรียกพนักงานตรวจสิทธิ์', hidden: '🔒 ซ่อน ใช้ได้เมื่อมีโค้ด/QR' };
  const MODE_SHORT = { show: '👀 กดใช้เอง', call: '🙋 เรียกพนักงาน', hidden: '🔒 ซ่อน' };
  let menu = { categories: [], items: [] };

  async function load() {
    const [a, m, st, sh] = await Promise.all([sb.rpc('st_promo_admin', { p_shop: shopId }), sb.rpc('st_menu_admin', { p_shop: shopId }),
      sb.rpc('st_coupon_stats', { p_shop: shopId }), sb.from('st_shops').select('coupon_per_table').eq('id', shopId).maybeSingle()]);
    if (a.error) return showMsg(a.error.message === 'st_forbidden' ? 'หน้านี้ใช้ได้เฉพาะเจ้าของร้านและผู้จัดการ' : err(a.error));
    data = a.data; menu = m.data || menu; stats = st.data || {};
    const per = (sh.data && sh.data.coupon_per_table) || 1;
    $('#per-table').innerHTML = [1, 2, 3, 4, 5, 10].map(n => `<option value="${n}"${n === per ? ' selected' : ''}>${n} ใบ</option>`).join('');
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
    return parts.join(' · ');
  }

  function statsHtml(c) {
    const x = stats[c.id] || { uses: c.used_count, discount: 0, uses_30d: 0, discount_30d: 0, uses_today: 0, waiting: 0 };
    return `<span class="st-cstats">
      <span><b>${num(x.uses)}</b>${c.usage_limit ? '/' + num(c.usage_limit) : ''} ครั้ง<small>ใช้ทั้งหมด</small></span>
      <span><b>${baht(x.discount)}</b><small>ส่วนลดรวม</small></span>
      <span><b>${num(x.uses_30d)}</b> · ${baht(x.discount_30d)}<small>30 วันล่าสุด</small></span>
      ${x.uses_today ? `<span><b>${num(x.uses_today)}</b><small>วันนี้</small></span>` : ''}
      ${x.waiting ? `<span class="st-cstats-wait"><b>${num(x.waiting)}</b> โต๊ะ<small>ใส่ไว้ รอเช็กบิล</small></span>` : ''}
    </span>`;
  }
  const onOff = (on) => `<span class="st-onoff st-onoff--${on ? 'on' : 'off'}">${on ? '● เปิดใช้งาน' : '○ ปิดอยู่'}</span>`;
  function render() {
    $('#promo-list').innerHTML = data.promotions.length ? data.promotions.map(p => `
      <div class="st-item st-item--deal${p.is_active ? ' st-item--on' : ' st-item--void'}" data-promo="${esc(p.id)}">
        <div class="st-logo">−${num(p.percent)}%</div>
        <div class="st-item-main" data-act="edit-promo" role="button" tabindex="0"><b>${esc(p.name)}</b>
          <small>${onOff(p.is_active)}</small><small>${esc(daysText(p.days))} · ${esc(timeText(p))}</small><small>${esc(scopeText(p))}</small>
          ${p.guest_note ? `<small>💬 ${esc(p.guest_note)}</small>` : ''}${p.show_guest === false ? '<small>🔒 ไม่แสดงในรายการโปรของลูกค้า</small>' : ''}</div>
        <label class="st-switch"><input type="checkbox" data-act="toggle-promo" ${p.is_active ? 'checked' : ''} aria-label="เปิดใช้"><span></span><em>${p.is_active ? 'เปิด' : 'ปิด'}</em></label>
      </div>`).join('') : '<p class="st-sub">ยังไม่มีโปร</p>';
    $('#coupon-list').innerHTML = data.coupons.length ? data.coupons.map(c => `
      <div class="st-item st-item--deal st-item--wrap${c.is_active ? ' st-item--on' : ' st-item--void'}" data-coupon="${esc(c.id)}">
        <div class="st-logo st-logo--code">🎟</div>
        <div class="st-item-main" data-act="edit-coupon" role="button" tabindex="0"><b><span class="st-code">${esc(c.code)}</span></b><small>${onOff(c.is_active)}</small>
          ${c.title ? `<small><b>${esc(c.title)}</b></small>` : ''}
          <small>${esc(couponText(c))}${c.stack_promo === false ? ' · ใช้ร่วมโปรไม่ได้' : ''}</small>
          <small>${MODE_SHORT[c.guest_mode] || ''}${c.guest_note ? ' · 💬 ' + esc(c.guest_note) : ''}</small>
          ${c.note ? `<small>📝 ${esc(c.note)}</small>` : ''}</div>
        <label class="st-switch"><input type="checkbox" data-act="toggle-coupon" ${c.is_active ? 'checked' : ''} aria-label="เปิดใช้"><span></span><em>${c.is_active ? 'เปิด' : 'ปิด'}</em></label>
        ${statsHtml(c)}
        <div class="st-crow-actions"><button type="button" class="st-chip" data-act="qr-coupon">🔳 QR คูปอง</button><button type="button" class="st-chip" data-act="edit-coupon">✏️ แก้ไข</button></div>
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
        <label class="st-field"><span>รายละเอียดให้ลูกค้าเห็น (ไม่บังคับ)</span><textarea name="gnote" maxlength="300" rows="2" placeholder="เช่น เฉพาะทานที่ร้าน · ไม่รวมเครื่องดื่มแอลกอฮอล์">${esc(p.guest_note || '')}</textarea></label>
        <label class="st-check"><input type="checkbox" name="showg"${p.show_guest === false ? '' : ' checked'}> <span>แสดงในรายการโปรของลูกค้า (ปุ่ม 🎁)</span></label>
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
        <h4 class="st-form-h">ที่ลูกค้าเห็น</h4>
        <label class="st-field"><span>ชื่อคูปอง</span><input name="title" maxlength="60" value="${esc(c.title || '')}" placeholder="เช่น ส่วนลดผู้สูงอายุ / ลูกค้าใหม่ลด 10%"></label>
        <label class="st-field"><span>รายละเอียด / เงื่อนไข</span><textarea name="gnote" maxlength="300" rows="3" placeholder="เช่น แสดงบัตรประชาชน อายุ 60 ปีขึ้นไป · ใช้ได้เฉพาะทานที่ร้าน">${esc(c.guest_note || '')}</textarea></label>
        <div class="st-field"><span>ลูกค้าใช้คูปองนี้อย่างไร</span>
          <div class="st-radios">
            ${['show', 'call', 'hidden'].map(m => `<label class="st-radio"><input type="radio" name="gmode" value="${m}"${(c.guest_mode || 'call') === m ? ' checked' : ''}><span>${MODE[m]}</span></label>`).join('')}
          </div>
        </div>
        <label class="st-check"><input type="checkbox" name="stack"${c.stack_promo === false ? '' : ' checked'}> <span>ใช้ร่วมกับโปรลดราคาตามเวลาได้</span></label>
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
    if (el.dataset.act === 'qr-coupon') couponQR(data.coupons.find(c => c.id === el.closest('[data-coupon]').dataset.coupon));
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
    const { data: newId, error } = await sb.rpc(rpc, { p_shop: shopId, p: payload });
    if (!error) {
      const id = payload.id || newId;
      const ex = f.id === 'f-promo'
        ? await sb.rpc('st_set_promo_guest', { p_id: id, p: { guest_note: f.gnote.value.trim(), show_guest: f.showg.checked } })
        : await sb.rpc('st_set_coupon_guest', { p_id: id, p: { title: f.title.value.trim(), guest_note: f.gnote.value.trim(),
                                                               guest_mode: f.querySelector('[name=gmode]:checked').value, stack_promo: f.stack.checked } });
      if (ex.error) { btn.disabled = false; return sheetMsg(err(ex.error)); }
    }
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

  // ---------- โต๊ะละกี่คูปอง ----------
  $('#per-table').addEventListener('change', async (e) => {
    const { error } = await sb.from('st_shops').update({ coupon_per_table: Number(e.target.value) }).eq('id', shopId);
    showMsg(error ? err(error) : 'บันทึกแล้ว: หนึ่งโต๊ะใช้คูปองได้ ' + e.target.value + ' ใบ', error ? 'error' : 'ok');
  });

  // ---------- QR คูปอง: ลูกค้าสแกนด้วยกล้องมือถือ หรือปุ่ม "สแกน QR คูปอง" ในหน้าสั่งอาหาร ----------
  const couponUrl = (c) => pageUrl('coupon.html') + '?c=' + encodeURIComponent(c.code) + '&s=' + encodeURIComponent(shopId);
  function couponQR(c) {
    if (!c) return;
    const url = couponUrl(c);
    open('QR คูปอง ' + c.code, `
      <div class="st-cqr">
        <div class="st-cqr-card" id="cqr-card">
          <b>${esc(c.title || couponText(c).split(' · ')[0])}</b>
          <div class="st-qr-big">${STQR.svg(url, { margin: 2 })}</div>
          <span class="st-code">${esc(c.code)}</span>
          <small>สแกนด้วยกล้องมือถือ หรือปุ่ม 🎁 → สแกน QR คูปอง ในหน้าสั่งอาหาร</small>
        </div>
        ${c.guest_mode === 'call' ? '<p class="st-sub">คูปองนี้ตั้งเป็น "เรียกพนักงานตรวจสิทธิ์" — ให้พนักงานเปิด QR นี้ให้ลูกค้าสแกน หลังตรวจสิทธิ์แล้ว</p>' : ''}
        ${c.guest_mode === 'hidden' ? '<p class="st-sub">คูปองนี้ซ่อนจากรายการของลูกค้า ใช้ได้เฉพาะคนที่ได้ QR / โค้ดนี้</p>' : ''}
        ${!c.is_active ? '<p class="st-msg st-msg--error">คูปองนี้ปิดอยู่ ลูกค้าสแกนแล้วจะใช้ไม่ได้</p>' : ''}
        <div class="st-sheet-actions">
          <button class="st-btn" type="button" data-act="cqr-save">⬇ บันทึกรูป QR</button>
          <button class="st-btn st-btn--ghost" type="button" data-act="cqr-share">ส่งลิงก์คูปอง</button>
          <button class="st-btn st-btn--ghost" type="button" data-act="cqr-print">🖨 พิมพ์</button>
        </div>
      </div>`);
    $('#sheet-body').dataset.coupon = c.id;
  }
  function svgToPng(svgEl, label, title) {
    return new Promise((resolve) => {
      const xml = new XMLSerializer().serializeToString(svgEl);
      const img = new Image();
      img.onload = () => {
        const W = 720, P = 40, Q = W - P * 2;
        const cv = document.createElement('canvas'); cv.width = W; cv.height = W + 170;
        const x = cv.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
        x.fillStyle = '#1F1A14'; x.textAlign = 'center';
        x.font = '600 34px "IBM Plex Sans Thai", sans-serif'; x.fillText(title, W / 2, 56);
        x.drawImage(img, P, 80, Q, Q);
        x.font = '700 48px "IBM Plex Sans Thai", monospace'; x.fillText(label, W / 2, W + 130);
        cv.toBlob(resolve, 'image/png');
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    });
  }
  $('#sheet-body').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act^="cqr-"]');
    if (!b) return;
    const c = data.coupons.find(x => x.id === $('#sheet-body').dataset.coupon);
    if (!c) return;
    const title = c.title || 'คูปองส่วนลด';
    if (b.dataset.act === 'cqr-print') return window.print();
    if (b.dataset.act === 'cqr-share') {
      const text = `${title} · โค้ด ${c.code}\nสแกน QR โต๊ะแล้วใส่โค้ด หรือเปิดลิงก์นี้:\n${couponUrl(c)}`;
      if (navigator.share) { try { await navigator.share({ title, text }); return; } catch (er) { if (er && er.name === 'AbortError') return; } }
      const ok = await copyText(text);
      return showMsg(ok ? 'คัดลอกข้อความคูปองพร้อมลิงก์แล้ว' : 'คัดลอกไม่ได้', ok ? 'ok' : 'error');
    }
    const blob = await svgToPng($('#cqr-card svg'), c.code, title);
    if (!blob) return;
    const file = new File([blob], `coupon-${c.code}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title }); return; } catch { /* ดาวน์โหลดแทน */ } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  await load();
})();
