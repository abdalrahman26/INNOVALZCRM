-- =====================================================================
--  Agency CRM — Update v3: تعديل بيانات العميل لأي حد شايف الليد
--  (الاسم، الموبايل، الإيميل، الشركة... — مش المسؤول ولا المرحلة)
--  آمن على الداتا الحالية، وآمن لو اتشغّل أكتر من مرة
-- =====================================================================

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

  -- أي حد شايف الليد يقدر يعدّل بياناته
  if not coalesce(public.has_perm('view_all')
                  or v.assigned_to is not distinct from auth.uid() and v.assigned_to is not null
                  or v.created_by is not distinct from auth.uid() and v.created_by is not null, false) then
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

  -- سجل التعديل (مين عدّل وإيه اللي اتغير)
  insert into public.lead_activities (lead_id, user_id, type, data)
  values (p_lead, auth.uid(), 'info', changes);
end $$;

revoke execute on function public.update_lead_info(uuid, jsonb) from public, anon;
grant execute on function public.update_lead_info(uuid, jsonb) to authenticated;
