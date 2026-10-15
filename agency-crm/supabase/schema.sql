-- =====================================================================
--  Agency CRM — Supabase schema
--  شغّل الملف ده كله مرة واحدة من: Supabase > SQL Editor > New query > Run
--  (الملف آمن لو اتشغّل أكتر من مرة)
-- =====================================================================

-- pg_cron: بيشغّل التوزيع التلقائي وتذكير المتابعات كل دقيقة
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------
-- 1) Helpers
-- ---------------------------------------------------------------------

-- توحيد أرقام الموبايل (مصر + السعودية) عشان نمنع التكرار
create or replace function public.normalize_phone(p text)
returns text language plpgsql immutable as $$
declare d text;
begin
  if p is null then return null; end if;
  d := translate(p, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  d := regexp_replace(d, '\D', '', 'g');
  if d = '' then return null; end if;
  if left(d, 2) = '00' then d := substr(d, 3); end if;
  if length(d) = 11 and left(d, 2) = '01' then d := '20' || substr(d, 2);       -- 010xxxxxxxx  -> 2010xxxxxxxx
  elsif length(d) = 10 and left(d, 1) = '1' then d := '20' || d;                -- 10xxxxxxxx   -> 2010xxxxxxxx
  elsif length(d) = 10 and left(d, 2) = '05' then d := '966' || substr(d, 2);   -- 05xxxxxxxx   -> 9665xxxxxxxx
  elsif length(d) = 9 and left(d, 1) = '5' then d := '966' || d;                -- 5xxxxxxxx    -> 9665xxxxxxxx
  end if;
  return d;
end $$;

-- ---------------------------------------------------------------------
-- 2) Tables
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  role text not null default 'sales' check (role in ('admin','manager','sales')),
  is_active boolean not null default true,
  receives_auto_leads boolean not null default true,
  daily_cap int check (daily_cap is null or daily_cap >= 0),
  can_import boolean not null default false,
  can_export boolean not null default false,
  can_assign boolean not null default false,
  can_delete boolean not null default false,
  can_view_all boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  total_rows int not null default 0,
  inserted int not null default 0,
  duplicates int not null default 0,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  phone_normalized text generated always as (public.normalize_phone(phone)) stored,
  email text,
  company text,
  job_title text,
  service text,
  budget text,
  source text,
  campaign text,
  city text,
  status text not null default 'new',
  lost_reason text,
  deal_value numeric(14,2),
  extra jsonb not null default '{}'::jsonb,
  in_pool boolean not null default true,          -- في انتظار التوزيع التلقائي
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  first_contact_at timestamptz,
  last_activity_at timestamptz not null default now(),
  next_followup_at timestamptz,
  won_at timestamptz,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists leads_phone_unique on public.leads(phone_normalized);
create index if not exists leads_assigned_idx on public.leads(assigned_to, status);
create index if not exists leads_pool_idx on public.leads(created_at) where assigned_to is null and in_pool;
create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_created_idx on public.leads(created_at desc);
create index if not exists leads_followup_idx on public.leads(next_followup_at);
create index if not exists leads_assigned_at_idx on public.leads(assigned_at);

create table if not exists public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists lead_notes_lead_idx on public.lead_notes(lead_id, created_at desc);

create table if not exists public.followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  due_at timestamptz not null,
  type text not null default 'call',
  note text,
  done boolean not null default false,
  done_at timestamptz,
  notified boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists followups_user_idx on public.followups(user_id, done, due_at);
create index if not exists followups_lead_idx on public.followups(lead_id);
create index if not exists followups_due_idx on public.followups(due_at) where not done and not notified;

