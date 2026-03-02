import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import { getAuthProvider } from '../auth/authProvider'

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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors: LoginErrors = {}

    if (!email.trim()) {
      nextErrors.email = 'Usuario ou email obrigatorio'
    }

    if (!password.trim()) {
      nextErrors.password = 'Senha obrigatoria'
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

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-slate-950 px-3 py-4 sm:px-4 sm:py-6">
      <img
        src={`${import.meta.env.BASE_URL}brand/arrimo.png`}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-10"
      />
      <div className="relative w-full max-w-md">
        <Card className="border border-slate-800 bg-slate-900 p-4 sm:p-6">
          <div className="mb-4 flex flex-col items-center text-center">
            <img
              src={`${import.meta.env.BASE_URL}brand/orthoscan-bg.png`}
              alt="ORTHOSCAN"
              className="h-auto w-[220px] object-contain sm:w-[280px]"
            />
          </div>

          <form className="mt-2 space-y-3" onSubmit={handleSubmit} noValidate>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-200">
                Usuario (email)
              </label>
              <Input
                id="email"
                type="text"
                placeholder="usuario ou seu@email.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
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
                  className="pr-16"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              {errors.password ? <p className="mt-1 text-xs text-red-600">{errors.password}</p> : null}
            </div>

            <Button type="submit" className="w-full">
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
            <div className="text-right">
              <Link to="/reset-password" className="text-xs font-semibold text-brand-700 hover:text-brand-500">
                Esqueci minha senha
              </Link>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs">
            <Link to="/legal/terms" className="font-semibold text-slate-300 hover:text-white">
              Termos
            </Link>
            <span className="text-slate-700">|</span>
            <Link to="/legal/privacy" className="font-semibold text-slate-300 hover:text-white">
              Privacidade
            </Link>
            <span className="text-slate-700">|</span>
            <Link to="/legal/lgpd" className="font-semibold text-slate-300 hover:text-white">
              LGPD
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
