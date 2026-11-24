-- =====================================================================
-- 🛡️ DarkChat แอดมิน: ใครซื้ออะไร + ยกเลิกส่วนขยาย/แพ็กเกจ (แจ้งล่วงหน้า 7 วัน หรือทันที)
--   รันซ้ำได้ ไม่ลบข้อมูลเดิม · ใช้ได้เฉพาะแอดมิน (app_admins)
-- =====================================================================

create table if not exists public.ext_revocations (
  id          uuid primary key default gen_random_uuid(),
  target      text not null check (target in ('ext_user', 'ext_family', 'pkg_user', 'pkg_family', 'family_member')),
  user_id     uuid,                      -- เจ้าของสิทธิ์ (รายคน) / คนที่จะถูกเอาออกจากครอบครัว
  family_id   uuid,                      -- dc_families (สิทธิ์ครอบครัว)
  ext_id      uuid,
  product     text,
  reason      text not null default '' check (length(reason) <= 300),
  notify_all  boolean not null default false,   -- ครอบครัว: แจ้งทุกคน (false = แจ้งเฉพาะเจ้าของครอบครัว)
  due_at      timestamptz not null,
  status      text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  reminded    boolean not null default false,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  finished_at timestamptz,
  finished_by uuid
);
create index if not exists ext_revocations_pending on public.ext_revocations (due_at) where status = 'pending';
create unique index if not exists ext_revocations_one_pending on public.ext_revocations
  (target, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(family_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(ext_id::text, product, '')) where status = 'pending';
alter table public.ext_revocations enable row level security;   -- ไม่มี policy: ใช้ผ่านฟังก์ชันแอดมินเท่านั้น

-- ---------- ภายใน ----------
create or replace function public.ext_adm_need()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_app_admin(auth.uid()) then raise exception 'forbidden'; end if;
  return auth.uid();
end $$;
revoke all on function public.ext_adm_need() from public, anon, authenticated;

create or replace function public.ext_adm_th(t timestamptz)
returns text language sql stable as $$
  select to_char(t at time zone 'Asia/Bangkok', 'DD/MM/') || (extract(year from t at time zone 'Asia/Bangkok')::int + 543)
         || ' ' || to_char(t at time zone 'Asia/Bangkok', 'HH24:MI') || ' น.'
$$;

create or replace function public.ext_adm_item(r public.ext_revocations)
returns text language sql stable security definer set search_path = public as $$
  select case
    when r.target in ('ext_user', 'ext_family') then 'ส่วนขยาย "' || coalesce((select name from public.extensions where id = r.ext_id), '?') || '"'
      || case when r.target = 'ext_family' then ' (แบบครอบครัว)' else '' end
    when r.target in ('pkg_user', 'pkg_family') then 'แพ็กเกจ "' || public._product_name(r.product) || '"'
      || case when r.target = 'pkg_family' then ' (แบบครอบครัว)' else '' end
    else 'สิทธิ์ใช้งานร่วมในครอบครัว "' || coalesce((select name from public.dc_families where id = r.family_id), '?') || '"'
  end
$$;
revoke all on function public.ext_adm_item(public.ext_revocations) from public, anon, authenticated;

-- ส่งข้อความจากแอดมินเข้าแชทส่วนตัว (ชนิด text → มีแจ้งเตือนเด้ง)
create or replace function public.ext_adm_notify(r public.ext_revocations, p_text text)
returns int language plpgsql security definer set search_path = public as $$
declare who uuid; n int := 0;
begin
  for who in
    select distinct u from (
      select r.user_id as u where r.target in ('ext_user', 'pkg_user', 'family_member')
      union all select f.owner_id from public.dc_families f where f.id = r.family_id and r.target in ('ext_family', 'pkg_family')
      union all select m.user_id from public.dc_family_members m where m.family_id = r.family_id and r.target in ('ext_family', 'pkg_family') and r.notify_all
    ) x where u is not null and u <> r.created_by
  loop
    begin
      insert into public.messages (sender_id, receiver_id, text, kind) values (r.created_by, who, left(p_text, 1000), 'text');
      n := n + 1;
    exception when others then null;   -- ส่งไม่ได้ (เช่นบล็อกกัน) ไม่ให้การยกเลิกล้ม
    end;
  end loop;
  return n;
end $$;
revoke all on function public.ext_adm_notify(public.ext_revocations, text) from public, anon, authenticated;

-- ยกเลิกจริง
create or replace function public.ext_adm_apply(r public.ext_revocations)
returns void language plpgsql security definer set search_path = public as $$
begin
  if r.target = 'ext_user' then
    update public.ext_licenses set expires_at = now() where user_id = r.user_id and ext_id = r.ext_id and (expires_at is null or expires_at > now());
  elsif r.target = 'ext_family' then
    delete from public.ext_family_licenses where family_id = r.family_id and ext_id = r.ext_id;
  elsif r.target = 'pkg_user' then
    delete from public.entitlements where user_id = r.user_id and product = r.product;
    insert into public.entitlement_log (user_id, product, action, by_admin) values (r.user_id, r.product, 'revoke', r.created_by);
  elsif r.target = 'pkg_family' then
    delete from public.family_grants where family_id = r.family_id and product = r.product;
  elsif r.target = 'family_member' then
    if exists (select 1 from public.dc_families where id = r.family_id and owner_id = r.user_id) then raise exception 'owner_cannot_be_removed'; end if;
    delete from public.dc_family_members where family_id = r.family_id and user_id = r.user_id;
  end if;
end $$;
revoke all on function public.ext_adm_apply(public.ext_revocations) from public, anon, authenticated;

-- ---------- 1) รายการสิทธิ์ทั้งหมด ----------
create or replace function public.ext_admin_rights()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  perform public.ext_adm_need();
  with p as (
    select pr.id, coalesce(nullif(pr.nickname, ''), nullif(pr.username, ''), 'ผู้ใช้') as name, pr.username, pr.avatar, u.email
      from public.profiles pr left join auth.users u on u.id = pr.id
  ), fam as (
    select f.id, f.name, f.owner_id,
           (select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', coalesce(p.name, '?'), 'avatar', p.avatar) order by m.joined_at)
              from public.dc_family_members m left join p on p.id = m.user_id where m.family_id = f.id) as members
      from public.dc_families f
  ), rev as (
    select * from public.ext_revocations where status = 'pending'
  ), rows as (
    -- ส่วนขยายรายคน
    select jsonb_build_object('target', 'ext_user', 'user_id', l.user_id, 'ext_id', l.ext_id,
             'item', e.name, 'icon', e.icon, 'kind', l.kind, 'started_at', l.started_at, 'expires_at', l.expires_at,
             'active', (l.expires_at is null or l.expires_at > now()),
             'price', (select x.price from public.ext_purchases x where x.user_id = l.user_id and x.ext_id = l.ext_id and x.status = 'approved' and x.scope = 'single' order by x.decided_at desc nulls last limit 1),
             'who', jsonb_build_object('id', p.id, 'name', p.name, 'username', p.username, 'avatar', p.avatar, 'email', p.email),
             'pending', (select jsonb_build_object('id', v.id, 'due_at', v.due_at, 'reason', v.reason) from rev v where v.target = 'ext_user' and v.user_id = l.user_id and v.ext_id = l.ext_id)) as j,
           coalesce(l.started_at, now()) as t
      from public.ext_licenses l join public.extensions e on e.id = l.ext_id left join p on p.id = l.user_id
    union all
    -- ส่วนขยายครอบครัว
    select jsonb_build_object('target', 'ext_family', 'family_id', fl.family_id, 'ext_id', fl.ext_id, 'user_id', f.owner_id,
             'item', e.name, 'icon', e.icon, 'kind', 'family', 'started_at', fl.started_at, 'expires_at', null, 'active', true,
             'price', (select x.price from public.ext_purchases x where x.family_id = fl.family_id and x.ext_id = fl.ext_id and x.status = 'approved' order by x.decided_at desc nulls last limit 1),
             'family', jsonb_build_object('id', f.id, 'name', f.name, 'members', coalesce(f.members, '[]'::jsonb)),
             'who', jsonb_build_object('id', p.id, 'name', p.name, 'username', p.username, 'avatar', p.avatar, 'email', p.email),
             'pending', (select jsonb_build_object('id', v.id, 'due_at', v.due_at, 'reason', v.reason) from rev v where v.target = 'ext_family' and v.family_id = fl.family_id and v.ext_id = fl.ext_id)),
           fl.started_at
      from public.ext_family_licenses fl join public.extensions e on e.id = fl.ext_id join fam f on f.id = fl.family_id left join p on p.id = f.owner_id
    union all
    -- แพ็กเกจรายคน
    select jsonb_build_object('target', 'pkg_user', 'user_id', en.user_id, 'product', en.product,
             'item', public._product_name(en.product), 'icon', case en.product when 'ai' then '🤖' when 'stream' then '📺' else '📦' end,
             'kind', case when en.lifetime then 'lifetime' else 'monthly' end, 'started_at', null, 'expires_at', en.expires_at,
             'active', (en.lifetime or en.expires_at > now()),
             'price', (select x.price from public.purchase_requests x where x.user_id = en.user_id and x.product = en.product and x.status = 'granted' and x.scope = 'single' order by x.updated_at desc nulls last limit 1),
             'who', jsonb_build_object('id', p.id, 'name', p.name, 'username', p.username, 'avatar', p.avatar, 'email', p.email),
             'pending', (select jsonb_build_object('id', v.id, 'due_at', v.due_at, 'reason', v.reason) from rev v where v.target = 'pkg_user' and v.user_id = en.user_id and v.product = en.product)),
           coalesce(en.updated_at, now())
      from public.entitlements en left join p on p.id = en.user_id
    union all
    -- แพ็กเกจครอบครัว
    select jsonb_build_object('target', 'pkg_family', 'family_id', g.family_id, 'product', g.product, 'user_id', f.owner_id,
             'item', public._product_name(g.product), 'icon', case g.product when 'ai' then '🤖' when 'stream' then '📺' else '📦' end,
             'kind', case when g.lifetime then 'lifetime' else 'monthly' end, 'started_at', null, 'expires_at', g.expires_at,
             'active', (g.lifetime or g.expires_at > now()),
             'price', (select x.price from public.purchase_requests x where x.family_id = g.family_id and x.product = g.product and x.status = 'granted' order by x.updated_at desc nulls last limit 1),
             'family', jsonb_build_object('id', f.id, 'name', f.name, 'members', coalesce(f.members, '[]'::jsonb)),
             'who', jsonb_build_object('id', p.id, 'name', p.name, 'username', p.username, 'avatar', p.avatar, 'email', p.email),
             'pending', (select jsonb_build_object('id', v.id, 'due_at', v.due_at, 'reason', v.reason) from rev v where v.target = 'pkg_family' and v.family_id = g.family_id and v.product = g.product)),
           g.updated_at
      from public.family_grants g join fam f on f.id = g.family_id left join p on p.id = f.owner_id
  )
  select coalesce(jsonb_agg(j order by t desc), '[]'::jsonb) into out from rows;
  return jsonb_build_object('rights', out,
    'pending_members', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'family_id', v.family_id, 'user_id', v.user_id, 'due_at', v.due_at, 'reason', v.reason)), '[]'::jsonb)
                          from public.ext_revocations v where v.status = 'pending' and v.target = 'family_member'));
