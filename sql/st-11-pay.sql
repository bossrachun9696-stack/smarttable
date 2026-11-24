-- =====================================================================
-- SmartTable · st-11-pay.sql  (รันซ้ำได้ · ต้องรัน st-01 ถึง st-10 ก่อน)
-- รอบ C: ลูกค้าจ่ายเองด้วยพร้อมเพย์ + แนบสลิป · แยกบิล / จ่ายหลายช่องทาง · ใบกำกับภาษีอย่างย่อ
--
-- * แยกบิล: 1 รอบโต๊ะมีใบเสร็จได้หลายใบ — แบบ "ทั้งหมดที่เหลือ" / "ตามยอด (หารเท่ากัน)" / "เลือกรายการ"
--   ปิดโต๊ะอัตโนมัติเมื่อจ่ายครบ · ส่วนลด ค่าบริการ VAT คิดแยกต่อใบ
-- * จ่ายหลายช่องทาง: ใบเดียวรับได้ถึง 4 ช่องทาง (เงินสดได้ 1 ช่อง) เก็บใน st_payments.tenders
-- * ลูกค้าจ่ายเอง: ร้านต้องเปิด self_pay + ตั้งเลขพร้อมเพย์ · ลูกค้าโอนยอดที่เหลือทั้งหมด แนบสลิป
--   -> พนักงานเห็นการแจ้ง "สลิปรอตรวจ" -> ตรวจยอดเข้าแอปธนาคาร แล้วกดยืนยัน หรือปฏิเสธ
-- * ใบกำกับภาษีอย่างย่อ: ร้านใส่เลขผู้เสียภาษี 13 หลัก + มี VAT -> ใบเสร็จพิมพ์เป็นใบกำกับภาษีอย่างย่อ
--   ข้อมูลภาษีถูกบันทึกลงใบตอนรับเงิน (แก้ตั้งค่าทีหลังไม่กระทบใบเก่า)
-- * ไฟล์นี้ทับ st_record_payment, st_receipt, st_recent_payments, st_guest_orders, st_sales_report,
--   st_audit_sessions และเปลี่ยน st_coupon_quote เป็น 3 พารามิเตอร์ — ถ้ารันไฟล์เก่าซ้ำ ให้รันไฟล์นี้ซ้ำด้วย
-- =====================================================================

-- ---------- 1) ตั้งค่าร้าน ----------
alter table public.st_shops add column if not exists self_pay boolean not null default false;
alter table public.st_shops add column if not exists tax_id text
  constraint st_shops_tax_id_check check (tax_id is null or tax_id ~ '^[0-9]{13}$');
alter table public.st_shops add column if not exists tax_name text
  constraint st_shops_tax_name_check check (tax_name is null or char_length(tax_name) <= 120);
alter table public.st_shops add column if not exists tax_branch text
  constraint st_shops_tax_branch_check check (tax_branch is null or char_length(tax_branch) <= 40);
alter table public.st_shops add column if not exists pos_id text
  constraint st_shops_pos_id_check check (pos_id is null or char_length(pos_id) <= 40);
grant update (self_pay, tax_id, tax_name, tax_branch, pos_id) on public.st_shops to authenticated;

-- ---------- 2) ใบเสร็จ: แยกบิล + หลายช่องทาง + ข้อมูลภาษี ----------
alter table public.st_payments add column if not exists portion text not null default 'full';
alter table public.st_payments add column if not exists part_no smallint not null default 1;
alter table public.st_payments add column if not exists tenders jsonb;     -- [{method, amount, received, change, slip_path}]
alter table public.st_payments add column if not exists tax jsonb;         -- {tax_id, name, branch, pos_id} = ใบกำกับภาษีอย่างย่อ
alter table public.st_payments add column if not exists request_id uuid;   -- มาจากลูกค้าจ่ายเอง

alter table public.st_payments drop constraint if exists st_payments_portion_check;
alter table public.st_payments add constraint st_payments_portion_check check (portion in ('full','amount','items'));
alter table public.st_payments drop constraint if exists st_payments_method_check;
alter table public.st_payments add constraint st_payments_method_check
  check (method in ('cash','promptpay','transfer','card','mixed'));

-- 1 รอบจ่ายได้หลายใบแล้ว
drop index if exists public.st_payments_one_paid;
create index if not exists st_payments_session_idx on public.st_payments (session_id);

-- ใบเก่า (ก่อนไฟล์นี้) = 1 ช่องทาง
update public.st_payments
   set tenders = jsonb_build_array(jsonb_build_object('method', method, 'amount', total, 'received', received,
                                                      'change', change_amount, 'slip_path', slip_path))
 where tenders is null;

-- รายการที่จ่ายในแต่ละใบ (แยกบิลแบบเลือกรายการ / ใบสุดท้าย)
create table if not exists public.st_payment_items (
  payment_id     uuid not null,
  shop_id        uuid not null,
  order_item_id  uuid not null references public.st_order_items(id) on delete cascade,
  qty            smallint not null check (qty between 1 and 99),
  amount         numeric(12,2) not null check (amount >= 0),
  primary key (payment_id, order_item_id),
  foreign key (payment_id, shop_id) references public.st_payments (id, shop_id) on delete cascade
);
create index if not exists st_payment_items_item_idx on public.st_payment_items (order_item_id);
alter table public.st_payment_items enable row level security;
drop policy if exists st_payment_items_select_member on public.st_payment_items;
create policy st_payment_items_select_member on public.st_payment_items
  for select to authenticated using (public.st_has_shop_role(shop_id));
revoke all on public.st_payment_items from anon, authenticated;
grant select on public.st_payment_items to authenticated;

