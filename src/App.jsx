import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
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

export const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

const MOON = <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="currentColor" /></svg>
const SUN = (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" fill="currentColor" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

function useTheme() {
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
  const eff = () => document.documentElement.getAttribute('data-theme') || (mq && mq.matches ? 'dark' : 'light')
  const [theme, setTheme] = useState(eff)
  useEffect(() => {
    if (!mq || !mq.addEventListener) return undefined
    const h = () => setTheme(eff())
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
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
  const box = useRef(null)
  const loc = useLocation()
  useEffect(() => { setOpen(false) }, [loc.pathname])
  useEffect(() => {
    const out = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', out)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('click', out); document.removeEventListener('keydown', esc) }
  }, [])
  const rank = user ? RANK[user.role] : 0
  const items = [
    ['/', 'Resumen', 1], ['/hallazgos', 'Hallazgos', 1], ['/hallazgos/nuevo', 'Nuevo hallazgo', 1], ['/desclasificaciones', 'Desclasificaciones', 1],
    ['/tags', 'Tags', 2], ['/areas', 'Áreas', 3], ['/tipos', 'Tipos de hallazgo', 3], ['/usuarios', 'Usuarios', 3],
  ].filter((i) => rank >= i[2])
  return (
    <header className="top">
      {user && (
        <div className="menu" ref={box}>
          <button type="button" className="ib" aria-label="Menú" aria-expanded={open} onClick={() => setOpen(!open)}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" /></svg>
          </button>
          {open && (
            <nav className="nav">
              {items.map(([to, label]) => <NavLink key={to} to={to} end={to === '/' || to === '/hallazgos'}>{label}</NavLink>)}
              <hr />
              <NavLink to="/clave">Cambiar contraseña</NavLink>
            </nav>
          )}
        </div>
      )}
      <Link to="/" className="logo"><img src="/logo.png" alt="Petrocuyo HAZLOC - Inspecciones" /></Link>
      <span className="r">
        <button type="button" className="ib" onClick={toggle} aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} title="Cambiar tema">{theme === 'dark' ? SUN : MOON}</button>
        {user && <>{user.name}<button type="button" className="out" onClick={onLogout}>Salir</button></>}
      </span>
    </header>
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
      <TopBar user={boot.user} onLogout={logout} />
      {boot.needsSetup ? <div className="center"><Setup /></div> : !boot.user ? <div className="center"><Login /></div> : (
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/hallazgos" element={<Findings />} />
            <Route path="/hallazgos/nuevo" element={<FindingForm />} />
            <Route path="/hallazgos/:id" element={<FindingDetail />} />
            <Route path="/hallazgos/:id/editar" element={<FindingForm />} />
            <Route path="/hallazgos/:id/reparacion" element={<RepairEdit />} />
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
      )}
    </Ctx.Provider>
  )
}
