-- =====================================================================
-- SmartTable · st-02-shops.sql  (รันซ้ำได้ · ต้องรัน st-01-auth.sql ก่อน)
-- ร้าน, พนักงาน, คำเชิญพนักงาน
--
-- * ใครก็สมัครแล้วสร้างร้านได้ (ไม่เกิน 3 ร้านต่อบัญชี)
-- * ร้านเลือกรูปแบบการสั่งอาหาร: 'instant' สั่งได้ทันที / 'staff_open' รอพนักงานเปิดโต๊ะ
-- * บทบาท: owner เจ้าของ, manager ผู้จัดการ, cashier แคชเชียร์, kitchen ครัว, waiter พนักงานเสิร์ฟ
-- * เชิญพนักงานด้วยลิงก์ (ไม่ต้องส่งอีเมล) คนรับต้องล็อกอินด้วยอีเมลที่ถูกเชิญ
-- * ทุกชื่อขึ้นต้น st_ · ไม่แตะของ DarkChat
-- =====================================================================

-- ---------- 1) ตาราง ----------
create table if not exists public.st_shops (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete restrict,
  name           text not null check (char_length(name) between 1 and 80),
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  phone          text check (phone is null or char_length(phone) <= 20),
  address        text check (address is null or char_length(address) <= 300),
  logo_path      text,
  cover_path     text,
  promptpay_id   text check (promptpay_id is null or promptpay_id ~ '^[0-9]{10,15}$'),
  service_pct    numeric(5,2) not null default 0 check (service_pct between 0 and 30),
  vat_pct        numeric(5,2) not null default 0 check (vat_pct between 0 and 30),
  vat_included   boolean not null default true,       -- ราคาในเมนูรวม VAT แล้ว
  order_mode     text not null default 'staff_open' check (order_mode in ('instant','staff_open')),
  is_open        boolean not null default true,
  status         text not null default 'active' check (status in ('active','suspended')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists st_shops_owner_idx on public.st_shops (owner_user_id);

create table if not exists public.st_shop_members (
  shop_id             uuid not null references public.st_shops(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  role                text not null check (role in ('owner','manager','cashier','kitchen','waiter')),
  invited_by_user_id  uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create unique index if not exists st_shop_members_one_owner on public.st_shop_members (shop_id) where role = 'owner';
create index if not exists st_shop_members_user_idx on public.st_shop_members (user_id);

create table if not exists public.st_shop_invites (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid not null references public.st_shops(id) on delete cascade,
  email               text not null,
  role                text not null check (role in ('manager','cashier','kitchen','waiter')),
  token               text not null unique
                      default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  invited_by_user_id  uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default now() + interval '7 days',
  accepted_at         timestamptz,
  accepted_user_id    uuid references auth.users(id) on delete set null,
  revoked_at          timestamptz
);
create index if not exists st_shop_invites_shop_idx on public.st_shop_invites (shop_id);

drop trigger if exists st_shops_touch on public.st_shops;
create trigger st_shops_touch
  before update on public.st_shops
  for each row execute function public.st_touch_updated_at();

-- ---------- 2) ตัวช่วยเช็กสิทธิ์ (ใช้ใน policy) ----------
create or replace function public.st_has_shop_role(p_shop uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.st_shop_members m
     where m.shop_id = p_shop
       and m.user_id = auth.uid()
       and (p_roles is null or m.role = any (p_roles))
  );
$$;

create or replace function public.st_my_role(p_shop uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.st_shop_members m
   where m.shop_id = p_shop and m.user_id = auth.uid();
$$;

-- ---------- 3) RLS ----------
alter table public.st_shops        enable row level security;
alter table public.st_shop_members enable row level security;
alter table public.st_shop_invites enable row level security;

drop policy if exists st_shops_select_member on public.st_shops;
create policy st_shops_select_member on public.st_shops
  for select to authenticated
  using (public.st_has_shop_role(id));

drop policy if exists st_shops_update_manager on public.st_shops;
create policy st_shops_update_manager on public.st_shops
  for update to authenticated
  using (public.st_has_shop_role(id, array['owner','manager']))
  with check (public.st_has_shop_role(id, array['owner','manager']));

drop policy if exists st_shop_members_select_member on public.st_shop_members;
create policy st_shop_members_select_member on public.st_shop_members
  for select to authenticated
  using (public.st_has_shop_role(shop_id));

drop policy if exists st_shop_invites_select_manager on public.st_shop_invites;
create policy st_shop_invites_select_manager on public.st_shop_invites
  for select to authenticated
  using (public.st_has_shop_role(shop_id, array['owner','manager']));

-- สิทธิ์ตาราง: อ่านได้ตาม policy, แก้ร้านได้เฉพาะคอลัมน์ตั้งค่า, ที่เหลือทำผ่าน RPC เท่านั้น
revoke all on public.st_shops, public.st_shop_members, public.st_shop_invites from anon, authenticated;
grant select on public.st_shops, public.st_shop_members, public.st_shop_invites to authenticated;
grant update (name, phone, address, logo_path, cover_path, promptpay_id,
              service_pct, vat_pct, vat_included, order_mode, is_open)
  on public.st_shops to authenticated;

-- ---------- 4) RPC: ร้าน ----------
create or replace function public.st_slug_available(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(p_slug) ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
     and lower(p_slug) not in ('admin','api','app','www','smarttable','login','shop','shops','table','menu','help','support')
     and not exists (select 1 from public.st_shops s where s.slug = lower(p_slug));
$$;

create or replace function public.st_create_shop(p_name text, p_slug text)
returns public.st_shops
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := trim(p_name);
  v_slug text := lower(trim(p_slug));
  v_row  public.st_shops;
begin
  if v_uid is null then raise exception 'st_not_authenticated'; end if;
  if v_name is null or char_length(v_name) not between 1 and 80 then raise exception 'st_bad_name'; end if;
  if v_slug is null or v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then raise exception 'st_bad_slug'; end if;
  if not public.st_slug_available(v_slug) then raise exception 'st_slug_taken'; end if;
  if (select count(*) from public.st_shops where owner_user_id = v_uid) >= 3 then
    raise exception 'st_shop_limit';
  end if;

  perform public.st_ensure_profile();

  insert into public.st_shops (owner_user_id, name, slug)
  values (v_uid, v_name, v_slug)
  returning * into v_row;

  insert into public.st_shop_members (shop_id, user_id, role)
  values (v_row.id, v_uid, 'owner');

  return v_row;
exception
  when unique_violation then raise exception 'st_slug_taken';
end
$$;

create or replace function public.st_my_shops()
returns table (id uuid, name text, slug text, role text, is_open boolean,
               order_mode text, status text, logo_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.slug, m.role, s.is_open, s.order_mode, s.status, s.logo_path
    from public.st_shop_members m
    join public.st_shops s on s.id = m.shop_id
   where m.user_id = auth.uid()
   order by (m.role = 'owner') desc, s.name;
$$;

-- ---------- 5) RPC: พนักงาน ----------
create or replace function public.st_list_members(p_shop uuid)
returns table (user_id uuid, email text, display_name text, role text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop) then raise exception 'st_forbidden'; end if;
  return query
    select m.user_id, lower(u.email)::text, p.display_name, m.role, m.created_at
      from public.st_shop_members m
      join auth.users u on u.id = m.user_id
      left join public.st_profiles p on p.user_id = m.user_id
     where m.shop_id = p_shop
     order by array_position(array['owner','manager','cashier','kitchen','waiter'], m.role), m.created_at;
end
$$;

-- ผู้จัดการจัดการได้เฉพาะ cashier / kitchen / waiter · เจ้าของจัดการได้ทุกคนยกเว้นตัวเอง
create or replace function public.st_invite_staff(p_shop uuid, p_email text, p_role text)
returns public.st_shop_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my    text := public.st_my_role(p_shop);
  v_email text := lower(trim(p_email));
  v_row   public.st_shop_invites;
begin
  if v_my is null or v_my not in ('owner','manager') then raise exception 'st_forbidden'; end if;
  if p_role not in ('manager','cashier','kitchen','waiter') then raise exception 'st_bad_role'; end if;
  if v_my = 'manager' and p_role = 'manager' then raise exception 'st_forbidden'; end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'st_bad_email';
  end if;
  if exists (select 1 from public.st_shop_members m join auth.users u on u.id = m.user_id
              where m.shop_id = p_shop and lower(u.email) = v_email) then
    raise exception 'st_already_member';
  end if;
  if (select count(*) from public.st_shop_members where shop_id = p_shop) >= 30 then
    raise exception 'st_member_limit';
  end if;

  -- เชิญอีเมลเดิมซ้ำ = ยกเลิกลิงก์เก่า
  update public.st_shop_invites set revoked_at = now()
   where shop_id = p_shop and email = v_email and accepted_at is null and revoked_at is null;

  if (select count(*) from public.st_shop_invites
       where shop_id = p_shop and accepted_at is null and revoked_at is null and expires_at > now()) >= 20 then
    raise exception 'st_invite_limit';
  end if;

  insert into public.st_shop_invites (shop_id, email, role, invited_by_user_id)
  values (p_shop, v_email, p_role, auth.uid())
  returning * into v_row;
  return v_row;
end
$$;

create or replace function public.st_revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_shop_invites where id = p_invite;
  if v_shop is null or not public.st_has_shop_role(v_shop, array['owner','manager']) then
    raise exception 'st_forbidden';
  end if;
  update public.st_shop_invites set revoked_at = now()
   where id = p_invite and accepted_at is null and revoked_at is null;
end
$$;

-- ดูข้อมูลคำเชิญจาก token (ยังไม่ล็อกอินก็ดูได้ · อีเมลถูกปิดบางส่วน)
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
           'email_masked', left(split_part(i.email, '@', 1), 2) || '***@' || split_part(i.email, '@', 2),
           'status', case when i.revoked_at  is not null then 'revoked'
                          when i.accepted_at is not null then 'used'
                          when i.expires_at < now()      then 'expired'
                          else 'valid' end)
    from public.st_shop_invites i
    join public.st_shops s on s.id = i.shop_id
   where i.token = p_token;
$$;

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

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from v_inv.email then raise exception 'st_email_mismatch'; end if;

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

create or replace function public.st_set_member_role(p_shop uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my     text := public.st_my_role(p_shop);
  v_target text;
begin
  select role into v_target from public.st_shop_members where shop_id = p_shop and user_id = p_user;
  if v_target is null then raise exception 'st_not_member'; end if;
  if v_target = 'owner' or p_user = auth.uid() then raise exception 'st_owner_locked'; end if;
  if p_role not in ('manager','cashier','kitchen','waiter') then raise exception 'st_bad_role'; end if;
  if not (v_my = 'owner'
          or (v_my = 'manager' and v_target <> 'manager' and p_role <> 'manager')) then
    raise exception 'st_forbidden';
  end if;
  update public.st_shop_members set role = p_role where shop_id = p_shop and user_id = p_user;
end
$$;

-- นำพนักงานออก หรือออกจากร้านเอง (เจ้าของออกเองไม่ได้)
create or replace function public.st_remove_member(p_shop uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my     text := public.st_my_role(p_shop);
  v_target text;
begin
  select role into v_target from public.st_shop_members where shop_id = p_shop and user_id = p_user;
  if v_target is null then raise exception 'st_not_member'; end if;
  if v_target = 'owner' then raise exception 'st_owner_locked'; end if;
  if not (p_user = auth.uid()
          or v_my = 'owner'
          or (v_my = 'manager' and v_target not in ('manager'))) then
    raise exception 'st_forbidden';
  end if;
  delete from public.st_shop_members where shop_id = p_shop and user_id = p_user;
end
$$;

-- ---------- 6) สิทธิ์เรียกฟังก์ชัน ----------
revoke all on function
  public.st_has_shop_role(uuid, text[]), public.st_my_role(uuid),
  public.st_slug_available(text), public.st_create_shop(text, text), public.st_my_shops(),
  public.st_list_members(uuid), public.st_invite_staff(uuid, text, text), public.st_revoke_invite(uuid),
  public.st_invite_info(text), public.st_accept_invite(text),
  public.st_set_member_role(uuid, uuid, text), public.st_remove_member(uuid, uuid)
from public, anon;

grant execute on function
  public.st_has_shop_role(uuid, text[]), public.st_my_role(uuid),
  public.st_slug_available(text), public.st_create_shop(text, text), public.st_my_shops(),
  public.st_list_members(uuid), public.st_invite_staff(uuid, text, text), public.st_revoke_invite(uuid),
  public.st_invite_info(text), public.st_accept_invite(text),
  public.st_set_member_role(uuid, uuid, text), public.st_remove_member(uuid, uuid)
to authenticated;

grant execute on function public.st_invite_info(text) to anon;   -- หน้าคำเชิญเปิดได้ก่อนล็อกอิน

-- ---------- 7) บันทึกว่ารันไฟล์นี้แล้ว ----------
insert into public.st_schema_log (id) values ('st-02-shops')
on conflict (id) do update set applied_at = now();
