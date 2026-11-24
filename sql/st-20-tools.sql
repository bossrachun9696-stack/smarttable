-- =====================================================================
-- SmartTable · st-20-tools.sql (รอบ M)
-- เช็กระบบ · ปิดกะ/นับเงิน · ต้นทุน/กำไร · ส่งออก Excel · คอมโบ · ขายพ่วง · ตั้งค่าพิมพ์
-- รันซ้ำได้ · ต้องรัน st-01 … st-19 ก่อน
-- ทับ: st_public_menu (ซ่อนต้นทุน), st_menu_admin (ซ่อนต้นทุนจากครัว/เสิร์ฟ/แคชเชียร์)
-- =====================================================================

-- ---------- 1) คอลัมน์ใหม่ ----------
alter table public.st_menu_items add column if not exists cost       numeric(10,2);
alter table public.st_menu_items add column if not exists combo      jsonb;               -- [{id, qty}] = เมนูชุด
alter table public.st_menu_items add column if not exists upsell_ids uuid[] not null default '{}';
alter table public.st_order_items add column if not exists unit_cost numeric(10,2);       -- ต้นทุนตอนสั่ง
alter table public.st_shops add column if not exists tool_cfg jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'st_menu_items_cost_check') then
    alter table public.st_menu_items add constraint st_menu_items_cost_check
      check (cost is null or cost between 0 and 100000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'st_menu_items_combo_check') then
    alter table public.st_menu_items add constraint st_menu_items_combo_check
      check (combo is null or (jsonb_typeof(combo) = 'array' and jsonb_array_length(combo) between 1 and 8));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'st_menu_items_upsell_check') then
    alter table public.st_menu_items add constraint st_menu_items_upsell_check
      check (cardinality(upsell_ids) <= 6);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'st_shops_tool_cfg_check') then
    alter table public.st_shops add constraint st_shops_tool_cfg_check
      check (jsonb_typeof(tool_cfg) = 'object' and octet_length(tool_cfg::text) <= 4000);
  end if;
end
$$;

-- ---------- 2) เช็กระบบ (ทุกคนที่ล็อกอินเรียกได้ · ไม่มีข้อมูลร้าน) ----------
create or replace function public.st_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_cron jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'st_forbidden'; end if;
  begin
    execute $q$select coalesce(jsonb_agg(jobname order by jobname), '[]'::jsonb) from cron.job where jobname like 'st\_%'$q$
       into v_cron;
  exception when others then v_cron := null;    -- ไม่มี pg_cron
  end;
  return jsonb_build_object(
    'now', now(),
    'pg', current_setting('server_version'),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'at', applied_at) order by id)
                         from public.st_schema_log), '[]'::jsonb),
    'buckets', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'public', public) order by id)
                           from storage.buckets where id like 'st-%'), '[]'::jsonb),
    'realtime', coalesce((select jsonb_agg(tablename::text order by tablename) from pg_publication_tables
                           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename like 'st\_%'), '[]'::jsonb),
    'cron', v_cron,
    'rls_off', coalesce((select jsonb_agg(c.relname::text order by c.relname) from pg_class c
                          join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'st\_%'
                           and not c.relrowsecurity), '[]'::jsonb),
    'me', jsonb_build_object('shops', (select count(*) from public.st_shop_members where user_id = auth.uid())));
end
$$;

