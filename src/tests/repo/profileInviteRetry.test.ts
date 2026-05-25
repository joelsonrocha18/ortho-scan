import { describe, expect, it } from 'vitest'
import { inviteUser } from '../../repo/profileRepo'

describe('inviteUser firebase validation', () => {
  it('fails safely without Firebase Auth configuration', async () => {
    const result = await inviteUser({
      email: 'novo@exemplo.com',
      role: 'receptionist',
      clinicId: 'clinic_1',
      password: 'senha-segura-123',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Firebase Auth')
    }
  })
})
