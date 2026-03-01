import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import InternalChatWidget from '../components/InternalChatWidget'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'

type AppShellProps = {
  breadcrumb: string[]
  children: ReactNode
}

export default function AppShell({ breadcrumb, children }: AppShellProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-slate-100">
      {sidebarOpen ? <button type="button" aria-label="Fechar menu" className="fixed inset-0 z-40 bg-slate-900/50 md:hidden" onClick={() => setSidebarOpen(false)} /> : null}
      <Sidebar isOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)} onLogout={() => navigate('/login', { replace: true })} />
      <div className="md:pl-64">
        <Topbar breadcrumb={breadcrumb} onMenuToggle={() => setSidebarOpen((current) => !current)} />
        <main className="px-4 py-4 sm:px-5">{children}</main>
        <InternalChatWidget />
      </div>
    </div>
  )
}