-- ---------- 3) ตั้งค่าเครื่องมือร้าน (เก็บเฉพาะคีย์ที่ส่ง) ----------
create or replace function public.st_save_tool_cfg(p_shop uuid, p_cfg jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c   jsonb := '{}'::jsonb;
  p   jsonb;
  v   text;
  out jsonb;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_cfg is null or jsonb_typeof(p_cfg) <> 'object' then raise exception 'st_bad_request'; end if;
  if p_cfg ? 'upsell_mode' then
    v := p_cfg ->> 'upsell_mode';
    if v not in ('off','manual','auto','both') then raise exception 'st_bad_request'; end if;
    c := c || jsonb_build_object('upsell_mode', v);
  end if;
  if p_cfg ? 'upsell_max' then
    c := c || jsonb_build_object('upsell_max', greatest(1, least(6, coalesce((p_cfg ->> 'upsell_max')::int, 3))));
  end if;
  if p_cfg ? 'upsell_days' then
    c := c || jsonb_build_object('upsell_days', greatest(7, least(365, coalesce((p_cfg ->> 'upsell_days')::int, 60))));
  end if;
  if p_cfg ? 'combo_save'     then c := c || jsonb_build_object('combo_save',     coalesce((p_cfg ->> 'combo_save')::boolean, true)); end if;
  if p_cfg ? 'combo_stock'    then c := c || jsonb_build_object('combo_stock',    coalesce((p_cfg ->> 'combo_stock')::boolean, false)); end if;
  if p_cfg ? 'shift_required' then c := c || jsonb_build_object('shift_required', coalesce((p_cfg ->> 'shift_required')::boolean, false)); end if;
  if p_cfg ? 'shift_waiter'   then c := c || jsonb_build_object('shift_waiter',   coalesce((p_cfg ->> 'shift_waiter')::boolean, false)); end if;
  if p_cfg ? 'shift_blind'    then c := c || jsonb_build_object('shift_blind',    coalesce((p_cfg ->> 'shift_blind')::boolean, false)); end if;
  if p_cfg ? 'cost_fallback'  then c := c || jsonb_build_object('cost_fallback',  coalesce((p_cfg ->> 'cost_fallback')::boolean, true)); end if;
  if p_cfg ? 'print' then
    p := p_cfg -> 'print';
    if jsonb_typeof(p) <> 'object' then raise exception 'st_bad_request'; end if;
    if coalesce(p ->> 'paper', '58') not in ('58','80') then raise exception 'st_bad_request'; end if;
    if coalesce(p ->> 'font', 'm') not in ('s','m','l') then raise exception 'st_bad_request'; end if;
    if char_length(coalesce(p ->> 'footer', '')) > 200 or char_length(coalesce(p ->> 'header', '')) > 200 then
      raise exception 'st_bad_request';
    end if;
    c := c || jsonb_build_object('print', jsonb_build_object(
      'paper', coalesce(p ->> 'paper', '58'),
      'font', coalesce(p ->> 'font', 'm'),
      'copies', greatest(1, least(3, coalesce((p ->> 'copies')::int, 1))),
      'kitchen_price', coalesce((p ->> 'kitchen_price')::boolean, false),
      'kitchen_big', coalesce((p ->> 'kitchen_big')::boolean, true),
      'logo', coalesce((p ->> 'logo')::boolean, true),
      'header', nullif(trim(coalesce(p ->> 'header', '')), ''),
      'footer', nullif(trim(coalesce(p ->> 'footer', '')), '')));
  end if;
  update public.st_shops set tool_cfg = tool_cfg || c where id = p_shop returning tool_cfg into out;
  return out;
end
$$;

-- ---------- 4) ต้นทุน / คอมโบ / ขายพ่วง ของเมนู (เรียกหลัง st_save_item) ----------
create or replace function public.st_set_item_biz(p_item uuid, p_cost numeric, p_combo jsonb, p_upsell uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop  uuid;
  x       jsonb;
  v_combo jsonb := '[]'::jsonb;
  v_up    uuid[];
  v_id    uuid;
  v_q     int;
begin
  select shop_id into v_shop from public.st_menu_items where id = p_item;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_cost is not null and (p_cost < 0 or p_cost > 100000) then raise exception 'st_bad_price'; end if;

  if p_combo is not null and jsonb_typeof(p_combo) = 'array' and jsonb_array_length(p_combo) > 0 then
    if jsonb_array_length(p_combo) > 8 then raise exception 'st_bad_combo'; end if;
    for x in select * from jsonb_array_elements(p_combo) loop
      v_id := nullif(x ->> 'id', '')::uuid;
      v_q  := coalesce((x ->> 'qty')::int, 1);
      if v_id is null or v_id = p_item or v_q not between 1 and 9
         or not exists (select 1 from public.st_menu_items m where m.id = v_id and m.shop_id = v_shop and m.combo is null)
         or v_combo @> jsonb_build_array(jsonb_build_object('id', v_id)) then
        raise exception 'st_bad_combo';
      end if;
      v_combo := v_combo || jsonb_build_array(jsonb_build_object('id', v_id, 'qty', v_q));
    end loop;
    -- เมนูนี้เป็นส่วนประกอบของชุดอื่นอยู่ ห้ามเป็นชุดซ้อน
    if exists (select 1 from public.st_menu_items m where m.shop_id = v_shop and m.combo @> jsonb_build_array(jsonb_build_object('id', p_item))) then
      raise exception 'st_bad_combo';
    end if;
  end if;

  select coalesce(array_agg(distinct u), '{}') into v_up
    from unnest(coalesce(p_upsell, '{}')) u
   where u <> p_item and exists (select 1 from public.st_menu_items m where m.id = u and m.shop_id = v_shop);
  if cardinality(v_up) > 6 then raise exception 'st_bad_request'; end if;

  update public.st_menu_items
     set cost = case when p_cost is null then null else round(p_cost, 2) end,
         combo = case when jsonb_array_length(v_combo) = 0 then null else v_combo end,
         upsell_ids = v_up
   where id = p_item;
end
$$;

-- ---------- 5) ซ่อนต้นทุนจากลูกค้า และพนักงานที่ไม่ใช่เจ้าของ/ผู้จัดการ ----------
create or replace function public.st_menu_strip_cost(p_menu jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_set(p_menu, '{items}', coalesce((
    select jsonb_agg(i - 'cost') from jsonb_array_elements(p_menu -> 'items') i), '[]'::jsonb));
$$;

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
  return public.st_menu_strip_cost(public.st_menu_json(v_shop));
end
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
  if public.st_has_shop_role(p_shop, array['owner','manager']) then
    return public.st_menu_json(p_shop);
  end if;
  return public.st_menu_strip_cost(public.st_menu_json(p_shop));
end
$$;

-- ---------- 6) ตอนสั่ง: จำต้นทุน + ใส่ส่วนประกอบชุดให้ครัวเห็น (+ ตัดจำนวนเหลือของส่วนประกอบถ้าตั้งไว้) ----------
create or replace function public.st_order_items_biz()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m   public.st_menu_items;
  x   jsonb;
  c   public.st_menu_items;
  v_stock boolean;
