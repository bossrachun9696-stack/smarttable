-- =====================================================================
-- SmartTable st-31 · Web Push ของแอป SmartTable (แจ้งเตือนตอนปิดแอปอยู่)
-- ต้องรัน st-27 ก่อน (ใช้ st_chat_where / st_chat_items_text / st_chat_money) และต้อง deploy Edge Function "st-push"
--  - st_push_subs: เครื่องที่เปิดรับแจ้งเตือน (ต่อผู้ใช้) + ร้านที่ปิดเสียง
--  - st_push_events: คิวเหตุการณ์ -> Database Webhook ยิงไป st-push (ใช้หัว x-webhook-secret ชุดเดียวกับ send-push)
--  - ส่งหาพนักงานทุกคนของร้าน (ครัว = เฉพาะออร์เดอร์) ยกเว้นคนที่ทำเอง
-- รันซ้ำได้
-- =====================================================================

create table if not exists public.st_push_subs (
  endpoint     text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  user_id      uuid not null references auth.users(id) on delete cascade,
  p256dh       text not null check (char_length(p256dh) <= 200),
  auth_key     text not null check (char_length(auth_key) <= 100),
  muted_shops  uuid[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists st_push_subs_user_idx on public.st_push_subs (user_id);
alter table public.st_push_subs enable row level security;
revoke all on public.st_push_subs from anon, authenticated;

create table if not exists public.st_push_events (
  id          bigserial primary key,
  shop_id     uuid not null references public.st_shops(id) on delete cascade,
  kind        text not null check (kind in ('order', 'queue', 'call', 'open')),
  title       text not null,
  body        text not null default '',
  url         text not null default 'home.html',
  tag         text,
  actor       uuid,
  created_at  timestamptz not null default now()
);
create index if not exists st_push_events_created_idx on public.st_push_events (created_at);
alter table public.st_push_events enable row level security;
revoke all on public.st_push_events from anon, authenticated;

-- ---------- RPC ผู้ใช้ ----------
create or replace function public.st_push_save(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'st_forbidden'; end if;
  if (select count(*) from public.st_push_subs where user_id = auth.uid()) >= 10
     and not exists (select 1 from public.st_push_subs where endpoint = p_endpoint) then
    delete from public.st_push_subs where endpoint = (select endpoint from public.st_push_subs where user_id = auth.uid() order by updated_at limit 1);
  end if;
  insert into public.st_push_subs (endpoint, user_id, p256dh, auth_key) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth_key = excluded.auth_key, updated_at = now();
end $$;
revoke all on function public.st_push_save(text, text, text) from public, anon;
grant execute on function public.st_push_save(text, text, text) to authenticated;

create or replace function public.st_push_remove(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.st_push_subs where endpoint = p_endpoint and user_id = auth.uid()
$$;
revoke all on function public.st_push_remove(text) from public, anon;
grant execute on function public.st_push_remove(text) to authenticated;

-- สถานะของเครื่องนี้ + ร้านของฉัน (ปิดเสียงร้านไหนอยู่)
create or replace function public.st_push_status(p_endpoint text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'on', exists (select 1 from public.st_push_subs where endpoint = p_endpoint and user_id = auth.uid()),
    'shops', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role', m.role,
        'muted', exists (select 1 from public.st_push_subs p where p.endpoint = p_endpoint and p.user_id = auth.uid() and s.id = any(p.muted_shops)))
        order by s.name)
      from public.st_shop_members m join public.st_shops s on s.id = m.shop_id where m.user_id = auth.uid()), '[]'::jsonb))
$$;
revoke all on function public.st_push_status(text) from public, anon;
grant execute on function public.st_push_status(text) to authenticated;