-- ---------- 3) ลูกค้าแจ้งโอน (แนบสลิป) ----------
create table if not exists public.st_pay_requests (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid not null,
  session_id          uuid not null,
  table_id            uuid not null,
  status              text not null default 'draft'
                      check (status in ('draft','pending','confirmed','rejected','cancelled')),
  amount              numeric(12,2) not null check (amount > 0),
  prev_status         text,                     -- สถานะโต๊ะก่อนลูกค้ากดจ่าย (คืนให้ถ้ายกเลิก / ถูกปฏิเสธ)
  slip_path           text,
  reject_reason       text check (reject_reason is null or char_length(reject_reason) <= 200),
  payment_id          uuid,
  created_at          timestamptz not null default now(),
  submitted_at        timestamptz,
  handled_at          timestamptz,
  handled_by_user_id  uuid references auth.users(id) on delete set null,
  unique (id, shop_id),
  foreign key (session_id, shop_id) references public.st_table_sessions (id, shop_id) on delete cascade,
  foreign key (table_id, shop_id)   references public.st_tables (id, shop_id) on delete cascade
);
create unique index if not exists st_pay_requests_one_active
  on public.st_pay_requests (session_id) where status in ('draft','pending');
create index if not exists st_pay_requests_shop_idx on public.st_pay_requests (shop_id, status);
alter table public.st_pay_requests enable row level security;
drop policy if exists st_pay_requests_select_member on public.st_pay_requests;
create policy st_pay_requests_select_member on public.st_pay_requests
  for select to authenticated using (public.st_has_shop_role(shop_id));
revoke all on public.st_pay_requests from anon, authenticated;
grant select on public.st_pay_requests to authenticated;

-- การเรียกแบบใหม่ 'slip' = ลูกค้าแนบสลิป รอพนักงานตรวจ (เข้าจอเดิมทุกจอผ่าน Realtime)
alter table public.st_service_calls drop constraint if exists st_service_calls_kind_check;
alter table public.st_service_calls add constraint st_service_calls_kind_check check (kind in ('call','bill','slip'));

-- ---------- 4) ถังสลิป: ลูกค้าอัปโหลดได้เฉพาะไฟล์ของคำขอตัวเอง ----------
-- path: shops/<shop_id>/guest/<request_id>.jpg · คำขอต้องเป็น draft อายุไม่เกิน 30 นาที และโต๊ะยังเปิด
create or replace function public.st_guest_slip_ok(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_req uuid;
begin
  if p_name !~ '^shops/[0-9a-f-]{36}/guest/[0-9a-f-]{36}\.jpg$' then return false; end if;
  v_req := substring(p_name from '/guest/([0-9a-f-]{36})\.jpg$')::uuid;
  return exists (
    select 1 from public.st_pay_requests r
      join public.st_table_sessions s on s.id = r.session_id
     where r.id = v_req and r.status = 'draft'
       and p_name = 'shops/' || r.shop_id::text || '/guest/' || r.id::text || '.jpg'
       and r.created_at > now() - interval '30 minutes'
       and s.status <> 'closed');
exception when others then
  return false;
end
$$;

drop policy if exists st_slips_insert_guest on storage.objects;
create policy st_slips_insert_guest on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'st-slips' and public.st_guest_slip_ok(name));

drop policy if exists st_slips_select_guest on storage.objects;
create policy st_slips_select_guest on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'st-slips' and public.st_guest_slip_ok(name));

-- ---------- 5) ตัวช่วยภายใน: เงินของรอบ / คิดบิลของส่วนที่จ่าย ----------
-- คิดบิลจากค่าอาหารส่วนหนึ่ง (ส่วนลดหักก่อน แล้วค่อยคิดค่าบริการ และ VAT — กติกาเดียวกับ st_bill_calc)
create or replace function public.st_bill_part(p_shop uuid, p_sub numeric, p_discount numeric default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sh     public.st_shops;
  v_sub  numeric := round(greatest(coalesce(p_sub, 0), 0), 2);
  v_disc numeric;
  v_base numeric;
  v_svc  numeric;
  v_vat  numeric;
  v_tot  numeric;
begin
  select * into sh from public.st_shops where id = p_shop;
  v_disc := least(greatest(round(coalesce(p_discount, 0), 2), 0), v_sub);
  v_base := v_sub - v_disc;
  v_svc  := round(v_base * sh.service_pct / 100, 2);
  if sh.vat_included then
    v_vat := round((v_base + v_svc) * sh.vat_pct / (100 + sh.vat_pct), 2);
    v_tot := v_base + v_svc;
  else
    v_vat := round((v_base + v_svc) * sh.vat_pct / 100, 2);
    v_tot := v_base + v_svc + v_vat;
  end if;
  return jsonb_build_object('subtotal', v_sub, 'discount', v_disc, 'service', v_svc, 'service_pct', sh.service_pct,
                            'vat', v_vat, 'vat_pct', sh.vat_pct, 'vat_included', sh.vat_included, 'total', v_tot);
end
$$;

-- ยอดของรอบ: ค่าอาหารทั้งหมด / จ่ายแล้ว (ค่าอาหาร) / เหลือ
create or replace function public.st_session_money(p_session uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (select coalesce(sum(subtotal), 0) as sub from public.st_orders
              where session_id = p_session and status <> 'cancelled'),
       p as (select coalesce(sum(subtotal), 0) as sub, coalesce(sum(total), 0) as tot, count(*) as n,
                    bool_or(portion = 'amount') as by_amount
               from public.st_payments where session_id = p_session and status = 'paid')
  select jsonb_build_object('subtotal', s.sub, 'paid_sub', p.sub, 'paid_total', p.tot, 'parts', p.n,
                            'by_amount', coalesce(p.by_amount, false),
                            'remaining', greatest(s.sub - p.sub, 0))
    from s, p;
$$;

-- รายการของรอบ + จำนวน/ยอดที่จ่ายไปแล้ว
create or replace function public.st_session_lines(p_session uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'order_no', o.order_no, 'name', i.name, 'qty', i.qty, 'unit_price', i.unit_price,
           'options', (select string_agg(e ->> 'name', ' · ') from jsonb_array_elements(i.options) e),
           'line_total', i.line_total,
           'paid_qty', coalesce(pi.qty, 0), 'paid_amount', coalesce(pi.amount, 0))
         order by o.created_at, i.id), '[]'::jsonb)
    from public.st_order_items i
    join public.st_orders o on o.id = i.order_id and o.status <> 'cancelled'
    left join lateral (select sum(x.qty) as qty, sum(x.amount) as amount
                         from public.st_payment_items x
                         join public.st_payments p on p.id = x.payment_id and p.status = 'paid'
                        where x.order_item_id = i.id) pi on true
   where o.session_id = p_session;
