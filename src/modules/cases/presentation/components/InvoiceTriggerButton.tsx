import Button from '../../../../components/Button'

type LabStage = 'triagem' | 'setup' | 'impressao' | 'termoformagem' | 'acabamento' | 'expedicao'

type InvoiceTriggerButtonProps = {
  caseId: string
  status: LabStage
  onInvoice: () => void
}

export function InvoiceTriggerButton({ caseId: _caseId, status, onInvoice }: InvoiceTriggerButtonProps) {
  if (status !== 'expedicao') return null

  return (
    <Button onClick={onInvoice} variant="primary">
      Gerar Faturamento
    </Button>
  )
}