begin
  if new.item_id is null then return new; end if;
  select * into m from public.st_menu_items where id = new.item_id;
  if m.id is null then return new; end if;
  new.unit_cost := m.cost;
  if m.combo is not null then
    select coalesce((tool_cfg ->> 'combo_stock')::boolean, false) into v_stock from public.st_shops where id = new.shop_id;
    for x in select * from jsonb_array_elements(m.combo) loop
      select * into c from public.st_menu_items where id = (x ->> 'id')::uuid;
      continue when c.id is null;
      new.options := coalesce(new.options, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'group', 'ชุด', 'name', c.name || ' ×' || ((x ->> 'qty')::int * new.qty), 'price_delta', 0, 'combo', true));
      if v_stock and c.stock_left is not null then
        if c.stock_left < (x ->> 'qty')::int * new.qty then
          raise exception 'st_out_of_stock' using detail = c.name;
        end if;
        update public.st_menu_items
           set stock_left = stock_left - (x ->> 'qty')::int * new.qty,
               is_available = (stock_left - (x ->> 'qty')::int * new.qty) > 0
         where id = c.id;
      end if;
    end loop;
  end if;
  return new;
end
$$;
drop trigger if exists st_order_items_biz on public.st_order_items;
create trigger st_order_items_biz
  before insert on public.st_order_items
  for each row execute function public.st_order_items_biz();