create table if not exists public.lead_activities (
  id bigserial primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists lead_activities_lead_idx on public.lead_activities(lead_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'info',
  title text not null,
  body text,
  lead_id uuid references public.leads(id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

create table if not exists public.distribution_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  interval_minutes int not null default 30 check (interval_minutes >= 1),
  batch_size int not null default 5 check (batch_size >= 1),
  pick_order text not null default 'newest' check (pick_order in ('newest','oldest')),
  work_days int[] not null default '{0,1,2,3,4,6}',     -- 0=الأحد ... 6=السبت
  work_start time not null default '10:00',
  work_end time not null default '18:00',
  timezone text not null default 'Africa/Cairo',
  show_countdown boolean not null default true,
  recycle_enabled boolean not null default false,
  recycle_after_minutes int not null default 120 check (recycle_after_minutes >= 5),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_count int not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.distribution_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.distribution_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  total int not null default 0,
  recycled int not null default 0,
  forced boolean not null default false,
  by_user uuid
);

-- ---------------------------------------------------------------------
-- 3) Permissions
--   admin   : كل حاجة
--   manager : يشوف ويعدل كل الليدز + التوزيع + التقارير (والباقي بالصلاحيات)
--   sales   : ليدزه بس (والباقي بالصلاحيات)
-- ---------------------------------------------------------------------
create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when not pr.is_active then false
      when pr.role = 'admin' then true
      when p = 'view_all' then pr.role = 'manager' or pr.can_view_all
      when p in ('edit_all','manage_distribution','reports') then pr.role = 'manager'
      when p = 'import' then pr.can_import
      when p = 'export' then pr.can_export
      when p = 'assign' then pr.can_assign
      when p = 'delete' then pr.can_delete
      else false
    end
    from public.profiles pr where pr.id = auth.uid()
  ), false);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' and is_active from public.profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------
-- 4) Triggers
-- ---------------------------------------------------------------------

