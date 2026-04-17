import { describe, expect, it } from 'vitest'
import { loadExcelJS } from '../../lib/loadExcelJS'

describe('loadExcelJS', () => {
  it('carrega o módulo e reutiliza a mesma referencia em chamadas seguintes', async () => {
    const first = await loadExcelJS()
    const second = await loadExcelJS()

    expect(first).toBe(second)
    expect(typeof first.Workbook).toBe('function')
  }, 60000)
})