$$;

-- แปลงคำขอจ่าย -> ค่าอาหารของส่วนนี้ + รายการ
-- p_part: null / {} = ที่เหลือทั้งหมด · {"amount": 250} = ตามยอด · {"items":[{"id":<order_item_id>,"qty":1}]} = เลือกรายการ
create or replace function public.st_part_resolve(p_session uuid, p_part jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m       jsonb := public.st_session_money(p_session);
  v_rem   numeric := (m ->> 'remaining')::numeric;
  v_amt   numeric;
  v_sub   numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_lines jsonb := public.st_session_lines(p_session);
  l       jsonb;
  x       jsonb;
  v_q     int;
  v_a     numeric;
begin
  if p_part is not null and jsonb_typeof(p_part) <> 'object' then raise exception 'st_bad_request'; end if;

  if p_part ? 'amount' then
    v_amt := round((p_part ->> 'amount')::numeric, 2);
    if v_amt is null or v_amt <= 0 then raise exception 'st_bad_amount'; end if;
    if v_amt > v_rem then raise exception 'st_over_remaining' using detail = v_rem::text; end if;
    return jsonb_build_object('kind', case when v_amt = v_rem then 'full' else 'amount' end,
                              'subtotal', v_amt, 'items', '[]'::jsonb, 'remaining', v_rem);
  end if;

  if p_part ? 'items' then
    if (m ->> 'by_amount')::boolean then raise exception 'st_split_mixed'; end if;
    if jsonb_typeof(p_part -> 'items') <> 'array' or jsonb_array_length(p_part -> 'items') = 0
       or jsonb_array_length(p_part -> 'items') > 200 then
      raise exception 'st_bad_request';
    end if;
    for x in select * from jsonb_array_elements(p_part -> 'items') loop
      l := null;
      select e into l from jsonb_array_elements(v_lines) e where e ->> 'id' = x ->> 'id';
      if l is null then raise exception 'st_item_gone'; end if;
      v_q := coalesce((x ->> 'qty')::int, 0);
      if v_q < 1 or v_q > (l ->> 'qty')::int - (l ->> 'paid_qty')::int then raise exception 'st_item_paid'; end if;
      if exists (select 1 from jsonb_array_elements(v_items) y where y ->> 'order_item_id' = l ->> 'id') then
        raise exception 'st_bad_request';
      end if;
      -- จ่ายจำนวนที่เหลือทั้งหมด = ยอดที่เหลือพอดี (ไม่มีเศษสตางค์ตกหล่น)
      v_a := case when v_q = (l ->> 'qty')::int - (l ->> 'paid_qty')::int
                  then (l ->> 'line_total')::numeric - (l ->> 'paid_amount')::numeric
                  else round((l ->> 'line_total')::numeric * v_q / (l ->> 'qty')::int, 2) end;
      v_items := v_items || jsonb_build_object('order_item_id', l ->> 'id', 'qty', v_q, 'amount', v_a);
      v_sub := v_sub + v_a;
    end loop;
    if v_sub > v_rem then v_sub := v_rem; end if;
    return jsonb_build_object('kind', case when v_sub = v_rem then 'full' else 'items' end,
                              'subtotal', v_sub, 'items', v_items, 'remaining', v_rem);
  end if;

  -- ที่เหลือทั้งหมด: ถ้าไม่เคยแยกตามยอด ให้บันทึกรายการที่ยังไม่จ่ายไว้ในใบด้วย
  if not (m ->> 'by_amount')::boolean then
    select coalesce(jsonb_agg(jsonb_build_object('order_item_id', z ->> 'id',
                                                 'qty', (z ->> 'qty')::int - (z ->> 'paid_qty')::int,
                                                 'amount', (z ->> 'line_total')::numeric - (z ->> 'paid_amount')::numeric)), '[]'::jsonb)
      into v_items
      from jsonb_array_elements(v_lines) z
     where (z ->> 'qty')::int > (z ->> 'paid_qty')::int;
  end if;
  return jsonb_build_object('kind', 'full', 'subtotal', v_rem, 'items', v_items, 'remaining', v_rem);
end
$$;

-- ---------- 6) กันข้อมูลเพี้ยน: ยกเลิก / ย้ายออร์เดอร์ที่จ่ายเงินไปแล้วบางส่วน ----------
create or replace function public.st_orders_paid_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_paid numeric;
begin
  if not exists (select 1 from public.st_payments where session_id = old.session_id and status = 'paid') then
    return new;
  end if;
  if new.session_id <> old.session_id then
    raise exception 'st_partly_paid';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    if exists (select 1 from public.st_payment_items x
                 join public.st_order_items i on i.id = x.order_item_id
                 join public.st_payments p on p.id = x.payment_id and p.status = 'paid'
                where i.order_id = old.id) then
      raise exception 'st_order_paid';
    end if;
    select coalesce(sum(subtotal), 0) into v_paid from public.st_payments where session_id = old.session_id and status = 'paid';
    if (select coalesce(sum(subtotal), 0) from public.st_orders
         where session_id = old.session_id and status <> 'cancelled' and id <> old.id) < v_paid then
      raise exception 'st_order_paid';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists st_orders_paid_guard on public.st_orders;
