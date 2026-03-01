import { useEffect, useState } from 'react'
import { Menu } from 'lucide-react'
import { profileLabel } from '../auth/permissions'
import { DATA_MODE } from '../data/dataMode'
import { formatUserDisplayName } from '../lib/displayName'
import { getCurrentUser } from '../lib/auth'
import { supabase } from '../lib/supabaseClient'
import { useDb } from '../lib/useDb'
import Breadcrumb from './Breadcrumb'
import Button from './Button'

type TopbarProps = {
  breadcrumb: string[]
  onMenuToggle: () => void
}

export default function Topbar({ breadcrumb, onMenuToggle }: TopbarProps) {
  const { db } = useDb()
  const currentUser = getCurrentUser(db)
  const [profileDisplayName, setProfileDisplayName] = useState('')

  useEffect(() => {
    let active = true
    if (DATA_MODE !== 'supabase' || !supabase || !currentUser?.id) {
      setProfileDisplayName('')
      return
    }
    void (async () => {
      const { data } = await supabase.from('profiles').select('full_name').eq('user_id', currentUser.id).maybeSingle()
      if (!active) return
      setProfileDisplayName(((data as { full_name?: string } | null)?.full_name ?? '').trim())
    })()
    return () => {
      active = false
    }
  }, [currentUser?.id])

  const displayUser = currentUser
    ? { ...currentUser, name: profileDisplayName || currentUser.name || currentUser.email }
    : null
  const userDisplayName = formatUserDisplayName(displayUser, db.dentists)

  return (
    <header className="border-b border-slate-200 bg-white px-4 py-2.5 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" className="md:hidden" aria-label="Abrir menu" onClick={onMenuToggle}>
          <Menu className="h-5 w-5" />
        </Button>
        <Breadcrumb items={breadcrumb} />
        {currentUser ? (
          <div className="flex max-w-full items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="font-semibold text-emerald-700">Online</span>
            <span className="hidden text-slate-500 sm:inline">|</span>
            <span className="max-w-[170px] truncate font-medium text-slate-700 sm:max-w-[260px]">{userDisplayName}</span>
            <span className="hidden text-slate-400 sm:inline">({profileLabel(currentUser.role)})</span>
          </div>
        ) : null}
      </div>
    </header>
  )
}
