-- =====================================================================
-- SmartTable · st-12-kitchen.sql  (รันซ้ำได้ · ต้องรัน st-01 ถึง st-11 ก่อน)
-- รอบ D: สถานีครัว/บาร์ + ติ๊กเสร็จรายจาน · สั่งกลับบ้าน / สั่งล่วงหน้า + เลขคิว
--
-- สถานี
-- * ร้านสร้างสถานีได้ถึง 10 จุด (เช่น ครัว บาร์ ของหวาน) แล้วเลือกสถานีให้แต่ละหมวดเมนู
-- * หมวดที่ไม่ได้เลือก = ไปสถานีแรก (ลำดับบนสุด) · จานจำสถานีไว้ตอนสั่ง (ย้ายหมวดทีหลังไม่กระทบออร์เดอร์เก่า)
-- * ติ๊กเสร็จทีละจาน · ครบทุกจาน = ออร์เดอร์ "เสร็จแล้ว" เอง · กด "เสิร์ฟแล้ว" ทั้งออร์เดอร์ = ติ๊กทุกจานให้เอง
--
-- สั่งกลับบ้าน
-- * ร้านมี QR / ลิงก์ "สั่งกลับบ้าน" 1 อัน (โต๊ะชนิด hub ซ่อนจากผังโต๊ะ)
-- * ลูกค้าสั่งครั้งแรก -> ระบบสร้าง "บัตรคิว" (โต๊ะชนิด ticket ซ่อนจากผังโต๊ะ) + เลขคิวรายวัน
--   หลังจากนั้นทุกอย่างเหมือนนั่งโต๊ะ: สั่งเพิ่ม ดูสถานะ จ่ายเอง แยกบิล ใบเสร็จ
-- * จ่ายครบแล้วบัตรคิวยังเปิดอยู่ จนพนักงานกด "รับของแล้ว" · อาหารเสร็จครบ = "พร้อมรับ" ให้เอง
-- * ไฟล์นี้ทับ st_scan, st_order_board, st_orders_json, st_tables_board, st_save_table, st_add_tables
--   ถ้ารันไฟล์เก่าซ้ำ ให้รันไฟล์นี้ซ้ำด้วย
-- =====================================================================

-- ---------- 1) สถานี ----------
create table if not exists public.st_stations (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.st_shops(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 30),
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (id, shop_id)
);
create unique index if not exists st_stations_name_key on public.st_stations (shop_id, lower(name));
alter table public.st_stations enable row level security;
drop policy if exists st_stations_select_member on public.st_stations;
create policy st_stations_select_member on public.st_stations
  for select to authenticated using (public.st_has_shop_role(shop_id));
revoke all on public.st_stations from anon, authenticated;
grant select on public.st_stations to authenticated;

alter table public.st_categories add column if not exists station_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'st_categories_station_fkey') then
    alter table public.st_categories add constraint st_categories_station_fkey
      foreign key (station_id, shop_id) references public.st_stations (id, shop_id) on delete set null (station_id);
  end if;
end
$$;

alter table public.st_order_items add column if not exists station_id uuid;
alter table public.st_order_items add column if not exists done_at timestamptz;
alter table public.st_order_items add column if not exists done_by_user_id uuid references auth.users(id) on delete set null;

