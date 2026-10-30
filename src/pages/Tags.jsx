import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, formData, qs } from '../api.js'
import { Async, Field, Msg, Select, useAsync } from '../ui.jsx'
import { useApp } from '../App.jsx'

function TagForm({ initial, label, onSave, onCancel }) {
  const { meta } = useApp()
  const [f, setF] = useState(initial)
  const [err, setErr] = useState('')
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    try { await onSave(f); if (!onCancel) setF(initial) } catch (x) { setErr(x.message) }
  }
  return (
    <form className="card" onSubmit={submit}>
      <Msg kind="err">{err}</Msg>
      <div className="grid">
        <div><Field label="Tag"><input className="tag" required value={f.tag} onChange={(e) => set('tag')(e.target.value)} /></Field></div>
        <div><Field label="Descripción"><input value={f.description} onChange={(e) => set('description')(e.target.value)} /></Field></div>
        <div><Field label="Área" hint="(opcional)"><Select value={f.areaId} onChange={set('areaId')} placeholder="— Sin definir —" options={meta.areas.map((a) => ({ value: a.id, label: a.name }))} /></Field></div>
        <div><Field label="Zona" hint="(opcional)"><Select value={f.zone} onChange={set('zone')} placeholder="— Sin definir —" options={meta.zones} /></Field></div>
        <div><Field label="Protección Ex" hint="(opcional)"><Select value={f.protection} onChange={set('protection')} placeholder="—" options={meta.prot} /></Field></div>
      </div>
      <p className="mu">Para equipos genéricos sin tag (cajas de paso, luminarias, etc.) cargá un nombre general y dejá Área y Zona vacías: el técnico las elige en cada hallazgo.</p>
      <div className="btns"><button className="btn y">{label}</button>{onCancel && <button type="button" className="btn l" onClick={onCancel}>Cancelar</button>}</div>
    </form>
  )
}

const empty = { tag: '', description: '', areaId: '', zone: '', protection: '' }
const toBody = (f) => ({ ...f, areaId: f.areaId === '' ? null : Number(f.areaId) })

