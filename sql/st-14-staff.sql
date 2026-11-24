-- =====================================================================
-- SmartTable · st-14-staff.sql  (รันซ้ำได้ · ต้องรัน st-01 ถึง st-13 ก่อน)
-- รอบ F: ลบร้าน · โปรไฟล์ (รูป + ไอดี + ตั้งค่าการแสดงผล) · เชิญพนักงานด้วยไอดี · ลูกค้าเปิดโต๊ะเอง (ร้านยืนยัน)
--
-- * ลบร้าน: เจ้าของเท่านั้น + พิมพ์ชื่อร้านให้ตรง · ข้อมูลทั้งหมดของร้านหายถาวร (หน้าเว็บลบรูป/สลิปใน Storage ให้ก่อน)
-- * โปรไฟล์: ไอดีสาธารณะ (เช่น u7k3p9qa — แก้เป็นชื่อที่จำง่ายได้) · รูปโปรไฟล์ · prefs (ธีม / รูปแบบหน้าร้าน)
-- * เชิญด้วยไอดี: ร้านไม่เห็นอีเมลของคนที่เชิญ · คำเชิญขึ้นที่หน้า "ร้านของฉัน" ของคนนั้น → กดรับ / ปฏิเสธ
--   (คำเชิญด้วยอีเมลแบบเดิมก็ขึ้นที่หน้านั้นด้วย ไม่ต้องส่งลิงก์ก็ได้)
-- * order_mode 'confirm': ลูกค้าสแกนแล้วเปิดโต๊ะ + สั่งได้ทันที · ร้านได้แจ้ง "ลูกค้าเปิดโต๊ะเอง" → ยืนยัน / ปฏิเสธ
--   ปฏิเสธ = ยกเลิกออร์เดอร์ทั้งหมดของรอบนั้น + ปิดโต๊ะ (เช่น มีคนถ่ายรูป QR ไปสั่งเล่น)
-- * ไฟล์นี้ทับ st_audit, st_accept_invite, st_invite_info, st_scan, st_order_board, st_tables_board
--   ถ้ารันไฟล์เก่าซ้ำ ให้รันไฟล์นี้ซ้ำด้วย
-- =====================================================================

-- ---------- 1) โปรไฟล์: ไอดี + รูป + ตั้งค่าการแสดงผล ----------
alter table public.st_profiles add column if not exists public_id text;
alter table public.st_profiles add column if not exists avatar_path text;
alter table public.st_profiles add column if not exists prefs jsonb not null default '{}'::jsonb;
alter table public.st_profiles drop constraint if exists st_profiles_public_id_check;
alter table public.st_profiles add constraint st_profiles_public_id_check
  check (public_id is null or public_id ~ '^[a-z0-9][a-z0-9_.]{3,19}$');
alter table public.st_profiles drop constraint if exists st_profiles_prefs_check;
alter table public.st_profiles add constraint st_profiles_prefs_check
  check (jsonb_typeof(prefs) = 'object' and pg_column_size(prefs) <= 2000);
create unique index if not exists st_profiles_public_id_key on public.st_profiles (public_id);

-- สุ่มไอดี u + 7 ตัว (ไม่มี 0 o 1 l i ให้อ่านง่าย)
create or replace function public.st_new_public_id()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  abc text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v   text;
  i   int;
begin
  loop
    v := 'u';
    for i in 1..7 loop v := v || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from public.st_profiles where public_id = v);
  end loop;
  return v;
end
$$;

create or replace function public.st_profiles_public_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.public_id is null then new.public_id := public.st_new_public_id(); end if;
  return new;
end
$$;
drop trigger if exists st_profiles_public_id on public.st_profiles;
create trigger st_profiles_public_id
  before insert or update on public.st_profiles
  for each row execute function public.st_profiles_public_id();
update public.st_profiles set public_id = public.st_new_public_id() where public_id is null;

