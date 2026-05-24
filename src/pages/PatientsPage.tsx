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
import { parsePatientsSpreadsheet, readSpreadsheetFileText } from '../lib/spreadsheetImport'
import { resolveRequestedProductLabel } from '../lib/productLabel'
import type { Scan } from '../types/Scan'
import { patientCode } from '../lib/entityCode'
import { createPatientFirebase, listPatientsFirebase } from '../repo/patientRepo'
import { listDentistsFirebase } from '../data/dentistRepo'
import { listClinicsFirebase } from '../repo/clinicRepo'
import { listCasesFirebase } from '../data/caseRepo'
import { createScanFirebase } from '../data/scanRepo'

function nowIso() {
  return new Date().toISOString()
}

function toScanDateIso(scanDate?: string) {
  if (!scanDate) return undefined
  return `${scanDate}T00:00:00.000Z`
}

export default function PatientsPage() {
  const { db } = useDb()
  const isFirebaseMode = DATA_MODE === 'firebase'
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'patients.write')
  const [query, setQuery] = useState('')
  const [dentistFilter, setDentistFilter] = useState('todos')
  const [clinicFilter, setClinicFilter] = useState('todos')
  const [showDeleted, setShowDeleted] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [importing, setImporting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  type PatientRow = {
    id: string
    shortId?: string
    name: string
    cpf?: string
    phone?: string
    whatsapp?: string
    primaryDentistId?: string
    clinicId?: string
    deletedAt?: string
  }
  const [firebasePatients, setFirebasePatients] = useState<PatientRow[]>([])
  const [firebaseDentistsById, setFirebaseDentistsById] = useState<Map<string, string>>(new Map())
  const [firebaseClinicsById, setFirebaseClinicsById] = useState<Map<string, string>>(new Map())
  const [firebaseProductHistoryByPatient, setFirebaseProductHistoryByPatient] = useState<Map<string, string[]>>(new Map())

  useEffect(() => {
    let active = true
    if (!isFirebaseMode) return
    ;(async () => {
      const [patients, dentists, clinics, cases] = await Promise.all([
        listPatientsFirebase({ includeDeleted: true }),
        listDentistsFirebase({ includeDeleted: false, includeInactive: false }),
        listClinicsFirebase({ includeDeleted: false }),
        listCasesFirebase(),
      ])
      if (!active) return

      setFirebasePatients(
        patients.map((row) => ({
          id: row.id,
          shortId: row.shortId,
          name: row.name,
          cpf: row.cpf,
          phone: row.phone,
          whatsapp: row.whatsapp,
          primaryDentistId: row.primaryDentistId,
          clinicId: row.clinicId,
          deletedAt: row.deletedAt,
        })),
      )

      setFirebaseDentistsById(new Map(dentists.map((dentist) => [dentist.id, dentist.name ?? ''])))
      setFirebaseClinicsById(new Map(clinics.map((clinic) => [clinic.id, clinic.tradeName ?? ''])))

      const history = new Map<string, string[]>()
      for (const item of cases) {
        if (!item.patientId) continue
        const productLabel = resolveRequestedProductLabel({
          requestedProductLabel: item.requestedProductLabel,
          requestedProductId: item.requestedProductId,
          productType: item.productType ?? 'alinhador_12m',
          productId: item.productId ?? item.requestedProductId ?? item.productType ?? 'alinhador_12m',
        })
        const current = history.get(item.patientId) ?? []
        if (!current.includes(productLabel)) {
          history.set(item.patientId, [...current, productLabel])
        }
      }
      setFirebaseProductHistoryByPatient(history)
    })().catch((error) => {
      console.error('Falha ao carregar pacientes do Firebase.', error)
      if (!active) return
      setFirebasePatients([])
      setFirebaseDentistsById(new Map())
      setFirebaseClinicsById(new Map())
      setFirebaseProductHistoryByPatient(new Map())
    })
    return () => {
      active = false
    }
  }, [isFirebaseMode, refreshKey])

  const localPatients = useMemo(() => listPatientsForUser(db, currentUser), [db, currentUser])
  const sourcePatients = isFirebaseMode ? firebasePatients : localPatients
  const dentistsById = useMemo(
    () =>
      isFirebaseMode
        ? firebaseDentistsById
        : new Map(db.dentists.map((dentist) => [dentist.id, dentist.name])),
    [db.dentists, firebaseDentistsById, isFirebaseMode],
  )
  const clinicsById = useMemo(
    () =>
      isFirebaseMode
        ? firebaseClinicsById
        : new Map(db.clinics.filter((clinic) => !clinic.deletedAt).map((clinic) => [clinic.id, clinic.tradeName])),
    [db.clinics, firebaseClinicsById, isFirebaseMode],
  )
  const dentistOptions = useMemo(
    () =>
      Array.from(dentistsById.entries())
        .map(([id, name]) => ({ id, name }))
        .filter((item) => item.name.trim().length > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [dentistsById],
  )
  const clinicOptions = useMemo(
    () =>
      Array.from(clinicsById.entries())
        .map(([id, name]) => ({ id, name }))
        .filter((item) => item.name.trim().length > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [clinicsById],
  )
  const localProductHistoryByPatient = useMemo(() => {
    const caseById = new Map(db.cases.map((item) => [item.id, item]))
    const scanById = new Map(db.scans.map((item) => [item.id, item]))
    const history = new Map<string, string[]>()
    db.labItems.forEach((item) => {
      if (!item.caseId || item.status !== 'prontas') return
      const linkedCase = caseById.get(item.caseId)
      if (!linkedCase?.patientId) return
      const sourceScan = linkedCase.sourceScanId ? scanById.get(linkedCase.sourceScanId) : undefined
      const productLabel = resolveRequestedProductLabel({
        requestedProductLabel: item.requestedProductLabel ?? linkedCase.requestedProductLabel ?? sourceScan?.purposeLabel,
        requestedProductId: item.requestedProductId ?? linkedCase.requestedProductId ?? sourceScan?.purposeProductId,
        productType: item.productType ?? linkedCase.productType ?? sourceScan?.purposeProductType ?? 'alinhador_12m',
        productId: item.productId ?? linkedCase.productId ?? sourceScan?.purposeProductId ?? 'alinhador_12m',
      })
      const current = history.get(linkedCase.patientId) ?? []
      history.set(linkedCase.patientId, [...current, productLabel])
    })
    return history
  }, [db.cases, db.labItems, db.scans])
  const productHistoryByPatient = isFirebaseMode
    ? firebaseProductHistoryByPatient
    : localProductHistoryByPatient

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
        .filter((item) => dentistFilter === 'todos' || item.primaryDentistId === dentistFilter)
        .filter((item) => clinicFilter === 'todos' || item.clinicId === clinicFilter)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [sourcePatients, query, showDeleted, dentistFilter, clinicFilter],
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

    if (isFirebaseMode) {
      const existing = new Set(firebasePatients.map((item) => item.name.trim().toLowerCase()))
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
        const nameParts = row.name.trim().split(/\s+/).filter(Boolean)
        const createPatientRes = await createPatientFirebase({
          name: row.name.trim(),
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(' ') || undefined,
          birthDate: row.scanDate ?? new Date().toISOString().slice(0, 10),
          notes: row.scanDate ? `Data escaneamento importada: ${row.scanDate}` : undefined,
        })
        if (!createPatientRes.ok) {
          failed += 1
          errors.push(createPatientRes.error)
          continue
        }
        if (row.scanDate) {
          await createScanFirebase({
            patientName: row.name.trim(),
            patientId: createPatientRes.patient.id,
            scanDate: row.scanDate,
            arch: 'ambos',
            attachments: [],
            status: 'pendente',
            notes: 'Importado por planilha',
          })
        }
        existing.add(normalized)
        inserted += 1
      }

      setRefreshKey((current) => current + 1)
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
    <AppShell breadcrumb={['Início', 'Pacientes']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Pacientes</h1>
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
            <h2 className="text-lg font-semibold text-slate-900">Importar pacientes</h2>
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
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(220px,1fr)_minmax(220px,1fr)_auto]">
              <Input
                placeholder="Buscar por código, nome, CPF, telefone ou WhatsApp"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                value={clinicFilter}
                onChange={(event) => setClinicFilter(event.target.value)}
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              >
                <option value="todos">Clínicas: Todas</option>
                {clinicOptions.map((clinic) => (
                  <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
                ))}
              </select>
              <select
                value={dentistFilter}
                onChange={(event) => setDentistFilter(event.target.value)}
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              >
                <option value="todos">Dentistas: Todos</option>
                {dentistOptions.map((dentist) => (
                  <option key={dentist.id} value={dentist.id}>{dentist.name}</option>
                ))}
              </select>
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} />
                Mostrar excluídos
              </label>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Nome</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Dentista responsável</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Telefone fixo</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">WhatsApp</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Histórico de produtos</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Ações</th>
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

