-- =====================================================================
-- SmartTable · st-15-alerts.sql  (รอบ G)
-- 1) โหมด confirm: ลูกค้าสแกน = เปิดโต๊ะ แต่ "สั่งได้หลังร้านยืนยัน" (พนักงานสั่งแทน = ยืนยันให้อัตโนมัติ)
-- 2) คูปอง: ชื่อ/รายละเอียดให้ลูกค้าเห็น · แบบแสดง (show / call / hidden) · ใช้ร่วมโปรได้ไหม · โต๊ะละกี่คูปอง
--    ลูกค้าใส่โค้ด/สแกน QR เองได้ (st_session_coupons) · เรียกพนักงานมาตรวจสิทธิ์ (call 'coupon') · สถิติการใช้
-- 3) โปรตามเวลา: รายละเอียดให้ลูกค้าเห็น · ซ่อน/แสดงให้ลูกค้า
-- 4) แจ้งเตือนรวมหน้าร้าน (st_shop_alerts) · รูปอาหารบนจอออร์เดอร์ · รายงานเชิงลึก (st_sales_insights)
-- 5) prefs: ลำดับปุ่มหน้าร้าน (order) · การ์ดรายงานที่ซ่อน (reports_hidden) · แก้บั๊กบันทึก prefs ทับค่าเดิม
-- รันซ้ำได้ · ทับฟังก์ชัน: st_floor_status, st_order_board, st_coupon_quote, st_sales_report, st_update_profile
-- =====================================================================

-- ---------- 1) โหมด confirm: ห้ามลูกค้าสั่งจนกว่าร้านยืนยัน ----------
create or replace function public.st_orders_confirm_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.st_table_sessions s where s.id = new.session_id and s.confirm_status = 'pending') then
    -- พนักงานของร้านสั่งแทน (st_staff_order เรียก st_place_order ภายใต้บัญชีพนักงาน) = ยืนยันโต๊ะให้เลย
    if new.source = 'staff' or (auth.uid() is not null
        and public.st_has_shop_role(new.shop_id, array['owner','manager','cashier','waiter'])) then
      update public.st_table_sessions
         set confirm_status = 'confirmed', confirmed_at = now(), confirmed_by_user_id = auth.uid()
       where id = new.session_id;
      update public.st_service_calls set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
       where session_id = new.session_id and kind = 'open' and status = 'pending';
    else
      raise exception 'st_wait_confirm';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists st_orders_confirm_guard on public.st_orders;
create trigger st_orders_confirm_guard before insert on public.st_orders
  for each row execute function public.st_orders_confirm_guard();

-- ---------- 2) คอลัมน์ใหม่ ----------
alter table public.st_coupons add column if not exists title       text;
alter table public.st_coupons add column if not exists guest_note  text;
alter table public.st_coupons add column if not exists guest_mode  text not null default 'call';
alter table public.st_coupons add column if not exists stack_promo boolean not null default true;
alter table public.st_coupons drop constraint if exists st_coupons_title_check;
alter table public.st_coupons add constraint st_coupons_title_check check (title is null or char_length(title) <= 60);
alter table public.st_coupons drop constraint if exists st_coupons_guest_note_check;
alter table public.st_coupons add constraint st_coupons_guest_note_check check (guest_note is null or char_length(guest_note) <= 300);
alter table public.st_coupons drop constraint if exists st_coupons_guest_mode_check;
alter table public.st_coupons add constraint st_coupons_guest_mode_check check (guest_mode in ('show','call','hidden'));

alter table public.st_promotions add column if not exists guest_note text;
alter table public.st_promotions add column if not exists show_guest boolean not null default true;
alter table public.st_promotions drop constraint if exists st_promotions_guest_note_check;
alter table public.st_promotions add constraint st_promotions_guest_note_check check (guest_note is null or char_length(guest_note) <= 300);

alter table public.st_shops add column if not exists coupon_per_table smallint not null default 1;
alter table public.st_shops drop constraint if exists st_shops_coupon_per_table_check;
alter table public.st_shops add constraint st_shops_coupon_per_table_check check (coupon_per_table between 1 and 10);
grant update (coupon_per_table) on public.st_shops to authenticated;

alter table public.st_service_calls add column if not exists detail text;
alter table public.st_service_calls drop constraint if exists st_service_calls_detail_check;
alter table public.st_service_calls add constraint st_service_calls_detail_check check (detail is null or char_length(detail) <= 160);
alter table public.st_service_calls drop constraint if exists st_service_calls_kind_check;
alter table public.st_service_calls add constraint st_service_calls_kind_check check (kind in ('call','bill','slip','open','coupon'));

