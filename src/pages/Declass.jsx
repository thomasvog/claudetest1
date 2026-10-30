import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, formData, qs } from '../api.js'
import { Async, Field, Gallery, Msg, PhotoPicker, Select, fmtDate, today, useAsync } from '../ui.jsx'
import { useApp } from '../App.jsx'

export function DeclassList() {
  const { meta } = useApp()
  const [f, setF] = useState({ loc: '', q: '' })
  const [applied, setApplied] = useState({ loc: '', q: '' })
  const s = useAsync(() => api.get('/api/declass' + qs(applied)), [applied.loc, applied.q])
  return (
    <>
      <h1>Desclasificaciones {s.data && <small>({s.data.items.length})</small>}</h1>
      <p><Link className="btn y" to="/desclasificaciones/nueva">Nueva desclasificación</Link></p>
      <form className="card" onSubmit={(e) => { e.preventDefault(); setApplied(f) }}>
        <div className="grid">
          <div><Field label="Área"><Select value={f.loc} onChange={(v) => setF({ ...f, loc: v })} placeholder="Todas" options={meta.areas.map((a) => ({ value: a.id, label: a.name }))} /></Field></div>
          <div><Field label="Buscar"><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Tag, motivo, trabajo o responsable" /></Field></div>
        </div>
        <div className="btns"><button className="btn">Filtrar</button><button type="button" className="btn l" onClick={() => { setF({ loc: '', q: '' }); setApplied({ loc: '', q: '' }) }}>Limpiar</button></div>
      </form>
      <Async s={s}>
        {(d) => (d.items.length ? d.items.map((x) => (
          <Link key={x.id} to={`/desclasificaciones/${x.id}`} className="it">
            <div className="l1"><b>{x.area}</b><span className="mu">{fmtDate(x.date)} · {x.responsible}</span></div>
            <div className="mu tag l2">{x.tags}{x.nt > 1 ? ` (${x.nt})` : ''}</div>
            <div>{x.reason}</div>
          </Link>
        )) : <p className="mu">No hay desclasificaciones cargadas.</p>)}
      </Async>
    </>
  )
}

function DeclassForm({ equipment }) {
  const { meta, user } = useApp()
  const nav = useNavigate()
  const [f, setF] = useState({ loc: '', done_at: today(), responsible: user.name, reason: '', description: '', set_safe: true })
  const [sel, setSel] = useState([])
  const [flt, setFlt] = useState('')
  const [antes, setAntes] = useState([])
  const [despues, setDespues] = useState([])
  const [err, setErr] = useState('')
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const vis = equipment.filter((e) => f.loc && String(e.areaId) === f.loc && (!flt || `${e.tag} ${e.description}`.toLowerCase().includes(flt.toLowerCase())))
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    const fields = { location_id: f.loc, done_at: f.done_at, responsible: f.responsible, reason: f.reason, description: f.description, set_safe: f.set_safe ? '1' : '', equipment_id: sel.map(String) }
    try { const r = await api.post('/api/declass', formData(fields, { photos_antes: antes, photos_despues: despues })); nav(`/desclasificaciones/${r.id}`) } catch (x) { setErr(x.message) }
  }
  return (
    <>
      <h1>Nueva desclasificación</h1>
      <form className="card" onSubmit={submit}>
        <Msg kind="err">{err}</Msg>
        <div className="grid">
          <div><Field label="Área"><Select required value={f.loc} onChange={(v) => { set('loc')(v); setSel([]) }} placeholder="Elegir…" options={meta.areas.map((a) => ({ value: a.id, label: a.name }))} /></Field></div>
          <div><Field label="Fecha del trabajo"><input type="date" value={f.done_at} onChange={(e) => set('done_at')(e.target.value)} /></Field></div>
          <div><Field label="Responsable"><input required value={f.responsible} onChange={(e) => set('responsible')(e.target.value)} /></Field></div>
        </div>
        <Field label="Tags afectados" hint={sel.length ? `(${sel.length} marcados)` : ''}>
          <div className="grid" style={{ marginBottom: '.4rem' }}>
            <input placeholder="Filtrar tags del área…" value={flt} onChange={(e) => setFlt(e.target.value)} />
            <div className="btns" style={{ marginTop: 0 }}>
              <button type="button" className="btn l sm" onClick={() => setSel([...new Set([...sel, ...vis.map((e) => e.id)])])}>Marcar los visibles</button>
              <button type="button" className="btn l sm" onClick={() => setSel([])}>Desmarcar todos</button>
            </div>
          </div>
          <div className="box">
            {!f.loc ? <p className="mu" style={{ padding: '.6rem', margin: 0 }}>Elegí un área para ver sus tags.</p>
              : !vis.length ? <p className="mu" style={{ padding: '.6rem', margin: 0 }}>No hay tags para mostrar en esta área.</p>
                : vis.map((e) => (
                  <label className="ck" key={e.id}>
                    <input type="checkbox" checked={sel.includes(e.id)} onChange={() => toggle(e.id)} />
                    <span><b className="tag">{e.tag}</b> <span className="mu">{e.description} · Zona {e.zone || '—'}</span></span>
                  </label>
                ))}
          </div>
        </Field>
        <Field label="Motivo" hint="(por qué no era una zona con atmósfera explosiva)"><textarea required value={f.reason} onChange={(e) => set('reason')(e.target.value)} /></Field>
        <Field label="Trabajo realizado"><textarea required value={f.description} onChange={(e) => set('description')(e.target.value)} /></Field>
        <label className="chk" style={{ fontWeight: 600 }}><input type="checkbox" checked={f.set_safe} onChange={(e) => set('set_safe')(e.target.checked)} /> Cambiar la zona de los tags marcados a «Segura»</label>
        <div className="two">
          <div><Field label="Fotos del antes"><PhotoPicker files={antes} onChange={setAntes} /></Field></div>
          <div><Field label="Fotos del después"><PhotoPicker files={despues} onChange={setDespues} /></Field></div>
        </div>
        <div className="btns"><button className="btn y">Guardar desclasificación</button><button type="button" className="btn l" onClick={() => nav('/desclasificaciones')}>Cancelar</button></div>
      </form>
    </>
  )
}

