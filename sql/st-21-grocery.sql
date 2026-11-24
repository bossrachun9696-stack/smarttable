-- =====================================================================
-- SmartTable · st-21-grocery.sql (รอบ M)
-- ร้านขายของชำ: ลูกค้าสแกน QR หน้าร้าน → เลือกสินค้า → รับที่ร้าน หรือส่งถึงบ้าน
-- จำกัดระยะ (กม. เส้นตรงจากพิกัดร้าน) · ค่าส่ง ฟรี / เหมา / ตามระยะ · ยอดขั้นต่ำ · ส่งฟรีเมื่อครบ
-- ใช้ระบบบัตรคิวสั่งกลับบ้านเดิม (st-12) · ค่าส่ง = รายการ "🛵 ค่าส่ง" ในออร์เดอร์ is_charge
-- รันซ้ำได้ · ต้องรัน st-01 … st-20 ก่อน · ไม่ทับฟังก์ชันเดิม
-- =====================================================================

alter table public.st_shops add column if not exists grocery_cfg jsonb not null default '{}'::jsonb;
alter table public.st_table_sessions add column if not exists fulfil          text;
alter table public.st_table_sessions add column if not exists deliver_address text;
alter table public.st_table_sessions add column if not exists deliver_lat     numeric(9,6);
alter table public.st_table_sessions add column if not exists deliver_lng     numeric(9,6);
alter table public.st_table_sessions add column if not exists deliver_km      numeric(7,2);
alter table public.st_table_sessions add column if not exists deliver_fee     numeric(10,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'st_shops_grocery_cfg_check') then
    alter table public.st_shops add constraint st_shops_grocery_cfg_check
      check (jsonb_typeof(grocery_cfg) = 'object' and octet_length(grocery_cfg::text) <= 3000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'st_table_sessions_fulfil_check') then
    alter table public.st_table_sessions add constraint st_table_sessions_fulfil_check
      check (fulfil is null or fulfil in ('pickup','delivery'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'st_table_sessions_deliver_address_check') then
    alter table public.st_table_sessions add constraint st_table_sessions_deliver_address_check
      check (deliver_address is null or char_length(deliver_address) <= 300);
  end if;
end
$$;

-- ---------- ระยะทางเส้นตรง (กม.) ----------
create or replace function public.st_km(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round((6371 * 2 * asin(sqrt(
           power(sin(radians((p_lat2 - p_lat1)::float8) / 2), 2)
           + cos(radians(p_lat1::float8)) * cos(radians(p_lat2::float8)) * power(sin(radians((p_lng2 - p_lng1)::float8) / 2), 2))))::numeric, 2);
$$;

-- ---------- ค่าส่งตามที่ร้านตั้ง (ภายใน) ----------
-- คืน {ok, km, fee, reason, min, max_km}
create or replace function public.st_grocery_calc(p_cfg jsonb, p_fulfil text, p_lat numeric, p_lng numeric, p_subtotal numeric)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_km   numeric;
  v_fee  numeric := 0;
  v_min  numeric;
  v_max  numeric := coalesce((p_cfg ->> 'max_km')::numeric, 5);
  v_mode text := coalesce(p_cfg ->> 'fee_mode', 'free');
  v_free numeric := (p_cfg ->> 'free_over')::numeric;
begin
  if p_fulfil = 'pickup' then
    if not coalesce((p_cfg ->> 'pickup')::boolean, true) then
      return jsonb_build_object('ok', false, 'reason', 'pickup_off');
    end if;
    v_min := coalesce((p_cfg ->> 'min_order')::numeric, 0);
    if p_subtotal is not null and p_subtotal < v_min then
      return jsonb_build_object('ok', false, 'reason', 'min', 'min', v_min);
    end if;
    return jsonb_build_object('ok', true, 'fee', 0, 'min', v_min);
  end if;

  if not coalesce((p_cfg ->> 'delivery')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'delivery_off');
  end if;
  if p_cfg ->> 'lat' is null or p_cfg ->> 'lng' is null then
    return jsonb_build_object('ok', false, 'reason', 'no_shop_location');
  end if;
  if p_lat is null or p_lng is null then
    return jsonb_build_object('ok', false, 'reason', 'need_location', 'max_km', v_max);
  end if;
  v_km := public.st_km((p_cfg ->> 'lat')::numeric, (p_cfg ->> 'lng')::numeric, p_lat, p_lng);
  if v_km > v_max then
    return jsonb_build_object('ok', false, 'reason', 'far', 'km', v_km, 'max_km', v_max);
  end if;
  v_min := coalesce((p_cfg ->> 'min_delivery')::numeric, (p_cfg ->> 'min_order')::numeric, 0);
  if p_subtotal is not null and p_subtotal < v_min then
    return jsonb_build_object('ok', false, 'reason', 'min', 'min', v_min, 'km', v_km, 'max_km', v_max);
  end if;
  if v_mode = 'flat' then
    v_fee := coalesce((p_cfg ->> 'fee_flat')::numeric, 0);
  elsif v_mode = 'per_km' then
    v_fee := coalesce((p_cfg ->> 'fee_base')::numeric, 0)
             + greatest(0, ceil(v_km - coalesce((p_cfg ->> 'fee_free_km')::numeric, 0))) * coalesce((p_cfg ->> 'fee_per_km')::numeric, 0);
    if (p_cfg ->> 'fee_cap')::numeric is not null then v_fee := least(v_fee, (p_cfg ->> 'fee_cap')::numeric); end if;
  end if;
  if v_free is not null and p_subtotal is not null and p_subtotal >= v_free then v_fee := 0; end if;
  return jsonb_build_object('ok', true, 'km', v_km, 'fee', round(v_fee, 2), 'min', v_min, 'max_km', v_max,
                            'free_over', v_free);
end
$$;

-- ---------- ตั้งค่า (เจ้าของ / ผู้จัดการ) ----------
create or replace function public.st_save_grocery_cfg(p_shop uuid, p_cfg jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c   jsonb := '{}'::jsonb;
  k   text;
  v   numeric;
  out jsonb;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_cfg is null or jsonb_typeof(p_cfg) <> 'object' then raise exception 'st_bad_request'; end if;
  foreach k in array array['pickup','delivery','need_phone','cod','transfer'] loop
    if p_cfg ? k then c := c || jsonb_build_object(k, coalesce((p_cfg ->> k)::boolean, false)); end if;
  end loop;
  if p_cfg ? 'fee_mode' then
    if p_cfg ->> 'fee_mode' not in ('free','flat','per_km') then raise exception 'st_bad_request'; end if;
    c := c || jsonb_build_object('fee_mode', p_cfg ->> 'fee_mode');
  end if;
  -- ตัวเลข (null = ไม่ใช้)
  foreach k in array array['max_km','fee_flat','fee_base','fee_per_km','fee_free_km','fee_cap','min_order','min_delivery','free_over','eta_min'] loop
    if p_cfg ? k then
      v := nullif(p_cfg ->> k, '')::numeric;
      if v is not null and (v < 0 or v > 100000) then raise exception 'st_bad_request'; end if;
      if k = 'max_km' and v is not null and (v < 0.2 or v > 100) then raise exception 'st_bad_request'; end if;
      c := c || jsonb_build_object(k, v);
    end if;
  end loop;
  if p_cfg ? 'lat' or p_cfg ? 'lng' then
    if (p_cfg ->> 'lat') is null or (p_cfg ->> 'lng') is null then
      c := c || jsonb_build_object('lat', null, 'lng', null);
    elsif (p_cfg ->> 'lat')::numeric not between -90 and 90 or (p_cfg ->> 'lng')::numeric not between -180 and 180 then
      raise exception 'st_bad_request';
    else
      c := c || jsonb_build_object('lat', round((p_cfg ->> 'lat')::numeric, 6), 'lng', round((p_cfg ->> 'lng')::numeric, 6));
    end if;
  end if;
  if p_cfg ? 'note' then
    if char_length(coalesce(p_cfg ->> 'note', '')) > 300 then raise exception 'st_bad_request'; end if;
    c := c || jsonb_build_object('note', nullif(trim(coalesce(p_cfg ->> 'note', '')), ''));
  end if;
  update public.st_shops set grocery_cfg = grocery_cfg || c where id = p_shop returning grocery_cfg into out;
  return out;
end
$$;

-- ---------- ลูกค้า: ข้อมูลการรับ/ส่ง (ไม่เปิดพิกัดร้าน) ----------
create or replace function public.st_grocery_info(p_hub_qr text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare cfg jsonb; v_type text;
begin
  select s.grocery_cfg, s.shop_type into cfg, v_type
    from public.st_tables t join public.st_shops s on s.id = t.shop_id
   where t.qr_token = p_hub_qr and t.kind = 'hub' and t.is_active and s.status = 'active';
  if cfg is null then raise exception 'st_table_not_found'; end if;
  return (cfg - 'lat' - 'lng') || jsonb_build_object(
    'grocery', v_type = 'grocery',
    'pickup', coalesce((cfg ->> 'pickup')::boolean, true),
    'delivery', v_type = 'grocery' and coalesce((cfg ->> 'delivery')::boolean, false) and cfg ->> 'lat' is not null,
    'fee_mode', coalesce(cfg ->> 'fee_mode', 'free'),
    'max_km', coalesce((cfg ->> 'max_km')::numeric, 5));
end
$$;

create or replace function public.st_grocery_quote(p_hub_qr text, p_fulfil text, p_lat numeric, p_lng numeric, p_subtotal numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare cfg jsonb; v_type text;
begin
  select s.grocery_cfg, s.shop_type into cfg, v_type
    from public.st_tables t join public.st_shops s on s.id = t.shop_id
   where t.qr_token = p_hub_qr and t.kind = 'hub' and t.is_active and s.status = 'active';
  if cfg is null then raise exception 'st_table_not_found'; end if;
  if p_fulfil = 'delivery' and v_type <> 'grocery' then return jsonb_build_object('ok', false, 'reason', 'delivery_off'); end if;
  return public.st_grocery_calc(cfg, coalesce(p_fulfil, 'pickup'), p_lat, p_lng, p_subtotal);
end
$$;

-- ---------- เขียนรายการค่าส่ง (ภายใน) ----------
create or replace function public.st_grocery_write_fee(p_sess uuid, p_fee numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s    public.st_table_sessions;
  v_o  uuid;
  v_no int;
begin
  select * into s from public.st_table_sessions where id = p_sess;
  select o.id into v_o from public.st_orders o
   where o.session_id = s.id and o.is_charge and o.status <> 'cancelled' limit 1;
  if v_o is not null then
    delete from public.st_order_items where order_id = v_o and note = 'grocery:fee';
  end if;
  if coalesce(p_fee, 0) <= 0 then return; end if;
  if v_o is null then
    perform pg_advisory_xact_lock(hashtext('st_order_no:' || s.shop_id::text));
    select coalesce(max(order_no), 0) + 1 into v_no from public.st_orders
     where shop_id = s.shop_id
       and created_at >= (date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok');
    insert into public.st_orders (shop_id, session_id, table_id, order_no, status, source, is_charge, note, staff_user_id, status_by_user_id)
    values (s.shop_id, s.id, s.table_id, v_no, 'served', 'staff', true, 'ค่าส่ง', auth.uid(), auth.uid())
    returning id into v_o;
  end if;
  insert into public.st_order_items (shop_id, order_id, item_id, name, unit_price, qty, options, note, line_total)
  values (s.shop_id, v_o, null, '🛵 ค่าส่ง', round(p_fee, 2), 1, '[]'::jsonb, 'grocery:fee', round(p_fee, 2));
end
$$;

-- ---------- ลูกค้าสั่ง (anon) ----------
create or replace function public.st_grocery_order(p_hub_qr text, p_items jsonb, p_name text, p_phone text default null,
                                                   p_pickup_at timestamptz default null, p_note text default null,
                                                   p_client_ref text default null, p_fulfil text default 'pickup',
                                                   p_address text default null, p_lat numeric default null, p_lng numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hub    public.st_tables;
  sh     public.st_shops;
  cfg    jsonb;
  v_res  jsonb;
  q      jsonb;
  v_sess public.st_table_sessions;
  v_sub  numeric;
  v_addr text := nullif(trim(coalesce(p_address, '')), '');
begin
  select * into hub from public.st_tables where qr_token = p_hub_qr and kind = 'hub';
  if hub.id is null or not hub.is_active then raise exception 'st_table_not_found'; end if;
  select * into sh from public.st_shops where id = hub.shop_id;
  cfg := sh.grocery_cfg;
  if p_fulfil not in ('pickup','delivery') then raise exception 'st_bad_request'; end if;
  if p_fulfil = 'delivery' then
    if sh.shop_type <> 'grocery' then raise exception 'st_delivery_off'; end if;
    if v_addr is null or char_length(v_addr) < 5 or char_length(v_addr) > 300 then raise exception 'st_need_address'; end if;
    if nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '') is null
       and coalesce((cfg ->> 'need_phone')::boolean, true) then
      raise exception 'st_need_phone';
    end if;
    q := public.st_grocery_calc(cfg, 'delivery', p_lat, p_lng, null);   -- ตรวจระยะก่อนสร้างบัตรคิว
    if not (q ->> 'ok')::boolean then
      raise exception '%', 'st_grocery_' || (q ->> 'reason') using detail = coalesce(q ->> 'km', '') || '/' || coalesce(q ->> 'max_km', '');
    end if;
  end if;

  v_res := public.st_takeaway_order(p_hub_qr, p_items, p_name, p_phone, p_pickup_at, p_note, p_client_ref);
  select s.* into v_sess from public.st_table_sessions s join public.st_tables t on t.id = s.table_id
   where t.qr_token = v_res ->> 'qr_token' order by s.opened_at desc limit 1;
  if v_sess.fulfil is not null then           -- ส่งซ้ำด้วยรหัสเดิม = ได้บัตรคิวเดิม
    return v_res || jsonb_build_object('fulfil', v_sess.fulfil, 'fee', v_sess.deliver_fee, 'km', v_sess.deliver_km);
  end if;

  select coalesce(sum(o.subtotal), 0) into v_sub from public.st_orders o
   where o.session_id = v_sess.id and o.status <> 'cancelled' and not o.is_charge;
  q := public.st_grocery_calc(cfg, p_fulfil, p_lat, p_lng, v_sub);
  if not (q ->> 'ok')::boolean then
    raise exception '%', 'st_grocery_' || (q ->> 'reason') using detail = coalesce(q ->> 'min', q ->> 'km', '');
  end if;
  update public.st_table_sessions
     set fulfil = p_fulfil,
         deliver_address = case when p_fulfil = 'delivery' then v_addr end,
         deliver_lat = case when p_fulfil = 'delivery' then round(p_lat, 6) end,
         deliver_lng = case when p_fulfil = 'delivery' then round(p_lng, 6) end,
         deliver_km = (q ->> 'km')::numeric,
         deliver_fee = coalesce((q ->> 'fee')::numeric, 0)
   where id = v_sess.id;
  perform public.st_grocery_write_fee(v_sess.id, (q ->> 'fee')::numeric);
  return v_res || jsonb_build_object('fulfil', p_fulfil, 'fee', coalesce((q ->> 'fee')::numeric, 0), 'km', q -> 'km');
end
$$;

-- ลูกค้า: ข้อมูลการส่งของบัตรคิว (หน้าบัตรคิว)
create or replace function public.st_guest_fulfil(p_qr text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('fulfil', s.fulfil, 'address', s.deliver_address, 'km', s.deliver_km, 'fee', s.deliver_fee)
    from public.st_tables t
    join public.st_table_sessions s on s.table_id = t.id
   where t.qr_token = p_qr and t.kind = 'ticket'
   order by s.opened_at desc limit 1;
$$;

-- ---------- พนักงาน: ดูที่อยู่ส่ง / แก้การรับส่งและค่าส่ง (สั่งทางโทรศัพท์ก็ใช้ได้) ----------
create or replace function public.st_delivery_board(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop) then raise exception 'st_forbidden'; end if;
  return jsonb_build_object(
    'cfg', (select grocery_cfg from public.st_shops where id = p_shop),
    'list', coalesce((select jsonb_agg(jsonb_build_object(
              'table_id', s.table_id, 'fulfil', s.fulfil, 'address', s.deliver_address,
              'lat', s.deliver_lat, 'lng', s.deliver_lng, 'km', s.deliver_km, 'fee', s.deliver_fee,
              'phone', s.contact_phone))
             from public.st_table_sessions s
            where s.shop_id = p_shop and s.order_type = 'takeaway' and s.fulfil is not null
              and (s.status <> 'closed' or s.closed_at > now() - interval '2 hours')), '[]'::jsonb));
end
$$;

create or replace function public.st_delivery_set(p_table uuid, p_fulfil text, p_address text default null, p_fee numeric default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.st_table_sessions;
begin
  select * into s from public.st_table_sessions where table_id = p_table and status <> 'closed' and order_type = 'takeaway';
  if s.id is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(s.shop_id, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  if p_fulfil not in ('pickup','delivery') then raise exception 'st_bad_request'; end if;
  if p_fee is not null and (p_fee < 0 or p_fee > 10000) then raise exception 'st_bad_amount'; end if;
  if p_address is not null and char_length(p_address) > 300 then raise exception 'st_bad_request'; end if;
  if exists (select 1 from public.st_payments where session_id = s.id and status = 'paid') then raise exception 'st_partly_paid'; end if;
  update public.st_table_sessions
     set fulfil = p_fulfil,
         deliver_address = case when p_fulfil = 'delivery' then coalesce(nullif(trim(coalesce(p_address, '')), ''), deliver_address) end,
         deliver_fee = case when p_fulfil = 'delivery' then coalesce(p_fee, deliver_fee, 0) else 0 end
   where id = s.id;
  perform public.st_grocery_write_fee(s.id, case when p_fulfil = 'delivery' then coalesce(p_fee, s.deliver_fee, 0) else 0 end);
end
$$;

-- ---------- สิทธิ์ ----------
revoke all on function public.st_km(numeric, numeric, numeric, numeric),
  public.st_grocery_calc(jsonb, text, numeric, numeric, numeric),
  public.st_save_grocery_cfg(uuid, jsonb), public.st_grocery_info(text),
  public.st_grocery_quote(text, text, numeric, numeric, numeric),
  public.st_grocery_write_fee(uuid, numeric),
  public.st_grocery_order(text, jsonb, text, text, timestamptz, text, text, text, text, numeric, numeric),
  public.st_guest_fulfil(text), public.st_delivery_board(uuid), public.st_delivery_set(uuid, text, text, numeric)
from public, anon, authenticated;
grant execute on function public.st_grocery_info(text), public.st_grocery_quote(text, text, numeric, numeric, numeric),
  public.st_grocery_order(text, jsonb, text, text, timestamptz, text, text, text, text, numeric, numeric),
  public.st_guest_fulfil(text) to anon, authenticated;
grant execute on function public.st_save_grocery_cfg(uuid, jsonb), public.st_delivery_board(uuid),
  public.st_delivery_set(uuid, text, text, numeric) to authenticated;

insert into public.st_schema_log (id) values ('st-21-grocery')
on conflict (id) do update set applied_at = now();