-- สร้าง / แก้ชื่อ / ลำดับ (เจ้าของ / ผู้จัดการ)
create or replace function public.st_save_station(p_shop uuid, p_id uuid, p_name text, p_sort int default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_id   uuid := p_id;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if char_length(v_name) not between 1 and 30 then raise exception 'st_bad_request'; end if;
  if exists (select 1 from public.st_stations
              where shop_id = p_shop and lower(name) = lower(v_name) and id is distinct from v_id) then
    raise exception 'st_station_taken';
  end if;
  if v_id is null then
    if (select count(*) from public.st_stations where shop_id = p_shop) >= 10 then raise exception 'st_station_limit'; end if;
    insert into public.st_stations (shop_id, name, sort)
    values (p_shop, v_name, coalesce(p_sort, (select coalesce(max(sort), 0) + 1 from public.st_stations where shop_id = p_shop)))
    returning id into v_id;
  else
    update public.st_stations set name = v_name, sort = coalesce(p_sort, sort) where id = v_id and shop_id = p_shop;
    if not found then raise exception 'st_not_found'; end if;
  end if;
  return v_id;
end
$$;

create or replace function public.st_delete_station(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_stations where id = p_id;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  update public.st_order_items set station_id = null where station_id = p_id;
  delete from public.st_stations where id = p_id;      -- หมวดที่ใช้สถานีนี้ = กลับเป็น "สถานีแรก"
end
$$;

create or replace function public.st_set_category_station(p_category uuid, p_station uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_categories where id = p_category;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_station is not null and not exists (select 1 from public.st_stations where id = p_station and shop_id = v_shop) then
    raise exception 'st_not_found';
  end if;
  update public.st_categories set station_id = p_station where id = p_category;
end
$$;

-- จานจำสถานีตอนสั่ง
create or replace function public.st_order_items_station()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.station_id is null then
    new.station_id := coalesce(
      (select c.station_id from public.st_menu_items m join public.st_categories c on c.id = m.category_id
        where m.id = new.item_id),
      (select s.id from public.st_stations s where s.shop_id = new.shop_id order by s.sort, s.created_at limit 1));
  end if;
  return new;
end
$$;
drop trigger if exists st_order_items_station on public.st_order_items;
create trigger st_order_items_station
  before insert on public.st_order_items
  for each row execute function public.st_order_items_station();

-- ติ๊กเสร็จ / ยกเลิกติ๊ก รายจาน (ทุกตำแหน่งรวมครัว)
-- ครบทุกจาน -> ออร์เดอร์ served · ติ๊กจานแรก -> cooking · เอาติ๊กออกจากออร์เดอร์ที่เสร็จแล้ว -> cooking
create or replace function public.st_set_items_done(p_items uuid[], p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop  uuid;
  v_n     int;
  r       record;
  v_new   text;
begin
  if p_items is null or cardinality(p_items) not between 1 and 100 then raise exception 'st_bad_request'; end if;
  select min(shop_id::text)::uuid, count(distinct shop_id) into v_shop, v_n
    from public.st_order_items where id = any(p_items);
  if v_n <> 1 then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop) then raise exception 'st_forbidden'; end if;

  update public.st_order_items i
     set done_at = case when p_done then coalesce(i.done_at, now()) end,
         done_by_user_id = case when p_done then coalesce(i.done_by_user_id, auth.uid()) end
   where i.id = any(p_items)
     and exists (select 1 from public.st_orders o where o.id = i.order_id and o.status <> 'cancelled');

  for r in
    select o.id, o.status,
           bool_and(i.done_at is not null) as all_done,
           bool_or(i.done_at is not null)  as any_done
      from public.st_orders o
      join public.st_order_items i on i.order_id = o.id
     where o.id in (select order_id from public.st_order_items where id = any(p_items))
       and o.status <> 'cancelled'
     group by o.id, o.status
  loop
    v_new := case
      when r.all_done then 'served'
      when r.status = 'served' then 'cooking'
      when r.any_done and r.status in ('new','accepted') then 'cooking'
      else r.status end;
    if v_new <> r.status then
      update public.st_orders set status = v_new, status_by_user_id = auth.uid() where id = r.id;
    else
      update public.st_orders set updated_at = now() where id = r.id;   -- ให้จออื่นรู้ผ่าน Realtime
    end if;
  end loop;
end
$$;

-- กด "เสิร์ฟแล้ว" ทั้งออร์เดอร์ = ติ๊กทุกจาน
create or replace function public.st_orders_served_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.st_order_items set done_at = now(), done_by_user_id = coalesce(done_by_user_id, auth.uid())
   where order_id = new.id and done_at is null;
  return new;
end
$$;
drop trigger if exists st_orders_served_items on public.st_orders;
create trigger st_orders_served_items
  after update of status on public.st_orders
  for each row when (new.status = 'served' and old.status <> 'served')
  execute function public.st_orders_served_items();

-- ---------- 2) สั่งกลับบ้าน: ตั้งค่า + ชนิดโต๊ะ + ข้อมูลบัตรคิว ----------
alter table public.st_shops add column if not exists takeaway_enabled boolean not null default false;
alter table public.st_shops add column if not exists preorder_enabled boolean not null default false;

alter table public.st_tables add column if not exists kind text not null default 'dine';
alter table public.st_tables drop constraint if exists st_tables_kind_check;
alter table public.st_tables add constraint st_tables_kind_check check (kind in ('dine','hub','ticket'));
create unique index if not exists st_tables_one_hub on public.st_tables (shop_id) where kind = 'hub';

alter table public.st_table_sessions add column if not exists order_type text not null default 'dine';
alter table public.st_table_sessions drop constraint if exists st_table_sessions_order_type_check;
alter table public.st_table_sessions add constraint st_table_sessions_order_type_check check (order_type in ('dine','takeaway'));
alter table public.st_table_sessions add column if not exists queue_no smallint;
alter table public.st_table_sessions add column if not exists pickup_at timestamptz;     -- null = เร็วที่สุด
alter table public.st_table_sessions add column if not exists contact_name text;
alter table public.st_table_sessions drop constraint if exists st_table_sessions_contact_name_check;
alter table public.st_table_sessions add constraint st_table_sessions_contact_name_check
  check (contact_name is null or char_length(contact_name) <= 40);
alter table public.st_table_sessions add column if not exists contact_phone text;
alter table public.st_table_sessions drop constraint if exists st_table_sessions_contact_phone_check;
alter table public.st_table_sessions add constraint st_table_sessions_contact_phone_check
  check (contact_phone is null or contact_phone ~ '^\+?[0-9]{9,15}$');
alter table public.st_table_sessions add column if not exists ready_at timestamptz;
alter table public.st_table_sessions add column if not exists paid_at timestamptz;
alter table public.st_table_sessions add column if not exists picked_up_at timestamptz;
alter table public.st_table_sessions drop constraint if exists st_table_sessions_opened_via_check;
alter table public.st_table_sessions add constraint st_table_sessions_opened_via_check
  check (opened_via in ('staff','auto','takeaway'));
create index if not exists st_table_sessions_takeaway_idx
  on public.st_table_sessions (shop_id, opened_at desc) where order_type = 'takeaway';

-- ---------- 3) กันใช้ผิดชนิด ----------
-- เปิดรอบบนโต๊ะ hub ไม่ได้ · บัตรคิวเปิดได้เฉพาะตอนสร้างคิว (เปิดซ้ำหลังปิดไม่ได้)
create or replace function public.st_sessions_kind_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_kind text;
begin
  select kind into v_kind from public.st_tables where id = new.table_id;
  if tg_op = 'INSERT' then
    if v_kind = 'hub' or (v_kind = 'ticket' and coalesce(current_setting('st.ticket_ok', true), '') <> 'on') then
      raise exception 'st_takeaway_table';
    end if;
  elsif new.table_id <> old.table_id then                    -- ย้ายโต๊ะ
    if v_kind <> 'dine' or (select kind from public.st_tables where id = old.table_id) <> 'dine' then
      raise exception 'st_takeaway_table';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists st_sessions_kind_guard on public.st_table_sessions;
create trigger st_sessions_kind_guard
  before insert or update of table_id on public.st_table_sessions
  for each row execute function public.st_sessions_kind_guard();

-- รวมโต๊ะ (ย้ายออร์เดอร์ข้ามโต๊ะ) กับบัตรคิวไม่ได้
create or replace function public.st_orders_kind_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.table_id <> old.table_id
     and ((select kind from public.st_tables where id = new.table_id) <> 'dine'
          or (select kind from public.st_tables where id = old.table_id) <> 'dine') then
    raise exception 'st_takeaway_table';
  end if;
  return new;
end
$$;
drop trigger if exists st_orders_kind_guard on public.st_orders;
create trigger st_orders_kind_guard
  before update of table_id on public.st_orders
  for each row execute function public.st_orders_kind_guard();

-- บัตรคิวที่จ่ายครบแล้ว: ยังไม่ปิด (รอรับของ) · ปิดจริงเมื่อกด "รับของแล้ว" หรือระบบปิดรอบค้างอัตโนมัติ
create or replace function public.st_sessions_takeaway_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_type = 'takeaway' and new.status = 'closed' and old.status <> 'closed'
     and auth.uid() is not null
     and coalesce(current_setting('st.close_ok', true), '') <> 'on'
     and exists (select 1 from public.st_payments where session_id = new.id and status = 'paid')
     and (public.st_session_money(new.id) ->> 'remaining')::numeric <= 0 then
    new.status := 'billing';
    new.closed_at := null;
    new.closed_by_user_id := null;
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  return new;
end
$$;
drop trigger if exists st_sessions_takeaway_hold on public.st_table_sessions;
create trigger st_sessions_takeaway_hold
  before update of status on public.st_table_sessions
  for each row execute function public.st_sessions_takeaway_hold();

-- อาหารของบัตรคิวเสร็จครบ = พร้อมรับ · มีออร์เดอร์ใหม่ / ย้อนกลับไปทำ = ยังไม่พร้อม
create or replace function public.st_orders_takeaway_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.st_table_sessions
                  where id = new.session_id and order_type = 'takeaway' and status <> 'closed') then
    return new;
  end if;
  if exists (select 1 from public.st_orders where session_id = new.session_id and status in ('new','accepted','cooking')) then
    update public.st_table_sessions set ready_at = null where id = new.session_id and ready_at is not null;
  elsif exists (select 1 from public.st_orders where session_id = new.session_id and status = 'served') then
    update public.st_table_sessions set ready_at = now() where id = new.session_id and ready_at is null;
  end if;
  return new;
