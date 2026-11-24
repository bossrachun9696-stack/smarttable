// ===== หน้า เข้าสู่ระบบ / สมัคร / ลืมรหัสผ่าน =====
(async function () {
  const { sb, configOk, $, thaiError, pageUrl, nextUrl, showMsg, hideMsg, setBusy, ensureProfile } = ST;
  const VIEWS = ['login', 'signup', 'forgot'];

  function show(view) {
    if (!VIEWS.includes(view)) view = 'login';
    document.querySelectorAll('form[data-view]').forEach(f => f.hidden = f.dataset.view !== view);
    document.querySelectorAll('.st-tabs button').forEach(b =>
      b.setAttribute('aria-selected', String(b.dataset.view === view)));
    $('.st-tabs').hidden = view === 'forgot';
    hideMsg();
  }
  document.querySelectorAll('.st-tabs button').forEach(b =>
    b.addEventListener('click', () => { location.hash = b.dataset.view; }));
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1));

  if (!configOk) return;

  // ล็อกอินอยู่แล้ว (หรือเพิ่งกดลิงก์ยืนยันอีเมล) -> ไปหน้าหลัก
  const { data: { session } } = await sb.auth.getSession();
  if (session) { location.replace(nextUrl()); return; }

  // ---------- เข้าสู่ระบบ ----------
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const email = f.email.value.trim().toLowerCase();
    const password = f.password.value;
    setBusy(f, true, 'กำลังเข้าสู่ระบบ…');
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { setBusy(f, false); return showMsg(thaiError(error)); }
    try { await ensureProfile(); } catch (err) { console.warn(err); }
    location.replace(nextUrl());
  });

  // ---------- สมัครสมาชิก ----------
  $('#form-signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const name = f.display_name.value.trim();
    const email = f.email.value.trim().toLowerCase();
    const password = f.password.value;
    if (password.length < 8) return showMsg('รหัสผ่านต้องยาวอย่างน้อย 8 ตัว');
    if (password !== f.password2.value) return showMsg('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    const rec = f.rec.value.trim();
    if (rec.length < 6) return showMsg('รหัสกู้คืนต้องมีอย่างน้อย 6 ตัว (ไว้ใช้ตอนลืมรหัสผ่าน)');
    // เก็บไว้ตั้งให้หลังยืนยันอีเมล (คีย์เดียวกับ DarkChat · เปิด DarkChat ครั้งแรกจะตั้งให้)
    try { localStorage.setItem('darkchat_rec_pending', JSON.stringify({ email, code: rec })); } catch (x) {}

    setBusy(f, true, 'กำลังสมัคร…');
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { emailRedirectTo: pageUrl('home.html'), data: { display_name: name, avatar: '' } }
    });
    setBusy(f, false);
    if (error) return showMsg(thaiError(error));

    // Supabase ไม่แจ้ง error ถ้าอีเมลซ้ำ แต่ส่ง identities ว่างกลับมา
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return showMsg(thaiError({ code: 'user_already_exists' }));
    }
    if (data.session) {                         // กรณีปิดการยืนยันอีเมลไว้
      try { const { error: re } = await sb.rpc('acct_set_recovery', { p_code: rec }); if (!re) localStorage.removeItem('darkchat_rec_pending'); } catch (x) {}
      try { await ensureProfile(name); } catch (err) { console.warn(err); }
      return location.replace(nextUrl());
    }
    f.reset();
    showMsg(`ส่งลิงก์ยืนยันไปที่ ${email} แล้ว เปิดอีเมลแล้วกดลิงก์เพื่อเริ่มใช้งาน (ถ้าไม่เห็น ดูในจดหมายขยะ)`, 'ok');
  });

  // ---------- ลืมรหัสผ่าน: รหัสกู้คืนของบัญชี DarkChat (acct_recover) ----------
  $('#form-forgot').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const email = f.email.value.trim().toLowerCase(), code = f.code.value.trim(), password = f.password.value;
    if (!email || !code) return showMsg('กรอกอีเมลและรหัสกู้คืน');
    if (password.length < 8) return showMsg('รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัว');
    setBusy(f, true, 'กำลังตั้งรหัสผ่านใหม่…');
    const { data: r, error } = await sb.rpc('acct_recover', { p_email: email, p_code: code, p_new_password: password });
    if (error) { setBusy(f, false); return showMsg(thaiError(error)); }
    if (!r || !r.ok) {
      setBusy(f, false);
      return showMsg(r && r.reason === 'locked' ? `ใส่รหัสกู้คืนผิดหลายครั้ง ลองใหม่ในอีก ${r.minutes || 15} นาที`
        : `อีเมลหรือรหัสกู้คืนไม่ถูกต้อง${r && r.left !== undefined ? ` (ลองได้อีก ${r.left} ครั้ง)` : ''}`);
    }
    const { error: e2 } = await sb.auth.signInWithPassword({ email, password });
    setBusy(f, false);
    if (e2) { location.hash = 'login'; return showMsg('ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบด้วยรหัสใหม่ได้เลย', 'ok'); }
    try { await ensureProfile(); } catch (err) { console.warn(err); }
    location.replace(nextUrl());
  });
  $('#btn-mail-reset').addEventListener('click', async () => {
    const f = $('#form-forgot'), email = f.email.value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return showMsg('กรอกอีเมลก่อน แล้วกดอีกครั้ง');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: pageUrl('reset.html') });
    if (error && /rate|limit|fetch|network/i.test((error.code || '') + error.message)) return showMsg(thaiError(error));
    showMsg(`ถ้า ${email} มีบัญชีอยู่ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว ลิงก์ใช้ได้ครั้งเดียวภายใน 1 ชั่วโมง`, 'ok');
  });
})();
