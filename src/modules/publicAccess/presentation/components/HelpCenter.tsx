import Card from '../../../../components/Card'
import Button from '../../../../components/Button'

export default function HelpCenter({ clinicName }: { clinicName?: string }) {
  return (
    <Card className="rounded-lg bg-white">
      <h2 className="font-semibold text-slate-950">Central de ajuda</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600">Use o alinhador pelo período indicado pela clínica.</div>
        <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600">Remova para comer e higienize antes de recolocar.</div>
        <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600">Envie a selfie de confirmação quando solicitada.</div>
      </div>
      <Button className="mt-4" variant="secondary">Contato com {clinicName ?? 'a clínica'}</Button>
    </Card>
  )
}
