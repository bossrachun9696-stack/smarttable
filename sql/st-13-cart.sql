-- =====================================================================
-- SmartTable · st-13-cart.sql  (รันซ้ำได้ · ต้องรัน st-01 ถึง st-12 ก่อน)
-- รอบ E: ตะกร้าร่วมทั้งโต๊ะ
--
-- * ทุกมือถือที่สแกน QR โต๊ะเดียวกัน (รอบเดียวกัน) เห็นตะกร้าเดียวกัน · แต่ละรายการบอกว่าใครเพิ่ม
-- * ใครในโต๊ะก็กดส่งได้ — ส่งทั้งตะกร้าเป็น 1 ออร์เดอร์ แล้วตะกร้าว่าง
-- * เก็บในฐานข้อมูล (ไม่หายเมื่อปิดหน้า) · หน้าเว็บใช้ Realtime Broadcast บอกเครื่องอื่นให้โหลดใหม่ทันที
--   (ชื่อช่องมาจาก session_token ที่ถูกแฮช — คนนอกโต๊ะไม่รู้) และดึงซ้ำเป็นระยะเผื่อสัญญาณหลุด
-- * ร้านปิดได้ (st_shops.shared_cart = false -> กลับไปใช้ตะกร้าแยกเครื่องแบบเดิม)
-- * ตะกร้าล้างเองเมื่อปิดโต๊ะ · โหมดพนักงาน และหน้า QR สั่งกลับบ้าน (ยังไม่มีบัตรคิว) ใช้ตะกร้าในเครื่องเหมือนเดิม
-- * ไม่ทับฟังก์ชันของไฟล์เก่า
-- =====================================================================

-- ---------- 1) ตั้งค่าร้าน ----------
alter table public.st_shops add column if not exists shared_cart boolean not null default true;
grant update (shared_cart) on public.st_shops to authenticated;

-- ---------- 2) ตาราง ----------
create table if not exists public.st_cart_lines (
  id          uuid primary key,                     -- หน้าเว็บสุ่มให้ (แก้ซ้ำด้วย id เดิม)
  shop_id     uuid not null,
  session_id  uuid not null,
  item_id     uuid not null,
  qty         smallint not null check (qty between 1 and 20),
  choices     jsonb not null default '[]'::jsonb check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) <= 20),
  note        text check (note is null or char_length(note) <= 140),
  added_by    text check (added_by is null or char_length(added_by) <= 30),   -- ชื่อเล่นคนเพิ่ม
  device      text check (device is null or char_length(device) <= 40),      -- รหัสเครื่อง (ไว้บอกว่า "ของคุณ")
  meta        jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (session_id, shop_id) references public.st_table_sessions (id, shop_id) on delete cascade,
  foreign key (item_id) references public.st_menu_items (id) on delete cascade
);
create index if not exists st_cart_lines_session_idx on public.st_cart_lines (session_id, created_at);
alter table public.st_cart_lines enable row level security;   -- ไม่มี policy: ใช้ผ่านฟังก์ชันเท่านั้น
revoke all on public.st_cart_lines from anon, authenticated;

-- ปิดโต๊ะ = ล้างตะกร้า
create or replace function public.st_sessions_clear_cart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.st_cart_lines where session_id = new.id;
  return new;
end
$$;
drop trigger if exists st_sessions_clear_cart on public.st_table_sessions;
create trigger st_sessions_clear_cart
  after update of status on public.st_table_sessions
  for each row when (new.status = 'closed' and old.status <> 'closed')
  execute function public.st_sessions_clear_cart();

-- ---------- 3) RPC ลูกค้า (ไม่ต้องล็อกอิน · ตรวจด้วย qr + session_token ทุกครั้ง) ----------
create or replace function public.st_cart_json(p_session uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'item_id', c.item_id, 'qty', c.qty, 'choices', c.choices, 'note', c.note,
           'added_by', c.added_by, 'device', c.device, 'meta', c.meta, 'updated_at', c.updated_at)
         order by c.created_at, c.id), '[]'::jsonb)
    from public.st_cart_lines c where c.session_id = p_session;
$$;

-- อ่านตะกร้าของโต๊ะ · enabled = false แปลว่าร้านปิดตะกร้าร่วม (ใช้ตะกร้าในเครื่อง)
create or replace function public.st_cart_get(p_qr text, p_session_token text)
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
    'enabled', (select shared_cart from public.st_shops where id = v_sess.shop_id),
    'lines', public.st_cart_json(v_sess.id));
end
$$;

