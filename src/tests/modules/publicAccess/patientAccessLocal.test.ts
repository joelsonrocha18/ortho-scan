import { beforeEach, describe, expect, it } from 'vitest'
import { loadDb, saveDb, type AppDb } from '../../../data/db'
import { createLocalPatientAccessRepository } from '../../../modules/publicAccess/infra/local/LocalPatientAccessRepository'

function buildDb(): AppDb {
  const now = '2026-04-12T10:00:00.000Z'
  return {
    users: [],
    scans: [],
    patientDocuments: [],
    replacementBank: [],
    auditLogs: [],
    clinics: [
      {
        id: 'clinic_1',
        tradeName: 'Clinica Centro',
        legalName: 'Clinica Centro LTDA',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    dentists: [
      {
        id: 'dent_1',
        type: 'dentista',
        name: 'Dra. Camila',
        clinicId: 'clinic_1',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    patients: [
      {
        id: 'pat_1',
        name: 'Maria Fernandes',
        cpf: '123.456.789-01',
        birthDate: '1994-08-10',
        email: 'maria@teste.com',
        clinicId: 'clinic_1',
        primaryDentistId: 'dent_1',
        createdAt: now,
        updatedAt: now,
      },
    ],
    labItems: [],
    cases: [
      {
        id: 'case_1',
        treatmentCode: 'ORTH-00123',
        patientName: 'Maria Fernandes',
        patientId: 'pat_1',
        clinicId: 'clinic_1',
        dentistId: 'dent_1',
        scanDate: '2026-03-01',
        totalTrays: 10,
        totalTraysUpper: 10,
        totalTraysLower: 10,
        changeEveryDays: 15,
        status: 'em_tratamento',
        phase: 'contrato_aprovado',
        contract: { status: 'aprovado', approvedAt: now },
        deliveryLots: [],
        installation: {
          installedAt: '2026-04-01',
          deliveredUpper: 3,
          deliveredLower: 3,
        },
        trays: [],
        attachments: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
}

describe('local patient access repository', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    saveDb(buildDb())
  })

  it('validates the patient identity by cpf and birth date', async () => {
    const repository = createLocalPatientAccessRepository()
    const result = await repository.validateIdentity({
      cpf: '123.456.789-01',
      birthDate: '1994-08-10',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.patientName).toBe('Maria Fernandes')
    expect(result.data.clinicName).toBe('Clinica Centro')
    expect(result.data.dentistName).toBe('Dra. Camila')
    expect(result.data.activeCaseCode).toBe('ORTH-00123')
    expect(result.data.magicLinkEnabled).toBe(true)
  })

  it('generates and resolves a local magic link', async () => {
    const repository = createLocalPatientAccessRepository()
    const request = await repository.requestMagicLink({
      cpf: '12345678901',
      birthDate: '1994-08-10',
    })

    expect(request.ok).toBe(true)
    if (!request.ok) return
    expect(request.data.magicLinkUrl).toContain('/acesso/pacientes/portal?token=')

    const token = new URL(request.data.magicLinkUrl ?? '').searchParams.get('token') ?? ''
    const resolved = await repository.resolveMagicLink(token)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.data.patientName).toBe('Maria Fernandes')
  })

  it('opens the exclusive patient portal with cpf, birth date and treatment code', async () => {
    const repository = createLocalPatientAccessRepository()
    const session = await repository.startPortalSession({
      cpf: '123.456.789-01',
      birthDate: '1994-08-10',
      accessCode: 'ORTH-00123',
    })

    expect(session.ok).toBe(true)
    if (!session.ok) return
    expect(session.data.portalUrl).toContain('/acesso/pacientes/portal?token=')
    expect(session.data.accessCode).toBe('ORTH-00123')

    const portalUrl = new URL(session.data.portalUrl)
    const token = portalUrl.searchParams.get('token') ?? ''
    const accessCode = portalUrl.searchParams.get('accessCode') ?? ''

    const snapshot = await repository.resolvePortalSession({ token, accessCode })
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) return

    expect(snapshot.data.summary.patientName).toBe('Maria Fernandes')
    expect(snapshot.data.summary.activeCaseCode).toBe('ORTH-00123')
    expect(snapshot.data.summary.changeEveryDays).toBe(15)
    expect(snapshot.data.timeline.length).toBeGreaterThan(0)
    expect(snapshot.data.timeline.some((item) => item.title.includes('Contrato aprovado'))).toBe(false)
    expect(snapshot.data.calendarMonths.length).toBe(2)
    expect(snapshot.data.photoSlots.length).toBeGreaterThan(0)
  })

  it('rejects access when the treatment code does not belong to the patient', async () => {
    const repository = createLocalPatientAccessRepository()
    const session = await repository.startPortalSession({
      cpf: '123.456.789-01',
      birthDate: '1994-08-10',
      accessCode: 'ORTH-99999',
    })

    expect(session.ok).toBe(false)
    if (session.ok) return
    expect(session.error).toContain('Código do tratamento')
  })

  it('uploads a patient progress photo and refreshes the portal timeline', async () => {
    const repository = createLocalPatientAccessRepository()
    const session = await repository.startPortalSession({
      cpf: '123.456.789-01',
      birthDate: '1994-08-10',
      accessCode: 'ORTH-00123',
    })

    expect(session.ok).toBe(true)
    if (!session.ok) return

    const portalUrl = new URL(session.data.portalUrl)
    const token = portalUrl.searchParams.get('token') ?? ''
    const accessCode = portalUrl.searchParams.get('accessCode') ?? ''

    const upload = await repository.uploadPortalPhoto({
      token,
      accessCode,
      trayNumber: 1,
      capturedAt: '2026-04-12',
      note: 'Troca realizada sem desconforto.',
      file: new File(['fake-image'], 'alinhador-1.jpg', { type: 'image/jpeg' }),
    })

    expect(upload.ok).toBe(true)
    if (!upload.ok) return
    expect(upload.data.trayNumber).toBe(1)

    const snapshot = await repository.resolvePortalSession({ token, accessCode })
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) return

    const photoSlot = snapshot.data.photoSlots.find((item) => item.trayNumber === 1)
    expect(photoSlot?.status).toBe('recebida')
    expect(photoSlot?.recordedAt).toBe('2026-04-12')

    const uploadedDocument = snapshot.data.documents.find((item) => item.id === upload.data.documentId)
    expect(uploadedDocument).toBeTruthy()
    expect(uploadedDocument?.trayNumber).toBe(1)
    expect(uploadedDocument?.source).toBe('patient_portal')
    const persistedDocument = loadDb().patientDocuments.find((item) => item.id === upload.data.documentId)
    expect(persistedDocument?.caseId).toBe('case_1')
    expect(persistedDocument?.metadata?.accessCode).toBe('ORTH-00123')
  })

  it('recalculates the next forecast from the last real tray change', async () => {
    const repository = createLocalPatientAccessRepository()
    const session = await repository.startPortalSession({
      cpf: '123.456.789-01',
      birthDate: '1994-08-10',
      accessCode: 'ORTH-00123',
    })

    expect(session.ok).toBe(true)
    if (!session.ok) return

    const portalUrl = new URL(session.data.portalUrl)
    const token = portalUrl.searchParams.get('token') ?? ''
    const accessCode = portalUrl.searchParams.get('accessCode') ?? ''

    const upload = await repository.uploadPortalPhoto({
      token,
      accessCode,
      trayNumber: 1,
      capturedAt: '2026-04-12',
      note: 'Troca real ocorreu depois da data prevista.',
      file: new File(['fake-image'], 'alinhador-1.jpg', { type: 'image/jpeg' }),
    })

    expect(upload.ok).toBe(true)
    if (!upload.ok) return

    const snapshot = await repository.resolvePortalSession({ token, accessCode })
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) return

    const trayTwo = snapshot.data.photoSlots.find((item) => item.trayNumber === 2)
    expect(trayTwo?.plannedDate).toBe('2026-04-27')
    expect(snapshot.data.summary.nextChangeDate).toBe('27/04/2026')
    expect(snapshot.data.summary.lastChangeDate).toBe('12/04/2026')
  })

  it('blocks a second upload for the same aligner after confirmation', async () => {
    const repository = createLocalPatientAccessRepository()
    const session = await repository.startPortalSession({
      cpf: '123.456.789-01',
      birthDate: '1994-08-10',
      accessCode: 'ORTH-00123',
    })

    expect(session.ok).toBe(true)
    if (!session.ok) return

    const portalUrl = new URL(session.data.portalUrl)
    const token = portalUrl.searchParams.get('token') ?? ''
    const accessCode = portalUrl.searchParams.get('accessCode') ?? ''

    const firstUpload = await repository.uploadPortalPhoto({
      token,
      accessCode,
      trayNumber: 2,
      capturedAt: '2026-04-13',
      note: 'Primeira selfie confirmada.',
      file: new File(['fake-image'], 'alinhador-2.jpg', { type: 'image/jpeg' }),
    })

    expect(firstUpload.ok).toBe(true)
    if (!firstUpload.ok) return

    const secondUpload = await repository.uploadPortalPhoto({
      token,
      accessCode,
      trayNumber: 2,
      capturedAt: '2026-04-14',
      note: 'Tentativa de trocar a foto.',
      file: new File(['fake-image-2'], 'alinhador-2-b.jpg', { type: 'image/jpeg' }),
    })

    expect(secondUpload.ok).toBe(false)
    if (secondUpload.ok) return
    expect(secondUpload.error).toContain('Não é possível alterar ou excluir')
  })
})
