// ===== SmartTable: ตัวช่วยร่วมสำหรับระบบล็อกอิน =====
(function () {
  const cfg = window.ST_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);

  const configOk = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('YOUR-') &&
                   cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('YOUR-');

  let sb = null;
  if (configOk) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        storageKey: 'st-auth',      // แยกจาก DarkChat แม้อยู่โดเมน github.io เดียวกัน
        flowType: 'implicit',       // ลิงก์ในอีเมลเปิดจากแอป Mail บน iPhone ได้
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }

  // ข้อความผิดพลาดภาษาไทย
  const MAP = {
    invalid_credentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    email_not_confirmed: 'ยังไม่ได้ยืนยันอีเมล กรุณากดลิงก์ในอีเมลที่เราส่งไปก่อน (ดูในจดหมายขยะด้วย)',
    user_already_exists: 'อีเมลนี้มีบัญชีอยู่แล้ว ลองเข้าสู่ระบบ หรือกด "ลืมรหัสผ่าน"',
    email_exists: 'อีเมลนี้มีบัญชีอยู่แล้ว ลองเข้าสู่ระบบ หรือกด "ลืมรหัสผ่าน"',
    weak_password: 'รหัสผ่านง่ายเกินไป ใช้อย่างน้อย 8 ตัว ผสมตัวอักษรและตัวเลข',
    same_password: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม',
    over_email_send_rate_limit: 'ส่งอีเมลบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
    over_request_rate_limit: 'ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
    email_address_invalid: 'รูปแบบอีเมลไม่ถูกต้อง',
    signup_disabled: 'ระบบปิดรับสมัครชั่วคราว',
    otp_expired: 'ลิงก์หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่',
    session_not_found: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
    refresh_token_not_found: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
    PGRST202: 'ยังไม่ได้รันไฟล์ SQL st-01-auth.sql ใน Supabase'
  };
  function thaiError(e) {
    if (!e) return '';
    if (e.code && MAP[e.code]) return MAP[e.code];
    const m = String(e.message || e).toLowerCase();
    if (m.includes('invalid login')) return MAP.invalid_credentials;
    if (m.includes('not confirmed')) return MAP.email_not_confirmed;
    if (m.includes('already registered')) return MAP.user_already_exists;
    if (m.includes('rate limit')) return MAP.over_request_rate_limit;
    if (m.includes('failed to fetch') || m.includes('network')) return 'เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ต';
    if (m.includes('password')) return 'รหัสผ่านไม่ผ่านเงื่อนไข: ' + e.message;
    return 'เกิดข้อผิดพลาด: ' + (e.message || e);
  }

  // URL ของหน้าในโฟลเดอร์เดียวกัน (ใช้ได้ทั้งบน GitHub Pages และเครื่องตัวเอง)
  const pageUrl = (name) => new URL(name, location.href).href.split('#')[0];

  function showMsg(text, type = 'error') {
    const box = $('#st-msg'); if (!box) return alert(text);
    box.textContent = text;
    box.className = 'st-msg st-msg--' + type;
    box.hidden = false;
  }
  function hideMsg() { const b = $('#st-msg'); if (b) b.hidden = true; }

  function setBusy(form, busy, label) {
    const btn = form.querySelector('button[type=submit]');
    form.querySelectorAll('input,button').forEach(el => el.disabled = busy);
    if (!btn) return;
    if (busy) { btn.dataset.label = btn.textContent; btn.textContent = label || 'กำลังทำงาน…'; }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }

  async function ensureProfile(name) {
    const { data, error } = await sb.rpc('st_ensure_profile', { p_display_name: name || null });
    if (error) throw error;
    return data;
  }

  async function requireUser() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace('index.html'); return null; }
    return session.user;
  }

  // ปุ่มแสดง/ซ่อนรหัสผ่าน
  document.querySelectorAll('[data-eye]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'ซ่อน' : 'แสดง';
    });
  });

  if (!configOk) {
    setTimeout(() => showMsg('ยังไม่ได้ใส่ Project URL และ key ในไฟล์ js/st-config.js', 'error'), 0);
  }

  window.ST = { sb, configOk, $, thaiError, pageUrl, showMsg, hideMsg, setBusy, ensureProfile, requireUser };
})();
