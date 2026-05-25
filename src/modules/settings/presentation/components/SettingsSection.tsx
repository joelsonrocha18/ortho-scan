import type { ReactNode } from 'react'
import Card from '../../../../components/Card'

type SettingsSectionProps = {
  title: string
  description: string
  children: ReactNode
  actions?: ReactNode
}

export default function SettingsSection({ title, description, children, actions }: SettingsSectionProps) {
  return (
    <Card className="rounded-lg">
      <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        {actions}
      </div>
      {children}
    </Card>
  )
}