export function Tags() {
  const { user } = useApp()
  const [q, setQ] = useState('')
  const [applied, setApplied] = useState('')
  const s = useAsync(() => api.get('/api/equipment' + qs({ q: applied })), [applied])
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const remove = async (e) => {
    if (!window.confirm(`¿Eliminar el tag ${e.tag}? Los hallazgos ya cargados conservan su texto.`)) return
    try { await api.del(`/api/equipment/${e.id}`); s.reload() } catch (x) { setErr(x.message) }
  }
  return (
    <>
      <h1>Tags de equipos {s.data && <small>({s.data.items.length})</small>}</h1>
      {user.role === 'admin' && <p><Link className="btn l" to="/tags/importar">Importar planilla</Link></p>}
      <Msg kind="ok">{ok}</Msg>
      <h2>Agregar tag</h2>
      <TagForm initial={empty} label="Agregar tag" onSave={async (f) => { await api.post('/api/equipment', toBody(f)); setOk('Tag agregado.'); s.reload() }} />
      <form className="card" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()) }}>
        <Field label="Buscar"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tag, descripción o área" /></Field>
        <div className="btns"><button className="btn">Buscar</button><button type="button" className="btn l" onClick={() => { setQ(''); setApplied('') }}>Limpiar</button></div>
      </form>
      <Msg kind="err">{err}</Msg>
      <Async s={s}>
        {(d) => (d.items.length ? (
          <div className="scroll">
            <table>
              <thead><tr><th>Tag</th><th>Área</th><th>Zona</th><th>Hallazgos</th><th /></tr></thead>
              <tbody>
                {d.items.map((e) => (
                  <tr key={e.id}>
                    <td><b className="tag">{e.tag}</b><div className="mu">{e.description}</div></td>
                    <td>{e.area || '—'}</td>
                    <td>{e.zone || '—'}<div className="mu">{e.protection || ''}</div></td>
                    <td>{e.nf}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><Link className="btn l sm" to={`/tags/${e.id}`}>Editar</Link> <button className="btn l sm" onClick={() => remove(e)}>Borrar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="mu">No hay tags cargados todavía.</p>)}
      </Async>
    </>
  )
}

export function TagEdit() {
  const { id } = useParams()
  const nav = useNavigate()
  const s = useAsync(() => api.get('/api/equipment'), [])
  return (
    <Async s={s}>
      {(d) => {
        const e = d.items.find((x) => String(x.id) === id)
        if (!e) return <Msg kind="err">No se encontró el tag.</Msg>
        const init = { tag: e.tag, description: e.description, areaId: e.areaId ? String(e.areaId) : '', zone: e.zone || '', protection: e.protection || '' }
        return (
          <>
            <h1>Editar tag <span className="tag">{e.tag}</span></h1>
            <TagForm initial={init} label="Guardar cambios" onCancel={() => nav('/tags')} onSave={async (f) => { await api.put(`/api/equipment/${id}`, toBody(f)); nav('/tags') }} />
            <p className="mu">Si cambiás el nombre del tag, también se actualiza en los hallazgos ya cargados.</p>
          </>
        )
      }}
    </Async>
  )
}

export function TagImport() {
  const [file, setFile] = useState(null)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (mode) => {
    if (!file) { setErr('Elegí un archivo .xlsx o .csv.'); return }
    setErr(''); setBusy(true)
    try { setRes(await api.post('/api/equipment/import', formData({ mode }, { file: [file] }))) } catch (x) { setErr(x.message); setRes(null) }
    setBusy(false)
  }
  return (
    <>
      <p><Link to="/tags">‹ Volver a tags</Link></p>
      <h1>Importar tags desde planilla</h1>
      <div className="card">
        <Msg kind="err">{err}</Msg>
        <Field label="Archivo (.xlsx o .csv)"><input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
        <p className="mu">
          Columnas, en este orden o con estos títulos en la primera fila: <b>Tag</b>, Descripción, Área, Zona, Protección Ex. Solo el Tag es obligatorio; Área y Zona pueden quedar vacías (equipos genéricos).
          Zonas válidas: 0, 1, 2, 20, 21, 22, 0/20, 1/21, 2/22 o Segura. Se lee la primera hoja. Si el tag ya existe, se actualiza con los datos de la planilla; las celdas vacías no borran lo que ya estaba cargado.
        </p>
        <div className="btns">
          <button type="button" className="btn l" disabled={busy} onClick={() => send('check')}>Revisar sin guardar</button>
          <button type="button" className="btn y" disabled={busy} onClick={() => send('import')}>Importar</button>
          <a className="btn l" href="/api/equipment/template.xlsx">Descargar planilla modelo</a>
        </div>
      </div>
      {res && (
        <>
          <div className="card">
            <h2>{res.saved ? 'Importación realizada' : 'Revisión (no se guardó nada)'}</h2>
            <dl>
              <dt>Filas leídas</dt><dd>{res.total}</dd><dt>Tags nuevos</dt><dd>{res.new}</dd><dt>Tags actualizados</dt><dd>{res.updated}</dd>
              <dt>Sin cambios</dt><dd>{res.same}</dd><dt>Repetidos en la planilla</dt><dd>{res.dups}</dd><dt>Filas con error (no se cargan)</dt><dd>{res.errs.length}</dd>
            </dl>
            {!res.saved && (res.new > 0 || res.updated > 0) && <p className="mu">Si está todo bien, elegí el mismo archivo y presioná <b>Importar</b>.</p>}
          </div>
          {[['Filas con error', res.errs], ['Advertencias', res.warns]].map(([t, list]) => list.length > 0 && (
            <div className="card" key={t}>
              <h2>{t}</h2>
              <div className="scroll"><table><thead><tr><th>Fila</th><th>Detalle</th></tr></thead><tbody>{list.slice(0, 100).map(([n, m]) => <tr key={`${n}-${m}`}><td>{n}</td><td>{m}</td></tr>)}</tbody></table></div>
              {list.length > 100 && <p className="mu">Se muestran las primeras 100.</p>}
            </div>
          ))}
        </>
      )}
    </>
  )
}
