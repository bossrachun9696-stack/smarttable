// ===== หน้า ลูกค้าสแกน QR (table.html?t=<qr_token>) — ไม่ต้องล็อกอิน =====
// ขั้นที่ 4: แสดงร้าน โต๊ะ สถานะ และเมนู · ขั้นที่ 5 จะเพิ่มตะกร้าและการสั่ง
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg } = ST;
  if (!configOk) return;

  const qr = new URLSearchParams(location.search).get('t') || '';
  const KEY = 'st-session:' + qr;
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* ไม่เป็นไร */ } }
  };
  const imgUrl = (path) => sb.storage.from('st-images').getPublicUrl(path).data.publicUrl;
  const baht = (n) => '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const SPICY = ['', '🌶', '🌶🌶', '🌶🌶🌶'];

  const STATES = {
    open:        { cls: 'ok',   title: 'โต๊ะพร้อมสั่งอาหาร', text: 'เลือกเมนูได้เลย' },
    waiting:     { cls: 'wait', title: 'รอพนักงานเปิดโต๊ะ', text: 'ดูเมนูได้ก่อน สั่งอาหารได้เมื่อพนักงานเปิดโต๊ะให้ (หน้านี้จะอัปเดตเอง)' },
    billing:     { cls: 'wait', title: 'กำลังเช็กบิล', text: 'ถ้าต้องการสั่งเพิ่ม กรุณาแจ้งพนักงาน' },
    shop_closed: { cls: 'off',  title: 'ร้านปิดอยู่ตอนนี้', text: 'ดูเมนูได้ แต่ยังสั่งอาหารไม่ได้' },
    ended:       { cls: 'off',  title: 'โต๊ะนี้ปิดรอบแล้ว', text: 'ถ้ายังนั่งอยู่ที่ร้าน สแกน QR ที่โต๊ะอีกครั้งเพื่อสั่งต่อ' }
  };

  let state = null;

  // autoOpen = true เฉพาะตอนเปิดหน้าจากการสแกนจริง · เช็กสถานะเป็นระยะใช้ false
  async function scan(autoOpen) {
    const { data, error } = await sb.rpc('st_scan', { p_qr: qr, p_auto_open: !!autoOpen });
    if (error) {
      $('#g-shop').textContent = 'SmartTable';
      showMsg(thaiError(error));
      return null;
    }
    store.set(data.session_token || null);       // เก็บรหัสรอบไว้ใช้ตอนสั่ง (ขั้นที่ 5)
    state = data.state;
    $('#g-shop').textContent = data.shop.name;
    $('#g-sub').textContent = data.table.zone || '';
    $('#g-table').textContent = 'โต๊ะ ' + data.table.label;
    $('#g-table').hidden = false;
    document.title = data.shop.name + ' · โต๊ะ ' + data.table.label;
    const s = STATES[state];
    $('#g-state').className = 'st-state st-state--' + s.cls;
    $('#g-state').innerHTML = `<b>${esc(s.title)}</b><span>${esc(s.text)}</span>`;
    $('#g-state').hidden = false;
    return data;
  }

  // ---------- เมนู ----------
  let menu = { categories: [], items: [] };
  let activeCat = '';

  function renderMenu() {
    const term = $('#g-search').value.trim().toLowerCase();
    const cats = menu.categories.filter(c => menu.items.some(i => i.category_id === c.id));
    const loose = menu.items.filter(i => !i.category_id);
    const groups = cats.map(c => ({ id: c.id, name: c.name, items: menu.items.filter(i => i.category_id === c.id) }));
    if (loose.length) groups.push({ id: 'none', name: cats.length ? 'อื่น ๆ' : 'เมนู', items: loose });

    $('#g-cats').innerHTML = groups.length > 1 ? groups.map(g =>
      `<button type="button" data-cat="${esc(g.id)}" class="${g.id === activeCat ? 'on' : ''}">${esc(g.name)}</button>`).join('') : '';

    const shown = groups.map(g => ({
      ...g, items: g.items.filter(i => !term || i.name.toLowerCase().includes(term) || (i.description || '').toLowerCase().includes(term))
    })).filter(g => g.items.length);

    $('#g-items').innerHTML = shown.length ? shown.map(g => `
      <section class="st-gsec" id="cat-${esc(g.id)}">
        <h2>${esc(g.name)}</h2>
        ${g.items.map(i => `
          <article class="st-gitem${i.is_available ? '' : ' st-gitem--off'}">
            <div class="st-gimg">${i.image_path ? `<img src="${esc(imgUrl(i.image_path))}" alt="" loading="lazy">` : ''}</div>
            <div class="st-gbody">
              <h3>${esc(i.name)}</h3>
              ${i.description ? `<p>${esc(i.description)}</p>` : ''}
              <div class="st-gmeta">
                <b>${baht(i.price)}</b>
                ${i.is_recommended ? '<span class="st-tag st-tag--rec">⭐ แนะนำ</span>' : ''}
                ${i.spicy_level ? `<span class="st-tag">${SPICY[i.spicy_level]}</span>` : ''}
                ${i.is_available ? '' : '<span class="st-tag st-tag--off">หมด</span>'}
              </div>
            </div>
          </article>`).join('')}
      </section>`).join('')
      : `<div class="st-empty">${term ? 'ไม่พบเมนูที่ค้นหา' : 'ร้านยังไม่ได้เพิ่มเมนู'}</div>`;
  }

  $('#g-search').addEventListener('input', renderMenu);
  $('#g-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    activeCat = b.dataset.cat;
    $('#g-search').value = '';
    renderMenu();
    document.getElementById('cat-' + activeCat)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ---------- เริ่มต้น ----------
  if (!qr) { $('#g-shop').textContent = 'SmartTable'; return showMsg('ลิงก์ไม่ครบ กรุณาสแกน QR ที่โต๊ะอีกครั้ง'); }
  const first = await scan(true);
  if (!first) return;

  const { data: m, error } = await sb.rpc('st_public_menu', { p_qr: qr });
  if (error) return showMsg(thaiError(error));
  menu = m;
  renderMenu();
  $('#g-menu').hidden = false;

  // อัปเดตสถานะเองทุก 20 วินาที (เช่น รอพนักงานเปิดโต๊ะ)
  setInterval(() => { if (!document.hidden) scan(false); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scan(false); });
})();
