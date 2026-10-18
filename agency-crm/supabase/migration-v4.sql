-- =====================================================================
--  Agency CRM — Update v4
--  1) مرحلة "طالب عرض سعر" + إشعار للأدمن والمديرين أول ما تتحدد
--  2) إشعارات التوزيع/التحويل بقت شايلة الليدز نفسها (الضغط عليها يفتح العميل)
--  آمن على الداتا الحالية، وآمن لو اتشغّل أكتر من مرة
-- =====================================================================

alter table public.notifications add column if not exists data jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- 1) طالب عرض سعر → إشعار لكل الأدمن والمديرين (ما عدا اللي غيّر المرحلة)
-- ---------------------------------------------------------------------
create or replace function public.notify_quote_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_by text; v_owner text;
begin
  if new.status = 'quote_requested'
     and (tg_op = 'INSERT' or old.status is distinct from 'quote_requested') then
    select full_name into v_by from public.profiles where id = auth.uid();
    select full_name into v_owner from public.profiles where id = new.assigned_to;
    insert into public.notifications (user_id, type, title, body, lead_id, data)
    select p.id, 'quote',
           '📄 عميل طالب عرض سعر: ' || new.full_name,
           coalesce('السيلز: ' || coalesce(v_owner, v_by), 'محتاج عرض سعر'),
           new.id,
           jsonb_build_object('lead', new.full_name, 'by', coalesce(v_owner, v_by, ''))
      from public.profiles p
     where p.is_active and p.role in ('admin', 'manager')
       and p.id is distinct from auth.uid();
  end if;
  return null;
end $$;
drop trigger if exists leads_notify_quote on public.leads;
create trigger leads_notify_quote after insert or update of status on public.leads
  for each row execute function public.notify_quote_request();

-- ---------------------------------------------------------------------
-- 2) التوزيع اليدوي: الإشعار فيه الليدز
-- ---------------------------------------------------------------------
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

  -- إشعار لكل سيلز فيه الليدز اللي اتحولتله — ولو ليد واحد، الضغط على الإشعار بيفتحه على طول
  insert into public.notifications (user_id, type, title, body, lead_id, data)
  select x.u, 'assign',
         case when x.c = 1 then 'اتحولك ليد: ' || coalesce(x.name1, '') || ' 📥' else 'اتحولك ' || x.c || ' ليد جديد 📥' end,
         'افتح الليدز وابدأ التواصل',
         case when x.c = 1 then x.ids[1] end,
         jsonb_build_object('lead_ids', to_jsonb(x.ids), 'count', x.c, 'lead', x.name1)
    from (
      select p_user_ids[((t.ord - 1) % n) + 1] as u, count(*) as c, array_agg(t.id) as ids,
             (select l.full_name from public.leads l where l.id = (array_agg(t.id))[1]) as name1
        from unnest(p_lead_ids) with ordinality as t(id, ord)
       group by 1
    ) x
   where x.u <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  return cardinality(p_lead_ids);
end $$;

-- ---------------------------------------------------------------------
-- 3) التوزيع التلقائي: الإشعار فيه الليدز (نفس المنطق بالظبط)
-- ---------------------------------------------------------------------
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
  v_ids uuid[];
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
    ), upd as (
      update public.leads l set assigned_to = r.id
        from picked where l.id = picked.id
      returning l.id
    )
    select array_agg(id) into v_ids from upd;
    v_cnt := coalesce(cardinality(v_ids), 0);

    if v_cnt > 0 then
      v_total := v_total + v_cnt;
      -- الإشعار فيه الليدز نفسها، عشان الضغط عليه يفتحها
      insert into public.notifications (user_id, type, title, body, lead_id, data)
      values (r.id, 'assign', 'نزلك ' || v_cnt || ' ليد جديد 🎯', 'من التوزيع التلقائي — ابدأ التواصل دلوقتي',
              case when v_cnt = 1 then v_ids[1] end, jsonb_build_object('lead_ids', to_jsonb(v_ids)));
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

-- ---------------------------------------------------------------------
-- 4) التقارير: "طالب عرض سعر" بيتحسب مع المراحل المتقدمة
-- ---------------------------------------------------------------------
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
         count(l.id) filter (where l.status in ('meeting','quote_requested','proposal','negotiation','won')),
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
