-- =====================================================================
-- SmartTable · st-17-buffet.sql  (รอบ I · ร้านบุฟเฟ่ต์)
-- ประเภทร้าน (restaurant / buffet / grocery / queue / small) · แพ็กเกจบุฟเฟ่ต์ (ผู้ใหญ่/เด็ก · จำกัดเวลาหรือไม่จำกัด)
-- เริ่มบุฟเฟ่ต์ที่โต๊ะ -> ค่าหัวเป็นรายการในบิล (ออร์เดอร์ "ค่าบริการ" is_charge ไม่ขึ้นจอครัว)
-- เมนูในแพ็กเกจ = 0 บาท · นอกแพ็กเกจคิดตามราคา · หมดเวลาสั่ง (last order) · จำกัดจำนวนต่อรอบ · เว้นระยะระหว่างรอบ
-- ค่าเกินเวลา (ต่อคน ต่อช่วงเวลา) · ต่อเวลา
-- รันซ้ำได้ · ทับฟังก์ชัน: st_scan (st-14), st_order_board (st-15)
-- =====================================================================

-- ---------- 1) ประเภทร้าน ----------
alter table public.st_shops add column if not exists shop_type text not null default 'restaurant';
alter table public.st_shops drop constraint if exists st_shops_shop_type_check;
alter table public.st_shops add constraint st_shops_shop_type_check
  check (shop_type in ('restaurant','buffet','grocery','queue','small'));
grant update (shop_type) on public.st_shops to authenticated;

-- ---------- 2) แพ็กเกจบุฟเฟ่ต์ ----------
create table if not exists public.st_buffet_packages (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid not null references public.st_shops(id) on delete cascade,
  name                text not null check (char_length(name) between 1 and 60),
  price_adult         numeric(10,2) not null check (price_adult >= 0),
  price_child         numeric(10,2) check (price_child is null or price_child >= 0),
  child_note          text check (child_note is null or char_length(child_note) <= 60),
  time_limit_min      int  check (time_limit_min is null or time_limit_min between 10 and 720),   -- null = ไม่จำกัดเวลา
  last_order_min      int  not null default 0 check (last_order_min between 0 and 120),        -- หยุดรับออร์เดอร์ก่อนหมดเวลา
  overtime_block_min  int  not null default 15 check (overtime_block_min between 5 and 120),
  overtime_fee        numeric(10,2) not null default 0 check (overtime_fee >= 0),                 -- ต่อคน ต่อช่วง
  round_limit         int  check (round_limit is null or round_limit between 1 and 50),        -- จาน/คน/รอบ
  round_gap_min       int  check (round_gap_min is null or round_gap_min between 1 and 60),    -- เว้นระหว่างรอบ
  include_all         boolean not null default true,
  category_ids        uuid[] not null default '{}',
  item_ids            uuid[] not null default '{}',
  rules               text check (rules is null or char_length(rules) <= 400),                 -- กติกาที่ลูกค้าเห็น
  is_active           boolean not null default true,
  sort                int not null default 0,
  created_at          timestamptz not null default now(),
  unique (id, shop_id)
);
create index if not exists st_buffet_packages_shop_idx on public.st_buffet_packages (shop_id, sort);
alter table public.st_buffet_packages enable row level security;
grant select on public.st_buffet_packages to authenticated;
drop policy if exists st_buffet_packages_select_staff on public.st_buffet_packages;
create policy st_buffet_packages_select_staff on public.st_buffet_packages
  for select to authenticated using (public.st_has_shop_role(shop_id));

-- ---------- 3) คอลัมน์ในรอบโต๊ะ / ออร์เดอร์ ----------
-- buffet = สำเนาค่าแพ็กเกจตอนเริ่ม (แก้แพ็กเกจทีหลังไม่กระทบโต๊ะที่กินอยู่)
-- {mode: package|alacarte, package_id, name, adults, children, price_adult, price_child, started_at, ends_at,
--  time_limit_min, last_order_min, overtime_block_min, overtime_fee, round_limit, round_gap_min,
--  include_all, category_ids, item_ids, rules}
alter table public.st_table_sessions add column if not exists buffet jsonb;
alter table public.st_orders add column if not exists is_charge boolean not null default false;   -- ค่าหัว/ค่าเกินเวลา
alter table public.st_order_items add column if not exists buffet boolean not null default false; -- รวมในบุฟเฟ่ต์ (0 บาท)