-- ---------- 7) ขายพ่วง: "มักสั่งคู่กับ…" (ลูกค้า · anon) ----------
create or replace function public.st_guest_upsell(p_qr text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  cfg    jsonb;
  v_mode text;
  v_max  int;
  v_days int;
  v_auto jsonb := '{}'::jsonb;
  v_man  jsonb := '{}'::jsonb;
  v_out  jsonb := '{}'::jsonb;
  k      text;
  ids    jsonb;
  arr    jsonb;
begin
  select t.shop_id, s.tool_cfg into v_shop, cfg
    from public.st_tables t join public.st_shops s on s.id = t.shop_id
   where t.qr_token = p_qr and t.is_active and s.status = 'active';
  if v_shop is null then raise exception 'st_table_not_found'; end if;
  v_mode := coalesce(cfg ->> 'upsell_mode', 'auto');
  v_max  := coalesce((cfg ->> 'upsell_max')::int, 3);
  v_days := coalesce((cfg ->> 'upsell_days')::int, 60);
  if v_mode = 'off' then
    return jsonb_build_object('mode', v_mode, 'max', v_max, 'combo_save', coalesce((cfg ->> 'combo_save')::boolean, true), 'pairs', '{}'::jsonb);
  end if;

  if v_mode in ('manual','both') then
    select coalesce(jsonb_object_agg(m.id, (select coalesce(jsonb_agg(u), '[]'::jsonb) from unnest(m.upsell_ids) u
                                              join public.st_menu_items z on z.id = u and z.is_available)), '{}'::jsonb)
      into v_man
      from public.st_menu_items m
     where m.shop_id = v_shop and cardinality(m.upsell_ids) > 0;
  end if;

  if v_mode in ('auto','both') then
    with sess as (
      select distinct o.session_id, o.created_at from public.st_orders o
       where o.shop_id = v_shop and o.created_at > now() - make_interval(days => v_days)
         and o.status <> 'cancelled' and not o.is_charge
       order by o.created_at desc limit 3000
    ), it as (
      select distinct o.session_id, i.item_id
        from public.st_orders o join public.st_order_items i on i.order_id = o.id
       where o.session_id in (select session_id from sess) and o.status <> 'cancelled' and i.item_id is not null
    ), pairs as (
      select a.item_id x, b.item_id y, count(*) n
        from it a join it b on a.session_id = b.session_id and a.item_id <> b.item_id
       group by 1, 2 having count(*) >= 2
    ), ranked as (
      select p.x, p.y, row_number() over (partition by p.x order by p.n desc, p.y) rn
        from pairs p join public.st_menu_items m on m.id = p.y and m.is_available
    )
    select coalesce(jsonb_object_agg(x, ys), '{}'::jsonb) into v_auto
      from (select x, jsonb_agg(y order by rn) ys from ranked where rn <= 6 group by x) q;
  end if;

  -- รวม: ตั้งเองก่อน แล้วเติมด้วยอัตโนมัติ (ไม่ซ้ำ) · ตัดตามจำนวนสูงสุด
  for k in select distinct key from (select jsonb_object_keys(v_man) key union select jsonb_object_keys(v_auto)) z loop
    arr := '[]'::jsonb;
    for ids in select value from jsonb_array_elements(coalesce(v_man -> k, '[]'::jsonb) || coalesce(v_auto -> k, '[]'::jsonb)) loop
      if not arr @> jsonb_build_array(ids) and jsonb_array_length(arr) < v_max then arr := arr || jsonb_build_array(ids); end if;
    end loop;
    if jsonb_array_length(arr) > 0 then v_out := v_out || jsonb_build_object(k, arr); end if;
  end loop;
  return jsonb_build_object('mode', v_mode, 'max', v_max, 'combo_save', coalesce((cfg ->> 'combo_save')::boolean, true), 'pairs', v_out);
end
$$;

-- ---------- 8) ปิดกะ / นับเงินลิ้นชัก ----------
create table if not exists public.st_shifts (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.st_shops(id) on delete cascade,
  opened_at          timestamptz not null default now(),
  opened_by_user_id  uuid references auth.users(id) on delete set null,
  opening_cash       numeric(12,2) not null default 0 check (opening_cash between 0 and 10000000),
  closed_at          timestamptz,
  closed_by_user_id  uuid references auth.users(id) on delete set null,
  counted_cash       numeric(12,2) check (counted_cash is null or counted_cash between 0 and 10000000),
  expected_cash      numeric(12,2),
  summary            jsonb,
  note               text check (note is null or char_length(note) <= 300),
  unique (id, shop_id)
);
create unique index if not exists st_shifts_one_open on public.st_shifts (shop_id) where closed_at is null;
create index if not exists st_shifts_shop_idx on public.st_shifts (shop_id, opened_at desc);
alter table public.st_shifts enable row level security;
revoke all on public.st_shifts from anon, authenticated;

create table if not exists public.st_shift_moves (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null,
  shift_id    uuid not null,
  amount      numeric(12,2) not null check (amount <> 0 and abs(amount) <= 1000000),
  reason      text not null check (char_length(reason) between 1 and 100),
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (shift_id, shop_id) references public.st_shifts (id, shop_id) on delete cascade
);
create index if not exists st_shift_moves_shift_idx on public.st_shift_moves (shift_id);
alter table public.st_shift_moves enable row level security;
revoke all on public.st_shift_moves from anon, authenticated;

