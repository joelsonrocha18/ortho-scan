import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../components/Button'
import Card from '../components/Card'
import Input from '../components/Input'
import { DATA_MODE } from '../data/dataMode'
import { completeOnboardingInvite, validateOnboardingInvite, completeOnboardingInviteSocial } from '../repo/onboardingRepo'
import { auth } from '../lib/firebaseClient'
import { getAuthProvider } from '../auth/authProvider'

type InviteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; preview: { fullName: string; role: string; roleLabel: string; clinicName: string } }

export default function OnboardingInvitePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = useMemo(() => params.get('token')?.trim() ?? '', [params])
  const [inviteState, setInviteState] = useState<InviteState>({ status: 'loading' })
  const [inviteCode, setInviteCode] = useState(token)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [fullName, setFullName] = useState('')
  const [gender, setGender] = useState<'masculino' | 'feminino'>('masculino')
  const [cro, setCro] = useState('')
  const [phone, setPhone] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [notes, setNotes] = useState('')

  const isDentistInvite = inviteState.status === 'ready' && (inviteState.preview.role === 'dentist_admin' || inviteState.preview.role === 'dentist_client')

  useEffect(() => {
    let active = true
    if (DATA_MODE !== 'firebase') {
      setInviteState({ status: 'invalid', message: 'Fluxo de convite disponível apenas em modo Firebase.' })
      return
    }
    if (!token) {
      setInviteState({ status: 'idle' })
      return
    }
    setInviteState({ status: 'loading' })
    validateOnboardingInvite(token).then((result) => {
      if (!active) return
      if (!result.ok) {
        if (result.used) {
          setInviteState({ status: 'invalid', message: 'Este convite já foi utilizado.' })
          return
        }
        if (result.expired) {
          setInviteState({ status: 'invalid', message: 'Este convite expirou. Solicite um novo link.' })
          return
        }
        setInviteState({ status: 'invalid', message: result.error })
        return
      }
      setFullName(result.preview.fullName ?? '')
      setInviteState({ status: 'ready', preview: result.preview })
    })
    return () => {
      active = false
    }
  }, [token])

  const validateInviteCode = async () => {
    if (!inviteCode.trim()) {
      setInviteState({ status: 'invalid', message: 'Informe o código de convite.' })
      return false
    }
    setInviteState({ status: 'loading' })
    const result = await validateOnboardingInvite(inviteCode.trim())
    if (!result.ok) {
      if (result.used) {
        setInviteState({ status: 'invalid', message: 'Este convite já foi utilizado.' })
        return false
      }
      if (result.expired) {
        setInviteState({ status: 'invalid', message: 'Este convite expirou. Solicite um novo convite.' })
        return false
      }
      setInviteState({ status: 'invalid', message: result.error })
      return false
    }
    setFullName(result.preview.fullName ?? '')
    setInviteState({ status: 'ready', preview: result.preview })
    return true
  }

  const submit = async () => {
    setError('')
    setMessage('')
    if (inviteState.status !== 'ready') {
      const valid = await validateInviteCode()
      if (!valid) return
    }
    // If Firebase social user already authenticated, complete the invite for that social account
    if (DATA_MODE === 'firebase' && auth?.currentUser) {
      setLoading(true)
      const result = await completeOnboardingInviteSocial(inviteCode.trim(), auth.currentUser.displayName ?? undefined)
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      // Refresh session and redirect to app
      await getAuthProvider().getCurrentUser()
      navigate('/app/dashboard', { replace: true })
      return
    }
    if (!email.trim()) {
      setError('Informe seu e-mail.')
      return
    }
    if (!fullName.trim()) {
      setError('Informe seu nome completo.')
      return
    }
    if (!password.trim() || password.trim().length < 10) {
      setError('Senha deve ter ao menos 10 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('As senhas não conferem.')
      return
    }
    setLoading(true)
    const result = await completeOnboardingInvite({
      token: inviteCode.trim(),
      email: email.trim(),
      password: password.trim(),
      fullName: fullName.trim(),
      dentist: isDentistInvite
        ? {
            name: fullName.trim(),
            gender,
            cro: cro.trim() || undefined,
            phone: phone.trim() || undefined,
            whatsapp: whatsapp.trim() || undefined,
            email: email.trim(),
            notes: notes.trim() || undefined,
          }
        : undefined,
    })
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setMessage('Cadastro concluido com sucesso. Voce ja pode entrar.')
    window.setTimeout(() => navigate('/login', { replace: true }), 1400)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <div className="relative w-full max-w-md">
        <Card className="border border-slate-800 bg-slate-900 p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-white">Concluir cadastro</h2>
          {inviteState.status === 'ready' ? (
            <p className="mt-1 text-sm text-slate-300">
              Convite para <strong>{inviteState.preview.fullName}</strong> ({inviteState.preview.roleLabel}) em{' '}
              {inviteState.preview.clinicName}.
            </p>
          ) : null}

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-200">Código de convite</label>
            <Input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} />
          </div>
          {inviteState.status === 'idle' ? (
            <div className="mt-4">
              <Button onClick={validateInviteCode}>Validar código</Button>
            </div>
          ) : null}
          {inviteState.status === 'loading' ? (
            <p className="mt-4 text-sm text-slate-300">Validando convite...</p>
          ) : null}

          {inviteState.status === 'invalid' ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-red-400">{inviteState.message}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={validateInviteCode}>Tentar novamente</Button>
                <Link to="/login" className="inline-flex text-sm font-semibold text-brand-700 hover:text-brand-500">
                  Voltar ao login
                </Link>
              </div>
            </div>
          ) : null}

          {inviteState.status === 'ready' ? (
            <div className="mt-6 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-200">Nome completo</label>
                <Input value={fullName} onChange={(event) => setFullName(event.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-200">Email</label>
                <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              {isDentistInvite ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-200">Sexo</label>
                    <select
                      value={gender}
                      onChange={(event) => setGender(event.target.value as 'masculino' | 'feminino')}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                    >
                      <option value="masculino">Masculino</option>
                      <option value="feminino">Feminino</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-200">CRO</label>
                    <Input value={cro} onChange={(event) => setCro(event.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-200">Telefone</label>
                    <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-200">WhatsApp</label>
                    <Input value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-slate-200">Observações</label>
                    <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
                  </div>
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-200">Senha</label>
                <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-200">Confirmar senha</label>
                <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </div>
              <Button className="w-full" onClick={submit} disabled={loading}>
                {loading ? 'Concluindo...' : 'Concluir cadastro'}
              </Button>
            </div>
          ) : null}

          {error ? <p className="mt-3 text-xs text-red-500">{error}</p> : null}
          {message ? <p className="mt-3 text-xs text-emerald-400">{message}</p> : null}
        </Card>
      </div>
    </div>
  )
}