end $$;
revoke all on function public.ext_admin_rights() from public, anon;
grant execute on function public.ext_admin_rights() to authenticated;

-- ---------- 2) ประวัติการซื้อ + ยอดขายรายเดือน ----------
create or replace function public.ext_admin_sales(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare hist jsonb; months jsonb;
begin
  perform public.ext_adm_need();
  with h as (
    select x.id, 'ext' as src, x.user_id, e.name as item, e.icon, x.scope, x.price, x.status, x.created_at, x.decided_at as done_at
      from public.ext_purchases x join public.extensions e on e.id = x.ext_id
    union all
    select r.id, 'pkg', r.user_id, public._product_name(r.product), case r.product when 'ai' then '🤖' when 'stream' then '📺' else '📦' end,
           r.scope || '/' || r.plan, r.price, r.status, r.created_at, r.handled_at
      from public.purchase_requests r
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'src', h.src, 'item', h.item, 'icon', h.icon, 'scope', h.scope, 'price', h.price,
           'status', h.status, 'created_at', h.created_at, 'done_at', h.done_at,
           'who', jsonb_build_object('id', h.user_id, 'name', coalesce(nullif(pr.nickname, ''), nullif(pr.username, ''), 'ผู้ใช้'),
                                     'username', pr.username, 'avatar', pr.avatar, 'email', u.email))
           order by h.created_at desc), '[]'::jsonb) into hist
    from (select * from h order by created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) h
    left join public.profiles pr on pr.id = h.user_id left join auth.users u on u.id = h.user_id;
  select coalesce(jsonb_agg(jsonb_build_object('month', m, 'total', tot, 'count', cnt) order by m desc), '[]'::jsonb) into months
    from (select to_char(coalesce(done_at, created_at) at time zone 'Asia/Bangkok', 'YYYY-MM') as m, sum(price) as tot, count(*) as cnt
            from (select x.price, x.decided_at as done_at, x.created_at from public.ext_purchases x where x.status = 'approved'
                  union all select r.price, r.handled_at, r.created_at from public.purchase_requests r where r.status = 'granted') s
           group by 1 order by 1 desc limit 24) q;
  return jsonb_build_object('history', hist, 'months', months);