-- إنشاء بروفايل تلقائي لكل يوزر. أول يوزر = أدمن
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_first boolean;
begin
  select not exists (select 1 from public.profiles) into v_first;
  insert into public.profiles (id, email, full_name, role, is_active, receives_auto_leads,
                               can_import, can_export, can_assign, can_delete, can_view_all)
  values (
    new.id, new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    case when v_first then 'admin' else 'sales' end,
    v_first or coalesce((new.raw_app_meta_data->>'created_by_admin')::boolean, false),
    not v_first,
    v_first, v_first, v_first, v_first, v_first
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- leads: قبل الإضافة
create or replace function public.leads_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  if new.assigned_to is not null then
    if auth.uid() is not null and new.assigned_to <> auth.uid()
       and not (public.has_perm('assign') or public.has_perm('manage_distribution')) then
      raise exception 'ليس لديك صلاحية تحويل الليدز';
    end if;
    new.assigned_at := now();
    new.in_pool := false;
  end if;
  if new.status = 'won' then new.won_at := coalesce(new.won_at, now()); end if;
  return new;
end $$;
drop trigger if exists leads_before_insert on public.leads;
create trigger leads_before_insert before insert on public.leads
  for each row execute function public.leads_before_insert();

-- leads: قبل التعديل
create or replace function public.leads_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is distinct from old.assigned_to then
    if auth.uid() is not null
       and not (public.has_perm('assign') or public.has_perm('manage_distribution')) then
      raise exception 'ليس لديك صلاحية تحويل الليدز';
    end if;
    if new.assigned_to is null then
      new.assigned_at := null;
    else
      new.assigned_at := now();
      new.in_pool := false;
    end if;
  end if;
  if new.status is distinct from old.status then
    if old.status = 'new' and new.first_contact_at is null then new.first_contact_at := now(); end if;
    if new.status = 'won' then new.won_at := coalesce(new.won_at, now());
    elsif old.status = 'won' then new.won_at := null; end if;
    new.last_activity_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists leads_before_update on public.leads;
create trigger leads_before_update before update on public.leads
  for each row execute function public.leads_before_update();

-- leads: بعد الإضافة/التعديل (سجل النشاط + نقل المتابعات للمسؤول الجديد)
create or replace function public.leads_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.assigned_to is not null then
      insert into public.lead_activities (lead_id, user_id, type, data)
      values (new.id, auth.uid(), 'assigned', jsonb_build_object('to', new.assigned_to));
    end if;
  else
    if new.status is distinct from old.status then
      insert into public.lead_activities (lead_id, user_id, type, data)
      values (new.id, auth.uid(), 'status', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.assigned_to is distinct from old.assigned_to then
      insert into public.lead_activities (lead_id, user_id, type, data)
      values (new.id, auth.uid(), 'assigned', jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
      if new.assigned_to is not null then
        update public.followups set user_id = new.assigned_to
        where lead_id = new.id and not done;
      end if;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists leads_after_change on public.leads;
create trigger leads_after_change after insert or update on public.leads
  for each row execute function public.leads_after_change();

-- notes: تحديث آخر نشاط + أول تواصل
create or replace function public.notes_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.leads
     set last_activity_at = now(),
         first_contact_at = coalesce(first_contact_at, now())
   where id = new.lead_id;
  return null;
end $$;
drop trigger if exists notes_after_insert on public.lead_notes;
create trigger notes_after_insert after insert on public.lead_notes
  for each row execute function public.notes_after_insert();

-- followups: قبل التعديل
create or replace function public.followups_before_update()
returns trigger language plpgsql as $$
begin
  if new.due_at is distinct from old.due_at then new.notified := false; end if;
  if new.done and not old.done then new.done_at := now(); end if;
  if not new.done then new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists followups_before_update on public.followups;
create trigger followups_before_update before update on public.followups
  for each row execute function public.followups_before_update();

-- followups: تحديث "المتابعة القادمة" في الليد
create or replace function public.followups_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  if tg_op = 'DELETE' then v_lead := old.lead_id; else v_lead := new.lead_id; end if;
  update public.leads
     set next_followup_at = (select min(f.due_at) from public.followups f where f.lead_id = v_lead and not f.done)
   where id = v_lead;
  return null;
end $$;
drop trigger if exists followups_after_change on public.followups;
create trigger followups_after_change after insert or update or delete on public.followups
  for each row execute function public.followups_after_change();

-- ---------------------------------------------------------------------
-- 5) Distribution
-- ---------------------------------------------------------------------

-- أقرب وقت داخل مواعيد العمل
create or replace function public.next_working_time(p_ts timestamptz, p_tz text, p_days int[], p_start time, p_end time)
returns timestamptz language plpgsql stable as $$
declare v_local timestamp; d int;
begin
  if p_days is null or cardinality(p_days) = 0 then return p_ts; end if;
  v_local := p_ts at time zone p_tz;
  for d in 0..7 loop
    if extract(dow from (v_local::date + d))::int = any(p_days) then
      if d = 0 then
        if v_local::time < p_start then return ((v_local::date + p_start) at time zone p_tz); end if;
        if v_local::time < p_end then return p_ts; end if;
      else
        return ((v_local::date + d) + p_start) at time zone p_tz;
      end if;
    end if;
  end loop;
  return p_ts;
end $$;

-- لما الإعدادات تتغير، نظبط ميعاد الدفعة الجاية
create or replace function public.distribution_settings_before_update()
returns trigger language plpgsql as $$
begin
  if not new.enabled then
    new.next_run_at := null;
  elsif old.enabled is distinct from new.enabled
     or old.interval_minutes <> new.interval_minutes
     or old.work_days <> new.work_days
     or old.work_start <> new.work_start
     or old.work_end <> new.work_end
     or old.timezone <> new.timezone
     or new.next_run_at is null then
    new.next_run_at := public.next_working_time(now() + make_interval(mins => new.interval_minutes),
                         new.timezone, new.work_days, new.work_start, new.work_end);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists distribution_settings_before_update on public.distribution_settings;
create trigger distribution_settings_before_update before update on public.distribution_settings
  for each row execute function public.distribution_settings_before_update();

-- عدد الليدز اللي مستنية توزيع
create or replace function public.pool_count()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.leads where assigned_to is null and in_pool;
$$;

-- التوزيع التلقائي (بيشتغل كل دقيقة من pg_cron، وبيوزّع لما ييجي الميعاد)
create or replace function public.run_auto_distribution(p_force boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare
  s public.distribution_settings%rowtype;
  v_now timestamptz := now();
  v_local timestamp;
  v_day_start timestamptz;
  v_next timestamptz;
  r record;
  v_take int;
  v_cnt int;
  v_total int := 0;
  v_recycled int := 0;
begin
  if p_force and not public.has_perm('manage_distribution') then
    raise exception 'ليس لديك صلاحية';
  end if;

  select * into s from public.distribution_settings where id = 1 for update;
  if not found then return 0; end if;

  if not p_force then
    if not s.enabled then return 0; end if;
    if s.next_run_at is null then
      update public.distribution_settings
         set next_run_at = public.next_working_time(v_now + make_interval(mins => s.interval_minutes),
                             s.timezone, s.work_days, s.work_start, s.work_end)
       where id = 1;
      return 0;
    end if;
    if v_now < s.next_run_at then return 0; end if;
    -- برّه مواعيد العمل؟ أجّل لأول ميعاد شغل
    v_next := public.next_working_time(v_now, s.timezone, s.work_days, s.work_start, s.work_end);
    if v_next > v_now then
      update public.distribution_settings set next_run_at = v_next where id = 1;
      return 0;
    end if;
  end if;

  -- إعادة الليدز اللي محدش كلمها للـ Pool
  if s.recycle_enabled then
    update public.leads
       set assigned_to = null, in_pool = true
     where assigned_to is not null
       and status = 'new'
       and first_contact_at is null
       and assigned_at < v_now - make_interval(mins => s.recycle_after_minutes);
    get diagnostics v_recycled = row_count;
  end if;

  v_local := v_now at time zone s.timezone;
  v_day_start := date_trunc('day', v_local) at time zone s.timezone;

  for r in
    select p.id, p.daily_cap,
           (select count(*) from public.leads l
             where l.assigned_to = p.id and l.assigned_at >= v_day_start)::int as today_count
      from public.profiles p
     where p.is_active and p.receives_auto_leads
     order by today_count asc, random()
  loop
    exit when not exists (select 1 from public.leads where assigned_to is null and in_pool);
    v_take := s.batch_size;
    if r.daily_cap is not null then
      v_take := least(v_take, greatest(r.daily_cap - r.today_count, 0));
    end if;
    continue when v_take <= 0;

    with picked as (
      select id from public.leads
       where assigned_to is null and in_pool
       order by case when s.pick_order = 'oldest' then created_at end asc,
                created_at desc
       limit v_take
       for update skip locked
    )
    update public.leads l set assigned_to = r.id
      from picked where l.id = picked.id;
    get diagnostics v_cnt = row_count;

    if v_cnt > 0 then
      v_total := v_total + v_cnt;
      insert into public.notifications (user_id, type, title, body)
      values (r.id, 'assign', 'نزلك ' || v_cnt || ' ليد جديد 🎯', 'من التوزيع التلقائي — ابدأ التواصل دلوقتي');
    end if;
  end loop;

  update public.distribution_settings
     set last_run_at = v_now,
         last_run_count = v_total,
         next_run_at = case when s.enabled then
           public.next_working_time(v_now + make_interval(mins => s.interval_minutes),
                                    s.timezone, s.work_days, s.work_start, s.work_end)
           else null end
   where id = 1;

  insert into public.distribution_runs (total, recycled, forced, by_user)
  values (v_total, v_recycled, p_force, auth.uid());

  return v_total;
end $$;

-- توزيع يدوي (Round Robin على السيلز المختارين) — مصفوفة فاضية = رجوع للـ Pool
create or replace function public.assign_leads(p_lead_ids uuid[], p_user_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
  i int := 0;
  lid uuid;
  cnt int := 0;
begin
  if not (public.has_perm('assign') or public.has_perm('manage_distribution')) then
    raise exception 'ليس لديك صلاحية التوزيع';
  end if;
  if p_lead_ids is null or cardinality(p_lead_ids) = 0 then return 0; end if;

  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    update public.leads set assigned_to = null, in_pool = true where id = any(p_lead_ids);
    get diagnostics cnt = row_count;
    return cnt;
  end if;

  n := cardinality(p_user_ids);
  foreach lid in array p_lead_ids loop
    update public.leads set assigned_to = p_user_ids[(i % n) + 1]
     where id = lid and assigned_to is distinct from p_user_ids[(i % n) + 1];
    i := i + 1;
  end loop;

  insert into public.notifications (user_id, type, title, body)
  select x.u, 'assign', 'اتحولك ' || x.c || ' ليد جديد 📥', 'افتح الليدز وابدأ التواصل'
    from (
      select p_user_ids[((t.ord - 1) % n) + 1] as u, count(*) as c
        from unnest(p_lead_ids) with ordinality as t(id, ord)
       group by 1
    ) x
   where x.u <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  return cardinality(p_lead_ids);
end $$;

-- تفعيل/إيقاف استقبال الليدز التلقائية لسيلز + الحد اليومي
create or replace function public.set_auto_participation(p_user uuid, p_receives boolean, p_cap int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('manage_distribution') then raise exception 'ليس لديك صلاحية'; end if;
  update public.profiles set receives_auto_leads = p_receives, daily_cap = p_cap where id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- 6) Follow-up reminders (كل دقيقة)
-- ---------------------------------------------------------------------
create or replace function public.fire_due_followups()
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  with due as (
    update public.followups
       set notified = true
     where not done and not notified and due_at <= now()
    returning id, lead_id, user_id, type, note
  )
  insert into public.notifications (user_id, type, title, body, lead_id)
  select d.user_id, 'followup',
         '⏰ ميعاد متابعة: ' || coalesce(l.full_name, ''),
         coalesce(nullif(d.note, ''), 'حان موعد المتابعة مع العميل'),
         d.lead_id
    from due d left join public.leads l on l.id = d.lead_id;
  get diagnostics v = row_count;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 7) Reports
-- ---------------------------------------------------------------------
create or replace function public.stage_counts()
returns table(status text, total bigint) language sql stable as $$
  select l.status, count(*) from public.leads l group by l.status;
$$;

create or replace function public.sales_report(p_from timestamptz, p_to timestamptz)
returns table(
  user_id uuid, full_name text, role text,
  assigned bigint, contacted bigint, advanced bigint, won bigint, lost bigint,
  won_value numeric, avg_response_min numeric, notes_count bigint, overdue_followups bigint
)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role,
         count(l.id),
         count(l.id) filter (where l.first_contact_at is not null),
         count(l.id) filter (where l.status in ('meeting','proposal','negotiation','won')),
         count(l.id) filter (where l.status = 'won'),
         count(l.id) filter (where l.status = 'lost'),
         coalesce(sum(l.deal_value) filter (where l.status = 'won'), 0),
         round((avg(extract(epoch from (l.first_contact_at - l.assigned_at)) / 60.0)
                filter (where l.first_contact_at is not null and l.first_contact_at >= l.assigned_at))::numeric, 0),
         (select count(*) from public.lead_notes n
           where n.user_id = p.id and n.created_at >= p_from and n.created_at < p_to),
         (select count(*) from public.followups f
           where f.user_id = p.id and not f.done and f.due_at < now())
    from public.profiles p
    left join public.leads l
      on l.assigned_to = p.id and l.assigned_at >= p_from and l.assigned_at < p_to
   where public.has_perm('reports') and p.is_active
   group by p.id, p.full_name, p.role
   order by 7 desc, 4 desc;
$$;

create or replace function public.breakdown_report(p_from timestamptz, p_to timestamptz, p_dim text)
returns table(label text, total bigint, contacted bigint, won bigint, lost bigint, won_value numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(case p_dim
                           when 'service' then l.service
                           when 'campaign' then l.campaign
                           when 'lost_reason' then l.lost_reason
                           else l.source end, ''), 'غير محدد'),
         count(*),
         count(*) filter (where l.first_contact_at is not null),
         count(*) filter (where l.status = 'won'),
         count(*) filter (where l.status = 'lost'),
         coalesce(sum(l.deal_value) filter (where l.status = 'won'), 0)
    from public.leads l
   where public.has_perm('reports')
     and l.created_at >= p_from and l.created_at < p_to
     and (p_dim <> 'lost_reason' or l.status = 'lost')
   group by 1
   order by 2 desc;
$$;

-- ---------------------------------------------------------------------
-- 8) Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.lead_notes enable row level security;
alter table public.followups enable row level security;
alter table public.lead_activities enable row level security;
alter table public.notifications enable row level security;
alter table public.distribution_settings enable row level security;
alter table public.distribution_runs enable row level security;
alter table public.import_batches enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- leads
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using ((select public.has_perm('view_all')) or assigned_to = (select auth.uid())
         or created_by = (select auth.uid()));
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated
  with check ((select public.has_perm('import')) or (select public.has_perm('assign'))
              or (select public.has_perm('edit_all')) or assigned_to = (select auth.uid()));
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using ((select public.has_perm('edit_all')) or assigned_to = (select auth.uid()))
  with check ((select public.has_perm('edit_all')) or (select public.has_perm('assign'))
              or assigned_to = (select auth.uid()));
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using ((select public.has_perm('delete')));

-- notes
drop policy if exists notes_select on public.lead_notes;
create policy notes_select on public.lead_notes for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_notes.lead_id));
drop policy if exists notes_insert on public.lead_notes;
create policy notes_insert on public.lead_notes for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.leads l where l.id = lead_notes.lead_id));
drop policy if exists notes_delete on public.lead_notes;
create policy notes_delete on public.lead_notes for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- followups
drop policy if exists followups_select on public.followups;
create policy followups_select on public.followups for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_perm('view_all')));
drop policy if exists followups_insert on public.followups;
create policy followups_insert on public.followups for insert to authenticated
  with check ((user_id = (select auth.uid()) or (select public.has_perm('edit_all')))
              and exists (select 1 from public.leads l where l.id = followups.lead_id));
