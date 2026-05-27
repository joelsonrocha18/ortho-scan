import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../../../app/ToastProvider'
import { can } from '../../../../auth/permissions'
import Badge from '../../../../components/Badge'
import Button from '../../../../components/Button'
import Card from '../../../../components/Card'
import Input from '../../../../components/Input'
import { getCurrentUser } from '../../../../lib/auth'
import { useDb } from '../../../../lib/useDb'
import {
  listIntegrationSettingsRemote,
  saveIntegrationSettingRemote,
  type IntegrationConfig,
  type IntegrationSetting,
} from '../../../../repo/integrationSettingsRepo'
import type { Integration } from '../types'
import SettingsSection from './SettingsSection'

type IntegrationField = {
  key: string
  label: string
  placeholder: string
  type?: 'text' | 'password' | 'url'
  required?: boolean
}

const STORAGE_KEY = 'orthoscan_integrations_v1'

const integrationCatalog: IntegrationSetting[] = [
  { id: 'trios', name: '3Shape TRIOS', type: 'scanner', status: 'disconnected', config: {}, logs: [] },
  { id: 'itero', name: 'iTero', type: 'scanner', status: 'disconnected', config: {}, logs: [] },
  { id: 'medit', name: 'Medit', type: 'scanner', status: 'disconnected', config: {}, logs: [] },
  { id: 'google_drive', name: 'Google Drive', type: 'cloud', status: 'disconnected', config: {}, logs: [] },
  { id: 'whatsapp', name: 'WhatsApp Business', type: 'messaging', status: 'disconnected', config: {}, logs: [] },
]

const fieldsByType: Record<Integration['type'], IntegrationField[]> = {
  scanner: [
    { key: 'endpointUrl', label: 'Endpoint/API URL', placeholder: 'https://api.exemplo.com', type: 'url', required: true },
    { key: 'accountId', label: 'Conta/cliente', placeholder: 'ID da conta ou laboratório', required: true },
    { key: 'apiKey', label: 'Token/API key', placeholder: 'Cole o token de integração', type: 'password', required: true },
    { key: 'inboxFolder', label: 'Pasta de entrada', placeholder: 'Ex: scans/importados' },
  ],
  cloud: [
    { key: 'accountEmail', label: 'Conta Google', placeholder: 'conta@gmail.com', required: true },
    { key: 'folderId', label: 'ID da pasta', placeholder: 'ID da pasta do Drive', required: true },
    { key: 'accessToken', label: 'Token/OAuth', placeholder: 'Cole o token gerado', type: 'password', required: true },
  ],
  messaging: [
    { key: 'baseUrl', label: 'URL da API', placeholder: 'https://api.whatsapp.com.br', type: 'url', required: true },
    { key: 'phoneNumber', label: 'Número remetente', placeholder: '5586999999999', required: true },
    { key: 'apiToken', label: 'Token de acesso', placeholder: 'Cole o token do provedor', type: 'password', required: true },
    { key: 'webhookSecret', label: 'Segredo webhook', placeholder: 'Opcional' },
  ],
  erp: [
    { key: 'endpointUrl', label: 'Endpoint/API URL', placeholder: 'https://api.erp.com', type: 'url', required: true },
    { key: 'apiKey', label: 'Token/API key', placeholder: 'Cole o token de integração', type: 'password', required: true },
  ],
  payment: [
    { key: 'merchantId', label: 'Conta/merchant', placeholder: 'ID da conta', required: true },
    { key: 'apiKey', label: 'Token/API key', placeholder: 'Cole o token de integração', type: 'password', required: true },
  ],
}

function loadIntegrations() {
  if (typeof window === 'undefined') return integrationCatalog
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return integrationCatalog

  try {
    const saved = JSON.parse(raw) as Partial<IntegrationSetting>[]
    if (!Array.isArray(saved)) return integrationCatalog
    return integrationCatalog.map((item) => {
      const match = saved.find((savedItem) => savedItem.id === item.id)
      if (!match) return item
      return {
        ...item,
        status: match.status ?? item.status,
        config: match.config ?? {},
        lastSync: typeof match.lastSync === 'string' ? match.lastSync : undefined,
        logs: Array.isArray(match.logs) ? match.logs : [],
      }
    })
  } catch {
    return integrationCatalog
  }
}

function mergeWithCatalog(integrations: IntegrationSetting[]) {
  return integrationCatalog.map((item) => {
    const match = integrations.find((savedItem) => savedItem.id === item.id)
    return match ? { ...item, ...match, config: match.config ?? {}, logs: match.logs ?? [] } : item
  })
}

function saveIntegrations(integrations: IntegrationSetting[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(integrations))
}

