-- =====================================================================
--  Agency CRM — Update v6: «المهتمين» = أي ليد مرحلته مش «خسارة»
--  (شغّل migration-v5.sql الأول لو لسه ما شغلتهوش) — آمن لو اتشغّل أكتر من مرة
-- =====================================================================

create or replace function public.funnel_report(p_from timestamptz, p_to timestamptz)
returns table(
  user_id uuid,
  interested bigint,       -- أي مرحلة ما عدا الخسارة
  quote_requested bigint,  -- طالب عرض سعر
  proposals bigint,        -- تم إرسال عرض
  negotiation bigint,      -- تفاوض
  lost bigint,             -- خسارة
  fresh bigint,
  cold bigint,
  no_source bigint
)
language sql stable security definer set search_path = public as $$
  select p.id,
         count(l.id) filter (where l.status is distinct from 'lost'),
         count(l.id) filter (where l.status = 'quote_requested'),
         count(l.id) filter (where l.status = 'proposal'),
         count(l.id) filter (where l.status = 'negotiation'),
         count(l.id) filter (where l.status = 'lost'),
         count(l.id) filter (where public.lead_temp(l.source) = 'fresh'),
         count(l.id) filter (where public.lead_temp(l.source) = 'cold'),
         count(l.id) filter (where public.lead_temp(l.source) = 'unknown')
    from public.profiles p
    left join public.leads l
      on l.assigned_to = p.id and l.assigned_at >= p_from and l.assigned_at < p_to
   where public.has_perm('reports') and p.is_active
   group by p.id;
$$;
