import { describe, expect, it } from 'vitest'
import {
  buildWhatsappServiceUrl,
  isWhatsappServiceReady,
  normalizeWhatsappServiceBaseUrl,
  normalizeWhatsappServiceRecipient,
} from '../../lib/whatsappService'
import type { WhatsappServiceSettings } from '../../lib/systemSettings'

const baseConfig: WhatsappServiceSettings = {
  enabled: true,
  baseUrl: 'https://whatsapp.orthoscan.online',
  adminToken: 'secret-token',
}

describe('whatsappService', () => {
  it('normalizes Brazilian mobile recipients', () => {
    expect(normalizeWhatsappServiceRecipient('(86) 99999-0000')).toBe('5586999990000')
    expect(normalizeWhatsappServiceRecipient('5586999990000')).toBe('5586999990000')
    expect(normalizeWhatsappServiceRecipient('(86) 3333-0000')).toBe('')
  })

  it('validates readiness from service settings', () => {
    expect(isWhatsappServiceReady(baseConfig)).toBe(true)
    expect(isWhatsappServiceReady({ ...baseConfig, enabled: false })).toBe(false)
    expect(isWhatsappServiceReady({ ...baseConfig, baseUrl: '' })).toBe(false)
    expect(isWhatsappServiceReady({ ...baseConfig, adminToken: '' })).toBe(false)
  })

  it('builds authenticated service URLs', () => {
    expect(normalizeWhatsappServiceBaseUrl('https://whatsapp.orthoscan.online/')).toBe('https://whatsapp.orthoscan.online')
    expect(buildWhatsappServiceUrl('https://whatsapp.orthoscan.online/', '/qr', 'abc 123')).toBe(
      'https://whatsapp.orthoscan.online/qr?token=abc+123',
    )
  })
})
