-- =====================================================================
-- SmartTable · st-07-payments.sql  (รันซ้ำได้ · ต้องรัน st-01 ถึง st-06 ก่อน)
-- เช็กบิล / รับเงิน / ใบเสร็จ / ยกเลิกใบเสร็จ / พนักงานสั่งแทนลูกค้า / ถังสลิป st-slips
--
-- * รับเงินได้: เจ้าของ ผู้จัดการ แคชเชียร์ พนักงานเสิร์ฟ (ให้ส่วนลดได้เฉพาะ เจ้าของ/ผู้จัดการ/แคชเชียร์)
-- * ยอดคิดที่เซิร์ฟเวอร์ทั้งหมด และบันทึกตัวเลขลงใบเสร็จ (ตั้งค่าร้านเปลี่ยนทีหลังไม่กระทบใบเก่า)
-- * รับเงินแล้ว = ปิดโต๊ะอัตโนมัติ · เลขใบเสร็จนับใหม่ทุกวัน (เวลาไทย)
-- =====================================================================

-- ---------- 1) ตาราง ----------
create table if not exists public.st_payments (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null,
  session_id           uuid not null,
  table_id             uuid not null,
  receipt_no           int  not null,
  status               text not null default 'paid' check (status in ('paid','void')),
  method               text not null check (method in ('cash','promptpay','transfer','card')),
  subtotal             numeric(12,2) not null check (subtotal >= 0),
  discount             numeric(12,2) not null default 0 check (discount >= 0),
  service              numeric(12,2) not null default 0,
  service_pct          numeric(5,2)  not null default 0,
  vat                  numeric(12,2) not null default 0,
  vat_pct              numeric(5,2)  not null default 0,
  vat_included         boolean not null default true,
  total                numeric(12,2) not null check (total >= 0),
  received             numeric(12,2) not null check (received >= 0),
  change_amount        numeric(12,2) not null default 0 check (change_amount >= 0),
  slip_path            text,
  note                 text check (note is null or char_length(note) <= 200),
  received_by_user_id  uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  voided_at            timestamptz,
  voided_by_user_id    uuid references auth.users(id) on delete set null,
  void_reason          text check (void_reason is null or char_length(void_reason) <= 200),
  unique (id, shop_id),
  foreign key (session_id, shop_id) references public.st_table_sessions (id, shop_id) on delete cascade,
  foreign key (table_id, shop_id)   references public.st_tables (id, shop_id) on delete cascade
);
-- จ่ายได้ครั้งเดียวต่อรอบ (ยกเลิกใบเสร็จแล้วไม่นับ)
create unique index if not exists st_payments_one_paid on public.st_payments (session_id) where status = 'paid';
create index if not exists st_payments_shop_idx on public.st_payments (shop_id, created_at desc);

alter table public.st_payments enable row level security;
drop policy if exists st_payments_select_member on public.st_payments;
create policy st_payments_select_member on public.st_payments
  for select to authenticated using (public.st_has_shop_role(shop_id));
revoke all on public.st_payments from anon, authenticated;
grant select on public.st_payments to authenticated;