create trigger st_orders_paid_guard
  before update of status, session_id on public.st_orders
  for each row execute function public.st_orders_paid_guard();

-- ---------- 7) RPC พนักงาน: หน้าเช็กบิล ----------
create or replace function public.st_bill_preview(p_table uuid, p_part jsonb default null, p_discount numeric default 0)
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
  v_part jsonb;
begin
  select * into v_tab from public.st_tables where id = p_table;
  if v_tab.id is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_tab.shop_id, array['owner','manager','cashier','waiter']) then
    raise exception 'st_forbidden';
  end if;
  select * into v_shop from public.st_shops where id = v_tab.shop_id;
  select * into v_sess from public.st_table_sessions where table_id = p_table and status <> 'closed';
  if v_sess.id is null then return null; end if;
  v_part := public.st_part_resolve(v_sess.id, p_part);
  return jsonb_build_object(
    'session_id', v_sess.id, 'status', v_sess.status, 'guest_count', v_sess.guest_count, 'opened_at', v_sess.opened_at,
    'table_label', v_tab.label, 'shop_name', v_shop.name, 'promptpay_id', v_shop.promptpay_id,
    'tax_invoice', v_shop.tax_id is not null and v_shop.vat_pct > 0,
    'unfinished', (select count(*) from public.st_orders
                    where session_id = v_sess.id and status in ('new','accepted','cooking')),
    'cancelled', (select count(*) from public.st_orders where session_id = v_sess.id and status = 'cancelled'),
    'money', public.st_session_money(v_sess.id),
    'lines', public.st_session_lines(v_sess.id),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'receipt_no', p.receipt_no, 'part_no', p.part_no,
                                                              'method', p.method, 'total', p.total, 'created_at', p.created_at)
                                           order by p.created_at)
                            from public.st_payments p where p.session_id = v_sess.id and p.status = 'paid'), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'slip_path', r.slip_path,
                                                              'submitted_at', r.submitted_at) order by r.submitted_at)
                            from public.st_pay_requests r where r.session_id = v_sess.id and r.status = 'pending'), '[]'::jsonb),
    'part', v_part,
    'bill', public.st_bill_part(v_shop.id, (v_part ->> 'subtotal')::numeric, p_discount));
end
$$;

