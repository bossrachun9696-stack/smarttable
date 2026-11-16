-- =====================================================================
-- SmartTable · st-08-reports.sql  (รันซ้ำได้ · ต้องรัน st-01 ถึง st-07 ก่อน)
-- รายงานยอดขาย (เจ้าของ / ผู้จัดการ)
--
-- * นับยอดจากใบเสร็จที่ 'paid' เท่านั้น (ใบที่ยกเลิกแยกแสดง)
-- * ช่วงวันที่เป็นเวลาไทย (Asia/Bangkok) · ดูได้สูงสุด 366 วันต่อครั้ง
-- * แจ้ง "โต๊ะที่ปิดโดยไม่เก็บเงิน" (มีออร์เดอร์แต่ไม่มีใบเสร็จ) ไว้ตรวจเงินรั่ว
-- =====================================================================

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
    items as (
      select i.name, i.item_id, i.qty, i.line_total
        from paid
        join public.st_orders o on o.session_id = paid.session_id and o.status <> 'cancelled'
        join public.st_order_items i on i.order_id = o.id
    ),
    leaks as (                                        -- ปิดโต๊ะโดยไม่เก็บเงิน
      select s.id, s.closed_at, t.label,
             (select coalesce(sum(o.subtotal), 0) from public.st_orders o
               where o.session_id = s.id and o.status <> 'cancelled') as amount
        from public.st_table_sessions s
        join public.st_tables t on t.id = s.table_id
       where s.shop_id = p_shop and s.status = 'closed'
         and s.closed_at >= v_start and s.closed_at < v_end
         and not exists (select 1 from public.st_payments p where p.session_id = s.id and p.status = 'paid')
         and exists (select 1 from public.st_orders o where o.session_id = s.id and o.status <> 'cancelled')
    )
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
                   'guests', coalesce((select sum(s.guest_count) from public.st_table_sessions s
                                        where s.id in (select session_id from paid)), 0))
                 from paid),
      'voided', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(total), 0))
                   from pay where status = 'void'),
      'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'bills', n, 'total', t) order by t desc)
                               from (select method, count(*) n, sum(total) t from paid group by method) m), '[]'::jsonb),
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
                                     'discount', p.discount, 'service', p.service, 'vat', p.vat, 'total', p.total)
                                   order by p.created_at)
                              from (select * from pay order by created_at limit 5000) p
                              join public.st_tables t on t.id = p.table_id), '[]'::jsonb)
    ));
end
$$;

revoke all on function public.st_sales_report(uuid, date, date) from public, anon, authenticated;
grant execute on function public.st_sales_report(uuid, date, date) to authenticated;

insert into public.st_schema_log (id) values ('st-08-reports')
on conflict (id) do update set applied_at = now();