drop policy if exists followups_update on public.followups;
create policy followups_update on public.followups for update to authenticated
  using (user_id = (select auth.uid()) or (select public.has_perm('edit_all')));
drop policy if exists followups_delete on public.followups;
create policy followups_delete on public.followups for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.has_perm('edit_all')));

-- activities
drop policy if exists activities_select on public.lead_activities;
create policy activities_select on public.lead_activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_activities.lead_id));

-- notifications
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- distribution
drop policy if exists dist_settings_select on public.distribution_settings;
create policy dist_settings_select on public.distribution_settings for select to authenticated using (true);
drop policy if exists dist_settings_update on public.distribution_settings;
create policy dist_settings_update on public.distribution_settings for update to authenticated
  using ((select public.has_perm('manage_distribution')));
drop policy if exists dist_runs_select on public.distribution_runs;
create policy dist_runs_select on public.distribution_runs for select to authenticated
  using ((select public.has_perm('manage_distribution')));

-- import batches
drop policy if exists import_batches_select on public.import_batches;
create policy import_batches_select on public.import_batches for select to authenticated
  using ((select public.has_perm('import')));
drop policy if exists import_batches_insert on public.import_batches;
create policy import_batches_insert on public.import_batches for insert to authenticated
  with check ((select public.has_perm('import')));
