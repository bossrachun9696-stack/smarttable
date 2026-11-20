-- =====================================================================
-- SmartTable · st-18-refill.sql  (รอบ J · รีฟิล / ตัวเลือกเสริมของบุฟเฟ่ต์)
-- ร้านตั้ง "รีฟิล" ได้ เช่น น้ำรีฟิล ฿39/คน ครอบคลุมเมนูบางหมวด/บางเมนู
-- โต๊ะที่เอารีฟิล: เมนูในรีฟิล = 0 บาท (ไม่ติดจำนวนต่อรอบ/เวลาเว้นรอบ) · ไม่เอา: คิดตามราคาเมนูลงบิล
-- ค่ารีฟิลขึ้นเป็นรายการในบิล (ต่อคน หรือต่อโต๊ะ) · ใช้ได้ทั้งโต๊ะบุฟเฟ่ต์และโต๊ะสั่งตามเมนู
-- ลูกค้ากด "ขอเพิ่มรีฟิล" จากมือถือได้ -> ร้านได้แจ้งเตือน (เรียกพนักงาน)
-- รันซ้ำได้ (ต้องรัน st-17 ก่อน) · ทับ: st_save_buffet_package, st_buffet_write_heads, st_order_items_buffet,
--   st_order_items_buffet_limit · เปลี่ยนลายเซ็น st_buffet_start (เพิ่ม p_addons)
-- =====================================================================

-- ---------- 1) แพ็กเกจ = บุฟเฟ่ต์ หรือ รีฟิล/ตัวเลือกเสริม ----------
alter table public.st_buffet_packages add column if not exists kind text not null default 'package';
alter table public.st_buffet_packages drop constraint if exists st_buffet_packages_kind_check;
alter table public.st_buffet_packages add constraint st_buffet_packages_kind_check check (kind in ('package','addon'));
alter table public.st_buffet_packages add column if not exists per_head boolean not null default true;   -- รีฟิล: คิดต่อคน / ต่อโต๊ะ

alter table public.st_order_items add column if not exists refill boolean not null default false;      -- ได้ฟรีจากรีฟิล

-- ---------- 2) บันทึกแพ็กเกจ/รีฟิล (ทับ st-17: เพิ่ม kind, per_head) ----------
create or replace function public.st_save_buffet_package(p_shop uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid := nullif(p ->> 'id', '')::uuid;
  v_kind  text := coalesce(nullif(p ->> 'kind', ''), 'package');
  v_cats  uuid[];
  v_items uuid[];
  v_all   boolean;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if v_kind not in ('package','addon') then raise exception 'st_bad_buffet'; end if;
  if v_id is not null and not exists (select 1 from public.st_buffet_packages where id = v_id and shop_id = p_shop) then
    raise exception 'st_not_found';
  end if;
  if v_id is null and (select count(*) from public.st_buffet_packages where shop_id = p_shop) >= 30 then
    raise exception 'st_bad_buffet' using detail = 'max 30';
  end if;
  begin
    select coalesce(array_agg(x::uuid), '{}') into v_cats from jsonb_array_elements_text(coalesce(p -> 'category_ids', '[]')) x;
    select coalesce(array_agg(x::uuid), '{}') into v_items from jsonb_array_elements_text(coalesce(p -> 'item_ids', '[]')) x;
    v_all := coalesce((p ->> 'include_all')::boolean, true);
    if v_kind = 'addon' then
      v_all := false;                                           -- รีฟิลต้องเลือกเมนูเสมอ
      if cardinality(v_cats) = 0 and cardinality(v_items) = 0 then raise exception 'st_bad_buffet' using detail = 'addon items'; end if;
    end if;
    if v_id is null then
      insert into public.st_buffet_packages (shop_id, kind, per_head, name, price_adult, price_child, child_note, time_limit_min, last_order_min,
                                             overtime_block_min, overtime_fee, round_limit, round_gap_min, include_all,
                                             category_ids, item_ids, rules, is_active, sort)
      values (p_shop, v_kind, coalesce((p ->> 'per_head')::boolean, true), trim(p ->> 'name'), (p ->> 'price_adult')::numeric,
              nullif(p ->> 'price_child', '')::numeric, nullif(trim(coalesce(p ->> 'child_note', '')), ''),
              case when v_kind = 'package' then nullif(p ->> 'time_limit_min', '')::int end,
              case when v_kind = 'package' then coalesce(nullif(p ->> 'last_order_min', '')::int, 0) else 0 end,
              coalesce(nullif(p ->> 'overtime_block_min', '')::int, 15),
              case when v_kind = 'package' then coalesce(nullif(p ->> 'overtime_fee', '')::numeric, 0) else 0 end,
              case when v_kind = 'package' then nullif(p ->> 'round_limit', '')::int end,
              case when v_kind = 'package' then nullif(p ->> 'round_gap_min', '')::int end,
              v_all, v_cats, v_items, nullif(trim(coalesce(p ->> 'rules', '')), ''), coalesce((p ->> 'is_active')::boolean, true),
              coalesce((select max(sort) + 1 from public.st_buffet_packages where shop_id = p_shop), 0))
      returning id into v_id;
    else
      update public.st_buffet_packages
         set kind = v_kind, per_head = coalesce((p ->> 'per_head')::boolean, per_head),
             name = trim(p ->> 'name'), price_adult = (p ->> 'price_adult')::numeric,
             price_child = nullif(p ->> 'price_child', '')::numeric, child_note = nullif(trim(coalesce(p ->> 'child_note', '')), ''),
             time_limit_min = case when v_kind = 'package' then nullif(p ->> 'time_limit_min', '')::int end,
             last_order_min = case when v_kind = 'package' then coalesce(nullif(p ->> 'last_order_min', '')::int, 0) else 0 end,
             overtime_block_min = coalesce(nullif(p ->> 'overtime_block_min', '')::int, 15),
             overtime_fee = case when v_kind = 'package' then coalesce(nullif(p ->> 'overtime_fee', '')::numeric, 0) else 0 end,
             round_limit = case when v_kind = 'package' then nullif(p ->> 'round_limit', '')::int end,
             round_gap_min = case when v_kind = 'package' then nullif(p ->> 'round_gap_min', '')::int end,
             include_all = v_all, category_ids = v_cats, item_ids = v_items,
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

-- ---------- 3) เมนูนี้ฟรีเพราะอะไร: 'package' | 'addon' | null ----------
create or replace function public.st_buffet_cover(b jsonb, p_item uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_cat text; a jsonb;
begin
  if b is null or p_item is null then return null; end if;
  select category_id::text into v_cat from public.st_menu_items where id = p_item;
  if b ->> 'mode' = 'package' and (
       coalesce((b ->> 'include_all')::boolean, false)
    or p_item::text in (select jsonb_array_elements_text(coalesce(b -> 'item_ids', '[]'::jsonb)))
    or v_cat in (select jsonb_array_elements_text(coalesce(b -> 'category_ids', '[]'::jsonb)))) then
    return 'package';
  end if;
  for a in select value from jsonb_array_elements(coalesce(b -> 'addons', '[]'::jsonb)) loop
    if p_item::text in (select jsonb_array_elements_text(coalesce(a -> 'item_ids', '[]'::jsonb)))
       or v_cat in (select jsonb_array_elements_text(coalesce(a -> 'category_ids', '[]'::jsonb))) then
      return 'addon';
    end if;
  end loop;
  return null;
end
$$;

-- ---------- 4) ราคาตอนสั่ง (ทับ st-17) ----------
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
  v_cov  text;