export function DeclassNew() {
  const s = useAsync(() => api.get('/api/equipment'), [])
  return <Async s={s}>{(d) => <DeclassForm equipment={d.items} />}</Async>
}

function AddDeclassPhotos({ id, kind, onDone }) {
  const [files, setFiles] = useState([])
  const [err, setErr] = useState('')
  const send = async () => {
    setErr('')
    try { await api.post(`/api/declass/${id}/photos`, formData({ kind }, { photos: files })); setFiles([]); onDone() } catch (x) { setErr(x.message) }
  }
  return (
    <details>
      <summary className="mu" style={{ cursor: 'pointer' }}>Agregar fotos</summary>
      <Msg kind="err">{err}</Msg>
      <PhotoPicker files={files} onChange={setFiles} />
      {files.length > 0 && <button type="button" className="btn l" onClick={send}>Subir {files.length} foto{files.length === 1 ? '' : 's'}</button>}
    </details>
  )
}

export function DeclassDetail() {
  const { id } = useParams()
  const s = useAsync(() => api.get(`/api/declass/${id}`), [id])
  return (
    <Async s={s}>
      {(d) => (
        <>
          <p><Link to="/desclasificaciones">‹ Volver al listado</Link></p>
          <h1>Desclasificación · {d.area}</h1>
          <div className="card"><dl><dt>Fecha</dt><dd>{fmtDate(d.date)}</dd><dt>Responsable</dt><dd>{d.responsible}</dd><dt>Zona de los tags</dt><dd>{d.setSafe ? 'Se cambió a Segura' : 'No se modificó'}</dd></dl></div>
          <div className="two">
            <div className="card"><h2>Motivo</h2><p style={{ whiteSpace: 'pre-wrap' }}>{d.reason}</p></div>
            <div className="card"><h2>Trabajo realizado</h2><p style={{ whiteSpace: 'pre-wrap' }}>{d.description}</p></div>
          </div>
          <div className="card">
            <h2>Tags afectados ({d.tags.length})</h2>
            <div className="scroll"><table><thead><tr><th>Tag</th><th>Zona antes del trabajo</th></tr></thead><tbody>{d.tags.map((t) => <tr key={t.tag}><td className="tag">{t.tag}</td><td>{t.prevZone || '—'}</td></tr>)}</tbody></table></div>
          </div>
          <div className="two">
            {[['antes', 'Fotos del antes'], ['despues', 'Fotos del después']].map(([k, title]) => (
              <div className="card" key={k}><h2>{title}</h2><Gallery ids={d.photos[k]} base="/api/dphotos" /><AddDeclassPhotos id={d.id} kind={k} onDone={s.reload} /></div>
            ))}
          </div>
        </>
      )}
    </Async>
  )
}
