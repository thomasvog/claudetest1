import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setCsrf } from '../api.js'
import { Field, Msg } from '../ui.jsx'
import { useApp } from '../App.jsx'

export function Login() {
  const { refresh } = useApp()
  const [f, setF] = useState({ username: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try { const d = await api.post('/api/login', f); setCsrf(d.csrf); await refresh() } catch (x) { setErr(x.message); setBusy(false) }
  }
  return (
    <form className="card" onSubmit={submit}>
      <img className="login-logo" src="/logo.png" alt="Petrocuyo HAZLOC" />
      <h1>Ingresar</h1>
      <Msg kind="err">{err}</Msg>
      <Field label="Usuario"><input autoFocus autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
      <Field label="Contraseña"><input type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      <div className="btns"><button className="btn y" disabled={busy}>Ingresar</button></div>
    </form>
  )
}

export function Setup() {
  const { refresh } = useApp()
  const [f, setF] = useState({ key: '', username: '', name: '', password: '' })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    try { await api.post('/api/setup', f); await refresh() } catch (x) { setErr(x.message) }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h1>Instalación inicial</h1>
      <p className="mu">Creá el usuario administrador. Solo se puede hacer una vez.</p>
      <Msg kind="err">{err}</Msg>
      <Field label="Código de instalación" hint="(valor de SETUP_KEY en Vercel)"><input type="password" autoComplete="off" value={f.key} onChange={set('key')} /></Field>
      <Field label="Usuario"><input autoComplete="username" value={f.username} onChange={set('username')} /></Field>
      <Field label="Nombre completo"><input value={f.name} onChange={set('name')} /></Field>
      <Field label="Contraseña" hint="(mínimo 8 caracteres)"><input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
      <div className="btns"><button className="btn y">Crear administrador</button></div>
    </form>
  )
}

export function Password() {
  const nav = useNavigate()
  const [f, setF] = useState({ current: '', new: '', repeat: '' })
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    try { await api.post('/api/password', f); setDone(true); setF({ current: '', new: '', repeat: '' }) } catch (x) { setErr(x.message) }
  }
  return (
    <form className="card" style={{ maxWidth: 460, margin: '0 auto' }} onSubmit={submit}>
      <h1>Cambiar contraseña</h1>
      <Msg kind="err">{err}</Msg>
      <Msg kind="ok">{done && 'Contraseña actualizada.'}</Msg>
      <Field label="Contraseña actual"><input type="password" autoComplete="current-password" value={f.current} onChange={set('current')} required /></Field>
      <Field label="Contraseña nueva" hint="(mínimo 8 caracteres)"><input type="password" autoComplete="new-password" value={f.new} onChange={set('new')} required /></Field>
      <Field label="Repetir contraseña nueva"><input type="password" autoComplete="new-password" value={f.repeat} onChange={set('repeat')} required /></Field>
      <div className="btns"><button className="btn y">Guardar contraseña</button><button type="button" className="btn l" onClick={() => nav('/')}>Volver</button></div>
    </form>
  )
}
