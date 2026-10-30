import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation, Navigate } from 'react-router-dom'
import { api, setCsrf } from './api.js'
import { Msg, RANK } from './ui.jsx'
import { Login, Setup, Password } from './pages/Auth.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Findings from './pages/Findings.jsx'
import FindingForm from './pages/FindingForm.jsx'
import { FindingDetail, RepairEdit } from './pages/FindingDetail.jsx'
import { Tags, TagEdit, TagImport } from './pages/Tags.jsx'
import { DeclassList, DeclassNew, DeclassDetail } from './pages/Declass.jsx'
import { AreasPage, TypesPage, UsersPage, UserEdit } from './pages/Admin.jsx'
import ReportsPage from './pages/Reports.jsx'

export const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

const MOON = <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="currentColor" /></svg>
const SUN = (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" fill="currentColor" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

const navIconShapes = {
  overview: <><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></>,
  findings: <><circle cx="11" cy="11" r="7.5" /><path d="M16.5 16.5 21 21M11 7.5v7M7.5 11h7" /></>,
  declass: <><path d="M12 3 20 7v5c0 4.7-3.1 7.7-8 9-4.9-1.3-8-4.3-8-9V7l8-4Z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></>,
  tags: <><path d="M3.5 12V5.5a2 2 0 0 1 2-2H12l8.5 8.5-8.5 8.5L3.5 12Z" /><circle cx="8" cy="8" r="1" /></>,
  areas: <><path d="M3.5 20.5h17M5 20.5V8l7-4 7 4v12.5M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10 20.5v-3h4v3" /></>,
  types: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-3.2 2.7-5 6.5-5s6 1.8 6.5 5M16 5.2a3.5 3.5 0 0 1 0 6.6M17 15c2.6.5 4 2.2 4.5 5" /></>,
  reports: <><path d="M5 3.5h9l5 5v12H5z" /><path d="M14 3.5v5h5M8 13h8M8 16.5h8" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.1 1.8-1.6 2.7-2.1-.5a7.8 7.8 0 0 1-1.5.9l-.8 2h-3.1l-.8-2a7.8 7.8 0 0 1-1.5-.9l-2.1.5-1.6-2.7 1.1-1.8a7 7 0 0 1 0-1.8l-1.1-1.8L7 8.7l2.1.5a7.8 7.8 0 0 1 1.5-.9l.8-2h3.1l.8 2a7.8 7.8 0 0 1 1.5.9l2.1-.5 1.6 2.7-1.1 1.8a7 7 0 0 1 0 1.8Z" transform="translate(-1 -1) scale(1.08)" /></>,
}

function NavIcon({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{navIconShapes[name]}</svg>
}

function useTheme() {
  const eff = () => document.documentElement.getAttribute('data-theme') || 'dark'
  const [theme, setTheme] = useState(eff)
  const toggle = () => {
    const n = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', n)
    try { localStorage.setItem('theme', n) } catch { /* sin almacenamiento */ }
    setTheme(n)
  }
  return [theme, toggle]
}

function TopBar({ user, onLogout }) {
  const [theme, toggle] = useTheme()
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => { setOpen(false) }, [loc.pathname])
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [])
  const rank = user ? RANK[user.role] : 0
  const primary = [
    ['/', 'Resumen', 'overview'], ['/hallazgos', 'Hallazgos', 'findings'], ['/desclasificaciones', 'Desclasificaciones', 'declass'],
  ]
  const admin = [
    ['/tags', 'Tags de equipos', 'tags', 2], ['/areas', 'Áreas', 'areas', 3], ['/tipos', 'Tipos de hallazgo', 'types', 3], ['/usuarios', 'Usuarios', 'users', 3],
  ].filter((item) => rank >= item[3])
  const canReports = rank >= RANK.supervisor
  const roleNames = { tecnico: 'Técnico', supervisor: 'Supervisor', admin: 'Administrador' }
  const initials = user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  const link = ([to, label, icon]) => (
    <NavLink key={to} to={to} end={to === '/' || to === '/hallazgos'} className="side-link" onClick={() => setOpen(false)}>
      <span className="side-icon"><NavIcon name={icon} /></span>
      <span>{label}</span>
    </NavLink>
  )
  return (
    <div className={`app-shell${open ? ' menu-open' : ''}`}>
      {open && <button className="nav-backdrop" aria-label="Cerrar menú" onClick={() => setOpen(false)} />}
      <aside className="sidebar" aria-label="Navegación principal">
        <Link to="/" className="brand"><img src="/logo.png" alt="Petrocuyo HAZLOC" /><span><b>Inspecciones</b><small>SEGURIDAD OPERACIONAL</small></span></Link>
        <div className="side-nav">
          <p className="nav-label">Espacio de trabajo</p>
          {primary.map(link)}
          {admin.length > 0 && <><p className="nav-label nav-label-admin">Administración</p>{admin.map(link)}</>}
          {canReports && <><p className="nav-label nav-label-admin">Informes</p>{link(['/informes', 'Informes y reportes', 'reports'])}</>}
        </div>
        <div className="sidebar-bottom">
          <NavLink to="/clave" className="side-link account-link" onClick={() => setOpen(false)}><span className="side-icon"><NavIcon name="settings" /></span><span>Cambiar contraseña</span></NavLink>
          <div className="user-card"><span className="avatar">{initials}</span><span className="user-meta"><b>{user.name}</b><small>{roleNames[user.role] || user.role}</small></span></div>
          <div className="side-actions">
            <button type="button" className="side-action" onClick={toggle} aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} title="Cambiar tema">{theme === 'dark' ? SUN : MOON}<span>Apariencia</span></button>
            <button type="button" className="side-action logout" onClick={onLogout} aria-label="Cerrar sesión" title="Cerrar sesión"><span aria-hidden="true">↗</span><span>Salir</span></button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button type="button" className="mobile-menu" aria-label="Abrir menú" aria-expanded={open} onClick={() => setOpen(!open)}><span /><span /><span /></button>
          <Link to="/" className="topbar-brand"><img src="/logo.png" alt="Petrocuyo HAZLOC" /></Link>
          <div className="topbar-context"><span>Petrocuyo</span><i>/</i><b>HAZLOC · Inspecciones</b></div>
          <Link className="btn y topbar-cta" to="/hallazgos/nuevo"><span aria-hidden="true">＋</span> Nuevo hallazgo</Link>
        </header>
        <main className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/hallazgos" element={<Findings />} />
            <Route path="/hallazgos/nuevo" element={<FindingForm />} />
            <Route path="/hallazgos/:id" element={<FindingDetail />} />
            <Route path="/hallazgos/:id/editar" element={<FindingForm />} />
            <Route path="/hallazgos/:id/reparacion" element={<RepairEdit />} />
            <Route path="/informes" element={<Guard role="supervisor"><ReportsPage /></Guard>} />
            <Route path="/desclasificaciones" element={<DeclassList />} />
            <Route path="/desclasificaciones/nueva" element={<DeclassNew />} />
            <Route path="/desclasificaciones/:id" element={<DeclassDetail />} />
            <Route path="/tags" element={<Guard role="supervisor"><Tags /></Guard>} />
            <Route path="/tags/importar" element={<Guard role="admin"><TagImport /></Guard>} />
            <Route path="/tags/:id" element={<Guard role="supervisor"><TagEdit /></Guard>} />
            <Route path="/areas" element={<Guard role="admin"><AreasPage /></Guard>} />
            <Route path="/tipos" element={<Guard role="admin"><TypesPage /></Guard>} />
            <Route path="/usuarios" element={<Guard role="admin"><UsersPage /></Guard>} />
            <Route path="/usuarios/:id" element={<Guard role="admin"><UserEdit /></Guard>} />
            <Route path="/clave" element={<Password />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function AuthLayout({ children }) {
  const [theme, toggle] = useTheme()
  return (
    <div className="auth-page">
      <header className="auth-top"><Link to="/" className="brand auth-brand"><img src="/logo.png" alt="Petrocuyo HAZLOC" /><span><b>Inspecciones</b><small>SEGURIDAD OPERACIONAL</small></span></Link><button type="button" className="theme-button" onClick={toggle} aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>{theme === 'dark' ? SUN : MOON}</button></header>
      <main className="auth-layout"><section className="auth-intro"><span className="eyebrow">PETROCUYO · HAZLOC</span><h1>Seguridad que se ve en campo.</h1><p>Un espacio de trabajo para registrar, priorizar y resolver hallazgos de inspección.</p><div className="auth-mark"><span>H</span><i>Hazardous locations</i></div></section><div className="auth-form">{children}</div></main>
      <footer className="auth-footer">Inspecciones · Seguridad operacional</footer>
    </div>
  )
}

const Guard = ({ role, children }) => {
  const { user } = useApp()
  return RANK[user.role] >= RANK[role] ? children : <Msg kind="err">No tenés permiso para ver esta página.</Msg>
}

export default function App() {
  const [boot, setBoot] = useState({ loading: true })
  const refresh = useCallback(async () => {
    try {
      const d = await api.get('/api/me')
      setCsrf(d.csrf)
      setBoot(d)
    } catch (e) {
      setBoot({ error: e.message })
    }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    window.addEventListener('auth-expired', refresh)
    return () => window.removeEventListener('auth-expired', refresh)
  }, [refresh])
  const logout = async () => { try { const d = await api.post('/api/logout'); setCsrf(d.csrf) } catch { /* igual se recarga */ } refresh() }

  if (boot.loading) return <p className="center mu">Cargando…</p>
  if (boot.error) return <div className="center"><Msg kind="err">{boot.error}</Msg><button className="btn" onClick={refresh}>Reintentar</button></div>
  const ctx = { user: boot.user, meta: boot.meta, refresh, setCsrf }
  return (
    <Ctx.Provider value={ctx}>
      {boot.user ? <TopBar user={boot.user} onLogout={logout} /> : <AuthLayout>{boot.needsSetup ? <Setup /> : <Login />}</AuthLayout>}
    </Ctx.Provider>
  )
}
