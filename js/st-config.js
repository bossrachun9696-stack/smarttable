// ===== ตั้งค่า SmartTable =====
// ใส่ค่าจาก Supabase: Project Settings > API Keys (หรือ Data API)
// - SUPABASE_URL      = Project URL เช่น https://abcdxyz.supabase.co
// - SUPABASE_ANON_KEY = publishable key (sb_publishable_...) หรือ anon key (eyJ...)
// ห้ามใส่ service_role / secret key ในไฟล์นี้เด็ดขาด เพราะทุกคนเปิดดูได้
// ตอนย้ายไปรวมกับ DarkChat Project ให้แก้แค่ 2 บรรทัดนี้
window.ST_CONFIG = {
  SUPABASE_URL: 'https://vvcpshihzbsdyhtkqisv.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_9bHKptbaPmLUKXBW-xzdWg_Js82yZlZ',
  APP_NAME: 'SmartTable'
};
