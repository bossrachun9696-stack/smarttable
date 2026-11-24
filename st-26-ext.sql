-- =====================================================================
-- SmartTable · st-26-ext.sql  (รอบ R · รวม DarkChat ขั้น 2: เป็นส่วนขยาย DarkChat)
--  - extensions.kind เพิ่ม 'smarttable' · ด่าน ext_config 'smarttable_gate'
--  - สิทธิ์ = เจ้าของร้าน (ซื้อ/ทดลอง/ครอบครัว/แอดมินให้) · พนักงานใช้ตามเจ้าของ · ลูกค้าไม่ต้องมีบัญชี
--  - ยังไม่มีส่วนขยายชนิด smarttable ที่เปิดอยู่ = ใช้ได้ทุกคน (เหมือนส่วนขยายอื่น)
--  ต้องรันหลัง st-25 และหลังระบบส่วนขยายของ DarkChat (ext_user_kind_ok มีอยู่แล้ว) · รันซ้ำได้
-- =====================================================================

-- 1) ชนิดส่วนขยายใหม่
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.extensions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%=%any%' loop
    execute format('alter table public.extensions drop constraint %I', c.conname);
  end loop;
  alter table public.extensions add constraint extensions_kind_check
    check (kind = any (array['link', 'ledger', 'kidgame', 'board', 'smarttable']));
end $$;
insert into public.ext_config (key, value) values ('smarttable_gate', 'on') on conflict (key) do nothing;

-- ให้หน้าแอดมิน DarkChat ตั้งชนิด smarttable ได้
create or replace function public.ext_admin_set_kind(p_id uuid, p_kind text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.ext_is_admin() then raise exception 'not_admin'; end if;
  if p_kind not in ('link', 'ledger', 'kidgame', 'board', 'smarttable') then raise exception 'bad_kind'; end if;
  update public.extensions set kind = p_kind where id = p_id;
end $$;

-- 2) ร้านนี้ใช้ได้ไหม (ดูสิทธิ์ของเจ้าของร้าน)
create or replace function public.st_shop_licensed(p_shop uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public.ext_user_kind_ok(s.owner_user_id, 'smarttable') or public.is_app_admin(s.owner_user_id)
                      from public.st_shops s where s.id = p_shop), false)
$$;
revoke all on function public.st_shop_licensed(uuid) from public;
grant execute on function public.st_shop_licensed(uuid) to anon, authenticated;

-- ช่วงทดลองของเจ้าของร้าน (null = ไม่ใช่ทดลอง / ไม่มี)
create or replace function public.st_owner_trial_until(p_owner uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select l.expires_at from public.ext_licenses l join public.extensions e on e.id = l.ext_id
   where e.kind = 'smarttable' and e.active and l.user_id = p_owner and l.kind = 'trial' and l.expires_at > now()
     and not exists (select 1 from public.ext_licenses l2 join public.extensions e2 on e2.id = l2.ext_id
                      where e2.kind = 'smarttable' and e2.active and l2.user_id = p_owner and l2.kind in ('paid', 'granted')
                        and (l2.expires_at is null or l2.expires_at > now()))
     and not exists (select 1 from public.ext_family_licenses fl join public.extensions e3 on e3.id = fl.ext_id
                      join public.dc_family_members m on m.family_id = fl.family_id
                      where e3.kind = 'smarttable' and e3.active and m.user_id = p_owner)
   order by l.expires_at desc limit 1
$$;
revoke all on function public.st_owner_trial_until(uuid) from public, anon;

-- 3) ด่านที่ฐานข้อมูล: สร้างร้าน / เปิดโต๊ะ / สั่งอาหาร
create or replace function public.st_ext_guard_shop()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not (public.ext_user_kind_ok(new.owner_user_id, 'smarttable') or public.is_app_admin(new.owner_user_id)) then
    raise exception 'st_ext_locked' using detail = 'owner';
  end if;
  return new;
end $$;
drop trigger if exists st_shops_ext_guard on public.st_shops;
create trigger st_shops_ext_guard before insert on public.st_shops for each row execute function public.st_ext_guard_shop();

create or replace function public.st_ext_guard_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('st.deleting_shop', true) is not null and current_setting('st.deleting_shop', true) <> '' then return new; end if;
  if not public.st_shop_licensed(new.shop_id) then
    raise exception 'st_ext_locked' using detail = 'shop';
  end if;
  return new;
end $$;
drop trigger if exists st_sessions_ext_guard on public.st_table_sessions;
create trigger st_sessions_ext_guard before insert on public.st_table_sessions for each row execute function public.st_ext_guard_row();
drop trigger if exists st_orders_ext_guard on public.st_orders;
create trigger st_orders_ext_guard before insert on public.st_orders for each row execute function public.st_ext_guard_row();

-- 4) สถานะสิทธิ์สำหรับหน้าพนักงาน (home.html)
create or replace function public.st_ext_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); e public.extensions; lic public.ext_licenses; url text; ok boolean; adm boolean := false; shops jsonb;
begin
  if me is null then raise exception 'st_not_signed_in'; end if;
  url := coalesce((select value from public.ext_config where key = 'darkchat_url'), 'https://bossrachun9696-stack.github.io/darkchat/');
  select * into e from public.extensions where kind = 'smarttable' and active order by sort, created_at limit 1;
  if e.id is not null then select * into lic from public.ext_licenses where user_id = me and ext_id = e.id; end if;
  ok := public.ext_user_kind_ok(me, 'smarttable');
  begin adm := coalesce(public.ext_is_admin(), false); exception when others then adm := false; end;
  select coalesce(jsonb_agg(jsonb_build_object('shop_id', s.id, 'licensed', public.st_shop_licensed(s.id),
           'trial_until', public.st_owner_trial_until(s.owner_user_id))), '[]'::jsonb)
    into shops
    from public.st_shops s
   where s.owner_user_id = me or exists (select 1 from public.st_shop_members m where m.shop_id = s.id and m.user_id = me);
  return jsonb_build_object('ok', ok or adm, 'is_admin', adm, 'gate', e.id is not null,
    'trial_until', public.st_owner_trial_until(me),
    'reason', case when ok or adm then null when lic.kind = 'trial' then 'trial_expired' else 'no_license' end,
    'ext_name', e.name, 'price', e.price, 'family_price', e.family_price, 'trial_days', e.trial_days,
    'trial_used', lic.user_id is not null, 'darkchat_url', url, 'shops', shops);
end $$;
revoke all on function public.st_ext_status() from public, anon;
grant execute on function public.st_ext_status() to authenticated;

insert into public.st_schema_log (id) values ('st-26-ext') on conflict (id) do update set applied_at = now();