-- คูปองของแต่ละรอบโต๊ะ (ลูกค้าใส่เอง หรือแคชเชียร์ใช้ตอนเก็บเงิน)
create table if not exists public.st_session_coupons (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null,
  session_id  uuid not null,
  coupon_id   uuid not null,
  status      text not null default 'pending' check (status in ('pending','used')),
  source      text not null default 'guest' check (source in ('guest','staff')),
  payment_id  uuid,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  unique (session_id, coupon_id),
  foreign key (session_id, shop_id) references public.st_table_sessions (id, shop_id) on delete cascade,
  foreign key (coupon_id, shop_id)  references public.st_coupons (id, shop_id) on delete cascade
);
grant select on public.st_session_coupons to authenticated;
create index if not exists st_session_coupons_shop_idx on public.st_session_coupons (shop_id, created_at desc);
alter table public.st_session_coupons enable row level security;
drop policy if exists st_session_coupons_select_staff on public.st_session_coupons;
create policy st_session_coupons_select_staff on public.st_session_coupons
  for select to authenticated using (public.st_has_shop_role(shop_id, array['owner','manager','cashier','waiter']));

-- ---------- 3) ตัวช่วย: ตรวจคูปองกับรอบโต๊ะ ----------
create or replace function public.st_coupon_check(c public.st_coupons, p_session uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if c.id is null or not c.is_active then raise exception 'st_coupon_invalid'; end if;
  if (c.starts_on is not null and v_today < c.starts_on) or (c.ends_on is not null and v_today > c.ends_on) then
    raise exception 'st_coupon_expired';
  end if;
  if c.usage_limit is not null and c.used_count >= c.usage_limit then raise exception 'st_coupon_used_up'; end if;
  if not c.stack_promo and exists (
       select 1 from public.st_orders o join public.st_order_items i on i.order_id = o.id
        where o.session_id = p_session and o.status <> 'cancelled' and i.promo is not null) then
    raise exception 'st_coupon_no_promo';
  end if;
end
$$;

-- ---------- 4) ลูกค้า: ดูโปร/คูปอง · ใส่โค้ด · เรียกพนักงานมาตรวจ ----------
create or replace function public.st_guest_deals(p_qr text, p_session_token text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop  public.st_shops;
  v_sess  uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  select s.* into v_shop from public.st_tables t join public.st_shops s on s.id = t.shop_id
   where t.qr_token = p_qr and t.is_active and s.status = 'active';
  if v_shop.id is null then raise exception 'st_table_not_found'; end if;
  if p_session_token is not null then
    begin
      v_sess := (public.st_guest_session(p_qr, p_session_token)).id;
    exception when others then v_sess := null;
    end;
  end if;
  return jsonb_build_object(
    'limit', v_shop.coupon_per_table,
    'coupons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'title', c.title, 'kind', c.kind, 'value', c.value,
               'min_subtotal', c.min_subtotal, 'max_discount', c.max_discount, 'ends_on', c.ends_on,
               'note', c.guest_note, 'mode', c.guest_mode, 'stack_promo', c.stack_promo,
               'code', case when c.guest_mode = 'show' then c.code end)
             order by c.created_at desc)
        from public.st_coupons c
       where c.shop_id = v_shop.id and c.is_active and c.guest_mode <> 'hidden'
         and (c.starts_on is null or c.starts_on <= v_today) and (c.ends_on is null or c.ends_on >= v_today)
         and (c.usage_limit is null or c.used_count < c.usage_limit)), '[]'::jsonb),
    'promos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'percent', p.percent, 'days', p.days,
               'start_time', to_char(p.start_time, 'HH24:MI'), 'end_time', to_char(p.end_time, 'HH24:MI'),
               'category_ids', p.category_ids, 'item_ids', p.item_ids, 'note', p.guest_note,
               'active', public.st_promo_active_now(p))
             order by public.st_promo_active_now(p) desc, p.created_at desc)
        from public.st_promotions p
       where p.shop_id = v_shop.id and p.is_active and p.show_guest), '[]'::jsonb),
    'applied', case when v_sess is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', sc.id, 'status', sc.status, 'code', c.code, 'title', c.title,
                                          'kind', c.kind, 'value', c.value, 'max_discount', c.max_discount,
                                          'min_subtotal', c.min_subtotal)
             order by sc.created_at)
        from public.st_session_coupons sc join public.st_coupons c on c.id = sc.coupon_id
       where sc.session_id = v_sess), '[]'::jsonb) end,
    'call_pending', v_sess is not null and exists (select 1 from public.st_service_calls
                                                    where session_id = v_sess and kind = 'coupon' and status = 'pending'));
end
$$;

