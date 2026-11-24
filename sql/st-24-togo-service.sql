-- =====================================================================
-- SmartTable · st-24-togo-service.sql (รอบ P)
-- ห่อกลับบ้านไม่คิดค่าบริการ (service %) — ร้านเลือกให้คิดได้ (tool_cfg.togo_service = true)
-- VAT ยังคิดตามปกติ (ภาษีต้องคิดทุกการขาย)
-- รันซ้ำได้ · ต้องรัน st-01 … st-23 ก่อน
-- ทับ: st_bill_json, st_bill_calc, st_bill_preview, st_pay (จาก st-22), st_guest_pay_json, st_guest_pay_start
-- =====================================================================

-- คิดบิลแบบมียอดที่ยกเว้นค่าบริการ (p_exempt = ค่าอาหารส่วนห่อกลับบ้าน ก่อนหักส่วนลด)
create or replace function public.st_bill_part_x(p_shop uuid, p_sub numeric, p_discount numeric, p_exempt numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sh     public.st_shops;
  v_sub  numeric := round(greatest(coalesce(p_sub, 0), 0), 2);
  v_ex   numeric;
  v_disc numeric;
  v_base numeric;
  v_sbase numeric;
  v_svc  numeric;
  v_vat  numeric;
  v_tot  numeric;
begin
  select * into sh from public.st_shops where id = p_shop;
  v_ex   := least(greatest(round(coalesce(p_exempt, 0), 2), 0), v_sub);
  v_disc := least(greatest(round(coalesce(p_discount, 0), 2), 0), v_sub);
  v_base := v_sub - v_disc;
  -- ส่วนลดเฉลี่ยตามสัดส่วน · ค่าบริการคิดเฉพาะส่วนทานที่ร้าน
  v_sbase := case when v_sub = 0 then 0 else round(v_base * (v_sub - v_ex) / v_sub, 2) end;
  v_svc  := round(v_sbase * sh.service_pct / 100, 2);
  if sh.vat_included then
    v_vat := round((v_base + v_svc) * sh.vat_pct / (100 + sh.vat_pct), 2);
    v_tot := v_base + v_svc;
  else
    v_vat := round((v_base + v_svc) * sh.vat_pct / 100, 2);
    v_tot := v_base + v_svc + v_vat;
  end if;
  return jsonb_build_object('subtotal', v_sub, 'discount', v_disc, 'service', v_svc, 'service_pct', sh.service_pct,
                            'service_base', v_sbase, 'togo', v_ex,
                            'vat', v_vat, 'vat_pct', sh.vat_pct, 'vat_included', sh.vat_included, 'total', v_tot);
end
$$;

-- ร้านคิดค่าบริการกับห่อกลับบ้านไหม (ค่าเริ่มต้น: ไม่คิด)
create or replace function public.st_togo_service(p_shop uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (tool_cfg ->> 'togo_service')::boolean from public.st_shops where id = p_shop), false);
$$;

-- ค่าอาหารส่วนห่อกลับบ้านที่อยู่ในใบนี้ (p_part = ผลจาก st_part_resolve)
create or replace function public.st_part_togo(p_session uuid, p_part jsonb)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_all  numeric;
  v_togo numeric;
begin
  if not exists (select 1 from public.st_orders where session_id = p_session and to_go and status <> 'cancelled') then
    return 0;
  end if;
  if jsonb_array_length(coalesce(p_part -> 'items', '[]'::jsonb)) > 0 then
    return coalesce((select sum((x ->> 'amount')::numeric)
                       from jsonb_array_elements(p_part -> 'items') x
                       join public.st_order_items i on i.id = (x ->> 'order_item_id')::uuid
                       join public.st_orders o on o.id = i.order_id
                      where o.to_go), 0);
  end if;
  -- แยกตามยอด: เฉลี่ยตามสัดส่วนห่อกลับบ้านของทั้งโต๊ะ
  select coalesce(sum(subtotal), 0), coalesce(sum(subtotal) filter (where to_go), 0) into v_all, v_togo
    from public.st_orders where session_id = p_session and status <> 'cancelled';
  if v_all <= 0 then return 0; end if;
  return round((p_part ->> 'subtotal')::numeric * v_togo / v_all, 2);
end
$$;

