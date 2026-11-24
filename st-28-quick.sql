-- =====================================================================
-- SmartTable st-28 · สั่งด่วนจากห้องแชท DarkChat (รับที่ร้านแบบคิว)
-- ต้องรัน st-27-chat ก่อน · รันซ้ำได้
--  - ร้านเลือก "เมนูด่วน" เอง (st_menu_items.quick) และเปิดสั่งด่วนต่อห้อง (st_chat_links.quick_on)
--  - คนในห้องกด 🍽️ > ใส่ชื่อ > เลือกเมนู > ได้บัตรคิว (ใช้ระบบคิวกลับบ้านเดิม)
--  - จ่ายได้ 2 แบบ: จ่ายที่ร้าน หรือ PromptPay + แนบสลิป (หน้าบัตรคิวเดิมของ SmartTable)
--  - กันสแปม: คนละไม่เกิน 5 ออร์เดอร์ / 10 นาที
--  - คิวพร้อมแล้ว -> แจ้งกลับในห้องที่สั่ง
-- =====================================================================

alter table public.st_menu_items add column if not exists quick boolean not null default false;
create index if not exists st_menu_items_quick_idx on public.st_menu_items (shop_id) where quick;

alter table public.st_table_sessions add column if not exists chat_room text;
alter table public.st_table_sessions add column if not exists chat_user uuid references auth.users(id) on delete set null;
create index if not exists st_table_sessions_chat_user_idx on public.st_table_sessions (chat_user, opened_at desc) where chat_user is not null;

-- ---------- โพสต์ลงห้องที่เชื่อม (ข้ามห้องที่ตั้งไว้ใน st.chat_skip_room) ----------
create or replace function public.st_chat_post(p_shop uuid, p_event text, p_text text, p_meta jsonb default '{}'::jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare l record; n int := 0; skip text := coalesce(current_setting('st.chat_skip_room', true), '');
begin
  for l in select * from public.st_chat_links c where c.shop_id = p_shop and c.room_key <> skip and case p_event
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

-- ---------- รายการในออร์เดอร์ (ข้อความ) ----------
create or replace function public.st_chat_items_text(p_order uuid)
returns text language sql stable security definer set search_path = '' as $$
  select string_agg('• ' || i.name || ' ×' || i.qty
      || coalesce(' (' || nullif((select string_agg(x->>'name', ', ') from jsonb_array_elements(coalesce(i.options, '[]'::jsonb)) x), '') || ')', '')
      || coalesce(' — ' || nullif(i.note, ''), ''), chr(10) order by i.id)
    from public.st_order_items i where i.order_id = p_order
$$;
revoke all on function public.st_chat_items_text(uuid) from public, anon, authenticated;

-- ---------- คิวพร้อม: แจ้งห้องที่สั่ง + ห้องร้าน ----------
create or replace function public.st_chat_on_ready()
returns trigger language plpgsql security definer set search_path = '' as $$
declare shop text; l record;
begin
  if new.ready_at is null or old.ready_at is not null then return null; end if;
  if not exists (select 1 from public.st_tables where id = new.table_id and kind = 'ticket') then return null; end if;
  select name into shop from public.st_shops where id = new.shop_id;
  if new.chat_room is not null then
    select * into l from public.st_chat_links where room_key = new.chat_room and shop_id = new.shop_id;
    perform public.ext_ledger_post(new.chat_room, null, l.created_by,
      '✅ ' || shop || ' · คิว ' || coalesce(new.queue_no::text, '?') || coalesce(' (' || nullif(new.contact_name, '') || ')', '')
        || ' พร้อมรับแล้ว 🛍 มารับที่ร้านได้เลย',
      jsonb_build_object('ext', 'smarttable', 'type', 'ready', 'shop', new.shop_id, 'session', new.id, 'ready', true), true);
    perform set_config('st.chat_skip_room', new.chat_room, true);
  end if;
  perform public.st_chat_post(new.shop_id, 'queue',
    '✅ ' || shop || ' · ' || public.st_chat_where(new.table_id, new.id) || ' พร้อมรับแล้ว',
    jsonb_build_object('session', new.id, 'ready', true));
  perform set_config('st.chat_skip_room', '', true);
  return null;
exception when others then return null;
end $$;

-- ---------- ร้าน: เลือกเมนูด่วน ----------
create or replace function public.st_chat_quick_admin(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.st_has_shop_role(p_shop, array['owner', 'manager']) then raise exception 'st_forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'price', m.price, 'quick', m.quick,
                    'available', m.is_available, 'cat', c.name) order by c.sort nulls last, m.sort, m.name)
                     from public.st_menu_items m left join public.st_categories c on c.id = m.category_id
                    where m.shop_id = p_shop and m.combo is null), '[]'::jsonb);
