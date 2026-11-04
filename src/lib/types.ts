export type Role = 'agent' | 'manager' | 'admin';
export type ActivityKind = 'work' | 'break' | 'absence';
export type RequestKind = 'swap' | 'give' | 'time_off';
export type RequestStatus =
  | 'pending_peer'
  | 'open'
  | 'pending_manager'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface Settings {
  id: number;
  org_name: string;
  allowed_domains: string[];
  admin_emails: string[];
  timezone: string;
  min_rest_hours: number;
  split_gap_hours: number;
  snap_minutes: number;
  break_rules?: { min_shift_hours: number; from: 'start' | 'end'; offset_minutes: number; duration_minutes: number }[];
  break_activity_id?: string | null;
}

export interface Person {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  aliases: string[];
  role: Role;
  active: boolean;
  contract: string | null;
  email_notifications: boolean;
  created_at: string;
}

export interface Activity {
  id: string;
  name: string;
  color: string;
  kind: ActivityKind;
  aliases: string[];
  requestable: boolean;
  sort_order: number;
  archived: boolean;
}

export interface DayType {
  id: string;
  name: string;
  color: string;
  aliases: string[];
  sort_order: number;
  archived: boolean;
}

export interface DayMark {
  person_id: string;
  day: string;
  day_type_id: string;
}

export interface EventRow {
  id: string;
  person_id: string;
  activity_id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
  source: string;
  updated_at: string;
}

export interface RequestRow {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  requester_id: string;
  target_id: string | null;
  day_a: string | null;
  day_b: string | null;
  from_date: string | null;
  to_date: string | null;
  time_from: string | null;
  time_to: string | null;
  activity_id: string | null;
  note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export const ROLE_LABEL: Record<Role, string> = {
  agent: 'Dipendente',
  manager: 'Manager',
  admin: 'Amministratore',
};

export const KIND_LABEL: Record<ActivityKind, string> = {
  work: 'Lavoro',
  break: 'Pausa',
  absence: 'Assenza',
};

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending_peer: 'In attesa del collega',
  open: 'In bacheca',
  pending_manager: 'Da approvare',
  approved: 'Approvata',
  rejected: 'Rifiutata',
  cancelled: 'Annullata',
};
