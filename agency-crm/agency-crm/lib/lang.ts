-- =====================================================================
--  Agency CRM — Update v2 (آمن على الداتا الحالية — بيضيف بس، مبيمسحش حاجة)
--  شغّله مرة واحدة من: Supabase > SQL Editor > New query > Run
--  (آمن لو اتشغّل أكتر من مرة)
-- =====================================================================

-- 1) لغة كل يوزر
alter table public.profiles add column if not exists locale text not null default 'ar';
do $$ begin
  alter table public.profiles add constraint profiles_locale_check check (locale in ('ar','en'));
exception when duplicate_object then null; end $$;

create or replace function public.set_my_locale(p_locale text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_locale not in ('ar','en') then raise exception 'invalid locale'; end if;
  update public.profiles set locale = p_locale where id = auth.uid();
end $$;
revoke execute on function public.set_my_locale(text) from public, anon;
grant execute on function public.set_my_locale(text) to authenticated;

-- 2) استيراد ليدز قديمة: الاحتفاظ بتاريخ التوزيع اللي جاي من الشيت (بدل "دلوقتي")
create or replace function public.leads_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  if new.assigned_to is not null then
    if auth.uid() is not null and new.assigned_to <> auth.uid()
       and not (public.has_perm('assign') or public.has_perm('manage_distribution')) then
      raise exception 'ليس لديك صلاحية تحويل الليدز';
    end if;
    new.assigned_at := least(coalesce(new.assigned_at, now()), now());
    new.in_pool := false;
  else
    new.assigned_at := null;
  end if;
  if new.status = 'won' then new.won_at := coalesce(new.won_at, now()); end if;
  return new;
end $$;

-- 3) التعليقات والردود
alter table public.lead_notes add column if not exists parent_id uuid references public.lead_notes(id) on delete cascade;
alter table public.lead_notes add column if not exists source text not null default 'user';
create index if not exists lead_notes_parent_idx on public.lead_notes(parent_id);

alter table public.notifications add column if not exists data jsonb not null default '{}'::jsonb;

-- الرد لازم يكون على تعليق في نفس الليد، والردود كلها بتتعلق بالتعليق الأساسي
create or replace function public.notes_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_parent public.lead_notes%rowtype;
begin
  if new.parent_id is not null then
    select * into v_parent from public.lead_notes where id = new.parent_id;
    if not found or v_parent.lead_id <> new.lead_id then
      raise exception 'invalid parent comment';
    end if;
    if v_parent.parent_id is not null then new.parent_id := v_parent.parent_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists notes_before_insert on public.lead_notes;
create trigger notes_before_insert before insert on public.lead_notes
  for each row execute function public.notes_before_insert();

-- تعليقات الشيت مبتتحسبش "تواصل"، والردود بتحدّث آخر نشاط بس
create or replace function public.notes_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.source, 'user') = 'import' then
    return null;
  end if;
  if new.parent_id is not null then
    update public.leads set last_activity_at = now() where id = new.lead_id;
  else
    update public.leads
       set last_activity_at = now(),
           first_contact_at = coalesce(first_contact_at, now())
     where id = new.lead_id;
  end if;
  return null;
end $$;

-- إشعار لكل اللي في المحادثة + مسؤول الليد لما حد يرد
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
   where x.u is not null and x.u is distinct from new.user_id;
  return null;
end $$;
drop trigger if exists notes_notify_reply on public.lead_notes;
create trigger notes_notify_reply after insert on public.lead_notes
  for each row execute function public.notes_notify_reply();
