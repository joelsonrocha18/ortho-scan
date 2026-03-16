import { loadExcelJS } from './loadExcelJS'

export type AlignerTreatmentReportRow = {
  caseCode: string
  patientName: string
  dentistName: string
  plannedTreatment: string
  changeDays: number | ''
  status: string
  originLabel: string
  deliveredToDentist: string
  currentTray: string
  treatmentStartDate?: string
  lastChangeDate?: string
  nextChangeDate?: string
}

const COLUMN_HEADERS = [
  'Numero caso',
  'nome do paciente',
  'nome do dentista',
  'tratamento planejado',
  'Dias de troca',
  'Status',
  'Interno/Externo',
  'placas entregue ao dentista',
  'placa atual',
  'data de inicio tratamento',
  'data da ultima troca',
  'data da proxima troca',
]

const COLUMN_WIDTHS = [15, 22.71, 16.43, 20.43, 12.57, 24, 16, 25.86, 13.14, 23.57, 19.14, 20.71]

function toExcelDate(value?: string) {
  if (!value) return ''
  return new Date(`${value.slice(0, 10)}T00:00:00`)
}

export async function downloadAlignerTreatmentReport(rows: AlignerTreatmentReportRow[]) {
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Planilha1')

  worksheet.columns = COLUMN_WIDTHS.map((width) => ({ width }))

  worksheet.mergeCells('A1:L1')
  worksheet.getCell('A1').value = 'Pacientes em tratamento'
  worksheet.getCell('A1').alignment = { horizontal: 'center' }
  worksheet.getCell('A1').font = {
    name: 'Aptos Narrow',
    family: 2,
    size: 11,
  }

  worksheet.addRow(COLUMN_HEADERS)

  rows.forEach((row) => {
    const excelRow = worksheet.addRow([
      row.caseCode,
      row.patientName,
      row.dentistName,
      row.plannedTreatment,
      row.changeDays,
      row.status,
      row.originLabel,
      row.deliveredToDentist,
      row.currentTray,
      toExcelDate(row.treatmentStartDate),
      toExcelDate(row.lastChangeDate),
      toExcelDate(row.nextChangeDate),
    ])
    excelRow.height = 16.5
    excelRow.getCell(5).alignment = { horizontal: 'center' }
    ;[10, 11, 12].forEach((columnIndex) => {
      const cell = excelRow.getCell(columnIndex)
      if (cell.value instanceof Date) {
        cell.numFmt = 'mm-dd-yy'
      }
    })
  })

  const content = await workbook.xlsx.writeBuffer()
  const blob = new Blob([content], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `relatorio_pacientes_em_tratamento_${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