begin
  if new.item_id is null then return new; end if;
  select s.buffet, s.id into b, v_sess from public.st_orders o join public.st_table_sessions s on s.id = o.session_id
   where o.id = new.order_id;
  v_cov := public.st_buffet_cover(b, new.item_id);
  if v_cov is null then return new; end if;
  new.promo := null;
  new.unit_price := 0;
  new.line_total := 0;
  if v_cov = 'addon' then new.refill := true; return new; end if;     -- รีฟิล: ไม่ติดกติกาบุฟเฟ่ต์
  new.buffet := true;
  if public.st_buffet_is_staff(new.shop_id) then return new; end if;
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

-- ---------- 5) รายการค่าบริการในบิล: ค่าหัว + ค่ารีฟิล (ทับ st-17) ----------
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
  a    jsonb;
  v_q  int;
  v_p  numeric;
begin
  v_o := public.st_buffet_charge_order(p_sess);
  delete from public.st_order_items where order_id = v_o and (note in ('buffet:adult', 'buffet:child') or note like 'buffet:addon%');
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
  for a in select value from jsonb_array_elements(coalesce(b -> 'addons', '[]'::jsonb)) loop
    v_q := greatest(coalesce((a ->> 'qty')::int, 1), 1);
    v_p := coalesce((a ->> 'price')::numeric, 0);
    if v_p > 0 then
      insert into public.st_order_items (shop_id, order_id, item_id, name, unit_price, qty, options, note, line_total)
      values (p_sess.shop_id, v_o, null,
              left((a ->> 'name') || case when coalesce((a ->> 'per_head')::boolean, true) then ' (ต่อคน)' else ' (ต่อโต๊ะ)' end, 120),
              v_p, v_q, '[]'::jsonb, 'buffet:addon:' || (a ->> 'id'), v_p * v_q);
    end if;
  end loop;
  update public.st_orders set subtotal = 0, updated_at = now() where id = v_o;
  if not exists (select 1 from public.st_order_items where order_id = v_o) then
    delete from public.st_orders where id = v_o;
  end if;
end
$$;