create or replace function public.st_guest_coupon_add(p_qr text, p_session_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess  public.st_table_sessions;
  c       public.st_coupons;
  v_limit int;
begin
  v_sess := public.st_guest_session(p_qr, p_session_token);
  if v_sess.order_type <> 'dine' then raise exception 'st_bad_request'; end if;
  select * into c from public.st_coupons
   where shop_id = v_sess.shop_id and code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  perform public.st_coupon_check(c, v_sess.id);
  if exists (select 1 from public.st_session_coupons where session_id = v_sess.id and coupon_id = c.id) then
    raise exception 'st_coupon_already';
  end if;
  select coupon_per_table into v_limit from public.st_shops where id = v_sess.shop_id;
  if (select count(*) from public.st_session_coupons where session_id = v_sess.id) >= v_limit then
    raise exception 'st_coupon_limit' using detail = v_limit::text;
  end if;
  insert into public.st_session_coupons (shop_id, session_id, coupon_id) values (v_sess.shop_id, v_sess.id, c.id);
  -- แจ้งร้าน (ขึ้นที่ผังโต๊ะ / จอออร์เดอร์ / ปุ่มโปรโมชันหน้าร้าน)
  insert into public.st_service_calls (shop_id, table_id, session_id, kind, detail)
  values (v_sess.shop_id, v_sess.table_id, v_sess.id, 'coupon', left('ใส่คูปอง ' || c.code || coalesce(' · ' || c.title, ''), 160))
  on conflict (session_id, kind) where status = 'pending'
  do update set detail = excluded.detail, created_at = now();
  update public.st_table_sessions set last_activity_at = now() where id = v_sess.id;
  return public.st_guest_deals(p_qr, p_session_token);
end
$$;

create or replace function public.st_guest_coupon_remove(p_qr text, p_session_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_sess public.st_table_sessions;
begin
  v_sess := public.st_guest_session(p_qr, p_session_token);
  delete from public.st_session_coupons where id = p_id and session_id = v_sess.id and status = 'pending';
  if not found then raise exception 'st_not_found'; end if;
  return public.st_guest_deals(p_qr, p_session_token);
end
$$;

-- คูปองที่ต้องตรวจสิทธิ์ (เช่น ดูบัตรประชาชน): ลูกค้ากด -> ร้านได้แจ้งเตือน -> พนักงานมาตรวจแล้วบอกโค้ด/ใส่ตอนเช็กบิล
create or replace function public.st_guest_coupon_call(p_qr text, p_session_token text, p_coupon uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess public.st_table_sessions;
  c      public.st_coupons;
begin
  v_sess := public.st_guest_session(p_qr, p_session_token);
  select * into c from public.st_coupons where id = p_coupon and shop_id = v_sess.shop_id and guest_mode <> 'hidden';
  perform public.st_coupon_check(c, v_sess.id);
  insert into public.st_service_calls (shop_id, table_id, session_id, kind, detail)
  values (v_sess.shop_id, v_sess.table_id, v_sess.id, 'coupon',
          left('ขอใช้คูปอง: ' || coalesce(c.title, case when c.kind = 'percent' then 'ลด ' || trim_scale(c.value) || '%'
                                                         else 'ลด ' || trim_scale(c.value) || ' บาท' end) || ' (' || c.code || ')', 160))
  on conflict (session_id, kind) where status = 'pending'
  do update set detail = excluded.detail, created_at = now();
  update public.st_table_sessions set last_activity_at = now() where id = v_sess.id;
  return public.st_guest_deals(p_qr, p_session_token);
end
$$;

-- ลูกค้าใส่คูปองไว้ = ต้องให้พนักงานเช็กบิล (หน้าจ่ายเองยังไม่หักคูปอง)
create or replace function public.st_pay_requests_coupon_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.st_session_coupons where session_id = new.session_id and status = 'pending') then
    raise exception 'st_coupon_need_staff';
  end if;
  return new;
end
$$;
drop trigger if exists st_pay_requests_coupon_guard on public.st_pay_requests;
create trigger st_pay_requests_coupon_guard before insert on public.st_pay_requests
  for each row execute function public.st_pay_requests_coupon_guard();

-- ใช้คูปองตอนเก็บเงินแล้ว -> บันทึกเป็น "ใช้แล้ว" ของรอบโต๊ะนั้น
create or replace function public.st_coupon_uses_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_sess uuid;
begin
  select session_id into v_sess from public.st_payments where id = new.payment_id;
  if v_sess is null then return new; end if;
  insert into public.st_session_coupons (shop_id, session_id, coupon_id, status, source, payment_id, used_at)
  values (new.shop_id, v_sess, new.coupon_id, 'used', 'staff', new.payment_id, now())
  on conflict (session_id, coupon_id) do update set status = 'used', payment_id = excluded.payment_id, used_at = now();
  return new;
end
$$;
drop trigger if exists st_coupon_uses_session on public.st_coupon_uses;
create trigger st_coupon_uses_session after insert on public.st_coupon_uses
  for each row execute function public.st_coupon_uses_session();

-- ---------- 5) ร้าน: ตั้งค่าคูปอง/โปรสำหรับลูกค้า · สถิติ · คูปองของโต๊ะ ----------
create or replace function public.st_set_coupon_guest(p_id uuid, p jsonb)
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
  begin
    update public.st_coupons
       set title       = nullif(trim(coalesce(p ->> 'title', '')), ''),
           guest_note  = nullif(trim(coalesce(p ->> 'guest_note', '')), ''),
           guest_mode  = coalesce(p ->> 'guest_mode', guest_mode),
           stack_promo = coalesce((p ->> 'stack_promo')::boolean, stack_promo)
     where id = p_id;
  exception when check_violation or invalid_text_representation then raise exception 'st_bad_coupon';
  end;
end
$$;

create or replace function public.st_set_promo_guest(p_id uuid, p jsonb)
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
  begin
    update public.st_promotions
       set guest_note = nullif(trim(coalesce(p ->> 'guest_note', '')), ''),
           show_guest = coalesce((p ->> 'show_guest')::boolean, show_guest)
     where id = p_id;
  exception when check_violation or invalid_text_representation then raise exception 'st_bad_promo';
  end;
end
$$;

-- สถิติคูปอง: ใช้ไปกี่ครั้ง ส่วนลดรวมเท่าไร (ทั้งหมด / 30 วัน / วันนี้) · ลูกค้าใส่รอใช้อยู่กี่โต๊ะ
create or replace function public.st_coupon_stats(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_today timestamptz := ((now() at time zone 'Asia/Bangkok')::date)::timestamp at time zone 'Asia/Bangkok';
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  return coalesce((
    select jsonb_object_agg(c.id, jsonb_build_object(
             'uses', (select count(*) from public.st_coupon_uses u where u.coupon_id = c.id),
             'discount', (select coalesce(sum(u.discount), 0) from public.st_coupon_uses u where u.coupon_id = c.id),
             'uses_30d', (select count(*) from public.st_coupon_uses u where u.coupon_id = c.id and u.created_at >= now() - interval '30 days'),
             'discount_30d', (select coalesce(sum(u.discount), 0) from public.st_coupon_uses u where u.coupon_id = c.id and u.created_at >= now() - interval '30 days'),
             'uses_today', (select count(*) from public.st_coupon_uses u where u.coupon_id = c.id and u.created_at >= v_today),
             'last_at', (select max(u.created_at) from public.st_coupon_uses u where u.coupon_id = c.id),
             'waiting', (select count(*) from public.st_session_coupons sc
                           join public.st_table_sessions s on s.id = sc.session_id and s.status <> 'closed'
                          where sc.coupon_id = c.id and sc.status = 'pending')))
      from public.st_coupons c where c.shop_id = p_shop), '{}'::jsonb);
end
$$;

-- คูปองที่ลูกค้าใส่ไว้ในรอบโต๊ะ (หน้าเช็กบิล)
create or replace function public.st_table_coupons(p_table uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_shop uuid; v_sess uuid;
begin
  select shop_id into v_shop from public.st_tables where id = p_table;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  select id into v_sess from public.st_table_sessions where table_id = p_table and status <> 'closed';
  if v_sess is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', sc.id, 'status', sc.status, 'source', sc.source, 'code', c.code,
                                        'title', c.title, 'kind', c.kind, 'value', c.value, 'note', c.note)
           order by sc.created_at)
      from public.st_session_coupons sc join public.st_coupons c on c.id = sc.coupon_id
     where sc.session_id = v_sess), '[]'::jsonb);
