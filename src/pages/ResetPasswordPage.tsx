import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import { completePasswordReset, requestPasswordReset } from '../repo/accessRepo'
import { DATA_MODE } from '../data/dataMode'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryToken = useMemo(() => params.get('token') ?? '', [params])
  const [token, setToken] = useState(queryToken)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const requestToken = async () => {
    setError('')
    setMessage('')
    if (!email.trim()) {
      setError('Informe seu e-mail.')
      return
    }
    if (DATA_MODE !== 'firebase') {
      setMessage('No modo local, solicite ao administrador a redefinição.')
      return
    }
    setLoading(true)
    const result = await requestPasswordReset({ email: email.trim() })
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setMessage('Se o e-mail existir, o link de redefinição foi enviado.')
  }

  const submitReset = async () => {
    setError('')
    setMessage('')
    if (!token.trim()) {
      setError('Token obrigatório.')
      return
    }
    if (!password.trim() || password.length < 10) {
      setError('Senha deve ter ao menos 10 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não conferem.')
      return
    }
    if (DATA_MODE !== 'firebase') {
      setError('Redefinição por token no Firebase usa o link enviado por e-mail (Firebase Auth).')
      return
    }
    setLoading(true)
    const result = await completePasswordReset({ token: token.trim(), newPassword: password })
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setMessage('Senha redefinida com sucesso. Você já pode entrar.')
    window.setTimeout(() => navigate('/login', { replace: true }), 1200)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <div className="relative w-full max-w-md">
        <Card className="border border-slate-800 bg-slate-900 p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-white">Redefinir Senha</h2>
          <p className="mt-1 text-sm text-slate-300">Solicite um token por e-mail e conclua a redefinição.</p>

          <div className="mt-6 space-y-3">
            <label className="mb-1 block text-sm font-medium text-slate-200">Email</label>
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            <Button className="w-full" variant="secondary" onClick={requestToken} disabled={loading}>
              Solicitar token por e-mail
            </Button>
          </div>

          <div className="mt-6 space-y-3">
            <label className="mb-1 block text-sm font-medium text-slate-200">Token</label>
            <Input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Cole o token recebido" />
            <label className="mb-1 block text-sm font-medium text-slate-200">Nova senha</label>
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            <label className="mb-1 block text-sm font-medium text-slate-200">Confirmar nova senha</label>
            <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
            <Button className="w-full" onClick={submitReset} disabled={loading}>
              {loading ? 'Processando...' : 'Concluir redefinição'}
            </Button>
          </div>

          {error ? <p className="mt-3 text-xs text-red-500">{error}</p> : null}
          {message ? <p className="mt-3 text-xs text-emerald-400">{message}</p> : null}

          <p className="mt-6 text-center text-sm text-slate-300">
            <Link to="/login" className="font-semibold text-brand-700 hover:text-brand-500">
              Voltar ao login
            </Link>
          </p>
        </Card>
      </div>
    </div>
  )
}

