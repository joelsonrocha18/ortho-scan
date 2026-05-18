type PrintCaseLabOrderInput = {
  caseLabel: string
  patientName: string
  patientBirthDateLabel: string
  clinicName?: string
  dentistLabel: string
  requesterLabel: string
  productLabel: string
  planLabel: string
  changeEveryDays: number
  deliveredToDentistUpperValue: string
  deliveredToDentistLowerValue: string
  deliveredToDentistUpperCaption: string
  deliveredToDentistLowerCaption: string
  emittedBy: string
  emitOrigin: string
  issueDate: Date
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function printCaseLabOrder(input: PrintCaseLabOrderInput) {
  const issueDateLabel = input.issueDate.toLocaleString('pt-BR')
  const expectedDeliveryDate = new Date(input.issueDate)
  expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + 10)
  const expectedDeliveryLabel = expectedDeliveryDate.toLocaleDateString('pt-BR')
  const deliveryControlRowsHtml = Array.from({ length: 5 }, () => `
    <div class="delivery-record">
      <span class="delivery-label">Entregues alinhadores</span>
      <span class="delivery-qty">____ SUP - ____ INF</span>
      <span class="delivery-date">____/____/____</span>
    </div>
  `).join('')

  const html = `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>Ordem de Servico Inicial</title>
        <style>
          @page { size: A4; margin: 14mm; }
          body { font-family: Arial, sans-serif; color: #0f172a; font-size: 12px; margin: 0; }
          .header { display: grid; grid-template-columns: 250px 1fr; gap: 12px; border: 1px solid #1e293b; padding: 10px; margin-bottom: 10px; }
          .brand { border-right: 1px solid #cbd5e1; padding-right: 10px; }
          .brand img { max-width: 225px; max-height: 72px; object-fit: contain; display: block; margin-bottom: 6px; }
          .brand p { margin: 2px 0; font-size: 11px; color: #475569; }
          .doc h1 { margin: 0; font-size: 18px; letter-spacing: 0.3px; }
          .doc p { margin: 3px 0; color: #334155; font-size: 11px; }
          .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
          .meta-box { border: 1px solid #94a3b8; border-radius: 4px; padding: 7px; }
          .meta-label { font-size: 10px; text-transform: uppercase; color: #475569; margin-bottom: 2px; letter-spacing: .3px; }
          .meta-value { font-weight: 700; color: #0f172a; }
          .delivery-summary { border: 1px solid #14b8a6; border-radius: 6px; background: #f0fdfa; padding: 10px; margin-bottom: 12px; }
          .delivery-summary-header { margin: 0 0 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; color: #0f766e; }
          .delivery-summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
          .delivery-summary-item { border: 1px solid #99f6e4; border-radius: 4px; background: #ffffff; padding: 8px; }
          .delivery-summary-label { margin: 0 0 4px; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; color: #0f766e; }
          .delivery-summary-value { margin: 0; font-size: 18px; font-weight: 700; color: #134e4a; }
          .delivery-summary-caption { margin: 2px 0 0; font-size: 10px; color: #0f766e; }
          .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 18px; }
          .sign-box { border: 1px solid #94a3b8; border-radius: 4px; padding: 8px; min-height: 92px; }
          .sign-title { margin: 0 0 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #334155; }
          .line { margin-top: 26px; border-top: 1px solid #64748b; font-size: 11px; padding-top: 4px; color: #334155; }
          .delivery-records { margin-top: 12px; display: grid; gap: 6px; }
          .delivery-record { display: flex; align-items: flex-end; gap: 8px; font-size: 10px; color: #334155; white-space: nowrap; }
          .delivery-label { min-width: 118px; }
          .delivery-qty, .delivery-date { display: inline-block; border-bottom: 1px solid #64748b; padding-bottom: 2px; line-height: 1.2; }
          .delivery-qty { min-width: 122px; }
          .delivery-date { min-width: 92px; text-align: center; }
          .emit { margin-top: 14px; font-size: 10px; color: #475569; text-align: left; border-top: 1px solid #cbd5e1; padding-top: 8px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="brand">
            <img src="${window.location.origin}/brand/orthoscan-submark-light.jpg" alt="Orthoscan" />
            <p>Odontologia Digital</p>
          </div>
          <div class="doc">
            <h1>ORDEM DE SERVICO INICIAL (O.S)</h1>
            <p><strong>Data/Hora:</strong> ${escapeHtml(issueDateLabel)}</p>
            <p><strong>Nº Caso:</strong> ${escapeHtml(input.caseLabel)}</p>
          </div>
        </div>

        <div class="meta">
          <div class="meta-box"><div class="meta-label">Paciente</div><div class="meta-value">${escapeHtml(input.patientName)}</div></div>
          <div class="meta-box"><div class="meta-label">Data de nascimento</div><div class="meta-value">${escapeHtml(input.patientBirthDateLabel)}</div></div>
          <div class="meta-box"><div class="meta-label">Clinica</div><div class="meta-value">${escapeHtml(input.clinicName ?? '-')}</div></div>
          <div class="meta-box"><div class="meta-label">Dentista responsável</div><div class="meta-value">${escapeHtml(input.dentistLabel)}</div></div>
          <div class="meta-box"><div class="meta-label">Solicitante</div><div class="meta-value">${escapeHtml(input.requesterLabel)}</div></div>
          <div class="meta-box"><div class="meta-label">Produto</div><div class="meta-value">${escapeHtml(input.productLabel)}</div></div>
          <div class="meta-box"><div class="meta-label">Planejamento</div><div class="meta-value">${escapeHtml(input.planLabel)}</div></div>
          <div class="meta-box"><div class="meta-label">Troca</div><div class="meta-value">${escapeHtml(String(input.changeEveryDays))} dias</div></div>
          <div class="meta-box"><div class="meta-label">Data prevista entrega ao profissional</div><div class="meta-value">${escapeHtml(expectedDeliveryLabel)}</div></div>
        </div>

        <div class="delivery-summary">
          <p class="delivery-summary-header">Placas entregues ao dentista</p>
          <div class="delivery-summary-grid">
            <div class="delivery-summary-item">
              <p class="delivery-summary-label">Superior</p>
              <p class="delivery-summary-value">${escapeHtml(input.deliveredToDentistUpperValue)}</p>
              <p class="delivery-summary-caption">${escapeHtml(input.deliveredToDentistUpperCaption)}</p>
            </div>
            <div class="delivery-summary-item">
              <p class="delivery-summary-label">Inferior</p>
              <p class="delivery-summary-value">${escapeHtml(input.deliveredToDentistLowerValue)}</p>
              <p class="delivery-summary-caption">${escapeHtml(input.deliveredToDentistLowerCaption)}</p>
            </div>
          </div>
        </div>

        <div class="sign-grid">
          <div class="sign-box">
            <p class="sign-title">Entrega ao laboratório</p>
            <div class="line">Assinatura: ____________________________________</div>
            <div class="line">Data: ____/____/________</div>
          </div>
          <div class="sign-box">
            <p class="sign-title">Entrega ao dentista</p>
            <div class="line">Assinatura: ____________________________________</div>
            <div class="line">Data: ____/____/________</div>
            <div class="delivery-records">${deliveryControlRowsHtml}</div>
          </div>
        </div>

        <div class="emit">Emitido por ${escapeHtml(input.emittedBy)} Através da plataforma Orthoscan Laboratório Em ${escapeHtml(issueDateLabel)} - ${escapeHtml(input.emitOrigin)}</div>
      </body>
    </html>
  `

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const printUrl = URL.createObjectURL(blob)
  const popup = window.open(printUrl, '_blank')
  if (!popup) {
    throw new Error('Não foi possível abrir a janela de impressão.')
  }

  const releaseUrl = () => {
    try {
      URL.revokeObjectURL(printUrl)
    } catch {
      // O navegador pode revogar o Object URL antes do callback tardio de impressão.
    }
  }

  const onLoaded = () => {
    popup.focus()
    popup.print()
    setTimeout(releaseUrl, 10_000)
  }

  if (popup.document.readyState === 'complete') {
    onLoaded()
  } else {
    popup.addEventListener('load', onLoaded, { once: true })
  }
}
