// ===== หน้า ใบเสร็จดิจิทัลของลูกค้า (ereceipt.html?k=<รหัสใบเสร็จ>[&lang=en|zh]) — ไม่ต้องล็อกอิน (รอบ Q) =====
// เปิดจากปุ่ม "ใบเสร็จของคุณ" ในหน้าโต๊ะ · บันทึกเป็นรูป / PDF / แชร์ลิงก์ · ลิงก์เปิดได้ตามวันที่ร้านตั้ง (ค่าเริ่มต้น 90 วัน)
(async function () {
  const { sb, configOk, $, esc, thaiError, showMsg, applyTheme, copyText } = ST;
  if (!configOk) return;

  const q = new URLSearchParams(location.search);
  const key = (q.get('k') || '').trim().toLowerCase();
  let saved = null;
  try { saved = localStorage.getItem('st-lang'); } catch { /* โหมดส่วนตัว */ }
  const lang = ['th', 'en', 'zh'].includes(q.get('lang')) ? q.get('lang') : ['en', 'zh'].includes(saved) ? saved : 'th';
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang;
  const t = (k, vars) => {
    let s = (ST_I18N[lang] && ST_I18N[lang][k]) ?? ST_I18N.th[k] ?? k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.split('{' + a + '}').join(b);
    return s;
  };
  const gErr = (error) => (lang !== 'th' && ST_I18N_ERR[lang] && ST_I18N_ERR[lang][error?.message]) || thaiError(error);
  const LOC = { th: 'th-TH', en: 'en-GB', zh: 'zh-CN' }[lang];
  const baht = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtTax = (id) => String(id || '').replace(/^(\d)(\d{4})(\d{5})(\d{2})(\d)$/, '$1-$2-$3-$4-$5');

  // ปุ่ม/ข้อความตามภาษา
  $('#er-eco').textContent = t('er_eco');
  $('#btn-img').textContent = t('er_save_img');
  $('#btn-pdf').textContent = t('er_pdf');
  $('#btn-share').textContent = t('er_share_b');
  $('#er-img-close').textContent = t('er_close');
  $('#er-img-hint').textContent = t('er_img_hint');
  $('#back').textContent = t('er_back');
  if (history.length > 1) {                      // มาจากหน้าโต๊ะ → กดกลับได้ (ไม่ใส่ลิงก์โต๊ะในหน้านี้ เผื่อมีคนแชร์ต่อ)
    $('#back').hidden = false;
    $('#back').addEventListener('click', (e) => { e.preventDefault(); history.back(); });
  }

  if (!/^[0-9a-f]{32}$/.test(key)) return showMsg(gErr({ message: 'st_receipt_not_found' }));
  const { data: r, error } = await sb.rpc('st_ereceipt', { p_key: key });
  if (error) return showMsg(gErr(error));

  if (r.shop.theme_color) applyTheme(r.shop.theme_color);
  if (r.shop.logo_path) {
    $('#er-logo').src = sb.storage.from('st-images').getPublicUrl(r.shop.logo_path).data.publicUrl;
    $('#er-logo-wrap').hidden = false;
  }
  const at = new Date(r.created_at);
  const ymd = at.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).replace(/-/g, '');
  const no = `${ymd}-${String(r.receipt_no).padStart(3, '0')}`;
  document.title = `${t('er_receipt')} ${no} · ${r.shop.name}`;

  const tax = r.tax;
  const tenders = Array.isArray(r.tenders) && r.tenders.length ? r.tenders
    : [{ method: r.method, amount: r.total, received: r.received, change: r.change }];
  const split = r.parts > 1 || r.portion !== 'full' || r.part_no > 1;
  const M = (m) => t('er_m_' + m) || m;
  const place = r.queue_no ? `${t('er_queue')} ${r.queue_no}` : r.table_label;
  $('#rc').innerHTML = `
    ${r.void ? `<div class="void">${esc(t('er_void_stamp'))}</div>` : ''}
    <h1>${esc(r.shop.name)}</h1>
    ${tax && tax.name && tax.name !== r.shop.name ? `<div class="c">${esc(tax.name)}</div>` : ''}
    ${(tax && tax.address) || r.shop.address ? `<div class="c muted">${esc((tax && tax.address) || r.shop.address)}</div>` : ''}
    ${r.shop.phone ? `<div class="c muted">${esc(t('er_tel'))} ${esc(r.shop.phone)}</div>` : ''}
    ${tax ? `<div class="c muted">${esc(t('er_taxid'))} ${esc(fmtTax(tax.tax_id))}${tax.branch ? ` (${esc(tax.branch)})` : ''}</div>
             ${tax.pos_id ? `<div class="c muted">POS ID ${esc(tax.pos_id)}</div>` : ''}` : ''}
    ${r.shop.header ? `<div class="c">${esc(r.shop.header)}</div>` : ''}
    <div class="title">${esc(tax ? t('er_tax') : t('er_receipt'))}</div>
    <div class="row"><span>${esc(t('er_no'))}</span><span>${no}</span></div>
    <div class="row"><span>${esc(t('er_date'))}</span><span>${at.toLocaleDateString(LOC, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' })} ${at.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}</span></div>
    ${place ? `<div class="row"><span>${esc(r.queue_no ? t('er_queue') : t('er_table'))}</span><span>${esc(r.queue_no || r.table_label)}${r.guest_count ? ' · ' + esc(t('er_people', { n: r.guest_count })) : ''}</span></div>` : ''}
    ${split ? `<div class="row"><span>${esc(t('er_part_l'))}</span><span>${esc(t('er_part_n', { n: r.part_no }))}</span></div>` : ''}
    <hr>
    ${r.share ? `<div class="muted">${esc(t('er_share_l', { n: baht(r.session_subtotal) }))}</div>` : ''}
    ${r.items.map(i => `
      <div class="item">
        <div class="row"><span>${i.qty} ${esc(i.name)}${i.to_go ? ' 🛍' : ''}</span><span>${baht(i.line_total)}</span></div>
        ${i.options ? `<small>${esc(i.options)}</small>` : ''}
      </div>`).join('')}
    <hr>
    <div class="row"><span>${esc(r.share ? t('er_sub_share') : t('er_sub'))}</span><span>${baht(r.subtotal)}</span></div>
    ${Number(r.discount) ? `<div class="row"><span>${esc(t('er_disc'))}</span><span>-${baht(r.discount)}</span></div>` : ''}
    ${Number(r.service_pct) ? `<div class="row"><span>${esc(t('er_svc', { p: Number(r.service_pct) }))}</span><span>${baht(r.service)}</span></div>` : ''}
    ${Number(r.vat_pct) && !r.vat_included ? `<div class="row"><span>${esc(t('er_vat', { p: Number(r.vat_pct) }))}</span><span>${baht(r.vat)}</span></div>` : ''}
    <div class="row total"><span>${esc(t('er_total'))}</span><span>${baht(r.total)}</span></div>
    ${Number(r.vat_pct) && (r.vat_included || tax) ? `<div class="row muted"><span>${esc(tax ? t('er_vat_tax') : t('er_vat_in', { p: Number(r.vat_pct) }))}</span><span>${tax ? '' : baht(r.vat)}</span></div>` : ''}
    ${tax ? `<div class="row muted"><span>${esc(t('er_vat_amt', { p: Number(r.vat_pct) }))}</span><span>${baht(r.vat)}</span></div>
             <div class="row muted"><span>${esc(t('er_pre'))}</span><span>${baht(Number(r.total) - Number(r.vat))}</span></div>` : ''}
    <hr>
    ${tenders.map(x => `
      <div class="row"><span>${tenders.length > 1 ? '· ' : esc(t('er_paid_by')) + ' '}${esc(M(x.method))}</span><span>${tenders.length > 1 || x.method !== 'cash' ? baht(x.amount) : ''}</span></div>
      ${x.method === 'cash' && Number(x.received) > Number(x.amount) ? `
        <div class="row muted"><span>&nbsp; ${esc(t('er_recv'))}</span><span>${baht(x.received)}</span></div>
        <div class="row muted"><span>&nbsp; ${esc(t('er_change'))}</span><span>${baht(x.change)}</span></div>` : ''}`).join('')}
    ${tenders.length === 1 && tenders[0].method === 'cash' && !(Number(tenders[0].received) > Number(tenders[0].amount)) ? `<div class="row"><span>${esc(t('er_recv'))}</span><span>${baht(r.received)}</span></div>` : ''}
    ${r.self_pay ? `<div class="muted">${esc(t('er_selfpay'))}</div>` : ''}
    ${r.void ? `<div class="muted">${esc(t('er_voided'))}</div>` : ''}
    <hr>
    <div class="c">${esc(r.shop.footer || t('er_thanks'))}</div>
    ${r.shop.note ? `<div class="c muted">${esc(r.shop.note)}</div>` : ''}
    <div class="c muted">SmartTable</div>`;
  $('#rc').hidden = false;
  $('#rc-actions').hidden = false;
  const exp = new Date(r.expires_at);
  $('#er-exp').textContent = t('er_expires', { d: exp.toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }) });

  // ---------- บันทึกเป็นรูป: วาดใบเสร็จลงภาพ (ตัวเดียวกับที่ใช้พิมพ์บลูทูธ · ภาษาไทยถูก) ----------
  async function makeImage() {
    const PR = window.ST_PRINTER;
    try { await document.fonts.ready; } catch { /* ไม่เป็นไร */ }
    const inner = PR._render(PR._lines($('#rc')), { paper: '80', font: 'm' });
    const m = 28;                                   // ขอบขาวรอบใบ ให้ดูเป็นใบเสร็จในอัลบั้มรูป
    const cv = document.createElement('canvas');
    cv.width = inner.width + m * 2; cv.height = inner.height + m * 2;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(inner, m, m);
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }
  $('#btn-img').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    const blob = await makeImage().catch(() => null);
    b.disabled = false;
    if (!blob) return showMsg('บันทึกรูปไม่สำเร็จ ลองกด PDF / พิมพ์ แทน');
    const file = new File([blob], `receipt-${no}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: r.shop.name }); return; }
      catch (er) { if (er && er.name === 'AbortError') return; }
    }
    // สำรอง: แสดงรูปให้กดค้างบันทึก + ดาวน์โหลดบนคอม
    const url = URL.createObjectURL(blob);
    $('#er-img-el').src = url;
    $('#er-img').hidden = false;
    const a = document.createElement('a');
    if ('download' in a && !/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    }
  });
  $('#er-img-close').addEventListener('click', () => { $('#er-img').hidden = true; });
  $('#er-img').addEventListener('click', (e) => { if (e.target.id === 'er-img') $('#er-img').hidden = true; });

  $('#btn-pdf').addEventListener('click', () => window.print());

  // ---------- แชร์ลิงก์: ลิงก์อยู่ในข้อความเสมอ ----------
  $('#btn-share').addEventListener('click', async () => {
    const text = t('er_share_text', { s: r.shop.name, n: '฿' + baht(r.total) }) + '\n' + location.href;
    if (navigator.share) {
      try { await navigator.share({ title: r.shop.name, text }); return; }
      catch (er) { if (er && er.name === 'AbortError') return; }
    }
    if (await copyText(text)) showMsg(t('er_copied'), 'ok');
    else showMsg(location.href);
  });
})();
