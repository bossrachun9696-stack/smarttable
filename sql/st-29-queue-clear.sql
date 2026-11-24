-- =====================================================================
-- SmartTable st-29 · ล้างคิวสั่งกลับบ้าน (เจ้าของ/ผู้จัดการกดเอง)
-- ต้องรัน st-28-quick ก่อน · รันซ้ำได้
--  - p_scope 'paid' = ปิดเฉพาะคิวที่จ่ายครบแล้ว (ถือว่ารับของแล้ว)
--  - p_scope 'all'  = ปิดที่จ่ายครบ + ยกเลิกคิวที่ยังไม่จ่ายเลย · คิวที่จ่ายไปบางส่วนจะไม่แตะ (ให้ร้านจัดการเอง)
--  - คิวที่สั่งจากห้องแชทแล้วถูกยกเลิก -> แจ้งกลับในห้องนั้น
-- เลขคิวเริ่ม 1 ใหม่ทุกวันอยู่แล้ว · คิวที่ไม่มีความเคลื่อนไหว 12 ชม. ระบบปิดให้เอง (st_close_stale_sessions)
-- =====================================================================

create or replace function public.st_takeaway_clear(p_shop uuid, p_scope text default 'paid')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; due numeric; n_pick int := 0; n_cancel int := 0; n_skip int := 0;
begin
  if not public.st_has_shop_role(p_shop, array['owner', 'manager']) then raise exception 'st_forbidden'; end if;
  if p_scope not in ('paid', 'all') then raise exception 'st_bad_request'; end if;
  for s in select x.* from public.st_table_sessions x join public.st_tables t on t.id = x.table_id and t.kind = 'ticket'
            where x.shop_id = p_shop and x.status <> 'closed' order by x.opened_at for update of x loop
    due := coalesce((public.st_session_money(s.id) ->> 'remaining')::numeric, 0);
    if due <= 0 then
      perform set_config('st.close_ok', 'on', true);
      update public.st_table_sessions set status = 'closed', closed_at = now(), closed_by_user_id = auth.uid(),
             picked_up_at = coalesce(picked_up_at, now()) where id = s.id;
      n_pick := n_pick + 1;
    elsif p_scope = 'all' and not exists (select 1 from public.st_payments where session_id = s.id and status = 'paid') then
      update public.st_orders set status = 'cancelled', status_by_user_id = auth.uid() where session_id = s.id and status <> 'cancelled';
      perform set_config('st.close_ok', 'on', true);
      update public.st_table_sessions set status = 'closed', closed_at = now(), closed_by_user_id = auth.uid(), picked_up_at = null
       where id = s.id;
      n_cancel := n_cancel + 1;
    else
      n_skip := n_skip + 1;
      continue;
    end if;
    update public.st_service_calls set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
     where session_id = s.id and status = 'pending';
    update public.st_pay_requests set status = 'cancelled', handled_at = now()
     where session_id = s.id and status in ('draft', 'pending');
  end loop;
  perform set_config('st.close_ok', 'off', true);
  if n_pick + n_cancel > 0 then
    begin
      perform public.st_audit(p_shop, 'queue_clear', null, null,
        jsonb_build_object('scope', p_scope, 'picked', n_pick, 'cancelled', n_cancel, 'skipped', n_skip));
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('picked', n_pick, 'cancelled', n_cancel, 'skipped', n_skip);
end $$;
revoke all on function public.st_takeaway_clear(uuid, text) from public, anon;
grant execute on function public.st_takeaway_clear(uuid, text) to authenticated;

-- คิวจากห้องแชทถูกยกเลิก (กดยกเลิกทีละคิว หรือล้างคิว) -> แจ้งห้องที่สั่ง
create or replace function public.st_chat_on_cancel()
returns trigger language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  if new.chat_room is null or old.status = 'closed' or new.status <> 'closed' or new.picked_up_at is not null then return null; end if;
  if not exists (select 1 from public.st_orders where session_id = new.id)
     or exists (select 1 from public.st_orders where session_id = new.id and status <> 'cancelled') then return null; end if;
  select * into l from public.st_chat_links where room_key = new.chat_room and shop_id = new.shop_id;
  perform public.ext_ledger_post(new.chat_room, null, l.created_by,
    '❌ ' || (select name from public.st_shops where id = new.shop_id) || ' · คิว ' || coalesce(new.queue_no::text, '?')
      || coalesce(' (' || nullif(new.contact_name, '') || ')', '') || ' ถูกยกเลิกโดยร้าน',
    jsonb_build_object('ext', 'smarttable', 'type', 'cancel', 'shop', new.shop_id, 'session', new.id), true);
  return null;
exception when others then return null;
end $$;
drop trigger if exists st_sessions_chat_cancel on public.st_table_sessions;
create trigger st_sessions_chat_cancel after update of status on public.st_table_sessions
  for each row execute function public.st_chat_on_cancel();

insert into public.st_schema_log (id) values ('st-29-queue-clear') on conflict (id) do update set applied_at = now();
