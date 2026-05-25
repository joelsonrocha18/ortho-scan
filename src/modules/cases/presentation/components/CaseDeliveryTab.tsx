import { Truck } from 'lucide-react'
import Card from '../../../../components/Card'
import Button from '../../../../components/Button'

type CaseDeliveryTabProps = {
  deliveryMethod?: 'pickup' | 'courier' | 'mail'
  trackingCode?: string
}

export default function CaseDeliveryTab({ deliveryMethod = 'pickup', trackingCode }: CaseDeliveryTabProps) {
  return (
    <Card className="rounded-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Entrega</h2>
          <p className="mt-1 text-sm text-slate-600">Método, rastreamento, comprovantes e notificação ao dentista.</p>
        </div>
        <Truck className="h-6 w-6 text-brand-600" />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm text-slate-500">Método</p>
          <p className="font-semibold text-slate-950">{deliveryMethod === 'pickup' ? 'Retirada' : deliveryMethod === 'courier' ? 'Motoboy' : 'Correios'}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm text-slate-500">Rastreamento</p>
          <p className="font-semibold text-slate-950">{trackingCode ?? 'Não informado'}</p>
        </div>
        <Button variant="secondary">Enviar notificação</Button>
      </div>
    </Card>
  )
}
