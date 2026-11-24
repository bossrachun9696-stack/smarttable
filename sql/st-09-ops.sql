-- =====================================================================
-- SmartTable · st-09-ops.sql  (รอบ A · รันซ้ำได้ · ต้องรัน st-01 ถึง st-08 ก่อน)
--   1) ย้ายโต๊ะ / รวมโต๊ะ
--   2) ประวัติว่าใครทำอะไร (ยกเลิกออร์เดอร์ ส่วนลด ปิดโต๊ะไม่เก็บเงิน ยกเลิกใบเสร็จ เปลี่ยนราคา ฯลฯ)
--   3) ป้ายข้อมูลอาหาร (แพ้อาหาร / มังสวิรัติ / เจ / ฮาลาล)
--   4) นับจำนวนเมนูที่เหลือ (ขายครบแล้วขึ้น "หมด" เอง · ยกเลิกออร์เดอร์แล้วคืนจำนวน)
--   5) โลโก้ รูปปก สีของร้าน
--
-- หมายเหตุ: ไฟล์นี้เขียนทับ st_menu_json, st_menu_admin, st_scan ให้ส่งข้อมูลใหม่
--   ถ้ารันไฟล์ st-03 / st-04 ซ้ำ ต้องรันไฟล์นี้ (และไฟล์ที่ใหม่กว่า) ซ้ำตามลำดับด้วย
-- =====================================================================

-- ---------- 1) คอลัมน์ใหม่ ----------
alter table public.st_menu_items add column if not exists tags text[] not null default '{}';
alter table public.st_menu_items add column if not exists stock_left int;     -- null = ไม่จำกัด
alter table public.st_shops      add column if not exists theme_color text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'st_menu_items_tags_check') then
    alter table public.st_menu_items add constraint st_menu_items_tags_check
      check (tags <@ array['nuts','seafood','dairy','egg','gluten','vegetarian','jay','halal']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'st_menu_items_stock_check') then
    alter table public.st_menu_items add constraint st_menu_items_stock_check
      check (stock_left is null or stock_left between 0 and 100000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'st_shops_theme_color_check') then
    alter table public.st_shops add constraint st_shops_theme_color_check
      check (theme_color is null or theme_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
end
$$;

grant update (theme_color) on public.st_shops to authenticated;

-- ---------- 2) เมนูแบบรวมทุกคอลัมน์ (เพิ่มคอลัมน์ในอนาคตจะส่งออกไปเอง) ----------
create or replace function public.st_menu_json(p_shop uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(to_jsonb(c) - 'shop_id' - 'created_at' order by c.sort, c.created_at)
        from public.st_categories c where c.shop_id = p_shop), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(
               (to_jsonb(i) - 'shop_id' - 'created_at' - 'updated_at')
               || jsonb_build_object('options', coalesce((
                    select jsonb_agg(jsonb_build_object(
                             'id', g.id, 'name', g.name, 'min_select', g.min_select, 'max_select', g.max_select,
                             'choices', coalesce((
                               select jsonb_agg((to_jsonb(ch) - 'shop_id' - 'group_id' - 'sort') order by ch.sort)
                                 from public.st_option_choices ch where ch.group_id = g.id), '[]'::jsonb))
                           order by g.sort)
                      from public.st_option_groups g where g.item_id = i.id), '[]'::jsonb))
               order by i.sort, i.created_at)
        from public.st_menu_items i where i.shop_id = p_shop), '[]'::jsonb));
$$;

create or replace function public.st_menu_admin(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop) then raise exception 'st_forbidden'; end if;
  return public.st_menu_json(p_shop);
end
$$;

