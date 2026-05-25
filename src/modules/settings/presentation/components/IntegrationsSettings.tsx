import Badge from '../../../../components/Badge'
import Button from '../../../../components/Button'
import type { Integration } from '../types'
import SettingsSection from './SettingsSection'

const availableIntegrations: Integration[] = [
  { id: 'trios', name: '3Shape TRIOS', type: 'scanner', status: 'disconnected', config: {} },
  { id: 'itero', name: 'iTero', type: 'scanner', status: 'disconnected', config: {} },
  { id: 'medit', name: 'Medit', type: 'scanner', status: 'connected', config: {} },
  { id: 'google_drive', name: 'Google Drive', type: 'cloud', status: 'disconnected', config: {} },
  { id: 'whatsapp', name: 'WhatsApp Business', type: 'messaging', status: 'error', config: {} },
]

export default function IntegrationsSettings() {
  return (
    <SettingsSection title="Integrações" description="Conectores externos para scanners, nuvem, mensagens e ERP.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {availableIntegrations.map((integration) => (
          <article key={integration.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">{integration.name}</h3>
                <p className="text-sm capitalize text-slate-500">{integration.type}</p>
              </div>
              <Badge tone={integration.status === 'connected' ? 'success' : integration.status === 'error' ? 'danger' : 'neutral'}>
                {integration.status === 'connected' ? 'Conectado' : integration.status === 'error' ? 'Erro' : 'Desconectado'}
              </Badge>
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant={integration.status === 'connected' ? 'secondary' : 'primary'}>
                {integration.status === 'connected' ? 'Desconectar' : 'Conectar'}
              </Button>
              <Button size="sm" variant="ghost">Logs</Button>
            </div>
          </article>
        ))}
      </div>
    </SettingsSection>
  )
}