end
$$;

-- ---------- 6) แจ้งเตือนรวมหน้าร้าน ----------
-- p_since = {"receipts": ts, "coupons": ts, "audit": ts} เวลาที่เปิดดูหน้านั้นล่าสุด (เก็บในเครื่อง)
create or replace function public.st_shop_alerts(p_shop uuid, p_since jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mgr   boolean := public.st_has_shop_role(p_shop, array['owner','manager']);
  v_cash  boolean := public.st_has_shop_role(p_shop, array['owner','manager','cashier']);
  v_floor timestamptz := now() - interval '7 days';
  v_rec   timestamptz;
  v_cou   timestamptz;
  v_aud   timestamptz;
begin
  if not public.st_has_shop_role(p_shop) then raise exception 'st_forbidden'; end if;
  begin
    v_rec := greatest(coalesce((p_since ->> 'receipts')::timestamptz, now() - interval '12 hours'), v_floor);
    v_cou := greatest(coalesce((p_since ->> 'coupons')::timestamptz,  now() - interval '12 hours'), v_floor);
    v_aud := greatest(coalesce((p_since ->> 'audit')::timestamptz,    now() - interval '12 hours'), v_floor);
  exception when others then
    v_rec := now() - interval '12 hours'; v_cou := v_rec; v_aud := v_rec;
  end;
  return jsonb_build_object(
    'orders_new', (select count(*) from public.st_orders o join public.st_table_sessions s on s.id = o.session_id
                    where o.shop_id = p_shop and o.status = 'new' and s.order_type = 'dine' and s.status <> 'closed'),
    'takeaway_new', (select count(*) from public.st_orders o join public.st_table_sessions s on s.id = o.session_id
                      where o.shop_id = p_shop and o.status = 'new' and s.order_type = 'takeaway' and s.status <> 'closed'),
    'cooking', (select count(*) from public.st_orders o join public.st_table_sessions s on s.id = o.session_id
                 where o.shop_id = p_shop and o.status in ('accepted','cooking') and s.status <> 'closed'),
    'calls', coalesce((select jsonb_object_agg(kind, n) from (
                 select c.kind, count(*) n from public.st_service_calls c
                   join public.st_table_sessions s on s.id = c.session_id and s.status <> 'closed'
                  where c.shop_id = p_shop and c.status = 'pending' group by c.kind) x), '{}'::jsonb),
    'receipts', case when v_cash then (select count(*) from public.st_payments
                                        where shop_id = p_shop and status = 'paid' and created_at > v_rec) else 0 end,
    'coupons', case when v_mgr then (select count(*) from public.st_coupon_uses
                                      where shop_id = p_shop and created_at > v_cou)
                                  + (select count(*) from public.st_session_coupons
                                      where shop_id = p_shop and source = 'guest' and created_at > v_cou) else 0 end,
    'audit', case when v_mgr then (select count(*) from public.st_audit_log where shop_id = p_shop and at > v_aud) else 0 end,
    'now', now());
end
$$;

-- ---------- 7) ทับฟังก์ชันเดิม ----------
-- การเรียกที่รอ + รายละเอียด (เช่น คูปองที่ลูกค้าขอใช้) (ทับ st-05)
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
                                          'table_label', t.label, 'created_at', c.created_at, 'detail', c.detail)
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

