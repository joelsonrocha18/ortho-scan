import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearLegacyPersistentAuthStorage,
  SESSION_ACCESS_TOKEN_KEY,
  SESSION_PROFILE_KEY,
  SESSION_USER_KEY,
} from '../../lib/authStorage'
import {
  clearSession,
  getAccessToken,
  getSessionProfile,
  getSessionUserId,
  setAccessToken,
  setSessionProfile,
  setSessionUserId,
} from '../../lib/auth'

describe('auth session security', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('stores auth session data only in sessionStorage', () => {
    setSessionUserId('user_session_1')
    setSessionProfile({
      id: 'user_session_1',
      email: 'user@example.com',
      role: 'master_admin',
    })
    setAccessToken('token_session_1')

    expect(sessionStorage.getItem(SESSION_USER_KEY)).toBe('user_session_1')
    expect(sessionStorage.getItem(SESSION_PROFILE_KEY)).toContain('user@example.com')
    expect(sessionStorage.getItem(SESSION_ACCESS_TOKEN_KEY)).toBe('token_session_1')
    expect(localStorage.getItem(SESSION_USER_KEY)).toBeNull()
    expect(localStorage.getItem(SESSION_PROFILE_KEY)).toBeNull()
    expect(localStorage.getItem(SESSION_ACCESS_TOKEN_KEY)).toBeNull()
  })

  it('does not restore auth data from legacy localStorage persistence', () => {
    localStorage.setItem(SESSION_USER_KEY, 'user_legacy_1')
    localStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify({
      id: 'user_legacy_1',
      email: 'legacy@example.com',
      role: 'dentist_admin',
    }))
    localStorage.setItem(SESSION_ACCESS_TOKEN_KEY, 'legacy_token')

    expect(getSessionUserId()).toBeNull()
    expect(getSessionProfile()).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('clears legacy persistent auth keys from localStorage', () => {
    localStorage.setItem(SESSION_USER_KEY, 'user_legacy_2')
    localStorage.setItem(SESSION_PROFILE_KEY, '{"id":"user_legacy_2"}')
    localStorage.setItem(SESSION_ACCESS_TOKEN_KEY, 'legacy_token_2')
    localStorage.setItem('sb-test-auth-token', '{"access_token":"abc"}')
    localStorage.setItem('orthoscan.preserve.me', '1')

    clearLegacyPersistentAuthStorage()

    expect(localStorage.getItem(SESSION_USER_KEY)).toBeNull()
    expect(localStorage.getItem(SESSION_PROFILE_KEY)).toBeNull()
    expect(localStorage.getItem(SESSION_ACCESS_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem('sb-test-auth-token')).toBeNull()
    expect(localStorage.getItem('orthoscan.preserve.me')).toBe('1')
  })

  it('clears session and legacy auth persistence on sign-out cleanup', () => {
    sessionStorage.setItem(SESSION_USER_KEY, 'user_legacy_3')
    sessionStorage.setItem(SESSION_PROFILE_KEY, '{"id":"user_legacy_3"}')
    sessionStorage.setItem(SESSION_ACCESS_TOKEN_KEY, 'session_token')
    localStorage.setItem(SESSION_USER_KEY, 'user_legacy_3')
    localStorage.setItem('sb-test-auth-token', '{"access_token":"abc"}')

    clearSession()

    expect(sessionStorage.getItem(SESSION_USER_KEY)).toBeNull()
    expect(sessionStorage.getItem(SESSION_PROFILE_KEY)).toBeNull()
    expect(sessionStorage.getItem(SESSION_ACCESS_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(SESSION_USER_KEY)).toBeNull()
    expect(localStorage.getItem('sb-test-auth-token')).toBeNull()
  })
})