-- แก้โปรไฟล์ของตัวเอง (ส่งเฉพาะช่องที่จะแก้)
-- p: {display_name, public_id, avatar_path (null = ลบรูป), prefs: {theme, layout}}
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
    if jsonb_typeof(p -> 'prefs') <> 'object' then raise exception 'st_bad_request'; end if;
    update public.st_profiles
       set prefs = jsonb_strip_nulls(prefs || jsonb_build_object(
             'theme',  case when p -> 'prefs' ->> 'theme'  in ('auto','light','dark') then p -> 'prefs' ->> 'theme' end,
             'layout', case when p -> 'prefs' ->> 'layout' in ('list','tiles','icons','groups') then p -> 'prefs' ->> 'layout' end)),
           updated_at = now()
     where user_id = v_uid;
  end if;

  select * into r from public.st_profiles where user_id = v_uid;
  return jsonb_build_object('user_id', r.user_id, 'email', r.email, 'display_name', r.display_name,
                            'public_id', r.public_id, 'avatar_path', r.avatar_path, 'prefs', r.prefs);
end
$$;

create or replace function public.st_my_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.st_profiles;
begin
  if auth.uid() is null then raise exception 'st_not_authenticated'; end if;
  r := public.st_ensure_profile();
  if r.public_id is null then
    update public.st_profiles set public_id = public.st_new_public_id() where user_id = r.user_id returning * into r;
  end if;
  return jsonb_build_object('user_id', r.user_id, 'email', r.email, 'display_name', r.display_name,
                            'public_id', r.public_id, 'avatar_path', r.avatar_path, 'prefs', r.prefs);
end
$$;

-- หาคนด้วยไอดี (ไว้ยืนยันก่อนเชิญ) · ไม่คืนอีเมล
create or replace function public.st_find_user(p_public_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then null else (
    select jsonb_build_object('public_id', p.public_id, 'display_name', p.display_name, 'avatar_path', p.avatar_path)
      from public.st_profiles p
     where p.public_id = lower(trim(coalesce(p_public_id, '')))) end;
$$;

-- รูปโปรไฟล์ + ไอดีของพนักงานในร้าน (เสริม st_list_members)
create or replace function public.st_member_profiles(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop) then raise exception 'st_forbidden'; end if;
  return coalesce((select jsonb_object_agg(m.user_id, jsonb_build_object('public_id', p.public_id, 'avatar_path', p.avatar_path))
                     from public.st_shop_members m
                     join public.st_profiles p on p.user_id = m.user_id
                    where m.shop_id = p_shop), '{}'::jsonb);
end
$$;

-- รูปโปรไฟล์อยู่ในถัง st-images: users/<user_id>/avatar-<เวลา>.jpg · แก้ได้เฉพาะของตัวเอง
drop policy if exists st_images_insert_avatar on storage.objects;
create policy st_images_insert_avatar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'st-images' and name like 'users/' || (select auth.uid())::text || '/%');
drop policy if exists st_images_select_avatar on storage.objects;
create policy st_images_select_avatar on storage.objects
  for select to authenticated
  using (bucket_id = 'st-images' and name like 'users/' || (select auth.uid())::text || '/%');
drop policy if exists st_images_delete_avatar on storage.objects;
create policy st_images_delete_avatar on storage.objects
  for delete to authenticated
  using (bucket_id = 'st-images' and name like 'users/' || (select auth.uid())::text || '/%');

-- เจ้าของร้านลบสลิปของร้านตัวเองได้ (ใช้ตอน "ลบร้าน" เพื่อล้างไฟล์ให้หมด)
drop policy if exists st_slips_delete_owner on storage.objects;
create policy st_slips_delete_owner on storage.objects
  for delete to authenticated
  using (bucket_id = 'st-slips'
         and public.st_has_shop_role(public.st_path_shop(name), array['owner']));

-- ---------- 2) เชิญพนักงานด้วยไอดี + คำเชิญถึงฉัน ----------
alter table public.st_shop_invites add column if not exists invited_user_id uuid references auth.users(id) on delete cascade;
create index if not exists st_shop_invites_user_idx on public.st_shop_invites (invited_user_id) where invited_user_id is not null;

