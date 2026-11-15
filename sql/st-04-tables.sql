-- =====================================================================
-- SmartTable · st-04-tables.sql  (รันซ้ำได้ · ต้องรัน st-01 ถึง st-03 ก่อน)
-- โต๊ะ, QR, รอบการนั่ง (เปิด/เช็กบิล/ปิดโต๊ะ), หน้าสแกนของลูกค้า
--
-- รูปแบบการสั่ง (st_shops.order_mode):
--   'staff_open' : ลูกค้าสแกนแล้วดูเมนูได้ สั่งได้เมื่อพนักงานเปิดโต๊ะแล้ว
--   'instant'    : ลูกค้าสแกนแล้วระบบเปิดโต๊ะให้เอง
-- ปิดรอบอัตโนมัติ: เปิดเอง (auto) เงียบเกิน 3 ชม. / พนักงานเปิด เงียบเกิน 12 ชม.
-- =====================================================================

-- ---------- 1) ตาราง ----------
create table if not exists public.st_tables (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.st_shops(id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 20),
  zone        text check (zone is null or char_length(zone) between 1 and 40),
  seats       smallint not null default 4 check (seats between 1 and 50),
  qr_token    text not null unique
              default replace(gen_random_uuid()::text, '-', ''),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (id, shop_id)
);
create unique index if not exists st_tables_label_key on public.st_tables (shop_id, lower(label));

create table if not exists public.st_table_sessions (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null,
  table_id           uuid not null,
  status             text not null default 'open' check (status in ('open','billing','closed')),
  session_token      text not null unique
                     default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  guest_count        smallint check (guest_count is null or guest_count between 1 and 99),
  opened_via         text not null default 'staff' check (opened_via in ('staff','auto')),
  opened_by_user_id  uuid references auth.users(id) on delete set null,
  closed_by_user_id  uuid references auth.users(id) on delete set null,
  opened_at          timestamptz not null default now(),
  closed_at          timestamptz,
  last_activity_at   timestamptz not null default now(),
  unique (id, shop_id),
  foreign key (table_id, shop_id) references public.st_tables (id, shop_id) on delete cascade
);
-- โต๊ะหนึ่งมีรอบที่ยังไม่ปิดได้แค่รอบเดียว
create unique index if not exists st_table_sessions_one_active
  on public.st_table_sessions (table_id) where status <> 'closed';
create index if not exists st_table_sessions_shop_idx on public.st_table_sessions (shop_id, status);

-- ---------- 2) RLS: สมาชิกร้านอ่านได้ · เขียนผ่าน RPC ----------
alter table public.st_tables         enable row level security;
alter table public.st_table_sessions enable row level security;

drop policy if exists st_tables_select_member on public.st_tables;
create policy st_tables_select_member on public.st_tables
  for select to authenticated using (public.st_has_shop_role(shop_id));

drop policy if exists st_table_sessions_select_member on public.st_table_sessions;
create policy st_table_sessions_select_member on public.st_table_sessions
  for select to authenticated using (public.st_has_shop_role(shop_id));

revoke all on public.st_tables, public.st_table_sessions from anon, authenticated;
grant select on public.st_tables, public.st_table_sessions to authenticated;

-- ---------- 3) RPC: จัดการโต๊ะ (เจ้าของ / ผู้จัดการ) ----------
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
    if (select count(*) from public.st_tables where shop_id = p_shop) >= 200 then raise exception 'st_table_limit'; end if;
    insert into public.st_tables (shop_id, label, zone, seats, is_active)
    values (p_shop, v_label, v_zone, coalesce(p_seats, 4), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.st_tables
       set label = v_label, zone = v_zone, seats = coalesce(p_seats, 4), is_active = coalesce(p_active, true)
     where id = v_id and shop_id = p_shop;
    if not found then raise exception 'st_not_found'; end if;
  end if;
  return v_id;
end
$$;

-- เพิ่มหลายโต๊ะ เช่น prefix '' ตั้งแต่ 1 ถึง 10 -> โต๊ะ "1" … "10" (ข้ามชื่อที่มีอยู่แล้ว)
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
  if (select count(*) from public.st_tables where shop_id = p_shop) + (p_to - p_from + 1) > 200 then
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

-- ลบได้เฉพาะโต๊ะที่ยังไม่เคยเปิดใช้ (ถ้ามีประวัติแล้ว ให้ปิดใช้งานแทน)
create or replace function public.st_delete_table(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_tables where id = p_table;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if exists (select 1 from public.st_table_sessions where table_id = p_table) then
    raise exception 'st_table_has_history';
  end if;
  delete from public.st_tables where id = p_table;
end
$$;

-- สร้าง QR ใหม่ (QR เก่าที่พิมพ์ไว้จะใช้ไม่ได้ทันที)
create or replace function public.st_reset_table_qr(p_table uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  v_tok  text := replace(gen_random_uuid()::text, '-', '');
begin
  select shop_id into v_shop from public.st_tables where id = p_table;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  update public.st_tables set qr_token = v_tok where id = p_table;
  return v_tok;
end
$$;

-- ---------- 4) RPC: ผังโต๊ะและเปิด/ปิดโต๊ะ (พนักงาน) ----------
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
     where t.shop_id = p_shop), '[]'::jsonb);
