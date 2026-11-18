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
    st_email_mismatch: 'คำเชิญนี้ส่งถึงบัญชีอื่น กรุณาเข้าสู่ระบบด้วยบัญชี (อีเมล/ไอดี) ที่ร้านเชิญ',
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
    st_session_invalid: 'โต๊ะนี้ปิดรอบแล้ว หรือถูกย้ายโต๊ะ กรุณาสแกน QR ที่โต๊ะที่นั่งอยู่อีกครั้ง',
    st_session_billing: 'โต๊ะนี้กำลังเช็กบิล สั่งเพิ่มไม่ได้ ถ้าต้องการสั่งเพิ่มกรุณาแจ้งพนักงาน',
    st_shop_closed: 'ร้านปิดรับออร์เดอร์อยู่ตอนนี้',
    st_bad_cart: 'รายการในตะกร้าไม่ถูกต้อง กรุณาลองใหม่',
    st_too_many_orders: 'สั่งถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
    st_item_gone: 'มีเมนูในตะกร้าที่ร้านเอาออกไปแล้ว กรุณาลบออกจากตะกร้า',
    st_item_sold_out: 'มีเมนูหมดแล้ว กรุณาลบออกจากตะกร้า',
    st_options_changed: 'ร้านเปลี่ยนตัวเลือกของเมนูนี้ กรุณาลบแล้วเลือกใหม่',
    st_options_required: 'ยังเลือกตัวเลือกไม่ครบ',
    st_order_cancelled: 'ออร์เดอร์นี้ยกเลิกไปแล้ว',
    st_discount_forbidden: 'ตำแหน่งของคุณให้ส่วนลดไม่ได้ ให้แคชเชียร์หรือผู้จัดการทำ',
    st_cash_not_enough: 'รับเงินมาน้อยกว่ายอดที่ต้องจ่าย',
    st_already_paid: 'โต๊ะนี้จ่ายเงินแล้ว',
    st_nothing_to_pay: 'ยังไม่มีรายการให้เก็บเงิน',
    st_void_reason: 'กรุณาใส่เหตุผลที่ยกเลิก (ไม่เกิน 200 ตัวอักษร)',
    st_already_void: 'ใบเสร็จนี้ถูกยกเลิกไปแล้ว',
    st_out_of_stock: 'เมนูนี้เหลือไม่พอ ลดจำนวนหรือลบออกจากตะกร้า',
    st_table_busy: 'โต๊ะปลายทางมีลูกค้าอยู่ ใช้ "รวมโต๊ะ" แทน',
    // รอบ C: แยกบิล / หลายช่องทาง / ลูกค้าจ่ายเอง
    st_bad_amount: 'ยอดเงินไม่ถูกต้อง',
    st_over_remaining: 'ยอดที่จะเก็บมากกว่ายอดที่เหลือของโต๊ะ',
    st_split_mixed: 'โต๊ะนี้แยกจ่ายตามยอดไปแล้ว เลือกจ่ายตามรายการไม่ได้ ใช้ "หารเท่ากัน" หรือ "ทั้งหมด" แทน',
    st_item_paid: 'มีรายการที่จ่ายไปแล้ว หรือเลือกจำนวนเกิน กรุณาโหลดหน้าใหม่',
    st_order_paid: 'ออร์เดอร์นี้มีการจ่ายเงินไปแล้วบางส่วน ยกเลิกไม่ได้ (ยกเลิกใบเสร็จก่อน)',
    st_partly_paid: 'โต๊ะนี้จ่ายเงินไปแล้วบางส่วน รวมโต๊ะไม่ได้ ให้เก็บเงินให้ครบก่อน',
    st_tender_mismatch: 'ยอดรวมของแต่ละช่องทางไม่เท่ากับยอดที่ต้องชำระ',
    st_request_handled: 'รายการแจ้งโอนนี้ถูกจัดการไปแล้ว',
    st_bill_changed: 'ยอดบิลเปลี่ยนไปจากที่ลูกค้าโอน ให้กด "ปฏิเสธ" แล้วเก็บเงินตามปกติ',
    st_selfpay_off: 'ร้านยังไม่เปิดให้ลูกค้าจ่ายเอง',
    st_request_pending: 'มีสลิปรอร้านตรวจอยู่แล้ว',
    st_slip_missing: 'อัปโหลดสลิปไม่สำเร็จ กรุณาลองใหม่',
    st_coupon_invalid: 'ไม่พบคูปองนี้ หรือถูกปิดแล้ว',
    st_coupon_expired: 'คูปองยังไม่ถึงวันใช้ หรือหมดอายุแล้ว',
    st_coupon_used_up: 'คูปองนี้ถูกใช้ครบจำนวนแล้ว',
    st_coupon_min: 'ยอดยังไม่ถึงขั้นต่ำของคูปอง',
    st_coupon_already: 'ใส่คูปองนี้ไว้แล้ว',
    st_coupon_limit: 'ใส่คูปองครบจำนวนที่ร้านให้ใช้ต่อโต๊ะแล้ว',
    st_coupon_no_promo: 'คูปองนี้ใช้ร่วมกับโปรลดราคาตามเวลาไม่ได้',
    st_coupon_need_staff: 'มีคูปองที่ใส่ไว้ กรุณากด "ขอเช็กบิล" ให้พนักงานคิดส่วนลดให้',
    st_wait_confirm: 'ร้านยังไม่ได้ยืนยันโต๊ะ รอสักครู่แล้วกดส่งอีกครั้ง',
    // รอบ D: สถานี / สั่งกลับบ้าน
    st_station_taken: 'มีสถานีชื่อนี้แล้ว',
    st_station_limit: 'สร้างสถานีได้สูงสุด 10 จุด',
    st_takeaway_table: 'ใช้กับบัตรคิวกลับบ้านไม่ได้ (เปิด ย้าย หรือรวมโต๊ะกับคิวไม่ได้)',
    st_takeaway_off: 'ร้านยังไม่เปิดรับสั่งกลับบ้าน',
    st_bad_contact: 'ชื่อหรือเบอร์โทรไม่ถูกต้อง',
    st_bad_pickup: 'เวลามารับต้องอยู่ระหว่าง 10 นาที ถึง 24 ชั่วโมงจากตอนนี้',
    st_preorder_off: 'ร้านยังไม่เปิดให้สั่งล่วงหน้า',
    st_queue_full: 'คิวเต็ม (ค้างเกิน 150 คิว) ปิดคิวที่รับของแล้วก่อน',
    st_not_paid: 'คิวนี้ยังจ่ายเงินไม่ครบ',
    // รอบ E: ตะกร้าร่วม
    st_cart_empty: 'ตะกร้าว่าง (อาจมีคนในโต๊ะส่งไปแล้ว)',
    st_cart_full: 'ตะกร้าของโต๊ะเต็ม (60 รายการ) ส่งรายการก่อน',
    // รอบ F: โปรไฟล์ / เชิญด้วยไอดี / ลบร้าน / ยืนยันโต๊ะ
    st_bad_public_id: 'ไอดีต้องมี 4–20 ตัว ใช้ได้เฉพาะ a–z 0–9 จุด และขีดล่าง (ขึ้นต้นด้วยตัวอักษรหรือตัวเลข)',
    st_public_id_taken: 'มีคนใช้ไอดีนี้แล้ว ลองชื่ออื่น',
    st_user_not_found: 'ไม่พบผู้ใช้ไอดีนี้ ให้พนักงานเปิดหน้า ตั้งค่า แล้วคัดลอกไอดีมาให้',
    st_confirm_name: 'ชื่อร้านที่พิมพ์ไม่ตรง พิมพ์ให้ตรงทุกตัวอักษร',
    st_not_authenticated: 'กรุณาเข้าสู่ระบบใหม่'
  };
  // ป้ายข้อมูลอาหาร (ต้องตรงกับ st_menu_items_tags_check)
  const TAGS = {
    nuts:       { th: 'มีถั่ว',      icon: '🥜', kind: 'allergen', none: 'ไม่มีถั่ว' },
    seafood:    { th: 'อาหารทะเล',   icon: '🦐', kind: 'allergen', none: 'ไม่มีอาหารทะเล' },
    dairy:      { th: 'มีนม',        icon: '🥛', kind: 'allergen', none: 'ไม่มีนม' },
    egg:        { th: 'มีไข่',        icon: '🥚', kind: 'allergen', none: 'ไม่มีไข่' },
    gluten:     { th: 'มีแป้งสาลี',   icon: '🌾', kind: 'allergen', none: 'ไม่มีแป้งสาลี' },
    vegetarian: { th: 'มังสวิรัติ',    icon: '🥬', kind: 'diet' },
    jay:        { th: 'เจ',          icon: '🟡', kind: 'diet' },
    halal:      { th: 'ฮาลาล',       icon: '🕌', kind: 'diet' }
  };
  // ใช้สีของร้านแทนสีส้มตั้งต้น (หน้าลูกค้า)
  function applyTheme(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const mix = (c, t, k) => Math.round(c + (t - c) * k);
    const toHex = (a) => '#' + a.map(v => v.toString(16).padStart(2, '0')).join('');
    const s = document.documentElement.style;
    s.setProperty('--st-accent', hex);
    s.setProperty('--st-accent-dark', toHex([mix(r, 0, .2), mix(g, 0, .2), mix(b, 0, .2)]));
    s.setProperty('--st-accent-soft', toHex([mix(r, 255, .86), mix(g, 255, .86), mix(b, 255, .86)]));
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', hex);
  }
  // ย่อรูปเป็น JPEG ก่อนอัปโหลด
  async function shrinkImage(file, max = 1200, q = 0.82) {
    let src, w, h;
    try { src = await createImageBitmap(file); w = src.width; h = src.height; }
    catch {
      src = await new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = URL.createObjectURL(file); });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise(ok => c.toBlob(ok, 'image/jpeg', q));
  }
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


  // ---------- ธีม (สว่าง / มืด / ตามเครื่อง) + รูปแบบหน้าร้าน — เก็บในเครื่อง + โปรไฟล์ ----------
  // หน้าลูกค้า ใบเสร็จ และหน้าพิมพ์ ใช้ธีมสว่างเสมอ
  const NO_THEME = /\/(table|queue-tv|receipt|print|offline)\.html$/.test(location.pathname);
  const PREF_KEY = 'st-prefs';
  function getPrefs() {
    try { return Object.assign({ theme: 'auto', layout: 'list' }, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); }
    catch { return { theme: 'auto', layout: 'list' }; }
  }
  function setPrefs(p) {
    const v = Object.assign(getPrefs(), p || {});
    try { localStorage.setItem(PREF_KEY, JSON.stringify(v)); } catch { /* ไม่เป็นไร */ }
    applyMode();
    return v;
  }
  const darkMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applyMode() {
    if (NO_THEME) return;
    const t = getPrefs().theme;
    const dark = t === 'dark' || (t === 'auto' && darkMq && darkMq.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#16130F' : '#FBF6EE';
  }
  applyMode();
  if (darkMq && darkMq.addEventListener) darkMq.addEventListener('change', applyMode);
  const avatarUrl = (path) => path ? sb.storage.from('st-images').getPublicUrl(path).data.publicUrl : null;

  // ---------- ล็อกหน้าข้างหลังตอนเปิดแผ่นเลื่อนขึ้น (iPhone ไม่สนใจ overflow:hidden) ----------
  // ทุกหน้าใช้ class st-noscroll บน body อยู่แล้ว -> จับการเปลี่ยน class แล้วตรึงตำแหน่งให้เอง
  (function () {
    let locked = false, y = 0;
    const apply = () => {
      const want = document.body.classList.contains('st-noscroll');
      if (want === locked) return;
      locked = want;
      const b = document.body.style;
      if (want) {
        y = window.scrollY;
        b.position = 'fixed'; b.top = (-y) + 'px'; b.left = '0'; b.right = '0'; b.width = '100%';
      } else {
        b.position = ''; b.top = ''; b.left = ''; b.right = ''; b.width = '';
        window.scrollTo(0, y);
      }
    };
    const start = () => new MutationObserver(apply).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  })();

  // ---------- แอปบนมือถือ (PWA): ติดตั้งได้ + เปิดได้ตอนเน็ตหลุดชั่วคราว ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => null); });
  }

  // เวลาที่เปิดดูหน้าต่าง ๆ ล่าสุด (ใช้นับป้ายแจ้งเตือนบนหน้าร้าน) · เก็บในเครื่อง
  function getSeen(shop) { try { return JSON.parse(localStorage.getItem('st-seen:' + shop) || '{}') || {}; } catch { return {}; } }
  function markSeen(shop, key) {
    try { const v = getSeen(shop); v[key] = new Date().toISOString(); localStorage.setItem('st-seen:' + shop, JSON.stringify(v)); } catch { /* ไม่เป็นไร */ }
  }
  window.ST = { sb, configOk, $, esc, ROLE_TH, thaiError, pageUrl, nextUrl, showMsg, hideMsg, setBusy,
                ensureProfile, requireUser, copyText, TAGS, applyTheme, shrinkImage,
                getPrefs, setPrefs, applyMode, avatarUrl, getSeen, markSeen };
})();