create or replace function public.st_invite_staff_by_id(p_shop uuid, p_public_id text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my  text := public.st_my_role(p_shop);
  v_usr uuid;
  v_pid text := lower(trim(coalesce(p_public_id, '')));
  v_row public.st_shop_invites;
begin
  if v_my is null or v_my not in ('owner','manager') then raise exception 'st_forbidden'; end if;
  if p_role not in ('manager','cashier','kitchen','waiter') then raise exception 'st_bad_role'; end if;
  if v_my = 'manager' and p_role = 'manager' then raise exception 'st_forbidden'; end if;
  select user_id into v_usr from public.st_profiles where public_id = v_pid;
  if v_usr is null then raise exception 'st_user_not_found'; end if;
  if exists (select 1 from public.st_shop_members where shop_id = p_shop and user_id = v_usr) then
    raise exception 'st_already_member';
  end if;
  if (select count(*) from public.st_shop_members where shop_id = p_shop) >= 30 then raise exception 'st_member_limit'; end if;

  update public.st_shop_invites set revoked_at = now()
   where shop_id = p_shop and invited_user_id = v_usr and accepted_at is null and revoked_at is null;
  if (select count(*) from public.st_shop_invites
       where shop_id = p_shop and accepted_at is null and revoked_at is null and expires_at > now()) >= 20 then
    raise exception 'st_invite_limit';
  end if;

  -- เก็บไอดีไว้ในช่อง email (ไม่ใช่อีเมลจริง) เพื่อไม่ให้ร้านเห็นอีเมลของพนักงาน
  insert into public.st_shop_invites (shop_id, email, role, invited_by_user_id, invited_user_id)
  values (p_shop, '@' || v_pid, p_role, auth.uid(), v_usr)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'token', v_row.token, 'role', v_row.role, 'expires_at', v_row.expires_at);
end
$$;

-- ทับ st-02: รับคำเชิญที่ส่งด้วยไอดีได้ (ตรวจจากบัญชี ไม่ใช่อีเมล)
create or replace function public.st_accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_inv   public.st_shop_invites;
begin
  if v_uid is null then raise exception 'st_not_authenticated'; end if;

  select * into v_inv from public.st_shop_invites where token = p_token for update;
  if not found                      then raise exception 'st_invite_not_found'; end if;
  if v_inv.revoked_at is not null   then raise exception 'st_invite_revoked'; end if;
  if v_inv.accepted_at is not null  then raise exception 'st_invite_used'; end if;
  if v_inv.expires_at < now()       then raise exception 'st_invite_expired'; end if;

  if v_inv.invited_user_id is not null then
    if v_inv.invited_user_id <> v_uid then raise exception 'st_email_mismatch'; end if;
  else
    select lower(u.email) into v_email from auth.users u where u.id = v_uid;
    if v_email is distinct from v_inv.email then raise exception 'st_email_mismatch'; end if;
  end if;

  perform public.st_ensure_profile();

  insert into public.st_shop_members (shop_id, user_id, role, invited_by_user_id)
  values (v_inv.shop_id, v_uid, v_inv.role, v_inv.invited_by_user_id)
  on conflict (shop_id, user_id) do update
     set role = case when public.st_shop_members.role = 'owner' then 'owner' else excluded.role end;

  update public.st_shop_invites
     set accepted_at = now(), accepted_user_id = v_uid
   where id = v_inv.id;

  return v_inv.shop_id;
end
$$;

-- ทับ st-02: หน้าลิงก์คำเชิญ แสดง @ไอดี แทนอีเมลเมื่อเชิญด้วยไอดี
create or replace function public.st_invite_info(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'shop_name', s.name,
           'role', i.role,
           'email_masked', case when i.invited_user_id is not null then i.email
                                else left(split_part(i.email, '@', 1), 2) || '***@' || split_part(i.email, '@', 2) end,
           'status', case when i.revoked_at  is not null then 'revoked'
                          when i.accepted_at is not null then 'used'
                          when i.expires_at < now()      then 'expired'
                          else 'valid' end)
    from public.st_shop_invites i
    join public.st_shops s on s.id = i.shop_id
   where i.token = p_token;
$$;