end
$$;

-- เปิดโต๊ะ: ทุกตำแหน่งยกเว้นครัว
create or replace function public.st_open_table(p_table uuid, p_guests int default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop   uuid;
  v_active boolean;
  v_id     uuid;
begin
  select t.shop_id, t.is_active into v_shop, v_active from public.st_tables t where t.id = p_table;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  if not v_active then raise exception 'st_table_inactive'; end if;
  if p_guests is not null and p_guests not between 1 and 99 then raise exception 'st_bad_request'; end if;
  if exists (select 1 from public.st_table_sessions where table_id = p_table and status <> 'closed') then
    raise exception 'st_table_already_open';
  end if;

  insert into public.st_table_sessions (shop_id, table_id, guest_count, opened_via, opened_by_user_id)
  values (v_shop, p_table, p_guests, 'staff', auth.uid())
  returning id into v_id;
  return v_id;
exception
  when unique_violation then raise exception 'st_table_already_open';
end
$$;

-- เปลี่ยนสถานะรอบที่เปิดอยู่: 'billing' (รอเช็กบิล) / 'open' (กลับมาสั่งเพิ่มได้)
-- p_guests: แก้จำนวนลูกค้า (null = ไม่เปลี่ยน)
create or replace function public.st_set_table_status(p_table uuid, p_status text, p_guests int default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_tables where id = p_table;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  if p_status not in ('open','billing') then raise exception 'st_bad_request'; end if;
  if p_guests is not null and p_guests not between 1 and 99 then raise exception 'st_bad_request'; end if;
  update public.st_table_sessions
     set status = p_status, guest_count = coalesce(p_guests, guest_count), last_activity_at = now()
   where table_id = p_table and status <> 'closed';
  if not found then raise exception 'st_table_not_open'; end if;
end
$$;

-- ปิดโต๊ะ (ลูกค้ากลับแล้ว) · ลิงก์ของลูกค้ากลุ่มนี้จะสั่งต่อไม่ได้
create or replace function public.st_close_table(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_tables where id = p_table;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  update public.st_table_sessions
     set status = 'closed', closed_at = now(), closed_by_user_id = auth.uid()
   where table_id = p_table and status <> 'closed';
  if not found then raise exception 'st_table_not_open'; end if;
end
$$;

-- ปิดรอบที่ถูกลืม (เรียกจาก pg_cron ทุก 15 นาที)
create or replace function public.st_close_stale_sessions()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  update public.st_table_sessions
     set status = 'closed', closed_at = now()
   where status <> 'closed'
     and (   (opened_via = 'auto' and last_activity_at < now() - interval '3 hours')
          or last_activity_at < now() - interval '12 hours');
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- ---------- 5) RPC: ฝั่งลูกค้า (ไม่ต้องล็อกอิน) ----------
-- เมนูของร้านในรูป jsonb (ใช้ภายใน ไม่เปิดให้เรียกตรง)
create or replace function public.st_menu_json(p_shop uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort, c.created_at)
        from public.st_categories c where c.shop_id = p_shop), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id, 'category_id', i.category_id, 'name', i.name, 'description', i.description,
                 'price', i.price, 'image_path', i.image_path, 'is_available', i.is_available,
                 'is_recommended', i.is_recommended, 'spicy_level', i.spicy_level,
                 'options', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', g.id, 'name', g.name, 'min_select', g.min_select, 'max_select', g.max_select,
                            'choices', coalesce((
                              select jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name, 'price_delta', ch.price_delta)
                                               order by ch.sort)
                                from public.st_option_choices ch where ch.group_id = g.id), '[]'::jsonb))
                          order by g.sort)
                     from public.st_option_groups g where g.item_id = i.id), '[]'::jsonb))
               order by i.sort, i.created_at)
        from public.st_menu_items i where i.shop_id = p_shop), '[]'::jsonb));
