import type { LabOrder } from '../../domain/entities/LabOrder'

type BuildLabStickerPrintHtmlInput = {
  item: LabOrder
  dentistShort: string
  patientName: string
  isInternalArrimo: boolean
  totalLabels: number
  assetBaseUrl: string
  complement?: string
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function normalizeStickerSpaces(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function stripProfessionalTitle(value: string) {
  return normalizeStickerSpaces(value).replace(/^(dr|dra)\.?\s+/i, '').trim()
}

function firstWord(value: string) {
  return normalizeStickerSpaces(value).split(' ')[0] ?? ''
}

export function toDentistShortLabelByGender(value: string, gender?: 'masculino' | 'feminino') {
  const clean = stripProfessionalTitle(value)
  const firstName = firstWord(clean)
  const prefix = gender === 'feminino' ? 'Dra.' : 'Dr.'
  return firstName ? `${prefix} ${firstName}` : prefix
}

export function toPatientStickerName(value: string) {
  const parts = normalizeStickerSpaces(value).split(' ').filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? '-'
  if (parts.length >= 3) return `${parts[0]} ${parts[1]}`
  return `${parts[0]} ${parts[parts.length - 1]}`
}

export function buildLabStickerPrintHtml({
  item,
  dentistShort,
  patientName,
  isInternalArrimo,
  totalLabels,
  assetBaseUrl,
  complement,
}: BuildLabStickerPrintHtmlInput) {
  const safeTotal = Math.max(1, Math.trunc(totalLabels || 1))
  const backgroundImage = isInternalArrimo ? 'sticker-arrimo-interno.png' : 'sticker-orthoscan-externo.png'
  const backgroundUrl = `${assetBaseUrl.replace(/\/$/, '')}/brand/${backgroundImage}`
  const cleanedComplement = complement && complement.length <= 26 ? complement : ''
  const labelBlock = (alignerNumber: number) => `
    <div class="label ${isInternalArrimo ? 'is-internal' : 'is-external'}">
      <div class="art">
        <img class="bg" src="${escapeHtml(backgroundUrl)}" alt="Etiqueta" />
        <div class="content">
          <div class="line">${escapeHtml(dentistShort)}</div>
          <div class="line">${escapeHtml(patientName)}</div>
          <div class="line">${escapeHtml(`Alinhador ${alignerNumber}`)}</div>
          ${cleanedComplement ? `<div class="line small">${escapeHtml(cleanedComplement)}</div>` : ''}
        </div>
      </div>
    </div>
  `
  const labelsHtml = Array.from({ length: safeTotal }, (_, index) => labelBlock(index + 1)).join('')

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Etiquetas - ${escapeHtml(item.patientName)}</title>
  <style>
    :root {
      --label-size: 62mm;
      --safe-inset-x: 2.4mm;
      --safe-inset-y: 3.8mm;
      --text-x: 3.2mm;
      --text-y: 20.2mm;
      --text-w: 52.4mm;
      --text-h: 17.2mm;
      --font-main: 3.20mm;
      --font-small: 2.70mm;
      --line-gap: 0.48mm;
    }

    @media print {
      @page { size: 62mm 62mm; margin: 0; }
      html,
      body {
        margin: 0;
        padding: 0;
        width: var(--label-size);
      }
      .screen-only { display: none !important; }
    }

    @media screen {
      html,
      body {
        margin: 0;
        padding: 0;
      }
      body { background: #e5e7eb; }
      .sheet { padding: 4mm; }
      .screen-only {
        width: var(--label-size);
        padding: 3mm 4mm 0;
        color: #334155;
        font-family: Arial, sans-serif;
        font-size: 9pt;
        line-height: 1.35;
      }
    }

    body {
      font-family: Verdana, Arial, sans-serif;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      overflow: visible;
      background: #fff;
    }

    .sheet {
      width: var(--label-size);
    }

    .label {
      position: relative;
      display: block;
      width: var(--label-size);
      height: var(--label-size);
      overflow: hidden;
      background: #fff;
      page-break-after: always;
      break-after: page;
    }

    .label:last-child {
      page-break-after: auto;
      break-after: auto;
    }

    .label.is-internal {
      --text-x: 3.0mm;
      --text-y: 19.2mm;
      --text-w: 52.8mm;
      --text-h: 18.2mm;
      --font-main: 4.10mm;
      --font-small: 3.00mm;
      --line-gap: 0.62mm;
    }

    .label.is-external {
      --text-x: 3.2mm;
      --text-y: 20.2mm;
      --text-w: 52.4mm;
      --text-h: 17.2mm;
      --font-main: 2.95mm;
      --font-small: 2.70mm;
      --line-gap: 0.42mm;
    }

    .art {
      position: absolute;
      left: var(--safe-inset-x);
      top: var(--safe-inset-y);
      width: calc(var(--label-size) - (var(--safe-inset-x) * 2));
      height: calc(var(--label-size) - (var(--safe-inset-y) * 2));
      overflow: hidden;
      background: #fff;
    }

    .bg {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: fill;
      image-rendering: -webkit-optimize-contrast;
    }

    .content {
      position: absolute;
      left: var(--text-x);
      top: var(--text-y);
      width: var(--text-w);
      height: var(--text-h);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      line-height: 1.18;
      font-weight: 700;
      font-size: var(--font-main);
      letter-spacing: 0;
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: none;
    }

    .content .line {
      margin: var(--line-gap) 0;
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .content .small {
      font-size: var(--font-small);
    }
  </style>
</head>
<body>
  <main class="sheet">
    ${labelsHtml}
  </main>
  <p class="screen-only">Modelo 62x62 com logo e QR code. Na janela de impressao, use escala 100% e margens desativadas.</p>
</body>
</html>`
}
