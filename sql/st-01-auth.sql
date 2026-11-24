-- =====================================================================
-- SmartTable · st-01-auth.sql  (รันซ้ำได้ทุกครั้ง)
-- ระบบโปรไฟล์ผู้ใช้สำหรับล็อกอิน
--
-- กติกาที่ไฟล์นี้ทำตาม:
--   * ทุกชื่อขึ้นต้นด้วย st_  (ไม่ชนกับรายชื่อใน darkchat-reserved-names.md)
--   * ไม่สร้างตาราง profiles, ไม่แตะ handle_new_user, ไม่สร้าง trigger บน auth.users
--     -> แถวใน st_profiles ถูกสร้างตอนผู้ใช้ล็อกอินครั้งแรก ผ่าน RPC st_ensure_profile()
--   * เปิด RLS ทุกตาราง
-- =====================================================================

-- ---------- 0) บันทึกว่าไฟล์ไหนรันแล้ว (ใช้ตรวจตอนย้ายโปรเจกต์) ----------
create table if not exists public.st_schema_log (
  id          text primary key,              -- ชื่อไฟล์ เช่น 'st-01-auth'
  applied_at  timestamptz not null default now()
);
alter table public.st_schema_log enable row level security;
revoke all on public.st_schema_log from anon, authenticated;   -- ไม่มี policy = อ่านผ่านแอปไม่ได้

-- ---------- 1) ตารางโปรไฟล์ ----------
create table if not exists public.st_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  email          text not null,                -- ใช้จับคู่ผู้ใช้ตอนย้ายไป DarkChat Project
  display_name   text check (display_name is null or char_length(display_name) <= 60),
  phone          text check (phone is null or char_length(phone) <= 20),
  avatar_url     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_login_at  timestamptz
);

-- เผื่ออนาคตเพิ่มคอลัมน์: ใช้ add column if not exists แบบนี้
alter table public.st_profiles add column if not exists last_login_at timestamptz;

create unique index if not exists st_profiles_email_key on public.st_profiles (lower(email));

-- ---------- 2) อัปเดต updated_at อัตโนมัติ ----------
create or replace function public.st_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists st_profiles_touch on public.st_profiles;
create trigger st_profiles_touch
  before update on public.st_profiles
  for each row execute function public.st_touch_updated_at();

-- ---------- 3) RLS ----------
alter table public.st_profiles enable row level security;

drop policy if exists st_profiles_select_own on public.st_profiles;
create policy st_profiles_select_own on public.st_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists st_profiles_update_own on public.st_profiles;
create policy st_profiles_update_own on public.st_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- ไม่มี policy insert/delete: สร้างผ่าน RPC เท่านั้น, ลบตามบัญชีอัตโนมัติ (on delete cascade)

-- สิทธิ์ระดับคอลัมน์: ผู้ใช้แก้ได้แค่ชื่อ เบอร์ รูป (แก้ email / user_id เองไม่ได้)
revoke all on public.st_profiles from anon, authenticated;
grant select on public.st_profiles to authenticated;
grant update (display_name, phone, avatar_url) on public.st_profiles to authenticated;

-- ---------- 4) RPC: สร้าง/อัปเดตโปรไฟล์ของตัวเอง (เรียกทุกครั้งที่ล็อกอิน) ----------
create or replace function public.st_ensure_profile(p_display_name text default null)
returns public.st_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_name  text;
  v_row   public.st_profiles;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select u.email,
         nullif(trim(coalesce(p_display_name, u.raw_user_meta_data ->> 'display_name')), '')
    into v_email, v_name
    from auth.users u
   where u.id = v_uid;

  insert into public.st_profiles (user_id, email, display_name, last_login_at)
  values (v_uid, lower(coalesce(v_email, '')), left(v_name, 60), now())
  on conflict (user_id) do update
     set email         = excluded.email,                                   -- ตามอีเมลล่าสุดของบัญชี
         display_name  = coalesce(public.st_profiles.display_name, excluded.display_name),
         last_login_at = now()
  returning * into v_row;

  return v_row;
end
$$;

revoke all on function public.st_ensure_profile(text) from public, anon;
grant execute on function public.st_ensure_profile(text) to authenticated;

revoke all on function public.st_touch_updated_at() from public, anon, authenticated;

-- ---------- 5) บันทึกว่ารันไฟล์นี้แล้ว ----------
insert into public.st_schema_log (id) values ('st-01-auth')
on conflict (id) do update set applied_at = now();