create or replace function public.st_push_mute(p_endpoint text, p_shop uuid, p_muted boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.st_push_subs
     set muted_shops = case when p_muted then array(select distinct x from unnest(muted_shops || p_shop) x)
                            else array_remove(muted_shops, p_shop) end,
         updated_at = now()
   where endpoint = p_endpoint and user_id = auth.uid();
  if not found then raise exception 'st_push_off'; end if;
end $$;
revoke all on function public.st_push_mute(text, uuid, boolean) from public, anon;
grant execute on function public.st_push_mute(text, uuid, boolean) to authenticated;

-- ---------- ภายใน: ส่งเหตุการณ์ (เฉพาะร้านที่มีพนักงานเปิดรับแจ้งเตือน) ----------
create or replace function public.st_push_emit(p_shop uuid, p_kind text, p_title text, p_body text, p_url text, p_tag text, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.st_push_subs p join public.st_shop_members m on m.user_id = p.user_id
                  where m.shop_id = p_shop and not (p_shop = any(p.muted_shops))
                    and (p_actor is null or p.user_id <> p_actor)) then
    return;
  end if;
  delete from public.st_push_events where created_at < now() - interval '1 day';
  insert into public.st_push_events (shop_id, kind, title, body, url, tag, actor)
  values (p_shop, p_kind, left(p_title, 120), left(coalesce(p_body, ''), 400), p_url, p_tag, p_actor);
exception when others then null;
end $$;
revoke all on function public.st_push_emit(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;

-- ออร์เดอร์ใหม่ (รอจน commit เพื่อให้มีรายการอาหารครบ)
create or replace function public.st_push_on_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.st_orders; k text; shop text; items text;
begin
  select * into o from public.st_orders where id = new.id;
  if o.id is null or o.is_charge then return null; end if;
  select kind into k from public.st_tables where id = o.table_id;
  select name into shop from public.st_shops where id = o.shop_id;
  items := public.st_chat_items_text(o.id);
  if items is null then return null; end if;
  perform public.st_push_emit(o.shop_id, case when k = 'dine' then 'order' else 'queue' end,
    (case when k = 'dine' then '🍽️ ' else '🛍 ' end) || public.st_chat_where(o.table_id, o.session_id) || ' สั่ง #' || o.order_no || ' · ' || shop,
    replace(items, '• ', '') || chr(10) || 'รวม ' || public.st_chat_money(o.subtotal) || coalesce(' · ' || nullif(o.guest_name, ''), ''),
    case when k = 'dine' then 'orders.html' else 'queue.html' end || '?id=' || o.shop_id,
    'st-order-' || o.id, o.staff_user_id);
  return null;
exception when others then return null;
end $$;
drop trigger if exists st_orders_push on public.st_orders;
create constraint trigger st_orders_push after insert on public.st_orders
  deferrable initially deferred for each row execute function public.st_push_on_order();

create or replace function public.st_push_on_call()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.st_push_emit(new.shop_id, 'call',
    (case new.kind when 'call' then '🙋 ' when 'bill' then '🧾 ' when 'slip' then '📎 ' when 'open' then '🪑 ' else '🔔 ' end)
      || public.st_chat_where(new.table_id, new.session_id) || ' · ' || (select name from public.st_shops where id = new.shop_id),
    case new.kind when 'call' then 'เรียกพนักงาน' when 'bill' then 'ขอเช็กบิล' when 'slip' then 'แนบสลิปโอนเงิน รอตรวจ'
                  when 'open' then 'ขอเปิดโต๊ะ รอร้านยืนยัน' when 'coupon' then 'ใส่คูปอง รอพนักงาน' else new.kind end
      || coalesce(' · ' || nullif(new.detail, ''), ''),
    'orders.html?id=' || new.shop_id, 'st-call-' || new.id, null);
  return null;
exception when others then return null;
end $$;
drop trigger if exists st_calls_push on public.st_service_calls;
create trigger st_calls_push after insert on public.st_service_calls for each row execute function public.st_push_on_call();

create or replace function public.st_push_on_open()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.st_tables where id = new.table_id and kind = 'dine') then return null; end if;
  perform public.st_push_emit(new.shop_id, 'open',
    '🪑 ' || public.st_chat_where(new.table_id, new.id) || ' เปิดโต๊ะ · ' || (select name from public.st_shops where id = new.shop_id),
    coalesce(new.guest_count || ' คน · ', '') || case when new.confirm_status = 'pending' then 'รอร้านยืนยันโต๊ะ'
                                                  when new.opened_by_user_id is null then 'ลูกค้าสแกนเปิดเอง' else 'พนักงานเปิดให้' end,
    'tables.html?id=' || new.shop_id, 'st-open-' || new.id, new.opened_by_user_id);
  return null;
exception when others then return null;
end $$;
drop trigger if exists st_sessions_push on public.st_table_sessions;
create trigger st_sessions_push after insert on public.st_table_sessions for each row execute function public.st_push_on_open();

-- ---------- Webhook: st_push_events -> Edge Function st-push (หัวเดียวกับ send-push, ไม่โชว์ secret) ----------
do $$
declare a text; parts text[]; u text;
begin
  select encode(t.tgargs, 'escape') into a from pg_trigger t
   where t.tgname = 'send-push' and t.tgrelid = 'public.messages'::regclass;
  if a is null then raise exception 'ไม่พบ webhook send-push บนตาราง messages'; end if;
  parts := string_to_array(a, '\000');
  u := regexp_replace(parts[1], '/send-push$', '/st-push');
  if u = parts[1] then raise exception 'รูปแบบ URL ของ send-push ไม่ตรงที่คาด'; end if;
  execute 'drop trigger if exists "st-push" on public.st_push_events';
  execute format('create trigger "st-push" after insert on public.st_push_events for each row execute function supabase_functions.http_request(%L, %L, %L, %L, %L)',
                 u, 'POST', parts[3], '{}', '5000');
end $$;

insert into public.st_schema_log (id) values ('st-31-push') on conflict (id) do update set applied_at = now();
