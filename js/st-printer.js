// ===== พิมพ์ใบสั่งครัว / ใบเสร็จ (รอบ M) =====
// 2 แบบ: (1) พิมพ์ผ่านเบราว์เซอร์ (iPhone/iPad = AirPrint หรือแอปเครื่องพิมพ์) (2) บลูทูธ ESC/POS (Chrome บน Android / คอม)
// บลูทูธส่งเป็น "รูป" ทั้งใบ → ภาษาไทยออกถูกทุกเครื่อง ไม่ต้องตั้ง code page
(function () {
  const LS = 'st-printer';
  const BT_SERVICES = [
    '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000fee7-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb'
  ];
  const FONT = '"IBM Plex Sans Thai", "Sarabun", "Noto Sans Thai", Tahoma, sans-serif';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- ค่าของเครื่องนี้ ----------
  function device() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } }
  function setDevice(v) { try { localStorage.setItem(LS, JSON.stringify(Object.assign(device(), v))); } catch { /* โหมดส่วนตัว */ } }
  const btSupported = () => !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
  const opts = (shopCfg) => Object.assign({ paper: '58', font: 'm', copies: 1, kitchen_price: false, kitchen_big: true },
                                          (shopCfg && shopCfg.print) || {});

  // ---------- บลูทูธ ----------
  let bt = null, btDev = null;
  async function findChar(server) {
    const services = await server.getPrimaryServices();
    for (const s of services) {
      let chars = [];
      try { chars = await s.getCharacteristics(); } catch { continue; }
      const c = chars.find(x => x.properties.writeWithoutResponse) || chars.find(x => x.properties.write);
      if (c) return c;
    }
    return null;
  }
  async function connect(pick) {
    if (bt && btDev && btDev.gatt.connected) return bt;
    if (!btSupported()) throw new Error('bt_unsupported');
    if (!btDev && navigator.bluetooth.getDevices && device().btId) {
      try { btDev = (await navigator.bluetooth.getDevices()).find(d => d.id === device().btId) || null; } catch { btDev = null; }
    }
    if (!btDev || pick) {
      if (!pick) throw new Error('bt_pick');
      btDev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
    }
    const server = await btDev.gatt.connect();
    bt = await findChar(server);
    if (!bt) throw new Error('bt_nochar');
    setDevice({ btId: btDev.id, btName: btDev.name || 'เครื่องพิมพ์' });
    btDev.addEventListener('gattserverdisconnected', () => { bt = null; });
    return bt;
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function sendBytes(bytes) {
    const c = await connect(false);
    const step = 180;
    for (let i = 0; i < bytes.length; i += step) {
      const part = bytes.slice(i, i + step);
      if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) await c.writeValueWithoutResponse(part);
      else await c.writeValue(part);
      await sleep(12);
    }
  }

  // ---------- HTML → บรรทัด → รูป ----------
  // โครง HTML ที่ใช้: h1 (ใหญ่ กลาง) · .c (กลาง) · .title (กลาง หนา) · .row > span + span (ซ้าย/ขวา) · .big · small · hr
  function lines(root) {
    const out = [];
    const walk = (el, inherit) => {
      for (const n of el.children) {
        if (n.classList.contains('no-print')) continue;
        const big = inherit.big || n.classList.contains('big') || n.classList.contains('total');
        if (n.tagName === 'HR') { out.push({ hr: true }); continue; }
        if (n.classList.contains('row')) {
          const sp = n.children;
          out.push({ l: (sp[0] ? sp[0].textContent : n.textContent).trim(), r: sp[1] ? sp[1].textContent.trim() : '', big, bold: big || n.classList.contains('total') });
          continue;
        }
        if (/^H[1-3]$/.test(n.tagName) || n.classList.contains('void')) { out.push({ c: n.textContent.trim(), size: 1.45, bold: true }); continue; }
        if (n.classList.contains('title')) { out.push({ c: n.textContent.trim(), bold: true }); continue; }
        if (n.classList.contains('c')) { out.push({ c: n.textContent.trim(), small: n.classList.contains('muted') }); continue; }
        if (n.tagName === 'SMALL') { out.push({ l: '   ' + n.textContent.trim(), small: true }); continue; }
        if (n.children.length) { walk(n, { big }); continue; }
        const tx = n.textContent.trim();
        if (tx) out.push({ l: tx, small: n.classList.contains('muted'), big, bold: big });
      }
    };
    walk(root, {});
    return out;
  }
  function render(list, o) {
    const W = o.paper === '80' ? 576 : 384;
    const base = ({ s: 20, m: 24, l: 28 })[o.font] * (o.paper === '80' ? 1.25 : 1);
    const cv = document.createElement('canvas');
    const cx = cv.getContext('2d');
    const pad = 4;
    const font = (sz, b) => `${b ? 700 : 400} ${Math.round(sz)}px ${FONT}`;
    const wrap = (text, maxW) => {
      const res = []; let cur = '';
      for (const ch of Array.from(text)) {
        if (cx.measureText(cur + ch).width > maxW && cur) { res.push(cur); cur = ch.trim() ? ch : ''; }
        else cur += ch;
      }
      if (cur || !res.length) res.push(cur);
      return res;
    };
    // วัดความสูงก่อน
    const ops = [];
    let y = pad;
    for (const ln of list) {
      if (ln.hr) { ops.push({ hr: y + base * 0.4 }); y += base * 0.8; continue; }
      const sz = base * (ln.size || (ln.big ? 1.25 : ln.small ? 0.8 : 1));
      cx.font = font(sz, ln.bold);
      const lh = Math.round(sz * 1.45);
      if (ln.c != null) {
        for (const t of wrap(ln.c, W - pad * 2)) { ops.push({ t, x: W / 2, y, align: 'center', f: cx.font, lh, sz }); y += lh; }
      } else {
        const rw = ln.r ? cx.measureText(ln.r).width + 12 : 0;
        const parts = wrap(ln.l || '', W - pad * 2 - rw);
        parts.forEach((t, i) => {
          ops.push({ t, x: pad, y, align: 'left', f: cx.font, lh, sz });
          if (i === 0 && ln.r) ops.push({ t: ln.r, x: W - pad, y, align: 'right', f: cx.font, lh, sz });
          y += lh;
        });
      }
    }
    cv.width = W; cv.height = Math.ceil(y + pad + 8);
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.fillStyle = '#000'; cx.textBaseline = 'top';
    for (const op of ops) {
      if (op.hr != null) { for (let x = pad; x < W - pad; x += 10) cx.fillRect(x, op.hr, 6, 2); continue; }
      cx.font = op.f; cx.textAlign = op.align;
      cx.fillText(op.t, op.x, op.y + (op.lh - op.sz) / 2);
    }
    return cv;
  }
  function raster(cv) {
    const w = cv.width, h = cv.height, bw = w >> 3;
    const px = cv.getContext('2d').getImageData(0, 0, w, h).data;
    const chunks = [new Uint8Array([0x1b, 0x40])];
    const BAND = 200;
    for (let y0 = 0; y0 < h; y0 += BAND) {
      const bh = Math.min(BAND, h - y0);
      const band = new Uint8Array(8 + bw * bh);
      band.set([0x1d, 0x76, 0x30, 0x00, bw & 255, bw >> 8, bh & 255, bh >> 8]);
      for (let y = 0; y < bh; y++) {
        for (let xb = 0; xb < bw; xb++) {
          let v = 0;
          for (let b = 0; b < 8; b++) {
            const i = ((y0 + y) * w + xb * 8 + b) * 4;
            const lum = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
            if (lum < 150) v |= 0x80 >> b;
          }
          band[8 + y * bw + xb] = v;
        }
      }
      chunks.push(band);
    }
    chunks.push(new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00]));   // เลื่อนกระดาษ + ตัด (ถ้ามีมีดตัด)
    const all = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let k = 0; for (const c of chunks) { all.set(c, k); k += c.length; }
    return all;
  }

  // ---------- พิมพ์ผ่านเบราว์เซอร์ ----------
  function css(o) {
    const w = o.paper === '80' ? 72 : 48;
    const fs = ({ s: 11, m: 13, l: 15 })[o.font] || 13;
    return `@page{size:${o.paper === '80' ? 80 : 58}mm auto;margin:3mm}
      *{box-sizing:border-box}body{margin:0;width:${w}mm;font:${fs}px/1.45 ${FONT};color:#000}
      h1{font-size:1.5em;text-align:center;margin:0 0 4px}.c,.title{text-align:center}.title{font-weight:700}
      .muted{font-size:.85em}.row{display:flex;justify-content:space-between;gap:8px}.row span:last-child{text-align:right;white-space:nowrap}
      .big,.total{font-size:1.25em;font-weight:700}small{display:block;padding-left:1.2em;font-size:.85em}
      hr{border:0;border-top:1px dashed #000;margin:5px 0}.no-print{display:none}.pb{page-break-after:always}`;
  }
  function browserPrint(html, o) {
    return new Promise((resolve) => {
      const f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      const copies = Array.from({ length: o.copies || 1 }, (_, i) => `<div${i < (o.copies || 1) - 1 ? ' class="pb"' : ''}>${html}</div>`).join('');
      f.srcdoc = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>${css(o)}</style></head><body>${copies}</body></html>`;
      f.onload = () => {
        setTimeout(() => {
          try { f.contentWindow.focus(); f.contentWindow.print(); } catch { /* ไม่เป็นไร */ }
          setTimeout(() => { f.remove(); resolve(); }, 1500);
        }, 250);
      };
      document.body.appendChild(f);
    });
  }

  // ---------- ส่งพิมพ์ ----------
  // html = โครงตามด้านบน · via = 'bt' | 'browser' (ค่าเริ่มต้นตามที่ตั้งในเครื่องนี้)
  async function print(html, shopCfg, via) {
    const o = opts(shopCfg);
    const mode = via || device().mode || 'browser';
    if (mode !== 'bt') return browserPrint(html, o);
    const box = document.createElement('div');
    box.innerHTML = html;
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch { /* ใช้ฟอนต์สำรอง */ } }
    const bytes = raster(render(lines(box), o));
    for (let i = 0; i < (o.copies || 1); i++) await sendBytes(bytes);
  }

  // ใบสั่งครัว · order = ข้อมูลจาก st_order_board
  function kitchenHtml(order, shopCfg, shopName) {
    const o = opts(shopCfg);
    const at = new Date(order.created_at || Date.now());
    const where = order.order_type === 'takeaway'
      ? `คิว ${order.queue_no || ''}${order.contact_name ? ' · ' + order.contact_name : ''}`
      : `โต๊ะ ${order.table_label || ''}`;
    const baht = (n) => Number(n || 0).toLocaleString('th-TH');
    return `
      <h1>#${esc(order.order_no)} · ${esc(where)}</h1>
      ${shopName ? `<div class="c muted">${esc(shopName)}</div>` : ''}
      ${order.to_go ? '<div class="title">*** ห่อกลับบ้าน ***</div>' : ''}
      ${order.order_type === 'takeaway' ? '<div class="title">*** สั่งกลับบ้าน ***</div>' : ''}
      <div class="row"><span>เวลา ${at.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span><span>${esc(order.guest_name || '')}</span></div>
      ${order.pickup_at ? `<div class="row"><span>นัดรับ</span><span>${new Date(order.pickup_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span></div>` : ''}
      <hr>
      ${(order.items || []).map(i => `
        <div class="item">
          <div class="row${o.kitchen_big ? ' big' : ''}"><span>${esc(i.qty)} × ${esc(i.name)}</span><span>${o.kitchen_price && i.line_total != null ? baht(i.line_total) : ''}</span></div>
          ${(i.options || []).map(x => `<small>- ${esc(x.name)}</small>`).join('')}
          ${i.note ? `<small>* ${esc(i.note)}</small>` : ''}
        </div>`).join('')}
      ${order.note ? `<hr><div>หมายเหตุ: ${esc(order.note)}</div>` : ''}
      <hr>
      <div class="c muted">${(order.items || []).reduce((s, i) => s + Number(i.qty || 0), 0)} รายการ${o.kitchen_price ? ' · ฿' + baht(order.subtotal) : ''}</div>`;
  }
  function testHtml(shopName) {
    return `<h1>ทดสอบพิมพ์</h1><div class="c">${esc(shopName || 'SmartTable')}</div><hr>
      <div class="row"><span>ข้าวกะเพราหมูกรอบ ไข่ดาว</span><span>60.00</span></div>
      <div class="row"><span>ชาไทยเย็น</span><span>25.00</span></div><hr>
      <div class="row total"><span>รวม</span><span>85.00</span></div>
      <div class="c muted">ภาษาไทยอ่านออก = พร้อมใช้งาน</div>`;
  }

  // ---------- แผ่นตั้งค่าเครื่องพิมพ์ของเครื่องนี้ (ใช้ได้ทุกหน้า) ----------
  // auto = { key, label } → ช่องติ๊ก "พิมพ์อัตโนมัติ" (เก็บต่อเครื่อง ต่อร้าน)
  function openSettings({ shopCfg, shopName, auto }) {
    let el = document.getElementById('st-pr-sheet');
    if (el) el.remove();
    const d = device();
    const o = opts(shopCfg);
    const autoOn = auto && (() => { try { return localStorage.getItem(auto.key) === '1'; } catch { return false; } })();
    el = document.createElement('div');
    el.id = 'st-pr-sheet';
    el.className = 'st-sheet';
    el.innerHTML = `
      <div class="st-sheet-panel st-split" role="dialog" aria-modal="true" aria-label="เครื่องพิมพ์">
        <div class="st-sheet-head">
          <button class="st-chip" type="button" data-pr="close">ปิด</button>
          <b>🖨 เครื่องพิมพ์ (เครื่องนี้)</b><span style="width:48px"></span>
        </div>
        <div class="st-sheet-scroll">
          <div class="st-msg" data-pr="msg" role="status" hidden></div>
          <p class="st-sub">กระดาษ ${o.paper} มม. · ตัวอักษร${({ s: 'เล็ก', m: 'กลาง', l: 'ใหญ่' })[o.font]} · ${o.copies} ใบ — เจ้าของ/ผู้จัดการเปลี่ยนได้ที่หน้าร้าน → ⚙️ ตั้งค่าเพิ่มเติม</p>
          <h4>พิมพ์ด้วยอะไร</h4>
          <label class="st-check st-check--box"><input type="radio" name="pr_mode" value="browser"${d.mode !== 'bt' ? ' checked' : ''}>
            <span><b>ผ่านหน้าต่างพิมพ์ของเครื่อง</b><small>iPhone/iPad: AirPrint หรือแอปของเครื่องพิมพ์ · คอม: เลือกเครื่องพิมพ์ที่ต่อไว้</small></span></label>
          <label class="st-check st-check--box"><input type="radio" name="pr_mode" value="bt"${d.mode === 'bt' ? ' checked' : ''}${btSupported() ? '' : ' disabled'}>
            <span><b>บลูทูธ (เครื่องพิมพ์ใบเสร็จ ESC/POS)</b><small>${btSupported()
              ? (d.btName ? 'จับคู่ไว้: ' + esc(d.btName) : 'ยังไม่ได้จับคู่ — กดปุ่มด้านล่าง')
              : 'เครื่องนี้ใช้ไม่ได้ (iPhone/iPad ไม่รองรับ) · ใช้ Chrome บน Android หรือคอมแทน'}</small></span></label>
          ${btSupported() ? '<button type="button" class="st-btn st-btn--ghost" data-pr="pair">🔗 จับคู่เครื่องพิมพ์บลูทูธ</button>' : ''}
          ${auto ? `<h4>อัตโนมัติ</h4>
          <label class="st-check st-check--box"><input type="checkbox" data-pr="auto"${autoOn ? ' checked' : ''}>
            <span><b>${esc(auto.label)}</b><small>แนะนำใช้กับบลูทูธ · ถ้าพิมพ์ผ่านหน้าต่างพิมพ์ จะเด้งหน้าต่างทุกครั้ง</small></span></label>` : ''}
          <div class="st-sheet-foot"><button type="button" class="st-btn" data-pr="test">พิมพ์ทดสอบ</button></div>
        </div>
      </div>`;
    document.body.appendChild(el);
    const msg = (t, kind) => { const m = el.querySelector('[data-pr="msg"]'); m.textContent = t; m.className = 'st-msg' + (kind ? ' st-msg--' + kind : ''); m.hidden = false; };
    const errText = (e) => ({ bt_unsupported: 'เครื่องนี้ไม่รองรับบลูทูธบนเว็บ', bt_pick: 'กด "จับคู่เครื่องพิมพ์บลูทูธ" ก่อน', bt_nochar: 'ต่อได้ แต่เครื่องนี้ไม่รับคำสั่งพิมพ์ — อาจไม่ใช่เครื่องพิมพ์ ESC/POS' })[e && e.message]
      || (e && e.name === 'NotFoundError' ? 'ยังไม่ได้เลือกเครื่อง' : 'พิมพ์ไม่สำเร็จ: ' + ((e && e.message) || e));
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pr]');
      if (!b && e.target === el) return el.remove();
      if (!b) return;
      const k = b.dataset.pr;
      if (k === 'close') return el.remove();
      if (k === 'pair') {
        try { await connect(true); setDevice({ mode: 'bt' }); el.querySelector('[name=pr_mode][value=bt]').checked = true; msg('จับคู่แล้ว: ' + device().btName, 'ok'); }
        catch (err) { msg(errText(err)); }
      }
      if (k === 'test') {
        b.disabled = true;
        try { await print(testHtml(shopName), shopCfg); msg('ส่งพิมพ์แล้ว', 'ok'); } catch (err) { msg(errText(err)); }
        b.disabled = false;
      }
    });
    el.addEventListener('change', (e) => {
      if (e.target.name === 'pr_mode') setDevice({ mode: e.target.value });
      if (e.target.dataset.pr === 'auto') { try { localStorage.setItem(auto.key, e.target.checked ? '1' : '0'); } catch { /* ไม่เป็นไร */ } }
    });
  }
  const autoOn = (key) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };

  window.ST_PRINTER = { device, setDevice, btSupported, connect, print, kitchenHtml, testHtml, opts, openSettings, autoOn,
                        _lines: lines, _render: render, _raster: raster };
})();
