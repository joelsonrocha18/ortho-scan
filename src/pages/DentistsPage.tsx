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
import { createDentistFirebase, listDentistsFirebase } from '../data/dentistRepo'
import { useDb } from '../lib/useDb'
import type { DentistClinic } from '../types/DentistClinic'
import { getCurrentUser } from '../lib/auth'
import { can } from '../auth/permissions'
import { supabase } from '../lib/supabaseClient'
import { parseDentistsSpreadsheet, readSpreadsheetFileText } from '../lib/spreadsheetImport'
import { useSupabaseSyncTick } from '../lib/useSupabaseSyncTick'
import { dentistCode } from '../lib/entityCode'
import { createOnboardingInvite } from '../repo/onboardingRepo'
import { useToast } from '../app/ToastProvider'
import { listClinicsFirebase } from '../repo/clinicRepo'

function nowIso() {
  return new Date().toISOString()
}

function statusLabel(item: { isActive: boolean; deletedAt?: string }) {
  if (item.deletedAt) return { label: 'Excluído', tone: 'danger' as const }
  if (!item.isActive) return { label: 'Inativo', tone: 'neutral' as const }
  return { label: 'Ativo', tone: 'success' as const }
}

export default function DentistsPage() {
  const { db } = useDb()
  const { addToast } = useToast()
  const isSupabaseMode = DATA_MODE === 'supabase'
  const isFirebaseMode = DATA_MODE === 'firebase'
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
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const supabaseSyncTick = useSupabaseSyncTick()
  const [supabaseClinics, setSupabaseClinics] = useState<Array<{ id: string; tradeName: string }>>([])
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
  const [firebaseClinics, setFirebaseClinics] = useState<Array<{ id: string; tradeName: string }>>([])
  const [firebaseDentists, setFirebaseDentists] = useState<DentistClinic[]>([])

  useEffect(() => {
    let active = true
    if (!isSupabaseMode || !supabase) return
    ;(async () => {
      const [dentistsRes, clinicsRes] = await Promise.all([
        supabase.from('dentists').select('id, short_id, name, cro, phone, whatsapp, is_active, deleted_at'),
        supabase.from('clinics').select('id, trade_name').is('deleted_at', null),
      ])
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
      setSupabaseClinics(((clinicsRes.data ?? []) as Array<{ id: string; trade_name?: string }>).map((row) => ({
        id: row.id,
        tradeName: row.trade_name ?? '-',
      })))
    })()
    return () => {
      active = false
    }
  }, [isSupabaseMode, supabaseRefreshKey, supabaseSyncTick])

  useEffect(() => {
    let active = true
    if (!isFirebaseMode) {
      setFirebaseClinics([])
      setFirebaseDentists([])
      return
    }
    ;(async () => {
      const [dentists, clinics] = await Promise.all([
        listDentistsFirebase({ includeDeleted: true, includeInactive: true }),
        listClinicsFirebase({ includeDeleted: false }),
      ])
      if (!active) return
      setFirebaseDentists(dentists)
      setFirebaseClinics(clinics.map((clinic) => ({ id: clinic.id, tradeName: clinic.tradeName })))
    })()
    return () => {
      active = false
    }
  }, [isFirebaseMode, supabaseRefreshKey])

  const resolveDefaultClinicId = () => {
    const linkedClinicId = currentUser?.linkedClinicId?.trim() ?? ''
    if (linkedClinicId) return linkedClinicId
    if (isFirebaseMode) return firebaseClinics[0]?.id ?? ''
    return supabaseClinics[0]?.id ?? ''
  }

  const handleGenerateSelfSignupLink = async () => {
    if (!isSupabaseMode) return
    if (!canWrite) return
    const clinicId = resolveDefaultClinicId()
    if (!clinicId) {
      addToast({ type: 'error', title: 'Nenhuma clínica ativa encontrada para gerar o link.' })
      return
    }
    setInviteLoading(true)
    const result = await createOnboardingInvite({
      fullName: 'Dentista',
      role: 'dentist_client',
      clinicId,
    })
    setInviteLoading(false)
    if (!result.ok || !result.inviteLink) {
      addToast({ type: 'error', title: result.error ?? 'Falha ao gerar link de cadastro.' })
      return
    }
    setInviteLink(result.inviteLink)
    addToast({ type: 'success', title: 'Link de cadastro gerado' })
    try {
      await navigator.clipboard.writeText(result.inviteLink)
      addToast({ type: 'success', title: 'Link copiado para a área de transferência' })
    } catch {
      // A cópia para a área de transferência pode falhar sem invalidar o link gerado.
    }
  }

  const dentistsSource = isSupabaseMode
    ? supabaseDentists
    : isFirebaseMode
      ? firebaseDentists.filter((item) => item.type === 'dentista')
      : db.dentists.filter((item) => item.type === 'dentista')

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

    if (isFirebaseMode) {
      const existing = new Set(firebaseDentists.filter((item) => item.type === 'dentista').map((item) => item.name.trim().toLowerCase()))
      let inserted = 0
      let skipped = 0
      let failed = 0
      for (const row of parsed.rows) {
        const normalized = row.name.trim().toLowerCase()
        if (!normalized || existing.has(normalized)) {
          skipped += 1
          continue
        }
        const result = await createDentistFirebase({
          name: row.name.trim(),
          type: 'dentista',
          gender: 'masculino',
          isActive: true,
        })
        if (!result.ok) {
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
    <AppShell breadcrumb={['Início', 'Dentistas']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Dentistas</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && isSupabaseMode ? (
            <Button variant="secondary" onClick={() => void handleGenerateSelfSignupLink()} disabled={inviteLoading}>
              {inviteLoading ? 'Gerando link...' : 'Link de cadastro'}
            </Button>
          ) : null}
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
            <h2 className="text-lg font-semibold text-slate-900">Importar dentistas</h2>
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

      {isSupabaseMode && inviteLink ? (
        <section className="mt-4">
          <Card>
            <h2 className="text-base font-semibold text-slate-900">Link de cadastro do dentista</h2>
            <Input className="mt-3" value={inviteLink} readOnly onFocus={(event) => event.currentTarget.select()} />
            <div className="mt-3 flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteLink)
                  addToast({ type: 'success', title: 'Link copiado' })
                }}
              >
                Copiar link
              </Button>
            </div>
          </Card>
        </section>
      ) : null}

      <section className="mt-6">
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <Input
                placeholder="Buscar por código, nome, CRO ou telefone"
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
                Mostrar excluídos
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
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Ações</th>
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