-- ---------- 2) ถังสลิป st-slips (ส่วนตัว) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('st-slips', 'st-slips', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists st_slips_select_staff on storage.objects;
create policy st_slips_select_staff on storage.objects
  for select to authenticated
  using (bucket_id = 'st-slips'
         and public.st_has_shop_role(public.st_path_shop(name), array['owner','manager','cashier','waiter']));

drop policy if exists st_slips_insert_staff on storage.objects;
create policy st_slips_insert_staff on storage.objects
  for insert to authenticated
  with check (bucket_id = 'st-slips'
              and split_part(name, '/', 3) = 'slips'
              and public.st_has_shop_role(public.st_path_shop(name), array['owner','manager','cashier','waiter']));

-- ---------- 3) ตัวช่วยภายใน: คิดบิลพร้อมส่วนลด ----------
-- ส่วนลดหักจากค่าอาหารก่อน แล้วค่อยคิดค่าบริการ และ VAT
create or replace function public.st_bill_calc(p_session uuid, p_discount numeric default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.st_shops;
  v_sub  numeric;
  v_disc numeric;
  v_base numeric;
  v_svc  numeric;
  v_vat  numeric;
  v_tot  numeric;
begin
  select sh.* into v_shop
    from public.st_table_sessions s join public.st_shops sh on sh.id = s.shop_id
   where s.id = p_session;
  select coalesce(sum(subtotal), 0) into v_sub
    from public.st_orders where session_id = p_session and status <> 'cancelled';
  v_disc := least(greatest(round(coalesce(p_discount, 0), 2), 0), v_sub);
  v_base := v_sub - v_disc;
  v_svc  := round(v_base * v_shop.service_pct / 100, 2);
  if v_shop.vat_included then
    v_vat := round((v_base + v_svc) * v_shop.vat_pct / (100 + v_shop.vat_pct), 2);
    v_tot := v_base + v_svc;
  else
    v_vat := round((v_base + v_svc) * v_shop.vat_pct / 100, 2);
    v_tot := v_base + v_svc + v_vat;
  end if;
  return jsonb_build_object('subtotal', v_sub, 'discount', v_disc, 'service', v_svc, 'service_pct', v_shop.service_pct,
                            'vat', v_vat, 'vat_pct', v_shop.vat_pct, 'vat_included', v_shop.vat_included,
                            'total', v_tot);
end
$$;

-- ---------- 4) RPC: หน้าเช็กบิล ----------
create or replace function public.st_checkout_preview(p_table uuid, p_discount numeric default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tab  public.st_tables;
  v_shop public.st_shops;
  v_sess public.st_table_sessions;
begin
  select * into v_tab from public.st_tables where id = p_table;
  if v_tab.id is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_tab.shop_id, array['owner','manager','cashier','waiter']) then
    raise exception 'st_forbidden';
  end if;
  select * into v_shop from public.st_shops where id = v_tab.shop_id;
  select * into v_sess from public.st_table_sessions where table_id = p_table and status <> 'closed';
  if v_sess.id is null then return null; end if;
  return jsonb_build_object(
    'session_id', v_sess.id, 'status', v_sess.status, 'guest_count', v_sess.guest_count, 'opened_at', v_sess.opened_at,
    'table_label', v_tab.label, 'shop_name', v_shop.name, 'promptpay_id', v_shop.promptpay_id,
    'unfinished', (select count(*) from public.st_orders
                    where session_id = v_sess.id and status in ('new','accepted','cooking')),
    'orders', public.st_orders_json(v_sess.id),
    'bill', public.st_bill_calc(v_sess.id, p_discount));
end
$$;

