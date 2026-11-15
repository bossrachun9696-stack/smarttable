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
    PGRST202: 'ยังไม่ได้รันไฟล์ SQL ล่าสุดใน Supabase (ดูในโฟลเดอร์ sql)',
    PGRST205: 'ยังไม่ได้รันไฟล์ SQL ล่าสุดใน Supabase (ดูในโฟลเดอร์ sql)',
    '42501': 'คุณไม่มีสิทธิ์ทำรายการนี้',
    // ข้อความจากฟังก์ชัน st_* ในฐานข้อมูล
    st_not_authenticated: 'กรุณาเข้าสู่ระบบก่อน',
    st_bad_name: 'ชื่อร้านต้องยาว 1–80 ตัวอักษร',
    st_bad_slug: 'ชื่อลิงก์ร้านใช้ได้เฉพาะ a-z, 0-9 และ - ยาว 3–40 ตัว',
    st_slug_taken: 'ชื่อลิงก์ร้านนี้มีคนใช้แล้ว ลองชื่ออื่น',
    st_shop_limit: 'สร้างร้านได้ไม่เกิน 3 ร้านต่อบัญชี',
    st_forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้',
    st_bad_role: 'ตำแหน่งไม่ถูกต้อง',
    st_bad_email: 'รูปแบบอีเมลไม่ถูกต้อง',
    st_already_member: 'คนนี้เป็นพนักงานของร้านอยู่แล้ว',
    st_member_limit: 'ร้านมีพนักงานได้ไม่เกิน 30 คน',
    st_invite_limit: 'มีคำเชิญค้างอยู่มากเกินไป ยกเลิกคำเชิญเก่าก่อน',
    st_invite_not_found: 'ไม่พบคำเชิญนี้ ลิงก์อาจคัดลอกมาไม่ครบ',
    st_invite_revoked: 'คำเชิญนี้ถูกยกเลิกแล้ว ขอให้ร้านส่งลิงก์ใหม่',
    st_invite_used: 'คำเชิญนี้ถูกใช้ไปแล้ว',
    st_invite_expired: 'คำเชิญหมดอายุแล้ว (ใช้ได้ 7 วัน) ขอให้ร้านส่งลิงก์ใหม่',
    st_email_mismatch: 'คำเชิญนี้ส่งถึงอีเมลอื่น กรุณาเข้าสู่ระบบด้วยอีเมลที่ร้านเชิญ',
    st_owner_locked: 'เปลี่ยนตำแหน่งหรือนำเจ้าของร้านออกไม่ได้',
    st_not_member: 'ไม่พบพนักงานคนนี้ในร้าน',
    st_not_found: 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว',
    st_bad_request: 'ข้อมูลไม่ถูกต้อง',
    st_category_limit: 'สร้างหมวดหมู่ได้ไม่เกิน 50 หมวด',
    st_item_limit: 'ร้านมีเมนูได้ไม่เกิน 500 รายการ',
    st_bad_item_name: 'ชื่อเมนูต้องยาว 1–80 ตัวอักษร',
    st_bad_description: 'คำอธิบายยาวได้ไม่เกิน 300 ตัวอักษร',
    st_bad_price: 'ราคาต้องเป็นตัวเลข 0–100,000',
    st_bad_category: 'ไม่พบหมวดหมู่นี้ ลองรีเฟรชหน้า',
    st_bad_image: 'รูปไม่ถูกต้อง ลองเลือกรูปใหม่',
    st_bad_options: 'ตัวเลือกไม่ครบ: ทุกกลุ่มต้องมีชื่อและมีตัวเลือกอย่างน้อย 1 อย่าง (ไม่เกิน 10 กลุ่ม กลุ่มละ 20 ตัวเลือก)',
    st_bad_table_label: 'ชื่อโต๊ะต้องยาว 1–20 ตัวอักษร',
    st_table_label_taken: 'มีโต๊ะชื่อนี้อยู่แล้ว',
    st_table_limit: 'ร้านมีโต๊ะได้ไม่เกิน 200 โต๊ะ',
    st_bad_table_range: 'ช่วงเลขโต๊ะไม่ถูกต้อง (เพิ่มได้ครั้งละไม่เกิน 100 โต๊ะ)',
    st_table_has_history: 'โต๊ะนี้เคยเปิดใช้แล้ว ลบไม่ได้ ให้เอาเครื่องหมาย "ใช้งานอยู่" ออกแทน',
    st_table_inactive: 'โต๊ะนี้ถูกปิดใช้งานอยู่',
    st_table_already_open: 'โต๊ะนี้เปิดอยู่แล้ว',
    st_table_not_open: 'โต๊ะนี้ยังไม่ได้เปิด',
    st_table_not_found: 'ไม่พบโต๊ะนี้ QR อาจถูกเปลี่ยนแล้ว กรุณาแจ้งพนักงาน',
    st_session_invalid: 'โต๊ะนี้ปิดรอบแล้ว กรุณาสแกน QR ที่โต๊ะอีกครั้ง',
    st_session_billing: 'โต๊ะนี้กำลังเช็กบิล สั่งเพิ่มไม่ได้ ถ้าต้องการสั่งเพิ่มกรุณาแจ้งพนักงาน',
    st_shop_closed: 'ร้านปิดรับออร์เดอร์อยู่ตอนนี้',
    st_bad_cart: 'รายการในตะกร้าไม่ถูกต้อง กรุณาลองใหม่',
    st_too_many_orders: 'สั่งถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
    st_item_gone: 'มีเมนูในตะกร้าที่ร้านเอาออกไปแล้ว กรุณาลบออกจากตะกร้า',
    st_item_sold_out: 'มีเมนูหมดแล้ว กรุณาลบออกจากตะกร้า',
    st_options_changed: 'ร้านเปลี่ยนตัวเลือกของเมนูนี้ กรุณาลบแล้วเลือกใหม่',
    st_options_required: 'ยังเลือกตัวเลือกไม่ครบ',
    st_order_cancelled: 'ออร์เดอร์นี้ยกเลิกไปแล้ว'
  };
  const ROLE_TH = { owner: 'เจ้าของ', manager: 'ผู้จัดการ', cashier: 'แคชเชียร์', kitchen: 'ครัว', waiter: 'พนักงานเสิร์ฟ' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function thaiError(e) {
    if (!e) return '';
    if (e.message && MAP[e.message]) return MAP[e.message] + (e.details ? ` (${e.details})` : '');
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

  // หน้าที่จะไปต่อหลังล็อกอิน (?next=shop.html?id=...) รับเฉพาะไฟล์ในเว็บนี้
  function nextUrl(fallback = 'home.html') {
    const n = new URLSearchParams(location.search).get('next');
    return n && /^[a-z0-9_-]+\.html(\?[^#]*)?$/i.test(n) ? n : fallback;
  }

  async function requireUser() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      const here = (location.pathname.split('/').pop() || 'home.html') + location.search;
      location.replace('index.html?next=' + encodeURIComponent(here));
      return null;
    }
    return session.user;
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { return false; }
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

  window.ST = { sb, configOk, $, esc, ROLE_TH, thaiError, pageUrl, nextUrl, showMsg, hideMsg, setBusy,
                ensureProfile, requireUser, copyText };
})();