-- จอออร์เดอร์: เพิ่มรูปอาหาร (ทับ st-14)
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
                   'order_type', s.order_type, 'queue_no', s.queue_no, 'pickup_at', s.pickup_at,
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
           where o.shop_id = p_shop
             and (o.status in ('new','accepted','cooking')
                  or (o.status in ('served','cancelled') and o.updated_at > now() - interval '60 minutes'))
           order by o.created_at desc
           limit 300
        ) x), '[]'::jsonb));
end
$$;

-- (ทับ st-11)
create or replace function public.st_coupon_quote(p_table uuid, p_code text, p_part jsonb default null)
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
  v_limit int;
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
  -- รอบ G: ใช้ร่วมกับโปรตามเวลาได้ไหม · โต๊ะละกี่คูปอง
  perform public.st_coupon_check(c, v_sess);
  select coupon_per_table into v_limit from public.st_shops where id = v_shop;
  if (select count(*) from public.st_session_coupons
       where session_id = v_sess and status = 'used' and coupon_id <> c.id) >= v_limit then
    raise exception 'st_coupon_limit' using detail = v_limit::text;
  end if;
  v_sub := (public.st_part_resolve(v_sess, p_part) ->> 'subtotal')::numeric;
  if v_sub < c.min_subtotal then raise exception 'st_coupon_min' using detail = c.min_subtotal::text; end if;
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