create or replace function public.st_shift_role_ok(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.st_has_shop_role(p_shop, array['owner','manager','cashier'])
      or (public.st_has_shop_role(p_shop, array['waiter'])
          and coalesce((select (tool_cfg ->> 'shift_waiter')::boolean from public.st_shops where id = p_shop), false));
$$;

-- สรุปเงินของกะ (ภายใน)
create or replace function public.st_shift_calc(p_shift public.st_shifts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with paid as (
    select p.* from public.st_payments p
     where p.shop_id = p_shift.shop_id and p.status = 'paid'
       and p.created_at >= p_shift.opened_at and p.created_at < coalesce(p_shift.closed_at, now())
  ), tend as (
    select t ->> 'method' as method, (t ->> 'amount')::numeric as amount, paid.id
      from paid, jsonb_array_elements(coalesce(paid.tenders,
                   jsonb_build_array(jsonb_build_object('method', paid.method, 'amount', paid.total)))) t
  ), mv as (
    select * from public.st_shift_moves where shift_id = p_shift.id
  ), vd as (
    select * from public.st_payments p
     where p.shop_id = p_shift.shop_id and p.status = 'void'
       and p.voided_at >= p_shift.opened_at and p.voided_at < coalesce(p_shift.closed_at, now())
  )
  select jsonb_build_object(
    'bills', (select count(*) from paid),
    'net', (select coalesce(sum(total), 0) from paid),
    'discount', (select coalesce(sum(discount), 0) from paid),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'bills', n, 'total', t) order by t desc)
                             from (select method, count(distinct id) n, sum(amount) t from tend group by method) m), '[]'::jsonb),
    'cash_sales', (select coalesce(sum(amount), 0) from tend where method = 'cash'),
    'moves_in', (select coalesce(sum(amount), 0) from mv where amount > 0),
    'moves_out', (select coalesce(-sum(amount), 0) from mv where amount < 0),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('amount', amount, 'reason', reason, 'at', created_at,
                                                           'by', (select pr.display_name from public.st_profiles pr where pr.user_id = mv.user_id))
                                        order by created_at) from mv), '[]'::jsonb),
    'voided', jsonb_build_object('count', (select count(*) from vd), 'amount', (select coalesce(sum(total), 0) from vd)),
    'opening', p_shift.opening_cash,
    'expected', p_shift.opening_cash + (select coalesce(sum(amount), 0) from tend where method = 'cash')
                + (select coalesce(sum(amount), 0) from mv));
$$;

create or replace function public.st_shift_json(p_shift public.st_shifts, p_blind boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_shift.id, 'opened_at', p_shift.opened_at, 'closed_at', p_shift.closed_at,
    'opening_cash', p_shift.opening_cash, 'counted_cash', p_shift.counted_cash,
    'expected_cash', p_shift.expected_cash, 'note', p_shift.note,
    'opened_by', (select display_name from public.st_profiles where user_id = p_shift.opened_by_user_id),
    'closed_by', (select display_name from public.st_profiles where user_id = p_shift.closed_by_user_id),
    'summary', case when p_shift.closed_at is not null then p_shift.summary
                    when p_blind then (public.st_shift_calc(p_shift) - 'expected' - 'cash_sales' - 'by_method' - 'net')
                    else public.st_shift_calc(p_shift) end);
$$;