-- รับเงิน + ปิดโต๊ะ
-- p_method: 'cash' | 'promptpay' | 'transfer' | 'card' · p_received ใช้กับเงินสด (ต้อง >= ยอดรวม)
create or replace function public.st_record_payment(p_table uuid, p_method text, p_discount numeric default 0,
                                                    p_received numeric default null, p_slip_path text default null,
                                                    p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tab   public.st_tables;
  v_sess  public.st_table_sessions;
  v_bill  jsonb;
  v_total numeric;
  v_recv  numeric;
  v_no    int;
  v_id    uuid;
  v_slip  text := nullif(trim(coalesce(p_slip_path, '')), '');
begin
  select * into v_tab from public.st_tables where id = p_table;
  if v_tab.id is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_tab.shop_id, array['owner','manager','cashier','waiter']) then
    raise exception 'st_forbidden';
  end if;
  if coalesce(p_discount, 0) > 0
     and not public.st_has_shop_role(v_tab.shop_id, array['owner','manager','cashier']) then
    raise exception 'st_discount_forbidden';
  end if;
  if p_discount is not null and p_discount < 0 then raise exception 'st_bad_request'; end if;
  if p_method not in ('cash','promptpay','transfer','card') then raise exception 'st_bad_request'; end if;
  if char_length(coalesce(p_note, '')) > 200 then raise exception 'st_bad_request'; end if;
  if v_slip is not null and v_slip not like 'shops/' || v_tab.shop_id::text || '/slips/%' then
    raise exception 'st_bad_image';
  end if;

  select * into v_sess from public.st_table_sessions
   where table_id = p_table and status <> 'closed' for update;
  if v_sess.id is null then raise exception 'st_table_not_open'; end if;
  if exists (select 1 from public.st_payments where session_id = v_sess.id and status = 'paid') then
    raise exception 'st_already_paid';
  end if;
  if not exists (select 1 from public.st_orders where session_id = v_sess.id and status <> 'cancelled') then
    raise exception 'st_nothing_to_pay';
  end if;

  v_bill  := public.st_bill_calc(v_sess.id, p_discount);
  v_total := (v_bill ->> 'total')::numeric;
  if p_method = 'cash' then
    v_recv := round(coalesce(p_received, v_total), 2);
    if v_recv < v_total then raise exception 'st_cash_not_enough'; end if;
    if v_recv > v_total + 100000 then raise exception 'st_bad_request'; end if;
  else
    v_recv := v_total;
  end if;

  perform pg_advisory_xact_lock(hashtext('st_receipt_no:' || v_tab.shop_id::text));
  select coalesce(max(receipt_no), 0) + 1 into v_no
    from public.st_payments
   where shop_id = v_tab.shop_id
     and created_at >= (date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok');

  insert into public.st_payments (shop_id, session_id, table_id, receipt_no, method,
                                  subtotal, discount, service, service_pct, vat, vat_pct, vat_included, total,
                                  received, change_amount, slip_path, note, received_by_user_id)
  values (v_tab.shop_id, v_sess.id, p_table, v_no, p_method,
          (v_bill ->> 'subtotal')::numeric, (v_bill ->> 'discount')::numeric,
          (v_bill ->> 'service')::numeric, (v_bill ->> 'service_pct')::numeric,
          (v_bill ->> 'vat')::numeric, (v_bill ->> 'vat_pct')::numeric, (v_bill ->> 'vat_included')::boolean,
          v_total, v_recv, v_recv - v_total, v_slip, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  update public.st_table_sessions
     set status = 'closed', closed_at = now(), closed_by_user_id = auth.uid()
   where id = v_sess.id;
  update public.st_service_calls
     set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
   where session_id = v_sess.id and status = 'pending';

  return jsonb_build_object('payment_id', v_id, 'receipt_no', v_no, 'total', v_total,
                            'received', v_recv, 'change', v_recv - v_total);
end
$$;

-- ยกเลิกใบเสร็จ (เจ้าของ / ผู้จัดการ) · ไม่เปิดโต๊ะคืน
create or replace function public.st_void_payment(p_payment uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_payments where id = p_payment;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if char_length(coalesce(trim(p_reason), '')) not between 1 and 200 then raise exception 'st_void_reason'; end if;
  update public.st_payments
     set status = 'void', voided_at = now(), voided_by_user_id = auth.uid(), void_reason = trim(p_reason)
   where id = p_payment and status = 'paid';
  if not found then raise exception 'st_already_void'; end if;
end
$$;

-- ข้อมูลใบเสร็จสำหรับพิมพ์ (สมาชิกร้านทุกตำแหน่ง)
create or replace function public.st_receipt(p_payment uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.st_payments;
begin
  select * into p from public.st_payments where id = p_payment;
  if p.id is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(p.shop_id) then raise exception 'st_forbidden'; end if;
  return jsonb_build_object(
    'id', p.id, 'receipt_no', p.receipt_no, 'status', p.status, 'method', p.method, 'created_at', p.created_at,
    'subtotal', p.subtotal, 'discount', p.discount, 'service', p.service, 'service_pct', p.service_pct,
    'vat', p.vat, 'vat_pct', p.vat_pct, 'vat_included', p.vat_included, 'total', p.total,
    'received', p.received, 'change', p.change_amount, 'note', p.note, 'has_slip', p.slip_path is not null,
    'slip_path', p.slip_path, 'void_reason', p.void_reason,
    'shop', (select jsonb_build_object('id', s.id, 'name', s.name, 'address', s.address, 'phone', s.phone)
               from public.st_shops s where s.id = p.shop_id),
    'table_label', (select label from public.st_tables where id = p.table_id),
    'opened_at', (select opened_at from public.st_table_sessions where id = p.session_id),
    'guest_count', (select guest_count from public.st_table_sessions where id = p.session_id),
    'cashier', (select coalesce(pr.display_name, split_part(pr.email, '@', 1))
                  from public.st_profiles pr where pr.user_id = p.received_by_user_id),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'options', x.opts, 'qty', x.qty,
                                          'unit_price', x.unit_price, 'line_total', x.line_total)
                       order by x.first_at)
        from (select i.name, i.unit_price,
                     (select string_agg(e ->> 'name', ' · ') from jsonb_array_elements(i.options) e) as opts,
                     sum(i.qty) as qty, sum(i.line_total) as line_total, min(o.created_at) as first_at
                from public.st_order_items i
                join public.st_orders o on o.id = i.order_id
               where o.session_id = p.session_id and o.status <> 'cancelled'
               group by i.name, i.unit_price, 3) x), '[]'::jsonb));
