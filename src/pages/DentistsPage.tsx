import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Badge from '../components/Badge'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import WhatsappLink from '../components/WhatsappLink'
import AppShell from '../layouts/AppShell'
import { DATA_MODE } from '../data/dataMode'
import { loadDb, saveDb } from '../data/db'
import { useDb } from '../lib/useDb'
import type { DentistClinic } from '../types/DentistClinic'
import { getCurrentUser } from '../lib/auth'
import { can } from '../auth/permissions'
import { supabase } from '../lib/supabaseClient'
import { parseDentistsSpreadsheet, readSpreadsheetFileText } from '../lib/spreadsheetImport'
import { useSupabaseSyncTick } from '../lib/useSupabaseSyncTick'
import { dentistCode } from '../lib/entityCode'

function nowIso() {
  return new Date().toISOString()
}

function statusLabel(item: { isActive: boolean; deletedAt?: string }) {
  if (item.deletedAt) return { label: 'Excluido', tone: 'danger' as const }
  if (!item.isActive) return { label: 'Inativo', tone: 'neutral' as const }
  return { label: 'Ativo', tone: 'success' as const }
}

export default function DentistsPage() {
  const { db } = useDb()
  const isSupabaseMode = DATA_MODE === 'supabase'
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'dentists.write')
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [importing, setImporting] = useState(false)
  const [supabaseRefreshKey, setSupabaseRefreshKey] = useState(0)
  const supabaseSyncTick = useSupabaseSyncTick()
  const [supabaseDentists, setSupabaseDentists] = useState<Array<{
    id: string
    shortId?: string
    name: string
    cro?: string
    phone?: string
    whatsapp?: string
    isActive: boolean
    deletedAt?: string
  }>>([])

  useEffect(() => {
    let active = true
    if (!isSupabaseMode || !supabase) return
    ;(async () => {
      const dentistsRes = await supabase.from('dentists').select('id, short_id, name, cro, phone, whatsapp, is_active, deleted_at')
      if (!active) return
      const dentists = ((dentistsRes.data ?? []) as Array<{
        id: string
        short_id?: string
        name: string
        cro?: string
        phone?: string
        whatsapp?: string
        is_active?: boolean
        deleted_at?: string
      }>).map((row) => ({
        id: row.id,
        shortId: row.short_id ?? undefined,
        name: row.name ?? '-',
        cro: row.cro ?? undefined,
        phone: row.phone ?? undefined,
        whatsapp: row.whatsapp ?? undefined,
        isActive: row.is_active ?? true,
        deletedAt: row.deleted_at ?? undefined,
      }))
      setSupabaseDentists(dentists)
    })()
    return () => {
      active = false
    }
  }, [isSupabaseMode, supabaseRefreshKey, supabaseSyncTick])

  const dentistsSource = isSupabaseMode ? supabaseDentists : db.dentists.filter((item) => item.type === 'dentista')

  const dentists = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return [...dentistsSource]
      .filter((item) => (showDeleted ? true : !item.deletedAt))
      .filter((item) => (showInactive ? true : item.isActive))
      .filter((item) => {
        if (!normalizedQuery) return true
        return (
          item.name.toLowerCase().includes(normalizedQuery) ||
          (item.shortId ?? '').toLowerCase().includes(normalizedQuery) ||
          (item.cro ?? '').toLowerCase().includes(normalizedQuery) ||
          (item.phone ?? '').toLowerCase().includes(normalizedQuery) ||
          (item.whatsapp ?? '').toLowerCase().includes(normalizedQuery)
        )
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [dentistsSource, query, showInactive, showDeleted])

  const handleImportFile = async (file?: File | null) => {
    if (!file) return
    try {
      const text = await readSpreadsheetFileText(file)
      setImportText(text)
      setImportMessage(`Arquivo carregado: ${file.name}`)
    } catch (error) {
      console.error(error)
      setImportMessage('Falha ao preparar importacao da planilha. Verifique o arquivo e tente novamente.')
    }
  }

  const runImport = async () => {
    if (!canWrite) return
    setImportMessage('')
    const parsed = parseDentistsSpreadsheet(importText)
    if (parsed.rows.length === 0) {
      setImportMessage(parsed.errors[0] ?? 'Nenhuma linha válida encontrada.')
      return
    }
    setImporting(true)

    if (isSupabaseMode && supabase) {
      const existing = new Set(supabaseDentists.map((item) => item.name.trim().toLowerCase()))
      let inserted = 0
      let skipped = 0
      let failed = 0

      for (const row of parsed.rows) {
        const normalized = row.name.trim().toLowerCase()
        if (!normalized || existing.has(normalized)) {
          skipped += 1
          continue
        }
        const result = await supabase.from('dentists').insert({
          name: row.name.trim(),
          gender: 'masculino',
          is_active: true,
        })
        if (result.error) {
          failed += 1
          continue
        }
        existing.add(normalized)
        inserted += 1
      }
      setSupabaseRefreshKey((current) => current + 1)
      setImporting(false)
      setImportMessage(`Importação concluída. Inseridos: ${inserted}, ignorados: ${skipped}, falhas: ${failed}.`)
      return
    }

    const currentDb = loadDb()
    const existing = new Set(
      currentDb.dentists.filter((item) => item.type === 'dentista').map((item) => item.name.trim().toLowerCase()),
    )
    let inserted = 0
    let skipped = 0
    for (const row of parsed.rows) {
      const normalized = row.name.trim().toLowerCase()
      if (!normalized || existing.has(normalized)) {
        skipped += 1
        continue
      }
      const ts = nowIso()
      const nextDentist: DentistClinic = {
        id: `dent_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: row.name.trim(),
        type: 'dentista',
        gender: 'masculino',
        isActive: true,
        createdAt: ts,
        updatedAt: ts,
      }
      currentDb.dentists.unshift(nextDentist)
      existing.add(normalized)
      inserted += 1
    }
    saveDb(currentDb)
    setImporting(false)
    setImportMessage(`Importação concluída. Inseridos: ${inserted}, ignorados: ${skipped}.`)
  }

  return (
    <AppShell breadcrumb={['Inicio', 'Dentistas']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Dentistas</h1>
          <p className="mt-2 text-sm text-slate-500">Cadastro de profissionais.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite ? (
            <Button variant="secondary" onClick={() => setShowImport((current) => !current)}>
              Importar planilha
            </Button>
          ) : null}
          {canWrite ? (
            <Link to="/app/dentists/new">
              <Button>Novo</Button>
            </Link>
          ) : null}
        </div>
      </section>

      {showImport ? (
        <section className="mt-4">
          <Card>
            <h2 className="text-lg font-semibold text-slate-900">Importar dentistas por planilha</h2>
            <p className="mt-1 text-sm text-slate-500">Coluna esperada: Nome do dentista.</p>
            <textarea
              className="mt-3 min-h-36 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              placeholder="Cole aqui os dados copiados do Excel"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Carregar CSV/XLSX
                <input
                  type="file"
                  accept=".csv,.txt,.xlsx"
                  className="hidden"
                  onChange={(event) => void handleImportFile(event.target.files?.[0])}
                />
              </label>
              <Button onClick={() => void runImport()} disabled={importing || !importText.trim()}>
                {importing ? 'Importando...' : 'Executar importação'}
              </Button>
            </div>
            {importMessage ? <p className="mt-2 text-sm text-slate-700">{importMessage}</p> : null}
          </Card>
        </section>
      ) : null}

      <section className="mt-6">
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <Input
                placeholder="Buscar por codigo, nome, CRO ou telefone"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                />
                Mostrar inativos
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showDeleted}
                  onChange={(event) => setShowDeleted(event.target.checked)}
                />
                Mostrar excluidos
              </label>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Nome</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">CRO</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Telefone fixo</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">WhatsApp</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {dentists.map((item) => {
                  const status = statusLabel(item)
                  return (
                    <tr key={item.id} className="bg-white">
                      <td className="px-5 py-4 text-sm font-medium text-slate-900">
                        <div>{item.name}</div>
                        <div className="text-xs font-semibold text-slate-500">{dentistCode(item.id, item.shortId)}</div>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-700">{item.cro || '-'}</td>
                      <td className="px-5 py-4 text-sm text-slate-700">{item.phone || '-'}</td>
                      <td className="px-5 py-4 text-sm text-slate-700">{item.whatsapp ? <WhatsappLink value={item.whatsapp} /> : '-'}</td>
                      <td className="px-5 py-4">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-5 py-4">
                        <Link
                          to={`/app/dentists/${item.id}`}
                          className="inline-flex h-9 items-center rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white transition hover:bg-brand-700"
                        >
                          {canWrite ? 'Ver/Editar' : 'Ver'}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
                {dentists.length === 0 ? (
                  <tr>
                    <td className="px-5 py-8 text-sm text-slate-500" colSpan={6}>
                      Nenhum registro encontrado.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </AppShell>
  )
}