$$;

-- ลูกค้าสแกน QR: คืนข้อมูลร้าน โต๊ะ และสถานะ
--   state = 'open'        สั่งได้ (ได้ session_token กลับไปเก็บในเครื่อง)
--           'billing'     รอเช็กบิล (สั่งเพิ่มไม่ได้)
--           'waiting'     รอพนักงานเปิดโต๊ะ (ดูเมนูได้)
--           'shop_closed' ร้านปิด
--           'ended'       (โหมด instant) รอบปิดไปแล้ว ต้องสแกน QR ใหม่
-- โหมด instant: ถ้ายังไม่มีรอบและ p_auto_open = true (สแกนจริง) จะเปิดรอบให้อัตโนมัติ
--               หน้าเว็บที่เช็กสถานะเป็นระยะส่ง p_auto_open = false เพื่อไม่ให้เปิดโต๊ะค้างไว้เอง
drop function if exists public.st_scan(text);
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
      exception when unique_violation then          -- มีคนสแกนพร้อมกัน
        select * into v_sess from public.st_table_sessions where table_id = v_tab.id and status <> 'closed';
      end;
      v_state := 'open';
    else
      v_state := 'waiting';
    end if;
  else
    v_state := v_sess.status;                       -- 'open' หรือ 'billing'
  end if;

  return jsonb_build_object(
    'shop', jsonb_build_object('id', v_shop.id, 'name', v_shop.name, 'logo_path', v_shop.logo_path,
                               'order_mode', v_shop.order_mode, 'phone', v_shop.phone,
                               'service_pct', v_shop.service_pct, 'vat_pct', v_shop.vat_pct,
                               'vat_included', v_shop.vat_included),
    'table', jsonb_build_object('label', v_tab.label, 'zone', v_tab.zone),
    'state', v_state,
    'session_token', case when v_state in ('open','billing') then v_sess.session_token end
  );
end
$$;

-- เมนูสำหรับลูกค้า (ดูได้เสมอเมื่อ QR ถูกต้อง แม้ร้านปิดหรือยังไม่เปิดโต๊ะ)
create or replace function public.st_public_menu(p_qr text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select t.shop_id into v_shop
    from public.st_tables t join public.st_shops s on s.id = t.shop_id
   where t.qr_token = p_qr and t.is_active and s.status = 'active';
  if v_shop is null then raise exception 'st_table_not_found'; end if;
  return public.st_menu_json(v_shop);
end
$$;

-- ---------- 6) สิทธิ์เรียกฟังก์ชัน ----------
revoke all on function
  public.st_save_table(uuid, uuid, text, text, int, boolean), public.st_add_tables(uuid, text, int, int, text, int),
  public.st_delete_table(uuid), public.st_reset_table_qr(uuid), public.st_tables_board(uuid),
  public.st_open_table(uuid, int), public.st_set_table_status(uuid, text, int), public.st_close_table(uuid),
  public.st_close_stale_sessions(), public.st_menu_json(uuid), public.st_scan(text, boolean), public.st_public_menu(text)
from public, anon, authenticated;

grant execute on function
  public.st_save_table(uuid, uuid, text, text, int, boolean), public.st_add_tables(uuid, text, int, int, text, int),
  public.st_delete_table(uuid), public.st_reset_table_qr(uuid), public.st_tables_board(uuid),
  public.st_open_table(uuid, int), public.st_set_table_status(uuid, text, int), public.st_close_table(uuid)
to authenticated;

grant execute on function public.st_scan(text, boolean), public.st_public_menu(text) to anon, authenticated;
-- st_menu_json และ st_close_stale_sessions: ไม่เปิดให้แอปเรียก (ใช้ภายใน / cron)

-- ---------- 7) ตั้งเวลาปิดรอบที่ถูกลืม (pg_cron) ----------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'SmartTable: เปิด pg_cron ไม่ได้ (%), ข้ามการตั้งเวลา — รอบที่ลืมปิดต้องปิดเองในหน้าโต๊ะ', sqlerrm;
    end;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('st_close_stale_sessions', '*/15 * * * *', 'select public.st_close_stale_sessions()');
  end if;
end
$$;

-- ---------- 8) บันทึกว่ารันไฟล์นี้แล้ว ----------
insert into public.st_schema_log (id) values ('st-04-tables')
on conflict (id) do update set applied_at = now();
