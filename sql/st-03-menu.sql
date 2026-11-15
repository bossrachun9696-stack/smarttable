-- =====================================================================
-- SmartTable · st-03-menu.sql  (รันซ้ำได้ · ต้องรัน st-01, st-02 ก่อน)
-- หมวดหมู่, เมนู, ตัวเลือกเพิ่ม, ถังรูป st-images
--
-- * อ่าน: สมาชิกร้านทุกตำแหน่ง (ลูกค้าจะอ่านผ่าน RPC ของขั้นที่ 4–5)
-- * แก้: เจ้าของ / ผู้จัดการ ผ่าน RPC เท่านั้น
-- * กด "หมด / มี": พนักงานทุกตำแหน่ง
-- * รูปเก็บที่ st-images/shops/<shop_id>/menu/<ชื่อไฟล์>.jpg (อ่านได้สาธารณะ)
-- =====================================================================

-- ---------- 1) ตาราง ----------
create table if not exists public.st_categories (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.st_shops(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (id, shop_id)
);
create index if not exists st_categories_shop_idx on public.st_categories (shop_id, sort);

create table if not exists public.st_menu_items (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.st_shops(id) on delete cascade,
  category_id     uuid,
  name            text not null check (char_length(name) between 1 and 80),
  description     text check (description is null or char_length(description) <= 300),
  price           numeric(10,2) not null check (price between 0 and 100000),
  image_path      text,
  is_available    boolean not null default true,
  is_recommended  boolean not null default false,
  spicy_level     smallint not null default 0 check (spicy_level between 0 and 3),
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, shop_id),
  -- ลบหมวด -> เมนูยังอยู่ แต่ไม่มีหมวด
  foreign key (category_id, shop_id) references public.st_categories (id, shop_id) on delete set null (category_id)
);
create index if not exists st_menu_items_shop_idx on public.st_menu_items (shop_id, sort);

create table if not exists public.st_option_groups (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null,
  item_id     uuid not null,
  name        text not null check (char_length(name) between 1 and 60),
  min_select  smallint not null default 0 check (min_select >= 0),
  max_select  smallint not null default 1 check (max_select >= 1),
  sort        int not null default 0,
  unique (id, shop_id),
  check (min_select <= max_select),
  foreign key (item_id, shop_id) references public.st_menu_items (id, shop_id) on delete cascade
);
create index if not exists st_option_groups_item_idx on public.st_option_groups (item_id, sort);

create table if not exists public.st_option_choices (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null,
  group_id     uuid not null,
  name         text not null check (char_length(name) between 1 and 60),
  price_delta  numeric(10,2) not null default 0 check (price_delta between -100000 and 100000),
  sort         int not null default 0,
  foreign key (group_id, shop_id) references public.st_option_groups (id, shop_id) on delete cascade
);
create index if not exists st_option_choices_group_idx on public.st_option_choices (group_id, sort);

drop trigger if exists st_menu_items_touch on public.st_menu_items;
create trigger st_menu_items_touch
  before update on public.st_menu_items
  for each row execute function public.st_touch_updated_at();

-- ---------- 2) RLS: สมาชิกร้านอ่านได้ · เขียนผ่าน RPC เท่านั้น ----------
alter table public.st_categories     enable row level security;
alter table public.st_menu_items     enable row level security;
alter table public.st_option_groups  enable row level security;
alter table public.st_option_choices enable row level security;

drop policy if exists st_categories_select_member on public.st_categories;
create policy st_categories_select_member on public.st_categories
  for select to authenticated using (public.st_has_shop_role(shop_id));

drop policy if exists st_menu_items_select_member on public.st_menu_items;
create policy st_menu_items_select_member on public.st_menu_items
  for select to authenticated using (public.st_has_shop_role(shop_id));

drop policy if exists st_option_groups_select_member on public.st_option_groups;
create policy st_option_groups_select_member on public.st_option_groups
  for select to authenticated using (public.st_has_shop_role(shop_id));

drop policy if exists st_option_choices_select_member on public.st_option_choices;
create policy st_option_choices_select_member on public.st_option_choices
  for select to authenticated using (public.st_has_shop_role(shop_id));

revoke all on public.st_categories, public.st_menu_items, public.st_option_groups, public.st_option_choices
  from anon, authenticated;
grant select on public.st_categories, public.st_menu_items, public.st_option_groups, public.st_option_choices
  to authenticated;