-- เพิ่ม / แก้ 1 รายการ (ส่ง id เดิม = แก้) · qty 0 = ลบ
-- p_line: {id, item_id, qty, choices:[choice_id], note, added_by, device, meta:{name, unit, labels}}
create or replace function public.st_cart_put(p_qr text, p_session_token text, p_line jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess public.st_table_sessions;
  v_id   uuid;
  v_item uuid;
  v_qty  int;
begin
  v_sess := public.st_guest_session(p_qr, p_session_token);
  if v_sess.status <> 'open' then raise exception 'st_session_billing'; end if;
  if not (select shared_cart from public.st_shops where id = v_sess.shop_id) then raise exception 'st_bad_request'; end if;
  if p_line is null or jsonb_typeof(p_line) <> 'object' then raise exception 'st_bad_request'; end if;
  begin
    v_id   := (p_line ->> 'id')::uuid;
    v_item := (p_line ->> 'item_id')::uuid;
    v_qty  := coalesce((p_line ->> 'qty')::int, 0);
  exception when others then
    raise exception 'st_bad_request';
  end;
  if v_id is null then raise exception 'st_bad_request'; end if;
  -- id นี้ต้องเป็นของรอบนี้ (หรือยังไม่มี)
  if exists (select 1 from public.st_cart_lines where id = v_id and session_id <> v_sess.id) then
    raise exception 'st_bad_request';
  end if;

  if v_qty <= 0 then
    delete from public.st_cart_lines where id = v_id and session_id = v_sess.id;
  else
    if not exists (select 1 from public.st_menu_items where id = v_item and shop_id = v_sess.shop_id) then
      raise exception 'st_item_gone';
    end if;
    if not exists (select 1 from public.st_cart_lines where id = v_id)
       and (select count(*) from public.st_cart_lines where session_id = v_sess.id) >= 60 then
      raise exception 'st_cart_full';
    end if;
    insert into public.st_cart_lines (id, shop_id, session_id, item_id, qty, choices, note, added_by, device, meta)
    values (v_id, v_sess.shop_id, v_sess.id, v_item, least(v_qty, 20),
            coalesce(p_line -> 'choices', '[]'::jsonb),
            nullif(left(trim(coalesce(p_line ->> 'note', '')), 140), ''),
            nullif(left(trim(coalesce(p_line ->> 'added_by', '')), 30), ''),
            nullif(left(coalesce(p_line ->> 'device', ''), 40), ''),
            coalesce(p_line -> 'meta', '{}'::jsonb))
    on conflict (id) do update
       set qty = excluded.qty, choices = excluded.choices, note = excluded.note,
           added_by = coalesce(excluded.added_by, public.st_cart_lines.added_by),
           meta = excluded.meta, updated_at = now();
  end if;
  update public.st_table_sessions set last_activity_at = now() where id = v_sess.id;
  return public.st_cart_json(v_sess.id);
end
$$;

-- ส่งทั้งตะกร้าของโต๊ะเป็น 1 ออร์เดอร์ (ใครในโต๊ะกดก็ได้)
-- ส่งซ้ำด้วย client_ref เดิม = ได้ออร์เดอร์เดิมกลับ · รายการที่เพิ่มเข้ามาระหว่างส่งยังอยู่ในตะกร้า
create or replace function public.st_cart_send(p_qr text, p_session_token text, p_note text default null,
                                               p_guest_name text default null, p_client_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess  public.st_table_sessions;
  v_ref   text := nullif(trim(coalesce(p_client_ref, '')), '');
  v_ids   uuid[];
  v_items jsonb;
  v_res   jsonb;
  o       public.st_orders;
begin
  v_sess := public.st_guest_session(p_qr, p_session_token);
  perform 1 from public.st_table_sessions where id = v_sess.id for update;   -- คิวการส่งของโต๊ะนี้ทีละคน

  if v_ref is not null then
    select * into o from public.st_orders where session_id = v_sess.id and client_ref = v_ref;
    if o.id is not null then
      return jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'subtotal', o.subtotal, 'duplicate', true);
    end if;
  end if;

  select array_agg(id order by created_at, id),
         jsonb_agg(jsonb_build_object('item_id', item_id, 'qty', qty, 'choices', choices, 'note', note)
                   order by created_at, id)
    into v_ids, v_items
    from public.st_cart_lines where session_id = v_sess.id;
  if v_ids is null then raise exception 'st_cart_empty'; end if;

  v_res := public.st_place_order(p_qr, p_session_token, v_items, p_note, p_guest_name, v_ref);
  delete from public.st_cart_lines where id = any(v_ids);
  return v_res;
end
$$;

-- ---------- 4) สิทธิ์ ----------
revoke all on function
  public.st_sessions_clear_cart(), public.st_cart_json(uuid), public.st_cart_get(text, text),
  public.st_cart_put(text, text, jsonb), public.st_cart_send(text, text, text, text, text)
from public, anon, authenticated;
grant execute on function
  public.st_cart_get(text, text), public.st_cart_put(text, text, jsonb), public.st_cart_send(text, text, text, text, text)
to anon, authenticated;

-- ---------- 5) บันทึกว่ารันไฟล์นี้แล้ว ----------
insert into public.st_schema_log (id) values ('st-13-cart')
on conflict (id) do update set applied_at = now();
