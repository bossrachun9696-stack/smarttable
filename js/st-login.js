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

    setBusy(f, true, 'กำลังสมัคร…');
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { emailRedirectTo: pageUrl('home.html'), data: { display_name: name } }
    });
    setBusy(f, false);
    if (error) return showMsg(thaiError(error));

    // Supabase ไม่แจ้ง error ถ้าอีเมลซ้ำ แต่ส่ง identities ว่างกลับมา
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return showMsg(thaiError({ code: 'user_already_exists' }));
    }
    if (data.session) {                         // กรณีปิดการยืนยันอีเมลไว้
      try { await ensureProfile(name); } catch (err) { console.warn(err); }
      return location.replace(nextUrl());
    }
    f.reset();
    showMsg(`ส่งลิงก์ยืนยันไปที่ ${email} แล้ว เปิดอีเมลแล้วกดลิงก์เพื่อเริ่มใช้งาน (ถ้าไม่เห็น ดูในจดหมายขยะ)`, 'ok');
  });

  // ---------- ลืมรหัสผ่าน ----------
  $('#form-forgot').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const email = f.email.value.trim().toLowerCase();
    setBusy(f, true, 'กำลังส่งลิงก์…');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: pageUrl('reset.html') });
    setBusy(f, false);
    if (error && /rate|limit/i.test(error.code || error.message)) return showMsg(thaiError(error));
    if (error && /fetch|network/i.test(error.message)) return showMsg(thaiError(error));
    // ตอบเหมือนกันทุกกรณี เพื่อไม่ให้ใครใช้หน้านี้เดาว่าอีเมลไหนมีบัญชี
    showMsg(`ถ้า ${email} มีบัญชีอยู่ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว ลิงก์ใช้ได้ครั้งเดียวภายใน 1 ชั่วโมง`, 'ok');
  });
})();