end
$$;
drop trigger if exists st_orders_takeaway_ready on public.st_orders;
create trigger st_orders_takeaway_ready
  after insert or update of status on public.st_orders
  for each row execute function public.st_orders_takeaway_ready();

-- ---------- 4) ทับ st-04: ผังโต๊ะ / จำนวนโต๊ะ นับเฉพาะโต๊ะนั่งทาน ----------
create or replace function public.st_tables_board(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop) then raise exception 'st_forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'label', t.label, 'zone', t.zone, 'seats', t.seats,
             'qr_token', t.qr_token, 'is_active', t.is_active,
             'session', case when s.id is null then null else jsonb_build_object(
                          'id', s.id, 'status', s.status, 'guest_count', s.guest_count,
                          'opened_via', s.opened_via, 'opened_at', s.opened_at,
                          'last_activity_at', s.last_activity_at) end)
           order by t.zone nulls first, length(t.label), t.label)
      from public.st_tables t
      left join public.st_table_sessions s on s.table_id = t.id and s.status <> 'closed'
     where t.shop_id = p_shop and t.kind = 'dine'), '[]'::jsonb);
end
$$;

create or replace function public.st_save_table(p_shop uuid, p_id uuid, p_label text, p_zone text,
                                                p_seats int, p_active boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := trim(p_label);
  v_zone  text := nullif(trim(coalesce(p_zone, '')), '');
  v_id    uuid := p_id;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if v_label is null or char_length(v_label) not between 1 and 20 then raise exception 'st_bad_table_label'; end if;
  if v_zone is not null and char_length(v_zone) > 40 then raise exception 'st_bad_request'; end if;
  if coalesce(p_seats, 4) not between 1 and 50 then raise exception 'st_bad_request'; end if;
  if exists (select 1 from public.st_tables
              where shop_id = p_shop and lower(label) = lower(v_label) and id is distinct from v_id) then
    raise exception 'st_table_label_taken';
  end if;

  if v_id is null then
    if (select count(*) from public.st_tables where shop_id = p_shop and kind = 'dine') >= 200 then raise exception 'st_table_limit'; end if;
    insert into public.st_tables (shop_id, label, zone, seats, is_active)
    values (p_shop, v_label, v_zone, coalesce(p_seats, 4), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.st_tables
       set label = v_label, zone = v_zone, seats = coalesce(p_seats, 4), is_active = coalesce(p_active, true)
     where id = v_id and shop_id = p_shop and kind = 'dine';
    if not found then raise exception 'st_not_found'; end if;
  end if;
  return v_id;
end
$$;

create or replace function public.st_add_tables(p_shop uuid, p_prefix text, p_from int, p_to int,
                                                p_zone text default null, p_seats int default 4)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := coalesce(trim(p_prefix), '');
  v_zone   text := nullif(trim(coalesce(p_zone, '')), '');
  v_count  int := 0;
  v_label  text;
  i        int;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_from is null or p_to is null or p_from < 0 or p_to < p_from or p_to - p_from >= 100 then
    raise exception 'st_bad_table_range';
  end if;
  if coalesce(p_seats, 4) not between 1 and 50 or (v_zone is not null and char_length(v_zone) > 40) then
    raise exception 'st_bad_request';
  end if;
  if (select count(*) from public.st_tables where shop_id = p_shop and kind = 'dine') + (p_to - p_from + 1) > 200 then
    raise exception 'st_table_limit';
  end if;

  for i in p_from .. p_to loop
    v_label := left(v_prefix || i::text, 20);
    if not exists (select 1 from public.st_tables where shop_id = p_shop and lower(label) = lower(v_label)) then
      insert into public.st_tables (shop_id, label, zone, seats) values (p_shop, v_label, v_zone, coalesce(p_seats, 4));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end
$$;

-- ---------- 5) ภายใน: สร้างบัตรคิว (โต๊ะ ticket + รอบ + เลขคิวรายวัน) ----------
create or replace function public.st_new_ticket(p_shop uuid, p_name text, p_phone text, p_pickup timestamptz, p_via text)
returns public.st_tables
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day   date := (now() at time zone 'Asia/Bangkok')::date;
  v_no    int;
  v_label text;
  v_tab   public.st_tables;
begin
  perform pg_advisory_xact_lock(hashtext('st_queue:' || p_shop::text));
  select coalesce(max(queue_no), 0) + 1 into v_no
    from public.st_table_sessions
   where shop_id = p_shop and order_type = 'takeaway'
     and opened_at >= (v_day::timestamp at time zone 'Asia/Bangkok');
  if v_no > 999 then raise exception 'st_queue_full'; end if;

  v_label := 'คิว ' || v_no || ' (' || to_char(v_day, 'DD/MM') || ')';
  if exists (select 1 from public.st_tables where shop_id = p_shop and lower(label) = lower(v_label)) then
    v_label := 'คิว ' || v_no || ' (' || to_char(v_day, 'DD/MM/YY') || ')';
  end if;
  if exists (select 1 from public.st_tables where shop_id = p_shop and lower(label) = lower(v_label)) then
    v_label := left('คิว ' || v_no || '-' || substr(md5(random()::text), 1, 5), 20);
  end if;

  insert into public.st_tables (shop_id, label, seats, kind) values (p_shop, v_label, 1, 'ticket') returning * into v_tab;
  perform set_config('st.ticket_ok', 'on', true);
  insert into public.st_table_sessions (shop_id, table_id, opened_via, opened_by_user_id, order_type,
                                        queue_no, pickup_at, contact_name, contact_phone)
  values (p_shop, v_tab.id, p_via, auth.uid(), 'takeaway', v_no, p_pickup, p_name, p_phone);
  perform set_config('st.ticket_ok', 'off', true);
  return v_tab;
end
$$;

-- ตรวจชื่อ / เบอร์ / เวลารับ (ใช้ภายใน)
create or replace function public.st_ticket_contact(p_shop uuid, p_name text, p_phone text, p_pickup timestamptz,
                                                    p_name_required boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name  text := nullif(trim(coalesce(p_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_pre   boolean;
begin
  if (v_name is null and p_name_required) or char_length(coalesce(v_name, '')) > 40 then raise exception 'st_bad_contact'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{9,15}$' then raise exception 'st_bad_contact'; end if;
  if p_pickup is not null then
    select preorder_enabled into v_pre from public.st_shops where id = p_shop;
    if not v_pre and p_name_required then raise exception 'st_preorder_off'; end if;
    if p_pickup < now() + interval '5 minutes' or p_pickup > now() + interval '7 days' then raise exception 'st_bad_pickup'; end if;
  end if;
  return jsonb_build_object('name', v_name, 'phone', v_phone);
end
$$;

-- ---------- 6) RPC ลูกค้า (ไม่ต้องล็อกอิน) ----------
-- สั่งกลับบ้านครั้งแรกจาก QR/ลิงก์ของร้าน -> สร้างบัตรคิว + ออร์เดอร์แรก
-- เวลารับ: null = เร็วที่สุด · ล่วงหน้าได้ 10 นาที – 24 ชั่วโมง (ร้านต้องเปิดสั่งล่วงหน้า)
create or replace function public.st_takeaway_order(p_hub_qr text, p_items jsonb, p_name text, p_phone text default null,
                                                    p_pickup_at timestamptz default null, p_note text default null,
                                                    p_client_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hub    public.st_tables;
  sh     public.st_shops;
  v_ref  text := nullif(trim(coalesce(p_client_ref, '')), '');
  c      jsonb;
  v_tab  public.st_tables;
  v_sess public.st_table_sessions;
  v_res  jsonb;
  r      record;
begin
  select * into hub from public.st_tables where qr_token = p_hub_qr and kind = 'hub';
  if hub.id is null or not hub.is_active then raise exception 'st_table_not_found'; end if;
  select * into sh from public.st_shops where id = hub.shop_id;
  if sh.status <> 'active' then raise exception 'st_table_not_found'; end if;
  if not sh.is_open then raise exception 'st_shop_closed'; end if;
  if not sh.takeaway_enabled then raise exception 'st_takeaway_off'; end if;

  -- ส่งซ้ำด้วยรหัสเดิม = ได้บัตรคิวเดิมกลับ
  if v_ref is not null then
    select t.qr_token, s.session_token, s.queue_no, o.id as order_id, o.order_no, o.subtotal into r
      from public.st_orders o
      join public.st_table_sessions s on s.id = o.session_id and s.order_type = 'takeaway'
      join public.st_tables t on t.id = s.table_id
     where o.shop_id = sh.id and o.client_ref = v_ref and o.created_at > now() - interval '1 day'
     limit 1;
    if r.qr_token is not null then
      return jsonb_build_object('order_id', r.order_id, 'order_no', r.order_no, 'subtotal', r.subtotal,
                                'qr_token', r.qr_token, 'session_token', r.session_token, 'queue_no', r.queue_no);
    end if;
  end if;

  if p_pickup_at is not null and (p_pickup_at < now() + interval '10 minutes' or p_pickup_at > now() + interval '24 hours') then
    raise exception 'st_bad_pickup';
  end if;
  c := public.st_ticket_contact(sh.id, p_name, p_phone, p_pickup_at, true);
  if (select count(*) from public.st_table_sessions
       where shop_id = sh.id and order_type = 'takeaway' and status <> 'closed') >= 150 then
    raise exception 'st_queue_full';
  end if;

  v_tab := public.st_new_ticket(sh.id, c ->> 'name', c ->> 'phone', p_pickup_at, 'takeaway');
  select * into v_sess from public.st_table_sessions where table_id = v_tab.id and status <> 'closed';
  v_res := public.st_place_order(v_tab.qr_token, v_sess.session_token, p_items, p_note, c ->> 'name', v_ref);
  return v_res || jsonb_build_object('qr_token', v_tab.qr_token, 'session_token', v_sess.session_token,
                                     'queue_no', v_sess.queue_no);
end
$$;

-- จอเรียกคิว (ทีวีหน้าร้าน) · แสดงเฉพาะเลขคิว ไม่มีชื่อ
create or replace function public.st_public_queue(p_hub_qr text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  hub public.st_tables;
  sh  public.st_shops;
begin
  select * into hub from public.st_tables where qr_token = p_hub_qr and kind = 'hub';
  if hub.id is null or not hub.is_active then raise exception 'st_table_not_found'; end if;
  select * into sh from public.st_shops where id = hub.shop_id;
  if sh.status <> 'active' then raise exception 'st_table_not_found'; end if;
  return jsonb_build_object(
    'shop', jsonb_build_object('name', sh.name, 'logo_path', sh.logo_path, 'theme_color', sh.theme_color, 'is_open', sh.is_open),
    'now', now(),
    'ready', coalesce((select jsonb_agg(s.queue_no order by s.ready_at)
                         from public.st_table_sessions s
                        where s.shop_id = sh.id and s.order_type = 'takeaway' and s.status <> 'closed'
                          and s.ready_at is not null), '[]'::jsonb),
    'preparing', coalesce((select jsonb_agg(s.queue_no order by s.opened_at)
                             from public.st_table_sessions s
                            where s.shop_id = sh.id and s.order_type = 'takeaway' and s.status <> 'closed'
                              and s.ready_at is null
                              and (s.pickup_at is null or s.pickup_at < now() + interval '45 minutes')
                              and exists (select 1 from public.st_orders o
                                           where o.session_id = s.id and o.status <> 'cancelled')), '[]'::jsonb));
end
$$;

-- ---------- 7) ทับ st-10: หน้าสแกน รู้จัก QR สั่งกลับบ้าน และบัตรคิว ----------
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
  end if;

  return jsonb_build_object(
    'shop', jsonb_build_object('id', v_shop.id, 'name', v_shop.name, 'logo_path', v_shop.logo_path,
                               'cover_path', v_shop.cover_path, 'theme_color', v_shop.theme_color,
                               'languages', v_shop.languages,
                               'order_mode', v_shop.order_mode, 'phone', v_shop.phone,
                               'service_pct', v_shop.service_pct, 'vat_pct', v_shop.vat_pct,
                               'vat_included', v_shop.vat_included),
    'table', jsonb_build_object('label', v_tab.label, 'zone', v_tab.zone, 'kind', v_tab.kind),
    'state', v_state,
    'takeaway', case when v_tab.kind = 'hub' then jsonb_build_object('preorder', v_shop.preorder_enabled) end,
    'ticket', v_ticket,
    'session_token', case when v_state in ('open','billing') then v_sess.session_token end
  );
end
$$;

-- ---------- 8) RPC พนักงาน: คิวกลับบ้าน ----------
-- เปิด/ปิดรับสั่งกลับบ้าน + สั่งล่วงหน้า · สร้าง QR สั่งกลับบ้านให้ครั้งแรก
create or replace function public.st_takeaway_settings(p_shop uuid, p_enabled boolean, p_preorder boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_qr text;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  update public.st_shops set takeaway_enabled = coalesce(p_enabled, false), preorder_enabled = coalesce(p_preorder, false)
   where id = p_shop;
  select qr_token into v_qr from public.st_tables where shop_id = p_shop and kind = 'hub';
  if v_qr is null then
    insert into public.st_tables (shop_id, label, seats, kind)
    values (p_shop, '#สั่งกลับบ้าน-' || substr(md5(p_shop::text), 1, 6), 1, 'hub')
    returning qr_token into v_qr;
  end if;
  return v_qr;
end
$$;

-- รายการคิว: ที่ยังไม่ปิด + ที่ปิดใน 2 ชั่วโมงล่าสุด
create or replace function public.st_queue_board(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare sh public.st_shops;
begin
  if not public.st_has_shop_role(p_shop) then raise exception 'st_forbidden'; end if;
  select * into sh from public.st_shops where id = p_shop;
  return jsonb_build_object(
    'now', now(),
    'takeaway_enabled', sh.takeaway_enabled, 'preorder_enabled', sh.preorder_enabled,
    'hub', (select jsonb_build_object('id', t.id, 'qr_token', t.qr_token) from public.st_tables t
             where t.shop_id = p_shop and t.kind = 'hub'),
    'tickets', coalesce((
      select jsonb_agg(x.j order by x.closed, x.k)
        from (
          select s.status = 'closed' as closed,
                 case when s.status = 'closed' then -extract(epoch from s.closed_at)
                      else extract(epoch from coalesce(s.pickup_at, s.opened_at)) end as k,
                 jsonb_build_object(
                   'table_id', t.id, 'qr_token', t.qr_token, 'label', t.label,
                   'queue_no', s.queue_no, 'status', s.status, 'opened_via', s.opened_via,
                   'contact_name', s.contact_name, 'contact_phone', s.contact_phone,
                   'pickup_at', s.pickup_at, 'ready_at', s.ready_at, 'paid_at', s.paid_at,
                   'picked_up_at', s.picked_up_at, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
                   'orders', (select count(*) from public.st_orders o where o.session_id = s.id and o.status <> 'cancelled'),
                   'unfinished', (select count(*) from public.st_orders o
                                   where o.session_id = s.id and o.status in ('new','accepted','cooking')),
                   'items', coalesce((select jsonb_agg(jsonb_build_object('name', z.name, 'qty', z.qty) order by z.first)
                                        from (select i.name, sum(i.qty) as qty, min(i.id::text) as first
                                                from public.st_order_items i
                                                join public.st_orders o on o.id = i.order_id and o.status <> 'cancelled'
                                               where o.session_id = s.id group by i.name) z), '[]'::jsonb),
                   'money', public.st_session_money(s.id),
                   'due', (public.st_bill_part(p_shop, (public.st_session_money(s.id) ->> 'remaining')::numeric, 0) ->> 'total')::numeric,
                   'slip_pending', exists (select 1 from public.st_pay_requests r where r.session_id = s.id and r.status = 'pending')
                 ) as j
            from public.st_table_sessions s
            join public.st_tables t on t.id = s.table_id
           where s.shop_id = p_shop and s.order_type = 'takeaway'
             and (s.status <> 'closed' or s.closed_at > now() - interval '2 hours')
           limit 300
        ) x), '[]'::jsonb));
end
$$;

-- พนักงานรับออร์เดอร์กลับบ้านหน้าร้าน / ทางโทรศัพท์ -> ได้บัตรคิว แล้วสั่งต่อในโหมดพนักงาน
create or replace function public.st_takeaway_new(p_shop uuid, p_name text default null, p_phone text default null,
                                                  p_pickup_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c     jsonb;
  v_tab public.st_tables;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  c := public.st_ticket_contact(p_shop, p_name, p_phone, p_pickup_at, false);
  v_tab := public.st_new_ticket(p_shop, coalesce(c ->> 'name', 'หน้าร้าน'), c ->> 'phone', p_pickup_at, 'staff');
  return jsonb_build_object('table_id', v_tab.id, 'qr_token', v_tab.qr_token,
                            'queue_no', (select queue_no from public.st_table_sessions where table_id = v_tab.id));
end
$$;

-- ตั้ง / ยกเลิก "พร้อมรับ" เอง (ปกติระบบตั้งให้เมื่ออาหารเสร็จครบ)
create or replace function public.st_takeaway_ready(p_table uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_tables where id = p_table and kind = 'ticket';
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop) then raise exception 'st_forbidden'; end if;
  update public.st_table_sessions
     set ready_at = case when p_ready then coalesce(ready_at, now()) end, last_activity_at = now()
   where table_id = p_table and status <> 'closed';
  if not found then raise exception 'st_table_not_open'; end if;
end
$$;

-- ปิดบัตรคิว: 'pickup' = ลูกค้ารับของแล้ว (ต้องจ่ายครบ) · 'force' = ปิดทั้งที่ยังไม่จ่ายครบ (บันทึกประวัติ)
--             'cancel' = ยกเลิกคิว (ยกเลิกทุกออร์เดอร์ · ต้องยังไม่มีใบเสร็จ)
create or replace function public.st_takeaway_close(p_table uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  s      public.st_table_sessions;
  v_paid boolean;
begin
  select shop_id into v_shop from public.st_tables where id = p_table and kind = 'ticket';
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  if p_mode not in ('pickup','force','cancel') then raise exception 'st_bad_request'; end if;
  select * into s from public.st_table_sessions where table_id = p_table and status <> 'closed' for update;
  if s.id is null then raise exception 'st_table_not_open'; end if;

  v_paid := (public.st_session_money(s.id) ->> 'remaining')::numeric <= 0;
  if p_mode = 'pickup' and not v_paid then raise exception 'st_not_paid'; end if;
  if p_mode = 'cancel' then
    if exists (select 1 from public.st_payments where session_id = s.id and status = 'paid') then
      raise exception 'st_partly_paid';
    end if;
    update public.st_orders set status = 'cancelled', status_by_user_id = auth.uid()
     where session_id = s.id and status <> 'cancelled';
  end if;

  perform set_config('st.close_ok', 'on', true);
  update public.st_table_sessions
     set status = 'closed', closed_at = now(), closed_by_user_id = auth.uid(),
         picked_up_at = case when p_mode = 'cancel' then null else now() end
   where id = s.id;
  perform set_config('st.close_ok', 'off', true);
  update public.st_service_calls set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
   where session_id = s.id and status = 'pending';
  update public.st_pay_requests set status = 'cancelled', handled_at = now()
   where session_id = s.id and status in ('draft','pending');
end
$$;

-- ---------- 9) ทับ st-06: กระดานออร์เดอร์ (สถานี + ติ๊กรายจาน + คิวกลับบ้าน) ----------
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
                   'items', coalesce((
                     select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'qty', i.qty,
                                                         'options', i.options, 'note', i.note,
                                                         'station_id', i.station_id, 'done', i.done_at is not null)
                                      order by i.id)
                       from public.st_order_items i where i.order_id = o.id), '[]'::jsonb)) as j
            from public.st_orders o
            join public.st_tables t on t.id = o.table_id
            join public.st_table_sessions s on s.id = o.session_id
           where o.shop_id = p_shop
             and (o.status in ('new','accepted','cooking')
                  or (o.status in ('served','cancelled') and o.updated_at > now() - interval '60 minutes'))
           order by o.created_at desc
           limit 300
        ) x), '[]'::jsonb));