end
$$;

-- ใบเสร็จล่าสุดของร้าน (ไว้พิมพ์ซ้ำ / ยกเลิก)
create or replace function public.st_recent_payments(p_shop uuid, p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'receipt_no', p.receipt_no, 'status', p.status,
                                        'method', p.method, 'total', p.total, 'created_at', p.created_at,
                                        'table_label', t.label) order by p.created_at desc)
      from (select * from public.st_payments where shop_id = p_shop
             order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) p
      join public.st_tables t on t.id = p.table_id), '[]'::jsonb);
end
$$;

-- ---------- 5) RPC: พนักงานสั่งแทนลูกค้า ----------
-- ใช้กติกาเดียวกับลูกค้าทุกอย่าง (ราคา ตัวเลือก ของหมด) แล้วบันทึกว่าเป็นพนักงานสั่ง
create or replace function public.st_staff_order(p_qr text, p_items jsonb, p_note text default null,
                                                 p_client_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tab  public.st_tables;
  v_tok  text;
  v_res  jsonb;
begin
  select * into v_tab from public.st_tables where qr_token = p_qr;
  if v_tab.id is null then raise exception 'st_table_not_found'; end if;
  if not public.st_has_shop_role(v_tab.shop_id, array['owner','manager','cashier','waiter']) then
    raise exception 'st_forbidden';
  end if;
  select session_token into v_tok from public.st_table_sessions where table_id = v_tab.id and status <> 'closed';
  if v_tok is null then raise exception 'st_table_not_open'; end if;

  v_res := public.st_place_order(p_qr, v_tok, p_items, p_note, null, p_client_ref);
  update public.st_orders
     set source = 'staff', staff_user_id = auth.uid()
   where id = (v_res ->> 'order_id')::uuid and staff_user_id is null;
  return v_res;
end
$$;

-- ---------- 6) สิทธิ์เรียกฟังก์ชัน ----------
revoke all on function
  public.st_bill_calc(uuid, numeric), public.st_checkout_preview(uuid, numeric),
  public.st_record_payment(uuid, text, numeric, numeric, text, text), public.st_void_payment(uuid, text),
  public.st_receipt(uuid), public.st_recent_payments(uuid, int), public.st_staff_order(text, jsonb, text, text)
from public, anon, authenticated;

grant execute on function
  public.st_checkout_preview(uuid, numeric), public.st_record_payment(uuid, text, numeric, numeric, text, text),
  public.st_void_payment(uuid, text), public.st_receipt(uuid), public.st_recent_payments(uuid, int),
  public.st_staff_order(text, jsonb, text, text)
to authenticated;
-- st_bill_calc: ใช้ภายในเท่านั้น

-- ---------- 7) Realtime: ผังโต๊ะรู้ทันทีเมื่อรับเงิน ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'st_payments') then
    alter publication supabase_realtime add table public.st_payments;
  end if;
end
$$;

-- ---------- 8) บันทึกว่ารันไฟล์นี้แล้ว ----------
insert into public.st_schema_log (id) values ('st-07-payments')
on conflict (id) do update set applied_at = now();
