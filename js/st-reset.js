// ===== หน้า ตั้งรหัสผ่านใหม่ (เปิดจากลิงก์ในอีเมล) =====
(async function () {
  const { sb, configOk, $, thaiError, showMsg, setBusy } = ST;
  const view = (name) => document.querySelectorAll('[data-step]').forEach(el => el.hidden = el.dataset.step !== name);
  if (!configOk) return view('expired');

  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const errCode = hash.get('error_code') || query.get('error_code');

  const { data: { session } } = await sb.auth.getSession();   // รออ่าน token จากลิงก์ก่อน
  history.replaceState(null, '', location.pathname);          // ลบ token ออกจากแถบที่อยู่

  if (errCode || !session) {
    view('expired');
    if (errCode) showMsg(thaiError({ code: errCode, message: hash.get('error_description') || query.get('error_description') || errCode }));
    return;
  }

  $('#reset-email').textContent = session.user.email;
  view('form');

  $('#form-reset').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const password = f.password.value;
    if (password.length < 8) return showMsg('รหัสผ่านต้องยาวอย่างน้อย 8 ตัว');
    if (password !== f.password2.value) return showMsg('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    setBusy(f, true, 'กำลังบันทึก…');
    const { error } = await sb.auth.updateUser({ password });
    setBusy(f, false);
    if (error) return showMsg(thaiError(error));
    view('done');
    showMsg('ตั้งรหัสผ่านใหม่เรียบร้อย กำลังพาไปหน้าหลัก…', 'ok');
    setTimeout(() => location.replace('home.html'), 1500);
  });
})();
