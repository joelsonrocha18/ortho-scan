import { useState } from 'react'
import { Upload } from 'lucide-react'
import Button from '../../../../components/Button'
import Input from '../../../../components/Input'
import { uploadFile } from '../../../../shared/infra/firebaseStorageService'
import type { ClinicSettings } from '../types'
import SettingsSection from './SettingsSection'

const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']

const initialSettings: ClinicSettings = {
  name: '',
  cnpj: '',
  phone: '',
  email: '',
  address: { street: '', number: '', neighborhood: '', city: '', state: '', zipCode: '' },
  working_hours: Object.fromEntries(days.map((day) => [day, { open: '08:00', close: '18:00', enabled: day !== 'Domingo' }])),
  timezone: 'America/Sao_Paulo',
}

export default function GeneralSettings() {
  const [settings, setSettings] = useState<ClinicSettings>(initialSettings)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)

  async function handleLogoUpload(file: File) {
    setUploadProgress(0)
    const result = await uploadFile(file, `clinics/default/settings/logo-${Date.now()}-${file.name}`, setUploadProgress)
    setSettings((current) => ({ ...current, logo_url: result.url }))
    setUploadProgress(null)
  }

  return (
    <SettingsSection title="Dados da clínica" description="Cadastro, endereço, logo e horário de funcionamento.">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-700">
          Nome da clínica
          <Input value={settings.name} onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-700">
          CNPJ
          <Input value={settings.cnpj} onChange={(event) => setSettings((current) => ({ ...current, cnpj: event.target.value }))} />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-700">
          Telefone
          <Input value={settings.phone} onChange={(event) => setSettings((current) => ({ ...current, phone: event.target.value }))} />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-700">
          E-mail
          <Input type="email" value={settings.email} onChange={(event) => setSettings((current) => ({ ...current, email: event.target.value }))} />
        </label>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="rounded-lg border border-dashed border-slate-300 p-4">
          <p className="text-sm font-medium text-slate-800">Logo da clínica</p>
          <p className="mt-1 text-sm text-slate-500">{settings.logo_url ? 'Logo enviado para Firebase Storage.' : 'PNG ou JPG com fundo transparente recomendado.'}</p>
          {uploadProgress !== null ? <p className="mt-2 text-sm text-brand-600">Enviando: {Math.round(uploadProgress)}%</p> : null}
        </div>
        <label>
          <input className="sr-only" type="file" accept="image/png,image/jpeg" onChange={(event) => event.target.files?.[0] && void handleLogoUpload(event.target.files[0])} />
          <span className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border border-baby-200 bg-baby-50 px-4 text-sm font-semibold text-brand-700 hover:bg-baby-100">
            <Upload className="mr-2 h-4 w-4" />
            Enviar logo
          </span>
        </label>
      </div>

      <div className="mt-5 grid gap-3">
        {days.map((day) => {
          const current = settings.working_hours[day]
          return (
            <div key={day} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={current.enabled}
                  onChange={(event) => setSettings((value) => ({ ...value, working_hours: { ...value.working_hours, [day]: { ...current, enabled: event.target.checked } } }))}
                />
                {day}
              </label>
              <Input type="time" value={current.open} onChange={(event) => setSettings((value) => ({ ...value, working_hours: { ...value.working_hours, [day]: { ...current, open: event.target.value } } }))} />
              <Input type="time" value={current.close} onChange={(event) => setSettings((value) => ({ ...value, working_hours: { ...value.working_hours, [day]: { ...current, close: event.target.value } } }))} />
              <span className="text-sm text-slate-500">{current.enabled ? 'Ativo' : 'Fechado'}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-5 flex justify-end">
        <Button>Salvar dados</Button>
      </div>
    </SettingsSection>
  )
}
