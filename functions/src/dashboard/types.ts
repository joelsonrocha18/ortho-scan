import type { Timestamp } from 'firebase-admin/firestore'

export type DashboardSnapshot = {
  clinic_id: string
  generated_at: Timestamp
  period: 'last_30_days'
  financial: {
    total_production_cost: number
    avg_cost_per_case: number
    avg_cost_per_tray: number
    cases_with_cost_data: number
    top_material_costs: {
      material_id: string
      material_name: string
      total_cost: number
    }[]
  }
  operational: {
    total_active_lab_items: number
    items_by_stage: Record<string, number>
    sla_on_track: number
    sla_warning: number
    sla_overdue: number
    avg_production_days: number
    rework_count: number
    rework_rate_percent: number
  }
  clinical: {
    total_active_patients: number
    patients_with_portal: number
    portal_adoption_percent: number
    total_tray_confirmations_30d: number
    confirmations_with_selfie: number
    selfie_rate_percent: number
    avg_tray_change_delay_days: number
    cases_in_treatment: number
    cases_completed_30d: number
  }
}
