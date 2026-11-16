// ===== หน้า รายงานยอดขาย (reports.html?id=<shop_id>) — เจ้าของ / ผู้จัดการ =====
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, hideMsg, requireUser } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;
  const shopId = new URLSearchParams(location.search).get('id');
  if (!shopId) return location.replace('home.html');
  $('#back').href = 'shop.html?id=' + encodeURIComponent(shopId);

  const { data: shop } = await sb.from('st_shops').select('name').eq('id', shopId).maybeSingle();
  $('#shop-sub').textContent = shop ? shop.name : '';

  const money = (n, d = 0) => '฿' + Number(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: 2 });
  const num = (n) => Number(n).toLocaleString('th-TH');
  const METHOD = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', transfer: 'โอน', card: 'บัตร' };

  // ---------- วันที่ (เวลาไทย) ----------
  const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const toD = (s) => new Date(s + 'T00:00:00Z');
  const toS = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return toS(d); };
  const thDate = (s, opt = { day: 'numeric', month: 'short' }) => toD(s).toLocaleDateString('th-TH', { ...opt, timeZone: 'UTC' });

  function preset(p) {
    const t = todayStr();
    const [y, m] = t.split('-').map(Number);
    switch (p) {
      case 'today': return [t, t];
      case 'yesterday': return [addDays(t, -1), addDays(t, -1)];
      case '7d': return [addDays(t, -6), t];
      case '30d': return [addDays(t, -29), t];
      case 'month': return [`${y}-${String(m).padStart(2, '0')}-01`, t];
      case 'lastmonth': {
        const first = toD(`${y}-${String(m).padStart(2, '0')}-01`);
        const end = new Date(first); end.setUTCDate(0);
        return [toS(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))), toS(end)];
      }
    }
  }

  let current = 'today';
  let report = null;
  function setRange(from, to, p) {
    $('#d-from').value = from; $('#d-to').value = to;
    current = p || null;
    document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === current)));
    load();
  }
  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (b) { const [f, t] = preset(b.dataset.p); setRange(f, t, b.dataset.p); }
  });
  const onDate = () => {
    let f = $('#d-from').value, t = $('#d-to').value;
    if (!f || !t) return;
    if (t < f) [f, t] = [t, f];
    setRange(f, t, null);
  };
  $('#d-from').addEventListener('change', onDate);
  $('#d-to').addEventListener('change', onDate);

  // ---------- โหลด ----------
  async function load() {
    const from = $('#d-from').value, to = $('#d-to').value;
    hideMsg();
    const { data, error } = await sb.rpc('st_sales_report', { p_shop: shopId, p_from: from, p_to: to });
    if (error) {
      $('#r-body').hidden = true;
      return showMsg(error.message === 'st_bad_date_range' ? 'ช่วงวันที่ไม่ถูกต้อง (ดูได้ไม่เกิน 366 วัน)'
        : error.message === 'st_forbidden' ? 'รายงานยอดขายดูได้เฉพาะเจ้าของร้านและผู้จัดการ' : thaiError(error));
    }
    report = data;
    render();
    loadRatings(from, to);
    $('#r-body').hidden = false;
    $('#btn-csv').hidden = !data.receipts.length;
  }

  // ---------- แสดงผล ----------
  function render() {
    const r = report, t = r.totals;
    $('#k-net').textContent = money(t.net, 2);
    $('#k-bills').textContent = num(t.bills);
    $('#k-avg').textContent = money(t.avg_bill);
    $('#k-guests').textContent = t.guests ? num(t.guests) + ' คน' : '–';
    $('#k-breakdown').innerHTML = [
      ['ค่าอาหาร', money(t.gross, 2)],
      ['ส่วนลด', Number(t.discount) ? '−' + money(t.discount, 2) : '–'],
      ['ค่าบริการ', money(t.service, 2)],
      ['VAT', money(t.vat, 2)],
      ['ใบที่ยกเลิก', r.voided.count ? `${r.voided.count} ใบ (${money(r.voided.amount)})` : '–']
    ].map(([k, v]) => `<span><small>${k}</small>${v}</span>`).join('');

    $('#leaks').hidden = !r.leaks.count;
    $('#leaks').innerHTML = r.leaks.count ? `⚠️ <b>มี ${r.leaks.count} โต๊ะที่ปิดโดยไม่บันทึกการรับเงิน</b> รวม ${money(r.leaks.amount, 2)}
      (ไม่นับในยอดขาย)<br><small>${r.leaks.list.slice(0, 8).map(l => `โต๊ะ ${esc(l.table_label)} ${new Date(l.closed_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${money(l.amount)}`).join('<br>')}</small>` : '';

    renderChart();
    renderMethods();
    renderTop();
    renderCats();
  }

  // ----- กราฟแท่ง (ซีรีส์เดียว สีเดียว) -----
  function chartData() {
    const r = report;
    if (r.from === r.to) {                                   // วันเดียว -> รายชั่วโมง
      const by = Object.fromEntries(r.by_hour.map(h => [h.hour, h]));
      const hours = r.by_hour.map(h => h.hour);
      const lo = hours.length ? Math.min(...hours, 10) : 10, hi = hours.length ? Math.max(...hours, 21) : 21;
      const rows = [];
      for (let h = lo; h <= hi; h++) rows.push({ key: String(h), label: String(h).padStart(2, '0') + ':00', short: String(h), total: Number(by[h]?.total || 0), bills: by[h]?.bills || 0 });
      return { title: `ยอดขายรายชั่วโมง · ${thDate(r.from, { day: 'numeric', month: 'long', year: 'numeric' })}`, rows };
    }
    const by = Object.fromEntries(r.by_day.map(d => [d.day, d]));
    const rows = [];
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
      rows.push({ key: d, label: thDate(d, { weekday: 'short', day: 'numeric', month: 'short' }), short: String(Number(d.slice(8))), total: Number(by[d]?.total || 0), bills: by[d]?.bills || 0 });
    }
    return { title: `ยอดขายรายวัน · ${thDate(r.from)} – ${thDate(r.to, { day: 'numeric', month: 'short', year: 'numeric' })}`, rows };
  }

  function niceMax(v) {
    if (v <= 0) return 100;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
    return 10 * p;
  }

  function renderChart() {
    const { title, rows } = chartData();
    $('#chart-title').textContent = title;
    const W = Math.max(300, Math.round($('#chart').clientWidth || 640)), H = 230, L = 44, R = 6, T = 10, B = 26;   // วาดตามความกว้างจริง ตัวอักษรไม่หด
    const max = niceMax(Math.max(...rows.map(r => r.total), 0));
    const n = rows.length, slot = (W - L - R) / n;
    const bw = Math.max(2, Math.min(28, slot - 2));          // ช่องว่างระหว่างแท่งอย่างน้อย 2px
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const every = Math.ceil(n / Math.max(4, Math.floor((W - L - R) / 34)));   // ป้ายแกน x ไม่ให้ชนกัน
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
    for (let i = 0; i <= 4; i++) {                            // เส้นกริดจาง ๆ
      const v = max * i / 4, yy = y(v);
      svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="g${i === 0 ? ' base' : ''}"/>`
           + `<text x="${L - 6}" y="${yy + 4}" text-anchor="end" class="ax">${v >= 1000 ? (v / 1000).toLocaleString('th-TH', { maximumFractionDigits: 1 }) + 'k' : num(v)}</text>`;
    }
    rows.forEach((r, i) => {
      const cx = L + slot * i + slot / 2, x = cx - bw / 2, top = y(r.total), h = H - B - top;
      if (r.total > 0) {
        const rr = Math.min(4, bw / 2, h);                    // ปลายแท่งมนด้านบน ฐานตรง
        svg += `<path class="bar" d="M${x},${H - B} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + bw - rr} Q${x + bw},${top} ${x + bw},${top + rr} V${H - B} Z"/>`;
      }
      if (i % every === 0) svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="ax">${esc(r.short)}</text>`;
      svg += `<rect class="hit" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" data-i="${i}"/>`;
    });
    svg += '</svg>';
    $('#chart').innerHTML = rows.some(r => r.total > 0) ? svg : '<div class="st-empty">ยังไม่มียอดขายในช่วงนี้</div>';

    $('#chart-table').innerHTML = `<table class="st-tbl"><thead><tr><th>${report.from === report.to ? 'ชั่วโมง' : 'วัน'}</th><th>บิล</th><th>ยอดขาย</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.label)}</td><td>${r.bills}</td><td>${money(r.total, 2)}</td></tr>`).join('')}</tbody></table>`;

    // tooltip
    const tip = $('#tip');
    const svgEl = $('#chart svg');
    if (!svgEl) return;
    const show = (e) => {
      const hit = e.target.closest('.hit');
      svgEl.querySelectorAll('.hit.on').forEach(h => h.classList.remove('on'));
      if (!hit) { tip.hidden = true; return; }
      hit.classList.add('on');
      const r = rows[+hit.dataset.i];
      tip.innerHTML = `<b>${esc(r.label)}</b><br>${money(r.total, 2)} · ${r.bills} บิล`;
      tip.hidden = false;
      const b = hit.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, b.left + b.width / 2 - tip.offsetWidth / 2)) + 'px';
      tip.style.top = (b.top + window.scrollY - tip.offsetHeight - 6) + 'px';
    };
    svgEl.addEventListener('pointermove', show);
    svgEl.addEventListener('pointerdown', show);
    svgEl.addEventListener('pointerleave', () => { tip.hidden = true; svgEl.querySelectorAll('.hit.on').forEach(h => h.classList.remove('on')); });
  }

  // ----- แถบแนวนอน (ช่องทางชำระ / หมวด) -----
  function hbars(rows, valueKey, labelFn, extraFn) {
    const max = Math.max(...rows.map(r => Number(r[valueKey])), 0) || 1;
    return rows.length ? rows.map(r => `
      <div class="st-hbar">
        <div class="st-hbar-label"><span>${labelFn(r)}</span><b>${money(r[valueKey], 2)}</b></div>
        <div class="st-hbar-track"><i style="width:${Math.max(1, Number(r[valueKey]) / max * 100)}%"></i></div>
        ${extraFn ? `<small>${extraFn(r)}</small>` : ''}
      </div>`).join('') : '<p class="st-sub">ไม่มีข้อมูล</p>';
  }
  function renderMethods() {
    const net = Number(report.totals.net) || 1;
    $('#methods').innerHTML = hbars(report.by_method, 'total', r => esc(METHOD[r.method] || r.method),
      r => `${r.bills} บิล · ${Math.round(Number(r.total) / net * 100)}%`);
  }
  function renderCats() {
    $('#cats').innerHTML = hbars(report.by_category, 'revenue', r => esc(r.category), r => `${num(r.qty)} ชิ้น`);
  }
  function renderTop() {
    const rows = report.top_items;
    $('#top-items').innerHTML = rows.length ? `<table class="st-tbl"><thead><tr><th>#</th><th>เมนู</th><th>จำนวน</th><th>ยอดขาย</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${num(r.qty)}</td><td>${money(r.revenue, 2)}</td></tr>`).join('')}
      </tbody></table><p class="st-sub" style="margin:8px 0 0">ยอดขายรายเมนูเป็นราคาก่อนส่วนลด/ค่าบริการ</p>` : '<p class="st-sub">ไม่มีข้อมูล</p>';
  }

  // ----- คะแนนจากลูกค้า -----
  async function loadRatings(from, to) {
    const { data: r, error } = await sb.rpc('st_rating_summary', { p_shop: shopId, p_from: from, p_to: to });
    if (error) { $('#ratings').innerHTML = `<p class="st-sub">${esc(thaiError(error))}</p>`; return; }
    if (!r.count) { $('#ratings').innerHTML = '<p class="st-sub">ยังไม่มีคะแนนในช่วงนี้ (ลูกค้าให้คะแนนได้ตอนเช็กบิล และภายใน 3 ชม. หลังจ่าย)</p>'; return; }
    const max = Math.max(...r.dist, 1);
    $('#ratings').innerHTML = `
      <div class="st-rating-head"><b>${Number(r.avg).toFixed(1)}</b><span class="st-stars-ro" aria-label="${Number(r.avg).toFixed(1)} ดาว">${'★'.repeat(Math.round(r.avg))}${'☆'.repeat(5 - Math.round(r.avg))}</span><small>${num(r.count)} คะแนน</small></div>
      ${[5, 4, 3, 2, 1].map(s => `
        <div class="st-hbar st-hbar--rate"><div class="st-hbar-label"><span>${s} ★</span><b>${r.dist[s - 1]}</b></div>
          <div class="st-hbar-track"><i style="width:${Math.max(r.dist[s - 1] ? 2 : 0, r.dist[s - 1] / max * 100)}%"></i></div></div>`).join('')}
      ${r.comments.length ? `<h4>ความเห็นล่าสุด</h4>${r.comments.map(c => `
        <div class="st-ev"><span class="st-ev-icon">${c.stars}★</span><div class="st-ev-main"><b>${esc(c.comment)}</b>
          <small>โต๊ะ ${esc(c.table_label)} · ${new Date(c.at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div></div>`).join('')}` : ''}`;
  }

  // ---------- CSV (เปิดใน Excel / Google Sheets ภาษาไทยไม่เพี้ยน) ----------
  $('#btn-csv').addEventListener('click', () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['วันที่', 'เวลา', 'เลขที่', 'โต๊ะ', 'ช่องทาง', 'ค่าอาหาร', 'ส่วนลด', 'ค่าบริการ', 'VAT', 'ยอดสุทธิ', 'สถานะ'];
    const lines = report.receipts.map(p => {
      const d = new Date(p.created_at);
      const ymd = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      return [ymd, d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }),
              ymd.replace(/-/g, '') + '-' + String(p.receipt_no).padStart(3, '0'), p.table_label, METHOD[p.method] || p.method,
              p.subtotal, p.discount, p.service, p.vat, p.total, p.status === 'void' ? 'ยกเลิก' : 'ชำระแล้ว'].map(q).join(',');
    });
    const blob = new Blob(['﻿' + [head.map(q).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `smarttable-sales-${report.from}_${report.to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (report) renderChart(); }, 200); });

  // ---------- เริ่มต้น ----------
  const [f, t] = preset('today');
  setRange(f, t, 'today');
})();