-- ป้ายอาหาร + จำนวนคงเหลือ (เรียกหลัง st_save_item) · เจ้าของ / ผู้จัดการ
create or replace function public.st_set_item_extras(p_item uuid, p_tags text[], p_stock int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_menu_items where id = p_item;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_stock is not null and p_stock not between 0 and 100000 then raise exception 'st_bad_request'; end if;
  begin
    update public.st_menu_items
       set tags = coalesce((select array_agg(distinct t) from unnest(p_tags) t), '{}'),
           stock_left = p_stock,
           is_available = case when p_stock is null then is_available else p_stock > 0 end
     where id = p_item;
  exception when check_violation then
    raise exception 'st_bad_request';
  end;
end
$$;

-- ตั้งจำนวนคงเหลือเร็ว ๆ (พนักงานทุกตำแหน่ง เช่น ครัวตั้งยอดเช้า) · null = ไม่จำกัด
create or replace function public.st_set_item_stock(p_item uuid, p_stock int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_menu_items where id = p_item;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop) then raise exception 'st_forbidden'; end if;
  if p_stock is not null and p_stock not between 0 and 100000 then raise exception 'st_bad_request'; end if;
  update public.st_menu_items
     set stock_left = p_stock,
         is_available = case when p_stock is null then true else p_stock > 0 end
   where id = p_item;
end
$$;

-- ---------- 3) ตัดจำนวนเมื่อสั่ง / คืนจำนวนเมื่อยกเลิก ----------
create or replace function public.st_stock_take()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_left int; v_name text;
begin
  if new.item_id is null then return new; end if;
  update public.st_menu_items
     set stock_left = stock_left - new.qty,
         is_available = (stock_left - new.qty) > 0 and is_available
   where id = new.item_id and stock_left is not null and stock_left >= new.qty;
  if not found then
    select stock_left, name into v_left, v_name from public.st_menu_items where id = new.item_id;
    if v_left is not null then                       -- นับจำนวนอยู่ และไม่พอ
      raise exception 'st_out_of_stock' using detail = v_name || ' เหลือ ' || v_left;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists st_order_items_stock on public.st_order_items;
create trigger st_order_items_stock
  before insert on public.st_order_items
  for each row execute function public.st_stock_take();

create or replace function public.st_stock_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.st_menu_items m
     set stock_left = m.stock_left + x.q,
         is_available = case when m.stock_left = 0 then true else m.is_available end
    from (select item_id, sum(qty)::int q from public.st_order_items
           where order_id = new.id and item_id is not null group by item_id) x
   where m.id = x.item_id and m.stock_left is not null;
  return new;
end
$$;

drop trigger if exists st_orders_stock_return on public.st_orders;
create trigger st_orders_stock_return
  after update of status on public.st_orders
  for each row when (new.status = 'cancelled' and old.status <> 'cancelled')
  execute function public.st_stock_return();

