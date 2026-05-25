import { CreditCard } from 'lucide-react'
import Button from '../../../../components/Button'
import StatCard from '../../../../shared/components/StatCard'
import type { BillingInfo } from '../types'
import SettingsSection from './SettingsSection'

const billing: BillingInfo = {
  plan: 'professional',
  billing_cycle: 'monthly',
  usage: { cases_this_month: 42, cases_limit: 120, storage_used_gb: 18, storage_limit_gb: 100, users_count: 8, users_limit: 20 },
}

export default function BillingSettings() {
  return (
    <SettingsSection title="Faturamento" description="Plano atual, uso da conta e histórico de cobranças.">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Casos no mês" value={`${billing.usage.cases_this_month}/${billing.usage.cases_limit}`} icon={<CreditCard className="h-5 w-5" />} />
        <StatCard title="Storage usado" value={`${billing.usage.storage_used_gb} GB`} change={{ value: 8, direction: 'up' }} />
        <StatCard title="Usuários" value={`${billing.usage.users_count}/${billing.usage.users_limit}`} />
      </div>
      <div className="mt-5 rounded-lg border border-slate-200 p-4">
        <p className="text-sm text-slate-500">Plano atual</p>
        <p className="mt-1 text-xl font-semibold capitalize text-slate-950">{billing.plan}</p>
        <p className="mt-1 text-sm text-slate-600">Cobrança mensal com limites operacionais ativos.</p>
        <div className="mt-4 flex gap-2">
          <Button>Alterar plano</Button>
          <Button variant="secondary">Atualizar pagamento</Button>
        </div>
      </div>
    </SettingsSection>
  )
}