create or replace function public.st_bill_for(p_session uuid, p_part jsonb, p_discount numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_table_sessions where id = p_session;
  return public.st_bill_part_x(v_shop, (p_part ->> 'subtotal')::numeric, p_discount,
                               case when public.st_togo_service(v_shop) then 0 else public.st_part_togo(p_session, p_part) end);
end
$$;

-- ร้านตั้งค่า: คิดค่าบริการกับห่อกลับบ้านไหม
create or replace function public.st_set_togo_service(p_shop uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare out jsonb;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  update public.st_shops set tool_cfg = tool_cfg || jsonb_build_object('togo_service', coalesce(p_on, false))
   where id = p_shop returning tool_cfg into out;
  return out;
end
$$;

-- ทับ st-05: ยอดบิลทั้งโต๊ะ (หน้าลูกค้า / รายละเอียดโต๊ะ)
create or replace function public.st_bill_json(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_shop uuid; v_sub numeric; v_togo numeric;
begin
  select shop_id into v_shop from public.st_table_sessions where id = p_session;
  select coalesce(sum(subtotal), 0), coalesce(sum(subtotal) filter (where to_go), 0) into v_sub, v_togo
    from public.st_orders where session_id = p_session and status <> 'cancelled';
  return public.st_bill_part_x(v_shop, v_sub, 0, case when public.st_togo_service(v_shop) then 0 else v_togo end);
end
$$;

-- ทับ st-07
create or replace function public.st_bill_calc(p_session uuid, p_discount numeric default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_shop uuid; v_sub numeric; v_togo numeric;
begin
  select shop_id into v_shop from public.st_table_sessions where id = p_session;
  select coalesce(sum(subtotal), 0), coalesce(sum(subtotal) filter (where to_go), 0) into v_sub, v_togo
    from public.st_orders where session_id = p_session and status <> 'cancelled';
  return public.st_bill_part_x(v_shop, v_sub, p_discount, case when public.st_togo_service(v_shop) then 0 else v_togo end);
end
$$;

-- ทับ st-11: หน้าเช็กบิล
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
    'bill', public.st_bill_for(v_sess.id, v_part, p_discount));
end
$$;


-- ทับ st-22: รับเงิน
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
  v_bill  := public.st_bill_for(v_sess.id, v_part, v_disc);          -- รอบ P: ห่อกลับบ้านไม่คิดค่าบริการ
  v_total := (v_bill ->> 'total')::numeric;

  if p_request is not null then
    if v_total <> v_req.amount then
      raise exception 'st_bill_changed' using detail = v_total::text;
    end if;
    p_tenders := jsonb_build_array(jsonb_build_object('method', 'promptpay', 'amount', v_total, 'slip_path', v_req.slip_path));
  end if;

  if p_tenders is null or jsonb_typeof(p_tenders) <> 'array'
     or jsonb_array_length(p_tenders) not between 1 and 30 then
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
      v_r := round(coalesce((x ->> 'received')::numeric, v_a), 2);
      if v_r < v_a then raise exception 'st_cash_not_enough'; end if;
      if v_r > v_a + 100000 then raise exception 'st_bad_request'; end if;
      v_change := v_change + (v_r - v_a);
      v_slip := null;
    else
      v_r := v_a;
    end if;
    v_sum  := v_sum + v_a;
    v_recv := v_recv + v_r;
    v_tend := v_tend || jsonb_build_object('method', v_m, 'amount', v_a, 'received', v_r,
                                           'change', case when v_m = 'cash' then v_r - v_a else 0 end,
                                           'slip_path', v_slip,
                                           'who', nullif(left(trim(coalesce(x ->> 'who', '')), 40), ''));
  end loop;
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

-- ทับ st-11: ข้อมูลจ่ายเองของลูกค้า
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
    'remaining', public.st_bill_for(p_session, public.st_part_resolve(p_session, null), 0),
    'request', case when r.id is null then null else jsonb_build_object(
                 'id', r.id, 'status', r.status, 'amount', r.amount, 'reject_reason', r.reject_reason,
                 'receipt_no', (select receipt_no from public.st_payments where id = r.payment_id)) end);
end
$$;


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

  v_amt := (public.st_bill_for(v_sess.id, public.st_part_resolve(v_sess.id, null), 0) ->> 'total')::numeric;
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


-- ---------- สิทธิ์ ----------
revoke all on function public.st_bill_part_x(uuid, numeric, numeric, numeric), public.st_togo_service(uuid),
  public.st_part_togo(uuid, jsonb), public.st_bill_for(uuid, jsonb, numeric), public.st_set_togo_service(uuid, boolean)
from public, anon, authenticated;
grant execute on function public.st_set_togo_service(uuid, boolean) to authenticated;
grant execute on function public.st_bill_preview(uuid, jsonb, numeric), public.st_pay(uuid, jsonb, numeric, jsonb, text, uuid) to authenticated;
grant execute on function public.st_guest_pay_start(text, text) to anon, authenticated;

insert into public.st_schema_log (id) values ('st-24-togo-service')
on conflict (id) do update set applied_at = now();
