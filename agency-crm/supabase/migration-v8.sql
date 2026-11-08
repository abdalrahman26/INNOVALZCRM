-- =====================================================================
--  Agency CRM — Update v8: كل موظف يشوف الليدز اللي متحولاله بس
--
--  • اللي مش معاه «يشوف كل الليدز» مبيشوفش الليدز اللي استوردها أو ضافها
--    إلا لو اتوزعت عليه — حتى أرقامه ومتابعاته وإشعاراته
--  • الاستيراد بتاعه بيدخل التوزيع التلقائي على طول
--  • الليدز اللي استوردها قبل كده ولسه متوزعتش: بتدخل التوزيع التلقائي دلوقتي
--
--  (بيحل محل قاعدة v7 — مش لازم تكون شغلت v7)
--  آمن على الداتا، ومش بيوقف حد عن الشغل، وآمن لو اتشغّل أكتر من مرة
-- =====================================================================

alter table public.import_batches add column if not exists finished_at timestamptz;
alter table public.leads add column if not exists inserted_at timestamptz;
alter table public.leads alter column inserted_at set default now();

-- هل اليوزر ده بيشوف كل الليدز؟ (أدمن / مدير / صلاحية «يشوف كل الليدز»)
create or replace function public.sees_all(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_active and (p.role in ('admin', 'manager') or p.can_view_all)
                     from public.profiles p where p.id = p_user), false);
$$;

-- الاستيراد شغال دلوقتي؟ (بيخلّي اللي بيستورد يحفظ الملاحظات والمتابعات وهو بيستورد بس)
create or replace function public.is_my_running_import(p_batch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.import_batches b
                  where b.id = p_batch and b.created_by = auth.uid()
                    and b.finished_at is null and b.created_at > now() - interval '30 minutes');
$$;

-- ---------------------------------------------------------------------
-- 1) الليدز
-- ---------------------------------------------------------------------
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (
    (select public.has_perm('view_all'))
    or assigned_to = (select auth.uid())
    or (created_by = (select auth.uid()) and import_batch_id is not null
        and public.is_my_running_import(import_batch_id))
  );

-- ---------------------------------------------------------------------
-- 2) المتابعات: تظهر بس لو الليد متحوّلك
-- ---------------------------------------------------------------------
drop policy if exists followups_select on public.followups;
create policy followups_select on public.followups for select to authenticated
  using ((select public.has_perm('view_all'))
         or exists (select 1 from public.leads l
                     where l.id = followups.lead_id and l.assigned_to = (select auth.uid())));
drop policy if exists followups_update on public.followups;
create policy followups_update on public.followups for update to authenticated
  using ((select public.has_perm('edit_all'))
         or (user_id = (select auth.uid()) and exists (select 1 from public.leads l
              where l.id = followups.lead_id and l.assigned_to = (select auth.uid()))));
drop policy if exists followups_delete on public.followups;
create policy followups_delete on public.followups for delete to authenticated
  using ((select public.has_perm('edit_all'))
         or (user_id = (select auth.uid()) and exists (select 1 from public.leads l
              where l.id = followups.lead_id and l.assigned_to = (select auth.uid()))));

-- تذكير المتابعة يروح للي الليد معاه (ومتابعات الليدز اللي لسه في التوزيع بتستنى لحد ما تتوزع)
create or replace function public.fire_due_followups()
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  with due as (
    update public.followups f
       set notified = true
      from public.leads l
     where l.id = f.lead_id
       and not f.done and not f.notified and f.due_at <= now()
       and (l.assigned_to is not null or public.sees_all(f.user_id))
    returning f.id, f.lead_id, f.note, l.full_name,
              case when f.user_id = l.assigned_to or public.sees_all(f.user_id)
                   then f.user_id else l.assigned_to end as recipient
  )
  insert into public.notifications (user_id, type, title, body, lead_id)
  select d.recipient, 'followup',
         '⏰ ميعاد متابعة: ' || coalesce(d.full_name, ''),
         coalesce(nullif(d.note, ''), 'حان موعد المتابعة مع العميل'),
         d.lead_id
    from due d
   where d.recipient is not null;
  get diagnostics v = row_count;
  return v;
end $$;
revoke execute on function public.fire_due_followups() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) إشعار الرد على تعليق: مايروحش لحد الليد مش معاه
-- ---------------------------------------------------------------------
create or replace function public.notes_notify_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_lead text;
  v_author text;
