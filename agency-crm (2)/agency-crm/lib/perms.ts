import type { Profile } from './types';

export type Perm =
  | 'view_all'
  | 'edit_all'
  | 'manage_distribution'
  | 'reports'
  | 'import'
  | 'export'
  | 'assign'
  | 'delete'
  | 'manage_team';

/** Mirrors public.has_perm() in the database. */
export function can(p: Profile | null | undefined, perm: Perm): boolean {
  if (!p || !p.is_active) return false;
  if (p.role === 'admin') return true;
  switch (perm) {
    case 'view_all':
      return p.role === 'manager' || p.can_view_all;
    case 'edit_all':
    case 'manage_distribution':
    case 'reports':
      return p.role === 'manager';
    case 'import':
      return p.can_import;
    case 'export':
      return p.can_export;
    case 'assign':
      return p.can_assign || p.role === 'manager';
    case 'delete':
      return p.can_delete;
    default:
      return false;
  }
}
