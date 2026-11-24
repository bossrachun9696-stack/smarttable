-- =====================================================================
-- SmartTable · st-06-realtime.sql  (รันซ้ำได้ · ต้องรัน st-01 ถึง st-05 ก่อน)
-- กระดานออร์เดอร์ / จอครัว + เปิด Supabase Realtime ให้ตารางออร์เดอร์
--
-- * Realtime ส่งการเปลี่ยนแปลงให้เฉพาะพนักงานที่อ่านแถวนั้นได้ตาม RLS (สมาชิกร้าน)
-- * ลูกค้า (ไม่ล็อกอิน) ไม่ได้ฟัง Realtime — หน้าลูกค้าเช็กสถานะเองเป็นระยะ
-- =====================================================================

-- ---------- 1) เพิ่มตารางเข้า Realtime ----------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'SmartTable: ไม่พบ publication supabase_realtime ข้ามขั้นนี้ (หน้าเว็บจะใช้การรีเฟรชเป็นระยะแทน)';
    return;
  end if;
  foreach t in array array['st_orders', 'st_service_calls', 'st_table_sessions'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- ---------- 2) RPC: กระดานออร์เดอร์ ----------
-- ออร์เดอร์ที่ยังไม่เสร็จ + ที่เสิร์ฟ/ยกเลิกใน 60 นาทีล่าสุด (สูงสุด 300 รายการ)
-- คืนเวลาเซิร์ฟเวอร์ด้วย เพื่อนับนาทีให้ตรงแม้นาฬิกาเครื่องเพี้ยน
create or replace function public.st_order_board(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop) then raise exception 'st_forbidden'; end if;
  return jsonb_build_object(
    'now', now(),
    'orders', coalesce((
      select jsonb_agg(x.j order by x.created_at)
        from (
          select o.created_at,
                 jsonb_build_object(
                   'id', o.id, 'order_no', o.order_no, 'status', o.status, 'source', o.source,
                   'guest_name', o.guest_name, 'note', o.note, 'subtotal', o.subtotal,
                   'created_at', o.created_at, 'updated_at', o.updated_at,
                   'table_id', o.table_id, 'table_label', t.label, 'zone', t.zone,
                   'items', coalesce((
                     select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty,
                                                         'options', i.options, 'note', i.note)
                                      order by i.id)
                       from public.st_order_items i where i.order_id = o.id), '[]'::jsonb)) as j
            from public.st_orders o
            join public.st_tables t on t.id = o.table_id
           where o.shop_id = p_shop
             and (o.status in ('new','accepted','cooking')
                  or (o.status in ('served','cancelled') and o.updated_at > now() - interval '60 minutes'))
           order by o.created_at desc
           limit 300
        ) x), '[]'::jsonb));
end
$$;

revoke all on function public.st_order_board(uuid) from public, anon, authenticated;
grant execute on function public.st_order_board(uuid) to authenticated;

-- ---------- 3) บันทึกว่ารันไฟล์นี้แล้ว ----------
insert into public.st_schema_log (id) values ('st-06-realtime')
on conflict (id) do update set applied_at = now();
