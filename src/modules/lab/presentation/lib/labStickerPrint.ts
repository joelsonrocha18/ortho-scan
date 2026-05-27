import type { LabOrder } from '../../domain/entities/LabOrder'

type BuildLabStickerPrintHtmlInput = {
  item: LabOrder
  productLabel: string
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function compactText(value: unknown, fallback = '-') {
  return String(value ?? '').trim() || fallback
}

function nameSizeClass(name: string) {
  if (name.length > 42) return 'name name--small'
  if (name.length > 30) return 'name name--medium'
  return 'name'
}

export function buildLabStickerPrintHtml({ item, productLabel }: BuildLabStickerPrintHtmlInput) {
  const patientName = compactText(item.patientName, 'Paciente')
  const code = compactText(item.requestCode ?? item.id, 'Sem OS')
  const tray = item.trayNumber ? `Placa #${item.trayNumber}` : 'Placa'
  const arch = item.arch && item.arch !== 'ambos' ? item.arch : ''
  const product = [compactText(productLabel, 'Produto'), arch].filter(Boolean).join(' - ')

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Etiqueta</title>
  <style>
    @page {
      size: 62mm 29mm;
      margin: 0;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      min-height: 100%;
      background: #f3f4f6;
      color: #111827;
      font-family: Arial, Helvetica, sans-serif;
    }

    body {
      padding: 12mm;
    }

    .label {
      width: 62mm;
      height: 29mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 1.15mm;
      padding: 2.2mm 2.8mm;
      border: 0.35mm solid #111827;
      border-radius: 1.4mm;
      background: #ffffff;
      box-shadow: 0 16px 32px rgba(15, 23, 42, 0.18);
    }

    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 2mm;
      border-bottom: 0.25mm solid #111827;
      padding-bottom: 0.9mm;
      line-height: 1;
    }

    .brand {
      font-size: 6.4pt;
      font-weight: 800;
      letter-spacing: 0.18em;
      white-space: nowrap;
    }

    .code {
      max-width: 27mm;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 6.8pt;
      font-weight: 800;
      letter-spacing: 0.02em;
      text-align: right;
    }

    .name {
      min-height: 9.7mm;
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      color: #000000;
      font-size: 10.8pt;
      font-weight: 800;
      line-height: 1.08;
    }

    .name--medium {
      font-size: 9.5pt;
    }

    .name--small {
      font-size: 8.4pt;
    }

    .product {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 7.4pt;
      font-weight: 700;
      line-height: 1.1;
    }

    .bottom {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: end;
      gap: 2mm;
      margin-top: auto;
    }

    .tray {
      font-size: 11pt;
      font-weight: 900;
      line-height: 1;
    }

    .date {
      font-size: 5.8pt;
      font-weight: 700;
      line-height: 1;
      text-align: right;
    }

    .hint {
      width: 62mm;
      margin-top: 4mm;
      color: #475569;
      font-size: 9pt;
      line-height: 1.35;
    }

    @media print {
      html,
      body {
        width: 62mm;
        height: 29mm;
        min-height: 29mm;
        background: #ffffff;
      }

      body {
        padding: 0;
      }

      .label {
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }

      .hint {
        display: none;
      }
    }
  </style>
</head>
<body>
  <section class="label" aria-label="Etiqueta do laboratório">
    <div class="top">
      <div class="brand">ORTHOSCAN</div>
      <div class="code">${escapeHtml(code)}</div>
    </div>
    <div class="${nameSizeClass(patientName)}">${escapeHtml(patientName)}</div>
    <div class="product">${escapeHtml(product)}</div>
    <div class="bottom">
      <div class="tray">${escapeHtml(tray)}</div>
      <div class="date">${escapeHtml(new Date().toLocaleDateString('pt-BR'))}</div>
    </div>
  </section>
  <p class="hint">Use papel de etiqueta 62mm x 29mm, escala 100% e margens desativadas.</p>
</body>
</html>`
}
