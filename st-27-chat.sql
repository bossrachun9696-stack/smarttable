-- =====================================================================
-- SmartTable · st-27-chat.sql  (รอบ R ขั้น 3: แจ้งเตือนเข้าห้องแชท DarkChat)
--  - เจ้าของ/ผู้จัดการเชื่อมร้านกับห้องแชท (กลุ่ม / สองคน) · 1 ร้านเชื่อมได้หลายห้อง
--  - เลือกได้ต่อห้อง: ออร์เดอร์ใหม่ · เปิดโต๊ะ · เรียกพนักงาน · เช็กบิล/สลิป · คิวกลับบ้าน · สรุปยอดตอนปิดร้าน
--  - ส่งผ่าน ext_ledger_post ของ DarkChat (meta.ext = 'smarttable')
--  ต้องรันหลัง st-26 · รันซ้ำได้
-- =====================================================================

create table if not exists public.st_chat_links (
  room_key    text not null check (room_key ~ '^(g|d):'),
  shop_id     uuid not null references public.st_shops(id) on delete cascade,
  created_by  uuid not null references auth.users(id) on delete cascade,
  ev_orders   boolean not null default true,    -- 🍽️ ออร์เดอร์ใหม่ (ทานที่ร้าน)
  ev_open     boolean not null default false,   -- 🪑 เปิดโต๊ะ
  ev_call     boolean not null default true,    -- 🙋 เรียกพนักงาน / ขอยืนยันโต๊ะ / คูปอง
  ev_bill     boolean not null default true,    -- 🧾 ขอเช็กบิล / แนบสลิป
  ev_queue    boolean not null default true,    -- 🛍 ออร์เดอร์กลับบ้าน/คิว + คิวพร้อมรับ
  ev_summary  boolean not null default true,    -- 📊 สรุปยอดเมื่อปิดร้าน
  quick_on    boolean not null default false,   -- ⚡ สั่งด่วนในห้อง (st-28)
  created_at  timestamptz not null default now(),
  primary key (room_key, shop_id)
);
create index if not exists st_chat_links_shop_idx on public.st_chat_links (shop_id);
alter table public.st_chat_links enable row level security;   -- ใช้ผ่านฟังก์ชันเท่านั้น
revoke all on public.st_chat_links from anon, authenticated;

