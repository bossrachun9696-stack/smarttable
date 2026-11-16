-- =====================================================================
-- SmartTable · st-10-guest.sql  (รอบ B · รันซ้ำได้ · ต้องรัน st-01 ถึง st-09 ก่อน)
--   1) เมนูหลายภาษา (อังกฤษ / จีน) — ร้านเปิดภาษาที่ต้องการ แล้วใส่คำแปลเอง
--   2) ให้คะแนนหลังกินเสร็จ (1–5 ดาว + ความเห็น)
--   3) โปรโมชัน: คูปองส่วนลด + โปรตามเวลา (เช่น happy hour ลด 20% บางหมวด)
--
-- ทับฟังก์ชัน st_scan อีกครั้ง (เพิ่ม languages) · ถ้ารันไฟล์เก่าซ้ำ ให้รันไฟล์นี้ซ้ำตามหลัง
-- =====================================================================

-- ---------- 1) หลายภาษา ----------
alter table public.st_shops      add column if not exists languages text[] not null default '{}';
alter table public.st_categories add column if not exists i18n jsonb not null default '{}'::jsonb;
alter table public.st_menu_items add column if not exists i18n jsonb not null default '{}'::jsonb;
-- รูปแบบ st_menu_items.i18n = {"en": {"name": "...", "description": "...", "opts": {"ไข่ดาว": "Fried egg"}}, "zh": {...}}
-- รูปแบบ st_categories.i18n = {"en": "Rice dishes", "zh": "..."}  (คำแปลตัวเลือกจับคู่ด้วยข้อความไทย จึงไม่หายเมื่อแก้ตัวเลือก)

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'st_shops_languages_check') then
    alter table public.st_shops add constraint st_shops_languages_check check (languages <@ array['en','zh']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'st_menu_items_i18n_check') then
    alter table public.st_menu_items add constraint st_menu_items_i18n_check
      check (jsonb_typeof(i18n) = 'object' and octet_length(i18n::text) <= 12000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'st_categories_i18n_check') then
    alter table public.st_categories add constraint st_categories_i18n_check
      check (jsonb_typeof(i18n) = 'object' and octet_length(i18n::text) <= 1000);
  end if;
end
$$;
grant update (languages) on public.st_shops to authenticated;

create or replace function public.st_set_item_i18n(p_item uuid, p_i18n jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid; k text;
begin
  select shop_id into v_shop from public.st_menu_items where id = p_item;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if jsonb_typeof(coalesce(p_i18n, '{}'::jsonb)) <> 'object' then raise exception 'st_bad_request'; end if;
  for k in select jsonb_object_keys(coalesce(p_i18n, '{}'::jsonb)) loop
    if k not in ('en','zh') or jsonb_typeof(p_i18n -> k) <> 'object' then raise exception 'st_bad_request'; end if;
  end loop;
  begin
    update public.st_menu_items set i18n = coalesce(p_i18n, '{}'::jsonb) where id = p_item;
  exception when check_violation then raise exception 'st_i18n_too_long';
  end;
end
$$;

create or replace function public.st_set_category_i18n(p_cat uuid, p_i18n jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid; k text;
begin
  select shop_id into v_shop from public.st_categories where id = p_cat;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if jsonb_typeof(coalesce(p_i18n, '{}'::jsonb)) <> 'object' then raise exception 'st_bad_request'; end if;
  for k in select jsonb_object_keys(coalesce(p_i18n, '{}'::jsonb)) loop
    if k not in ('en','zh') or jsonb_typeof(p_i18n -> k) <> 'string' or char_length(p_i18n ->> k) > 60 then
      raise exception 'st_bad_request';
    end if;
  end loop;
  update public.st_categories set i18n = coalesce(p_i18n, '{}'::jsonb) where id = p_cat;
end
$$;

-- หน้าสแกน: เพิ่มภาษาที่ร้านเปิด
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
                               'languages', v_shop.languages,
                               'order_mode', v_shop.order_mode, 'phone', v_shop.phone,
                               'service_pct', v_shop.service_pct, 'vat_pct', v_shop.vat_pct,
                               'vat_included', v_shop.vat_included),
    'table', jsonb_build_object('label', v_tab.label, 'zone', v_tab.zone),
    'state', v_state,
    'session_token', case when v_state in ('open','billing') then v_sess.session_token end
  );
end
$$;

