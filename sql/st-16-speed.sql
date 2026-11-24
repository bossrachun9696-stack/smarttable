-- =====================================================================
-- SmartTable · st-16-speed.sql  (รอบ H · ความเร็ว)
-- เพิ่มดัชนี (index) ให้คิวรีที่ถูกเรียกบ่อย: จอออร์เดอร์ / แจ้งเตือนหน้าร้าน / ผังโต๊ะ / สถิติคูปอง / รายงาน
-- ไม่เปลี่ยนข้อมูล ไม่ทับฟังก์ชัน · รันซ้ำได้
-- =====================================================================

-- จอออร์เดอร์ + ป้ายแจ้งเตือน: ออร์เดอร์ที่ยังไม่เสร็จของร้าน (ส่วนใหญ่มีไม่กี่รายการ แม้ร้านจะมีออร์เดอร์สะสมเป็นหมื่น)
create index if not exists st_orders_active_idx
  on public.st_orders (shop_id) where status in ('new','accepted','cooking');
-- จอออร์เดอร์: ออร์เดอร์ที่เพิ่งเสร็จ/ยกเลิกใน 60 นาที
create index if not exists st_orders_shop_updated_idx
  on public.st_orders (shop_id, updated_at desc);
-- รายการอาหารของแต่ละเมนู (รายงาน / หารูปเมนู)
create index if not exists st_order_items_item_idx
  on public.st_order_items (item_id);
-- สถิติคูปอง (นับต่อคูปอง) + แจ้งเตือนคูปองที่ถูกใช้ใหม่
create index if not exists st_coupon_uses_coupon_idx
  on public.st_coupon_uses (coupon_id, created_at desc);
create index if not exists st_coupon_uses_shop_idx
  on public.st_coupon_uses (shop_id, created_at desc);
-- คูปองของรอบโต๊ะ (หน้าเช็กบิล / หน้าลูกค้า)
create index if not exists st_session_coupons_coupon_idx
  on public.st_session_coupons (coupon_id) where status = 'pending';
-- การเรียกพนักงานที่รอ (ผังโต๊ะ / หน้าร้าน)
create index if not exists st_service_calls_pending_idx
  on public.st_service_calls (shop_id, created_at) where status = 'pending';
-- คะแนนรีวิวตามช่วงวันที่ (รายงาน)
create index if not exists st_ratings_shop_idx
  on public.st_ratings (shop_id, created_at desc);

-- อัปเดตสถิติให้ตัววางแผนคิวรีเลือกใช้ดัชนีได้ถูก
analyze public.st_orders;
analyze public.st_order_items;
analyze public.st_service_calls;
analyze public.st_coupon_uses;
analyze public.st_session_coupons;

insert into public.st_schema_log (id) values ('st-16-speed')
on conflict (id) do update set applied_at = now();
