-- =====================================================================
--  Agency CRM — Update v9: ملفات العملاء (عروض سعر، صور، عقود...) على تليجرام
--
--  الملفات نفسها بتتخزن في قناة تليجرام خاصة (مساحة مفتوحة)،
--  والجدول ده بيحفظ بس بياناتها: اسم الملف، حجمه، وأماكن أجزائه على تليجرام.
--  أي حد يشوف الليد يشوف ملفاته — زي الملاحظات بالظبط.
--
--  آمن على الداتا، ومش بيوقف حد عن الشغل، وآمن لو اتشغّل أكتر من مرة
-- =====================================================================

create table if not exists public.lead_files (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'other',           -- quote | image | contract | other
  file_name text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  parts int not null default 1,                 -- الملفات الكبيرة بتتقسم أجزاء (كل جزء ~3.5MB)
  tg_chat_id text,
  tg_file_ids text[] not null default '{}',
  tg_message_ids bigint[] not null default '{}',
  status text not null default 'uploading',     -- uploading | ready
  created_at timestamptz not null default now()
);
create index if not exists lead_files_lead_idx on public.lead_files(lead_id, created_at desc);

alter table public.lead_files enable row level security;

drop policy if exists lead_files_select on public.lead_files;
create policy lead_files_select on public.lead_files for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_files.lead_id));

drop policy if exists lead_files_insert on public.lead_files;
create policy lead_files_insert on public.lead_files for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.leads l where l.id = lead_files.lead_id));

-- تكملة الرفع: صاحب الملف بس
drop policy if exists lead_files_update on public.lead_files;
create policy lead_files_update on public.lead_files for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.leads l where l.id = lead_files.lead_id));

-- المسح: صاحب الملف أو اللي يقدر يعدّل كل الليدز
drop policy if exists lead_files_delete on public.lead_files;
create policy lead_files_delete on public.lead_files for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.has_perm('edit_all')));

grant select, insert, update, delete on public.lead_files to authenticated;

-- أول ما الملف يخلص رفع: يتسجل في سجل نشاط العميل
create or replace function public.lead_files_after_ready()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    insert into public.lead_activities (lead_id, user_id, type, data)
    values (new.lead_id, new.user_id, 'file',
            jsonb_build_object('name', new.file_name, 'kind', new.kind, 'size', new.size_bytes));
    update public.leads set last_activity_at = now() where id = new.lead_id;
  end if;
  return null;
end $$;
drop trigger if exists lead_files_after_ready on public.lead_files;
create trigger lead_files_after_ready after update of status on public.lead_files
  for each row execute function public.lead_files_after_ready();

-- رفع ملغي/وقع في النص: يتشال بعد يوم
create or replace function public.cleanup_stale_uploads()
returns int language sql security definer set search_path = public as $$
  with d as (delete from public.lead_files where status = 'uploading' and created_at < now() - interval '1 day' returning 1)
  select count(*)::int from d;
$$;
revoke execute on function public.cleanup_stale_uploads() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'crm-cleanup-uploads';
    perform cron.schedule('crm-cleanup-uploads', '17 3 * * *', 'select public.cleanup_stale_uploads()');
  end if;
end $$;

-- إحصائيات التخزين لصفحة الأدمن
create or replace function public.storage_stats()
returns table(files bigint, bytes bigint, leads bigint)
language sql stable security definer set search_path = public as $$
  select count(*), coalesce(sum(size_bytes), 0)::bigint, count(distinct lead_id)
    from public.lead_files where status = 'ready' and public.is_admin();
$$;
revoke execute on function public.storage_stats() from public, anon;
grant execute on function public.storage_stats() to authenticated;

select 'تمام ✅ — جدول الملفات جاهز' as "النتيجة";
