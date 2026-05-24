import { Boxes, Building2, CalendarDays, FileText, FlaskConical, LayoutDashboard, LogOut, ScanLine, Settings, Shapes, Stethoscope, Tags, UserRound, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { getAuthProvider } from '../auth/authProvider'
import { can } from '../auth/permissions'
import { clearSession, getCurrentUser } from '../lib/auth'
import { useDb } from '../lib/useDb'
import BrandLockup from './BrandLockup'
import Button from './Button'

type SidebarProps = {
  isOpen: boolean
  onCloseMobile: () => void
  onLogout: () => void
}

const dentistPortalRoles = ['dentist_admin', 'dentist_client', 'clinic_client'] as const

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
    { to: '/app/dashboard', label: 'Painel', icon: LayoutDashboard, permission: 'dashboard.read' as const },
    { to: '/app/agenda', label: 'Agenda', icon: CalendarDays, permission: 'agenda.read' as const },
    { to: '/app/scans', label: 'Exames', icon: ScanLine, permission: 'scans.read' as const },
    { to: '/app/cases', label: 'Alinhadores', icon: Shapes, permission: 'cases.read' as const },
    { to: '/app/portal-dentista', label: 'Portal do dentista', icon: Stethoscope, permission: 'cases.read' as const, onlyRoles: dentistPortalRoles },
    { to: '/app/dentists', label: 'Dentistas', icon: UserRound, permission: 'dentists.read' as const },
    { to: '/app/clinics', label: 'Clínicas', icon: Building2, permission: 'clinics.read' as const },
    { to: '/app/patients', label: 'Pacientes', icon: Users, permission: 'patients.read' as const },
    { to: '/app/lab', label: 'Laboratório', icon: FlaskConical, permission: 'lab.read' as const },
    { to: '/app/pricing', label: 'Preços', icon: Tags, permission: 'settings.read' as const },
    { to: '/app/inventory', label: 'Estoque', icon: Boxes, permission: 'settings.read' as const },
    { to: '/app/contracts', label: 'Contratos', icon: FileText, permission: 'settings.read' as const },
    { to: '/app/settings', label: 'Configurações', icon: Settings, permission: 'settings.read' as const },
  ]

  return (
    <aside
      className={[
        'app-sidebar fixed inset-y-0 left-0 z-50 w-[82vw] max-w-72 border-r border-white/10 text-slate-100 transition-transform duration-200 md:z-30 md:w-64',
        isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      ].join(' ')}
    >
      <div className="relative flex h-full flex-col">
        <div className="border-b border-white/10 px-4 py-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 shadow-[0_18px_30px_-24px_rgba(0,0,0,0.6)] backdrop-blur-sm">
            <BrandLockup tone="light" size="sm" />
          </div>
        </div>

        <nav className="flex-1 space-y-2 px-4 py-6">
          {menuItems
            .filter((item) => can(currentUser, item.permission))
            .filter((item) => !item.onlyRoles || Boolean(currentUser && item.onlyRoles.includes(currentUser.role as (typeof dentistPortalRoles)[number])))
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onCloseMobile}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                    isActive ? 'app-sidebar-active text-white' : 'text-slate-200/90 hover:bg-white/10 hover:text-white',
                  ].join(' ')
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <Button variant="ghost" className="w-full justify-start text-slate-100 hover:bg-white/10 hover:text-white" onClick={() => void handleLogout()}>
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </Button>
        </div>
      </div>
    </aside>
  )
}
