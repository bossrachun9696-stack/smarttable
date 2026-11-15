-- =====================================================================
-- SmartTable · st-05-orders.sql  (รันซ้ำได้ · ต้องรัน st-01 ถึง st-04 ก่อน)
-- ลูกค้าสั่งอาหาร, รายการที่สั่ง, ยอดบิล, เรียกพนักงาน / ขอเช็กบิล
--
-- * ลูกค้าไม่ต้องล็อกอิน: ทุกคำสั่งต้องมี qr_token ของโต๊ะ + session_token ของรอบ (ได้จาก st_scan)
-- * ราคาคิดฝั่งเซิร์ฟเวอร์ทั้งหมด (ลูกค้าส่งแค่ id เมนู / id ตัวเลือก / จำนวน)
-- * ชื่อและราคาถูกบันทึกลงออร์เดอร์ (แก้เมนูทีหลังไม่กระทบออร์เดอร์เก่า)
-- * เลขออร์เดอร์นับใหม่ทุกวัน (เวลาไทย) แยกตามร้าน
-- =====================================================================

-- ---------- 1) ตาราง ----------
create table if not exists public.st_orders (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null,
  session_id         uuid not null,
  table_id           uuid not null,
  order_no           int  not null,
  status             text not null default 'new'
                     check (status in ('new','accepted','cooking','served','cancelled')),
  source             text not null default 'guest' check (source in ('guest','staff')),
  guest_name         text check (guest_name is null or char_length(guest_name) <= 30),
  note               text check (note is null or char_length(note) <= 200),
  subtotal           numeric(12,2) not null default 0 check (subtotal >= 0),
  client_ref         text check (client_ref is null or char_length(client_ref) <= 64),
  staff_user_id      uuid references auth.users(id) on delete set null,
  status_by_user_id  uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, shop_id),
  unique (session_id, client_ref),
  foreign key (session_id, shop_id) references public.st_table_sessions (id, shop_id) on delete cascade,
  foreign key (table_id, shop_id)   references public.st_tables (id, shop_id) on delete cascade
);
create index if not exists st_orders_shop_idx    on public.st_orders (shop_id, created_at desc);
create index if not exists st_orders_session_idx on public.st_orders (session_id, created_at);

create table if not exists public.st_order_items (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null,
  order_id    uuid not null,
  item_id     uuid,
  name        text not null,
  unit_price  numeric(10,2) not null check (unit_price >= 0),
  qty         smallint not null check (qty between 1 and 99),
  options     jsonb not null default '[]'::jsonb,    -- [{group, name, price_delta}]
  note        text check (note is null or char_length(note) <= 140),
  line_total  numeric(12,2) not null check (line_total >= 0),
  foreign key (order_id, shop_id) references public.st_orders (id, shop_id) on delete cascade,
  foreign key (item_id, shop_id)  references public.st_menu_items (id, shop_id) on delete set null (item_id)
);
create index if not exists st_order_items_order_idx on public.st_order_items (order_id);

create table if not exists public.st_service_calls (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid not null,
  table_id            uuid not null,
  session_id          uuid not null,
  kind                text not null check (kind in ('call','bill')),
  status              text not null default 'pending' check (status in ('pending','done')),
  created_at          timestamptz not null default now(),
  handled_at          timestamptz,
  handled_by_user_id  uuid references auth.users(id) on delete set null,
  foreign key (session_id, shop_id) references public.st_table_sessions (id, shop_id) on delete cascade,
  foreign key (table_id, shop_id)   references public.st_tables (id, shop_id) on delete cascade
);
-- เรียกซ้ำระหว่างรอ = ไม่สร้างใหม่
create unique index if not exists st_service_calls_one_pending
  on public.st_service_calls (session_id, kind) where status = 'pending';
create index if not exists st_service_calls_shop_idx on public.st_service_calls (shop_id, status);

drop trigger if exists st_orders_touch on public.st_orders;
create trigger st_orders_touch
  before update on public.st_orders
  for each row execute function public.st_touch_updated_at();

