import type { Timestamp } from 'firebase/firestore'
import type { Permission } from '../../../auth/permissions'
import type { Role } from '../../../types/User'
import type { LabStageValue } from '../../../types/Domain'

export type SettingsTab = 'general' | 'users' | 'lab' | 'notifications' | 'integrations' | 'billing' | 'appearance'

export type SettingsNavItem = {
  id: SettingsTab
  label: string
  permission: Permission
}

export type ClinicSettings = {
  name: string
  cnpj: string
  phone: string
  email: string
  address: {
    street: string
    number: string
    complement?: string
    neighborhood: string
    city: string
    state: string
    zipCode: string
  }
  logo_url?: string
  working_hours: Record<string, { open: string; close: string; enabled: boolean }>
  timezone: string
}

export type UserWithRole = {
  uid: string
  email: string
  displayName: string
  role: Role
  permissions: Permission[]
  status: 'active' | 'inactive' | 'pending'
  last_login?: Timestamp
  created_at?: Timestamp
}

export type PendingInvite = {
  id: string
  email: string
  role: Role
  invited_by: string
  expires_at?: Timestamp
}

export type Printer3D = {
  id: string
  name: string
  model: string
  status: 'online' | 'offline' | 'maintenance'
  current_job?: string
}

export type LabConfiguration = {
  kanban_columns: LabStageValue[]
  default_sla_hours: Record<LabStageValue, number>
  printers_3d: Printer3D[]
  thermoforming_machines: Array<{ id: string; name: string; status: Printer3D['status'] }>
  default_materials: {
    resin_type: string
    plate_thickness: number
  }
  qc_checklist: Array<{ id: string; label: string; required: boolean }>
  require_photos_per_stage: boolean
}

export type NotificationPreferences = {
  channels: { email: boolean; push: boolean; whatsapp: boolean }
  triggers: Record<'new_case' | 'case_status_change' | 'setup_approval_needed' | 'sla_warning' | 'sla_overdue' | 'patient_confirmation' | 'low_inventory', boolean>
  schedule: { quiet_hours_start: string; quiet_hours_end: string; weekend_notifications: boolean }
}

export type Integration = {
  id: string
  name: string
  type: 'erp' | 'scanner' | 'payment' | 'messaging' | 'cloud'
  status: 'connected' | 'disconnected' | 'error'
  config: Record<string, unknown>
  last_sync?: Timestamp
}

export type BillingInfo = {
  plan: 'starter' | 'professional' | 'enterprise'
  billing_cycle: 'monthly' | 'annual'
  next_billing_date?: Timestamp
  usage: {
    cases_this_month: number
    cases_limit: number
    storage_used_gb: number
    storage_limit_gb: number
    users_count: number
    users_limit: number
  }
}

export type AppearancePreferences = {
  theme: 'light' | 'dark' | 'system'
  primary_color: string
  sidebar_collapsed: boolean
  density: 'comfortable' | 'compact'
  language: 'pt-BR' | 'en-US' | 'es-ES'
  date_format: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
  time_format: '24h' | '12h'
}
