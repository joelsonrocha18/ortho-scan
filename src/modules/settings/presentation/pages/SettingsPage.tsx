import * as Tabs from '@radix-ui/react-tabs'
import { Beaker, Bell, Building2, CreditCard, Palette, Plug, Users } from 'lucide-react'
import { can, type Permission } from '../../../../auth/permissions'
import { getCurrentUser } from '../../../../lib/auth'
import { useDb } from '../../../../lib/useDb'
import AppShell from '../../../../layouts/AppShell'
import type { SettingsNavItem, SettingsTab } from '../types'
import AppearanceSettings from '../components/AppearanceSettings'
import BillingSettings from '../components/BillingSettings'
import GeneralSettings from '../components/GeneralSettings'
import IntegrationsSettings from '../components/IntegrationsSettings'
import LabSettings from '../components/LabSettings'
import NotificationSettings from '../components/NotificationSettings'
import UsersSettings from '../components/UsersSettings'

const settingsNav: Array<SettingsNavItem & { icon: typeof Building2 }> = [
  { id: 'general', label: 'Geral', icon: Building2, permission: 'settings.general.read' },
  { id: 'users', label: 'Usuários', icon: Users, permission: 'settings.users.read' },
  { id: 'lab', label: 'Laboratório', icon: Beaker, permission: 'settings.lab.read' },
  { id: 'notifications', label: 'Notificações', icon: Bell, permission: 'settings.notifications.read' },
  { id: 'integrations', label: 'Integrações', icon: Plug, permission: 'settings.integrations.read' },
  { id: 'billing', label: 'Faturamento', icon: CreditCard, permission: 'settings.billing.read' },
  { id: 'appearance', label: 'Aparência', icon: Palette, permission: 'settings.appearance.read' },
]

function renderTab(tab: SettingsTab) {
  if (tab === 'general') return <GeneralSettings />
  if (tab === 'users') return <UsersSettings />
  if (tab === 'lab') return <LabSettings />
  if (tab === 'notifications') return <NotificationSettings />
  if (tab === 'integrations') return <IntegrationsSettings />
  if (tab === 'billing') return <BillingSettings />
  return <AppearanceSettings />
}

function canReadSettings(permission: Permission, user: ReturnType<typeof getCurrentUser>) {
  return can(user, permission) || can(user, 'settings.read')
}

export default function SettingsPage() {
  const { db } = useDb()
  const currentUser = getCurrentUser(db)
  const visibleTabs = settingsNav.filter((item) => canReadSettings(item.permission, currentUser))
  const defaultTab = visibleTabs[0]?.id ?? 'general'

  return (
    <AppShell breadcrumb={['Configurações']}>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-950">Configurações</h1>
        <p className="mt-1 text-sm text-slate-600">Administre clínica, equipe, laboratório, integrações e preferências da conta.</p>
      </div>

      {visibleTabs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Seu perfil não possui acesso às configurações.</div>
      ) : (
        <Tabs.Root defaultValue={defaultTab} className="grid gap-5 lg:grid-cols-[240px_1fr]">
          <Tabs.List className="flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2 lg:flex-col lg:overflow-visible" aria-label="Abas de configurações">
            {visibleTabs.map((item) => {
              const Icon = item.icon
              return (
                <Tabs.Trigger
                  key={item.id}
                  value={item.id}
                  className="inline-flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 outline-none transition hover:bg-slate-50 data-[state=active]:bg-baby-50 data-[state=active]:text-brand-700"
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Tabs.Trigger>
              )
            })}
          </Tabs.List>
          <div className="min-w-0">
            {visibleTabs.map((item) => (
              <Tabs.Content key={item.id} value={item.id} className="outline-none">
                {renderTab(item.id)}
              </Tabs.Content>
            ))}
          </div>
        </Tabs.Root>
      )}
    </AppShell>
  )
}
