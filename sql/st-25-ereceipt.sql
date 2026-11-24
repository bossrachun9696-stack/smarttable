-- =====================================================================
-- SmartTable · st-25-ereceipt.sql (รอบ Q)
-- ใบเสร็จดิจิทัล: ลูกค้าที่สแกน QR สั่งเอง จ่ายแล้วกดดู / บันทึกรูป / PDF ได้ในหน้าโต๊ะ (ลดกระดาษ)
--   · หน้าโต๊ะแสดงปุ่มใบเสร็จในมือถือของลูกค้าที่สั่งรอบนั้นได้ 3 ชม. หลังปิดโต๊ะ (ลูกค้าโต๊ะถัดไปไม่เห็น เพราะใช้รหัสรอบคนละอัน)
--   · ลิงก์ใบเสร็จ (ereceipt.html?k=…) เปิดได้ตามจำนวนวันที่ร้านตั้ง (ค่าเริ่มต้น 90 วัน)
-- รันซ้ำได้ · ต้องรัน st-01 … st-24 ก่อน · ไม่ทับฟังก์ชันเดิม
-- =====================================================================

-- ---------- 1) รหัสลับของใบเสร็จ (สุ่ม 32 ตัว เดาไม่ได้ · ใบเก่าได้รหัสอัตโนมัติตอนเพิ่มคอลัมน์) ----------
alter table public.st_payments
  add column if not exists guest_key text default replace(gen_random_uuid()::text, '-', '');
update public.st_payments set guest_key = replace(gen_random_uuid()::text, '-', '') where guest_key is null;
alter table public.st_payments alter column guest_key set default replace(gen_random_uuid()::text, '-', '');
alter table public.st_payments alter column guest_key set not null;
create unique index if not exists st_payments_guest_key_key on public.st_payments (guest_key);

-- ---------- 2) ค่าตั้งร้าน (tool_cfg): ereceipt (เปิด · ค่าเริ่มต้น true) · ereceipt_days · ereceipt_note ----------
create or replace function public.st_ereceipt_cfg(p_shop uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'on',   coalesce((s.tool_cfg ->> 'ereceipt')::boolean, true),
           'days', coalesce((s.tool_cfg ->> 'ereceipt_days')::int, 90),
           'note', coalesce(s.tool_cfg ->> 'ereceipt_note', ''))
    from public.st_shops s where s.id = p_shop;
$$;

