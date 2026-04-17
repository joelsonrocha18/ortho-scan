import { describe, expect, it } from 'vitest'
import {
  buildDentistPortalWhatsappHref,
  buildPatientPortalWhatsappHref,
  resolvePatientPortalAccessCode,
  resolvePublicAccessUrl,
} from '../../lib/accessLinks'

describe('accessLinks', () => {
  it('builds patient portal whatsapp link with access code', () => {
    const href = buildPatientPortalWhatsappHref({
      patientName: 'Joelson',
      whatsapp: '(85) 99999-0000',
      accessCode: 'orth-00028',
      originOverride: 'https://ortho-scan.vercel.app',
    })

    expect(href).toContain('https://wa.me/5585999990000?text=')
    expect(decodeURIComponent(href.split('?text=')[1] ?? '')).toContain('Código do tratamento: ORTH-00028')
    expect(decodeURIComponent(href.split('?text=')[1] ?? '')).toContain('https://ortho-scan.vercel.app/acesso/pacientes')
  })

  it('builds dentist portal whatsapp link with login page and email', () => {
    const href = buildDentistPortalWhatsappHref({
      dentistName: 'Dra. Ana',
      whatsapp: '(11) 98888-7777',
      email: 'ana@clinic.com',
      originOverride: 'https://ortho-scan.vercel.app',
    })

    expect(href).toContain('https://wa.me/5511988887777?text=')
    expect(decodeURIComponent(href.split('?text=')[1] ?? '')).toContain('https://ortho-scan.vercel.app/acesso/dentistas')
    expect(decodeURIComponent(href.split('?text=')[1] ?? '')).toContain('Email de acesso: ana@clinic.com')
  })

  it('resolves patient access code from treatment code first', () => {
    expect(resolvePatientPortalAccessCode({ id: 'abc', shortId: 'P-1', treatmentCode: 'orth-77' } as const)).toBe('ORTH-77')
    expect(resolvePatientPortalAccessCode({ id: 'abc', shortId: 'P-1' } as const)).toBe('P-1')
    expect(resolvePatientPortalAccessCode({ id: 'abc' } as const)).toBe('ABC')
  })

  it('resolves public urls with normalized origin', () => {
    expect(resolvePublicAccessUrl('/acesso/pacientes', 'https://ortho-scan.vercel.app/')).toBe(
      'https://ortho-scan.vercel.app/acesso/pacientes',
    )
  })
})
