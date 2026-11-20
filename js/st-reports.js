// ===== หน้า รายงานยอดขาย (reports.html?id=<shop_id>) — เจ้าของ / ผู้จัดการ =====
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, hideMsg, requireUser, getPrefs, setPrefs, avatarUrl } = ST;
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
  const METHOD = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', transfer: 'โอน', card: 'บัตร', mixed: 'หลายช่องทาง' };

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
      case 'year': return [`${y}-01-01`, t];
      case '12m': return [addDays(t, -364), t];
      case '3y': return [`${y - 2}-01-01`, t];
      case 'lastmonth': {
        const first = toD(`${y}-${String(m).padStart(2, '0')}-01`);
        const end = new Date(first); end.setUTCDate(0);
        return [toS(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))), toS(end)];
      }
    }
  }

  let current = 'today';
  let report = null;
  let ins = null;            // st_sales_insights
  let groupBy = null;        // 'day' | 'month' | 'year' (null = เลือกให้ตามช่วงวันที่)
  function setRange(from, to, p) {
    $('#d-from').value = from; $('#d-to').value = to;
    current = p || null;
    groupBy = null;
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
    const [{ data, error }, insRes] = await Promise.all([
      sb.rpc('st_sales_report', { p_shop: shopId, p_from: from, p_to: to }),
      sb.rpc('st_sales_insights', { p_shop: shopId, p_from: from, p_to: to })
    ]);
    ins = insRes.error ? null : insRes.data;
    if (error) {
      $('#r-body').hidden = true;
      return showMsg(error.message === 'st_bad_date_range' ? 'ช่วงวันที่ไม่ถูกต้อง (ดูได้ไม่เกิน 3 ปี)'
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
    renderInsights();
    applyCards();
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
    const days = Math.round((toD(r.to) - toD(r.from)) / 86400000) + 1;
    const g = groupBy || (days <= 62 ? 'day' : days <= 800 ? 'month' : 'year');
    const range = `${thDate(r.from, r.from.slice(0, 4) !== r.to.slice(0, 4) ? { day: 'numeric', month: 'short', year: 'numeric' } : undefined)} – ${thDate(r.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    if (g === 'month' || g === 'year') {
      const map = {};
      for (const d of r.by_day) {
        const k = g === 'month' ? d.day.slice(0, 7) : d.day.slice(0, 4);
        map[k] = map[k] || { total: 0, bills: 0 };
        map[k].total += Number(d.total); map[k].bills += d.bills;
      }
      const rows = [];
      if (g === 'month') {
        for (let k = r.from.slice(0, 7); k <= r.to.slice(0, 7);) {
          const dt = toD(k + '-01');
          rows.push({ key: k, label: dt.toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
                      short: dt.toLocaleDateString('th-TH', { month: 'short', timeZone: 'UTC' }), total: map[k]?.total || 0, bills: map[k]?.bills || 0 });
          dt.setUTCMonth(dt.getUTCMonth() + 1); k = toS(dt).slice(0, 7);
        }
      } else {
        for (let y = Number(r.from.slice(0, 4)); y <= Number(r.to.slice(0, 4)); y++) {
          const k = String(y);
          rows.push({ key: k, label: 'ปี ' + (y + 543), short: String(y + 543), total: map[k]?.total || 0, bills: map[k]?.bills || 0 });
        }
      }
      return { title: `ยอดขายราย${g === 'month' ? 'เดือน' : 'ปี'} · ${range}`, rows, g, days };
    }
    const by = Object.fromEntries(r.by_day.map(d => [d.day, d]));
    const rows = [];
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
      rows.push({ key: d, label: thDate(d, { weekday: 'short', day: 'numeric', month: 'short' }), short: String(Number(d.slice(8))), total: Number(by[d]?.total || 0), bills: by[d]?.bills || 0 });
    }
    return { title: `ยอดขายรายวัน · ${range}`, rows, g: 'day', days };
  }

  function niceMax(v) {
    if (v <= 0) return 100;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
    return 10 * p;
  }

  function renderChart() {
    const cd = chartData();
    const { title, rows } = cd;
    $('#chart-title').textContent = title;
    // ปุ่มวัน / เดือน / ปี (เมื่อเลือกช่วงหลายวัน)
    const gb = $('#group-by');
    gb.hidden = report.from === report.to;
    if (!gb.hidden) {
      const opts = [['day', 'วัน'], ['month', 'เดือน'], ['year', 'ปี']].filter(([k]) => k !== 'day' || cd.days <= 400);
      gb.innerHTML = opts.map(([k, l]) => `<button type="button" data-g="${k}" aria-pressed="${k === cd.g}">${l}</button>`).join('');
    }
    drawBars($('#chart'), rows.map(r => ({ ...r, value: r.total })), {
      empty: 'ยังไม่มียอดขายในช่วงนี้',
      tip: (r) => `<b>${esc(r.label)}</b><br>${money(r.total, 2)} · ${r.bills} บิล`
    });
    const unitTh = report.from === report.to ? 'ชั่วโมง' : { day: 'วัน', month: 'เดือน', year: 'ปี' }[cd.g];
    $('#chart-table').innerHTML = `<table class="st-tbl"><thead><tr><th>${unitTh}</th><th>บิล</th><th>ยอดขาย</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.label)}</td><td>${r.bills}</td><td>${money(r.total, 2)}</td></tr>`).join('')}</tbody></table>`;
  }
  $('#group-by').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (b) { groupBy = b.dataset.g; renderChart(); }
  });

  // ----- กราฟแท่งแนวตั้ง (ซีรีส์เดียว สีเดียว · ปลายแท่งมน · tooltip แตะ/ชี้) -----
  // rows: [{ label, short, value, ... }]
  function drawBars(box, rows, opt = {}) {
    if (!rows.some(r => r.value > 0)) { box.innerHTML = `<div class="st-empty">${esc(opt.empty || 'ไม่มีข้อมูล')}</div>`; return; }
    const W = Math.max(300, Math.round(box.clientWidth || 640)), H = opt.height || 230, L = 44, R = 6, T = 10, B = 26;
    const max = niceMax(Math.max(...rows.map(r => r.value), 0));
    const n = rows.length, slot = (W - L - R) / n;
    const bw = Math.max(2, Math.min(28, slot - 2));
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const every = Math.ceil(n / Math.max(4, Math.floor((W - L - R) / 34)));
    const axis = opt.axis || ((v) => v >= 1000 ? (v / 1000).toLocaleString('th-TH', { maximumFractionDigits: 1 }) + 'k' : num(v));
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
    for (let i = 0; i <= 4; i++) {
      const v = max * i / 4, yy = y(v);
      svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="g${i === 0 ? ' base' : ''}"/>`
           + `<text x="${L - 6}" y="${yy + 4}" text-anchor="end" class="ax">${axis(v)}</text>`;
    }
    rows.forEach((r, i) => {
      const cx = L + slot * i + slot / 2, x = cx - bw / 2, top = y(r.value), h = H - B - top;
      if (r.value > 0) {
        const rr = Math.min(4, bw / 2, h);
        svg += `<path class="bar${r.hi ? ' hi' : ''}" d="M${x},${H - B} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + bw - rr} Q${x + bw},${top} ${x + bw},${top + rr} V${H - B} Z"/>`;
      }
      if (i % every === 0) svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="ax">${esc(r.short)}</text>`;
      svg += `<rect class="hit" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" data-i="${i}"/>`;
    });
    box.innerHTML = svg + '</svg>';
    const tip = $('#tip'), svgEl = box.querySelector('svg');
    const show = (e) => {
      const hit = e.target.closest('.hit');
      svgEl.querySelectorAll('.hit.on').forEach(h => h.classList.remove('on'));
      if (!hit) { tip.hidden = true; return; }
      hit.classList.add('on');
      tip.innerHTML = opt.tip(rows[+hit.dataset.i]);
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
  function hbars(rows, valueKey, labelFn, extraFn, fmt) {
    const max = Math.max(...rows.map(r => Number(r[valueKey])), 0) || 1;
    return rows.length ? rows.map(r => `
      <div class="st-hbar">
        <div class="st-hbar-label"><span>${labelFn(r)}</span><b>${fmt ? fmt(r[valueKey]) : money(r[valueKey], 2)}</b></div>
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

  // ---------- การ์ดเชิงลึก (st_sales_insights) ----------
  const DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสฯ', 'ศุกร์', 'เสาร์'];
  const DOW_S = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  function renderInsights() {
    const none = '<p class="st-sub">ไม่มีข้อมูล</p>';
    if (!ins) { ['money', 'hours', 'top-qty', 'weekday', 'coupons', 'promos', 'otype', 'kitchen'].forEach(id => { $('#' + id).innerHTML = '<p class="st-sub">รัน sql/st-15-alerts.sql ก่อน จึงจะเห็นการ์ดนี้</p>'; }); return; }
    // รายรับหลังหักส่วนลด
    const m = ins.money, t = report.totals;
    const other = Math.max(0, Number(m.bill_discount) - Number(m.coupon));
    const rows = [
      ['ค่าอาหารราคาเต็ม (ตามเมนู)', Number(m.gross_menu), ''],
      ['− โปรลดราคาตามเวลา', -Number(m.promo), 'neg'],
      ['− คูปอง', -Number(m.coupon), 'neg'],
      ['− ส่วนลดอื่น ๆ ในบิล', -other, 'neg'],
      ['+ ค่าบริการ', Number(m.service), ''],
      ['+ VAT', Number(m.vat), '']
    ];
    const totalDisc = Number(m.promo) + Number(m.bill_discount);
    $('#money').innerHTML = `
      <div class="st-money">${rows.map(([k, v, c]) => `<div class="st-money-row${c ? ' st-money-row--' + c : ''}"><span>${k}</span><b>${!v ? '–' : v < 0 ? '−' + money(-v, 2) : money(v, 2)}</b></div>`).join('')}
        <div class="st-money-row st-money-row--total"><span>= รับจริง (สุทธิ)</span><b>${money(m.net, 2)}</b></div></div>
      <p class="st-sub" style="margin:8px 0 0">ส่วนลดรวม ${money(totalDisc, 2)}${Number(m.gross_menu) ? ` · ${(totalDisc / Number(m.gross_menu) * 100).toFixed(1)}% ของราคาเต็ม` : ''} · ค่าอาหารราคาเต็มนับจากออร์เดอร์ที่สั่งในช่วงนี้ (รวมที่ยังไม่จ่าย)</p>`;
    // ช่วงเวลาที่ลูกค้าสั่ง
    const byH = Object.fromEntries(ins.order_hours.map(h => [h.hour, h]));
    const hs = ins.order_hours.map(h => h.hour);
    const lo = hs.length ? Math.min(...hs, 10) : 10, hi = hs.length ? Math.max(...hs, 21) : 21;
    const peak = ins.order_hours.reduce((a, b) => (!a || b.orders > a.orders ? b : a), null);
    const hrows = [];
    for (let h = lo; h <= hi; h++) hrows.push({ label: `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`, short: String(h), value: byH[h]?.orders || 0, amount: byH[h]?.amount || 0, hi: peak && peak.hour === h });
    $('#hours-peak').textContent = peak ? `ช่วงที่ลูกค้าสั่งมากที่สุด: ${String(peak.hour).padStart(2, '0')}:00–${String(peak.hour + 1).padStart(2, '0')}:00 (${num(peak.orders)} ออร์เดอร์) · ทั้งหมด ${num(ins.orders.count)} ออร์เดอร์ ${num(ins.orders.items)} จาน` : '';
    drawBars($('#hours'), hrows, { height: 190, axis: (v) => num(Math.round(v)), empty: 'ยังไม่มีออร์เดอร์ในช่วงนี้',
      tip: (r) => `<b>${esc(r.label)}</b><br>${num(r.value)} ออร์เดอร์ · ${money(r.amount)}` });
    // เมนูที่สั่งเยอะสุด (จำนวน)
    const tq = ins.top_qty, maxQ = Math.max(...tq.map(x => Number(x.qty)), 1);
    $('#top-qty').innerHTML = tq.length ? tq.map((x, i) => `
      <div class="st-hbar st-hbar--img">
        <span class="st-hbar-img">${x.image ? ST.thumbImg(x.image) : '🍽'}</span>
        <div><div class="st-hbar-label"><span>${i + 1}. ${esc(x.name)}</span><b>${num(x.qty)} จาน</b></div>
        <div class="st-hbar-track"><i style="width:${Math.max(2, Number(x.qty) / maxQ * 100)}%"></i></div>
        <small>${money(x.revenue)}</small></div>
      </div>`).join('') : none;
    // วันในสัปดาห์
    const byW = Object.fromEntries(ins.by_weekday.map(w => [w.dow, w]));
    const best = ins.by_weekday.reduce((a, b) => (!a || Number(b.total) > Number(a.total) ? b : a), null);
    drawBars($('#weekday'), [1, 2, 3, 4, 5, 6, 0].map(d => ({ label: 'วัน' + DOW[d], short: DOW_S[d], value: Number(byW[d]?.total || 0), bills: byW[d]?.bills || 0, hi: best && best.dow === d })),
      { height: 180, empty: 'ยังไม่มียอดขายในช่วงนี้', tip: (r) => `<b>${esc(r.label)}</b><br>${money(r.value, 2)} · ${r.bills} บิล` });
    // คูปอง
    $('#coupons').innerHTML = ins.coupons.length ? hbars(ins.coupons, 'uses', c => `🎟 <b>${esc(c.code)}</b>${c.title ? ' · ' + esc(c.title) : ''}`,
      c => `ส่วนลดรวม ${money(c.discount, 2)} · เฉลี่ย ${money(Number(c.discount) / Math.max(1, c.uses), 2)}/ครั้ง`, v => num(v) + ' ครั้ง')
      + `<p class="st-sub" style="margin:4px 0 0">รวม ${num(ins.coupons.reduce((a, c) => a + c.uses, 0))} ครั้ง · ส่วนลด ${money(ins.money.coupon, 2)}</p>` : '<p class="st-sub">ยังไม่มีการใช้คูปองในช่วงนี้</p>';
    // โปรตามเวลา
    $('#promos').innerHTML = ins.promos.length ? hbars(ins.promos, 'discount', p => esc(p.name), p => `${num(p.qty)} จานที่ได้ส่วนลด`) : '<p class="st-sub">ไม่มีส่วนลดจากโปรตามเวลาในช่วงนี้</p>';
    // ทานที่ร้าน / กลับบ้าน
    const net = Number(report.totals.net) || 1;
    $('#otype').innerHTML = hbars(ins.order_type, 'total', o => o.type === 'takeaway' ? '🛍 สั่งกลับบ้าน' : '🍽 ทานที่ร้าน',
      o => `${o.bills} บิล · ${Math.round(Number(o.total) / net * 100)}% · เฉลี่ย ${money(Number(o.total) / Math.max(1, o.bills))}/บิล`);
    // ครัว
    const k = ins.kitchen, cx = ins.cancelled;
    $('#kitchen').innerHTML = `
      <div class="st-kpi"><span>เวลาเฉลี่ยจนเสร็จ</span><b>${k.avg_min != null ? num(k.avg_min) + ' นาที' : '–'}</b></div>
      <div class="st-kpi"><span>ช้าสุด 10%</span><b>${k.p90_min != null ? num(k.p90_min) + ' นาที' : '–'}</b></div>
      <div class="st-kpi"><span>ออร์เดอร์ที่ยกเลิก</span><b>${num(cx.orders)}</b></div>
      <div class="st-kpi"><span>มูลค่าที่ยกเลิก</span><b>${money(cx.amount)}</b></div>`;
  }

  // ---------- เลือกการ์ดที่จะแสดง (จำในเครื่อง + บัญชี) ----------
  const CARDS = [...document.querySelectorAll('[data-card]')].map(c => [c.dataset.card, c.querySelector('h3').textContent.trim()]);
  const hiddenCards = () => new Set(getPrefs().reports_hidden || []);
  function applyCards() {
    const h = hiddenCards();
    document.querySelectorAll('[data-card]').forEach(c => { c.hidden = h.has(c.dataset.card); });
  }
  $('#btn-cards').addEventListener('click', () => {
    const box = $('#cards-pick');
    box.hidden = !box.hidden;
    $('#btn-cards').setAttribute('aria-expanded', String(!box.hidden));
    if (box.hidden) return;
    const h = hiddenCards();
    box.innerHTML = `<p class="st-sub" style="margin:0 0 8px">ติ๊กการ์ดที่อยากเห็น · บันทึกให้ทันที</p>
      <div class="st-cards-grid">${CARDS.map(([k, l]) => `<label class="st-check"><input type="checkbox" value="${k}"${h.has(k) ? '' : ' checked'}> <span>${esc(l.replace(/ ·.*$/, ''))}</span></label>`).join('')}</div>`;
  });
  let cardSave;
  $('#cards-pick').addEventListener('change', () => {
    const hidden = [...$('#cards-pick').querySelectorAll('input:not(:checked)')].map(i => i.value);
    setPrefs({ reports_hidden: hidden });
    applyCards();
    if (report) { renderChart(); renderInsights(); }
    clearTimeout(cardSave);
    cardSave = setTimeout(() => sb.rpc('st_update_profile', { p: { prefs: { reports_hidden: hidden } } }), 800);
  });
  applyCards();

  // ---------- CSV (เปิดใน Excel / Google Sheets ภาษาไทยไม่เพี้ยน) ----------
  $('#btn-csv').addEventListener('click', () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['วันที่', 'เวลา', 'เลขที่', 'โต๊ะ', 'ช่องทาง', 'ค่าอาหาร', 'ส่วนลด', 'ค่าบริการ', 'VAT', 'ยอดสุทธิ', 'สถานะ', 'ใบกำกับภาษีอย่างย่อ'];
    const lines = report.receipts.map(p => {
      const d = new Date(p.created_at);
      const ymd = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      return [ymd, d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }),
              ymd.replace(/-/g, '') + '-' + String(p.receipt_no).padStart(3, '0'), p.table_label, METHOD[p.method] || p.method,
              p.subtotal, p.discount, p.service, p.vat, p.total, p.status === 'void' ? 'ยกเลิก' : 'ชำระแล้ว', p.tax_invoice ? 'ใช่' : ''].map(q).join(',');
    });
    const blob = new Blob(['﻿' + [head.map(q).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `smarttable-sales-${report.from}_${report.to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (report) { renderChart(); renderInsights(); } }, 200); });

  // ---------- เริ่มต้น ----------
  const [f, t] = preset('today');
  setRange(f, t, 'today');
})();