end $$;
revoke all on function public.ext_admin_sales(int) from public, anon;
grant execute on function public.ext_admin_sales(int) to authenticated;

-- ---------- 3) สั่งยกเลิก (p_days = 0 → ทันที · 1–30 → แจ้งล่วงหน้า) ----------
create or replace function public.ext_admin_revoke(p_target text, p_user uuid, p_family uuid, p_ext uuid, p_product text,
                                                   p_reason text default '', p_days int default 7, p_notify_all boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.ext_adm_need(); r public.ext_revocations; n int; t text; reason text := left(trim(coalesce(p_reason, '')), 300);
begin
  if p_target not in ('ext_user', 'ext_family', 'pkg_user', 'pkg_family', 'family_member') then raise exception 'bad_target'; end if;
  if p_days is null or p_days < 0 or p_days > 30 then raise exception 'bad_days'; end if;
  if p_target in ('ext_user', 'pkg_user', 'family_member') and p_user is null then raise exception 'need_user'; end if;
  if p_target in ('ext_family', 'pkg_family', 'family_member') and p_family is null then raise exception 'need_family'; end if;
  if p_target in ('ext_user', 'ext_family') and p_ext is null then raise exception 'need_ext'; end if;
  if p_target in ('pkg_user', 'pkg_family') and coalesce(p_product, '') = '' then raise exception 'need_product'; end if;
  if p_target = 'family_member' and exists (select 1 from public.dc_families where id = p_family and owner_id = p_user) then raise exception 'owner_cannot_be_removed'; end if;
  -- มีคำสั่งค้างอยู่แล้ว → แทนที่ด้วยคำสั่งใหม่
  update public.ext_revocations set status = 'cancelled', finished_at = now(), finished_by = me
   where status = 'pending' and target = p_target and user_id is not distinct from (case when p_target in ('ext_family', 'pkg_family') then null else p_user end)
     and family_id is not distinct from (case when p_target in ('ext_user', 'pkg_user') then null else p_family end)
     and ext_id is not distinct from p_ext and product is not distinct from (case when p_target in ('pkg_user', 'pkg_family') then p_product end);
  insert into public.ext_revocations (target, user_id, family_id, ext_id, product, reason, notify_all, due_at, created_by, status, finished_at, finished_by)
  values (p_target, case when p_target in ('ext_family', 'pkg_family') then null else p_user end,
          case when p_target in ('ext_user', 'pkg_user') then null else p_family end,
          case when p_target in ('ext_user', 'ext_family') then p_ext end,
          case when p_target in ('pkg_user', 'pkg_family') then p_product end,
          reason, coalesce(p_notify_all, false), now() + make_interval(days => p_days), me,
          case when p_days = 0 then 'done' else 'pending' end,
          case when p_days = 0 then now() end, case when p_days = 0 then me end)
  returning * into r;
  if p_days = 0 then
    perform public.ext_adm_apply(r);
    t := '⛔ แจ้งจากแอดมิน: ' || public.ext_adm_item(r) || ' ของคุณถูกยกเลิกแล้ว'
         || case when reason <> '' then E'\nเหตุผล: ' || reason else '' end
         || E'\nหากมีข้อสงสัย ตอบกลับในแชทนี้ได้เลยครับ';
  else
    t := '⚠️ แจ้งจากแอดมิน: ' || public.ext_adm_item(r) || ' ของคุณจะถูกยกเลิกในวันที่ ' || public.ext_adm_th(r.due_at)
         || ' (อีก ' || p_days || ' วัน)'
         || case when reason <> '' then E'\nเหตุผล: ' || reason else '' end
         || E'\nกรุณาติดต่อแอดมินในแชทนี้ก่อนวันดังกล่าว ระหว่างนี้ยังใช้งานได้ตามปกติครับ';
  end if;
  n := public.ext_adm_notify(r, t);
  return jsonb_build_object('ok', true, 'id', r.id, 'status', r.status, 'due_at', r.due_at, 'notified', n);
end $$;
revoke all on function public.ext_admin_revoke(text, uuid, uuid, uuid, text, text, int, boolean) from public, anon;
grant execute on function public.ext_admin_revoke(text, uuid, uuid, uuid, text, text, int, boolean) to authenticated;

-- ---------- 4) ยกเลิกคำสั่งยกเลิก (คงสิทธิ์ไว้) ----------
create or replace function public.ext_admin_revoke_cancel(p_id uuid, p_notify boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.ext_adm_need(); r public.ext_revocations; n int := 0;
begin
  update public.ext_revocations set status = 'cancelled', finished_at = now(), finished_by = me
   where id = p_id and status = 'pending' returning * into r;
  if r.id is null then raise exception 'not_found'; end if;
  if coalesce(p_notify, true) then
    n := public.ext_adm_notify(r, '✅ แจ้งจากแอดมิน: ' || public.ext_adm_item(r) || ' ของคุณไม่ถูกยกเลิกแล้ว ใช้งานต่อได้ตามปกติ ขอบคุณครับ');
  end if;
  return jsonb_build_object('ok', true, 'notified', n);
end $$;
revoke all on function public.ext_admin_revoke_cancel(uuid, boolean) from public, anon;
grant execute on function public.ext_admin_revoke_cancel(uuid, boolean) to authenticated;

-- ---------- 5) ประวัติการยกเลิก ----------
create or replace function public.ext_admin_revocations(p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ext_adm_need();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'target', v.target, 'item', public.ext_adm_item(v), 'reason', v.reason,
            'status', v.status, 'due_at', v.due_at, 'created_at', v.created_at, 'finished_at', v.finished_at,
            'who', coalesce(nullif(pr.nickname, ''), nullif(pr.username, ''), (select f.name from public.dc_families f where f.id = v.family_id), '?'))
            order by v.created_at desc), '[]'::jsonb)
          from (select * from public.ext_revocations order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) v
          left join public.profiles pr on pr.id = coalesce(v.user_id, (select f.owner_id from public.dc_families f where f.id = v.family_id)));
