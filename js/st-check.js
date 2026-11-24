// ===== หน้า เช็กระบบ (check.html) · รอบ M =====
(async function () {
  const { sb, configOk, $, esc, thaiError, requireUser } = ST;
  if (!configOk) return;
  if (!(await requireUser())) return;

  const FILES = ['st-01-auth', 'st-02-shops', 'st-03-menu', 'st-04-tables', 'st-05-orders', 'st-06-realtime',
    'st-07-payments', 'st-08-reports', 'st-09-ops', 'st-10-guest', 'st-11-pay', 'st-12-kitchen', 'st-13-cart',
    'st-14-staff', 'st-15-alerts', 'st-16-speed', 'st-17-buffet', 'st-18-refill', 'st-19-togo', 'st-20-tools', 'st-21-grocery', 'st-22-manage', 'st-23-togo-bill', 'st-24-togo-service', 'st-25-ereceipt', 'st-26-ext', 'st-27-chat', 'st-28-quick', 'st-29-queue-clear', 'st-30-live', 'st-31-push'];
  const RT = ['st_orders', 'st_service_calls', 'st_table_sessions', 'st_payments', 'st_pay_requests'];
  const ok = (b) => b ? '✅' : '❌';

  function row(state, title, detail, fix) {
    return `<div class="st-check-row st-check-row--${state}">
      <span class="st-check-ic">${state === 'ok' ? '✅' : state === 'warn' ? '⚠️' : '❌'}</span>
      <div><b>${esc(title)}</b>${detail ? `<small>${detail}</small>` : ''}${fix ? `<p class="st-check-fix">👉 ${fix}</p>` : ''}</div>
    </div>`;
  }

  async function run() {
    $('#checks').innerHTML = '<p class="st-sub">กำลังตรวจ…</p>';
    $('#score').hidden = true;
    const out = [];
    let bad = 0, warn = 0;
    const add = (state, ...a) => { if (state === 'bad') bad++; if (state === 'warn') warn++; out.push(row(state, ...a)); };

    // 1) เวลาเชื่อมต่อ
    const t0 = performance.now();
    const { data: h, error } = await sb.rpc('st_health');
    const ms = Math.round(performance.now() - t0);

    if (error) {
      const missing = /st_health|function|schema cache|PGRST202/i.test(error.message || '') || error.code === 'PGRST202';
      add('bad', 'ไฟล์ SQL', missing ? 'ยังไม่ได้รันไฟล์ st-20-tools.sql (หน้านี้ต้องใช้ไฟล์นั้น)' : esc(thaiError(error)),
        missing ? 'เปิด Supabase → SQL Editor → วางไฟล์ <code>sql/st-20-tools.sql</code> → Run แล้วกลับมาเช็กใหม่' : '');
    } else {
      const have = new Map(h.files.map(f => [f.id, new Date(f.at).getTime()]));
      const miss = FILES.filter(f => !have.has(f));
      add(miss.length ? 'bad' : 'ok', `ไฟล์ SQL ${FILES.length - miss.length}/${FILES.length}`,
        miss.length ? 'ยังไม่ได้รัน: ' + miss.map(f => `<code>${f}.sql</code>`).join(' ') : 'รันครบทุกไฟล์',
        miss.length ? 'รันไฟล์ที่ขาด <b>เรียงตามเลข</b> ใน Supabase → SQL Editor' : '');
      // รันไฟล์เก่าซ้ำทีหลังไฟล์ใหม่ = ฟังก์ชันที่ไฟล์ใหม่ทับไว้ถูกเขียนกลับเป็นแบบเก่า
      const order = FILES.filter(f => have.has(f));
      let late = null;
      for (let i = 0; i < order.length - 1 && !late; i++) {
        for (let j = i + 1; j < order.length; j++) {
          if (have.get(order[i]) > have.get(order[j]) + 1000) { late = [order[i], order[j]]; break; }
        }
      }
      add(late ? 'warn' : 'ok', 'ลำดับการรัน', late
        ? `รัน <code>${late[0]}</code> ทีหลัง <code>${late[1]}</code> — บางฟังก์ชันอาจกลับเป็นแบบเก่า` : 'ถูกต้อง',
        late ? `รันไฟล์ตั้งแต่ <code>${late[1]}</code> ถึงไฟล์ล่าสุดซ้ำอีกรอบ ตามลำดับ` : '');
      const b = new Map(h.buckets.map(x => [x.id, x]));
      add(b.has('st-images') && b.has('st-slips') ? (b.get('st-images').public && !b.get('st-slips').public ? 'ok' : 'warn') : 'bad',
        'ที่เก็บรูป (Storage)',
        `st-images ${ok(b.has('st-images'))}${b.has('st-images') ? (b.get('st-images').public ? ' สาธารณะ' : ' ⚠️ ควรเป็นสาธารณะ') : ''} · st-slips ${ok(b.has('st-slips'))}${b.has('st-slips') ? (b.get('st-slips').public ? ' ⚠️ ควรเป็นส่วนตัว' : ' ส่วนตัว') : ''}`,
        b.has('st-images') && b.has('st-slips') ? '' : 'รัน <code>st-03-menu.sql</code> และ <code>st-07-payments.sql</code> ใหม่');
      const rtMiss = RT.filter(t => !h.realtime.includes(t));
      add(rtMiss.length ? 'warn' : 'ok', 'แจ้งเตือนสด (Realtime)', rtMiss.length ? 'ยังไม่เปิด: ' + rtMiss.join(', ') + ' — หน้าจอจะรีเฟรชเองทุก 20–30 วินาทีแทน' : 'เปิดครบ',
        rtMiss.length ? 'รัน <code>st-06-realtime.sql</code>, <code>st-07-payments.sql</code>, <code>st-11-pay.sql</code> ใหม่' : '');
      add(h.cron === null ? 'warn' : h.cron.includes('st_close_stale_sessions') ? 'ok' : 'warn', 'ปิดโต๊ะที่ลืมอัตโนมัติ (pg_cron)',
        h.cron === null ? 'โปรเจกต์นี้ไม่ได้เปิด pg_cron' : h.cron.includes('st_close_stale_sessions') ? 'ทำงานอยู่' : 'ยังไม่ได้ตั้ง',
        h.cron === null || !h.cron.includes('st_close_stale_sessions') ? 'Supabase → Database → Extensions → เปิด pg_cron แล้วรัน <code>st-04-tables.sql</code> ใหม่' : '');
      add(h.rls_off.length ? 'bad' : 'ok', 'ความปลอดภัย (RLS)', h.rls_off.length ? 'ตารางที่ยังไม่เปิด RLS: ' + h.rls_off.join(', ') : 'เปิดครบทุกตาราง',
        h.rls_off.length ? 'รันไฟล์ SQL ที่สร้างตารางนั้นใหม่' : '');
      add(parseInt(h.pg, 10) >= 15 ? 'ok' : 'warn', 'ฐานข้อมูล', 'Postgres ' + esc(h.pg), parseInt(h.pg, 10) >= 15 ? '' : 'ควรเป็น 15 ขึ้นไป');
      const drift = Math.abs(new Date(h.now).getTime() - Date.now() - ms / 2);
      add(drift > 120000 ? 'warn' : 'ok', 'นาฬิกาเครื่องนี้', drift > 120000 ? `คลาดจากเซิร์ฟเวอร์ ${Math.round(drift / 60000)} นาที — เวลาบนจออาจเพี้ยน` : 'ตรงกับเซิร์ฟเวอร์',
        drift > 120000 ? 'ตั้งค่าเครื่อง → วันที่และเวลา → ตั้งอัตโนมัติ' : '');
    }
    add(ms > 1500 ? 'warn' : 'ok', 'ความเร็วเชื่อมต่อ', `${ms} มิลลิวินาที${ms > 1500 ? ' (ช้า)' : ms > 600 ? ' (พอใช้)' : ' (เร็ว)'}`,
      ms > 1500 ? 'เช็กอินเทอร์เน็ต · ถ้าช้าตลอด ดู region ของ Supabase ควรเป็น Singapore' : '');

    // 2) เครื่องนี้
    const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
    let ver = '';
    try { ver = (await caches.keys()).filter(k => k.startsWith('st-v')).join(', '); } catch { /* ไม่มี cache */ }
    add('ok', 'เครื่องนี้', `${sw ? 'แอปออฟไลน์ทำงาน' : 'ยังไม่ได้ติดตั้งเป็นแอป / ยังไม่มี cache'}${ver ? ' · ' + esc(ver) : ''} · ${navigator.onLine ? 'ออนไลน์' : 'ออฟไลน์'}`);

    $('#checks').innerHTML = out.join('');
    const sc = $('#score');
    sc.hidden = false;
    sc.className = 'st-check-score ' + (bad ? 'bad' : warn ? 'warn' : 'ok');
    sc.textContent = bad ? `พบปัญหา ${bad} ข้อ ต้องแก้` : warn ? `ใช้งานได้ · มีข้อควรดู ${warn} ข้อ` : 'ระบบพร้อมใช้งานครบ ✓';
  }
  $('#btn-again').addEventListener('click', run);
  run();
})();
