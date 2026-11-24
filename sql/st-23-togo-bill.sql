-- =====================================================================
-- SmartTable · st-23-togo-bill.sql (รอบ O)
-- แยกให้เห็นว่ารายการไหน "ห่อกลับบ้าน" ในหน้าลูกค้า (ที่สั่งแล้ว) และหน้าเช็กบิล
-- + ลูกค้าขอเช็กบิลแบบ "รวมบิลเดียว" หรือ "แยกบิลห่อกลับบ้าน" (พนักงานเห็นในรายการเรียก)
-- รันซ้ำได้ · ต้องรัน st-01 … st-22 ก่อน
-- ทับ: st_orders_json (+ to_go), st_session_lines (+ to_go)
-- =====================================================================

-- รายการออร์เดอร์ของรอบ (หน้าลูกค้า "ที่สั่งแล้ว" / หน้าพนักงาน) + to_go
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
           'to_go', o.to_go, 'is_charge', o.is_charge,
           'items', coalesce((
             select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'unit_price', i.unit_price,
                                                 'options', i.options, 'note', i.note, 'line_total', i.line_total,
                                                 'done', i.done_at is not null)
                              order by i.id)
               from public.st_order_items i where i.order_id = o.id), '[]'::jsonb))
         order by o.created_at), '[]'::jsonb)
    from public.st_orders o where o.session_id = p_session;
$$;

-- รายการในบิล (หน้าเช็กบิล · แยกบิลตามรายการ) + to_go
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
           'line_total', i.line_total, 'to_go', o.to_go,
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

-- ลูกค้าขอเช็กบิล + บอกว่าจะรวมบิลหรือแยกบิลห่อกลับบ้าน (anon)
-- p_split: 'one' = รวมบิลเดียว · 'togo' = แยกบิลห่อกลับบ้าน
create or replace function public.st_guest_bill_request(p_qr text, p_session_token text, p_split text default 'one')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_sess public.st_table_sessions;
begin
  if coalesce(p_split, 'one') not in ('one','togo') then raise exception 'st_bad_request'; end if;
  perform public.st_guest_call(p_qr, p_session_token, 'bill');
  v_sess := public.st_guest_session(p_qr, p_session_token);
  update public.st_service_calls
     set detail = case when p_split = 'togo' then 'แยกบิล: ทานที่ร้าน / ห่อกลับบ้าน' else 'รวมบิลเดียว' end
   where session_id = v_sess.id and kind = 'bill' and status = 'pending';
end
$$;

revoke all on function public.st_guest_bill_request(text, text, text) from public, anon, authenticated;
grant execute on function public.st_guest_bill_request(text, text, text) to anon, authenticated;

insert into public.st_schema_log (id) values ('st-23-togo-bill')
on conflict (id) do update set applied_at = now();