end $$;
revoke all on function public.ext_admin_revocations(int) from public, anon;
grant execute on function public.ext_admin_revocations(int) to authenticated;

-- ---------- 6) ตัวจับเวลา: เตือน 1 วันก่อน + ยกเลิกเมื่อครบกำหนด ----------
create or replace function public.ext_revocation_tick()
returns int language plpgsql security definer set search_path = public as $$
declare r public.ext_revocations; n int := 0;
begin
  for r in select * from public.ext_revocations where status = 'pending' and not reminded
             and due_at - interval '1 day' <= now() and due_at > now() for update skip locked loop
    update public.ext_revocations set reminded = true where id = r.id;
    perform public.ext_adm_notify(r, '⏰ เตือนจากแอดมิน: ' || public.ext_adm_item(r) || ' ของคุณจะถูกยกเลิกในวันที่ '
      || public.ext_adm_th(r.due_at) || E'\nหากต้องการใช้งานต่อ กรุณาติดต่อแอดมินในแชทนี้ครับ');
  end loop;
  for r in select * from public.ext_revocations where status = 'pending' and due_at <= now() for update skip locked loop
    begin
      perform public.ext_adm_apply(r);
      update public.ext_revocations set status = 'done', finished_at = now() where id = r.id;
      perform public.ext_adm_notify(r, '⛔ แจ้งจากแอดมิน: ' || public.ext_adm_item(r) || ' ของคุณถูกยกเลิกแล้วตามที่แจ้งไว้'
        || case when r.reason <> '' then E'\nเหตุผล: ' || r.reason else '' end || E'\nหากมีข้อสงสัย ตอบกลับในแชทนี้ได้เลยครับ');
      n := n + 1;
    exception when others then
      update public.ext_revocations set status = 'cancelled', finished_at = now(), reason = left(r.reason || ' [ยกเลิกไม่สำเร็จ: ' || sqlerrm || ']', 300) where id = r.id;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.ext_revocation_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ext_revocation_tick';
    perform cron.schedule('ext_revocation_tick', '*/10 * * * *', 'select public.ext_revocation_tick()');
  end if;
end $$;
