import { useState } from 'react'
import Button from '../../../../components/Button'
import Input from '../../../../components/Input'
import type { LabConfiguration } from '../types'
import SettingsSection from './SettingsSection'

const stages = ['queued', 'in_production', 'qc', 'shipped', 'delivered', 'rework'] as const

const stageLabels: Record<(typeof stages)[number], string> = {
  queued: 'Triagem',
  in_production: 'Produção',
  qc: 'Qualidade',
  shipped: 'Expedição',
  delivered: 'Entregue',
  rework: 'Retrabalho',
}

const initialConfig: LabConfiguration = {
  kanban_columns: [...stages],
  default_sla_hours: { queued: 8, in_production: 24, qc: 8, shipped: 6, delivered: 1, rework: 12 },
  printers_3d: [{ id: 'printer-1', name: 'Printer 01', model: 'LCD 8K', status: 'online' }],
  thermoforming_machines: [{ id: 'thermo-1', name: 'Termo 01', status: 'online' }],
  default_materials: { resin_type: 'Resina Dental Clear', plate_thickness: 1 },
  qc_checklist: [{ id: 'qc-1', label: 'Conferir bordas e polimento', required: true }],
  require_photos_per_stage: true,
}

export default function LabSettings() {
  const [config, setConfig] = useState<LabConfiguration>(initialConfig)

  return (
    <SettingsSection title="Laboratório" description="SLA por etapa, equipamentos, materiais padrão e checklist de qualidade.">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {stages.map((stage) => (
          <label key={stage} className="space-y-1 text-sm font-medium text-slate-700">
            SLA {stageLabels[stage]} (horas)
            <Input
              type="number"
              min={1}
              value={config.default_sla_hours[stage]}
              onChange={(event) => setConfig((current) => ({ ...current, default_sla_hours: { ...current.default_sla_hours, [stage]: Number(event.target.value) } }))}
            />
          </label>
        ))}
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {config.printers_3d.map((printer) => (
          <div key={printer.id} className="rounded-lg border border-slate-200 p-4">
            <p className="font-semibold text-slate-900">{printer.name}</p>
            <p className="text-sm text-slate-500">{printer.model} · {printer.status}</p>
          </div>
        ))}
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-4 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={config.require_photos_per_stage} onChange={(event) => setConfig((current) => ({ ...current, require_photos_per_stage: event.target.checked }))} />
          Exigir fotos por etapa
        </label>
      </div>
      <div className="mt-5 flex justify-end">
        <Button>Salvar laboratório</Button>
      </div>
    </SettingsSection>
  )
}