-- รายงานยอดขาย: ดูย้อนหลังได้ถึง 3 ปี (ทับ st-11)
create or replace function public.st_sales_report(p_shop uuid, p_from date, p_to date)
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
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then
    raise exception 'st_bad_date_range';
  end if;
  v_start := p_from::timestamp at time zone v_tz;
  v_end   := (p_to + 1)::timestamp at time zone v_tz;

  return (
    with pay as (
      select p.*, (p.created_at at time zone v_tz) as local_at
        from public.st_payments p
       where p.shop_id = p_shop and p.created_at >= v_start and p.created_at < v_end
    ),
    paid as (select * from pay where status = 'paid'),
    tend as (
      select t ->> 'method' as method, (t ->> 'amount')::numeric as amount, paid.id
        from paid, jsonb_array_elements(coalesce(paid.tenders,
                     jsonb_build_array(jsonb_build_object('method', paid.method, 'amount', paid.total)))) t
    ),
    items as (
      select i.name, i.item_id, i.qty, i.line_total
        from (select distinct session_id from paid) ps
        join public.st_orders o on o.session_id = ps.session_id and o.status <> 'cancelled'
        join public.st_order_items i on i.order_id = o.id
    ),
    closed as (
      select s.id, s.closed_at, t.label,
             (select coalesce(sum(o.subtotal), 0) from public.st_orders o
               where o.session_id = s.id and o.status <> 'cancelled')
             - (select coalesce(sum(p.subtotal), 0) from public.st_payments p
                 where p.session_id = s.id and p.status = 'paid') as amount
        from public.st_table_sessions s
        join public.st_tables t on t.id = s.table_id
       where s.shop_id = p_shop and s.status = 'closed'
         and s.closed_at >= v_start and s.closed_at < v_end
    ),
    leaks as (select * from closed where amount > 0)
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'totals', (select jsonb_build_object(
                   'bills', count(*),
                   'gross', coalesce(sum(subtotal), 0),
                   'discount', coalesce(sum(discount), 0),
                   'service', coalesce(sum(service), 0),
                   'vat', coalesce(sum(vat), 0),
                   'net', coalesce(sum(total), 0),
                   'avg_bill', coalesce(round(avg(total), 2), 0),
                   'tables', count(distinct session_id),
                   'guests', coalesce((select sum(s.guest_count) from public.st_table_sessions s
                                        where s.id in (select session_id from paid)), 0))
                 from paid),
      'voided', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(total), 0))
                   from pay where status = 'void'),
      'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'bills', n, 'total', t) order by t desc)
                               from (select method, count(distinct id) n, sum(amount) t from tend group by method) m), '[]'::jsonb),
      'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'bills', n, 'total', t) order by d)
                            from (select local_at::date d, count(*) n, sum(total) t from paid group by 1) x), '[]'::jsonb),
      'by_hour', coalesce((select jsonb_agg(jsonb_build_object('hour', h, 'bills', n, 'total', t) order by h)
                             from (select extract(hour from local_at)::int h, count(*) n, sum(total) t
                                     from paid group by 1) x), '[]'::jsonb),
      'top_items', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'revenue', r) order by r desc, q desc)
                               from (select name, sum(qty) q, sum(line_total) r from items
                                      group by name order by sum(line_total) desc, sum(qty) desc limit 20) x), '[]'::jsonb),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', c, 'qty', q, 'revenue', r) order by r desc)
                                 from (select coalesce(c.name, 'ไม่มีหมวด') c, sum(it.qty) q, sum(it.line_total) r
                                         from items it
                                         left join public.st_menu_items m on m.id = it.item_id
                                         left join public.st_categories c on c.id = m.category_id
                                        group by 1) x), '[]'::jsonb),
      'leaks', jsonb_build_object(
                 'count', (select count(*) from leaks),
                 'amount', (select coalesce(sum(amount), 0) from leaks),
                 'list', coalesce((select jsonb_agg(jsonb_build_object('table_label', label, 'closed_at', closed_at, 'amount', amount)
                                                    order by closed_at desc)
                                     from (select * from leaks order by closed_at desc limit 50) l), '[]'::jsonb)),
      'receipts', coalesce((select jsonb_agg(jsonb_build_object(
                                     'receipt_no', p.receipt_no, 'created_at', p.created_at, 'status', p.status,
                                     'table_label', t.label, 'method', p.method, 'subtotal', p.subtotal,
                                     'discount', p.discount, 'service', p.service, 'vat', p.vat, 'total', p.total,
                                     'part_no', p.part_no, 'tax_invoice', p.tax is not null)
                                   order by p.created_at)
                              from (select * from pay order by created_at limit 5000) p
                              join public.st_tables t on t.id = p.table_id), '[]'::jsonb)
    ));