-- คำเชิญถึงฉัน (ทั้งเชิญด้วยไอดี และเชิญด้วยอีเมลของฉัน)
create or replace function public.st_my_invites()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then raise exception 'st_not_authenticated'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'token', i.token, 'role', i.role, 'expires_at', i.expires_at, 'created_at', i.created_at,
             'shop_name', s.name, 'shop_logo', s.logo_path,
             'invited_by', (select coalesce(p.display_name, '') from public.st_profiles p where p.user_id = i.invited_by_user_id))
           order by i.created_at desc)
      from public.st_shop_invites i
      join public.st_shops s on s.id = i.shop_id
     where (i.invited_user_id = v_uid or (i.invited_user_id is null and i.email = v_email))
       and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
       and not exists (select 1 from public.st_shop_members m where m.shop_id = i.shop_id and m.user_id = v_uid)), '[]'::jsonb);
end
$$;

create or replace function public.st_decline_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then raise exception 'st_not_authenticated'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  update public.st_shop_invites set revoked_at = now()
   where id = p_invite and accepted_at is null and revoked_at is null
     and (invited_user_id = v_uid or (invited_user_id is null and email = v_email));
  if not found then raise exception 'st_invite_not_found'; end if;
end
$$;

-- ---------- 3) ลบร้าน ----------
-- ทับ st-09: ระหว่างลบร้าน ไม่เขียนประวัติของร้านนั้น (ร้านกำลังจะหายทั้งหมด)
create or replace function public.st_audit(p_shop uuid, p_action text, p_table text, p_amount numeric, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.st_audit_log (shop_id, user_id, action, table_label, amount, detail)
  select p_shop, auth.uid(), p_action, p_table, p_amount, coalesce(p_detail, '{}'::jsonb)
   where coalesce(current_setting('st.deleting_shop', true), '') <> p_shop::text;
$$;

-- เจ้าของเท่านั้น · พิมพ์ชื่อร้านให้ตรงทุกตัวอักษร · ลบทุกอย่างของร้าน (เมนู โต๊ะ ออร์เดอร์ ใบเสร็จ รายงาน ประวัติ)
create or replace function public.st_delete_shop(p_shop uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_name text;
begin
  if public.st_my_role(p_shop) is distinct from 'owner' then raise exception 'st_forbidden'; end if;
  select name into v_name from public.st_shops where id = p_shop for update;
  if v_name is null then raise exception 'st_not_found'; end if;
  if trim(coalesce(p_confirm_name, '')) <> trim(v_name) then raise exception 'st_confirm_name'; end if;
  perform set_config('st.deleting_shop', p_shop::text, true);
  delete from public.st_cart_lines where shop_id = p_shop;
  delete from public.st_shops where id = p_shop;
  perform set_config('st.deleting_shop', '', true);
end
$$;

-- ---------- 4) ลูกค้าเปิดโต๊ะเอง ร้านยืนยัน (order_mode = 'confirm') ----------
alter table public.st_shops drop constraint if exists st_shops_order_mode_check;
alter table public.st_shops add constraint st_shops_order_mode_check check (order_mode in ('instant','staff_open','confirm'));

alter table public.st_table_sessions add column if not exists confirm_status text;
alter table public.st_table_sessions drop constraint if exists st_table_sessions_confirm_status_check;
alter table public.st_table_sessions add constraint st_table_sessions_confirm_status_check
  check (confirm_status is null or confirm_status in ('pending','confirmed'));
alter table public.st_table_sessions add column if not exists confirmed_at timestamptz;
alter table public.st_table_sessions add column if not exists confirmed_by_user_id uuid references auth.users(id) on delete set null;

alter table public.st_service_calls drop constraint if exists st_service_calls_kind_check;
alter table public.st_service_calls add constraint st_service_calls_kind_check check (kind in ('call','bill','slip','open'));

-- ลูกค้าเปิดโต๊ะเองในโหมด confirm -> รอร้านยืนยัน + แจ้งพนักงาน
create or replace function public.st_sessions_confirm_mark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.opened_via = 'auto' and new.confirm_status is null
     and (select order_mode from public.st_shops where id = new.shop_id) = 'confirm' then
    new.confirm_status := 'pending';
  end if;
  return new;
end
$$;
drop trigger if exists st_sessions_confirm_mark on public.st_table_sessions;
create trigger st_sessions_confirm_mark
  before insert on public.st_table_sessions
  for each row execute function public.st_sessions_confirm_mark();

create or replace function public.st_sessions_confirm_call()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.confirm_status = 'pending' then
    insert into public.st_service_calls (shop_id, table_id, session_id, kind)
    values (new.shop_id, new.table_id, new.id, 'open')
    on conflict (session_id, kind) where status = 'pending' do nothing;
  end if;
  return new;
end
$$;
drop trigger if exists st_sessions_confirm_call on public.st_table_sessions;
create trigger st_sessions_confirm_call
  after insert on public.st_table_sessions
  for each row execute function public.st_sessions_confirm_call();

-- ยืนยัน / ปฏิเสธโต๊ะที่ลูกค้าเปิดเอง
create or replace function public.st_confirm_table(p_table uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  s      public.st_table_sessions;
  v_lbl  text;
begin
  select shop_id, label into v_shop, v_lbl from public.st_tables where id = p_table;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager','cashier','waiter']) then raise exception 'st_forbidden'; end if;
  select * into s from public.st_table_sessions where table_id = p_table and status <> 'closed' for update;
  if s.id is null then raise exception 'st_table_not_open'; end if;

  if p_ok then
    update public.st_table_sessions
       set confirm_status = 'confirmed', confirmed_at = now(), confirmed_by_user_id = auth.uid(), last_activity_at = now()
     where id = s.id;
  else
    if exists (select 1 from public.st_payments where session_id = s.id and status = 'paid') then
      raise exception 'st_partly_paid';
    end if;
    perform public.st_audit(v_shop, 'table_reject', v_lbl,
      (select coalesce(sum(subtotal), 0) from public.st_orders where session_id = s.id and status <> 'cancelled'),
      jsonb_build_object('orders', (select count(*) from public.st_orders where session_id = s.id and status <> 'cancelled')));
    update public.st_orders set status = 'cancelled', status_by_user_id = auth.uid()
     where session_id = s.id and status <> 'cancelled';
    update public.st_table_sessions
       set status = 'closed', closed_at = now(), closed_by_user_id = auth.uid()
     where id = s.id;
  end if;
  update public.st_service_calls set status = 'done', handled_at = now(), handled_by_user_id = auth.uid()
   where session_id = s.id and kind = 'open' and status = 'pending';
end
$$;

-- ---------- 5) ทับ st-12: หน้าสแกน (โหมด confirm เปิดโต๊ะเองเหมือน instant + บอกสถานะยืนยัน) ----------
create or replace function public.st_scan(p_qr text, p_auto_open boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tab    public.st_tables;
  v_shop   public.st_shops;
  v_sess   public.st_table_sessions;
  v_state  text;
  v_ticket jsonb;
begin
  select * into v_tab from public.st_tables where qr_token = p_qr;
  if not found or not v_tab.is_active then raise exception 'st_table_not_found'; end if;
  select * into v_shop from public.st_shops where id = v_tab.shop_id;
  if v_shop.status <> 'active' then raise exception 'st_table_not_found'; end if;

  if v_tab.kind = 'hub' then
    v_state := case when not v_shop.is_open then 'shop_closed'
                    when not v_shop.takeaway_enabled then 'takeaway_off'
                    else 'takeaway' end;
  elsif v_tab.kind = 'ticket' then
    select * into v_sess from public.st_table_sessions where table_id = v_tab.id order by opened_at desc limit 1;
    v_state := case when v_sess.status in ('open','billing') then v_sess.status else 'ended' end;
    if v_sess.status <> 'closed' or v_sess.closed_at > now() - interval '3 hours' then
      v_ticket := jsonb_build_object(
        'queue_no', v_sess.queue_no, 'pickup_at', v_sess.pickup_at, 'ready_at', v_sess.ready_at,
        'picked_up_at', v_sess.picked_up_at, 'closed', v_sess.status = 'closed',
        'contact_name', v_sess.contact_name,
        'paid', v_sess.paid_at is not null
                or (exists (select 1 from public.st_payments where session_id = v_sess.id and status = 'paid')
                    and (public.st_session_money(v_sess.id) ->> 'remaining')::numeric <= 0),
        'hub_qr', (select qr_token from public.st_tables where shop_id = v_shop.id and kind = 'hub' and is_active));
    end if;
    if v_sess.status = 'closed' then v_sess := null; end if;
  else
    select * into v_sess from public.st_table_sessions where table_id = v_tab.id and status <> 'closed';
    if not v_shop.is_open then
      v_state := 'shop_closed';
    elsif v_sess.id is null then
      if v_shop.order_mode in ('instant','confirm') and not coalesce(p_auto_open, true) then
        v_state := 'ended';
      elsif v_shop.order_mode in ('instant','confirm') then
        begin
          insert into public.st_table_sessions (shop_id, table_id, opened_via)
          values (v_shop.id, v_tab.id, 'auto')
          returning * into v_sess;
        exception when unique_violation then
          select * into v_sess from public.st_table_sessions where table_id = v_tab.id and status <> 'closed';
        end;
        v_state := 'open';
      else
        v_state := 'waiting';
      end if;
    else
      v_state := v_sess.status;
    end if;
  end if;

  return jsonb_build_object(
    'shop', jsonb_build_object('id', v_shop.id, 'name', v_shop.name, 'logo_path', v_shop.logo_path,
                               'cover_path', v_shop.cover_path, 'theme_color', v_shop.theme_color,
                               'languages', v_shop.languages,
                               'order_mode', v_shop.order_mode, 'phone', v_shop.phone,
                               'service_pct', v_shop.service_pct, 'vat_pct', v_shop.vat_pct,
                               'vat_included', v_shop.vat_included),
    'table', jsonb_build_object('label', v_tab.label, 'zone', v_tab.zone, 'kind', v_tab.kind),
    'state', v_state,
    'takeaway', case when v_tab.kind = 'hub' then jsonb_build_object('preorder', v_shop.preorder_enabled) end,
    'ticket', v_ticket,
    'confirm', case when v_state in ('open','billing') then v_sess.confirm_status end,
    'session_token', case when v_state in ('open','billing') then v_sess.session_token end
  );
end
$$;

-- ทับ st-12: กระดานออร์เดอร์ บอกว่าโต๊ะยังไม่ยืนยัน
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
                                                         'station_id', i.station_id, 'done', i.done_at is not null)
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

-- ทับ st-12: ผังโต๊ะ บอกว่าโต๊ะรอยืนยัน
create or replace function public.st_tables_board(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop) then raise exception 'st_forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'label', t.label, 'zone', t.zone, 'seats', t.seats,
             'qr_token', t.qr_token, 'is_active', t.is_active,
             'session', case when s.id is null then null else jsonb_build_object(
                          'id', s.id, 'status', s.status, 'guest_count', s.guest_count,
                          'opened_via', s.opened_via, 'opened_at', s.opened_at,
                          'last_activity_at', s.last_activity_at,
                          'confirm_status', s.confirm_status) end)
           order by t.zone nulls first, length(t.label), t.label)
      from public.st_tables t
      left join public.st_table_sessions s on s.table_id = t.id and s.status <> 'closed'
     where t.shop_id = p_shop and t.kind = 'dine'), '[]'::jsonb);