-- รับเงิน (ส่วนหนึ่ง หรือทั้งหมด) · ครบแล้วปิดโต๊ะอัตโนมัติ
-- p_tenders = [{method, amount, received?, slip_path?}] (1–4 ช่อง · เงินสดได้ 1 ช่อง · ผลรวม = ยอดสุทธิ)
-- p_request = ยืนยันคำขอที่ลูกค้าแนบสลิป (ใช้ยอดที่ลูกค้าโอน ไม่มีส่วนลด ไม่ต้องส่ง p_part / p_tenders)
create or replace function public.st_pay(p_table uuid, p_part jsonb default null, p_discount numeric default 0,
                                         p_tenders jsonb default null, p_note text default null,
                                         p_request uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tab    public.st_tables;
  v_shop   public.st_shops;
  v_sess   public.st_table_sessions;
  v_req    public.st_pay_requests;
  v_part   jsonb;
  v_bill   jsonb;
  v_total  numeric;
  v_tend   jsonb := '[]'::jsonb;
  x        jsonb;
  v_m      text;
  v_a      numeric;
  v_r      numeric;
  v_slip   text;
  v_sum    numeric := 0;
  v_recv   numeric := 0;
  v_change numeric := 0;
  v_cash   int := 0;
  v_no     int;
  v_part_no int;
  v_id     uuid;
  v_left   numeric;
  v_disc   numeric := coalesce(p_discount, 0);
begin
  select * into v_tab from public.st_tables where id = p_table;
  if v_tab.id is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_tab.shop_id, array['owner','manager','cashier','waiter']) then
    raise exception 'st_forbidden';
  end if;
  if v_disc < 0 then raise exception 'st_bad_request'; end if;
  if v_disc > 0 and not public.st_has_shop_role(v_tab.shop_id, array['owner','manager','cashier']) then
    raise exception 'st_discount_forbidden';
  end if;
  if char_length(coalesce(p_note, '')) > 200 then raise exception 'st_bad_request'; end if;
  select * into v_shop from public.st_shops where id = v_tab.shop_id;

  select * into v_sess from public.st_table_sessions where table_id = p_table and status <> 'closed' for update;
  if v_sess.id is null then raise exception 'st_table_not_open'; end if;

  if p_request is not null then
    select * into v_req from public.st_pay_requests where id = p_request and session_id = v_sess.id for update;
    if v_req.id is null then raise exception 'st_not_found'; end if;
    if v_req.status <> 'pending' then raise exception 'st_request_handled'; end if;
    p_part := null; v_disc := 0;
  end if;

  v_part := public.st_part_resolve(v_sess.id, p_part);
  if (v_part ->> 'subtotal')::numeric <= 0 then raise exception 'st_nothing_to_pay'; end if;
  v_bill  := public.st_bill_part(v_shop.id, (v_part ->> 'subtotal')::numeric, v_disc);
  v_total := (v_bill ->> 'total')::numeric;

  if p_request is not null then
    if v_total <> v_req.amount then
      raise exception 'st_bill_changed' using detail = v_total::text;
    end if;
    p_tenders := jsonb_build_array(jsonb_build_object('method', 'promptpay', 'amount', v_total, 'slip_path', v_req.slip_path));
  end if;

  -- ตรวจช่องทางชำระ
  if p_tenders is null or jsonb_typeof(p_tenders) <> 'array'
     or jsonb_array_length(p_tenders) not between 1 and 4 then
    raise exception 'st_bad_request';
  end if;
  for x in select * from jsonb_array_elements(p_tenders) loop
    v_m := x ->> 'method';
    if v_m is null or v_m not in ('cash','promptpay','transfer','card') then raise exception 'st_bad_request'; end if;
    v_a := round((x ->> 'amount')::numeric, 2);
    if v_a is null or v_a < 0 or (v_a = 0 and v_total > 0) then raise exception 'st_bad_amount'; end if;
    v_slip := nullif(trim(coalesce(x ->> 'slip_path', '')), '');
    if v_slip is not null and v_slip not like 'shops/' || v_shop.id::text || '/slips/%'
       and v_slip not like 'shops/' || v_shop.id::text || '/guest/%' then
      raise exception 'st_bad_image';
    end if;
    if v_m = 'cash' then
      v_cash := v_cash + 1;
      v_r := round(coalesce((x ->> 'received')::numeric, v_a), 2);
      if v_r < v_a then raise exception 'st_cash_not_enough'; end if;
      if v_r > v_a + 100000 then raise exception 'st_bad_request'; end if;
      v_change := v_r - v_a;
      v_slip := null;
    else
      v_r := v_a;
    end if;
    v_sum  := v_sum + v_a;
    v_recv := v_recv + v_r;
    v_tend := v_tend || jsonb_build_object('method', v_m, 'amount', v_a, 'received', v_r,
                                           'change', case when v_m = 'cash' then v_r - v_a else 0 end,
                                           'slip_path', v_slip);
  end loop;
  if v_cash > 1 then raise exception 'st_bad_request'; end if;
  if v_sum <> v_total then raise exception 'st_tender_mismatch' using detail = v_total::text; end if;

  perform pg_advisory_xact_lock(hashtext('st_receipt_no:' || v_shop.id::text));
  select coalesce(max(receipt_no), 0) + 1 into v_no
    from public.st_payments
   where shop_id = v_shop.id
     and created_at >= (date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok');
  select count(*) + 1 into v_part_no from public.st_payments where session_id = v_sess.id;

  insert into public.st_payments (shop_id, session_id, table_id, receipt_no, method,
                                  subtotal, discount, service, service_pct, vat, vat_pct, vat_included, total,
                                  received, change_amount, slip_path, note, received_by_user_id,
                                  portion, part_no, tenders, tax, request_id)
  values (v_shop.id, v_sess.id, p_table, v_no,
          case when jsonb_array_length(v_tend) = 1 then v_tend -> 0 ->> 'method' else 'mixed' end,
          (v_bill ->> 'subtotal')::numeric, (v_bill ->> 'discount')::numeric,
          (v_bill ->> 'service')::numeric, (v_bill ->> 'service_pct')::numeric,
          (v_bill ->> 'vat')::numeric, (v_bill ->> 'vat_pct')::numeric, (v_bill ->> 'vat_included')::boolean,
          v_total, v_recv, v_change,
          (select t ->> 'slip_path' from jsonb_array_elements(v_tend) t where t ->> 'slip_path' is not null limit 1),
          nullif(trim(coalesce(p_note, '')), ''), auth.uid(),
          v_part ->> 'kind', v_part_no, v_tend,
          case when v_shop.tax_id is not null and v_shop.vat_pct > 0 then
            jsonb_build_object('tax_id', v_shop.tax_id, 'name', coalesce(v_shop.tax_name, v_shop.name),
                               'branch', v_shop.tax_branch, 'pos_id', v_shop.pos_id,
                               'address', v_shop.address) end,
          v_req.id)
  returning id into v_id;

  insert into public.st_payment_items (payment_id, shop_id, order_item_id, qty, amount)
  select v_id, v_shop.id, (e ->> 'order_item_id')::uuid, (e ->> 'qty')::int, (e ->> 'amount')::numeric
    from jsonb_array_elements(v_part -> 'items') e
   where (e ->> 'qty')::int > 0;

  if v_req.id is not null then
    update public.st_pay_requests
       set status = 'confirmed', payment_id = v_id, handled_at = now(), handled_by_user_id = auth.uid()
     where id = v_req.id;
  end if;

  v_left := (v_part ->> 'remaining')::numeric - (v_part ->> 'subtotal')::numeric;
  if v_left <= 0 then
    update public.st_table_sessions
       set status = 'closed', closed_at = now(), closed_by_user_id = auth.uid()
     where id = v_sess.id;
    update public.st_service_calls
       set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
     where session_id = v_sess.id and status = 'pending';
    update public.st_pay_requests set status = 'cancelled', handled_at = now()
     where session_id = v_sess.id and status in ('draft','pending');
  else
    update public.st_table_sessions set last_activity_at = now() where id = v_sess.id;
    update public.st_service_calls
       set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
     where session_id = v_sess.id and status = 'pending' and kind = 'slip';
  end if;

  return jsonb_build_object('payment_id', v_id, 'receipt_no', v_no, 'part_no', v_part_no, 'total', v_total,
                            'received', v_recv, 'change', v_change,
                            'remaining', greatest(v_left, 0), 'closed', v_left <= 0);
end
$$;

-- ปฏิเสธสลิปของลูกค้า (เจ้าของ / ผู้จัดการ / แคชเชียร์ / พนักงานเสิร์ฟ)
create or replace function public.st_reject_pay_request(p_request uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.st_pay_requests;
begin
  select * into r from public.st_pay_requests where id = p_request for update;
  if r.id is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(r.shop_id, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  if r.status <> 'pending' then raise exception 'st_request_handled'; end if;
  if char_length(coalesce(trim(p_reason), '')) not between 1 and 200 then raise exception 'st_void_reason'; end if;
  update public.st_pay_requests
     set status = 'rejected', reject_reason = trim(p_reason), handled_at = now(), handled_by_user_id = auth.uid()
   where id = r.id;
  update public.st_table_sessions set status = 'open', last_activity_at = now()
   where id = r.session_id and status = 'billing' and r.prev_status = 'open';
  update public.st_service_calls
     set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
   where session_id = r.session_id and status = 'pending' and kind = 'slip';
end
$$;

-- เดิม (st-07): รับเงินทั้งบิลช่องทางเดียว — ทำงานผ่าน st_pay แล้ว
create or replace function public.st_record_payment(p_table uuid, p_method text, p_discount numeric default 0,
                                                    p_received numeric default null, p_slip_path text default null,
                                                    p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess uuid;
  v_shop uuid;
  v_bill jsonb;
  v_tot  numeric;
begin
  select shop_id into v_shop from public.st_tables where id = p_table;
  if v_shop is null then raise exception 'st_not_found'; end if;
  select id into v_sess from public.st_table_sessions where table_id = p_table and status <> 'closed';
  if v_sess is null then raise exception 'st_table_not_open'; end if;
  if exists (select 1 from public.st_payments where session_id = v_sess and status = 'paid') then
    raise exception 'st_already_paid';
  end if;
  v_bill := public.st_bill_part(v_shop, (public.st_session_money(v_sess) ->> 'remaining')::numeric, p_discount);
  v_tot  := (v_bill ->> 'total')::numeric;
  return public.st_pay(p_table, null, p_discount,
                       jsonb_build_array(jsonb_build_object('method', p_method, 'amount', v_tot,
                                                            'received', p_received, 'slip_path', p_slip_path)),
                       p_note, null);
end
$$;

-- ---------- 8) คูปอง: คิดจากค่าอาหารของส่วนที่กำลังจ่าย ----------
drop function if exists public.st_coupon_quote(uuid, text);
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

-- ---------- 9) ใบเสร็จ / ใบกำกับภาษีอย่างย่อ ----------
create or replace function public.st_receipt(p_payment uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.st_payments;
  v_items jsonb;
  v_share boolean := false;
begin
  select * into p from public.st_payments where id = p_payment;
  if p.id is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(p.shop_id) then raise exception 'st_forbidden'; end if;

  if exists (select 1 from public.st_payment_items where payment_id = p.id) then
    select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'options', x.opts, 'qty', x.qty,
                                                 'unit_price', x.unit_price, 'line_total', x.amt) order by x.first_at), '[]'::jsonb)
      into v_items
      from (select i.name, i.unit_price,
                   (select string_agg(e ->> 'name', ' · ') from jsonb_array_elements(i.options) e) as opts,
                   sum(pi.qty) as qty, sum(pi.amount) as amt, min(o.created_at) as first_at
              from public.st_payment_items pi
              join public.st_order_items i on i.id = pi.order_item_id
              join public.st_orders o on o.id = i.order_id
             where pi.payment_id = p.id
             group by i.name, i.unit_price, 3) x;
  else
    v_share := p.portion = 'amount' or exists (select 1 from public.st_payments q
                                                 where q.session_id = p.session_id and q.id <> p.id and q.portion = 'amount');
    select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'options', x.opts, 'qty', x.qty,
                                                 'unit_price', x.unit_price, 'line_total', x.line_total) order by x.first_at), '[]'::jsonb)
      into v_items
      from (select i.name, i.unit_price,
                   (select string_agg(e ->> 'name', ' · ') from jsonb_array_elements(i.options) e) as opts,
                   sum(i.qty) as qty, sum(i.line_total) as line_total, min(o.created_at) as first_at
              from public.st_order_items i
              join public.st_orders o on o.id = i.order_id
             where o.session_id = p.session_id and o.status <> 'cancelled'
             group by i.name, i.unit_price, 3) x;
  end if;

  return jsonb_build_object(
    'id', p.id, 'receipt_no', p.receipt_no, 'status', p.status, 'method', p.method, 'created_at', p.created_at,
    'subtotal', p.subtotal, 'discount', p.discount, 'service', p.service, 'service_pct', p.service_pct,
    'vat', p.vat, 'vat_pct', p.vat_pct, 'vat_included', p.vat_included, 'total', p.total,
    'received', p.received, 'change', p.change_amount, 'note', p.note,
    'tenders', p.tenders, 'tax', p.tax, 'portion', p.portion, 'part_no', p.part_no,
    'self_pay', p.request_id is not null,
    'share', v_share,
    'session_subtotal', (select coalesce(sum(subtotal), 0) from public.st_orders where session_id = p.session_id and status <> 'cancelled'),
    'parts', (select count(*) from public.st_payments where session_id = p.session_id and status = 'paid'),
    'session_open', (select status <> 'closed' from public.st_table_sessions where id = p.session_id),
    'remaining', case when (select status <> 'closed' from public.st_table_sessions where id = p.session_id)
                      then (public.st_session_money(p.session_id) ->> 'remaining')::numeric else 0 end,
    'table_id', p.table_id,
    'has_slip', p.slip_path is not null, 'slip_path', p.slip_path,
    'slips', coalesce((select jsonb_agg(t ->> 'slip_path') from jsonb_array_elements(p.tenders) t
                        where t ->> 'slip_path' is not null), '[]'::jsonb),
    'void_reason', p.void_reason,
    'shop', (select jsonb_build_object('id', s.id, 'name', s.name, 'address', s.address, 'phone', s.phone)
               from public.st_shops s where s.id = p.shop_id),
    'table_label', (select label from public.st_tables where id = p.table_id),
    'opened_at', (select opened_at from public.st_table_sessions where id = p.session_id),
    'guest_count', (select guest_count from public.st_table_sessions where id = p.session_id),
    'cashier', (select coalesce(pr.display_name, split_part(pr.email, '@', 1))
                  from public.st_profiles pr where pr.user_id = p.received_by_user_id),
    'items', v_items);
