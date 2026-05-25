import { useState } from 'react'
import Button from '../../../../components/Button'
import Input from '../../../../components/Input'
import type { NotificationPreferences } from '../types'
import SettingsSection from './SettingsSection'

const initialPreferences: NotificationPreferences = {
  channels: { email: true, push: true, whatsapp: false },
  triggers: {
    new_case: true,
    case_status_change: true,
    setup_approval_needed: true,
    sla_warning: true,
    sla_overdue: true,
    patient_confirmation: true,
    low_inventory: true,
  },
  schedule: { quiet_hours_start: '22:00', quiet_hours_end: '07:00', weekend_notifications: false },
}

const triggerLabels: Record<keyof NotificationPreferences['triggers'], string> = {
  new_case: 'Novo caso',
  case_status_change: 'Mudança de status',
  setup_approval_needed: 'Aprovação de setup',
  sla_warning: 'SLA em atenção',
  sla_overdue: 'SLA atrasado',
  patient_confirmation: 'Confirmação do paciente',
  low_inventory: 'Estoque baixo',
}

export default function NotificationSettings() {
  const [preferences, setPreferences] = useState(initialPreferences)

  return (
    <SettingsSection title="Notificações" description="Canais, gatilhos e horário silencioso.">
      <div className="grid gap-4 md:grid-cols-3">
        {Object.entries(preferences.channels).map(([channel, enabled]) => (
          <label key={channel} className="flex items-center justify-between rounded-lg border border-slate-200 p-4 text-sm font-medium capitalize text-slate-700">
            {channel}
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setPreferences((current) => ({ ...current, channels: { ...current.channels, [channel]: event.target.checked } }))}
            />
          </label>
        ))}
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {Object.entries(triggerLabels).map(([trigger, label]) => (
          <label key={trigger} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={preferences.triggers[trigger as keyof NotificationPreferences['triggers']]}
              onChange={(event) => setPreferences((current) => ({ ...current, triggers: { ...current.triggers, [trigger]: event.target.checked } }))}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm font-medium text-slate-700">
          Início do silêncio
          <Input type="time" value={preferences.schedule.quiet_hours_start} onChange={(event) => setPreferences((current) => ({ ...current, schedule: { ...current.schedule, quiet_hours_start: event.target.value } }))} />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-700">
          Fim do silêncio
          <Input type="time" value={preferences.schedule.quiet_hours_end} onChange={(event) => setPreferences((current) => ({ ...current, schedule: { ...current.schedule, quiet_hours_end: event.target.value } }))} />
        </label>
        <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
          <input type="checkbox" checked={preferences.schedule.weekend_notifications} onChange={(event) => setPreferences((current) => ({ ...current, schedule: { ...current.schedule, weekend_notifications: event.target.checked } }))} />
          Notificar no fim de semana
        </label>
      </div>
      <div className="mt-5 flex justify-end">
        <Button>Salvar notificações</Button>
      </div>
    </SettingsSection>
  )
}
