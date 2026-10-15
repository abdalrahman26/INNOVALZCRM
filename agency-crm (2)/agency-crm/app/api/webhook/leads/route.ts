import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * استقبال ليدز من أي مكان (فورم الموقع، Zapier، Make، Meta Lead Ads...)
 * POST /api/webhook/leads?key=WEBHOOK_SECRET
 * Body: { "name": "...", "phone": "...", "email": "...", "source": "...", "campaign": "...", "service": "..." }
 * أو Array من نفس الشكل
 */

type Body = Record<string, unknown>;

const KNOWN: Record<string, string[]> = {
  full_name: ['full_name', 'name', 'الاسم', 'fullName'],
  phone: ['phone', 'phone_number', 'mobile', 'whatsapp', 'الموبايل', 'رقم'],
  email: ['email', 'الإيميل'],
  company: ['company', 'company_name', 'business', 'brand'],
  job_title: ['job_title', 'title'],
  service: ['service', 'الخدمة'],
  budget: ['budget', 'الميزانية'],
  source: ['source', 'platform', 'المصدر'],
  campaign: ['campaign', 'campaign_name', 'ad_name', 'form_name'],
  city: ['city', 'المدينة'],
};

function pick(o: Body, keys: string[]) {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: 'POST leads here with ?key=YOUR_WEBHOOK_SECRET' });
}

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key') || req.headers.get('x-api-key');
  if (!process.env.WEBHOOK_SECRET || key !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  try {
    const ct = req.headers.get('content-type') ?? '';
    payload = ct.includes('application/json') ? await req.json() : Object.fromEntries((await req.formData()).entries());
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }

  const items = (Array.isArray(payload) ? payload : [payload]).filter((x): x is Body => !!x && typeof x === 'object');
  const known = new Set(Object.values(KNOWN).flat());

  const rows = items.map((b) => {
    const row: Record<string, unknown> = {};
    for (const [field, keys] of Object.entries(KNOWN)) row[field] = pick(b, keys);
    row.full_name = row.full_name ?? row.phone ?? 'بدون اسم';
    row.source = row.source ?? 'Webhook';
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(b)) if (!known.has(k) && v !== null && v !== undefined && String(v) !== '') extra[k] = String(v);
    row.extra = extra;
    row.in_pool = true;
    row.assigned_to = null;
    return row;
  }).filter((r) => r.phone || r.email || r.full_name !== 'بدون اسم');

  if (!rows.length) return NextResponse.json({ ok: false, error: 'no leads in body' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('leads')
    .upsert(rows, { onConflict: 'phone_normalized', ignoreDuplicates: true })
    .select('id');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const inserted = data?.length ?? 0;
  return NextResponse.json({ ok: true, inserted, duplicates: rows.length - inserted });
}