begin
  if new.parent_id is null then return null; end if;
  select assigned_to, full_name into v_owner, v_lead from public.leads where id = new.lead_id;
  select full_name into v_author from public.profiles where id = new.user_id;

  insert into public.notifications (user_id, type, title, body, lead_id, data)
  select x.u, 'reply',
         '💬 ' || coalesce(v_author, '') || ' ردّ على تعليق: ' || coalesce(v_lead, ''),
         left(new.body, 140),
         new.lead_id,
         jsonb_build_object('author', coalesce(v_author, ''), 'lead', coalesce(v_lead, ''))
    from (
      select n.user_id as u from public.lead_notes n
       where n.id = new.parent_id or n.parent_id = new.parent_id
      union
      select v_owner
    ) x
    join public.profiles p on p.id = x.u and p.is_active
   where x.u is not null and x.u is distinct from new.user_id
     and (x.u = v_owner or public.sees_all(x.u));
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 4) تعديل بيانات العميل: للي الليد معاه أو اللي بيشوف الكل
-- ---------------------------------------------------------------------
create or replace function public.update_lead_info(p_lead uuid, p_fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.leads%rowtype;
  old_j jsonb;
  changes jsonb := '{}'::jsonb;
  k text;
  nv text;
  allowed text[] := array['full_name','phone','email','company','job_title','service','source','campaign','budget','city'];
begin
  select * into v from public.leads where id = p_lead;
  if not found then raise exception 'الليد مش موجود'; end if;

  if not coalesce(public.has_perm('view_all')
                  or v.assigned_to is not distinct from auth.uid() and v.assigned_to is not null, false) then
    raise exception 'مش عندك صلاحية تعدّل الليد ده';
  end if;

  if p_fields ? 'full_name' and coalesce(btrim(p_fields->>'full_name'), '') = '' then
    raise exception 'الاسم مطلوب';
  end if;

  old_j := to_jsonb(v);
  foreach k in array allowed loop
    if p_fields ? k then
      nv := nullif(btrim(p_fields->>k), '');
      if nv is distinct from (old_j->>k) then
        changes := changes || jsonb_build_object(k, jsonb_build_object('from', old_j->>k, 'to', nv));
      end if;
    end if;
  end loop;

  if changes = '{}'::jsonb then return; end if;

  update public.leads set
    full_name = case when changes ? 'full_name' then changes->'full_name'->>'to' else full_name end,
    phone     = case when changes ? 'phone'     then changes->'phone'->>'to'     else phone end,
    email     = case when changes ? 'email'     then changes->'email'->>'to'     else email end,
    company   = case when changes ? 'company'   then changes->'company'->>'to'   else company end,
    job_title = case when changes ? 'job_title' then changes->'job_title'->>'to' else job_title end,
    service   = case when changes ? 'service'   then changes->'service'->>'to'   else service end,
    source    = case when changes ? 'source'    then changes->'source'->>'to'    else source end,
    campaign  = case when changes ? 'campaign'  then changes->'campaign'->>'to'  else campaign end,
    budget    = case when changes ? 'budget'    then changes->'budget'->>'to'    else budget end,
    city      = case when changes ? 'city'      then changes->'city'->>'to'      else city end
  where id = p_lead;

  insert into public.lead_activities (lead_id, user_id, type, data)
  values (p_lead, auth.uid(), 'info', changes);
end $$;
revoke execute on function public.update_lead_info(uuid, jsonb) from public, anon;
grant execute on function public.update_lead_info(uuid, jsonb) to authenticated;

grant execute on function public.sees_all(uuid) to authenticated;
grant execute on function public.is_my_running_import(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5) الداتا الحالية
-- ---------------------------------------------------------------------
-- (أ) الليدز اللي استوردها/ضافها حد مش بيشوف الكل ولسه متوزعتش → التوزيع التلقائي
drop table if exists v8_moved;
create temp table v8_moved as
  select l.id, l.created_by from public.leads l
   where l.assigned_to is null and not l.in_pool
     and l.status not in ('won', 'lost')   -- المتعاقد والخسارة مايتوزعوش كليدز جديدة
     and l.created_by is not null and not public.sees_all(l.created_by);
update public.leads set in_pool = true where id in (select id from v8_moved);

-- (ب) الاستيرادات القديمة تتقفل
update public.import_batches set finished_at = coalesce(finished_at, now()) where finished_at is null;

-- (ج) إشعارات متابعة/ردود عن ليدز مش متحوّلة للشخص ده تتشال
delete from public.notifications n
 using public.leads l
 where l.id = n.lead_id and n.type in ('followup', 'reply')
   and l.assigned_to is distinct from n.user_id
   and not public.sees_all(n.user_id);

-- النتيجة: كل موظف بيشوف كام ليد، وكام ليد من اللي ضافها دخلت التوزيع دلوقتي
select p.full_name as "الاسم",
       case when public.sees_all(p.id) then 'كل الليدز' else 'ليدزه بس ✅' end as "بيشوف",
       (select count(*) from public.leads l where l.assigned_to = p.id) as "ليدز باسمه",
       (select count(*) from v8_moved m where m.created_by = p.id) as "دخلت التوزيع التلقائي دلوقتي"
  from public.profiles p
 where p.is_active
 order by 2, 1;