end
$$;

-- ---------- 6) สิทธิ์ ----------
revoke all on function
  public.st_new_public_id(), public.st_profiles_public_id(), public.st_update_profile(jsonb), public.st_my_profile(),
  public.st_find_user(text), public.st_member_profiles(uuid), public.st_invite_staff_by_id(uuid, text, text),
  public.st_my_invites(), public.st_decline_invite(uuid), public.st_delete_shop(uuid, text),
  public.st_sessions_confirm_mark(), public.st_sessions_confirm_call(), public.st_confirm_table(uuid, boolean)
from public, anon, authenticated;
grant execute on function
  public.st_update_profile(jsonb), public.st_my_profile(), public.st_find_user(text), public.st_member_profiles(uuid),
  public.st_invite_staff_by_id(uuid, text, text), public.st_my_invites(), public.st_decline_invite(uuid),
  public.st_delete_shop(uuid, text), public.st_confirm_table(uuid, boolean)
to authenticated;
-- st_accept_invite / st_invite_info / st_scan / st_order_board / st_tables_board / st_audit ใช้สิทธิ์เดิม

-- ---------- 7) บันทึกว่ารันไฟล์นี้แล้ว ----------
insert into public.st_schema_log (id) values ('st-14-staff')
on conflict (id) do update set applied_at = now();