end
$$;

-- ทับ st-05: ลูกค้าเห็นว่าจานไหนเสร็จแล้ว
create or replace function public.st_orders_json(p_session uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'order_no', o.order_no, 'status', o.status, 'source', o.source,
           'guest_name', o.guest_name, 'note', o.note, 'subtotal', o.subtotal, 'created_at', o.created_at,
           'items', coalesce((
             select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'unit_price', i.unit_price,
                                                 'options', i.options, 'note', i.note, 'line_total', i.line_total,
                                                 'done', i.done_at is not null)
                              order by i.id)
               from public.st_order_items i where i.order_id = o.id), '[]'::jsonb))
         order by o.created_at), '[]'::jsonb)
    from public.st_orders o where o.session_id = p_session;
$$;

-- ---------- 10) สิทธิ์เรียกฟังก์ชัน ----------
revoke all on function
  public.st_save_station(uuid, uuid, text, int), public.st_delete_station(uuid),
  public.st_set_category_station(uuid, uuid), public.st_order_items_station(), public.st_set_items_done(uuid[], boolean),
  public.st_orders_served_items(), public.st_sessions_kind_guard(), public.st_orders_kind_guard(),
  public.st_sessions_takeaway_hold(), public.st_orders_takeaway_ready(),
  public.st_new_ticket(uuid, text, text, timestamptz, text), public.st_ticket_contact(uuid, text, text, timestamptz, boolean),
  public.st_takeaway_order(text, jsonb, text, text, timestamptz, text, text), public.st_public_queue(text),
  public.st_takeaway_settings(uuid, boolean, boolean), public.st_queue_board(uuid),
  public.st_takeaway_new(uuid, text, text, timestamptz), public.st_takeaway_ready(uuid, boolean),
  public.st_takeaway_close(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.st_save_station(uuid, uuid, text, int), public.st_delete_station(uuid),
  public.st_set_category_station(uuid, uuid), public.st_set_items_done(uuid[], boolean),
  public.st_takeaway_settings(uuid, boolean, boolean), public.st_queue_board(uuid),
  public.st_takeaway_new(uuid, text, text, timestamptz), public.st_takeaway_ready(uuid, boolean),
  public.st_takeaway_close(uuid, text)
to authenticated;
grant execute on function
  public.st_takeaway_order(text, jsonb, text, text, timestamptz, text, text), public.st_public_queue(text)
to anon, authenticated;
-- st_scan / st_order_board / st_orders_json / st_tables_board / st_save_table / st_add_tables ใช้สิทธิ์เดิม

-- ---------- 11) บันทึกว่ารันไฟล์นี้แล้ว ----------
insert into public.st_schema_log (id) values ('st-12-kitchen')
on conflict (id) do update set applied_at = now();