-- ---------- 2) ให้คะแนน ----------
create table if not exists public.st_ratings (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null,
  session_id  uuid not null unique,
  table_id    uuid not null,
  stars       smallint not null check (stars between 1 and 5),
  comment     text check (comment is null or char_length(comment) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (session_id, shop_id) references public.st_table_sessions (id, shop_id) on delete cascade,
  foreign key (table_id, shop_id)   references public.st_tables (id, shop_id) on delete cascade
);
create index if not exists st_ratings_shop_idx on public.st_ratings (shop_id, created_at desc);
alter table public.st_ratings enable row level security;
drop policy if exists st_ratings_select_manager on public.st_ratings;
create policy st_ratings_select_manager on public.st_ratings
  for select to authenticated using (public.st_has_shop_role(shop_id, array['owner','manager']));
revoke all on public.st_ratings from anon, authenticated;
grant select on public.st_ratings to authenticated;

-- ลูกค้าให้คะแนน: ระหว่างนั่ง หรือภายใน 3 ชม. หลังปิดโต๊ะ (แก้คะแนนเดิมได้)
create or replace function public.st_guest_rate(p_qr text, p_session_token text, p_stars int, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_sess public.st_table_sessions;
begin
  select s.* into v_sess
    from public.st_table_sessions s join public.st_tables t on t.id = s.table_id
   where t.qr_token = p_qr and s.session_token = p_session_token
     and (s.status <> 'closed' or s.closed_at > now() - interval '3 hours');
  if v_sess.id is null then raise exception 'st_rating_expired'; end if;
  if p_stars is null or p_stars not between 1 and 5 then raise exception 'st_bad_request'; end if;
  if char_length(coalesce(p_comment, '')) > 300 then raise exception 'st_bad_request'; end if;
  if not exists (select 1 from public.st_orders where session_id = v_sess.id and status <> 'cancelled') then
    raise exception 'st_rating_no_order';
  end if;
  insert into public.st_ratings (shop_id, session_id, table_id, stars, comment)
  values (v_sess.shop_id, v_sess.id, v_sess.table_id, p_stars, nullif(trim(coalesce(p_comment, '')), ''))
  on conflict (session_id) do update
     set stars = excluded.stars, comment = excluded.comment, updated_at = now();
end
$$;

create or replace function public.st_rating_summary(p_shop uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_start timestamptz; v_end timestamptz;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'st_bad_date_range'; end if;
  v_start := p_from::timestamp at time zone 'Asia/Bangkok';
  v_end   := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';
  return (
    with r as (select * from public.st_ratings where shop_id = p_shop and created_at >= v_start and created_at < v_end)
    select jsonb_build_object(
      'count', (select count(*) from r),
      'avg', (select coalesce(round(avg(stars), 2), 0) from r),
      'dist', (select jsonb_agg((select count(*) from r where stars = s) order by s) from generate_series(1, 5) s),
      'comments', coalesce((select jsonb_agg(jsonb_build_object('stars', r.stars, 'comment', r.comment, 'at', r.created_at,
                                                                'table_label', t.label) order by r.created_at desc)
                              from (select * from r where comment is not null order by created_at desc limit 50) r
                              join public.st_tables t on t.id = r.table_id), '[]'::jsonb)));
end
$$;

-- ---------- 3) คูปอง ----------
create table if not exists public.st_coupons (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.st_shops(id) on delete cascade,
  code          text not null check (code ~ '^[A-Z0-9_-]{3,20}$'),
  kind          text not null check (kind in ('percent','amount')),
  value         numeric(10,2) not null check (value > 0),
  min_subtotal  numeric(10,2) not null default 0 check (min_subtotal >= 0),
  max_discount  numeric(10,2) check (max_discount is null or max_discount > 0),
  starts_on     date,
  ends_on       date,
  usage_limit   int check (usage_limit is null or usage_limit > 0),
  used_count    int not null default 0,
  is_active     boolean not null default true,
  note          text check (note is null or char_length(note) <= 100),
  created_at    timestamptz not null default now(),
  unique (shop_id, code),
  unique (id, shop_id),
  check (kind <> 'percent' or value <= 100)
);
create table if not exists public.st_coupon_uses (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null,
  coupon_id         uuid not null,
  payment_id        uuid not null unique,
  discount          numeric(12,2) not null,
  used_by_user_id   uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  foreign key (coupon_id, shop_id)  references public.st_coupons (id, shop_id) on delete cascade,
  foreign key (payment_id, shop_id) references public.st_payments (id, shop_id) on delete cascade
);

-- ---------- 4) โปรตามเวลา ----------
create table if not exists public.st_promotions (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.st_shops(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  percent       numeric(5,2) not null check (percent > 0 and percent <= 90),
  days          smallint[] not null default '{0,1,2,3,4,5,6}' check (days <@ '{0,1,2,3,4,5,6}'::smallint[] and cardinality(days) > 0),
  start_time    time not null default '00:00',
  end_time      time not null default '23:59',
  category_ids  uuid[] not null default '{}',     -- ว่างทั้งสองช่อง = ทั้งเมนู
  item_ids      uuid[] not null default '{}',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.st_order_items add column if not exists promo jsonb;   -- {id, name, percent, original_unit}

alter table public.st_coupons     enable row level security;
alter table public.st_coupon_uses enable row level security;
alter table public.st_promotions  enable row level security;
drop policy if exists st_coupons_select_staff on public.st_coupons;
create policy st_coupons_select_staff on public.st_coupons
  for select to authenticated using (public.st_has_shop_role(shop_id, array['owner','manager','cashier']));
drop policy if exists st_coupon_uses_select_manager on public.st_coupon_uses;
create policy st_coupon_uses_select_manager on public.st_coupon_uses
  for select to authenticated using (public.st_has_shop_role(shop_id, array['owner','manager']));
drop policy if exists st_promotions_select_member on public.st_promotions;
create policy st_promotions_select_member on public.st_promotions
  for select to authenticated using (public.st_has_shop_role(shop_id));
revoke all on public.st_coupons, public.st_coupon_uses, public.st_promotions from anon, authenticated;
grant select on public.st_coupons, public.st_coupon_uses, public.st_promotions to authenticated;

-- จัดการ (เจ้าของ / ผู้จัดการ)
create or replace function public.st_promo_admin(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  return jsonb_build_object(
    'coupons', coalesce((select jsonb_agg(to_jsonb(c) - 'shop_id' order by c.created_at desc)
                           from public.st_coupons c where c.shop_id = p_shop), '[]'::jsonb),
    'promotions', coalesce((select jsonb_agg(to_jsonb(p) - 'shop_id' order by p.created_at desc)
                              from public.st_promotions p where p.shop_id = p_shop), '[]'::jsonb));
end
$$;

create or replace function public.st_save_coupon(p_shop uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if v_id is null and (select count(*) from public.st_coupons where shop_id = p_shop) >= 200 then raise exception 'st_bad_request'; end if;
  begin
    if v_id is null then
      insert into public.st_coupons (shop_id, code, kind, value, min_subtotal, max_discount, starts_on, ends_on, usage_limit, is_active, note)
      values (p_shop, upper(trim(p ->> 'code')), p ->> 'kind', (p ->> 'value')::numeric,
              coalesce((p ->> 'min_subtotal')::numeric, 0), nullif(p ->> 'max_discount', '')::numeric,
              nullif(p ->> 'starts_on', '')::date, nullif(p ->> 'ends_on', '')::date,
              nullif(p ->> 'usage_limit', '')::int, coalesce((p ->> 'is_active')::boolean, true), nullif(trim(p ->> 'note'), ''))
      returning id into v_id;
    else
      update public.st_coupons
         set code = upper(trim(p ->> 'code')), kind = p ->> 'kind', value = (p ->> 'value')::numeric,
             min_subtotal = coalesce((p ->> 'min_subtotal')::numeric, 0), max_discount = nullif(p ->> 'max_discount', '')::numeric,
             starts_on = nullif(p ->> 'starts_on', '')::date, ends_on = nullif(p ->> 'ends_on', '')::date,
             usage_limit = nullif(p ->> 'usage_limit', '')::int, is_active = coalesce((p ->> 'is_active')::boolean, true),
             note = nullif(trim(p ->> 'note'), '')
       where id = v_id and shop_id = p_shop;
      if not found then raise exception 'st_not_found'; end if;
    end if;
  exception
    when unique_violation then raise exception 'st_coupon_code_taken';
    when check_violation or invalid_text_representation or not_null_violation then raise exception 'st_bad_coupon';
  end;
  return v_id;
end
$$;

create or replace function public.st_delete_coupon(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_coupons where id = p_id;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if exists (select 1 from public.st_coupon_uses where coupon_id = p_id) then
    update public.st_coupons set is_active = false where id = p_id;     -- เคยใช้แล้ว: ปิดแทนลบ
  else
    delete from public.st_coupons where id = p_id;
  end if;
end
$$;

create or replace function public.st_save_promotion(p_shop uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid := nullif(p ->> 'id', '')::uuid;
  v_days  smallint[];
  v_cats  uuid[];
  v_items uuid[];
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if v_id is null and (select count(*) from public.st_promotions where shop_id = p_shop) >= 50 then raise exception 'st_bad_request'; end if;
  begin
    v_days  := coalesce((select array_agg(distinct x::smallint) from jsonb_array_elements_text(p -> 'days') x), '{}');
    v_cats  := coalesce((select array_agg(distinct x::uuid) from jsonb_array_elements_text(p -> 'category_ids') x), '{}');
    v_items := coalesce((select array_agg(distinct x::uuid) from jsonb_array_elements_text(p -> 'item_ids') x), '{}');
    -- เลือกได้เฉพาะหมวด / เมนูของร้านตัวเอง
    if exists (select 1 from unnest(v_cats) c where not exists (select 1 from public.st_categories where id = c and shop_id = p_shop))
       or exists (select 1 from unnest(v_items) i where not exists (select 1 from public.st_menu_items where id = i and shop_id = p_shop)) then
      raise exception 'st_bad_promo';
    end if;
    if v_id is null then
      insert into public.st_promotions (shop_id, name, percent, days, start_time, end_time, category_ids, item_ids, is_active)
      values (p_shop, trim(p ->> 'name'), (p ->> 'percent')::numeric, v_days,
              (p ->> 'start_time')::time, (p ->> 'end_time')::time, v_cats, v_items, coalesce((p ->> 'is_active')::boolean, true))
      returning id into v_id;
    else
      update public.st_promotions
         set name = trim(p ->> 'name'), percent = (p ->> 'percent')::numeric, days = v_days,
             start_time = (p ->> 'start_time')::time, end_time = (p ->> 'end_time')::time,
             category_ids = v_cats, item_ids = v_items, is_active = coalesce((p ->> 'is_active')::boolean, true)
       where id = v_id and shop_id = p_shop;
      if not found then raise exception 'st_not_found'; end if;
    end if;
  exception
    when check_violation or invalid_text_representation or not_null_violation or invalid_datetime_format then
      raise exception 'st_bad_promo';
  end;
  return v_id;
end
$$;

create or replace function public.st_delete_promotion(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_promotions where id = p_id;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  delete from public.st_promotions where id = p_id;
end
$$;

-- โปรที่ใช้อยู่ตอนนี้ (เวลาไทย) · ข้ามเที่ยงคืนได้ เช่น 22:00–02:00
create or replace function public.st_promo_active_now(p public.st_promotions)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p.is_active
     and extract(dow from (now() at time zone 'Asia/Bangkok'))::smallint = any (p.days)
     and case when p.start_time <= p.end_time
              then (now() at time zone 'Asia/Bangkok')::time between p.start_time and p.end_time
              else (now() at time zone 'Asia/Bangkok')::time >= p.start_time
                or (now() at time zone 'Asia/Bangkok')::time <= p.end_time end;
$$;

-- ลดราคาตอนบันทึกรายการ (เลือกโปรที่ลดมากสุด)
create or replace function public.st_promo_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat uuid;
  pr    public.st_promotions;
begin
  if new.item_id is null then return new; end if;
  select category_id into v_cat from public.st_menu_items where id = new.item_id;
  select p.* into pr
    from public.st_promotions p
   where p.shop_id = new.shop_id and public.st_promo_active_now(p)
     and ((cardinality(p.item_ids) = 0 and cardinality(p.category_ids) = 0)
          or new.item_id = any (p.item_ids) or v_cat = any (p.category_ids))
   order by p.percent desc limit 1;
  if pr.id is not null then
    new.promo := jsonb_build_object('id', pr.id, 'name', pr.name, 'percent', pr.percent, 'original_unit', new.unit_price);
    new.unit_price := round(new.unit_price * (100 - pr.percent) / 100, 2);
    new.line_total := new.unit_price * new.qty;
  end if;
  return new;
end
$$;
drop trigger if exists st_order_items_promo on public.st_order_items;
create trigger st_order_items_promo
  before insert on public.st_order_items
  for each row execute function public.st_promo_apply();

-- ยอดออร์เดอร์ = ผลรวมรายการจริงเสมอ (หลังหักโปร)
create or replace function public.st_orders_recalc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.subtotal := (select coalesce(sum(line_total), 0) from public.st_order_items where order_id = new.id);
  return new;
end
$$;
drop trigger if exists st_orders_recalc on public.st_orders;
create trigger st_orders_recalc
  before update of subtotal on public.st_orders
  for each row execute function public.st_orders_recalc();

-- โปรที่ใช้อยู่ตอนนี้ สำหรับหน้าลูกค้า (แสดงราคาลด)
create or replace function public.st_public_promos(p_qr text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select t.shop_id into v_shop from public.st_tables t join public.st_shops s on s.id = t.shop_id
   where t.qr_token = p_qr and t.is_active and s.status = 'active';
  if v_shop is null then raise exception 'st_table_not_found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'percent', p.percent,
                                                       'category_ids', p.category_ids, 'item_ids', p.item_ids,
                                                       'end_time', to_char(p.end_time, 'HH24:MI')))
                     from public.st_promotions p where p.shop_id = v_shop and public.st_promo_active_now(p)), '[]'::jsonb);
end
$$;

-- ตรวจคูปองกับบิลของโต๊ะ -> คืนส่วนลด (เจ้าของ / ผู้จัดการ / แคชเชียร์)
create or replace function public.st_coupon_quote(p_table uuid, p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop  uuid;
  v_sess  uuid;
  v_sub   numeric;
  c       public.st_coupons;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_disc  numeric;
begin
  select shop_id into v_shop from public.st_tables where id = p_table;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager','cashier']) then raise exception 'st_discount_forbidden'; end if;
  select id into v_sess from public.st_table_sessions where table_id = p_table and status <> 'closed';
  if v_sess is null then raise exception 'st_table_not_open'; end if;
  select * into c from public.st_coupons where shop_id = v_shop and code = upper(trim(p_code));
  if c.id is null or not c.is_active then raise exception 'st_coupon_invalid'; end if;
  if (c.starts_on is not null and v_today < c.starts_on) or (c.ends_on is not null and v_today > c.ends_on) then
    raise exception 'st_coupon_expired';
  end if;
  if c.usage_limit is not null and c.used_count >= c.usage_limit then raise exception 'st_coupon_used_up'; end if;
  v_sub := (public.st_bill_calc(v_sess, 0) ->> 'subtotal')::numeric;
  if v_sub < c.min_subtotal then raise exception 'st_coupon_min' using detail = 'ขั้นต่ำ ' || c.min_subtotal::text; end if;
  if c.kind = 'percent' then
    v_disc := round(v_sub * c.value / 100, 2);
    if c.max_discount is not null then v_disc := least(v_disc, c.max_discount); end if;
  else
    v_disc := least(c.value, v_sub);
  end if;
  return jsonb_build_object('coupon_id', c.id, 'code', c.code, 'discount', v_disc,
                            'label', case when c.kind = 'percent' then 'ลด ' || trim_scale(c.value) || '%' else 'ลด ' || trim_scale(c.value) || ' บาท' end);
end
$$;

-- บันทึกการใช้คูปอง (เรียกหลังรับเงินสำเร็จ)
create or replace function public.st_coupon_redeem(p_payment uuid, p_coupon uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare pay public.st_payments;
begin
  select * into pay from public.st_payments where id = p_payment;
  if pay.id is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(pay.shop_id, array['owner','manager','cashier']) then raise exception 'st_forbidden'; end if;
  if pay.status <> 'paid' or pay.discount <= 0 then raise exception 'st_bad_request'; end if;
  update public.st_coupons set used_count = used_count + 1
   where id = p_coupon and shop_id = pay.shop_id and (usage_limit is null or used_count < usage_limit);
  if not found then raise exception 'st_coupon_used_up'; end if;
  insert into public.st_coupon_uses (shop_id, coupon_id, payment_id, discount, used_by_user_id)
  values (pay.shop_id, p_coupon, p_payment, pay.discount, auth.uid());
end
$$;

-- ---------- 5) สิทธิ์ ----------
revoke all on function
  public.st_set_item_i18n(uuid, jsonb), public.st_set_category_i18n(uuid, jsonb),
  public.st_guest_rate(text, text, int, text), public.st_rating_summary(uuid, date, date),
  public.st_promo_admin(uuid), public.st_save_coupon(uuid, jsonb), public.st_delete_coupon(uuid),
  public.st_save_promotion(uuid, jsonb), public.st_delete_promotion(uuid),
  public.st_promo_active_now(public.st_promotions), public.st_promo_apply(), public.st_orders_recalc(),
  public.st_public_promos(text), public.st_coupon_quote(uuid, text), public.st_coupon_redeem(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.st_set_item_i18n(uuid, jsonb), public.st_set_category_i18n(uuid, jsonb),
  public.st_rating_summary(uuid, date, date), public.st_promo_admin(uuid),
  public.st_save_coupon(uuid, jsonb), public.st_delete_coupon(uuid),
  public.st_save_promotion(uuid, jsonb), public.st_delete_promotion(uuid),
  public.st_coupon_quote(uuid, text), public.st_coupon_redeem(uuid, uuid)
to authenticated;
grant execute on function public.st_guest_rate(text, text, int, text), public.st_public_promos(text) to anon, authenticated;

insert into public.st_schema_log (id) values ('st-10-guest')
on conflict (id) do update set applied_at = now();