create or replace function public.st_set_ereceipt(p_shop uuid, p_on boolean, p_days int, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare out jsonb;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_days is null or p_days not in (7, 30, 90, 180, 365) then raise exception 'st_bad_request'; end if;
  if char_length(coalesce(p_note, '')) > 120 then raise exception 'st_bad_request'; end if;
  update public.st_shops
     set tool_cfg = tool_cfg || jsonb_build_object('ereceipt', coalesce(p_on, true), 'ereceipt_days', p_days,
                                                   'ereceipt_note', trim(coalesce(p_note, '')))
   where id = p_shop returning tool_cfg into out;
  return out;
end
$$;

-- ---------- 3) หน้าโต๊ะ: ใบเสร็จของรอบนี้ (anon) ----------
-- ใช้ได้เมื่อ: ร้านเปิดใบเสร็จดิจิทัล · โต๊ะยังเปิด หรือปิดไม่เกิน 3 ชม. (เจ้าของสั่ง: ไม่ซ่อนเมื่อมีลูกค้าโต๊ะถัดไป)
-- ต้องมีรหัสรอบ (session_token) ที่อยู่ในมือถือของคนที่สแกนรอบนั้นเท่านั้น
create or replace function public.st_guest_receipts(p_qr text, p_session_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sess public.st_table_sessions;
  v_cfg  jsonb;
begin
  select s.* into v_sess
    from public.st_table_sessions s join public.st_tables t on t.id = s.table_id
   where t.qr_token = p_qr and s.session_token = p_session_token;
  if v_sess.id is null then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  v_cfg := public.st_ereceipt_cfg(v_sess.shop_id);
  if not (v_cfg ->> 'on')::boolean then return jsonb_build_object('ok', false, 'reason', 'off'); end if;
  if v_sess.status = 'closed' and v_sess.closed_at <= now() - interval '3 hours' then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  return jsonb_build_object(
    'ok', true,
    'closed', v_sess.status = 'closed',
    'days', (v_cfg ->> 'days')::int,
    'receipts', coalesce((select jsonb_agg(jsonb_build_object(
                                  'key', p.guest_key, 'receipt_no', p.receipt_no, 'part_no', p.part_no,
                                  'total', p.total, 'status', p.status, 'created_at', p.created_at)
                                order by p.created_at)
                            from public.st_payments p where p.session_id = v_sess.id), '[]'::jsonb));
end
$$;

-- ---------- 4) หน้าใบเสร็จดิจิทัล: เปิดจากรหัส (anon) ----------
-- ไม่ส่งชื่อพนักงาน หมายเหตุภายใน สลิป หรือรหัสโต๊ะ/รอบ
create or replace function public.st_ereceipt(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p       public.st_payments;
  sh      public.st_shops;
  v_cfg   jsonb;
  v_items jsonb;
  v_share boolean := false;
  v_exp   timestamptz;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{32}$' then raise exception 'st_receipt_not_found'; end if;
  select * into p from public.st_payments where guest_key = p_key;
  if p.id is null then raise exception 'st_receipt_not_found'; end if;
  select * into sh from public.st_shops where id = p.shop_id;
  if sh.id is null or sh.status <> 'active' then raise exception 'st_receipt_not_found'; end if;
  v_cfg := public.st_ereceipt_cfg(sh.id);
  if not (v_cfg ->> 'on')::boolean then raise exception 'st_receipt_off'; end if;
  v_exp := p.created_at + make_interval(days => (v_cfg ->> 'days')::int);
  if v_exp < now() then raise exception 'st_receipt_expired'; end if;

  if exists (select 1 from public.st_payment_items where payment_id = p.id) then
    select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'options', x.opts, 'qty', x.qty,
                                                 'unit_price', x.unit_price, 'line_total', x.amt, 'to_go', x.to_go)
                              order by x.first_at), '[]'::jsonb)
      into v_items
      from (select i.name, i.unit_price, o.to_go,
                   (select string_agg(e ->> 'name', ' · ') from jsonb_array_elements(i.options) e) as opts,
                   sum(pi.qty) as qty, sum(pi.amount) as amt, min(o.created_at) as first_at
              from public.st_payment_items pi
              join public.st_order_items i on i.id = pi.order_item_id
              join public.st_orders o on o.id = i.order_id
             where pi.payment_id = p.id
             group by i.name, i.unit_price, o.to_go, 4) x;
  else
    v_share := p.portion = 'amount' or exists (select 1 from public.st_payments q
                                                 where q.session_id = p.session_id and q.id <> p.id and q.portion = 'amount');
    select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'options', x.opts, 'qty', x.qty,
                                                 'unit_price', x.unit_price, 'line_total', x.line_total, 'to_go', x.to_go)
                              order by x.first_at), '[]'::jsonb)
      into v_items
      from (select i.name, i.unit_price, o.to_go,
                   (select string_agg(e ->> 'name', ' · ') from jsonb_array_elements(i.options) e) as opts,
                   sum(i.qty) as qty, sum(i.line_total) as line_total, min(o.created_at) as first_at
              from public.st_order_items i
              join public.st_orders o on o.id = i.order_id
             where o.session_id = p.session_id and o.status <> 'cancelled'
             group by i.name, i.unit_price, o.to_go, 4) x;
  end if;

  return jsonb_build_object(
    'receipt_no', p.receipt_no, 'status', p.status, 'method', p.method, 'created_at', p.created_at,
    'subtotal', p.subtotal, 'discount', p.discount, 'service', p.service, 'service_pct', p.service_pct,
    'vat', p.vat, 'vat_pct', p.vat_pct, 'vat_included', p.vat_included, 'total', p.total,
    'received', p.received, 'change', p.change_amount,
    'tenders', (select coalesce(jsonb_agg(jsonb_build_object('method', t ->> 'method', 'amount', t -> 'amount',
                                                             'received', t -> 'received', 'change', t -> 'change')), '[]'::jsonb)
                  from jsonb_array_elements(coalesce(p.tenders, '[]'::jsonb)) t),
    'tax', p.tax, 'portion', p.portion, 'part_no', p.part_no,
    'parts', (select count(*) from public.st_payments where session_id = p.session_id and status = 'paid'),
    'self_pay', p.request_id is not null,
    'share', v_share,
    'session_subtotal', (select coalesce(sum(subtotal), 0) from public.st_orders where session_id = p.session_id and status <> 'cancelled'),
    'void', p.status = 'void',
    'shop', jsonb_build_object('name', sh.name, 'address', sh.address, 'phone', sh.phone,
                               'logo_path', sh.logo_path, 'theme_color', sh.theme_color,
                               'header', sh.tool_cfg -> 'print' ->> 'header',
                               'footer', sh.tool_cfg -> 'print' ->> 'footer',
                               'note', nullif(v_cfg ->> 'note', '')),
    'table_label', (select label from public.st_tables where id = p.table_id),
    'queue_no', (select queue_no from public.st_table_sessions where id = p.session_id),
    'guest_count', (select guest_count from public.st_table_sessions where id = p.session_id),
    'expires_at', v_exp,
    'items', v_items);
end
$$;

-- ---------- สิทธิ์ ----------
revoke all on function public.st_ereceipt_cfg(uuid), public.st_set_ereceipt(uuid, boolean, int, text),
  public.st_guest_receipts(text, text), public.st_ereceipt(text)
from public, anon, authenticated;
grant execute on function public.st_set_ereceipt(uuid, boolean, int, text) to authenticated;
grant execute on function public.st_guest_receipts(text, text), public.st_ereceipt(text) to anon, authenticated;

insert into public.st_schema_log (id) values ('st-25-ereceipt')
on conflict (id) do update set applied_at = now();