end
$$;
-- โปรไฟล์: prefs เก็บเฉพาะคีย์ที่ส่งมา (ไม่ลบค่าเดิม) + ลำดับปุ่มหน้าร้าน + การ์ดรายงานที่ซ่อน (ทับ st-14)
create or replace function public.st_update_profile(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  text;
  v_av  text;
  v_nm  text;
  v_pf  jsonb;
  v_new jsonb := '{}'::jsonb;
  r     public.st_profiles;
begin
  if v_uid is null then raise exception 'st_not_authenticated'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'st_bad_request'; end if;
  perform public.st_ensure_profile();

  if p ? 'display_name' then
    v_nm := nullif(trim(coalesce(p ->> 'display_name', '')), '');
    if char_length(coalesce(v_nm, '')) > 60 then raise exception 'st_bad_request'; end if;
    update public.st_profiles set display_name = v_nm, updated_at = now() where user_id = v_uid;
  end if;
  if p ? 'public_id' then
    v_id := lower(trim(coalesce(p ->> 'public_id', '')));
    if v_id !~ '^[a-z0-9][a-z0-9_.]{3,19}$' then raise exception 'st_bad_public_id'; end if;
    if exists (select 1 from public.st_profiles where public_id = v_id and user_id <> v_uid) then
      raise exception 'st_public_id_taken';
    end if;
    update public.st_profiles set public_id = v_id, updated_at = now() where user_id = v_uid;
  end if;
  if p ? 'avatar_path' then
    v_av := nullif(p ->> 'avatar_path', '');
    if v_av is not null and v_av not like 'users/' || v_uid::text || '/%' then raise exception 'st_bad_image'; end if;
    update public.st_profiles set avatar_path = v_av, updated_at = now() where user_id = v_uid;
  end if;
  if p ? 'prefs' then
    v_pf := p -> 'prefs';
    if jsonb_typeof(v_pf) <> 'object' then raise exception 'st_bad_request'; end if;
    if v_pf ->> 'theme' in ('auto','light','dark') then v_new := v_new || jsonb_build_object('theme', v_pf ->> 'theme'); end if;
    if v_pf ->> 'layout' in ('list','tiles','icons','groups') then v_new := v_new || jsonb_build_object('layout', v_pf ->> 'layout'); end if;
    if jsonb_typeof(v_pf -> 'order') = 'array' and jsonb_array_length(v_pf -> 'order') <= 20
       and not exists (select 1 from jsonb_array_elements(v_pf -> 'order') e
                        where jsonb_typeof(e) <> 'string' or e #>> '{}' !~ '^[a-z]{2,15}$') then
      v_new := v_new || jsonb_build_object('order', v_pf -> 'order');
    end if;
    if jsonb_typeof(v_pf -> 'reports_hidden') = 'array' and jsonb_array_length(v_pf -> 'reports_hidden') <= 30
       and not exists (select 1 from jsonb_array_elements(v_pf -> 'reports_hidden') e
                        where jsonb_typeof(e) <> 'string' or e #>> '{}' !~ '^[a-z_]{2,20}$') then
      v_new := v_new || jsonb_build_object('reports_hidden', v_pf -> 'reports_hidden');
    end if;
    update public.st_profiles set prefs = coalesce(prefs, '{}'::jsonb) || v_new, updated_at = now() where user_id = v_uid;
  end if;

  select * into r from public.st_profiles where user_id = v_uid;
  return jsonb_build_object('user_id', r.user_id, 'email', r.email, 'display_name', r.display_name,
                            'public_id', r.public_id, 'avatar_path', r.avatar_path, 'prefs', r.prefs);
end
$$;

-- ---------- 8) รายงานเชิงลึก (กราฟ) — เจ้าของ / ผู้จัดการ ----------
create or replace function public.st_sales_insights(p_shop uuid, p_from date, p_to date)
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
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then raise exception 'st_bad_date_range'; end if;
  v_start := p_from::timestamp at time zone v_tz;
  v_end   := (p_to + 1)::timestamp at time zone v_tz;

  return (
    with ord as (
      select o.id, o.status, o.subtotal, o.created_at, (o.created_at at time zone v_tz) as local_at, s.order_type
        from public.st_orders o join public.st_table_sessions s on s.id = o.session_id
       where o.shop_id = p_shop and o.created_at >= v_start and o.created_at < v_end
    ),
    live as (select * from ord where status <> 'cancelled'),
    it as (
      select i.item_id, i.name, i.qty, i.unit_price, i.line_total, i.promo, i.done_at, l.id as order_id, l.created_at, l.local_at
        from live l join public.st_order_items i on i.order_id = l.id
    ),
    paid as (
      select p.*, (p.created_at at time zone v_tz) as local_at, s.order_type
        from public.st_payments p join public.st_table_sessions s on s.id = p.session_id
       where p.shop_id = p_shop and p.status = 'paid' and p.created_at >= v_start and p.created_at < v_end
    ),
    cu as (
      select u.coupon_id, u.discount from public.st_coupon_uses u
        join public.st_payments p on p.id = u.payment_id and p.status = 'paid'
       where u.shop_id = p_shop and u.created_at >= v_start and u.created_at < v_end
    ),
    pr as (
      select coalesce(promo ->> 'name', 'โปร') as name, qty,
             greatest(0, ((promo ->> 'original_unit')::numeric - unit_price) * qty) as disc
        from it where promo is not null
    ),
    ready as (
      select extract(epoch from (max(done_at) - min(created_at))) / 60 as mins
        from it group by order_id having bool_and(done_at is not null) and max(done_at) > min(created_at)
    )
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'by_month', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'bills', n, 'total', t, 'discount', d) order by k)
                              from (select to_char(local_at, 'YYYY-MM') k, count(*) n, sum(total) t, sum(discount) d
                                      from paid group by 1) x), '[]'::jsonb),
      'by_year', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'bills', n, 'total', t, 'discount', d) order by k)
                             from (select to_char(local_at, 'YYYY') k, count(*) n, sum(total) t, sum(discount) d
                                     from paid group by 1) x), '[]'::jsonb),
      'by_weekday', coalesce((select jsonb_agg(jsonb_build_object('dow', k, 'bills', n, 'total', t) order by k)
                                from (select extract(dow from local_at)::int k, count(*) n, sum(total) t
                                        from paid group by 1) x), '[]'::jsonb),
      'order_hours', coalesce((select jsonb_agg(jsonb_build_object('hour', h, 'orders', n, 'amount', a) order by h)
                                 from (select extract(hour from local_at)::int h, count(*) n, sum(subtotal) a
                                         from live group by 1) x), '[]'::jsonb),
      'top_qty', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'revenue', r, 'image', img) order by q desc, r desc)
                             from (select it.name, sum(it.qty) q, sum(it.line_total) r,
                                          (select m.image_path from public.st_menu_items m where m.id = (array_agg(it.item_id))[1]) img
                                     from it group by it.name order by sum(it.qty) desc, sum(it.line_total) desc limit 15) x), '[]'::jsonb),
      'coupons', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'title', c.title, 'uses', x.n, 'discount', x.d) order by x.n desc, x.d desc)
                             from (select coupon_id, count(*) n, sum(discount) d from cu group by 1) x
                             join public.st_coupons c on c.id = x.coupon_id), '[]'::jsonb),
      'promos', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'discount', d) order by d desc)
                            from (select name, sum(qty) q, round(sum(disc), 2) d from pr group by 1) x), '[]'::jsonb),
      'money', jsonb_build_object(
                 'gross_menu', coalesce((select sum(qty * coalesce((promo ->> 'original_unit')::numeric, unit_price)) from it), 0),
                 'promo', coalesce((select round(sum(disc), 2) from pr), 0),
                 'bill_discount', coalesce((select sum(discount) from paid), 0),
                 'coupon', coalesce((select sum(discount) from cu), 0),
                 'service', coalesce((select sum(service) from paid), 0),
                 'vat', coalesce((select sum(vat) from paid), 0),
                 'net', coalesce((select sum(total) from paid), 0)),
      'order_type', coalesce((select jsonb_agg(jsonb_build_object('type', k, 'bills', n, 'total', t) order by t desc)
                                from (select order_type k, count(*) n, sum(total) t from paid group by 1) x), '[]'::jsonb),
      'cancelled', jsonb_build_object('orders', (select count(*) from ord where status = 'cancelled'),
                                      'amount', coalesce((select sum(subtotal) from ord where status = 'cancelled'), 0)),
      'kitchen', jsonb_build_object('orders', (select count(*) from ready),
                                    'avg_min', (select round(avg(mins)::numeric, 1) from ready),
                                    'p90_min', (select round((percentile_cont(0.9) within group (order by mins))::numeric, 1) from ready)),
      'orders', jsonb_build_object('count', (select count(*) from live),
                                   'items', coalesce((select sum(qty) from it), 0))
    ));
