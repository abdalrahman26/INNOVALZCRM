export type Role = 'admin' | 'manager' | 'sales';

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  is_active: boolean;
  receives_auto_leads: boolean;
  daily_cap: number | null;
  can_import: boolean;
  can_export: boolean;
  can_assign: boolean;
  can_delete: boolean;
  can_view_all: boolean;
  locale?: string | null;
  created_at: string;
}

export interface Lead {
  id: string;
  full_name: string;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  company: string | null;
  job_title: string | null;
  service: string | null;
  budget: string | null;
  source: string | null;
  campaign: string | null;
  city: string | null;
  status: string;
  lost_reason: string | null;
  deal_value: number | null;
  extra: Record<string, unknown> | null;
  in_pool: boolean;
  assigned_to: string | null;
  assigned_at: string | null;
  first_contact_at: string | null;
  last_activity_at: string | null;
  next_followup_at: string | null;
  won_at: string | null;
  created_at: string;
  updated_at: string;
  assignee?: { id: string; full_name: string } | null;
}

export interface Note {
  id: string;
  lead_id: string;
  user_id: string | null;
  body: string;
  parent_id?: string | null;
  source?: string | null;
  created_at: string;
}

export interface Followup {
  id: string;
  lead_id: string;
  user_id: string;
  due_at: string;
  type: string;
  note: string | null;
  done: boolean;
  done_at: string | null;
  created_at: string;
  lead?: { id: string; full_name: string; phone: string | null; company: string | null; status: string } | null;
}

export interface Activity {
  id: number;
  lead_id: string;
  user_id: string | null;
  type: string;
  data: Record<string, string | null>;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  lead_id: string | null;
  read: boolean;
  data?: Record<string, string> | null;
  created_at: string;
}

export interface DistributionSettings {
  id: number;
  enabled: boolean;
  interval_minutes: number;
  batch_size: number;
  pick_order: 'newest' | 'oldest';
  work_days: number[];
  work_start: string;
  work_end: string;
  timezone: string;
  show_countdown: boolean;
  recycle_enabled: boolean;
  recycle_after_minutes: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_count: number;
}