-- ---------- 2) RLS: สมาชิกร้านอ่านได้ · เขียนผ่าน RPC ----------
alter table public.st_orders        enable row level security;
alter table public.st_order_items   enable row level security;
alter table public.st_service_calls enable row level security;

drop policy if exists st_orders_select_member on public.st_orders;
create policy st_orders_select_member on public.st_orders
  for select to authenticated using (public.st_has_shop_role(shop_id));

drop policy if exists st_order_items_select_member on public.st_order_items;
create policy st_order_items_select_member on public.st_order_items
  for select to authenticated using (public.st_has_shop_role(shop_id));

drop policy if exists st_service_calls_select_member on public.st_service_calls;
create policy st_service_calls_select_member on public.st_service_calls
  for select to authenticated using (public.st_has_shop_role(shop_id));

revoke all on public.st_orders, public.st_order_items, public.st_service_calls from anon, authenticated;
grant select on public.st_orders, public.st_order_items, public.st_service_calls to authenticated;

-- ---------- 3) ตัวช่วยภายใน (ไม่เปิดให้แอปเรียกตรง) ----------
-- ตรวจ qr + session_token -> รอบที่ยังไม่ปิด
create or replace function public.st_guest_session(p_qr text, p_token text)
returns public.st_table_sessions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.st_table_sessions;
begin
  select s.* into v
    from public.st_table_sessions s
    join public.st_tables t  on t.id = s.table_id
    join public.st_shops  sh on sh.id = s.shop_id
   where t.qr_token = p_qr and t.is_active and sh.status = 'active'
     and s.session_token = p_token and s.status <> 'closed';
  if not found then raise exception 'st_session_invalid'; end if;
  return v;
end
$$;

-- ยอดบิลของรอบ (ไม่นับออร์เดอร์ที่ยกเลิก)
create or replace function public.st_bill_json(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.st_shops;
  v_sub  numeric;
  v_svc  numeric;
  v_vat  numeric;
  v_tot  numeric;
begin
  select sh.* into v_shop
    from public.st_table_sessions s join public.st_shops sh on sh.id = s.shop_id
   where s.id = p_session;
  select coalesce(sum(subtotal), 0) into v_sub
    from public.st_orders where session_id = p_session and status <> 'cancelled';
  v_svc := round(v_sub * v_shop.service_pct / 100, 2);
  if v_shop.vat_included then
    v_vat := round((v_sub + v_svc) * v_shop.vat_pct / (100 + v_shop.vat_pct), 2);   -- รวมอยู่ในราคาแล้ว
    v_tot := v_sub + v_svc;
  else
    v_vat := round((v_sub + v_svc) * v_shop.vat_pct / 100, 2);
    v_tot := v_sub + v_svc + v_vat;
  end if;
  return jsonb_build_object('subtotal', v_sub, 'service', v_svc, 'service_pct', v_shop.service_pct,
                            'vat', v_vat, 'vat_pct', v_shop.vat_pct, 'vat_included', v_shop.vat_included,
                            'total', v_tot);
end
$$;

-- ออร์เดอร์ทั้งหมดของรอบ พร้อมรายการ
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
                                                 'options', i.options, 'note', i.note, 'line_total', i.line_total)
                              order by i.id)
               from public.st_order_items i where i.order_id = o.id), '[]'::jsonb))
         order by o.created_at), '[]'::jsonb)
    from public.st_orders o where o.session_id = p_session;
$$;

