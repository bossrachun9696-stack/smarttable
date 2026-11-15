// ===== หน้าหลักหลังล็อกอิน (ตัวทดสอบว่าระบบล็อกอิน + RLS ทำงาน) =====
(async function () {
  const { sb, configOk, $, thaiError, showMsg, setBusy, ensureProfile, requireUser } = ST;
  if (!configOk) return;

  const user = await requireUser();
  if (!user) return;
  history.replaceState(null, '', location.pathname);   // ลบ token จากลิงก์ยืนยันอีเมล

  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.replace('index.html'); });
  $('#btn-logout').addEventListener('click', () => sb.auth.signOut());

  let profile;
  try {
    profile = await ensureProfile();
  } catch (err) {
    $('#hello').textContent = 'สวัสดี';
    $('#email').textContent = user.email;
    return showMsg(thaiError(err));
  }

  const render = () => {
    $('#hello').textContent = 'สวัสดี ' + (profile.display_name || 'คุณ');
    $('#email').textContent = profile.email;
    $('#form-name').display_name.value = profile.display_name || '';
    $('#avatar').textContent = (profile.display_name || profile.email).trim().charAt(0).toUpperCase();
  };
  render();
  $('#home-body').hidden = false;

  $('#form-name').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const name = f.display_name.value.trim().slice(0, 60);
    setBusy(f, true, 'กำลังบันทึก…');
    const { data, error } = await sb.from('st_profiles')
      .update({ display_name: name || null })
      .eq('user_id', user.id)
      .select()
      .single();
    setBusy(f, false);
    if (error) return showMsg(thaiError(error));
    profile = data; render();
    showMsg('บันทึกชื่อแล้ว', 'ok');
  });
})();
