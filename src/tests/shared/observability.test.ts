import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildAuditLog,
  BUSINESS_EVENTS,
  createStructuredLogRecord,
  emitStructuredLog,
  registerStructuredLogSink,
  sanitizeForLog,
} from '../../shared/observability'

describe('shared observability', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('redacts sensitive keys and values from structured logs', () => {
    const sanitized = sanitizeForLog({
      password: '123456',
      nested: {
        apiKey: 'secret',
        email: 'person@example.com',
        safe: 'ORTH-00001',
      },
      token: 'Bearer abc.def.ghi',
    })

    expect(sanitized.password).toBe('[REDACTED]')
    expect((sanitized.nested as { apiKey: string }).apiKey).toBe('[REDACTED]')
    expect((sanitized.nested as { email: string }).email).toBe('[REDACTED]')
    expect((sanitized.nested as { safe: string }).safe).toBe('ORTH-00001')
    expect(sanitized.token).toBe('[REDACTED]')
  })

  it('emits structured JSON logs for business events', () => {
    sessionStorage.setItem('arrimo_session_profile', JSON.stringify({
      id: 'user_obs_1',
      role: 'lab_tech',
      email: 'lab@example.com',
    }))
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const record = createStructuredLogRecord({
      level: 'info',
      category: 'business',
      event: BUSINESS_EVENTS.LAB_SENT,
      message: 'Caso enviado para o LAB.',
      context: {
        caseId: 'case_1',
        email: 'patient@example.com',
        token: 'abc.def.ghi',
      },
    })

    emitStructuredLog(record)

    expect(record.category).toBe('business')
    expect(record.actor?.id).toBe('user_obs_1')
    expect(record.actor?.role).toBe('lab_tech')
    expect(record.context.email).toBe('[REDACTED]')
    expect(record.context.token).toBe('[REDACTED]')
    expect(consoleSpy).toHaveBeenCalledTimes(1)

    const serialized = consoleSpy.mock.calls[0]?.[0]
    expect(typeof serialized).toBe('string')
    const parsed = JSON.parse(serialized as string) as typeof record
    expect(parsed.event).toBe(BUSINESS_EVENTS.LAB_SENT)
    expect(parsed.context.caseId).toBe('case_1')
    expect(parsed.context.email).toBe('[REDACTED]')
  })

  it('notifies registered structured log sinks', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const received: unknown[] = []
    const unregister = registerStructuredLogSink((record) => {
      received.push(record)
    })

    const record = createStructuredLogRecord({
      level: 'info',
      category: 'business',
      event: BUSINESS_EVENTS.CASE_CREATED,
      message: 'Caso criado.',
      context: { caseId: 'case_sink_1' },
    })

    emitStructuredLog(record)
    unregister()
    emitStructuredLog(record)

    expect(consoleSpy).toHaveBeenCalledTimes(2)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ event: BUSINESS_EVENTS.CASE_CREATED })
  })

  it('builds audit entries with actor, role and sanitized context', () => {
    sessionStorage.setItem('arrimo_session_user_id', 'user_obs_2')
    sessionStorage.setItem('arrimo_session_profile', JSON.stringify({
      id: 'user_obs_2',
      role: 'dentist_admin',
      email: 'admin@example.com',
    }))

    const entry = buildAuditLog({
      entity: 'case',
      entityId: 'case_2',
      action: 'case.status_changed',
      message: 'Status alterado.',
      context: {
        caseId: 'case_2',
        nextStatus: 'em_producao',
        email: 'patient@example.com',
      },
    })

    expect(entry.userId).toBe('user_obs_2')
    expect(entry.userRole).toBe('dentist_admin')
    expect(entry.userEmail).toBe('admin@example.com')
    expect(entry.context?.caseId).toBe('case_2')
    expect(entry.context?.nextStatus).toBe('em_producao')
    expect(entry.context?.email).toBe('[REDACTED]')
  })

  it('ignores stale auth data persisted in localStorage', () => {
    localStorage.setItem('arrimo_session_user_id', 'user_obs_legacy')
    localStorage.setItem('arrimo_session_profile', JSON.stringify({
      id: 'user_obs_legacy',
      role: 'master_admin',
      email: 'legacy@example.com',
    }))

    const entry = buildAuditLog({
      entity: 'case',
      entityId: 'case_legacy',
      action: 'case.viewed',
      message: 'Visualizacao do caso.',
    })

    expect(entry.userId).toBeUndefined()
    expect(entry.userRole).toBeUndefined()
    expect(entry.userEmail).toBeUndefined()
  })
})
