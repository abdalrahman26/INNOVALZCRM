-- =====================================================================
--  Agency CRM — Update v5: أرقام المراحل + فريش/كولد في التقارير
--  دوال جديدة بس — مش بيغيّر أي حاجة شغالة، وآمن لو اتشغّل أكتر من مرة
-- =====================================================================

-- فريش ولا كولد حسب المصدر:
--   Cold Call / داتا قديمة / أي مصدر فيه كلمة cold أو داتا = كولد
--   أي مصدر تاني (إعلانات، موقع، واتساب، ترشيح...) = فريش
--   من غير مصدر = غير محدد
create or replace function public.lead_temp(p_source text)
returns text language sql immutable as $$
  select case
    when nullif(btrim(coalesce(p_source, '')), '') is null then 'unknown'
    when p_source ~* '(cold|كولد|داتا|data|قديم|old)' then 'cold'
    else 'fresh'
  end
$$;

-- أرقام كل سيلز في الفترة (حسب تاريخ التوزيع — زي جدول أداء السيلز)
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

-- تقسيم «فريش / كولد» في كارت التقسيم (نفس الدالة القديمة + بند جديد)
create or replace function public.breakdown_report(p_from timestamptz, p_to timestamptz, p_dim text)
returns table(label text, total bigint, contacted bigint, won bigint, lost bigint, won_value numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(case p_dim
                           when 'service' then l.service
                           when 'campaign' then l.campaign
                           when 'lost_reason' then l.lost_reason
                           when 'lead_temp' then public.lead_temp(l.source)
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

revoke execute on function public.funnel_report(timestamptz, timestamptz) from public, anon;
grant execute on function public.funnel_report(timestamptz, timestamptz) to authenticated;
grant execute on function public.lead_temp(text) to authenticated;