drop policy if exists import_batches_update on public.import_batches;
create policy import_batches_update on public.import_batches for update to authenticated
  using (created_by = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 9) Function grants (منع الزوار غير المسجلين)
-- ---------------------------------------------------------------------
revoke execute on function public.run_auto_distribution(boolean) from public, anon;
revoke execute on function public.assign_leads(uuid[], uuid[]) from public, anon;
revoke execute on function public.set_auto_participation(uuid, boolean, int) from public, anon;
revoke execute on function public.pool_count() from public, anon;
revoke execute on function public.sales_report(timestamptz, timestamptz) from public, anon;
revoke execute on function public.breakdown_report(timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.fire_due_followups() from public, anon, authenticated;
grant execute on function public.run_auto_distribution(boolean) to authenticated;
grant execute on function public.assign_leads(uuid[], uuid[]) to authenticated;
grant execute on function public.set_auto_participation(uuid, boolean, int) to authenticated;
grant execute on function public.pool_count() to authenticated;
grant execute on function public.sales_report(timestamptz, timestamptz) to authenticated;
grant execute on function public.breakdown_report(timestamptz, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------
-- 10) Realtime (إشعارات لحظية)
-- ---------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 11) Scheduled jobs (pg_cron)
-- ---------------------------------------------------------------------
select cron.schedule('crm-auto-distribution', '* * * * *', $$select public.run_auto_distribution(false)$$);
select cron.schedule('crm-followup-reminders', '* * * * *', $$select public.fire_due_followups()$$);
select cron.schedule('crm-cleanup-notifications', '0 3 * * *',
  $$delete from public.notifications where read and created_at < now() - interval '30 days'$$);