end $$;
revoke all on function public.st_chat_quick_admin(uuid) from public, anon;
grant execute on function public.st_chat_quick_admin(uuid) to authenticated;

create or replace function public.st_chat_quick_set(p_shop uuid, p_items uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.st_has_shop_role(p_shop, array['owner', 'manager']) then raise exception 'st_forbidden'; end if;
  if coalesce(array_length(p_items, 1), 0) > 30 then raise exception 'st_quick_limit'; end if;
  update public.st_menu_items set quick = (id = any(coalesce(p_items, '{}'))) where shop_id = p_shop
     and quick is distinct from (id = any(coalesce(p_items, '{}')));
  select count(*) into n from public.st_menu_items where shop_id = p_shop and quick;
  return n;
end $$;
revoke all on function public.st_chat_quick_set(uuid, uuid[]) from public, anon;
grant execute on function public.st_chat_quick_set(uuid, uuid[]) to authenticated;

-- ---------- คนในห้อง: ร้านที่สั่งด่วนได้ + เมนูด่วน ----------
create or replace function public.st_chat_quick_menu(p_room text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.ext_room_ok(p_room) then raise exception 'not_in_room'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'shop_id', s.id, 'name', s.name, 'logo_path', s.logo_path,
      'is_open', s.is_open and s.status = 'active' and public.st_shop_licensed(s.id),
      'promptpay', s.self_pay and s.promptpay_id is not null,
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'price', m.price,
                 'image_path', m.image_path, 'available', m.is_available and coalesce(m.stock_left, 1) > 0,
                 'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
                     'choices', coalesce((select jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name, 'price', ch.price_delta) order by ch.sort, ch.name)
                                            from public.st_option_choices ch where ch.group_id = g.id), '[]'::jsonb)) order by g.sort, g.name)
                     from public.st_option_groups g where g.item_id = m.id), '[]'::jsonb))
               order by m.sort, m.name)
               from public.st_menu_items m where m.shop_id = s.id and m.quick and m.combo is null), '[]'::jsonb))
      order by l.created_at)
    from public.st_chat_links l join public.st_shops s on s.id = l.shop_id
   where l.room_key = p_room and l.quick_on), '[]'::jsonb);
end $$;
revoke all on function public.st_chat_quick_menu(text) from public, anon;
grant execute on function public.st_chat_quick_menu(text) to authenticated;

