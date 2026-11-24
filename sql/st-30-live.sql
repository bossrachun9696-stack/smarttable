-- =====================================================================
-- SmartTable st-30 · "ร้านของฉัน" แจ้งสด (หน้า home.html)
-- รันซ้ำได้ · อ่านอย่างเดียว
--  st_my_shops_live() -> ทุกร้านที่เราเป็นพนักงาน: โต๊ะที่เปิด / ออร์เดอร์ใหม่ / กำลังทำ / เรียกพนักงาน / คิวกลับบ้าน
--                         + เหตุการณ์ล่าสุดวันนี้ 5 รายการ (เปิดโต๊ะ · สั่งอาหาร · เรียก/เช็กบิล · คิว)
-- =====================================================================

create or replace function public.st_my_shops_live()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); d0 timestamptz := date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
begin
  if me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'shop_id', s.id,
      'is_open', s.is_open,
      'tables', (select count(*) from public.st_table_sessions x join public.st_tables t on t.id = x.table_id and t.kind = 'dine'
                  where x.shop_id = s.id and x.status <> 'closed'),
      'guests', (select coalesce(sum(x.guest_count), 0) from public.st_table_sessions x join public.st_tables t on t.id = x.table_id and t.kind = 'dine'
                  where x.shop_id = s.id and x.status <> 'closed'),
      'confirm', (select count(*) from public.st_table_sessions x where x.shop_id = s.id and x.status <> 'closed' and x.confirm_status = 'pending'),
      'new_orders', (select count(*) from public.st_orders o where o.shop_id = s.id and o.status = 'new' and not o.is_charge and o.created_at >= d0 - interval '12 hours'),
      'cooking', (select count(*) from public.st_orders o where o.shop_id = s.id and o.status in ('accepted', 'cooking') and not o.is_charge and o.created_at >= d0 - interval '12 hours'),
      'calls', (select count(*) from public.st_service_calls c where c.shop_id = s.id and c.status = 'pending'),
      'queue', (select count(*) from public.st_table_sessions x join public.st_tables t on t.id = x.table_id and t.kind = 'ticket'
                 where x.shop_id = s.id and x.status <> 'closed'),
      'sales', (select coalesce(sum(p.total), 0) from public.st_payments p where p.shop_id = s.id and p.status = 'paid' and p.created_at >= d0),
      'events', coalesce((select jsonb_agg(z.e order by (z.e->>'at') desc) from (select u.e from (
          (select jsonb_build_object('at', o.created_at, 'kind', case when t.kind = 'dine' then 'order' else 'queue' end, 'id', o.id,
                    'text', public.st_chat_where(o.table_id, o.session_id) || ' สั่ง ' ||
                            (select coalesce(sum(i.qty), 0) from public.st_order_items i where i.order_id = o.id) || ' รายการ'
                            || coalesce(' · ' || nullif(o.guest_name, ''), '')) e
             from public.st_orders o join public.st_tables t on t.id = o.table_id
            where o.shop_id = s.id and o.created_at >= d0 and not o.is_charge and o.status <> 'cancelled'
            order by o.created_at desc limit 5)
          union all
          (select jsonb_build_object('at', x.opened_at, 'kind', 'open', 'id', x.id,
                    'text', public.st_chat_where(x.table_id, x.id) || ' เปิดโต๊ะ' || coalesce(' (' || x.guest_count || ' คน)', '')
                            || case when x.confirm_status = 'pending' then ' · รอยืนยัน' else '' end) e
             from public.st_table_sessions x join public.st_tables t on t.id = x.table_id and t.kind = 'dine'
            where x.shop_id = s.id and x.opened_at >= d0
            order by x.opened_at desc limit 5)
          union all
          (select jsonb_build_object('at', c.created_at, 'kind', 'call', 'id', c.id,
                    'text', public.st_chat_where(c.table_id, c.session_id) || ' ' ||
                            case c.kind when 'call' then 'เรียกพนักงาน' when 'bill' then 'ขอเช็กบิล' when 'slip' then 'แนบสลิป'
                                        when 'open' then 'ขอเปิดโต๊ะ' when 'coupon' then 'ใส่คูปอง' else c.kind end
                            || case when c.status = 'done' then ' ✓' else '' end) e
             from public.st_service_calls c
            where c.shop_id = s.id and c.created_at >= d0
            order by c.created_at desc limit 5)
        ) u(e) order by (u.e->>'at') desc limit 5) z), '[]'::jsonb)
    ) order by s.name)
    from public.st_shops s
   where exists (select 1 from public.st_shop_members m where m.shop_id = s.id and m.user_id = me)
  ), '[]'::jsonb);
end $$;
revoke all on function public.st_my_shops_live() from public, anon;
grant execute on function public.st_my_shops_live() to authenticated;

insert into public.st_schema_log (id) values ('st-30-live') on conflict (id) do update set applied_at = now();