-- ---------- 4) หน้าสแกนของลูกค้า: ส่งโลโก้ รูปปก สีร้าน ----------
create or replace function public.st_scan(p_qr text, p_auto_open boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tab   public.st_tables;
  v_shop  public.st_shops;
  v_sess  public.st_table_sessions;
  v_state text;
begin
  select * into v_tab from public.st_tables where qr_token = p_qr;
  if not found or not v_tab.is_active then raise exception 'st_table_not_found'; end if;
  select * into v_shop from public.st_shops where id = v_tab.shop_id;
  if v_shop.status <> 'active' then raise exception 'st_table_not_found'; end if;

  select * into v_sess from public.st_table_sessions where table_id = v_tab.id and status <> 'closed';

  if not v_shop.is_open then
    v_state := 'shop_closed';
  elsif v_sess.id is null then
    if v_shop.order_mode = 'instant' and not coalesce(p_auto_open, true) then
      v_state := 'ended';
    elsif v_shop.order_mode = 'instant' then
      begin
        insert into public.st_table_sessions (shop_id, table_id, opened_via)
        values (v_shop.id, v_tab.id, 'auto')
        returning * into v_sess;
      exception when unique_violation then
        select * into v_sess from public.st_table_sessions where table_id = v_tab.id and status <> 'closed';
      end;
      v_state := 'open';
    else
      v_state := 'waiting';
    end if;
  else
    v_state := v_sess.status;
  end if;

  return jsonb_build_object(
    'shop', jsonb_build_object('id', v_shop.id, 'name', v_shop.name, 'logo_path', v_shop.logo_path,
                               'cover_path', v_shop.cover_path, 'theme_color', v_shop.theme_color,
                               'order_mode', v_shop.order_mode, 'phone', v_shop.phone,
                               'service_pct', v_shop.service_pct, 'vat_pct', v_shop.vat_pct,
                               'vat_included', v_shop.vat_included),
    'table', jsonb_build_object('label', v_tab.label, 'zone', v_tab.zone),
    'state', v_state,
    'session_token', case when v_state in ('open','billing') then v_sess.session_token end
  );
end
$$;

-- ---------- 5) ประวัติการทำงาน ----------
create table if not exists public.st_audit_log (
  id         bigint generated always as identity primary key,
  shop_id    uuid not null references public.st_shops(id) on delete cascade,
  at         timestamptz not null default now(),
  user_id    uuid references auth.users(id) on delete set null,   -- null = ระบบ / ลูกค้า
  action     text not null,
  table_label text,
  amount     numeric(12,2),
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists st_audit_log_shop_idx on public.st_audit_log (shop_id, at desc);

alter table public.st_audit_log enable row level security;
drop policy if exists st_audit_log_select_manager on public.st_audit_log;
create policy st_audit_log_select_manager on public.st_audit_log
  for select to authenticated using (public.st_has_shop_role(shop_id, array['owner','manager']));
revoke all on public.st_audit_log from anon, authenticated;
grant select on public.st_audit_log to authenticated;

-- ภายใน: เขียนประวัติ
create or replace function public.st_audit(p_shop uuid, p_action text, p_table text, p_amount numeric, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.st_audit_log (shop_id, user_id, action, table_label, amount, detail)
  values (p_shop, auth.uid(), p_action, p_table, p_amount, coalesce(p_detail, '{}'::jsonb));
$$;

-- ยกเลิกออร์เดอร์
create or replace function public.st_audit_orders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.st_audit(new.shop_id, 'order_cancel',
    (select label from public.st_tables where id = new.table_id), new.subtotal,
    jsonb_build_object('order_no', new.order_no, 'from_status', old.status, 'source', new.source));
  return new;
end
$$;
drop trigger if exists st_orders_audit on public.st_orders;
create trigger st_orders_audit
  after update of status on public.st_orders
  for each row when (new.status = 'cancelled' and old.status <> 'cancelled')
  execute function public.st_audit_orders();

-- ส่วนลด / ยกเลิกใบเสร็จ
create or replace function public.st_audit_payments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_label text := (select label from public.st_tables where id = new.table_id);
begin
  if tg_op = 'INSERT' and new.discount > 0 then
    perform public.st_audit(new.shop_id, 'discount', v_label, new.discount,
      jsonb_build_object('receipt_no', new.receipt_no, 'subtotal', new.subtotal, 'total', new.total));
  elsif tg_op = 'UPDATE' and new.status = 'void' and old.status <> 'void' then
    perform public.st_audit(new.shop_id, 'payment_void', v_label, new.total,
      jsonb_build_object('receipt_no', new.receipt_no, 'reason', new.void_reason, 'method', new.method));
  end if;
  return new;
end
$$;
drop trigger if exists st_payments_audit on public.st_payments;
create trigger st_payments_audit
  after insert or update of status on public.st_payments
  for each row execute function public.st_audit_payments();

-- ปิดโต๊ะโดยไม่เก็บเงิน (ตรวจตอนปิด: มีออร์เดอร์แต่ไม่มีใบเสร็จ)
create or replace function public.st_audit_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_amt numeric;
begin
  if exists (select 1 from public.st_payments where session_id = new.id and status = 'paid') then return new; end if;
  select coalesce(sum(subtotal), 0) into v_amt
    from public.st_orders where session_id = new.id and status <> 'cancelled';
  if v_amt > 0 then
    perform public.st_audit(new.shop_id, case when auth.uid() is null then 'auto_close_unpaid' else 'close_unpaid' end,
      (select label from public.st_tables where id = new.table_id), v_amt,
      jsonb_build_object('opened_at', new.opened_at, 'guests', new.guest_count));
  end if;
  return new;
end
$$;
drop trigger if exists st_sessions_audit on public.st_table_sessions;
create trigger st_sessions_audit
  after update of status on public.st_table_sessions
  for each row when (new.status = 'closed' and old.status <> 'closed')
  execute function public.st_audit_sessions();

-- เปลี่ยนราคาเมนู
create or replace function public.st_audit_menu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.st_audit(new.shop_id, 'price_change', null, new.price,
    jsonb_build_object('name', new.name, 'old_price', old.price, 'new_price', new.price));
  return new;
end
$$;
drop trigger if exists st_menu_items_audit on public.st_menu_items;
create trigger st_menu_items_audit
  after update of price on public.st_menu_items
  for each row when (new.price is distinct from old.price)
  execute function public.st_audit_menu();

-- เปลี่ยนพร้อมเพย์ / ค่าบริการ / VAT (กันคนแอบเปลี่ยนเลขพร้อมเพย์เป็นของตัวเอง)
create or replace function public.st_audit_shop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.promptpay_id is distinct from old.promptpay_id then
    perform public.st_audit(new.id, 'promptpay_change', null, null,
      jsonb_build_object('old', old.promptpay_id, 'new', new.promptpay_id));
  end if;
  if new.service_pct is distinct from old.service_pct or new.vat_pct is distinct from old.vat_pct
     or new.vat_included is distinct from old.vat_included then
    perform public.st_audit(new.id, 'tax_change', null, null,
      jsonb_build_object('service_pct', jsonb_build_array(old.service_pct, new.service_pct),
                         'vat_pct', jsonb_build_array(old.vat_pct, new.vat_pct),
                         'vat_included', jsonb_build_array(old.vat_included, new.vat_included)));
  end if;
  return new;
end
$$;
drop trigger if exists st_shops_audit on public.st_shops;
create trigger st_shops_audit
  after update on public.st_shops
  for each row execute function public.st_audit_shop();

-- เพิ่ม / เปลี่ยนตำแหน่ง / นำออก พนักงาน
create or replace function public.st_audit_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_who text;
begin
  select coalesce(p.display_name, split_part(p.email, '@', 1)) into v_who
    from public.st_profiles p where p.user_id = coalesce(new.user_id, old.user_id);
  if tg_op = 'INSERT' then
    perform public.st_audit(new.shop_id, 'member_add', null, null, jsonb_build_object('member', v_who, 'role', new.role));
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    perform public.st_audit(new.shop_id, 'member_role', null, null,
      jsonb_build_object('member', v_who, 'old_role', old.role, 'new_role', new.role));
  elsif tg_op = 'DELETE' then
    perform public.st_audit(old.shop_id, 'member_remove', null, null, jsonb_build_object('member', v_who, 'role', old.role));
  end if;
  return coalesce(new, old);
end
$$;
drop trigger if exists st_members_audit on public.st_shop_members;
create trigger st_members_audit
  after insert or update or delete on public.st_shop_members
  for each row execute function public.st_audit_members();

-- รายงานประวัติ (เจ้าของ / ผู้จัดการ)
create or replace function public.st_audit_report(p_shop uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'st_bad_date_range'; end if;
  v_start := p_from::timestamp at time zone 'Asia/Bangkok';
  v_end   := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';
  return (
    with ev as (
      select a.*, coalesce(p.display_name, split_part(p.email, '@', 1)) as who
        from public.st_audit_log a
        left join public.st_profiles p on p.user_id = a.user_id
       where a.shop_id = p_shop and a.at >= v_start and a.at < v_end
    )
    select jsonb_build_object(
      'events', coalesce((select jsonb_agg(jsonb_build_object(
                             'at', at, 'who', coalesce(who, 'ระบบ / ลูกค้า'), 'action', action,
                             'table_label', table_label, 'amount', amount, 'detail', detail) order by at desc)
                            from (select * from ev order by at desc limit 1000) x), '[]'::jsonb),
      'by_staff', coalesce((select jsonb_agg(s order by s ->> 'who') from (
                     select jsonb_build_object(
                       'who', coalesce(who, 'ระบบ / ลูกค้า'),
                       'cancels', count(*) filter (where action = 'order_cancel'),
                       'cancel_amount', coalesce(sum(amount) filter (where action = 'order_cancel'), 0),
                       'discounts', count(*) filter (where action = 'discount'),
                       'discount_amount', coalesce(sum(amount) filter (where action = 'discount'), 0),
                       'unpaid', count(*) filter (where action in ('close_unpaid','auto_close_unpaid')),
                       'unpaid_amount', coalesce(sum(amount) filter (where action in ('close_unpaid','auto_close_unpaid')), 0),
                       'voids', count(*) filter (where action = 'payment_void'),
                       'void_amount', coalesce(sum(amount) filter (where action = 'payment_void'), 0)) as s
                       from ev
                      where action in ('order_cancel','discount','close_unpaid','auto_close_unpaid','payment_void')
                      group by coalesce(who, 'ระบบ / ลูกค้า')) y), '[]'::jsonb)
    ));
end
$$;

-- ---------- 6) ย้ายโต๊ะ / รวมโต๊ะ ----------
-- ย้าย: รอบของโต๊ะต้นทาง (พร้อมออร์เดอร์ทั้งหมด) ไปอยู่โต๊ะปลายทางที่ว่าง
create or replace function public.st_move_table(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.st_tables;
  b public.st_tables;
  v_sess uuid;
begin
  select * into a from public.st_tables where id = p_from;
  select * into b from public.st_tables where id = p_to;
  if a.id is null or b.id is null or a.shop_id <> b.shop_id or a.id = b.id then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(a.shop_id, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  if not b.is_active then raise exception 'st_table_inactive'; end if;
  select id into v_sess from public.st_table_sessions where table_id = a.id and status <> 'closed' for update;
  if v_sess is null then raise exception 'st_table_not_open'; end if;
  if exists (select 1 from public.st_table_sessions where table_id = b.id and status <> 'closed') then
    raise exception 'st_table_busy';
  end if;

  update public.st_table_sessions set table_id = b.id, last_activity_at = now() where id = v_sess;
  update public.st_orders        set table_id = b.id where session_id = v_sess;
  update public.st_service_calls set table_id = b.id where session_id = v_sess;
  perform public.st_audit(a.shop_id, 'table_move', a.label, null, jsonb_build_object('from', a.label, 'to', b.label));
end
$$;

-- รวม: ย้ายออร์เดอร์ทั้งหมดของโต๊ะต้นทางไปรวมกับโต๊ะปลายทางที่มีลูกค้าอยู่ แล้วปิดรอบต้นทาง
create or replace function public.st_merge_tables(p_from uuid, p_into uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.st_tables;
  b public.st_tables;
  sa public.st_table_sessions;
  sb public.st_table_sessions;
begin
  select * into a from public.st_tables where id = p_from;
  select * into b from public.st_tables where id = p_into;
  if a.id is null or b.id is null or a.shop_id <> b.shop_id or a.id = b.id then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(a.shop_id, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  select * into sa from public.st_table_sessions where table_id = a.id and status <> 'closed' for update;
  select * into sb from public.st_table_sessions where table_id = b.id and status <> 'closed' for update;
  if sa.id is null or sb.id is null then raise exception 'st_table_not_open'; end if;

  -- ป้องกัน client_ref ชนกัน (โอกาสน้อยมาก)
  update public.st_orders o set client_ref = null
   where o.session_id = sa.id and o.client_ref is not null
     and exists (select 1 from public.st_orders x where x.session_id = sb.id and x.client_ref = o.client_ref);
  update public.st_orders        set session_id = sb.id, table_id = b.id where session_id = sa.id;
  update public.st_service_calls set session_id = sb.id, table_id = b.id
   where session_id = sa.id and status = 'done';
  update public.st_service_calls set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
   where session_id = sa.id and status = 'pending';

  update public.st_table_sessions
     set guest_count = nullif(coalesce(sb.guest_count, 0) + coalesce(sa.guest_count, 0), 0),
         status = case when sa.status = 'open' then 'open' else sb.status end,
         last_activity_at = now()
   where id = sb.id;
  update public.st_table_sessions
     set status = 'closed', closed_at = now(), closed_by_user_id = auth.uid()
   where id = sa.id;                              -- ไม่มีออร์เดอร์เหลือแล้ว จึงไม่ถูกนับว่าปิดโดยไม่เก็บเงิน
  perform public.st_audit(a.shop_id, 'table_merge', b.label, null, jsonb_build_object('from', a.label, 'into', b.label));
end
$$;

-- ---------- 7) สิทธิ์เรียกฟังก์ชัน ----------
revoke all on function
  public.st_set_item_extras(uuid, text[], int), public.st_set_item_stock(uuid, int),
  public.st_stock_take(), public.st_stock_return(),
  public.st_audit(uuid, text, text, numeric, jsonb), public.st_audit_orders(), public.st_audit_payments(),
  public.st_audit_sessions(), public.st_audit_menu(), public.st_audit_shop(), public.st_audit_members(),
  public.st_audit_report(uuid, date, date), public.st_move_table(uuid, uuid), public.st_merge_tables(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.st_set_item_extras(uuid, text[], int), public.st_set_item_stock(uuid, int),
  public.st_audit_report(uuid, date, date), public.st_move_table(uuid, uuid), public.st_merge_tables(uuid, uuid)
to authenticated;
-- st_menu_json / st_menu_admin / st_scan ใช้สิทธิ์เดิมจาก st-03 / st-04

insert into public.st_schema_log (id) values ('st-09-ops')
on conflict (id) do update set applied_at = now();