end
$$;

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
                                        'table_label', t.label, 'part_no', p.part_no, 'portion', p.portion,
                                        'tax', p.tax is not null, 'self_pay', p.request_id is not null)
                     order by p.created_at desc)
      from (select * from public.st_payments where shop_id = p_shop
             order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) p
      join public.st_tables t on t.id = p.table_id), '[]'::jsonb);
end
$$;

-- ---------- 10) RPC ลูกค้า: จ่ายเองด้วยพร้อมเพย์ ----------
-- ข้อมูลเงินที่ลูกค้าเห็น (ใช้ภายใน)
create or replace function public.st_guest_pay_json(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s  public.st_table_sessions;
  sh public.st_shops;
  m  jsonb;
  r  public.st_pay_requests;
begin
  select * into s from public.st_table_sessions where id = p_session;
  select * into sh from public.st_shops where id = s.shop_id;
  m := public.st_session_money(p_session);
  select * into r from public.st_pay_requests where session_id = p_session order by created_at desc limit 1;
  return jsonb_build_object(
    'self_pay', sh.self_pay and sh.promptpay_id is not null,
    'paid_total', (m ->> 'paid_total')::numeric,
    'parts', (m ->> 'parts')::int,
    'remaining', public.st_bill_part(sh.id, (m ->> 'remaining')::numeric, 0),
    'request', case when r.id is null then null else jsonb_build_object(
                 'id', r.id, 'status', r.status, 'amount', r.amount, 'reject_reason', r.reject_reason,
                 'receipt_no', (select receipt_no from public.st_payments where id = r.payment_id)) end);
end
$$;

-- ทับ st-05: เพิ่มข้อมูลจ่ายแล้ว / คงเหลือ / คำขอจ่ายเอง
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
    'pay',    public.st_guest_pay_json(v_sess.id),
    'pending_calls', coalesce((select jsonb_agg(kind) from public.st_service_calls
                                where session_id = v_sess.id and status = 'pending'), '[]'::jsonb));