-- ---------- 3) ถังรูป st-images ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('st-images', 'st-images', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ดึง shop_id จาก path 'shops/<shop_id>/...' (ผิดรูปแบบ = null)
create or replace function public.st_path_shop(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if split_part(p_name, '/', 1) <> 'shops' then return null; end if;
  return split_part(p_name, '/', 2)::uuid;
exception when others then
  return null;
end
$$;

drop policy if exists st_images_select_manager on storage.objects;
create policy st_images_select_manager on storage.objects
  for select to authenticated
  using (bucket_id = 'st-images'
         and public.st_has_shop_role(public.st_path_shop(name), array['owner','manager']));

drop policy if exists st_images_insert_manager on storage.objects;
create policy st_images_insert_manager on storage.objects
  for insert to authenticated
  with check (bucket_id = 'st-images'
              and public.st_has_shop_role(public.st_path_shop(name), array['owner','manager']));

drop policy if exists st_images_update_manager on storage.objects;
create policy st_images_update_manager on storage.objects
  for update to authenticated
  using (bucket_id = 'st-images'
         and public.st_has_shop_role(public.st_path_shop(name), array['owner','manager']));

drop policy if exists st_images_delete_manager on storage.objects;
create policy st_images_delete_manager on storage.objects
  for delete to authenticated
  using (bucket_id = 'st-images'
         and public.st_has_shop_role(public.st_path_shop(name), array['owner','manager']));

-- ---------- 4) RPC: อ่านเมนูทั้งหมดของร้าน (สำหรับหน้าจัดการ) ----------
create or replace function public.st_menu_admin(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop) then raise exception 'st_forbidden'; end if;
  return jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'sort', c.sort)
                       order by c.sort, c.created_at)
        from public.st_categories c where c.shop_id = p_shop), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id, 'category_id', i.category_id, 'name', i.name, 'description', i.description,
                 'price', i.price, 'image_path', i.image_path, 'is_available', i.is_available,
                 'is_recommended', i.is_recommended, 'spicy_level', i.spicy_level, 'sort', i.sort,
                 'options', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'id', g.id, 'name', g.name, 'min_select', g.min_select, 'max_select', g.max_select,
                              'choices', coalesce((
                                select jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name,
                                                                    'price_delta', ch.price_delta)
                                                 order by ch.sort)
                                  from public.st_option_choices ch where ch.group_id = g.id), '[]'::jsonb))
                            order by g.sort)
                     from public.st_option_groups g where g.item_id = i.id), '[]'::jsonb))
               order by i.sort, i.created_at)
        from public.st_menu_items i where i.shop_id = p_shop), '[]'::jsonb)
  );
end
$$;