create or replace function public.st_shift_status(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s       public.st_shifts;
  cfg     jsonb;
  v_boss  boolean;
  v_blind boolean;
begin
  if not public.st_has_shop_role(p_shop) then raise exception 'st_forbidden'; end if;
  select tool_cfg into cfg from public.st_shops where id = p_shop;
  v_boss  := public.st_has_shop_role(p_shop, array['owner','manager']);
  v_blind := coalesce((cfg ->> 'shift_blind')::boolean, false) and not v_boss;   -- นับแบบไม่เห็นยอดที่ควรมี
  select * into s from public.st_shifts where shop_id = p_shop and closed_at is null;
  return jsonb_build_object(
    'now', now(),
    'can', public.st_shift_role_ok(p_shop), 'boss', v_boss, 'blind', v_blind,
    'required', coalesce((cfg ->> 'shift_required')::boolean, false),
    'open', case when s.id is null then null else public.st_shift_json(s, v_blind) end,
    'history', case when v_boss then coalesce((
       select jsonb_agg(public.st_shift_json(h, false) order by h.opened_at desc)
         from (select * from public.st_shifts where shop_id = p_shop and closed_at is not null
                order by opened_at desc limit 30) h), '[]'::jsonb) else '[]'::jsonb end);
end
$$;

create or replace function public.st_shift_open(p_shop uuid, p_cash numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.st_shift_role_ok(p_shop) then raise exception 'st_forbidden'; end if;
  if p_cash is null or p_cash < 0 or p_cash > 10000000 then raise exception 'st_bad_amount'; end if;
  begin
    insert into public.st_shifts (shop_id, opened_by_user_id, opening_cash) values (p_shop, auth.uid(), round(p_cash, 2));
  exception when unique_violation then
    raise exception 'st_shift_open_already';
  end;
  return public.st_shift_status(p_shop);
end
$$;

create or replace function public.st_shift_move(p_shop uuid, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare s public.st_shifts;
begin
  if not public.st_shift_role_ok(p_shop) then raise exception 'st_forbidden'; end if;
  select * into s from public.st_shifts where shop_id = p_shop and closed_at is null;
  if s.id is null then raise exception 'st_shift_closed'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then raise exception 'st_bad_amount'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 1 and 100 then raise exception 'st_bad_request'; end if;
  insert into public.st_shift_moves (shop_id, shift_id, amount, reason, user_id)
  values (p_shop, s.id, round(p_amount, 2), trim(p_reason), auth.uid());
  return public.st_shift_status(p_shop);
end
$$;

create or replace function public.st_shift_close(p_shop uuid, p_counted numeric, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s   public.st_shifts;
  sm  jsonb;
  v_e numeric;
begin
  if not public.st_shift_role_ok(p_shop) then raise exception 'st_forbidden'; end if;
  if p_counted is null or p_counted < 0 or p_counted > 10000000 then raise exception 'st_bad_amount'; end if;
  if p_note is not null and char_length(p_note) > 300 then raise exception 'st_bad_request'; end if;
  select * into s from public.st_shifts where shop_id = p_shop and closed_at is null for update;
  if s.id is null then raise exception 'st_shift_closed'; end if;
  s.closed_at := now();
  sm := public.st_shift_calc(s);
  v_e := (sm ->> 'expected')::numeric;
  update public.st_shifts
     set closed_at = s.closed_at, closed_by_user_id = auth.uid(), counted_cash = round(p_counted, 2),
         expected_cash = v_e, summary = sm || jsonb_build_object('counted', round(p_counted, 2), 'diff', round(p_counted, 2) - v_e),
         note = nullif(trim(coalesce(p_note, '')), '')
   where id = s.id;
  perform public.st_audit(p_shop, 'shift_close', null, round(p_counted, 2) - v_e,
                          jsonb_build_object('expected', v_e, 'counted', round(p_counted, 2)));
  select * into s from public.st_shifts where id = s.id;
  return jsonb_build_object('shift', public.st_shift_json(s, false));
end
$$;

-- บังคับเปิดกะก่อนรับเงิน (ถ้าร้านตั้งไว้)
create or replace function public.st_payments_shift_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select (tool_cfg ->> 'shift_required')::boolean from public.st_shops where id = new.shop_id), false)
     and not exists (select 1 from public.st_shifts where shop_id = new.shop_id and closed_at is null) then
    raise exception 'st_shift_closed';
  end if;
  return new;
end
$$;
drop trigger if exists st_payments_shift_guard on public.st_payments;
create trigger st_payments_shift_guard
  before insert on public.st_payments
  for each row execute function public.st_payments_shift_guard();

-- ---------- 9) ต้นทุน / กำไร ----------
create or replace function public.st_profit_report(p_shop uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz    text := 'Asia/Bangkok';
  v_start timestamptz;
  v_end   timestamptz;
  v_fb    boolean;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then raise exception 'st_bad_date_range'; end if;
  v_start := p_from::timestamp at time zone v_tz;
  v_end   := (p_to + 1)::timestamp at time zone v_tz;
  select coalesce((tool_cfg ->> 'cost_fallback')::boolean, true) into v_fb from public.st_shops where id = p_shop;
  return (
    with paid as (
      select distinct p.session_id from public.st_payments p
       where p.shop_id = p_shop and p.status = 'paid' and p.created_at >= v_start and p.created_at < v_end
    ), li as (
      select i.name, i.qty, i.line_total,
             coalesce(i.unit_cost, case when v_fb then m.cost end) as uc
        from paid
        join public.st_orders o on o.session_id = paid.session_id and o.status <> 'cancelled'
        join public.st_order_items i on i.order_id = o.id
        left join public.st_menu_items m on m.id = i.item_id
    ), agg as (
      select name, sum(qty) q, sum(line_total) r,
             sum(uc * qty) filter (where uc is not null) c,
             bool_or(uc is null) missing
        from li group by name
    )
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'fallback', v_fb,
      'totals', jsonb_build_object(
        'revenue', (select coalesce(sum(r), 0) from agg),
        'revenue_known', (select coalesce(sum(r), 0) from agg where not missing),
        'cost', (select coalesce(sum(c), 0) from agg where not missing),
        'missing', (select count(*) from agg where missing)),
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'revenue', r,
                                         'cost', case when missing then null else c end,
                                         'profit', case when missing then null else r - c end) order by r desc)
                           from agg), '[]'::jsonb))
  );