-- ---------- 4) ตัวช่วย ----------
create or replace function public.st_buffet_includes(b jsonb, p_item uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(b ->> 'mode', '') = 'package' and p_item is not null and (
           coalesce((b ->> 'include_all')::boolean, false)
        or p_item::text in (select jsonb_array_elements_text(coalesce(b -> 'item_ids', '[]'::jsonb)))
        or (select m.category_id::text from public.st_menu_items m where m.id = p_item)
             in (select jsonb_array_elements_text(coalesce(b -> 'category_ids', '[]'::jsonb))));
$$;

create or replace function public.st_buffet_is_staff(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and public.st_has_shop_role(p_shop, array['owner','manager','cashier','waiter','kitchen']);
$$;

-- ออร์เดอร์ค่าบริการของรอบโต๊ะ (สร้างถ้ายังไม่มี) · ไม่ขึ้นจอครัว
create or replace function public.st_buffet_charge_order(p_sess public.st_table_sessions)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_no int;
begin
  select id into v_id from public.st_orders where session_id = p_sess.id and is_charge and status <> 'cancelled' limit 1;
  if v_id is not null then return v_id; end if;
  perform pg_advisory_xact_lock(hashtext('st_order_no:' || p_sess.shop_id::text));
  select coalesce(max(order_no), 0) + 1 into v_no from public.st_orders
   where shop_id = p_sess.shop_id
     and created_at >= (date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok');
  perform set_config('st.buffet_charge', 'on', true);
  insert into public.st_orders (shop_id, session_id, table_id, order_no, status, source, is_charge, note, staff_user_id, status_by_user_id)
  values (p_sess.shop_id, p_sess.id, p_sess.table_id, v_no, 'served', 'staff', true, 'ค่าบุฟเฟ่ต์', auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

-- เขียนรายการค่าหัวใหม่ตามจำนวนคน (เก็บรายการค่าเกินเวลาไว้)
create or replace function public.st_buffet_write_heads(p_sess public.st_table_sessions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b    jsonb := p_sess.buffet;
  v_o  uuid;
  v_a  int := coalesce((b ->> 'adults')::int, 0);
  v_c  int := coalesce((b ->> 'children')::int, 0);
begin
  v_o := public.st_buffet_charge_order(p_sess);
  delete from public.st_order_items where order_id = v_o and note in ('buffet:adult', 'buffet:child');
  if b ->> 'mode' = 'package' then
    if v_a > 0 then
      insert into public.st_order_items (shop_id, order_id, item_id, name, unit_price, qty, options, note, line_total)
      values (p_sess.shop_id, v_o, null, 'บุฟเฟ่ต์ ' || (b ->> 'name') || ' · ผู้ใหญ่', (b ->> 'price_adult')::numeric, v_a,
              '[]'::jsonb, 'buffet:adult', (b ->> 'price_adult')::numeric * v_a);
    end if;
    if v_c > 0 then
      insert into public.st_order_items (shop_id, order_id, item_id, name, unit_price, qty, options, note, line_total)
      values (p_sess.shop_id, v_o, null, 'บุฟเฟ่ต์ ' || (b ->> 'name') || ' · เด็ก',
              coalesce((b ->> 'price_child')::numeric, (b ->> 'price_adult')::numeric), v_c, '[]'::jsonb, 'buffet:child',
              coalesce((b ->> 'price_child')::numeric, (b ->> 'price_adult')::numeric) * v_c);
    end if;
  end if;
  update public.st_orders set subtotal = 0, updated_at = now() where id = v_o;   -- trigger รวมยอดใหม่
  -- ไม่มีรายการเหลือ (เช่น เปลี่ยนเป็นสั่งตามเมนู) -> ยกเลิกออร์เดอร์ค่าบริการ
  if not exists (select 1 from public.st_order_items where order_id = v_o) then
    delete from public.st_orders where id = v_o;
  end if;
end
$$;

-- ค่าเกินเวลาตอนนี้
create or replace function public.st_buffet_overtime_calc(b jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_end   timestamptz := (b ->> 'ends_at')::timestamptz;
  v_over  int;
  v_blk   int := greatest(coalesce((b ->> 'overtime_block_min')::int, 15), 1);
  v_heads int := coalesce((b ->> 'adults')::int, 0) + coalesce((b ->> 'children')::int, 0);
  v_n     int;
begin
  if b is null or b ->> 'mode' <> 'package' or v_end is null or now() <= v_end then
    return jsonb_build_object('minutes', 0, 'blocks', 0, 'amount', 0, 'heads', v_heads);
  end if;
  v_over := ceil(extract(epoch from (now() - v_end)) / 60)::int;
  v_n := ceil(v_over::numeric / v_blk)::int;
  return jsonb_build_object('minutes', v_over, 'blocks', v_n, 'heads', v_heads,
                            'fee', coalesce((b ->> 'overtime_fee')::numeric, 0),
                            'amount', v_n * v_heads * coalesce((b ->> 'overtime_fee')::numeric, 0));
end
$$;

-- ---------- 5) จัดการแพ็กเกจ (เจ้าของ / ผู้จัดการ) ----------
create or replace function public.st_save_buffet_package(p_shop uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid := nullif(p ->> 'id', '')::uuid;
  v_cats uuid[];
  v_items uuid[];
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if v_id is not null and not exists (select 1 from public.st_buffet_packages where id = v_id and shop_id = p_shop) then
    raise exception 'st_not_found';
  end if;
  if v_id is null and (select count(*) from public.st_buffet_packages where shop_id = p_shop) >= 20 then
    raise exception 'st_bad_buffet' using detail = 'max 20';
  end if;
  begin
    select coalesce(array_agg(x::uuid), '{}') into v_cats from jsonb_array_elements_text(coalesce(p -> 'category_ids', '[]')) x;
    select coalesce(array_agg(x::uuid), '{}') into v_items from jsonb_array_elements_text(coalesce(p -> 'item_ids', '[]')) x;
    if v_id is null then
      insert into public.st_buffet_packages (shop_id, name, price_adult, price_child, child_note, time_limit_min, last_order_min,
                                             overtime_block_min, overtime_fee, round_limit, round_gap_min, include_all,
                                             category_ids, item_ids, rules, is_active, sort)
      values (p_shop, trim(p ->> 'name'), (p ->> 'price_adult')::numeric, nullif(p ->> 'price_child', '')::numeric,
              nullif(trim(coalesce(p ->> 'child_note', '')), ''), nullif(p ->> 'time_limit_min', '')::int,
              coalesce(nullif(p ->> 'last_order_min', '')::int, 0), coalesce(nullif(p ->> 'overtime_block_min', '')::int, 15),
              coalesce(nullif(p ->> 'overtime_fee', '')::numeric, 0), nullif(p ->> 'round_limit', '')::int,
              nullif(p ->> 'round_gap_min', '')::int, coalesce((p ->> 'include_all')::boolean, true), v_cats, v_items,
              nullif(trim(coalesce(p ->> 'rules', '')), ''), coalesce((p ->> 'is_active')::boolean, true),
              coalesce((select max(sort) + 1 from public.st_buffet_packages where shop_id = p_shop), 0))
      returning id into v_id;
    else
      update public.st_buffet_packages
         set name = trim(p ->> 'name'), price_adult = (p ->> 'price_adult')::numeric,
             price_child = nullif(p ->> 'price_child', '')::numeric, child_note = nullif(trim(coalesce(p ->> 'child_note', '')), ''),
             time_limit_min = nullif(p ->> 'time_limit_min', '')::int, last_order_min = coalesce(nullif(p ->> 'last_order_min', '')::int, 0),
             overtime_block_min = coalesce(nullif(p ->> 'overtime_block_min', '')::int, 15),
             overtime_fee = coalesce(nullif(p ->> 'overtime_fee', '')::numeric, 0),
             round_limit = nullif(p ->> 'round_limit', '')::int, round_gap_min = nullif(p ->> 'round_gap_min', '')::int,
             include_all = coalesce((p ->> 'include_all')::boolean, true), category_ids = v_cats, item_ids = v_items,
             rules = nullif(trim(coalesce(p ->> 'rules', '')), ''), is_active = coalesce((p ->> 'is_active')::boolean, true)
       where id = v_id;
    end if;
  exception
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'st_bad_buffet';
  end;
  return v_id;
end
$$;

create or replace function public.st_delete_buffet_package(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_buffet_packages where id = p_id;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  delete from public.st_buffet_packages where id = p_id;   -- โต๊ะที่กินอยู่ใช้สำเนา ไม่กระทบ
end
$$;

-- ---------- 6) ที่โต๊ะ (พนักงาน) ----------
-- เริ่ม / แก้ บุฟเฟ่ต์: p_package = null -> สั่งตามเมนู (ไม่ใช่บุฟเฟ่ต์)
create or replace function public.st_buffet_start(p_table uuid, p_package uuid, p_adults int, p_children int default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess  public.st_table_sessions;
  pk      public.st_buffet_packages;
  v_start timestamptz;
  b       jsonb;
begin
  select s.* into v_sess from public.st_table_sessions s where s.table_id = p_table and s.status <> 'closed';
  if v_sess.id is null then raise exception 'st_table_not_open'; end if;
  if not public.st_has_shop_role(v_sess.shop_id, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  if v_sess.status <> 'open' then raise exception 'st_session_billing'; end if;
  if exists (select 1 from public.st_payments where session_id = v_sess.id and status = 'paid') then
    raise exception 'st_partly_paid';
  end if;
  if p_package is null then
    b := jsonb_build_object('mode', 'alacarte', 'started_at', coalesce(v_sess.buffet ->> 'started_at', now()::text));
  else
    select * into pk from public.st_buffet_packages where id = p_package and shop_id = v_sess.shop_id and is_active;
    if pk.id is null then raise exception 'st_not_found'; end if;
    if coalesce(p_adults, 0) not between 0 and 99 or coalesce(p_children, 0) not between 0 and 99
       or coalesce(p_adults, 0) + coalesce(p_children, 0) < 1 then
      raise exception 'st_bad_buffet' using detail = 'heads';
    end if;
    v_start := coalesce((v_sess.buffet ->> 'started_at')::timestamptz, now());
    b := jsonb_build_object(
      'mode', 'package', 'package_id', pk.id, 'name', pk.name,
      'adults', coalesce(p_adults, 0), 'children', coalesce(p_children, 0),
      'price_adult', pk.price_adult, 'price_child', pk.price_child, 'child_note', pk.child_note,
      'started_at', v_start,
      'ends_at', case when pk.time_limit_min is null then null
                      else coalesce(case when (v_sess.buffet ->> 'package_id') = pk.id::text then (v_sess.buffet ->> 'ends_at')::timestamptz end,
                                    v_start + make_interval(mins => pk.time_limit_min)) end,
      'time_limit_min', pk.time_limit_min, 'last_order_min', pk.last_order_min,
      'overtime_block_min', pk.overtime_block_min, 'overtime_fee', pk.overtime_fee,
      'round_limit', pk.round_limit, 'round_gap_min', pk.round_gap_min,
      'include_all', pk.include_all, 'category_ids', to_jsonb(pk.category_ids), 'item_ids', to_jsonb(pk.item_ids),
      'rules', pk.rules);
  end if;
  update public.st_table_sessions
     set buffet = b, last_activity_at = now(),
         confirm_status = case when confirm_status = 'pending' then 'confirmed' else confirm_status end,
         confirmed_at = case when confirm_status = 'pending' then now() else confirmed_at end,
         confirmed_by_user_id = case when confirm_status = 'pending' then auth.uid() else confirmed_by_user_id end
   where id = v_sess.id
  returning * into v_sess;
  update public.st_service_calls set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
   where session_id = v_sess.id and kind = 'open' and status = 'pending';
  perform public.st_buffet_write_heads(v_sess);
  return public.st_buffet_status(p_table);
end
$$;

-- ต่อเวลา / ลดเวลา (นาที, ติดลบได้)
create or replace function public.st_buffet_extend(p_table uuid, p_minutes int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_sess public.st_table_sessions;
begin
  select s.* into v_sess from public.st_table_sessions s where s.table_id = p_table and s.status <> 'closed';
  if v_sess.id is null then raise exception 'st_table_not_open'; end if;
  if not public.st_has_shop_role(v_sess.shop_id, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  if v_sess.buffet ->> 'ends_at' is null or p_minutes is null or p_minutes not between -240 and 240 or p_minutes = 0 then
    raise exception 'st_bad_buffet';
  end if;
  update public.st_table_sessions
     set buffet = jsonb_set(buffet, '{ends_at}', to_jsonb(((buffet ->> 'ends_at')::timestamptz + make_interval(mins => p_minutes))))
   where id = v_sess.id;
  perform public.st_audit(v_sess.shop_id, 'buffet_extend', (select label from public.st_tables where id = p_table), null,
                          jsonb_build_object('minutes', p_minutes, 'ends_at', v_sess.buffet ->> 'ends_at'));
  return public.st_buffet_status(p_table);
end
$$;

-- คิดค่าเกินเวลา (เขียนทับรายการเดิม ถ้ากดซ้ำ)
create or replace function public.st_buffet_overtime(p_table uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess public.st_table_sessions;
  v_ot   jsonb;
  v_o    uuid;
begin
  select s.* into v_sess from public.st_table_sessions s where s.table_id = p_table and s.status <> 'closed';
  if v_sess.id is null then raise exception 'st_table_not_open'; end if;
  if not public.st_has_shop_role(v_sess.shop_id, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  if exists (select 1 from public.st_payments where session_id = v_sess.id and status = 'paid') then raise exception 'st_partly_paid'; end if;
  v_ot := public.st_buffet_overtime_calc(v_sess.buffet);
  if (v_ot ->> 'amount')::numeric <= 0 then raise exception 'st_bad_buffet' using detail = 'no overtime'; end if;
  v_o := public.st_buffet_charge_order(v_sess);
  delete from public.st_order_items where order_id = v_o and note = 'buffet:overtime';
  insert into public.st_order_items (shop_id, order_id, item_id, name, unit_price, qty, options, note, line_total)
  values (v_sess.shop_id, v_o, null,
          'ค่าเกินเวลา ' || (v_ot ->> 'minutes') || ' นาที (' || (v_ot ->> 'blocks') || ' ช่วง × ฿' || trim_scale((v_ot ->> 'fee')::numeric) || ')',
          (v_ot ->> 'blocks')::int * (v_ot ->> 'fee')::numeric, (v_ot ->> 'heads')::int, '[]'::jsonb, 'buffet:overtime',
          (v_ot ->> 'amount')::numeric);
  update public.st_orders set subtotal = 0, updated_at = now() where id = v_o;
  return public.st_buffet_status(p_table);
end
$$;

-- สถานะบุฟเฟ่ต์ของโต๊ะ (หน้าเช็กบิล / ผังโต๊ะ)
create or replace function public.st_buffet_status(p_table uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_sess public.st_table_sessions;
begin
  select s.* into v_sess from public.st_table_sessions s where s.table_id = p_table and s.status <> 'closed';
  if v_sess.id is null then return null; end if;
  if not public.st_has_shop_role(v_sess.shop_id) then raise exception 'st_forbidden'; end if;
  return jsonb_build_object('buffet', v_sess.buffet, 'now', now(),
    'overtime', public.st_buffet_overtime_calc(v_sess.buffet),
    'overtime_charged', coalesce((select sum(i.line_total) from public.st_order_items i join public.st_orders o on o.id = i.order_id
                                   where o.session_id = v_sess.id and o.is_charge and i.note = 'buffet:overtime'), 0));
end
$$;

-- ผังโต๊ะ: แพ็กเกจที่เปิดใช้ + บุฟเฟ่ต์ของแต่ละโต๊ะ
create or replace function public.st_buffet_board(p_shop uuid)
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
    'packages', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort, p.created_at)
                            from public.st_buffet_packages p where p.shop_id = p_shop and p.is_active), '[]'::jsonb),
    'tables', coalesce((select jsonb_object_agg(s.table_id, s.buffet)
                          from public.st_table_sessions s
                         where s.shop_id = p_shop and s.status <> 'closed' and s.order_type = 'dine'), '{}'::jsonb));
end
$$;

-- ---------- 7) กติกาตอนสั่ง ----------
-- ร้านบุฟเฟ่ต์: ลูกค้าสั่งได้หลังพนักงานเริ่มบุฟเฟ่ต์ (เลือกแพ็กเกจ + นับคน) หรือเลือก "สั่งตามเมนู"
create or replace function public.st_orders_buffet_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_charge or new.source = 'staff' then return new; end if;
  if exists (select 1 from public.st_shops sh join public.st_table_sessions s on s.id = new.session_id
              where sh.id = new.shop_id and sh.shop_type = 'buffet' and s.order_type = 'dine' and s.buffet is null)
     and not public.st_buffet_is_staff(new.shop_id) then
    raise exception 'st_buffet_wait';
  end if;
  return new;
end
$$;
drop trigger if exists st_orders_buffet_guard on public.st_orders;
create trigger st_orders_buffet_guard before insert on public.st_orders
  for each row execute function public.st_orders_buffet_guard();

-- เมนูในแพ็กเกจ = 0 บาท · หมดเวลาสั่ง · เว้นระยะระหว่างรอบ (ชื่อ zbuffet ให้ทำงานหลังโปรตามเวลา)
create or replace function public.st_order_items_buffet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b      jsonb;
  v_sess uuid;
  v_end  timestamptz;
  v_gap  int;
  v_last timestamptz;
begin
  if new.item_id is null then return new; end if;
  select s.buffet, s.id into b, v_sess from public.st_orders o join public.st_table_sessions s on s.id = o.session_id
   where o.id = new.order_id;
  if b is null or not public.st_buffet_includes(b, new.item_id) then return new; end if;
  new.buffet := true;
  new.promo := null;
  new.unit_price := 0;
  new.line_total := 0;
  if public.st_buffet_is_staff(new.shop_id) then return new; end if;     -- พนักงานสั่งแทนได้เสมอ
  v_end := (b ->> 'ends_at')::timestamptz;
  if v_end is not null and now() > v_end - make_interval(mins => coalesce((b ->> 'last_order_min')::int, 0)) then
    raise exception 'st_buffet_last_order';
  end if;
  v_gap := (b ->> 'round_gap_min')::int;
  if v_gap is not null then
    select max(o.created_at) into v_last
      from public.st_orders o
     where o.session_id = v_sess and o.id <> new.order_id and o.status <> 'cancelled' and not o.is_charge
       and o.source = 'guest' and exists (select 1 from public.st_order_items i where i.order_id = o.id and i.buffet);
    if v_last is not null and v_last > now() - make_interval(mins => v_gap) then
      raise exception 'st_buffet_gap'
        using detail = ceil(extract(epoch from (v_last + make_interval(mins => v_gap) - now())) / 60)::int::text;
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists st_order_items_zbuffet on public.st_order_items;
create trigger st_order_items_zbuffet before insert on public.st_order_items
  for each row execute function public.st_order_items_buffet();

-- จำกัดจำนวนต่อรอบ (จาน/คน/รอบ) ตรวจหลังใส่ครบทุกรายการในออร์เดอร์
create or replace function public.st_order_items_buffet_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare b jsonb; v_lim int; v_heads int;
begin
  if not new.buffet or public.st_buffet_is_staff(new.shop_id) then return null; end if;
  select s.buffet into b from public.st_orders o join public.st_table_sessions s on s.id = o.session_id where o.id = new.order_id;
  v_lim := (b ->> 'round_limit')::int;
  if v_lim is null then return null; end if;
  v_heads := greatest(coalesce((b ->> 'adults')::int, 0) + coalesce((b ->> 'children')::int, 0), 1);
  if (select sum(qty) from public.st_order_items where order_id = new.order_id and buffet) > v_lim * v_heads then
    raise exception 'st_buffet_round_limit' using detail = (v_lim * v_heads)::text;
  end if;
  return null;
end
$$;
drop trigger if exists st_order_items_zbuffet_limit on public.st_order_items;
create trigger st_order_items_zbuffet_limit after insert on public.st_order_items
  for each row execute function public.st_order_items_buffet_limit();


-- ---------- 8) ทับฟังก์ชันเดิม ----------
-- สแกน QR: เพิ่มประเภทร้าน + บุฟเฟ่ต์ของโต๊ะ + เวลาเซิร์ฟเวอร์ (นับถอยหลังตรงกันทุกเครื่อง) (ทับ st-14)
create or replace function public.st_scan(p_qr text, p_auto_open boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tab    public.st_tables;
  v_shop   public.st_shops;
  v_sess   public.st_table_sessions;
  v_state  text;
  v_ticket jsonb;
begin
  select * into v_tab from public.st_tables where qr_token = p_qr;
  if not found or not v_tab.is_active then raise exception 'st_table_not_found'; end if;
  select * into v_shop from public.st_shops where id = v_tab.shop_id;
  if v_shop.status <> 'active' then raise exception 'st_table_not_found'; end if;

  if v_tab.kind = 'hub' then
    v_state := case when not v_shop.is_open then 'shop_closed'
                    when not v_shop.takeaway_enabled then 'takeaway_off'
                    else 'takeaway' end;
  elsif v_tab.kind = 'ticket' then
    select * into v_sess from public.st_table_sessions where table_id = v_tab.id order by opened_at desc limit 1;
    v_state := case when v_sess.status in ('open','billing') then v_sess.status else 'ended' end;
    if v_sess.status <> 'closed' or v_sess.closed_at > now() - interval '3 hours' then
      v_ticket := jsonb_build_object(
        'queue_no', v_sess.queue_no, 'pickup_at', v_sess.pickup_at, 'ready_at', v_sess.ready_at,
        'picked_up_at', v_sess.picked_up_at, 'closed', v_sess.status = 'closed',
        'contact_name', v_sess.contact_name,
        'paid', v_sess.paid_at is not null
                or (exists (select 1 from public.st_payments where session_id = v_sess.id and status = 'paid')
                    and (public.st_session_money(v_sess.id) ->> 'remaining')::numeric <= 0),
        'hub_qr', (select qr_token from public.st_tables where shop_id = v_shop.id and kind = 'hub' and is_active));
    end if;
    if v_sess.status = 'closed' then v_sess := null; end if;
  else
    select * into v_sess from public.st_table_sessions where table_id = v_tab.id and status <> 'closed';
    if not v_shop.is_open then
      v_state := 'shop_closed';
    elsif v_sess.id is null then
      if v_shop.order_mode in ('instant','confirm') and not coalesce(p_auto_open, true) then
        v_state := 'ended';
      elsif v_shop.order_mode in ('instant','confirm') then
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
  end if;

  return jsonb_build_object(
    'shop', jsonb_build_object('id', v_shop.id, 'name', v_shop.name, 'logo_path', v_shop.logo_path,
                               'cover_path', v_shop.cover_path, 'theme_color', v_shop.theme_color,
                               'languages', v_shop.languages,
                               'order_mode', v_shop.order_mode, 'phone', v_shop.phone,
                               'service_pct', v_shop.service_pct, 'vat_pct', v_shop.vat_pct,
                               'vat_included', v_shop.vat_included, 'shop_type', v_shop.shop_type),
    'table', jsonb_build_object('label', v_tab.label, 'zone', v_tab.zone, 'kind', v_tab.kind),
    'state', v_state,
    'takeaway', case when v_tab.kind = 'hub' then jsonb_build_object('preorder', v_shop.preorder_enabled) end,
    'ticket', v_ticket,
    'confirm', case when v_state in ('open','billing') then v_sess.confirm_status end,
    'session_token', case when v_state in ('open','billing') then v_sess.session_token end,
    'buffet', case when v_state in ('open','billing') then v_sess.buffet end,
    'now', now()
  );
end
$$;

-- จอออร์เดอร์: ไม่แสดงออร์เดอร์ค่าบริการ (ค่าหัวบุฟเฟ่ต์ / ค่าเกินเวลา) (ทับ st-15)
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
    'stations', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by sort, created_at)
                            from public.st_stations where shop_id = p_shop), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(x.j order by x.created_at)
        from (
          select o.created_at,
                 jsonb_build_object(
                   'id', o.id, 'order_no', o.order_no, 'status', o.status, 'source', o.source,
                   'guest_name', o.guest_name, 'note', o.note, 'subtotal', o.subtotal,
                   'created_at', o.created_at, 'updated_at', o.updated_at,
                   'table_id', o.table_id, 'table_label', t.label, 'zone', t.zone,
                   'order_type', s.order_type, 'queue_no', s.queue_no, 'pickup_at', s.pickup_at,
                   'contact_name', s.contact_name,
                   'confirm_pending', s.confirm_status = 'pending',
                   'items', coalesce((
                     select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'qty', i.qty,
                                                         'options', i.options, 'note', i.note,
                                                         'station_id', i.station_id, 'done', i.done_at is not null,
                                                         'image', (select m.image_path from public.st_menu_items m where m.id = i.item_id))
                                      order by i.id)
                       from public.st_order_items i where i.order_id = o.id), '[]'::jsonb)) as j
            from public.st_orders o
            join public.st_tables t on t.id = o.table_id
            join public.st_table_sessions s on s.id = o.session_id
           where o.shop_id = p_shop and not o.is_charge
             and (o.status in ('new','accepted','cooking')
                  or (o.status in ('served','cancelled') and o.updated_at > now() - interval '60 minutes'))
           order by o.created_at desc
           limit 300
        ) x), '[]'::jsonb));
end
$$;

-- ---------- 9) สิทธิ์ ----------
revoke all on function
  public.st_buffet_includes(jsonb, uuid), public.st_buffet_is_staff(uuid),
  public.st_buffet_charge_order(public.st_table_sessions), public.st_buffet_write_heads(public.st_table_sessions),
  public.st_buffet_overtime_calc(jsonb), public.st_orders_buffet_guard(), public.st_order_items_buffet(),
  public.st_order_items_buffet_limit(),
  public.st_save_buffet_package(uuid, jsonb), public.st_delete_buffet_package(uuid),
  public.st_buffet_start(uuid, uuid, int, int), public.st_buffet_extend(uuid, int), public.st_buffet_overtime(uuid),
  public.st_buffet_status(uuid), public.st_buffet_board(uuid)
from public, anon, authenticated;
grant execute on function
  public.st_save_buffet_package(uuid, jsonb), public.st_delete_buffet_package(uuid),
  public.st_buffet_start(uuid, uuid, int, int), public.st_buffet_extend(uuid, int), public.st_buffet_overtime(uuid),
  public.st_buffet_status(uuid), public.st_buffet_board(uuid)
to authenticated;

insert into public.st_schema_log (id) values ('st-17-buffet')
on conflict (id) do update set applied_at = now();
