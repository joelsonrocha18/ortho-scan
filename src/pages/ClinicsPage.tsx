import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Badge from '../components/Badge'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import WhatsappLink from '../components/WhatsappLink'
import AppShell from '../layouts/AppShell'
import { useDb } from '../lib/useDb'
import { can } from '../auth/permissions'
import { getCurrentUser } from '../lib/auth'
import { DATA_MODE } from '../data/dataMode'
import { supabase } from '../lib/supabaseClient'
import { useSupabaseSyncTick } from '../lib/useSupabaseSyncTick'
import type { Clinic } from '../types/Clinic'
import { listActiveInvitesByEntityFirebase } from '../repo/inviteRepo'
import { useToast } from '../app/ToastProvider'
import { clinicCode } from '../lib/entityCode'
import { listClinicsFirebase } from '../repo/clinicRepo'

function mapSupabaseClinic(row: Record<string, unknown>): Clinic {
  return {
    id: String(row.id ?? ''),
    shortId: (row.short_id as string | null) ?? undefined,
    tradeName: String(row.trade_name ?? ''),
    legalName: (row.legal_name as string | null) ?? undefined,
    cnpj: (row.cnpj as string | null) ?? undefined,
    phone: (row.phone as string | null) ?? undefined,
    whatsapp: (row.whatsapp as string | null) ?? undefined,
    email: (row.email as string | null) ?? undefined,
    address: (row.address as Clinic['address'] | null) ?? undefined,
    notes: (row.notes as string | null) ?? undefined,
    isActive: Boolean(row.is_active ?? true),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
    deletedAt: (row.deleted_at as string | null) ?? undefined,
  }
}

export default function ClinicsPage() {
  const { db } = useDb()
  const { addToast } = useToast()
  const isSupabaseMode = DATA_MODE === 'supabase'
  const isFirebaseMode = DATA_MODE === 'firebase'
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'clinics.write')
  const [query, setQuery] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const supabaseSyncTick = useSupabaseSyncTick()
  const [supabaseClinics, setSupabaseClinics] = useState<Clinic[]>([])
  const [firebaseClinics, setFirebaseClinics] = useState<Clinic[]>([])
  const [firebaseClinicInviteCodes, setFirebaseClinicInviteCodes] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true
    if (!isSupabaseMode || !supabase) {
      setSupabaseClinics([])
      return
    }

    ;(async () => {
      const { data } = await supabase
        .from('clinics')
        .select('id, short_id, trade_name, legal_name, cnpj, phone, whatsapp, email, address, notes, is_active, created_at, updated_at, deleted_at')
      if (!active) return
      setSupabaseClinics((data ?? []).map((row) => mapSupabaseClinic(row as Record<string, unknown>)))
    })()

    return () => {
      active = false
    }
  }, [isSupabaseMode, supabaseSyncTick])

  useEffect(() => {
    let active = true
    if (!isFirebaseMode) {
      setFirebaseClinics([])
      setFirebaseClinicInviteCodes({})
      return
    }
    ;(async () => {
      const [items, invites] = await Promise.all([
        listClinicsFirebase({ includeDeleted: true }),
        listActiveInvitesByEntityFirebase('clinic'),
      ])
      if (!active) return
      setFirebaseClinics(items)
      setFirebaseClinicInviteCodes(
        invites.reduce<Record<string, string>>((current, invite) => {
          if (invite.entityId && invite.code) current[invite.entityId] = invite.code
          return current
        }, {}),
      )
    })()
    return () => {
      active = false
    }
  }, [isFirebaseMode])

  const clinics = useMemo(() => {
    const q = query.trim().toLowerCase()
    const source = isSupabaseMode ? supabaseClinics : isFirebaseMode ? firebaseClinics : db.clinics
    return [...source]
      .filter((clinic) => (showDeleted ? true : !clinic.deletedAt))
      .filter((clinic) => {
        if (!q) return true
        return (
          clinic.tradeName.toLowerCase().includes(q) ||
          (clinic.shortId ?? '').toLowerCase().includes(q) ||
          (clinic.legalName ?? '').toLowerCase().includes(q) ||
          (clinic.cnpj ?? '').toLowerCase().includes(q) ||
          (clinic.phone ?? '').toLowerCase().includes(q) ||
          (clinic.whatsapp ?? '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => a.tradeName.localeCompare(b.tradeName))
  }, [db.clinics, firebaseClinics, isFirebaseMode, isSupabaseMode, query, showDeleted, supabaseClinics])

  const handleCopyInvite = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      addToast({ type: 'success', title: 'Convite copiado' })
    } catch {
      addToast({ type: 'error', title: 'Falha ao copiar convite' })
    }
  }

  return (
    <AppShell breadcrumb={['Início', 'Clínicas']}>
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Clínicas</h1>
        </div>
        {canWrite ? (
          <Link to="/app/clinics/new">
            <Button>Nova Clínica</Button>
          </Link>
        ) : null}
      </section>

      <section className="mt-6">
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <Input
                placeholder="Buscar por código, nome, razão social, CNPJ ou telefone"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} />
              Mostrar excluídas
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Nome Fantasia</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">CNPJ</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Cidade/UF</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Telefone fixo</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">WhatsApp</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Convite</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Ativo</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {clinics.map((clinic) => (
                  <tr key={clinic.id} className="bg-white">
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">
                      <div>{clinic.tradeName}</div>
                      <div className="text-xs font-semibold text-slate-500">{clinicCode(clinic.id, clinic.shortId)}</div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">{clinic.cnpj || '-'}</td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {clinic.address?.city ? `${clinic.address.city}/${clinic.address.state ?? '-'}` : '-'}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">{clinic.phone || '-'}</td>
                    <td className="px-5 py-4 text-sm text-slate-700">{clinic.whatsapp ? <WhatsappLink value={clinic.whatsapp} /> : '-'}</td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {firebaseClinicInviteCodes[clinic.id] ? (
                        <div className="flex items-center gap-2">
                          <span className="truncate">{firebaseClinicInviteCodes[clinic.id]}</span>
                          <Button variant="secondary" onClick={() => void handleCopyInvite(firebaseClinicInviteCodes[clinic.id])}>
                            Copiar
                          </Button>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <Badge tone={clinic.isActive ? 'success' : 'neutral'}>{clinic.isActive ? 'Ativo' : 'Inativo'}</Badge>
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        to={`/app/clinics/${clinic.id}`}
                        className="inline-flex h-9 items-center rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white transition hover:bg-brand-700"
                      >
                        {canWrite ? 'Ver/Editar' : 'Ver'}
                      </Link>
                    </td>
                  </tr>
                ))}
                {clinics.length === 0 ? (
                  <tr>
                    <td className="px-5 py-8 text-sm text-slate-500" colSpan={8}>
                      Nenhuma clínica encontrada.
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

