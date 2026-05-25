import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, Download, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import Button from '../../components/Button'
import { cn } from '../../lib/cn'

export type DataTableColumn<T> = ColumnDef<T>

type DataTableProps<T extends object> = {
  data: T[]
  columns: DataTableColumn<T>[]
  loading?: boolean
  pagination?: {
    page: number
    pageSize: number
    total: number
    onPageChange: (page: number) => void
  }
  sorting?: {
    column: string
    direction: 'asc' | 'desc'
    onSort: (column: string) => void
  }
  selection?: {
    selected: string[]
    onSelect: (ids: string[]) => void
  }
  filters?: ReactNode
  actions?: (row: T) => ReactNode
  emptyState?: ReactNode
  getRowId?: (row: T, index: number) => string
}

function cellToCsvValue(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function defaultRowId<T extends object>(row: T, index: number) {
  if ('id' in row && typeof row.id === 'string') return row.id
  return String(index)
}

export default function DataTable<T extends object>({
  data,
  columns,
  loading = false,
  pagination,
  sorting,
  selection,
  filters,
  actions,
  emptyState,
  getRowId,
}: DataTableProps<T>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row, index) => getRowId?.(row, index) ?? defaultRowId(row, index),
    manualPagination: Boolean(pagination),
    manualSorting: Boolean(sorting),
  })

  const rows = table.getRowModel().rows
  const selectedSet = new Set(selection?.selected ?? [])
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedSet.has(row.id))

  function toggleAllVisible() {
    if (!selection) return
    const visibleIds = rows.map((row) => row.id)
    const next = allVisibleSelected
      ? selection.selected.filter((id) => !visibleIds.includes(id))
      : Array.from(new Set([...selection.selected, ...visibleIds]))
    selection.onSelect(next)
  }

  function toggleRow(rowId: string) {
    if (!selection) return
    const next = selectedSet.has(rowId)
      ? selection.selected.filter((id) => id !== rowId)
      : [...selection.selected, rowId]
    selection.onSelect(next)
  }

  function exportCsv() {
    const headers = table.getHeaderGroups()[0]?.headers.map((header) => String(header.column.columnDef.header ?? header.id)) ?? []
    const body = rows.map((row) => row.getVisibleCells().map((cell) => cellToCsvValue(cell.getValue())))
    const csv = [headers, ...body]
      .map((line) => line.map((value) => `"${value.replaceAll('"', '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'exportacao.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">{filters}</div>
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={loading || rows.length === 0} aria-label="Exportar tabela em CSV">
          <Download className="mr-2 h-4 w-4" />
          Exportar
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {selection ? (
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        aria-label="Selecionar linhas visíveis"
                        className="h-4 w-4 rounded border-slate-300 text-brand-600"
                      />
                    </th>
                  ) : null}
                  {headerGroup.headers.map((header) => {
                    const sorted = sorting?.column === header.id
                    return (
                      <th key={header.id} className="px-4 py-3">
                        <button
                          type="button"
                          disabled={!sorting}
                          onClick={() => sorting?.onSort(header.id)}
                          className={cn('inline-flex items-center gap-1 text-left', sorting && 'hover:text-brand-600')}
                        >
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted ? sorting.direction === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" /> : null}
                        </button>
                      </th>
                    )
                  })}
                  {actions ? <th className="px-4 py-3 text-right">Ações</th> : null}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-center" colSpan={columns.length + (selection ? 1 : 0) + (actions ? 1 : 0)}>
                    <span className="inline-flex items-center gap-2 text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Carregando dados...
                    </span>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={columns.length + (selection ? 1 : 0) + (actions ? 1 : 0)}>
                    {emptyState ?? 'Nenhum registro encontrado.'}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    {selection ? (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                          aria-label="Selecionar linha"
                          className="h-4 w-4 rounded border-slate-300 text-brand-600"
                        />
                      </td>
                    ) : null}
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                    {actions ? <td className="px-4 py-3 text-right">{actions(row.original)}</td> : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-slate-100 md:hidden">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando dados...
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">{emptyState ?? 'Nenhum registro encontrado.'}</div>
          ) : (
            rows.map((row) => (
              <article key={row.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  {selection ? (
                    <input
                      type="checkbox"
                      checked={selectedSet.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                      aria-label="Selecionar registro"
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1 space-y-2">
                    {row.getVisibleCells().slice(0, 4).map((cell) => (
                      <div key={cell.id} className="text-sm text-slate-700">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ))}
                  </div>
                  {actions ? <div>{actions(row.original)}</div> : null}
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      {pagination ? (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <span>
            Página {pagination.page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => pagination.onPageChange(pagination.page - 1)} disabled={pagination.page <= 1}>
              Anterior
            </Button>
            <Button variant="secondary" size="sm" onClick={() => pagination.onPageChange(pagination.page + 1)} disabled={pagination.page >= totalPages}>
              Próxima
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