function addLog(integration: IntegrationSetting, message: string): IntegrationSetting {
  return {
    ...integration,
    logs: [
      {
        id: `log_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        at: new Date().toISOString(),
        message,
      },
      ...integration.logs,
    ].slice(0, 20),
  }
}

function statusLabel(status: Integration['status']) {
  if (status === 'connected') return 'Conectado'
  if (status === 'error') return 'Erro'
  return 'Desconectado'
}

export default function IntegrationsSettings() {
  const { db } = useDb()
  const { addToast } = useToast()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'settings.integrations.write') || can(currentUser, 'settings.write')
  const [integrations, setIntegrations] = useState(loadIntegrations)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [logsId, setLogsId] = useState<string | null>(null)
  const [form, setForm] = useState<IntegrationConfig>({})
  const [formError, setFormError] = useState('')

  const editingIntegration = useMemo(
    () => integrations.find((integration) => integration.id === editingId) ?? null,
    [editingId, integrations],
  )
  const logsIntegration = useMemo(
    () => integrations.find((integration) => integration.id === logsId) ?? null,
    [integrations, logsId],
  )

  useEffect(() => {
    let active = true
    void listIntegrationSettingsRemote().then((result) => {
      if (!active || !result.ok) return
      const next = mergeWithCatalog(result.integrations)
      setIntegrations(next)
      saveIntegrations(next)
    })
    return () => {
      active = false
    }
  }, [])

  function persist(next: IntegrationSetting[], changed?: IntegrationSetting) {
    setIntegrations(next)
    saveIntegrations(next)
    if (changed) {
      void saveIntegrationSettingRemote(changed).then((result) => {
        if (!result.ok) {
          addToast({ type: 'error', title: 'Falha ao salvar integração no Firebase', message: result.error })
        }
      })
    }
  }

  function openConnect(integration: IntegrationSetting) {
    setEditingId(integration.id)
    setForm(integration.config)
    setFormError('')
  }

  function disconnect(integration: IntegrationSetting) {
    if (!canWrite) return
    const confirmed = window.confirm(`Desconectar ${integration.name}?`)
    if (!confirmed) return
    let changed: IntegrationSetting | undefined
    const next = integrations.map((item) =>
      item.id === integration.id
        ? (changed = addLog({ ...item, status: 'disconnected', lastSync: undefined }, 'Integração desconectada manualmente.'))
        : item,
    )
    persist(next, changed)
    addToast({ type: 'success', title: 'Integração desconectada' })
  }

  function saveConnection() {
    if (!editingIntegration || !canWrite) return
    const fields = fieldsByType[editingIntegration.type]
    const missing = fields.find((field) => field.required && !form[field.key]?.trim())
    if (missing) {
      setFormError(`Informe: ${missing.label}.`)
      return
    }

    const now = new Date().toISOString()
    let changed: IntegrationSetting | undefined
    const next = integrations.map((item) => {
      if (item.id !== editingIntegration.id) return item
      changed = addLog(
        {
          ...item,
          status: 'connected',
          config: form,
          lastSync: now,
        },
        'Credenciais salvas e integração conectada.',
      )
      return changed
    })
    persist(next, changed)
    setEditingId(null)
    setForm({})
    setFormError('')
    addToast({ type: 'success', title: 'Integração conectada', message: editingIntegration.name })
  }

  return (
    <SettingsSection title="Integrações" description="Conectores externos para scanners, nuvem, mensagens e ERP.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrations.map((integration) => (
          <article key={integration.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">{integration.name}</h3>
                <p className="text-sm capitalize text-slate-500">{integration.type}</p>
              </div>
              <Badge tone={integration.status === 'connected' ? 'success' : integration.status === 'error' ? 'danger' : 'neutral'}>
                {statusLabel(integration.status)}
              </Badge>
            </div>
            {integration.lastSync ? (
              <p className="mt-3 text-xs text-slate-500">Última conexão: {new Date(integration.lastSync).toLocaleString('pt-BR')}</p>
            ) : null}
            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                variant={integration.status === 'connected' ? 'secondary' : 'primary'}
                disabled={!canWrite}
                onClick={() => (integration.status === 'connected' ? disconnect(integration) : openConnect(integration))}
              >
                {integration.status === 'connected' ? 'Desconectar' : 'Conectar'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLogsId(integration.id)}>
                Logs
              </Button>
            </div>
          </article>
        ))}
      </div>

      {editingIntegration ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <Card className="w-full max-w-2xl rounded-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-slate-950">Conectar {editingIntegration.name}</h3>
                <p className="mt-1 text-sm text-slate-600">Preencha os dados fornecidos pelo provedor da integração.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                Fechar
              </Button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {fieldsByType[editingIntegration.type].map((field) => (
                <label key={field.key} className="space-y-1 text-sm font-medium text-slate-700">
                  {field.label}
                  {field.required ? ' *' : ''}
                  <Input
                    type={field.type ?? 'text'}
                    value={form[field.key] ?? ''}
                    placeholder={field.placeholder}
                    onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                </label>
              ))}
            </div>

            {formError ? <p className="mt-4 text-sm font-medium text-red-600">{formError}</p> : null}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditingId(null)}>
                Cancelar
              </Button>
              <Button onClick={saveConnection}>Salvar conexão</Button>
            </div>
          </Card>
        </div>
      ) : null}

      {logsIntegration ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <Card className="w-full max-w-2xl rounded-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-slate-950">Logs - {logsIntegration.name}</h3>
                <p className="mt-1 text-sm text-slate-600">Histórico local da integração.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setLogsId(null)}>
                Fechar
              </Button>
            </div>

            <div className="mt-5 max-h-80 space-y-2 overflow-y-auto">
              {logsIntegration.logs.map((log) => (
                <div key={log.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <p className="font-medium text-slate-900">{log.message}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(log.at).toLocaleString('pt-BR')}</p>
                </div>
              ))}
              {logsIntegration.logs.length === 0 ? <p className="text-sm text-slate-500">Nenhum log registrado ainda.</p> : null}
            </div>
          </Card>
        </div>
      ) : null}
    </SettingsSection>
  )
}
