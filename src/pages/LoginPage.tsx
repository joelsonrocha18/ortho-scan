import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Apple, Chrome, HeartPulse, Stethoscope } from 'lucide-react'
import BrandLockup from '../components/BrandLockup'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import { getAuthProvider } from '../auth/authProvider'
import type { SocialAuthProvider } from '../auth/session'
import { DATA_MODE } from '../data/dataMode'

type LoginErrors = {
  email?: string
  password?: string
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<LoginErrors>({})
  const [loading, setLoading] = useState(false)
  const [socialLoading, setSocialLoading] = useState<SocialAuthProvider | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors: LoginErrors = {}

    if (!email.trim()) {
      nextErrors.email = 'Usuário ou e-mail obrigatório'
    }

    if (!password.trim()) {
      nextErrors.password = 'Senha obrigatória'
    }

    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setLoading(true)
    try {
      await getAuthProvider().signIn(email.trim(), password.trim())
      await getAuthProvider().getCurrentUser()
      navigate('/app/dashboard', { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao autenticar.'
      setErrors({ email: message })
    } finally {
      setLoading(false)
    }
  }

  const handleSocialSignIn = async (provider: SocialAuthProvider) => {
    setErrors({})
    setSocialLoading(provider)
    try {
      await getAuthProvider().signInWithProvider(provider)
      await getAuthProvider().getCurrentUser()
      navigate('/app/dashboard', { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao autenticar.'
      setErrors({ email: message })
    } finally {
      setSocialLoading(null)
    }
  }

  return (
    <div className="app-login-shell relative flex min-h-[100dvh] items-center justify-center overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-4 sm:py-6">
      <img
        src={`${import.meta.env.BASE_URL}brand/orthoscan-submark-dark.jpg`}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-auto w-[min(1780px,140vw)] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.2]"
      />

      <div className="absolute inset-x-0 top-0 z-20 px-3 py-3 sm:px-4 sm:py-4">
        <div className="mx-auto flex max-w-7xl justify-end">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              to="/acesso/dentistas"
              className="group inline-flex min-w-[188px] items-center justify-between gap-3 rounded-2xl border border-white/12 bg-slate-950/28 px-4 py-3 text-left text-white shadow-[0_14px_35px_-28px_rgba(0,0,0,0.65)] backdrop-blur-xl transition hover:border-baby-200/42 hover:bg-slate-950/38"
            >
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-baby-100/80">Portal externo</p>
                <p className="mt-1 text-sm font-semibold text-white">Área do Parceiro</p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-baby-100 transition group-hover:bg-baby-100/12">
                <Stethoscope className="h-4 w-4" />
              </span>
            </Link>

            <Link
              to="/acesso/pacientes"
              className="group inline-flex min-w-[188px] items-center justify-between gap-3 rounded-2xl border border-white/12 bg-slate-950/28 px-4 py-3 text-left text-white shadow-[0_14px_35px_-28px_rgba(0,0,0,0.65)] backdrop-blur-xl transition hover:border-[#d0d9ad]/52 hover:bg-slate-950/38"
            >
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#eef6d8]">Portal externo</p>
                <p className="mt-1 text-sm font-semibold text-white">Área do Paciente</p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-[#eef6d8] transition group-hover:bg-[#d0d9ad]/12">
                <HeartPulse className="h-4 w-4" />
              </span>
            </Link>
          </div>
        </div>
      </div>

      <div className="relative z-10 mt-20 w-full max-w-md sm:mt-14">
        <Card className="app-login-card border p-4 text-white sm:p-6">
          <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-5 text-center shadow-[0_18px_40px_-30px_rgba(0,0,0,0.7)]">
            <BrandLockup tone="light" size="lg" align="center" />
          </div>

          <form className="mt-2 space-y-3" onSubmit={handleSubmit} noValidate>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-200">
                Usuário (e-mail)
              </label>
              <Input
                id="email"
                type="text"
                placeholder="usuário ou seu@email.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="border-white/15 bg-white/10 text-white placeholder:text-slate-400 focus:border-baby-200 focus:ring-baby-200/30"
              />
              {errors.email ? <p className="mt-1 text-xs text-red-600">{errors.email}</p> : null}
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-200">
                Senha
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="border-white/15 bg-white/10 pr-16 text-white placeholder:text-slate-400 focus:border-baby-200 focus:ring-baby-200/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-baby-100 hover:text-white"
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              {errors.password ? <p className="mt-1 text-xs text-red-600">{errors.password}</p> : null}
            </div>

            <Button type="submit" className="w-full">
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
            {DATA_MODE !== 'local' ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button type="button" variant="secondary" className="border-white/15 bg-white/10 text-white hover:bg-white/15" disabled={Boolean(socialLoading)} onClick={() => void handleSocialSignIn('google')}>
                  <Chrome className="mr-2 h-4 w-4" />
                  {socialLoading === 'google' ? 'Conectando...' : 'Google'}
                </Button>
                <Button type="button" variant="secondary" className="border-white/15 bg-white/10 text-white hover:bg-white/15" disabled={Boolean(socialLoading)} onClick={() => void handleSocialSignIn('apple')}>
                  <Apple className="mr-2 h-4 w-4" />
                  {socialLoading === 'apple' ? 'Conectando...' : 'Apple'}
                </Button>
              </div>
            ) : null}
            <div className="text-right">
              <Link to="/reset-password" className="text-xs font-semibold text-baby-100 hover:text-white">
                Esqueci minha senha
              </Link>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs">
            <Link to="/legal/terms" className="font-semibold text-slate-300 hover:text-baby-100">
              Termos
            </Link>
            <span className="text-slate-700">|</span>
            <Link to="/legal/privacy" className="font-semibold text-slate-300 hover:text-baby-100">
              Privacidade
            </Link>
            <span className="text-slate-700">|</span>
            <Link to="/legal/lgpd" className="font-semibold text-slate-300 hover:text-baby-100">
              LGPD
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