-- ---------- ภายใน: ส่งข้อความเข้าทุกห้องที่เปิดเหตุการณ์นี้ ----------
create or replace function public.st_chat_post(p_shop uuid, p_event text, p_text text, p_meta jsonb default '{}'::jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare l record; n int := 0;
begin
  for l in select * from public.st_chat_links c where c.shop_id = p_shop and case p_event
             when 'orders' then c.ev_orders when 'open' then c.ev_open when 'call' then c.ev_call when 'bill' then c.ev_bill
             when 'queue' then c.ev_queue when 'summary' then c.ev_summary else false end loop
    begin
      if public.ext_ledger_post(l.room_key, null, l.created_by, p_text,
           coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('ext', 'smarttable', 'type', p_event, 'shop', p_shop)) then n := n + 1; end if;
    exception when others then null;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.st_chat_post(uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function public.st_chat_where(p_table uuid, p_session uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when t.kind = 'ticket' then 'คิว ' || coalesce(s.queue_no::text, '?') || coalesce(' · ' || nullif(s.contact_name, ''), '')
    when t.kind = 'hub' then 'สั่งกลับบ้าน'
    else 'โต๊ะ ' || coalesce(t.label, '?') end
  from public.st_tables t left join public.st_table_sessions s on s.id = p_session
  where t.id = p_table
$$;
revoke all on function public.st_chat_where(uuid, uuid) from public, anon, authenticated;

create or replace function public.st_chat_money(n numeric)
returns text language sql immutable as $$ select '฿' || to_char(coalesce(n, 0), 'FM999,999,990.##') $$;

-- ---------- 🍽️ ออร์เดอร์ใหม่ (ทำงานตอนจบทรานแซกชัน → มีรายการอาหารครบแล้ว) ----------
create or replace function public.st_chat_on_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.st_orders; shop text; t text := ''; r record; n int := 0; tot numeric := 0; is_ticket boolean; ev text;
begin
  select * into o from public.st_orders where id = new.id;
  if o.id is null or o.is_charge then return null; end if;
  if not exists (select 1 from public.st_chat_links where shop_id = o.shop_id) then return null; end if;
  select name into shop from public.st_shops where id = o.shop_id;
  is_ticket := exists (select 1 from public.st_tables where id = o.table_id and kind in ('ticket', 'hub'));
  ev := case when is_ticket then 'queue' else 'orders' end;
  for r in select i.name, i.qty, i.options, i.note, i.line_total from public.st_order_items i where i.order_id = o.id order by i.id loop
    n := n + 1; tot := tot + coalesce(r.line_total, 0);
    if n <= 25 then
      t := t || chr(10) || '• ' || r.name || ' ×' || r.qty
        || coalesce(' (' || nullif((select string_agg(x->>'name', ', ') from jsonb_array_elements(coalesce(r.options, '[]'::jsonb)) x), '') || ')', '')
        || coalesce(' — ' || nullif(r.note, ''), '');
    end if;
  end loop;
  if n = 0 then return null; end if;
  if n > 25 then t := t || chr(10) || '… และอีก ' || (n - 25) || ' รายการ'; end if;
  perform public.st_chat_post(o.shop_id, ev,
    (case when is_ticket then '🛍 ' else '🍽️ ' end) || shop || ' · ' || public.st_chat_where(o.table_id, o.session_id)
      || ' สั่ง #' || o.order_no || ' (' || to_char(o.created_at at time zone 'Asia/Bangkok', 'HH24:MI') || ')'
      || case when o.to_go then ' 🛍 ห่อกลับบ้าน' else '' end
      || case when o.staff_user_id is not null then ' · พนักงานสั่งให้' else coalesce(' · ' || nullif(o.guest_name, ''), '') end
      || t || chr(10) || 'รวม ' || public.st_chat_money(coalesce(nullif(o.subtotal, 0), tot))
      || coalesce(chr(10) || '📝 ' || nullif(o.note, ''), ''),
    jsonb_build_object('order', o.id));
  return null;
exception when others then return null;   -- แจ้งไม่สำเร็จ ห้ามทำให้ออร์เดอร์ล้ม
end $$;
drop trigger if exists st_orders_chat_notify on public.st_orders;
create constraint trigger st_orders_chat_notify after insert on public.st_orders
  deferrable initially deferred for each row execute function public.st_chat_on_order();

-- ---------- 🪑 เปิดโต๊ะ ----------
create or replace function public.st_chat_on_session()
returns trigger language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if not exists (select 1 from public.st_chat_links where shop_id = new.shop_id and ev_open) then return null; end if;
  select kind into k from public.st_tables where id = new.table_id;
  if k is distinct from 'dine' then return null; end if;
  perform public.st_chat_post(new.shop_id, 'open',
    '🪑 ' || (select name from public.st_shops where id = new.shop_id) || ' · ' || public.st_chat_where(new.table_id, new.id) || ' เปิดโต๊ะแล้ว'
      || coalesce(' (' || new.guest_count || ' คน)', '')
      || case when new.opened_via = 'guest' or new.opened_by_user_id is null then ' · ลูกค้าสแกนเปิดเอง' else '' end
      || case when new.confirm_status = 'pending' then chr(10) || '⏳ รอร้านยืนยันโต๊ะ' else '' end,
    jsonb_build_object('session', new.id));
  return null;
exception when others then return null;
end $$;
drop trigger if exists st_sessions_chat_notify on public.st_table_sessions;
create trigger st_sessions_chat_notify after insert on public.st_table_sessions for each row execute function public.st_chat_on_session();

-- ---------- 🙋 เรียกพนักงาน / 🧾 เช็กบิล / 📎 สลิป ----------
create or replace function public.st_chat_on_call()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ev text; msg text;
begin
  ev := case when new.kind in ('bill', 'slip') then 'bill' else 'call' end;
  if not exists (select 1 from public.st_chat_links where shop_id = new.shop_id
                  and case ev when 'bill' then ev_bill else ev_call end) then return null; end if;
  msg := case new.kind when 'call' then '🙋 เรียกพนักงาน' when 'bill' then '🧾 ขอเช็กบิล' when 'slip' then '📎 แนบสลิปโอนเงิน รอตรวจ'
                       when 'open' then '🪑 ขอเปิดโต๊ะ รอร้านยืนยัน' when 'coupon' then '🎟 ใส่คูปอง รอพนักงาน' else '🔔 ' || new.kind end;
  perform public.st_chat_post(new.shop_id, ev,
    (select name from public.st_shops where id = new.shop_id) || ' · ' || public.st_chat_where(new.table_id, new.session_id) || ' ' || msg
      || coalesce(chr(10) || nullif(new.detail, ''), ''),
    jsonb_build_object('call', new.id));
  return null;
exception when others then return null;
end $$;
drop trigger if exists st_calls_chat_notify on public.st_service_calls;
create trigger st_calls_chat_notify after insert on public.st_service_calls for each row execute function public.st_chat_on_call();

-- ---------- ✅ คิวกลับบ้านพร้อมรับ ----------
create or replace function public.st_chat_on_ready()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ready_at is null or old.ready_at is not null then return null; end if;
  if not exists (select 1 from public.st_tables where id = new.table_id and kind = 'ticket') then return null; end if;
  perform public.st_chat_post(new.shop_id, 'queue',
    '✅ ' || (select name from public.st_shops where id = new.shop_id) || ' · ' || public.st_chat_where(new.table_id, new.id) || ' พร้อมรับแล้ว',
    jsonb_build_object('session', new.id, 'ready', true));
  return null;
exception when others then return null;
end $$;
drop trigger if exists st_sessions_chat_ready on public.st_table_sessions;
create trigger st_sessions_chat_ready after update of ready_at on public.st_table_sessions for each row execute function public.st_chat_on_ready();

-- ---------- 📊 สรุปยอดเมื่อปิดร้าน (กดปิดเอง หรือปิดตามเวลา) ----------
create or replace function public.st_chat_day_text(p_shop uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare d date := (now() at time zone 'Asia/Bangkok')::date; tot numeric; cnt int; ords int; tabs int; top text; m text;
begin
  select coalesce(sum(p.total), 0), count(*) into tot, cnt from public.st_payments p
   where p.shop_id = p_shop and p.status = 'paid' and (p.created_at at time zone 'Asia/Bangkok')::date = d;
  select count(*) into ords from public.st_orders o
   where o.shop_id = p_shop and not o.is_charge and o.status <> 'cancelled' and (o.created_at at time zone 'Asia/Bangkok')::date = d;
  select count(*) into tabs from public.st_table_sessions s join public.st_tables t on t.id = s.table_id
   where s.shop_id = p_shop and (s.opened_at at time zone 'Asia/Bangkok')::date = d and t.kind = 'dine';
  select string_agg(x.name || ' ×' || x.q, ', ') into top from (
    select i.name, sum(i.qty) q from public.st_order_items i join public.st_orders o on o.id = i.order_id
     where o.shop_id = p_shop and not o.is_charge and o.status <> 'cancelled' and (o.created_at at time zone 'Asia/Bangkok')::date = d
     group by i.name order by 2 desc limit 5) x;
  select string_agg(coalesce(nullif(x.method, ''), '?') || ' ' || public.st_chat_money(x.s), ' · ') into m from (
    select p.method, sum(p.total) s from public.st_payments p
     where p.shop_id = p_shop and p.status = 'paid' and (p.created_at at time zone 'Asia/Bangkok')::date = d group by p.method order by 2 desc) x;
  return '📊 ' || (select name from public.st_shops where id = p_shop) || ' ปิดร้านแล้ว · สรุปวันนี้ ' || to_char(d, 'DD/MM/') || (extract(year from d)::int + 543)
    || chr(10) || '💰 ยอดขาย ' || public.st_chat_money(tot) || ' (' || cnt || ' ใบเสร็จ)'
    || coalesce(chr(10) || '💳 ' || m, '')
    || chr(10) || '🪑 ' || tabs || ' โต๊ะ · 🍽️ ' || ords || ' ออร์เดอร์'
    || coalesce(chr(10) || '🔥 ขายดี: ' || top, '');
end $$;
revoke all on function public.st_chat_day_text(uuid) from public, anon, authenticated;

create or replace function public.st_chat_on_close()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.is_open and not new.is_open and exists (select 1 from public.st_chat_links where shop_id = new.id and ev_summary) then
    perform public.st_chat_post(new.id, 'summary', public.st_chat_day_text(new.id), '{}'::jsonb);
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists st_shops_chat_close on public.st_shops;
create trigger st_shops_chat_close after update of is_open on public.st_shops for each row execute function public.st_chat_on_close();

-- ---------- ใช้จาก DarkChat ----------
-- ร้านที่ฉันเชื่อมได้ (เจ้าของ/ผู้จัดการ)
create or replace function public.st_chat_my_shops()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'logo_path', s.logo_path) order by s.name), '[]'::jsonb)
    from public.st_shops s
   where public.st_has_shop_role(s.id, array['owner', 'manager'])
$$;
revoke all on function public.st_chat_my_shops() from public, anon;
grant execute on function public.st_chat_my_shops() to authenticated;

create or replace function public.st_chat_link(p_room text, p_shop uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare ext uuid; nm text;
begin
  if p_room !~ '^(g|d):' then raise exception 'room_not_supported'; end if;
  if not public.ext_room_ok(p_room) then raise exception 'not_in_room'; end if;
  if not public.st_has_shop_role(p_shop, array['owner', 'manager']) then raise exception 'st_forbidden'; end if;
  if not public.st_shop_licensed(p_shop) then raise exception 'st_ext_locked'; end if;
  select name into nm from public.st_shops where id = p_shop;
  insert into public.st_chat_links (room_key, shop_id, created_by) values (p_room, p_shop, auth.uid())
  on conflict (room_key, shop_id) do update set created_by = excluded.created_by;
  select id into ext from public.extensions where kind = 'smarttable' and active order by sort limit 1;
  if ext is not null then
    insert into public.room_extensions (room_key, ext_id, added_by) values (p_room, ext, auth.uid()) on conflict do nothing;
  end if;
  if not public.ext_ledger_post(p_room, null, auth.uid(),
    '🍽️ เชื่อมร้าน "' || nm || '" (SmartTable) กับห้องนี้แล้ว' || chr(10) ||
    'จะแจ้งในห้องนี้เมื่อ: มีออร์เดอร์ใหม่ (โต๊ะไหน สั่งอะไร) · เรียกพนักงาน · ขอเช็กบิล · ออร์เดอร์กลับบ้าน · สรุปยอดตอนปิดร้าน' || chr(10) ||
    'เลือกเปิด/ปิดได้ที่ ⋮ > ส่วนขยาย > ตั้งค่าแจ้งเตือนส่วนขยาย',
    jsonb_build_object('ext', 'smarttable', 'type', 'linked', 'shop', p_shop), true) then
    raise exception 'post_failed';
  end if;
end $$;
revoke all on function public.st_chat_link(text, uuid) from public, anon;
grant execute on function public.st_chat_link(text, uuid) to authenticated;

create or replace function public.st_chat_set(p_room text, p_shop uuid, p_events jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.ext_room_ok(p_room) then raise exception 'not_in_room'; end if;
  if not (public.st_has_shop_role(p_shop, array['owner', 'manager'])
          or exists (select 1 from public.st_chat_links where room_key = p_room and shop_id = p_shop and created_by = auth.uid())) then
    raise exception 'st_forbidden';
  end if;
  update public.st_chat_links set
    ev_orders  = coalesce((p_events->>'orders')::boolean, ev_orders),
    ev_open    = coalesce((p_events->>'open')::boolean, ev_open),
    ev_call    = coalesce((p_events->>'call')::boolean, ev_call),
    ev_bill    = coalesce((p_events->>'bill')::boolean, ev_bill),
    ev_queue   = coalesce((p_events->>'queue')::boolean, ev_queue),
    ev_summary = coalesce((p_events->>'summary')::boolean, ev_summary),
    quick_on   = coalesce((p_events->>'quick')::boolean, quick_on)
  where room_key = p_room and shop_id = p_shop;
end $$;
revoke all on function public.st_chat_set(text, uuid, jsonb) from public, anon;
grant execute on function public.st_chat_set(text, uuid, jsonb) to authenticated;

create or replace function public.st_chat_unlink(p_room text, p_shop uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.ext_room_ok(p_room) then raise exception 'not_in_room'; end if;
  if not (public.st_has_shop_role(p_shop, array['owner', 'manager'])
          or exists (select 1 from public.st_chat_links where room_key = p_room and shop_id = p_shop and created_by = auth.uid())) then
    raise exception 'st_forbidden';
  end if;
  delete from public.st_chat_links where room_key = p_room and shop_id = p_shop;
end $$;
revoke all on function public.st_chat_unlink(text, uuid) from public, anon;
grant execute on function public.st_chat_unlink(text, uuid) to authenticated;

create or replace function public.st_chat_room_info(p_room text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.ext_room_ok(p_room) then raise exception 'not_in_room'; end if;
  return jsonb_build_object(
    'links', coalesce((select jsonb_agg(jsonb_build_object('shop_id', l.shop_id, 'name', s.name, 'is_open', s.is_open,
        'can', public.st_has_shop_role(l.shop_id, array['owner', 'manager']) or l.created_by = auth.uid(),
        'orders', l.ev_orders, 'open', l.ev_open, 'call', l.ev_call, 'bill', l.ev_bill, 'queue', l.ev_queue,
        'summary', l.ev_summary, 'quick', l.quick_on) order by l.created_at)
      from public.st_chat_links l join public.st_shops s on s.id = l.shop_id where l.room_key = p_room), '[]'::jsonb),
    'my_shops', public.st_chat_my_shops());
end $$;
revoke all on function public.st_chat_room_info(text) from public, anon;
grant execute on function public.st_chat_room_info(text) to authenticated;

-- ส่งสรุปวันนี้เข้าห้องตอนนี้
create or replace function public.st_chat_send_summary(p_room text, p_shop uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.ext_room_ok(p_room) then raise exception 'not_in_room'; end if;
  if not public.st_has_shop_role(p_shop, array['owner', 'manager']) then raise exception 'st_forbidden'; end if;
  if not exists (select 1 from public.st_chat_links where room_key = p_room and shop_id = p_shop) then raise exception 'st_not_linked'; end if;
  if not public.ext_ledger_post(p_room, null, auth.uid(), replace(public.st_chat_day_text(p_shop), ' ปิดร้านแล้ว · สรุปวันนี้', ' · สรุปวันนี้ (ถึงตอนนี้)'),
      jsonb_build_object('ext', 'smarttable', 'type', 'summary', 'shop', p_shop), true) then
    raise exception 'post_failed';
  end if;
end $$;
revoke all on function public.st_chat_send_summary(text, uuid) from public, anon;
grant execute on function public.st_chat_send_summary(text, uuid) to authenticated;

insert into public.st_schema_log (id) values ('st-27-chat') on conflict (id) do update set applied_at = now();
