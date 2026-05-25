import { useState } from 'react'
import Button from '../../../../components/Button'
import Input from '../../../../components/Input'
import type { AppearancePreferences } from '../types'
import SettingsSection from './SettingsSection'

const initialAppearance: AppearancePreferences = {
  theme: 'system',
  primary_color: '#01527d',
  sidebar_collapsed: false,
  density: 'comfortable',
  language: 'pt-BR',
  date_format: 'DD/MM/YYYY',
  time_format: '24h',
}

export default function AppearanceSettings() {
  const [appearance, setAppearance] = useState(initialAppearance)

  return (
    <SettingsSection title="Aparência" description="Tema, cor principal, densidade e formato regional.">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-700">
          Tema
          <select value={appearance.theme} onChange={(event) => setAppearance((current) => ({ ...current, theme: event.target.value as AppearancePreferences['theme'] }))} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm">
            <option value="light">Claro</option>
            <option value="dark">Escuro</option>
            <option value="system">Sistema</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-700">
          Cor principal
          <Input type="color" value={appearance.primary_color} onChange={(event) => setAppearance((current) => ({ ...current, primary_color: event.target.value }))} />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-700">
          Densidade
          <select value={appearance.density} onChange={(event) => setAppearance((current) => ({ ...current, density: event.target.value as AppearancePreferences['density'] }))} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm">
            <option value="comfortable">Confortável</option>
            <option value="compact">Compacta</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-700">
          Idioma
          <select value={appearance.language} onChange={(event) => setAppearance((current) => ({ ...current, language: event.target.value as AppearancePreferences['language'] }))} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm">
            <option value="pt-BR">Português brasileiro</option>
            <option value="en-US">Inglês</option>
            <option value="es-ES">Espanhol</option>
          </select>
        </label>
      </div>
      <div className="mt-5 rounded-lg border border-slate-200 p-4" style={{ borderColor: appearance.primary_color }}>
        <p className="text-sm font-medium text-slate-900">Prévia do tema</p>
        <p className="mt-1 text-sm text-slate-600">Botões, destaques e indicadores usarão a cor principal configurada.</p>
      </div>
      <div className="mt-5 flex justify-end">
        <Button>Salvar aparência</Button>
      </div>
    </SettingsSection>
  )
}
