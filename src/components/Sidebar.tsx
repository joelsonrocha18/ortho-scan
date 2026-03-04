import { Building2, FlaskConical, LayoutDashboard, LogOut, ScanLine, Settings, Shapes, UserRound, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { getAuthProvider } from '../auth/authProvider'
import { can } from '../auth/permissions'
import { clearSession, getCurrentUser } from '../lib/auth'
import { useDb } from '../lib/useDb'
import Button from './Button'

type SidebarProps = {
  isOpen: boolean
  onCloseMobile: () => void
  onLogout: () => void
}

export default function Sidebar({ isOpen, onCloseMobile, onLogout }: SidebarProps) {
  const { db } = useDb()
  const currentUser = getCurrentUser(db)
  const handleLogout = async () => {
    try {
      await getAuthProvider().signOut()
    } catch {
      clearSession()
    }
    onLogout()
  }

  const menuItems = [
    { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.read' as const },
    { to: '/app/scans', label: 'Exames', icon: ScanLine, permission: 'scans.read' as const },
    { to: '/app/cases', label: 'Alinhadores', icon: Shapes, permission: 'cases.read' as const },
    { to: '/app/dentists', label: 'Dentistas', icon: UserRound, permission: 'dentists.read' as const },
    { to: '/app/clinics', label: 'Clínicas', icon: Building2, permission: 'clinics.read' as const },
    { to: '/app/patients', label: 'Pacientes', icon: Users, permission: 'patients.read' as const },
    { to: '/app/lab', label: 'Laboratório', icon: FlaskConical, permission: 'lab.read' as const },
    { to: '/app/settings', label: 'Configurações', icon: Settings, permission: 'settings.read' as const },
  ]

  return (
    <aside
      className={[
        'fixed inset-y-0 left-0 z-50 w-[82vw] max-w-72 border-r border-slate-700 bg-slate-900 text-slate-100 transition-transform duration-200 md:z-30 md:w-64',
        isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      ].join(' ')}
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-700 px-2 py-3">
          <img
            src={`${import.meta.env.BASE_URL}brand/orthoscan.png`}
            alt="OrthoScan"
            className="mx-auto block h-auto w-full max-w-[220px] object-contain"
          />
        </div>

        <nav className="flex-1 space-y-2 px-4 py-6">
          {menuItems
            .filter((item) => can(currentUser, item.permission))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onCloseMobile}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                  ].join(' ')
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
        </nav>

        <div className="border-t border-slate-700 p-4">
          <Button variant="ghost" className="w-full justify-start text-slate-200 hover:bg-slate-800" onClick={() => void handleLogout()}>
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </Button>
        </div>
      </div>
    </aside>
  )
}