end
$$;

-- เริ่มจ่าย: สร้าง/ใช้คำขอ draft เดิม · คืนยอด + เลขพร้อมเพย์ + path สำหรับอัปโหลดสลิป
create or replace function public.st_guest_pay_start(p_qr text, p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess public.st_table_sessions;
  sh     public.st_shops;
  r      public.st_pay_requests;
  v_amt  numeric;
begin
  v_sess := public.st_guest_session(p_qr, p_session_token);
  select * into sh from public.st_shops where id = v_sess.shop_id;
  if not sh.self_pay or sh.promptpay_id is null then raise exception 'st_selfpay_off'; end if;
  if not sh.is_open then raise exception 'st_shop_closed'; end if;
  select * into r from public.st_pay_requests
   where session_id = v_sess.id and status in ('draft','pending') for update;
  if r.status = 'pending' then raise exception 'st_request_pending'; end if;

  v_amt := (public.st_bill_part(sh.id, (public.st_session_money(v_sess.id) ->> 'remaining')::numeric, 0) ->> 'total')::numeric;
  if v_amt <= 0 then raise exception 'st_nothing_to_pay'; end if;

  if r.id is null then
    insert into public.st_pay_requests (shop_id, session_id, table_id, amount, prev_status)
    values (v_sess.shop_id, v_sess.id, v_sess.table_id, v_amt, v_sess.status)
    returning * into r;
  else
    update public.st_pay_requests set amount = v_amt, created_at = now() where id = r.id returning * into r;
  end if;
  -- ระหว่างจ่าย สั่งเพิ่มไม่ได้ (ยอดจะได้ไม่เปลี่ยน) · ยกเลิกแล้วกลับมาสั่งต่อได้
  update public.st_table_sessions set status = 'billing', last_activity_at = now() where id = v_sess.id;

  return jsonb_build_object('request_id', r.id, 'amount', v_amt, 'promptpay_id', sh.promptpay_id,
                            'shop_name', sh.name,
                            'upload_path', 'shops/' || sh.id::text || '/guest/' || r.id::text || '.jpg');
end
$$;

-- ส่งสลิป (อัปโหลดไฟล์แล้ว) -> รอพนักงานตรวจ
create or replace function public.st_guest_pay_submit(p_qr text, p_session_token text, p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess public.st_table_sessions;
  r      public.st_pay_requests;
  v_path text;
begin
  v_sess := public.st_guest_session(p_qr, p_session_token);
  select * into r from public.st_pay_requests where id = p_request and session_id = v_sess.id for update;
  if r.id is null then raise exception 'st_not_found'; end if;
  if r.status <> 'draft' then raise exception 'st_request_handled'; end if;
  v_path := 'shops/' || r.shop_id::text || '/guest/' || r.id::text || '.jpg';
  if not exists (select 1 from storage.objects where bucket_id = 'st-slips' and name = v_path) then
    raise exception 'st_slip_missing';
  end if;
  update public.st_pay_requests set status = 'pending', slip_path = v_path, submitted_at = now() where id = r.id;
  insert into public.st_service_calls (shop_id, table_id, session_id, kind)
  values (v_sess.shop_id, v_sess.table_id, v_sess.id, 'slip')
  on conflict (session_id, kind) where status = 'pending' do nothing;
  update public.st_table_sessions set last_activity_at = now() where id = v_sess.id;
end
$$;

-- ลูกค้ายกเลิก (ก่อนพนักงานยืนยัน)
create or replace function public.st_guest_pay_cancel(p_qr text, p_session_token text, p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sess public.st_table_sessions;
  r      public.st_pay_requests;
begin
  v_sess := public.st_guest_session(p_qr, p_session_token);
  select * into r from public.st_pay_requests where id = p_request and session_id = v_sess.id for update;
  if r.id is null then raise exception 'st_not_found'; end if;
  if r.status not in ('draft','pending') then raise exception 'st_request_handled'; end if;
  update public.st_pay_requests set status = 'cancelled', handled_at = now() where id = r.id;
  update public.st_table_sessions set status = 'open', last_activity_at = now()
   where id = v_sess.id and status = 'billing' and r.prev_status = 'open';
  update public.st_service_calls set status = 'done', handled_at = now()
   where session_id = v_sess.id and status = 'pending' and kind = 'slip';
end
$$;

-- สถานะคำขอ (ใช้ได้แม้โต๊ะปิดแล้ว ภายใน 3 ชั่วโมง — ลูกค้าจะเห็นว่า "ชำระแล้ว")
create or replace function public.st_guest_pay_status(p_qr text, p_session_token text, p_request uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare r public.st_pay_requests;
begin
  select pr.* into r
    from public.st_pay_requests pr
    join public.st_table_sessions s on s.id = pr.session_id
    join public.st_tables t on t.id = pr.table_id
   where pr.id = p_request and s.session_token = p_session_token and t.qr_token = p_qr
     and (s.status <> 'closed' or s.closed_at > now() - interval '3 hours');
  if r.id is null then raise exception 'st_session_invalid'; end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'amount', r.amount, 'reject_reason', r.reject_reason,
                            'receipt_no', (select receipt_no from public.st_payments where id = r.payment_id));
end
$$;

-- ---------- 11) รายงาน: แยกช่องทางตาม tenders · นับรายการครั้งเดียวต่อรอบ · เงินรั่วนับยอดที่ยังไม่จ่าย ----------
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
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
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

-- ปิดโต๊ะทั้งที่ยังจ่ายไม่ครบ -> บันทึกประวัติด้วยยอดที่ยังไม่จ่าย (ทับ st-09)
create or replace function public.st_audit_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_amt numeric;
begin
  v_amt := (select coalesce(sum(subtotal), 0) from public.st_orders where session_id = new.id and status <> 'cancelled')
         - (select coalesce(sum(subtotal), 0) from public.st_payments where session_id = new.id and status = 'paid');
  if v_amt > 0 then
    perform public.st_audit(new.shop_id, case when auth.uid() is null then 'auto_close_unpaid' else 'close_unpaid' end,
      (select label from public.st_tables where id = new.table_id), v_amt,
      jsonb_build_object('opened_at', new.opened_at, 'guests', new.guest_count,
                         'paid_parts', (select count(*) from public.st_payments where session_id = new.id and status = 'paid')));
  end if;
  return new;
end
$$;

-- ---------- 12) สิทธิ์เรียกฟังก์ชัน ----------
revoke all on function
  public.st_guest_slip_ok(text), public.st_bill_part(uuid, numeric, numeric), public.st_session_money(uuid),
  public.st_session_lines(uuid), public.st_part_resolve(uuid, jsonb), public.st_orders_paid_guard(),
  public.st_bill_preview(uuid, jsonb, numeric), public.st_pay(uuid, jsonb, numeric, jsonb, text, uuid),
  public.st_reject_pay_request(uuid, text), public.st_coupon_quote(uuid, text, jsonb),
  public.st_guest_pay_json(uuid), public.st_guest_pay_start(text, text), public.st_guest_pay_submit(text, text, uuid),
  public.st_guest_pay_cancel(text, text, uuid), public.st_guest_pay_status(text, text, uuid)
from public, anon, authenticated;

grant execute on function
  public.st_bill_preview(uuid, jsonb, numeric), public.st_pay(uuid, jsonb, numeric, jsonb, text, uuid),
  public.st_reject_pay_request(uuid, text), public.st_coupon_quote(uuid, text, jsonb)
to authenticated;
grant execute on function
  public.st_guest_slip_ok(text),                     -- ใช้ใน policy ของถังสลิป
  public.st_guest_pay_start(text, text), public.st_guest_pay_submit(text, text, uuid),
  public.st_guest_pay_cancel(text, text, uuid), public.st_guest_pay_status(text, text, uuid)
to anon, authenticated;
-- st_record_payment / st_receipt / st_recent_payments / st_guest_orders / st_sales_report ใช้สิทธิ์เดิม

-- ---------- 13) Realtime: จอพนักงานรู้ทันทีเมื่อลูกค้าแนบสลิป (ผ่าน st_service_calls เดิม) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'st_pay_requests') then
    alter publication supabase_realtime add table public.st_pay_requests;
  end if;
end
$$;

-- ---------- 14) บันทึกว่ารันไฟล์นี้แล้ว ----------
insert into public.st_schema_log (id) values ('st-11-pay')
on conflict (id) do update set applied_at = now();