-- ---------- 4) RPC ลูกค้า (ไม่ต้องล็อกอิน) ----------
-- p_items = [ { item_id, qty, choices: [choice_id, …], note? }, … ]
-- p_client_ref = รหัสสุ่มจากหน้าเว็บ กันกดส่งซ้ำ (ส่งซ้ำด้วยรหัสเดิม = ได้ออร์เดอร์เดิมกลับ)
create or replace function public.st_place_order(p_qr text, p_session_token text, p_items jsonb,
                                                 p_note text default null, p_guest_name text default null,
                                                 p_client_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess     public.st_table_sessions;
  v_shop     public.st_shops;
  v_item     public.st_menu_items;
  v_ref      text := nullif(trim(coalesce(p_client_ref, '')), '');
  v_order    uuid;
  v_no       int;
  v_sub      numeric := 0;
  v_line     jsonb;
  v_qty      int;
  v_lnote    text;
  v_choices  uuid[];
  v_extra    numeric;
  v_opts     jsonb;
  v_unit     numeric;
  v_grp      record;
  v_cnt      int;
begin
  v_sess := public.st_guest_session(p_qr, p_session_token);

  -- ส่งซ้ำ (เน็ตหลุดแล้วกดใหม่) -> คืนออร์เดอร์เดิม
  if v_ref is not null then
    select o.id, o.order_no, o.subtotal into v_order, v_no, v_sub
      from public.st_orders o where o.session_id = v_sess.id and o.client_ref = v_ref;
    if found then
      return jsonb_build_object('order_id', v_order, 'order_no', v_no, 'subtotal', v_sub, 'duplicate', true);
    end if;
    v_order := null; v_no := null; v_sub := 0;       -- select into ที่ไม่เจอจะตั้งค่าเป็น null
  end if;

  if v_sess.status <> 'open' then raise exception 'st_session_billing'; end if;
  select * into v_shop from public.st_shops where id = v_sess.shop_id;
  if not v_shop.is_open then raise exception 'st_shop_closed'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'st_bad_cart';
  end if;
  if char_length(coalesce(p_note, '')) > 200 or char_length(coalesce(p_guest_name, '')) > 30 then
    raise exception 'st_bad_cart';
  end if;
  if (select count(*) from public.st_orders
       where session_id = v_sess.id and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'st_too_many_orders';
  end if;

  -- เลขออร์เดอร์ของวัน (กันชนกันด้วย lock ต่อร้าน)
  perform pg_advisory_xact_lock(hashtext('st_order_no:' || v_shop.id::text));
  select coalesce(max(order_no), 0) + 1 into v_no
    from public.st_orders
   where shop_id = v_shop.id
     and created_at >= (date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok');

  insert into public.st_orders (shop_id, session_id, table_id, order_no, guest_name, note, client_ref)
  values (v_shop.id, v_sess.id, v_sess.table_id, v_no,
          nullif(trim(coalesce(p_guest_name, '')), ''), nullif(trim(coalesce(p_note, '')), ''), v_ref)
  returning id into v_order;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_item := null;                                   -- กันค่าค้างจากรอบก่อน
    begin
      select * into v_item from public.st_menu_items
       where id = (v_line ->> 'item_id')::uuid and shop_id = v_shop.id;
    exception when invalid_text_representation then
      raise exception 'st_bad_cart';
    end;
    if v_item.id is null then raise exception 'st_item_gone'; end if;
    if not v_item.is_available then raise exception 'st_item_sold_out' using detail = v_item.name; end if;

    v_qty := coalesce((v_line ->> 'qty')::int, 0);
    if v_qty not between 1 and 20 then raise exception 'st_bad_cart'; end if;
    v_lnote := nullif(trim(coalesce(v_line ->> 'note', '')), '');
    if char_length(coalesce(v_lnote, '')) > 140 then raise exception 'st_bad_cart'; end if;

    begin
      select coalesce(array_agg(distinct x::uuid), '{}') into v_choices
        from jsonb_array_elements_text(
               case when jsonb_typeof(v_line -> 'choices') = 'array' then v_line -> 'choices' else '[]'::jsonb end) x;
    exception when invalid_text_representation then
      raise exception 'st_bad_cart';
    end;

    -- ตัวเลือกทุกตัวต้องเป็นของเมนูนี้
    if exists (select 1 from unnest(v_choices) c
                where not exists (select 1 from public.st_option_choices ch
                                    join public.st_option_groups g on g.id = ch.group_id
                                   where ch.id = c and g.item_id = v_item.id)) then
      raise exception 'st_options_changed' using detail = v_item.name;
    end if;
    -- จำนวนที่เลือกในแต่ละกลุ่มต้องอยู่ในช่วงที่ร้านตั้ง
    for v_grp in select g.id, g.name, g.min_select, g.max_select
                   from public.st_option_groups g where g.item_id = v_item.id loop
      select count(*) into v_cnt from public.st_option_choices ch
       where ch.group_id = v_grp.id and ch.id = any (v_choices);
      if v_cnt < v_grp.min_select or v_cnt > v_grp.max_select then
        raise exception 'st_options_required' using detail = v_item.name || ' · ' || v_grp.name;
      end if;
    end loop;

    select coalesce(sum(ch.price_delta), 0),
           coalesce(jsonb_agg(jsonb_build_object('group', g.name, 'name', ch.name, 'price_delta', ch.price_delta)
                              order by g.sort, ch.sort), '[]'::jsonb)
      into v_extra, v_opts
      from public.st_option_choices ch join public.st_option_groups g on g.id = ch.group_id
     where ch.id = any (v_choices);

    v_unit := greatest(v_item.price + v_extra, 0);
    insert into public.st_order_items (shop_id, order_id, item_id, name, unit_price, qty, options, note, line_total)
    values (v_shop.id, v_order, v_item.id, v_item.name, v_unit, v_qty, v_opts, v_lnote, v_unit * v_qty);
    v_sub := v_sub + v_unit * v_qty;
  end loop;

  update public.st_orders set subtotal = v_sub where id = v_order;
  update public.st_table_sessions set last_activity_at = now() where id = v_sess.id;
  return jsonb_build_object('order_id', v_order, 'order_no', v_no, 'subtotal', v_sub);
end
$$;

-- ลูกค้าดูรายการที่สั่ง + ยอดบิล + การเรียกที่รออยู่
create or replace function public.st_guest_orders(p_qr text, p_session_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_sess public.st_table_sessions;
begin
  v_sess := public.st_guest_session(p_qr, p_session_token);
  return jsonb_build_object(
    'status', v_sess.status,
    'orders', public.st_orders_json(v_sess.id),
    'bill',   public.st_bill_json(v_sess.id),
    'pending_calls', coalesce((select jsonb_agg(kind) from public.st_service_calls
                                where session_id = v_sess.id and status = 'pending'), '[]'::jsonb));
end
$$;

-- ลูกค้ากด เรียกพนักงาน ('call') / ขอเช็กบิล ('bill' -> รอบเปลี่ยนเป็นรอเช็กบิล สั่งเพิ่มไม่ได้)
create or replace function public.st_guest_call(p_qr text, p_session_token text, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_sess public.st_table_sessions;
begin
  v_sess := public.st_guest_session(p_qr, p_session_token);
  if p_kind not in ('call','bill') then raise exception 'st_bad_request'; end if;
  insert into public.st_service_calls (shop_id, table_id, session_id, kind)
  values (v_sess.shop_id, v_sess.table_id, v_sess.id, p_kind)
  on conflict (session_id, kind) where status = 'pending' do nothing;
  update public.st_table_sessions
     set last_activity_at = now(),
         status = case when p_kind = 'bill' then 'billing' else status end
   where id = v_sess.id;
end
$$;

-- ---------- 5) RPC พนักงาน ----------
-- สรุปหน้าร้าน: การเรียกที่รอ + ยอดของแต่ละโต๊ะที่เปิดอยู่
create or replace function public.st_floor_status(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop) then raise exception 'st_forbidden'; end if;
  return jsonb_build_object(
    'calls', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'table_id', c.table_id,
                                          'table_label', t.label, 'created_at', c.created_at)
                       order by c.created_at)
        from public.st_service_calls c
        join public.st_tables t on t.id = c.table_id
        join public.st_table_sessions s on s.id = c.session_id and s.status <> 'closed'   -- โต๊ะที่ปิดแล้วไม่ต้องแสดง
       where c.shop_id = p_shop and c.status = 'pending'), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'session_id', s.id, 'table_id', s.table_id,
               'orders', (select count(*) from public.st_orders o where o.session_id = s.id and o.status <> 'cancelled'),
               'new_orders', (select count(*) from public.st_orders o where o.session_id = s.id and o.status = 'new'),
               'subtotal', (select coalesce(sum(o.subtotal), 0) from public.st_orders o
                             where o.session_id = s.id and o.status <> 'cancelled')))
        from public.st_table_sessions s
       where s.shop_id = p_shop and s.status <> 'closed'), '[]'::jsonb));
