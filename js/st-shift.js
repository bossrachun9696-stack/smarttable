// ===== หน้า ปิดกะ / นับเงินลิ้นชัก (shift.html?id=<shop_id>) · รอบ M =====
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, hideMsg, requireUser } = ST;
  if (!configOk) return;
  if (!(await requireUser())) return;
  const shopId = new URLSearchParams(location.search).get('id');
  if (!shopId) return location.replace('home.html');
  $('#back').href = 'shop.html?id=' + encodeURIComponent(shopId);

  const money = (n) => '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const METHOD = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', transfer: 'โอนเงิน', card: 'บัตร' };
  const NOTES = [1000, 500, 100, 50, 20, 10, 5, 2, 1];
  const when = (iso) => iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  let st = null;

  const { data: shop } = await sb.from('st_shops').select('name').eq('id', shopId).maybeSingle();
  if (shop) { $('#shop-sub').textContent = shop.name; document.title = 'ปิดกะ · ' + shop.name; }

  // ช่องนับธนบัตร/เหรียญ (หรือพิมพ์ยอดรวมเองก็ได้)
  function counter(name) {
    return `
      <details class="st-count">
        <summary>🧮 นับแยกธนบัตร / เหรียญ</summary>
        <div class="st-count-grid">
          ${NOTES.map(v => `<label><span>${v >= 20 ? '💵' : '🪙'} ${v}</span><input type="number" min="0" step="1" inputmode="numeric" data-note="${v}" data-for="${name}" placeholder="0"></label>`).join('')}
        </div>
      </details>`;
  }
  function sumNotes(form, name) {
    let t = 0;
    form.querySelectorAll(`[data-for="${name}"]`).forEach(i => { t += (parseInt(i.value, 10) || 0) * Number(i.dataset.note); });
    return t;
  }

  function summaryHtml(sm, blind) {
    if (!sm) return '';
    return `
      <div class="st-kv">
        <div><span>เงินทอนตั้งต้น</span><b>${money(sm.opening)}</b></div>
        ${blind ? '' : `<div><span>รับเงินสด</span><b>${money(sm.cash_sales)}</b></div>`}
        <div><span>เงินเข้าอื่น ๆ</span><b>${money(sm.moves_in)}</b></div>
        <div><span>เงินออก (จ่ายค่าของ ฯลฯ)</span><b>-${money(sm.moves_out)}</b></div>
        ${blind ? '' : `<div class="st-kv-total"><span>ควรมีเงินสดในลิ้นชัก</span><b>${money(sm.expected)}</b></div>`}
      </div>
      ${blind ? '<p class="st-sub">ร้านตั้ง "นับแบบไม่เห็นยอด" — นับเงินแล้วใส่ตัวเลขจริง ระบบจะคำนวณให้เจ้าของดู</p>' : `
      <p class="st-sub">${sm.bills} บิล · ยอดขาย ${money(sm.net)}${Number(sm.discount) ? ' · ส่วนลด ' + money(sm.discount) : ''}${sm.voided && sm.voided.count ? ' · ยกเลิกใบเสร็จ ' + sm.voided.count + ' ใบ (' + money(sm.voided.amount) + ')' : ''}</p>
      ${(sm.by_method || []).length ? `<div class="st-chips">${sm.by_method.map(m => `<span class="st-tag">${esc(METHOD[m.method] || m.method)} ${money(m.total)}</span>`).join('')}</div>` : ''}`}
      ${(sm.moves || []).length ? `<ul class="st-moves">${sm.moves.map(m => `<li><b class="${m.amount < 0 ? 'neg' : 'pos'}">${m.amount < 0 ? '−' : '+'}${money(Math.abs(m.amount))}</b> ${esc(m.reason)} <small>${when(m.at)}${m.by ? ' · ' + esc(m.by) : ''}</small></li>`).join('')}</ul>` : ''}`;
  }

  function render() {
    const box = $('#shift-box');
    if (!st.can) {
      box.innerHTML = `<section class="st-card"><p>ตำแหน่งของคุณเปิด/ปิดกะไม่ได้ · ให้แคชเชียร์ ผู้จัดการ หรือเจ้าของทำ</p></section>`;
    } else if (!st.open) {
      box.innerHTML = `
        <section class="st-card">
          <h2>เปิดกะใหม่</h2>
          ${st.required ? '<p class="st-banner">⚠️ ร้านตั้งให้ <b>ต้องเปิดกะก่อนรับเงิน</b></p>' : ''}
          <form id="f-open" novalidate>
            <label class="st-field"><span>เงินทอนตั้งต้นในลิ้นชัก (บาท)</span>
              <input name="cash" type="number" min="0" step="0.01" inputmode="decimal" placeholder="เช่น 1000" required></label>
            ${counter('open')}
            <button class="st-btn" type="submit">▶ เปิดกะ</button>
          </form>
        </section>`;
    } else {
      const s = st.open;
      box.innerHTML = `
        <section class="st-card st-shift-open">
          <h2>🟢 กะที่เปิดอยู่</h2>
          <p class="st-sub">เปิดเมื่อ ${when(s.opened_at)}${s.opened_by ? ' · โดย ' + esc(s.opened_by) : ''}</p>
          ${summaryHtml(s.summary, st.blind)}
        </section>
        <section class="st-card">
          <h2>เงินเข้า / ออกระหว่างกะ</h2>
          <p class="st-sub">เช่น เอาเงินในลิ้นชักไปซื้อน้ำแข็ง (ออก) หรือเติมเงินทอน (เข้า)</p>
          <form id="f-move" class="st-move-form" novalidate>
            <div class="st-radioseg"><label><input type="radio" name="dir" value="-1" checked><span>− เงินออก</span></label><label><input type="radio" name="dir" value="1"><span>+ เงินเข้า</span></label></div>
            <div class="st-grid2">
              <label class="st-field"><span>จำนวน (บาท)</span><input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required></label>
              <label class="st-field"><span>เหตุผล</span><input name="reason" type="text" maxlength="100" placeholder="เช่น ซื้อน้ำแข็ง" required></label>
            </div>
            <button class="st-btn st-btn--ghost" type="submit">บันทึก</button>
          </form>
        </section>
        <section class="st-card">
          <h2>ปิดกะ</h2>
          <form id="f-close" novalidate>
            <label class="st-field"><span>นับเงินสดในลิ้นชักได้จริง (บาท)</span>
              <input name="counted" type="number" min="0" step="0.01" inputmode="decimal" required></label>
            ${counter('close')}
            <p id="diff" class="st-diff" hidden></p>
            <label class="st-field"><span>หมายเหตุ (ไม่บังคับ)</span><input name="note" type="text" maxlength="300"></label>
            <button class="st-btn" type="submit">■ ปิดกะ</button>
          </form>
        </section>`;
    }
    const hb = $('#hist-box');
    hb.hidden = !st.boss || !(st.history || []).length;
    if (!hb.hidden) {
      $('#hist').innerHTML = st.history.map(h => {
        const d = Number(h.counted_cash) - Number(h.expected_cash);
        return `
          <details class="st-hist">
            <summary><span>${when(h.opened_at)} → ${when(h.closed_at)}</span>
              <b class="${Math.abs(d) < 0.01 ? 'ok' : d < 0 ? 'neg' : 'pos'}">${Math.abs(d) < 0.01 ? 'ตรง ✓' : (d < 0 ? 'ขาด ' : 'เกิน ') + money(Math.abs(d))}</b></summary>
            <p class="st-sub">เปิด: ${esc(h.opened_by || '-')} · ปิด: ${esc(h.closed_by || '-')} · นับได้ ${money(h.counted_cash)} / ควรมี ${money(h.expected_cash)}${h.note ? ' · ' + esc(h.note) : ''}</p>
            ${summaryHtml(h.summary, false)}
          </details>`;
      }).join('');
    }
  }

  async function load() {
    const { data, error } = await sb.rpc('st_shift_status', { p_shop: shopId });
    if (error) return showMsg(thaiError(error));
    st = data;
    render();
  }

  // นับแยก → ใส่ยอดรวมให้
  document.addEventListener('input', (e) => {
    const n = e.target.dataset && e.target.dataset.for;
    const f = e.target.form;
    if (n && f) {
      const t = sumNotes(f, n);
      const target = n === 'open' ? f.cash : f.counted;
      target.value = t ? t : '';
    }
    const fc = $('#f-close');
    if (fc && (e.target.form === fc) && st.open && !st.blind && st.open.summary) {
      const v = Number(fc.counted.value);
      const p = $('#diff');
      if (fc.counted.value === '') { p.hidden = true; return; }
      const d = v - Number(st.open.summary.expected);
      p.hidden = false;
      p.className = 'st-diff ' + (Math.abs(d) < 0.01 ? 'ok' : d < 0 ? 'neg' : 'pos');
      p.textContent = Math.abs(d) < 0.01 ? 'ตรงพอดี ✓' : (d < 0 ? 'ขาด ' : 'เกิน ') + money(Math.abs(d));
    }
  });

  document.addEventListener('submit', async (e) => {
    const f = e.target;
    if (!['f-open', 'f-move', 'f-close'].includes(f.id)) return;
    e.preventDefault();
    hideMsg();
    const btn = f.querySelector('button[type=submit]');
    let res;
    if (f.id === 'f-open') {
      if (f.cash.value === '') return showMsg('ใส่เงินทอนตั้งต้น (ไม่มีใส่ 0)');
      btn.disabled = true;
      res = await sb.rpc('st_shift_open', { p_shop: shopId, p_cash: Number(f.cash.value) });
    } else if (f.id === 'f-move') {
      const a = Number(f.amount.value);
      if (!(a > 0) || !f.reason.value.trim()) return showMsg('ใส่จำนวนและเหตุผล');
      btn.disabled = true;
      res = await sb.rpc('st_shift_move', { p_shop: shopId, p_amount: a * Number(f.dir.value), p_reason: f.reason.value.trim() });
    } else {
      if (f.counted.value === '') return showMsg('ใส่ยอดเงินที่นับได้');
      if (!confirm('ปิดกะตอนนี้? ปิดแล้วแก้ไม่ได้')) return;
      btn.disabled = true;
      res = await sb.rpc('st_shift_close', { p_shop: shopId, p_counted: Number(f.counted.value), p_note: f.note.value.trim() || null });
      if (!res.error) {
        const sm = res.data.shift.summary || {};
        const d = Number(sm.diff || 0);
        showMsg('ปิดกะแล้ว · ' + (Math.abs(d) < 0.01 ? 'เงินตรงพอดี ✓' : (d < 0 ? 'เงินขาด ' : 'เงินเกิน ') + money(Math.abs(d))), Math.abs(d) < 0.01 ? 'ok' : '');
        return load();
      }
    }
    btn.disabled = false;
    if (res.error) return showMsg(thaiError(res.error));
    st = res.data;
    render();
    if (f.id === 'f-open') showMsg('เปิดกะแล้ว ✓', 'ok');
    if (f.id === 'f-move') showMsg('บันทึกแล้ว ✓', 'ok');
  });

  await load();
})();
