-- =====================================================================
-- SmartTable · st-22-manage.sql (รอบ N)
-- (2) เลือกเมนู/สินค้าที่แสดงตามประเภทร้าน · (4) เปิด/ปิดร้าน + ตั้งเวลาอัตโนมัติ
-- (5) ล้างข้อมูลร้าน (ยืนยันรหัสผ่านเจ้าของ) · (7) จ่ายหลายช่องทางไม่จำกัด (เงินสดหลายช่องได้)
-- รันซ้ำได้ · ต้องรัน st-01 … st-21 ก่อน
-- ทับ: st_public_menu (กรองตามประเภทร้าน), st_pay (ช่องทาง 1–30)
-- =====================================================================

-- ---------- 1) เมนูแสดงในร้านประเภทไหน (ว่าง = ทุกประเภท) ----------
alter table public.st_menu_items add column if not exists show_types text[];
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'st_menu_items_show_types_check') then
    alter table public.st_menu_items add constraint st_menu_items_show_types_check
      check (show_types is null or show_types <@ array['restaurant','buffet','grocery','queue','small']::text[]);
  end if;
end
$$;

-- ติ๊กหลายเมนูพร้อมกัน · p_types = null หรือว่าง = แสดงทุกประเภท
create or replace function public.st_set_items_types(p_shop uuid, p_items uuid[], p_types text[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int; v_t text[];
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if cardinality(coalesce(p_items, '{}')) = 0 or cardinality(p_items) > 1000 then raise exception 'st_bad_request'; end if;
  v_t := case when cardinality(coalesce(p_types, '{}')) = 0 then null
              else (select array_agg(distinct t order by t) from unnest(p_types) t) end;
  if v_t is not null and not (v_t <@ array['restaurant','buffet','grocery','queue','small']::text[]) then
    raise exception 'st_bad_request';
  end if;
  update public.st_menu_items set show_types = v_t where shop_id = p_shop and id = any(p_items);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- ลูกค้าเห็นเฉพาะเมนูของประเภทร้านตอนนี้ (+ ซ่อนต้นทุน)
create or replace function public.st_public_menu(p_qr text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_shop uuid; v_type text; m jsonb;
begin
  select t.shop_id, s.shop_type into v_shop, v_type
    from public.st_tables t join public.st_shops s on s.id = t.shop_id
   where t.qr_token = p_qr and t.is_active and s.status = 'active';
  if v_shop is null then raise exception 'st_table_not_found'; end if;
  m := public.st_menu_strip_cost(public.st_menu_json(v_shop));
  return jsonb_set(m, '{items}', coalesce((
    select jsonb_agg(i) from jsonb_array_elements(m -> 'items') i
     where i -> 'show_types' is null or jsonb_typeof(i -> 'show_types') <> 'array'
        or jsonb_array_length(i -> 'show_types') = 0 or (i -> 'show_types') ? v_type), '[]'::jsonb));
end
$$;

-- กันลูกค้าสั่งเมนูที่ไม่ได้แสดงในประเภทร้านนี้ (พนักงานสั่งแทนได้)
create or replace function public.st_order_items_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_t text[]; v_type text;
begin
  if new.item_id is null then return new; end if;
  select show_types into v_t from public.st_menu_items where id = new.item_id;
  if cardinality(coalesce(v_t, '{}')) = 0 then return new; end if;
  select shop_type into v_type from public.st_shops where id = new.shop_id;
  if v_type = any(v_t) or public.st_has_shop_role(new.shop_id) then return new; end if;
  raise exception 'st_item_gone' using detail = new.name;
end
$$;
drop trigger if exists st_order_items_types on public.st_order_items;
create trigger st_order_items_types
  before insert on public.st_order_items
  for each row execute function public.st_order_items_types();

-- ---------- 2) เปิด/ปิดร้าน + ตั้งเวลา ----------
-- hours = {auto: bool, days: {"0".."6" (0 = อาทิตย์): {on, open "HH:MM", close "HH:MM"}}} เวลาไทย · ปิดเลยเที่ยงคืนได้
alter table public.st_shops add column if not exists hours jsonb not null default '{}'::jsonb;
alter table public.st_shops add column if not exists hours_state text;     -- สถานะที่ตั้งเวลาสั่งล่าสุด (open/closed)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'st_shops_hours_check') then
    alter table public.st_shops add constraint st_shops_hours_check
      check (jsonb_typeof(hours) = 'object' and octet_length(hours::text) <= 2000);
  end if;
end
$$;

create or replace function public.st_hours_open_at(p_hours jsonb, p_at timestamptz)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_local timestamp := p_at at time zone 'Asia/Bangkok';
  v_d     int := extract(dow from v_local)::int;
  v_tm    time := v_local::time;
  td      jsonb := p_hours -> 'days' -> v_d::text;
  yd      jsonb := p_hours -> 'days' -> ((v_d + 6) % 7)::text;
  o time; c time;
begin
  if coalesce((td ->> 'on')::boolean, false) then
    o := (td ->> 'open')::time; c := (td ->> 'close')::time;
    if c > o then
      if v_tm >= o and v_tm < c then return true; end if;
    elsif v_tm >= o then                                  -- ปิดหลังเที่ยงคืน
      return true;
    end if;
  end if;
  if coalesce((yd ->> 'on')::boolean, false) then
    o := (yd ->> 'open')::time; c := (yd ->> 'close')::time;
    if c <= o and v_tm < c then return true; end if;       -- ต่อจากเมื่อวาน
  end if;
  return false;
end
$$;

-- ทุกนาที: ถึงเวลาเปิด/ปิด → สลับให้ (ถ้ากดเปิด/ปิดเองระหว่างนั้น จะคงไว้จนถึงรอบเวลาถัดไป)
create or replace function public.st_shop_hours_tick(p_shop uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  with c as (
    select id, case when public.st_hours_open_at(hours, now()) then 'open' else 'closed' end st
      from public.st_shops
     where coalesce((hours ->> 'auto')::boolean, false) and status = 'active'
       and (p_shop is null or id = p_shop)
  )
  update public.st_shops s set is_open = (c.st = 'open'), hours_state = c.st
    from c where s.id = c.id and s.hours_state is distinct from c.st;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

create or replace function public.st_save_shop_hours(p_shop uuid, p_hours jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d   int;
  x   jsonb;
  out jsonb := '{}'::jsonb;
  dd  jsonb := '{}'::jsonb;
  s   public.st_shops;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' then raise exception 'st_bad_request'; end if;
  for d in 0..6 loop
    x := p_hours -> 'days' -> d::text;
    if x is null then continue; end if;
    if coalesce(x ->> 'open', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(x ->> 'close', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or x ->> 'open' = x ->> 'close' then
      raise exception 'st_bad_hours';
    end if;
    dd := dd || jsonb_build_object(d::text, jsonb_build_object('on', coalesce((x ->> 'on')::boolean, false),
                                                             'open', x ->> 'open', 'close', x ->> 'close'));
  end loop;
  out := jsonb_build_object('auto', coalesce((p_hours ->> 'auto')::boolean, false), 'days', dd);
  if (out ->> 'auto')::boolean and not exists (select 1 from jsonb_each(dd) e where (e.value ->> 'on')::boolean) then
    raise exception 'st_bad_hours';
  end if;
  update public.st_shops set hours = out, hours_state = null where id = p_shop;
  perform public.st_shop_hours_tick(p_shop);                -- ตั้งอัตโนมัติ = เปิด/ปิดตามเวลาทันที
  select * into s from public.st_shops where id = p_shop;
  return jsonb_build_object('hours', s.hours, 'is_open', s.is_open);
end
$$;

create or replace function public.st_set_shop_open(p_shop uuid, p_open boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare s public.st_shops;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  update public.st_shops set is_open = coalesce(p_open, false) where id = p_shop returning * into s;
  perform public.st_audit(p_shop, case when s.is_open then 'shop_open' else 'shop_close' end, null, null, null);
  return jsonb_build_object('is_open', s.is_open, 'auto', coalesce((s.hours ->> 'auto')::boolean, false),
                            'scheduled', case when coalesce((s.hours ->> 'auto')::boolean, false)
                                              then public.st_hours_open_at(s.hours, now()) end);
end
$$;

-- ลูกค้า: เวลาเปิดร้าน (แสดงตอนร้านปิด)
create or replace function public.st_guest_hours(p_qr text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('is_open', s.is_open, 'hours', s.hours)
    from public.st_tables t join public.st_shops s on s.id = t.shop_id
   where t.qr_token = p_qr and t.is_active;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('st_shop_hours_tick', '* * * * *', 'select public.st_shop_hours_tick()');
  else
    raise notice 'SmartTable: ไม่มี pg_cron — ตั้งเวลาเปิด/ปิดร้านอัตโนมัติจะไม่ทำงาน (เปิด/ปิดเองได้ตามปกติ)';
  end if;
end
$$;

-- ---------- 3) ล้างข้อมูลร้าน (เจ้าของ · ต้องใส่รหัสผ่านบัญชี) ----------
create table if not exists public.st_reset_tries (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  ok       boolean not null default false,
  at       timestamptz not null default now()
);
create index if not exists st_reset_tries_user_idx on public.st_reset_tries (user_id, at desc);
alter table public.st_reset_tries enable row level security;
revoke all on public.st_reset_tries from anon, authenticated;

create or replace function public.st_check_password(p_password text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_hash text; v_ok boolean;
begin
  if (select count(*) from public.st_reset_tries
       where user_id = auth.uid() and not ok and at > now() - interval '15 minutes') >= 5 then
    raise exception 'st_too_many_tries';
  end if;
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  if v_hash is null or v_hash = '' then raise exception 'st_no_password'; end if;
  execute 'select extensions.crypt($1, $2) = $2' into v_ok using coalesce(p_password, ''), v_hash;
  insert into public.st_reset_tries (user_id, ok) values (auth.uid(), coalesce(v_ok, false));
  return coalesce(v_ok, false);
end
$$;

-- p_kinds: sales (บิล ออร์เดอร์ ใบเสร็จ คิว คะแนน) · shifts · audit · menu · tables · promos · buffet
create or replace function public.st_shop_reset(p_shop uuid, p_password text, p_kinds text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k    text;
  v_n  int;
  res  jsonb := '{}'::jsonb;
begin
  if not exists (select 1 from public.st_shops where id = p_shop and owner_user_id = auth.uid()) then
    raise exception 'st_forbidden';
  end if;
  if cardinality(coalesce(p_kinds, '{}')) = 0
     or not (p_kinds <@ array['sales','shifts','audit','menu','tables','promos','buffet']::text[]) then
    raise exception 'st_bad_request';
  end if;
  if not public.st_check_password(p_password) then
    return jsonb_build_object('ok', false, 'reason', 'st_wrong_password');   -- คืนค่าแทน error เพื่อให้บันทึกครั้งที่ผิดไว้
  end if;

  perform set_config('st.deleting_shop', p_shop::text, true);   -- ไม่เขียนประวัติระหว่างล้าง
  foreach k in array p_kinds loop
    if k = 'sales' then
      delete from public.st_cart_lines where shop_id = p_shop;
      delete from public.st_table_sessions where shop_id = p_shop;           -- ออร์เดอร์ ใบเสร็จ สลิป เรียกพนักงาน คะแนน ตามไปด้วย
      get diagnostics v_n = row_count;
      delete from public.st_tables where shop_id = p_shop and kind = 'ticket';  -- บัตรคิวเก่า
      delete from public.st_coupon_uses where shop_id = p_shop;
      delete from public.st_ratings where shop_id = p_shop;
      update public.st_coupons set used_count = 0 where shop_id = p_shop;
    elsif k = 'shifts' then
      delete from public.st_shifts where shop_id = p_shop;
      get diagnostics v_n = row_count;
    elsif k = 'audit' then
      delete from public.st_audit_log where shop_id = p_shop;
      get diagnostics v_n = row_count;
    elsif k = 'menu' then
      delete from public.st_cart_lines where shop_id = p_shop;
      delete from public.st_menu_items where shop_id = p_shop;
      get diagnostics v_n = row_count;
      delete from public.st_categories where shop_id = p_shop;
    elsif k = 'tables' then
      delete from public.st_cart_lines where shop_id = p_shop
        and session_id in (select s.id from public.st_table_sessions s join public.st_tables t on t.id = s.table_id where t.shop_id = p_shop and t.kind = 'dine');
      delete from public.st_tables where shop_id = p_shop and kind = 'dine';
      get diagnostics v_n = row_count;
    elsif k = 'promos' then
      delete from public.st_coupons where shop_id = p_shop;
      get diagnostics v_n = row_count;
      delete from public.st_promotions where shop_id = p_shop;
    elsif k = 'buffet' then
      delete from public.st_buffet_packages where shop_id = p_shop;
      get diagnostics v_n = row_count;
    end if;
    res := res || jsonb_build_object(k, v_n);
  end loop;
  perform set_config('st.deleting_shop', '', true);
  if not ('audit' = any(p_kinds)) then
    perform public.st_audit(p_shop, 'shop_reset', array_to_string(p_kinds, ', '), null, res);
  end if;
  return jsonb_build_object('ok', true, 'deleted', res);
end
$$;

-- ---------- 4) จ่ายหลายช่องทาง: 1–30 ช่อง เงินสดหลายช่องได้ (ทับ st-11) ----------
create or replace function public.st_pay(p_table uuid, p_part jsonb default null, p_discount numeric default 0,
                                         p_tenders jsonb default null, p_note text default null,
                                         p_request uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tab    public.st_tables;
  v_shop   public.st_shops;
  v_sess   public.st_table_sessions;
  v_req    public.st_pay_requests;
  v_part   jsonb;
  v_bill   jsonb;
  v_total  numeric;
  v_tend   jsonb := '[]'::jsonb;
  x        jsonb;
  v_m      text;
  v_a      numeric;
  v_r      numeric;
  v_slip   text;
  v_sum    numeric := 0;
  v_recv   numeric := 0;
  v_change numeric := 0;
  v_no     int;
  v_part_no int;
  v_id     uuid;
  v_left   numeric;
  v_disc   numeric := coalesce(p_discount, 0);
begin
  select * into v_tab from public.st_tables where id = p_table;
  if v_tab.id is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_tab.shop_id, array['owner','manager','cashier','waiter']) then
    raise exception 'st_forbidden';
  end if;
  if v_disc < 0 then raise exception 'st_bad_request'; end if;
  if v_disc > 0 and not public.st_has_shop_role(v_tab.shop_id, array['owner','manager','cashier']) then
    raise exception 'st_discount_forbidden';
  end if;
  if char_length(coalesce(p_note, '')) > 200 then raise exception 'st_bad_request'; end if;
  select * into v_shop from public.st_shops where id = v_tab.shop_id;

  select * into v_sess from public.st_table_sessions where table_id = p_table and status <> 'closed' for update;
  if v_sess.id is null then raise exception 'st_table_not_open'; end if;

  if p_request is not null then
    select * into v_req from public.st_pay_requests where id = p_request and session_id = v_sess.id for update;
    if v_req.id is null then raise exception 'st_not_found'; end if;
    if v_req.status <> 'pending' then raise exception 'st_request_handled'; end if;
    p_part := null; v_disc := 0;
  end if;

  v_part := public.st_part_resolve(v_sess.id, p_part);
  if (v_part ->> 'subtotal')::numeric <= 0 then raise exception 'st_nothing_to_pay'; end if;
  v_bill  := public.st_bill_part(v_shop.id, (v_part ->> 'subtotal')::numeric, v_disc);
  v_total := (v_bill ->> 'total')::numeric;

  if p_request is not null then
    if v_total <> v_req.amount then
      raise exception 'st_bill_changed' using detail = v_total::text;
    end if;
    p_tenders := jsonb_build_array(jsonb_build_object('method', 'promptpay', 'amount', v_total, 'slip_path', v_req.slip_path));
  end if;

  if p_tenders is null or jsonb_typeof(p_tenders) <> 'array'
     or jsonb_array_length(p_tenders) not between 1 and 30 then
    raise exception 'st_bad_request';
  end if;
  for x in select * from jsonb_array_elements(p_tenders) loop
    v_m := x ->> 'method';
    if v_m is null or v_m not in ('cash','promptpay','transfer','card') then raise exception 'st_bad_request'; end if;
    v_a := round((x ->> 'amount')::numeric, 2);
    if v_a is null or v_a < 0 or (v_a = 0 and v_total > 0) then raise exception 'st_bad_amount'; end if;
    v_slip := nullif(trim(coalesce(x ->> 'slip_path', '')), '');
    if v_slip is not null and v_slip not like 'shops/' || v_shop.id::text || '/slips/%'
       and v_slip not like 'shops/' || v_shop.id::text || '/guest/%' then
      raise exception 'st_bad_image';
    end if;
    if v_m = 'cash' then
      v_r := round(coalesce((x ->> 'received')::numeric, v_a), 2);
      if v_r < v_a then raise exception 'st_cash_not_enough'; end if;
      if v_r > v_a + 100000 then raise exception 'st_bad_request'; end if;
      v_change := v_change + (v_r - v_a);
      v_slip := null;
    else
      v_r := v_a;
    end if;
    v_sum  := v_sum + v_a;
    v_recv := v_recv + v_r;
    v_tend := v_tend || jsonb_build_object('method', v_m, 'amount', v_a, 'received', v_r,
                                           'change', case when v_m = 'cash' then v_r - v_a else 0 end,
                                           'slip_path', v_slip,
                                           'who', nullif(left(trim(coalesce(x ->> 'who', '')), 40), ''));
  end loop;
  if v_sum <> v_total then raise exception 'st_tender_mismatch' using detail = v_total::text; end if;

  perform pg_advisory_xact_lock(hashtext('st_receipt_no:' || v_shop.id::text));
  select coalesce(max(receipt_no), 0) + 1 into v_no
    from public.st_payments
   where shop_id = v_shop.id
     and created_at >= (date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok');
  select count(*) + 1 into v_part_no from public.st_payments where session_id = v_sess.id;

  insert into public.st_payments (shop_id, session_id, table_id, receipt_no, method,
                                  subtotal, discount, service, service_pct, vat, vat_pct, vat_included, total,
                                  received, change_amount, slip_path, note, received_by_user_id,
                                  portion, part_no, tenders, tax, request_id)
  values (v_shop.id, v_sess.id, p_table, v_no,
          case when jsonb_array_length(v_tend) = 1 then v_tend -> 0 ->> 'method' else 'mixed' end,
          (v_bill ->> 'subtotal')::numeric, (v_bill ->> 'discount')::numeric,
          (v_bill ->> 'service')::numeric, (v_bill ->> 'service_pct')::numeric,
          (v_bill ->> 'vat')::numeric, (v_bill ->> 'vat_pct')::numeric, (v_bill ->> 'vat_included')::boolean,
          v_total, v_recv, v_change,
          (select t ->> 'slip_path' from jsonb_array_elements(v_tend) t where t ->> 'slip_path' is not null limit 1),
          nullif(trim(coalesce(p_note, '')), ''), auth.uid(),
          v_part ->> 'kind', v_part_no, v_tend,
          case when v_shop.tax_id is not null and v_shop.vat_pct > 0 then
            jsonb_build_object('tax_id', v_shop.tax_id, 'name', coalesce(v_shop.tax_name, v_shop.name),
                               'branch', v_shop.tax_branch, 'pos_id', v_shop.pos_id,
                               'address', v_shop.address) end,
          v_req.id)
  returning id into v_id;

  insert into public.st_payment_items (payment_id, shop_id, order_item_id, qty, amount)
  select v_id, v_shop.id, (e ->> 'order_item_id')::uuid, (e ->> 'qty')::int, (e ->> 'amount')::numeric
    from jsonb_array_elements(v_part -> 'items') e
   where (e ->> 'qty')::int > 0;

  if v_req.id is not null then
    update public.st_pay_requests
       set status = 'confirmed', payment_id = v_id, handled_at = now(), handled_by_user_id = auth.uid()
     where id = v_req.id;
  end if;

  v_left := (v_part ->> 'remaining')::numeric - (v_part ->> 'subtotal')::numeric;
  if v_left <= 0 then
    update public.st_table_sessions
       set status = 'closed', closed_at = now(), closed_by_user_id = auth.uid()
     where id = v_sess.id;
    update public.st_service_calls
       set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
     where session_id = v_sess.id and status = 'pending';
    update public.st_pay_requests set status = 'cancelled', handled_at = now()
     where session_id = v_sess.id and status in ('draft','pending');
  else
    update public.st_table_sessions set last_activity_at = now() where id = v_sess.id;
    update public.st_service_calls
       set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
     where session_id = v_sess.id and status = 'pending' and kind = 'slip';
  end if;

  return jsonb_build_object('payment_id', v_id, 'receipt_no', v_no, 'part_no', v_part_no, 'total', v_total,
                            'received', v_recv, 'change', v_change,
                            'remaining', greatest(v_left, 0), 'closed', v_left <= 0);
end
$$;

-- ---------- สิทธิ์ ----------
revoke all on function public.st_set_items_types(uuid, uuid[], text[]), public.st_order_items_types(),
  public.st_hours_open_at(jsonb, timestamptz), public.st_shop_hours_tick(uuid),
  public.st_save_shop_hours(uuid, jsonb), public.st_set_shop_open(uuid, boolean), public.st_guest_hours(text),
  public.st_check_password(text), public.st_shop_reset(uuid, text, text[])
from public, anon, authenticated;
grant execute on function public.st_set_items_types(uuid, uuid[], text[]), public.st_save_shop_hours(uuid, jsonb),
  public.st_set_shop_open(uuid, boolean), public.st_shop_reset(uuid, text, text[]) to authenticated;
grant execute on function public.st_guest_hours(text), public.st_public_menu(text) to anon, authenticated;
grant execute on function public.st_pay(uuid, jsonb, numeric, jsonb, text, uuid) to authenticated;

insert into public.st_schema_log (id) values ('st-22-manage')
on conflict (id) do update set applied_at = now();