end
$$;

-- รายละเอียดรอบที่เปิดอยู่ของโต๊ะ (ไม่มีรอบ = null)
create or replace function public.st_session_detail(p_table uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  v_sess uuid;
begin
  select shop_id into v_shop from public.st_tables where id = p_table;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop) then raise exception 'st_forbidden'; end if;
  select id into v_sess from public.st_table_sessions where table_id = p_table and status <> 'closed';
  if v_sess is null then return null; end if;
  return jsonb_build_object(
    'session_id', v_sess,
    'orders', public.st_orders_json(v_sess),
    'bill',   public.st_bill_json(v_sess),
    'calls',  coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'created_at', c.created_at))
                          from public.st_service_calls c where c.session_id = v_sess and c.status = 'pending'), '[]'::jsonb));
end
$$;

-- รับทราบการเรียก
create or replace function public.st_handle_call(p_call uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_service_calls where id = p_call;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop) then raise exception 'st_forbidden'; end if;
  update public.st_service_calls
     set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
   where id = p_call and status = 'pending';
end
$$;

-- เปลี่ยนสถานะออร์เดอร์: accepted / cooking / served (ทุกตำแหน่ง) · cancelled (ยกเว้นครัว)
-- ออร์เดอร์ที่ยกเลิกแล้วเปลี่ยนกลับไม่ได้
create or replace function public.st_set_order_status(p_order uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop   uuid;
  v_status text;
  v_sess   uuid;
begin
  select shop_id, status, session_id into v_shop, v_status, v_sess from public.st_orders where id = p_order;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if p_status not in ('new','accepted','cooking','served','cancelled') then raise exception 'st_bad_request'; end if;
  if p_status = 'cancelled' then
    if not public.st_has_shop_role(v_shop, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  elsif not public.st_has_shop_role(v_shop) then
    raise exception 'st_forbidden';
  end if;
  if v_status = 'cancelled' then raise exception 'st_order_cancelled'; end if;
  update public.st_orders set status = p_status, status_by_user_id = auth.uid() where id = p_order;
  update public.st_table_sessions set last_activity_at = now() where id = v_sess and status <> 'closed';
end
$$;

-- ---------- 6) สิทธิ์เรียกฟังก์ชัน ----------
revoke all on function
  public.st_guest_session(text, text), public.st_bill_json(uuid), public.st_orders_json(uuid),
  public.st_place_order(text, text, jsonb, text, text, text), public.st_guest_orders(text, text),
  public.st_guest_call(text, text, text), public.st_floor_status(uuid), public.st_session_detail(uuid),
  public.st_handle_call(uuid), public.st_set_order_status(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.st_place_order(text, text, jsonb, text, text, text), public.st_guest_orders(text, text),
  public.st_guest_call(text, text, text)
to anon, authenticated;

grant execute on function
  public.st_floor_status(uuid), public.st_session_detail(uuid),
  public.st_handle_call(uuid), public.st_set_order_status(uuid, text)
to authenticated;
-- st_guest_session / st_bill_json / st_orders_json: ใช้ภายในเท่านั้น

-- ---------- 7) บันทึกว่ารันไฟล์นี้แล้ว ----------
insert into public.st_schema_log (id) values ('st-05-orders')
on conflict (id) do update set applied_at = now();
