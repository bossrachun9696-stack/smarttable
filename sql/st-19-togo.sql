-- =====================================================================
-- SmartTable · st-19-togo.sql  (รอบ L · ห่อกลับบ้านจากโต๊ะ)
-- ลูกค้าที่นั่งโต๊ะ สั่ง "ห่อกลับบ้าน" ได้ (เช่น ซื้อไปฝากญาติ) · คิดรวมในบิลโต๊ะเดิม
-- ออร์เดอร์ห่อกลับบ้าน: st_orders.to_go = true · ครัวเห็นป้าย · เมนูบุฟเฟ่ต์/รีฟิลคิดราคาปกติ (ไม่ฟรี ไม่นับจำนวนต่อรอบ)
-- ใช้ผ่านฟังก์ชันห่อ (wrapper) ที่ตั้งธง st.to_go แล้วเรียกฟังก์ชันเดิม · ไม่แก้ st_place_order / st_cart_send / st_staff_order
-- รันซ้ำได้ (ต้องรัน st-18 ก่อน) · ทับ: st_order_items_buffet (st-18), st_order_board (st-17)
-- =====================================================================

alter table public.st_orders add column if not exists to_go boolean not null default false;

-- ตั้ง to_go ตอนสร้างออร์เดอร์ จากธงในทรานแซกชัน
create or replace function public.st_orders_to_go()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('st.to_go', true) = 'on' and not new.is_charge then new.to_go := true; end if;
  return new;
end
$$;
drop trigger if exists st_orders_ato_go on public.st_orders;
create trigger st_orders_ato_go before insert on public.st_orders
  for each row execute function public.st_orders_to_go();

-- ---------- ฟังก์ชันห่อ: สั่งแบบห่อกลับบ้าน ----------
create or replace function public.st_place_order_to_go(p_qr text, p_session_token text, p_items jsonb,
                                                       p_note text default null, p_guest_name text default null,
                                                       p_client_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  perform set_config('st.to_go', 'on', true);
  v := public.st_place_order(p_qr, p_session_token, p_items, p_note, p_guest_name, p_client_ref);
  perform set_config('st.to_go', '', true);
  return v;
end
$$;

create or replace function public.st_cart_send_to_go(p_qr text, p_session_token text, p_note text default null,
                                                     p_guest_name text default null, p_client_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  perform set_config('st.to_go', 'on', true);
  v := public.st_cart_send(p_qr, p_session_token, p_note, p_guest_name, p_client_ref);
  perform set_config('st.to_go', '', true);
  return v;
end
$$;

create or replace function public.st_staff_order_to_go(p_qr text, p_items jsonb, p_note text default null,
                                                       p_client_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  perform set_config('st.to_go', 'on', true);
  v := public.st_staff_order(p_qr, p_items, p_note, p_client_ref);
  perform set_config('st.to_go', '', true);
  return v;
end
$$;

-- ---------- ทับฟังก์ชันเดิม ----------
-- ราคาตอนสั่ง: ห่อกลับบ้าน = ราคาปกติ (ทับ st-18)
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
  v_togo boolean;
begin
  if new.item_id is null then return new; end if;
  select s.buffet, s.id, o.to_go into b, v_sess, v_togo from public.st_orders o join public.st_table_sessions s on s.id = o.session_id
   where o.id = new.order_id;
  if v_togo then return new; end if;            -- ห่อกลับบ้าน: คิดราคาปกติ (ไม่ฟรีจากบุฟเฟ่ต์/รีฟิล)
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

-- จอออร์เดอร์: เพิ่ม to_go (ทับ st-17)
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
                   'order_type', s.order_type, 'to_go', o.to_go, 'queue_no', s.queue_no, 'pickup_at', s.pickup_at,
                   'contact_name', s.contact_name,
                   'confirm_pending', s.confirm_status = 'pending',
                   'items', coalesce((
                     select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'qty', i.qty,
                                                         'options', i.options, 'note', i.note,
                                                         'station_id', i.station_id, 'done', i.done_at is not null,
                                                         'image', (select m.image_path from public.st_menu_items m where m.id = i.item_id))
                                      order by i.id)
                       from public.st_order_items i where i.order_id = o.id), '[]'::jsonb)) as j
            from public.st_orders o
            join public.st_tables t on t.id = o.table_id
            join public.st_table_sessions s on s.id = o.session_id
           where o.shop_id = p_shop and not o.is_charge
             and (o.status in ('new','accepted','cooking')
                  or (o.status in ('served','cancelled') and o.updated_at > now() - interval '60 minutes'))
           order by o.created_at desc
           limit 300
        ) x), '[]'::jsonb));
end
$$;

-- ---------- สิทธิ์ ----------
revoke all on function public.st_orders_to_go(),
  public.st_place_order_to_go(text, text, jsonb, text, text, text),
  public.st_cart_send_to_go(text, text, text, text, text),
  public.st_staff_order_to_go(text, jsonb, text, text)
from public, anon, authenticated;
grant execute on function public.st_place_order_to_go(text, text, jsonb, text, text, text),
                          public.st_cart_send_to_go(text, text, text, text, text) to anon, authenticated;
grant execute on function public.st_staff_order_to_go(text, jsonb, text, text) to authenticated;

insert into public.st_schema_log (id) values ('st-19-togo')
on conflict (id) do update set applied_at = now();