-- ---------- 5) RPC: หมวดหมู่ ----------
create or replace function public.st_save_category(p_shop uuid, p_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(p_name);
  v_id   uuid := p_id;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if v_name is null or char_length(v_name) not between 1 and 60 then raise exception 'st_bad_name'; end if;

  if v_id is null then
    if (select count(*) from public.st_categories where shop_id = p_shop) >= 50 then
      raise exception 'st_category_limit';
    end if;
    insert into public.st_categories (shop_id, name, sort)
    values (p_shop, v_name,
            coalesce((select max(sort) from public.st_categories where shop_id = p_shop), 0) + 1)
    returning id into v_id;
  else
    update public.st_categories set name = v_name where id = v_id and shop_id = p_shop;
    if not found then raise exception 'st_not_found'; end if;
  end if;
  return v_id;
end
$$;

create or replace function public.st_delete_category(p_shop uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  delete from public.st_categories where id = p_id and shop_id = p_shop;
end
$$;

-- เรียงลำดับใหม่: p_kind = 'category' หรือ 'item', p_ids = id ตามลำดับที่ต้องการ
create or replace function public.st_reorder(p_shop uuid, p_kind text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if p_kind = 'category' then
    update public.st_categories c set sort = x.ord
      from unnest(p_ids) with ordinality as x(id, ord)
     where c.id = x.id and c.shop_id = p_shop;
  elsif p_kind = 'item' then
    update public.st_menu_items i set sort = x.ord
      from unnest(p_ids) with ordinality as x(id, ord)
     where i.id = x.id and i.shop_id = p_shop;
  else
    raise exception 'st_bad_request';
  end if;
end
$$;

-- ---------- 6) RPC: เมนู ----------
-- p_item = { id?, category_id?, name, description?, price, image_path?, is_recommended?, spicy_level?,
--            options: [ { name, min_select, max_select, choices: [ { name, price_delta } ] } ] }
-- ตัวเลือกถูกบันทึกใหม่ทั้งชุดทุกครั้ง (ออร์เดอร์จะเก็บชื่อ/ราคาไว้เอง ไม่กระทบออร์เดอร์เก่า)
create or replace function public.st_save_item(p_shop uuid, p_item jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid    := nullif(p_item ->> 'id', '')::uuid;
  v_cat    uuid    := nullif(p_item ->> 'category_id', '')::uuid;
  v_name   text    := trim(p_item ->> 'name');
  v_desc   text    := nullif(trim(coalesce(p_item ->> 'description', '')), '');
  v_price  numeric := (p_item ->> 'price')::numeric;
  v_img    text    := nullif(p_item ->> 'image_path', '');
  v_rec    boolean := coalesce((p_item ->> 'is_recommended')::boolean, false);
  v_spicy  int     := coalesce((p_item ->> 'spicy_level')::int, 0);
  v_opts   jsonb   := coalesce(p_item -> 'options', '[]'::jsonb);
  g        jsonb;
  c        jsonb;
  v_gid    uuid;
  v_gsort  int := 0;
  v_csort  int;
  v_n      int;
  v_min    int;
  v_max    int;
begin
  if not public.st_has_shop_role(p_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  if v_name is null or char_length(v_name) not between 1 and 80 then raise exception 'st_bad_item_name'; end if;
  if v_desc is not null and char_length(v_desc) > 300 then raise exception 'st_bad_description'; end if;
  if v_price is null or v_price < 0 or v_price > 100000 then raise exception 'st_bad_price'; end if;
  if v_spicy not between 0 and 3 then raise exception 'st_bad_request'; end if;
  if v_cat is not null and not exists (select 1 from public.st_categories where id = v_cat and shop_id = p_shop) then
    raise exception 'st_bad_category';
  end if;
  if v_img is not null and v_img not like 'shops/' || p_shop::text || '/%' then raise exception 'st_bad_image'; end if;
  if jsonb_typeof(v_opts) <> 'array' or jsonb_array_length(v_opts) > 10 then raise exception 'st_bad_options'; end if;

  if v_id is null then
    if (select count(*) from public.st_menu_items where shop_id = p_shop) >= 500 then
      raise exception 'st_item_limit';
    end if;
    insert into public.st_menu_items (shop_id, category_id, name, description, price, image_path,
                                      is_recommended, spicy_level, sort)
    values (p_shop, v_cat, v_name, v_desc, round(v_price, 2), v_img, v_rec, v_spicy,
            coalesce((select max(sort) from public.st_menu_items where shop_id = p_shop), 0) + 1)
    returning id into v_id;
  else
    update public.st_menu_items
       set category_id = v_cat, name = v_name, description = v_desc, price = round(v_price, 2),
           image_path = v_img, is_recommended = v_rec, spicy_level = v_spicy
     where id = v_id and shop_id = p_shop;
    if not found then raise exception 'st_not_found'; end if;
    delete from public.st_option_groups where item_id = v_id and shop_id = p_shop;
  end if;

  for g in select value from jsonb_array_elements(v_opts) loop
    v_gsort := v_gsort + 1;
    v_n   := case when jsonb_typeof(g -> 'choices') = 'array' then jsonb_array_length(g -> 'choices') else 0 end;
    v_min := coalesce((g ->> 'min_select')::int, 0);
    v_max := coalesce((g ->> 'max_select')::int, 1);
    if char_length(coalesce(trim(g ->> 'name'), '')) not between 1 and 60
       or v_n not between 1 and 20
       or v_min < 0 or v_max < 1 or v_min > v_max or v_max > v_n then
      raise exception 'st_bad_options';
    end if;

    insert into public.st_option_groups (shop_id, item_id, name, min_select, max_select, sort)
    values (p_shop, v_id, trim(g ->> 'name'), v_min, v_max, v_gsort)
    returning id into v_gid;

    v_csort := 0;
    for c in select value from jsonb_array_elements(g -> 'choices') loop
      v_csort := v_csort + 1;
      if char_length(coalesce(trim(c ->> 'name'), '')) not between 1 and 60
         or abs(coalesce((c ->> 'price_delta')::numeric, 0)) > 100000 then
        raise exception 'st_bad_options';
      end if;
      insert into public.st_option_choices (shop_id, group_id, name, price_delta, sort)
      values (p_shop, v_gid, trim(c ->> 'name'), round(coalesce((c ->> 'price_delta')::numeric, 0), 2), v_csort);
    end loop;
  end loop;

  return v_id;
end
$$;

-- ลบเมนู · คืน image_path เดิมให้หน้าเว็บลบไฟล์รูปต่อ
create or replace function public.st_delete_item(p_item uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  v_img  text;
begin
  select shop_id, image_path into v_shop, v_img from public.st_menu_items where id = p_item;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop, array['owner','manager']) then raise exception 'st_forbidden'; end if;
  delete from public.st_menu_items where id = p_item;
  return v_img;
end
$$;

-- กด "หมด / มี" · พนักงานทุกตำแหน่งทำได้
create or replace function public.st_set_item_available(p_item uuid, p_available boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from public.st_menu_items where id = p_item;
  if v_shop is null then raise exception 'st_not_found'; end if;
  if not public.st_has_shop_role(v_shop) then raise exception 'st_forbidden'; end if;
  update public.st_menu_items set is_available = coalesce(p_available, true) where id = p_item;
end
$$;

-- ---------- 7) สิทธิ์เรียกฟังก์ชัน ----------
revoke all on function
  public.st_path_shop(text), public.st_menu_admin(uuid),
  public.st_save_category(uuid, uuid, text), public.st_delete_category(uuid, uuid),
  public.st_reorder(uuid, text, uuid[]), public.st_save_item(uuid, jsonb),
  public.st_delete_item(uuid), public.st_set_item_available(uuid, boolean)
from public, anon;

grant execute on function
  public.st_path_shop(text), public.st_menu_admin(uuid),
  public.st_save_category(uuid, uuid, text), public.st_delete_category(uuid, uuid),
  public.st_reorder(uuid, text, uuid[]), public.st_save_item(uuid, jsonb),
  public.st_delete_item(uuid), public.st_set_item_available(uuid, boolean)
to authenticated;

-- ---------- 8) บันทึกว่ารันไฟล์นี้แล้ว ----------
insert into public.st_schema_log (id) values ('st-03-menu')
on conflict (id) do update set applied_at = now();