end
$$;

-- ---------- 10) ส่งออก (Excel / CSV) ----------
create or replace function public.st_export(p_shop uuid, p_from date, p_to date, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz    text := 'Asia/Bangkok';
  v_start timestamptz;
  v_end   timestamptz;
  v_rows  jsonb;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then raise exception 'st_bad_date_range'; end if;
  v_start := p_from::timestamp at time zone v_tz;
  v_end   := (p_to + 1)::timestamp at time zone v_tz;

  if p_kind = 'receipts' then
    select coalesce(jsonb_agg(r order by r ->> 'at'), '[]'::jsonb) into v_rows from (
      select jsonb_build_object(
        'at', to_char(p.created_at at time zone v_tz, 'YYYY-MM-DD HH24:MI'),
        'receipt_no', to_char(p.created_at at time zone v_tz, 'YYYYMMDD') || '-' || lpad(p.receipt_no::text, 3, '0'),
        'table', t.label, 'status', p.status, 'method', p.method,
        'subtotal', p.subtotal, 'discount', p.discount, 'service', p.service, 'vat', p.vat, 'total', p.total,
        'cash', coalesce((select sum((x ->> 'amount')::numeric) from jsonb_array_elements(p.tenders) x where x ->> 'method' = 'cash'), 0),
        'by', (select display_name from public.st_profiles where user_id = p.received_by_user_id)) r
        from public.st_payments p join public.st_tables t on t.id = p.table_id
       where p.shop_id = p_shop and p.created_at >= v_start and p.created_at < v_end
       limit 20000) z;
  elsif p_kind = 'items' then
    select coalesce(jsonb_agg(r order by r ->> 'at'), '[]'::jsonb) into v_rows from (
      select jsonb_build_object(
        'at', to_char(o.created_at at time zone v_tz, 'YYYY-MM-DD HH24:MI'),
        'order_no', o.order_no, 'table', t.label, 'status', o.status, 'to_go', o.to_go,
        'name', i.name, 'options', (select string_agg(x ->> 'name', ', ') from jsonb_array_elements(i.options) x),
        'qty', i.qty, 'unit_price', i.unit_price, 'line_total', i.line_total,
        'unit_cost', i.unit_cost, 'cost_total', i.unit_cost * i.qty) r
        from public.st_orders o
        join public.st_order_items i on i.order_id = o.id
        join public.st_tables t on t.id = o.table_id
       where o.shop_id = p_shop and o.created_at >= v_start and o.created_at < v_end
       limit 20000) z;
  elsif p_kind = 'daily' then
    with paid as (
      select p.*, (p.created_at at time zone v_tz)::date d from public.st_payments p
       where p.shop_id = p_shop and p.status = 'paid' and p.created_at >= v_start and p.created_at < v_end
    ), tend as (
      select paid.d, t ->> 'method' m, (t ->> 'amount')::numeric a
        from paid, jsonb_array_elements(coalesce(paid.tenders, jsonb_build_array(jsonb_build_object('method', paid.method, 'amount', paid.total)))) t
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'day', d, 'bills', n, 'gross', g, 'discount', ds, 'service', sv, 'vat', vt, 'net', nt,
             'cash', (select coalesce(sum(a), 0) from tend where tend.d = x.d and m = 'cash'),
             'promptpay', (select coalesce(sum(a), 0) from tend where tend.d = x.d and m = 'promptpay'),
             'transfer', (select coalesce(sum(a), 0) from tend where tend.d = x.d and m = 'transfer'),
             'card', (select coalesce(sum(a), 0) from tend where tend.d = x.d and m = 'card')) order by d), '[]'::jsonb)
      into v_rows
      from (select d, count(*) n, sum(subtotal) g, sum(discount) ds, sum(service) sv, sum(vat) vt, sum(total) nt
              from paid group by d) x;
  elsif p_kind = 'profit' then
    v_rows := public.st_profit_report(p_shop, p_from, p_to) -> 'items';
  elsif p_kind = 'shifts' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'opened_at', to_char(s.opened_at at time zone v_tz, 'YYYY-MM-DD HH24:MI'),
             'closed_at', to_char(s.closed_at at time zone v_tz, 'YYYY-MM-DD HH24:MI'),
             'opening', s.opening_cash, 'cash_sales', s.summary -> 'cash_sales',
             'moves_in', s.summary -> 'moves_in', 'moves_out', s.summary -> 'moves_out',
             'expected', s.expected_cash, 'counted', s.counted_cash, 'diff', s.counted_cash - s.expected_cash,
             'opened_by', (select display_name from public.st_profiles where user_id = s.opened_by_user_id),
             'closed_by', (select display_name from public.st_profiles where user_id = s.closed_by_user_id),
             'note', s.note) order by s.opened_at), '[]'::jsonb)
      into v_rows
      from public.st_shifts s
     where s.shop_id = p_shop and s.closed_at is not null and s.opened_at >= v_start and s.opened_at < v_end;
  elsif p_kind = 'menu' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'category', c.name, 'name', m.name, 'price', m.price, 'cost', m.cost,
             'margin', case when m.cost is null then null else m.price - m.cost end,
             'available', m.is_available, 'stock_left', m.stock_left,
             'combo', m.combo is not null) order by c.sort nulls last, m.sort), '[]'::jsonb)
      into v_rows
      from public.st_menu_items m left join public.st_categories c on c.id = m.category_id
     where m.shop_id = p_shop;
  else
    raise exception 'st_bad_request';
  end if;
  return jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'rows', v_rows);