end
$$;

-- ---------- 9) สิทธิ์ ----------
revoke all on function
  public.st_orders_confirm_guard(), public.st_coupon_check(public.st_coupons, uuid),
  public.st_guest_deals(text, text), public.st_guest_coupon_add(text, text, text),
  public.st_guest_coupon_remove(text, text, uuid), public.st_guest_coupon_call(text, text, uuid),
  public.st_pay_requests_coupon_guard(), public.st_coupon_uses_session(),
  public.st_set_coupon_guest(uuid, jsonb), public.st_set_promo_guest(uuid, jsonb), public.st_coupon_stats(uuid),
  public.st_table_coupons(uuid), public.st_shop_alerts(uuid, jsonb), public.st_sales_insights(uuid, date, date)
from public, anon, authenticated;
grant execute on function
  public.st_guest_deals(text, text), public.st_guest_coupon_add(text, text, text),
  public.st_guest_coupon_remove(text, text, uuid), public.st_guest_coupon_call(text, text, uuid)
to anon, authenticated;
grant execute on function
  public.st_set_coupon_guest(uuid, jsonb), public.st_set_promo_guest(uuid, jsonb), public.st_coupon_stats(uuid),
  public.st_table_coupons(uuid), public.st_shop_alerts(uuid, jsonb), public.st_sales_insights(uuid, date, date)
to authenticated;
-- st_floor_status / st_order_board / st_coupon_quote / st_sales_report / st_update_profile ใช้สิทธิ์เดิม

-- ---------- 10) บันทึกว่ารันไฟล์นี้แล้ว ----------
insert into public.st_schema_log (id) values ('st-15-alerts')
on conflict (id) do update set applied_at = now();
