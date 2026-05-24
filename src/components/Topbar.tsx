import { useEffect, useState } from 'react'
import { Menu } from 'lucide-react'
import { DATA_MODE } from '../data/dataMode'
import { formatUserDisplayName } from '../lib/displayName'
import { getCurrentUser } from '../lib/auth'
import { getProfileByUserId } from '../repo/profileRepo'
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
    if (DATA_MODE !== 'firebase' || !currentUser?.id) {
      setProfileDisplayName('')
      return
    }
    void (async () => {
      const profile = await getProfileByUserId(currentUser.id)
      if (!active) return
      setProfileDisplayName((profile?.full_name ?? '').trim())
    })()
    return () => {
      active = false
    }
  }, [currentUser?.id])

  const displayUser = currentUser
    ? { ...currentUser, name: profileDisplayName || currentUser.name || currentUser.email }
    : null
  const baseUserDisplayName = formatUserDisplayName(displayUser, db.dentists)
  const userPrefix = currentUser?.role === 'lab_tech'
    ? 'TEC'
    : currentUser?.role === 'dentist_admin' || currentUser?.role === 'dentist_client'
      ? 'Dr'
      : ''
  const userDisplayName = userPrefix ? `${userPrefix} ${baseUserDisplayName}` : baseUserDisplayName

  return (
    <header className="sticky top-0 z-20 border-b border-baby-200/80 bg-white/94 px-4 py-2.5 shadow-[0_16px_28px_-28px_rgba(1,82,125,0.38)] backdrop-blur-md sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" className="md:hidden" aria-label="Abrir menu" onClick={onMenuToggle}>
          <Menu className="h-5 w-5" />
        </Button>
        <Breadcrumb items={breadcrumb} />
        {currentUser ? (
          <div className="flex max-w-full items-center gap-2 rounded-full border border-baby-200 bg-baby-50 px-3 py-1 text-xs shadow-[0_8px_18px_-16px_rgba(1,82,125,0.45)]">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-baby-500" />
            <span className="font-semibold text-brand-700">Online</span>
            <span className="hidden text-slate-500 sm:inline">|</span>
            <span className="max-w-[170px] truncate font-medium text-slate-800 sm:max-w-[260px]">{userDisplayName}</span>
          </div>
        ) : null}
      </div>
    </header>
  )
}