-- ---------- 6) เริ่ม/แก้ที่โต๊ะ: เพิ่มรีฟิล p_addons = [{"id": "...", "qty": 3}] ----------
drop function if exists public.st_buffet_start(uuid, uuid, int, int);
create or replace function public.st_buffet_start(p_table uuid, p_package uuid, p_adults int, p_children int default 0,
                                                  p_addons jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess  public.st_table_sessions;
  pk      public.st_buffet_packages;
  ad      public.st_buffet_packages;
  v_start timestamptz;
  b       jsonb;
  v_adds  jsonb := '[]'::jsonb;
  x       jsonb;
  v_q     int;
  v_heads int := coalesce(p_adults, 0) + coalesce(p_children, 0);
begin
  select s.* into v_sess from public.st_table_sessions s where s.table_id = p_table and s.status <> 'closed';
  if v_sess.id is null then raise exception 'st_table_not_open'; end if;
  if not public.st_has_shop_role(v_sess.shop_id, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  if v_sess.status <> 'open' then raise exception 'st_session_billing'; end if;
  if exists (select 1 from public.st_payments where session_id = v_sess.id and status = 'paid') then raise exception 'st_partly_paid'; end if;
  if coalesce(p_adults, 0) not between 0 and 99 or coalesce(p_children, 0) not between 0 and 99 then
    raise exception 'st_bad_buffet' using detail = 'heads';
  end if;

  -- รีฟิลที่เลือก (คิดตามราคาปัจจุบัน · ต่อคน: จำนวนคนที่เอา / ต่อโต๊ะ: 1)
  if jsonb_typeof(p_addons) = 'array' then
    for x in select value from jsonb_array_elements(p_addons) loop
      ad := null;
      begin
        select * into ad from public.st_buffet_packages
         where id = (x ->> 'id')::uuid and shop_id = v_sess.shop_id and kind = 'addon' and is_active;
      exception when invalid_text_representation then raise exception 'st_bad_buffet';
      end;
      if ad.id is null then raise exception 'st_not_found'; end if;
      v_q := case when ad.per_head then coalesce((x ->> 'qty')::int, v_heads) else 1 end;
      if v_q not between 1 and 99 then raise exception 'st_bad_buffet' using detail = 'addon qty'; end if;
      v_adds := v_adds || jsonb_build_object('id', ad.id, 'name', ad.name, 'price', ad.price_adult, 'per_head', ad.per_head,
                                             'qty', v_q, 'category_ids', to_jsonb(ad.category_ids), 'item_ids', to_jsonb(ad.item_ids),
                                             'rules', ad.rules);
    end loop;
  end if;

  if p_package is null then
    b := jsonb_build_object('mode', 'alacarte', 'adults', coalesce(p_adults, 0), 'children', coalesce(p_children, 0),
                            'started_at', coalesce(v_sess.buffet ->> 'started_at', now()::text));
  else
    select * into pk from public.st_buffet_packages where id = p_package and shop_id = v_sess.shop_id and is_active and kind = 'package';
    if pk.id is null then raise exception 'st_not_found'; end if;
    if v_heads < 1 then raise exception 'st_bad_buffet' using detail = 'heads'; end if;
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
  b := b || jsonb_build_object('addons', v_adds);

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

-- ---------- 7) ลูกค้า: รีฟิลที่ร้านมี + ขอเพิ่มรีฟิล ----------
create or replace function public.st_guest_addons(p_qr text)
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
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price_adult, 'per_head', a.per_head,
                                                       'category_ids', a.category_ids, 'item_ids', a.item_ids, 'rules', a.rules)
                                    order by a.sort, a.created_at)
                     from public.st_buffet_packages a where a.shop_id = v_shop and a.kind = 'addon' and a.is_active), '[]'::jsonb);
end
$$;

create or replace function public.st_guest_refill_request(p_qr text, p_session_token text, p_addon uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_sess public.st_table_sessions; v_name text;
begin
  v_sess := public.st_guest_session(p_qr, p_session_token);
  select name into v_name from public.st_buffet_packages where id = p_addon and shop_id = v_sess.shop_id and kind = 'addon' and is_active;
  if v_name is null then raise exception 'st_not_found'; end if;
  insert into public.st_service_calls (shop_id, table_id, session_id, kind, detail)
  values (v_sess.shop_id, v_sess.table_id, v_sess.id, 'call', left('ขอเพิ่ม: ' || v_name, 160))
  on conflict (session_id, kind) where status = 'pending'
  do update set detail = excluded.detail, created_at = now();
  update public.st_table_sessions set last_activity_at = now() where id = v_sess.id;
end
$$;

-- ---------- 8) สิทธิ์ ----------
revoke all on function
  public.st_buffet_cover(jsonb, uuid), public.st_buffet_start(uuid, uuid, int, int, jsonb),
  public.st_guest_addons(text), public.st_guest_refill_request(text, text, uuid)
from public, anon, authenticated;
grant execute on function public.st_buffet_start(uuid, uuid, int, int, jsonb) to authenticated;
grant execute on function public.st_guest_addons(text), public.st_guest_refill_request(text, text, uuid) to anon, authenticated;

insert into public.st_schema_log (id) values ('st-18-refill')
on conflict (id) do update set applied_at = now();
