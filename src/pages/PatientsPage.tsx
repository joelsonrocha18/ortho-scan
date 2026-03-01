import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import PatientProductHistory from '../components/patients/PatientProductHistory'
import WhatsappLink from '../components/WhatsappLink'
import AppShell from '../layouts/AppShell'
import { DATA_MODE } from '../data/dataMode'
import { loadDb, saveDb } from '../data/db'
import { useDb } from '../lib/useDb'
import { getCurrentUser } from '../lib/auth'
import { can } from '../auth/permissions'
import { listPatientsForUser } from '../auth/scope'
import { supabase } from '../lib/supabaseClient'
import { parsePatientsSpreadsheet, readSpreadsheetFileText } from '../lib/spreadsheetImport'
import { useSupabaseSyncTick } from '../lib/useSupabaseSyncTick'
import type { Scan } from '../types/Scan'
import { patientCode } from '../lib/entityCode'

function nowIso() {
  return new Date().toISOString()
}

function toScanDateIso(scanDate?: string) {
  if (!scanDate) return undefined
  return `${scanDate}T00:00:00.000Z`
}

export default function PatientsPage() {
  const { db } = useDb()
  const isSupabaseMode = DATA_MODE === 'supabase'
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'patients.write')
  const [query, setQuery] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [importing, setImporting] = useState(false)
  const [supabaseRefreshKey, setSupabaseRefreshKey] = useState(0)
  const supabaseSyncTick = useSupabaseSyncTick()
  const [supabasePatients, setSupabasePatients] = useState<Array<{
    id: string
    shortId?: string
    name: string
    cpf?: string
    phone?: string
    whatsapp?: string
    primaryDentistId?: string
    deletedAt?: string
  }>>([])
  const [supabaseDentistsById, setSupabaseDentistsById] = useState<Map<string, string>>(new Map())
  const [supabaseProductHistoryByPatient, setSupabaseProductHistoryByPatient] = useState<Map<string, string[]>>(new Map())

  useEffect(() => {
    let active = true
    if (!isSupabaseMode || !supabase) return
    ;(async () => {
      const [patientsRes, dentistsRes, casesRes, labRes] = await Promise.all([
        supabase.from('patients').select('id, short_id, name, cpf, phone, whatsapp, primary_dentist_id, deleted_at'),
        supabase.from('dentists').select('id, name, deleted_at').is('deleted_at', null),
        supabase.from('cases').select('id, patient_id, product_type, data, deleted_at').is('deleted_at', null),
        supabase.from('lab_items').select('id, case_id, status, product_type, data, deleted_at').is('deleted_at', null),
      ])
      if (!active) return
      const patients = ((patientsRes.data ?? []) as Array<{
        id: string
        short_id?: string
        name: string
        cpf?: string
        phone?: string
        whatsapp?: string
        primary_dentist_id?: string
        deleted_at?: string
      }>).map((row) => ({
        id: row.id,
        shortId: row.short_id ?? undefined,
        name: row.name ?? '-',
        cpf: row.cpf ?? undefined,
        phone: row.phone ?? undefined,
        whatsapp: row.whatsapp ?? undefined,
        primaryDentistId: row.primary_dentist_id ?? undefined,
        deletedAt: row.deleted_at ?? undefined,
      }))
      setSupabasePatients(patients)
      const dentistsMap = new Map<string, string>()
      for (const row of (dentistsRes.data ?? []) as Array<{ id: string; name: string }>) {
        dentistsMap.set(row.id, row.name ?? '')
      }
      setSupabaseDentistsById(dentistsMap)

      const caseById = new Map<string, { patientId?: string; productType?: string }>()
      for (const row of (casesRes.data ?? []) as Array<{ id: string; patient_id?: string; product_type?: string; data?: Record<string, unknown> }>) {
        const data = row.data ?? {}
        caseById.set(row.id, {
          patientId: row.patient_id,
          productType: row.product_type ?? (data.productType as string | undefined) ?? 'alinhador_12m',
        })
      }
      const history = new Map<string, string[]>()
      for (const row of (labRes.data ?? []) as Array<{ case_id?: string; status?: string; product_type?: string; data?: Record<string, unknown> }>) {
        if (row.status !== 'prontas') continue
        if (!row.case_id) continue
        const linkedCase = caseById.get(row.case_id)
        if (!linkedCase?.patientId) continue
        const data = row.data ?? {}
        const productType = row.product_type ?? (data.productType as string | undefined) ?? linkedCase.productType ?? 'alinhador_12m'
        const current = history.get(linkedCase.patientId) ?? []
        history.set(linkedCase.patientId, [...current, productType])
      }
      setSupabaseProductHistoryByPatient(history)
    })()
    return () => {
      active = false
    }
  }, [isSupabaseMode, supabaseRefreshKey, supabaseSyncTick])

  const localPatients = useMemo(() => listPatientsForUser(db, currentUser), [db, currentUser])
  const sourcePatients = isSupabaseMode ? supabasePatients : localPatients
  const dentistsById = isSupabaseMode
    ? supabaseDentistsById
    : new Map(db.dentists.map((dentist) => [dentist.id, dentist.name]))
  const localProductHistoryByPatient = useMemo(() => {
    const caseById = new Map(db.cases.map((item) => [item.id, item]))
    const history = new Map<string, string[]>()
    db.labItems.forEach((item) => {
      if (!item.caseId || item.status !== 'prontas') return
      const linkedCase = caseById.get(item.caseId)
      if (!linkedCase?.patientId) return
      const productType = item.productType ?? linkedCase.productType ?? 'alinhador_12m'
      const current = history.get(linkedCase.patientId) ?? []
      history.set(linkedCase.patientId, [...current, productType])
    })
    return history
  }, [db.cases, db.labItems])
  const productHistoryByPatient = isSupabaseMode ? supabaseProductHistoryByPatient : localProductHistoryByPatient

  const patients = useMemo(
    () =>
      [...sourcePatients]
        .filter((item) => (showDeleted ? true : !item.deletedAt))
        .filter((item) => {
          const q = query.trim().toLowerCase()
          if (!q) return true
          return (
            item.name.toLowerCase().includes(q) ||
            (item.shortId ?? '').toLowerCase().includes(q) ||
            (item.cpf ?? '').toLowerCase().includes(q) ||
            (item.phone ?? '').toLowerCase().includes(q) ||
            (item.whatsapp ?? '').toLowerCase().includes(q)
          )
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [sourcePatients, query, showDeleted],
  )

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
    const parsed = parsePatientsSpreadsheet(importText)
    if (parsed.rows.length === 0) {
      setImportMessage(parsed.errors[0] ?? 'Nenhuma linha válida encontrada.')
      return
    }
    setImporting(true)

    if (isSupabaseMode && supabase) {
      const existing = new Set(supabasePatients.map((item) => item.name.trim().toLowerCase()))
      let inserted = 0
      let skipped = 0
      let failed = 0
      const errors: string[] = []

      for (const row of parsed.rows) {
        const normalized = row.name.trim().toLowerCase()
        if (!normalized || existing.has(normalized)) {
          skipped += 1
          continue
        }
        const patientPayload: Record<string, unknown> = {
          name: row.name.trim(),
          notes: row.scanDate ? `Data escaneamento importada: ${row.scanDate}` : null,
        }
        const createPatientRes = await supabase.from('patients').insert(patientPayload).select('id').single()
        if (createPatientRes.error || !createPatientRes.data?.id) {
          failed += 1
          if (createPatientRes.error?.message) errors.push(createPatientRes.error.message)
          continue
        }
        const patientId = createPatientRes.data.id as string
        if (row.scanDate) {
          await supabase.from('scans').insert({
            patient_id: patientId,
            created_at: toScanDateIso(row.scanDate),
            data: {
              patientName: row.name.trim(),
              scanDate: row.scanDate,
              status: 'pendente',
              arch: 'ambos',
              importedFromSpreadsheet: true,
            },
          })
        }
        existing.add(normalized)
        inserted += 1
      }

      setSupabaseRefreshKey((current) => current + 1)
      setImporting(false)
      const uniqueErrors = Array.from(new Set(errors))
      const details = uniqueErrors.length > 0 ? ` Erro: ${uniqueErrors[0]}.` : ''
      setImportMessage(`Importação concluída. Inseridos: ${inserted}, ignorados: ${skipped}, falhas: ${failed}.${details}`)
      return
    }

    const currentDb = loadDb()
    const existing = new Set(currentDb.patients.map((item) => item.name.trim().toLowerCase()))
    let inserted = 0
    let skipped = 0

    for (const row of parsed.rows) {
      const normalized = row.name.trim().toLowerCase()
      if (!normalized || existing.has(normalized)) {
        skipped += 1
        continue
      }
      const ts = nowIso()
      const patientId = `pat_${Date.now()}_${Math.random().toString(16).slice(2)}`
      currentDb.patients.unshift({
        id: patientId,
        name: row.name.trim(),
        notes: row.scanDate ? `Data escaneamento importada: ${row.scanDate}` : undefined,
        createdAt: ts,
        updatedAt: ts,
      })
      if (row.scanDate) {
        const scan: Scan = {
          id: `scan_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          patientName: row.name.trim(),
          patientId,
          scanDate: row.scanDate,
          arch: 'ambos',
          attachments: [],
          status: 'pendente',
          notes: 'Importado por planilha',
          createdAt: ts,
          updatedAt: ts,
        }
        currentDb.scans.unshift(scan)
      }
      existing.add(normalized)
      inserted += 1
    }

    saveDb(currentDb)
    setImporting(false)
    setImportMessage(`Importação concluída. Inseridos: ${inserted}, ignorados: ${skipped}.`)
  }

  return (
    <AppShell breadcrumb={['Inicio', 'Pacientes']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Pacientes</h1>
          <p className="mt-2 text-sm text-slate-500">Cadastro centralizado de pacientes e vinculos de tratamento.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite ? (
            <Button variant="secondary" onClick={() => setShowImport((current) => !current)}>
              Importar planilha
            </Button>
          ) : null}
          {canWrite ? (
            <Link to="/app/patients/new">
              <Button>Novo paciente</Button>
            </Link>
          ) : null}
        </div>
      </section>

      {showImport ? (
        <section className="mt-4">
          <Card>
            <h2 className="text-lg font-semibold text-slate-900">Importar pacientes por planilha</h2>
            <p className="mt-1 text-sm text-slate-500">Colunas esperadas: Data Emissão + Nome do Paciente.</p>
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
            <Input
              placeholder="Buscar por codigo, nome, CPF, telefone ou WhatsApp"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} />
              Mostrar excluidos
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Nome</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Dentista responsavel</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Telefone fixo</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">WhatsApp</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Historico de produtos</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {patients.map((item) => (
                  <tr key={item.id} className="bg-white">
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">
                      <div>{item.name}</div>
                      <div className="text-xs font-semibold text-slate-500">{patientCode(item.id, item.shortId)}</div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {item.primaryDentistId
                        ? dentistsById.get(item.primaryDentistId) ?? '-'
                        : '-'}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">{item.phone || '-'}</td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {item.whatsapp ? <WhatsappLink value={item.whatsapp} /> : '-'}
                    </td>
                    <td className="px-5 py-4">
                      <PatientProductHistory productTypes={productHistoryByPatient.get(item.id) ?? []} />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-2">
                        <Link
                          to={`/app/patients/${item.id}`}
                          className="inline-flex h-9 items-center rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white transition hover:bg-brand-700"
                        >
                          Abrir
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {patients.length === 0 ? (
                  <tr>
                      <td className="px-5 py-8 text-sm text-slate-500" colSpan={6}>
                      Nenhum paciente encontrado.
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