end
$$;

-- ---------- สิทธิ์ ----------
revoke all on function public.st_health(), public.st_save_tool_cfg(uuid, jsonb),
  public.st_set_item_biz(uuid, numeric, jsonb, uuid[]), public.st_menu_strip_cost(jsonb),
  public.st_order_items_biz(), public.st_guest_upsell(text), public.st_shift_role_ok(uuid),
  public.st_shift_calc(public.st_shifts), public.st_shift_json(public.st_shifts, boolean),
  public.st_shift_status(uuid), public.st_shift_open(uuid, numeric), public.st_shift_move(uuid, numeric, text),
  public.st_shift_close(uuid, numeric, text), public.st_payments_shift_guard(),
  public.st_profit_report(uuid, date, date), public.st_export(uuid, date, date, text)
from public, anon, authenticated;
grant execute on function public.st_health(), public.st_save_tool_cfg(uuid, jsonb),
  public.st_set_item_biz(uuid, numeric, jsonb, uuid[]),
  public.st_shift_status(uuid), public.st_shift_open(uuid, numeric), public.st_shift_move(uuid, numeric, text),
  public.st_shift_close(uuid, numeric, text),
  public.st_profit_report(uuid, date, date), public.st_export(uuid, date, date, text) to authenticated;
grant execute on function public.st_guest_upsell(text) to anon, authenticated;
grant execute on function public.st_public_menu(text) to anon, authenticated;
grant execute on function public.st_menu_admin(uuid) to authenticated;

insert into public.st_schema_log (id) values ('st-20-tools')
on conflict (id) do update set applied_at = now();
