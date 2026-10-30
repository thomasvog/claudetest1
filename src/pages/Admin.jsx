import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api.js'
import { Async, Field, Msg, Select, useAsync } from '../ui.jsx'
import { useApp } from '../App.jsx'

export function AreasPage() {
  const s = useAsync(() => api.get('/api/areas'), [])
  return (
    <>
      <h1>Áreas</h1>
      <p className="mu">Las áreas son fijas y no se pueden agregar ni quitar.</p>
      <Async s={s}>
        {(d) => (
          <div className="scroll">
            <table>
              <thead><tr><th>Área</th><th>Tags</th><th>Hallazgos pendientes</th><th>Hallazgos totales</th></tr></thead>
              <tbody>{d.items.map((a) => <tr key={a.id}><td><i className="sw" style={{ background: a.color }} /><Link to={`/hallazgos?loc=${a.id}`}>{a.name}</Link></td><td>{a.tags}</td><td>{a.pending}</td><td>{a.total}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Async>
    </>
  )
}

function TypeRow({ t, first, last, reload, fail }) {
  const [name, setName] = useState(t.name)
  const act = async (fn) => { try { await fn(); reload() } catch (x) { fail(x.message) } }
  return (
    <tr>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button className="btn l sm" disabled={first} aria-label={`Subir ${t.name}`} onClick={() => act(() => api.post(`/api/types/${t.id}/move`, { dir: 'up' }))}>↑</button>{' '}
        <button className="btn l sm" disabled={last} aria-label={`Bajar ${t.name}`} onClick={() => act(() => api.post(`/api/types/${t.id}/move`, { dir: 'down' }))}>↓</button>
      </td>
      <td><form style={{ display: 'flex', gap: '.4rem' }} onSubmit={(e) => { e.preventDefault(); act(() => api.put(`/api/types/${t.id}`, { name })) }}><input value={name} onChange={(e) => setName(e.target.value)} required aria-label={`Nombre de ${t.name}`} /><button className="btn l sm">Guardar</button></form></td>
      <td>{t.n}</td>
      <td><button className="btn l sm" onClick={() => window.confirm('¿Eliminar este tipo? Los hallazgos ya cargados conservan su texto.') && act(() => api.del(`/api/types/${t.id}`))}>Borrar</button></td>
    </tr>
  )
}

export function TypesPage() {
  const { meta, refresh } = useApp()
  const s = useAsync(() => api.get('/api/types'), [])
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const reload = async () => { setErr(''); await s.reload(); refresh() }
  const add = async (e) => {
    e.preventDefault(); setErr('')
    try { await api.post('/api/types', { name }); setName(''); reload() } catch (x) { setErr(x.message) }
  }
  return (
    <>
      <h1>Tipos de hallazgo</h1>
      <p className="mu">Son las opciones de la lista «Qué se encontró» en Nuevo hallazgo, en el orden en que se muestran: usá las flechas para subir o bajar cada una. La opción «{meta.other}» siempre está al final, habilita un campo de texto libre y no se puede modificar.</p>
      <form className="card" onSubmit={add}>
        <Field label="Nuevo tipo"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Falta junta" /></Field>
        <div className="btns"><button className="btn y">Agregar tipo</button></div>
      </form>
      <Msg kind="err">{err}</Msg>
      <Async s={s}>
        {(d) => (d.items.length ? (
          <>
            <div className="scroll">
              <table>
                <thead><tr><th>Orden</th><th>Nombre</th><th>Hallazgos</th><th /></tr></thead>
                <tbody>{d.items.map((t, i) => <TypeRow key={`${t.id}-${t.name}`} t={t} first={i === 0} last={i === d.items.length - 1} reload={reload} fail={setErr} />)}</tbody>
              </table>
            </div>
            <p className="mu">Si cambiás el nombre de un tipo, también se actualiza en los hallazgos que ya lo tenían.</p>
          </>
        ) : <p className="mu">No hay tipos cargados: en Nuevo hallazgo solo estará la opción «{meta.other}».</p>)}
      </Async>
    </>
  )
}

export function UsersPage() {
  const { meta, user } = useApp()
  const s = useAsync(() => api.get('/api/users'), [])
  const [f, setF] = useState({ username: '', name: '', role: 'tecnico', password: '' })
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const add = async (e) => {
    e.preventDefault(); setErr(''); setOk('')
    try { await api.post('/api/users', f); setF({ username: '', name: '', role: 'tecnico', password: '' }); setOk('Usuario creado.'); s.reload() } catch (x) { setErr(x.message) }
  }
  const remove = async (u) => {
    if (!window.confirm('¿Eliminar este usuario? Sus hallazgos se conservan con su nombre y no podrá volver a ingresar.')) return
    setErr('')
    try { await api.del(`/api/users/${u.id}`); s.reload() } catch (x) { setErr(x.message) }
  }
  return (
    <>
      <h1>Usuarios</h1>
      <Msg kind="err">{err}</Msg>
      <Msg kind="ok">{ok}</Msg>
      <Async s={s}>
        {(d) => (
          <div className="scroll">
            <table>
              <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Hallazgos</th><th /></tr></thead>
              <tbody>
                {d.items.map((u) => (
                  <tr key={u.id}>
                    <td className="tag">{u.username}</td><td>{u.name}</td><td>{meta.roles[u.role]}</td><td>{u.active ? 'Activo' : 'Desactivado'}</td><td>{u.nf}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><Link className="btn l sm" to={`/usuarios/${u.id}`}>Editar</Link>{u.id !== user.id && <> <button className="btn l sm" onClick={() => remove(u)}>Eliminar</button></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      <form className="card" style={{ marginTop: '1rem' }} onSubmit={add}>
        <h2>Agregar usuario</h2>
        <div className="grid">
          <div><Field label="Usuario"><input required autoComplete="off" value={f.username} onChange={set('username')} /></Field></div>
          <div><Field label="Nombre completo"><input required value={f.name} onChange={set('name')} /></Field></div>
          <div><Field label="Rol"><Select value={f.role} onChange={(v) => setF({ ...f, role: v })} options={Object.entries(meta.roles).map(([value, label]) => ({ value, label }))} /></Field></div>
          <div><Field label="Contraseña" hint="(mín. 8)"><input type="password" required autoComplete="new-password" value={f.password} onChange={set('password')} /></Field></div>
        </div>
        <div className="btns"><button className="btn y">Crear usuario</button></div>
      </form>
    </>
  )
}

export function UserEdit() {
  const { id } = useParams()
  const { meta, user, refresh } = useApp()
  const nav = useNavigate()
  const s = useAsync(() => api.get('/api/users'), [])
  const [f, setF] = useState(null)
  const [err, setErr] = useState('')
  const u = s.data && s.data.items.find((x) => String(x.id) === id)
  if (u && !f) setF({ username: u.username, name: u.name, role: u.role, active: u.active, password: '' })
  const me = user.id === Number(id)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    try { await api.put(`/api/users/${id}`, f); if (me) refresh(); nav('/usuarios') } catch (x) { setErr(x.message) }
  }
  return (
    <Async s={s}>
      {() => (!u ? <Msg kind="err">No se encontró el usuario.</Msg> : !f ? null : (
        <>
          <h1>Editar usuario <span className="tag">{u.username}</span></h1>
          <form className="card" onSubmit={submit}>
            <Msg kind="err">{err}</Msg>
            <div className="grid">
              <div><Field label="Usuario"><input required value={f.username} onChange={set('username')} /></Field></div>
              <div><Field label="Nombre completo"><input required value={f.name} onChange={set('name')} /></Field></div>
              <div><Field label="Rol"><Select disabled={me} value={f.role} onChange={(v) => setF({ ...f, role: v })} options={Object.entries(meta.roles).map(([value, label]) => ({ value, label }))} /></Field></div>
              <div><Field label="Contraseña nueva" hint="(vacía = no cambia)"><input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field></div>
            </div>
            <label className="chk"><input type="checkbox" disabled={me} checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Usuario activo (si se desactiva, no puede ingresar)</label>
            {me && <p className="mu">Tu propio usuario siempre queda como administrador y activo.</p>}
            <div className="btns"><button className="btn y">Guardar cambios</button><Link className="btn l" to="/usuarios">Cancelar</Link></div>
          </form>
        </>
      ))}
    </Async>
  )
}