-- ---------- คนในห้อง: สั่งด่วน -> บัตรคิวรับที่ร้าน ----------
-- p_items = [{item_id, qty, choices:[choice_id], note}]
create or replace function public.st_chat_order(p_room text, p_shop uuid, p_items jsonb, p_name text,
                                                p_note text default null, p_client_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me    uuid := auth.uid();
  sh    public.st_shops;
  v_ref text := nullif(trim(coalesce(p_client_ref, '')), '');
  c     jsonb;
  v_tab public.st_tables;
  v_sess public.st_table_sessions;
  v_res jsonb;
  r     record;
  pay   boolean;
begin
  if me is null then raise exception 'st_forbidden'; end if;
  if not public.ext_room_ok(p_room) or p_room !~ '^(g|d):' then raise exception 'not_in_room'; end if;
  if not exists (select 1 from public.st_chat_links where room_key = p_room and shop_id = p_shop and quick_on) then
    raise exception 'st_quick_off';
  end if;
  select * into sh from public.st_shops where id = p_shop;
  if sh.id is null or sh.status <> 'active' then raise exception 'st_table_not_found'; end if;
  if not sh.is_open then raise exception 'st_shop_closed'; end if;
  if not public.st_shop_licensed(p_shop) then raise exception 'st_ext_locked'; end if;
  pay := sh.self_pay and sh.promptpay_id is not null;

  -- ส่งซ้ำด้วยรหัสเดิม = ได้บัตรคิวเดิม
  if v_ref is not null then
    select t.qr_token, s.queue_no, o.id as order_id, o.order_no, o.subtotal into r
      from public.st_orders o
      join public.st_table_sessions s on s.id = o.session_id and s.chat_user = me
      join public.st_tables t on t.id = s.table_id
     where o.shop_id = p_shop and o.client_ref = v_ref and o.created_at > now() - interval '1 day'
     limit 1;
    if r.qr_token is not null then
      return jsonb_build_object('order_id', r.order_id, 'order_no', r.order_no, 'subtotal', r.subtotal,
                                'qr_token', r.qr_token, 'queue_no', r.queue_no, 'shop_name', sh.name, 'promptpay', pay, 'duplicate', true);
    end if;
  end if;

  if (select count(*) from public.st_table_sessions where chat_user = me and opened_at > now() - interval '10 minutes') >= 5 then
    raise exception 'st_too_many_orders';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'st_bad_cart';
  end if;
  -- สั่งได้เฉพาะเมนูด่วน
  if exists (select 1 from jsonb_array_elements(p_items) x
              where not exists (select 1 from public.st_menu_items m
                                 where m.shop_id = p_shop and m.quick and m.id::text = x->>'item_id')) then
    raise exception 'st_item_gone';
  end if;
  if (select count(*) from public.st_table_sessions
       where shop_id = p_shop and order_type = 'takeaway' and status <> 'closed') >= 150 then
    raise exception 'st_queue_full';
  end if;

  c := public.st_ticket_contact(p_shop, p_name, null, null, true);
  v_tab := public.st_new_ticket(p_shop, c ->> 'name', null, null, 'takeaway');
  update public.st_table_sessions set chat_room = p_room, chat_user = me
   where table_id = v_tab.id and status <> 'closed' returning * into v_sess;

  perform set_config('st.chat_skip_room', p_room, true);     -- ห้องที่สั่ง: โพสต์เองด้านล่าง (ไม่ซ้ำ)
  v_res := public.st_place_order(v_tab.qr_token, v_sess.session_token, p_items, p_note, c ->> 'name', v_ref);

  perform public.ext_ledger_post(p_room, null, me,
    '🛍 สั่งด่วน · ' || sh.name || ' · คิว ' || v_sess.queue_no || ' (' || (c ->> 'name') || ')'
      || chr(10) || coalesce(public.st_chat_items_text((v_res ->> 'order_id')::uuid), '')
      || chr(10) || 'รวม ' || public.st_chat_money((v_res ->> 'subtotal')::numeric)
      || coalesce(chr(10) || '📝 ' || nullif(trim(coalesce(p_note, '')), ''), '')
      || chr(10) || 'รับที่ร้าน · จ่ายที่ร้าน' || case when pay then ' หรือ PromptPay' else '' end,
    jsonb_build_object('ext', 'smarttable', 'type', 'quick', 'shop', p_shop, 'order', v_res ->> 'order_id', 'queue', v_sess.queue_no), true);

  return v_res || jsonb_build_object('qr_token', v_tab.qr_token, 'queue_no', v_sess.queue_no,
                                     'shop_name', sh.name, 'promptpay', pay);
end $$;
revoke all on function public.st_chat_order(text, uuid, jsonb, text, text, text) from public, anon;
grant execute on function public.st_chat_order(text, uuid, jsonb, text, text, text) to authenticated;

-- ---------- room_info: เพิ่มจำนวนเมนูด่วน ----------
create or replace function public.st_chat_room_info(p_room text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.ext_room_ok(p_room) then raise exception 'not_in_room'; end if;
  return jsonb_build_object(
    'links', coalesce((select jsonb_agg(jsonb_build_object('shop_id', l.shop_id, 'name', s.name, 'is_open', s.is_open,
        'can', public.st_has_shop_role(l.shop_id, array['owner', 'manager']) or l.created_by = auth.uid(),
        'manage', public.st_has_shop_role(l.shop_id, array['owner', 'manager']),
        'orders', l.ev_orders, 'open', l.ev_open, 'call', l.ev_call, 'bill', l.ev_bill, 'queue', l.ev_queue,
        'summary', l.ev_summary, 'quick', l.quick_on,
        'quick_n', (select count(*) from public.st_menu_items m where m.shop_id = l.shop_id and m.quick)) order by l.created_at)
      from public.st_chat_links l join public.st_shops s on s.id = l.shop_id where l.room_key = p_room), '[]'::jsonb),
    'my_shops', public.st_chat_my_shops());
end $$;

insert into public.st_schema_log (id) values ('st-28-quick') on conflict (id) do update set applied_at = now();
