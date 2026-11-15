// ===== หน้า รับคำเชิญเข้าร้าน (invite.html?t=...) =====
(async function () {
  const { sb, configOk, $, ROLE_TH, thaiError, showMsg } = ST;
  const view = (name) => document.querySelectorAll('[data-step]').forEach(el => el.hidden = el.dataset.step !== name);
  if (!configOk) return view('bad');

  const token = new URLSearchParams(location.search).get('t') || '';
  const { data: info, error } = await sb.rpc('st_invite_info', { p_token: token });
  if (error) { view('bad'); return showMsg(thaiError(error)); }
  if (!info) { view('bad'); return showMsg(thaiError({ message: 'st_invite_not_found' })); }

  $('#inv-shop').textContent = info.shop_name;
  $('#inv-role').textContent = ROLE_TH[info.role] || info.role;
  $('#inv-email').textContent = info.email_masked;
  $('#inv-card').hidden = false;

  if (info.status !== 'valid') { view('bad'); return showMsg(thaiError({ message: 'st_invite_' + info.status })); }

  const back = 'invite.html?t=' + encodeURIComponent(token);
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    $('#go-login').href = 'index.html?next=' + encodeURIComponent(back) + '#login';
    $('#go-signup').href = 'index.html?next=' + encodeURIComponent(back) + '#signup';
    return view('guest');
  }

  $('#me-email').textContent = session.user.email;
  view('user');

  $('#btn-switch').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.reload();
  });

  $('#btn-accept').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'กำลังรับคำเชิญ…';
    const { data: shopId, error: accErr } = await sb.rpc('st_accept_invite', { p_token: token });
    if (accErr) {
      btn.disabled = false; btn.textContent = 'รับคำเชิญ';
      return showMsg(thaiError(accErr));
    }
    location.replace('shop.html?id=' + encodeURIComponent(shopId));
  });
})();
