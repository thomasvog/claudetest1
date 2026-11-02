import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, formData } from '../api.js'
import { Async, digitsOnly, Field, Gallery, Msg, PhotoPicker, Select, today, useAsync } from '../ui.jsx'
import { useApp } from '../App.jsx'

function Form({ equipment, finding }) {
  const { meta, user } = useApp()
  const nav = useNavigate()
  const edit = !!finding
  const t = finding && finding.type
  const [f, setF] = useState({
    eq: finding ? (finding.equipmentId ? String(finding.equipmentId) : finding.tag ? 'keep' : '') : '',
    loc: finding ? String(finding.areaId) : '',
    zone: finding ? finding.zone : '',
    crit: finding ? finding.crit : '',
    date: finding ? finding.date : today(),
    ftype: finding ? t || meta.other : '',
    other: finding && (!t || t === meta.other) ? finding.description : '',
    ot: finding ? digitsOnly(finding.ot || '') : '',
  })
  const [files, setFiles] = useState([])
  const [antes, setAntes] = useState(finding ? finding.photos.antes : [])
  const [tagQuery, setTagQuery] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const pickTag = (v) => {
    const e = equipment.find((x) => String(x.id) === v)
    setF((x) => ({ ...x, eq: v, loc: e && e.areaId ? String(e.areaId) : x.loc, zone: e && e.zone ? e.zone : x.zone }))
    setTagQuery('')
  }
  const filteredEquipment = equipment.filter((e) => e.tag.toLowerCase().includes(tagQuery.trim().toLowerCase()))
  const selectedEquipment = equipment.find((e) => String(e.id) === f.eq)
  const extra = t && !meta.types.includes(t) && t !== meta.other ? [t] : []
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true)
    const fields = { equipment_id: f.eq, location_id: f.loc, zone: f.zone, criticality: f.crit, inspected_at: f.date, finding_type: f.ftype, other_text: f.other, ot: f.ot }
    try {
      const body = formData(fields, { photos: files })
      const r = edit ? await api.put(`/api/findings/${finding.id}`, body) : await api.post('/api/findings', body)
      nav(`/hallazgos/${edit ? finding.id : r.id}`)
    } catch (x) { setErr(x.message); setBusy(false) }
  }
  const quitar = async (pid) => {
    if (!window.confirm('¿Quitar esta foto?')) return
    try { await api.del(`/api/findings/${finding.id}/photos/${pid}`); setAntes(antes.filter((x) => x !== pid)) } catch (x) { setErr(x.message) }
  }
  const isOther = f.ftype === meta.other
  return (
    <>
      <h1>{edit ? 'Editar hallazgo' : 'Nuevo hallazgo'}</h1>
      <form className="card" onSubmit={submit}>
        <Msg kind="err">{err}</Msg>
        <Field label="Buscar TAG"><input type="search" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} placeholder="Escribí las primeras letras del TAG" /></Field>
        <Field label="Tag / equipo">
          <select value={f.eq} onChange={(e) => pickTag(e.target.value)}>
            <option value="">— Sin tag —</option>
            {edit && finding.tag && !finding.equipmentId && <option value="keep">{finding.tag} (tag anterior)</option>}
            {selectedEquipment && !filteredEquipment.some((e) => String(e.id) === f.eq) && (
              <option value={selectedEquipment.id}>{selectedEquipment.tag}{selectedEquipment.area ? ` · ${selectedEquipment.area}` : ''}{selectedEquipment.description ? ` · ${selectedEquipment.description}` : ''} (seleccionado)</option>
            )}
            {filteredEquipment.map((e) => <option key={e.id} value={e.id}>{e.tag}{e.area ? ` · ${e.area}` : ''}{e.description ? ` · ${e.description}` : ''}</option>)}
          </select>
        </Field>
        {tagQuery && !filteredEquipment.length && <p className="mu" role="status">No hay TAG que empiecen con “{tagQuery.trim()}”.</p>}
        <p className="mu" style={{ margin: '.2rem 0 0' }}>
          Al elegir un tag se completan el área y la zona, si el tag las tiene. {user.role !== 'tecnico' ? <Link to="/tags">Administrar tags</Link> : 'Si falta un tag, pedile a un supervisor que lo cargue.'}
        </p>
        <div className="grid">
          <div><Field label="Área"><Select required value={f.loc} onChange={set('loc')} placeholder="Elegir…" options={meta.areas.map((a) => ({ value: a.id, label: a.name }))} /></Field></div>
          <div><Field label="Zona"><Select required value={f.zone} onChange={set('zone')} placeholder="Elegir…" options={meta.zones} /></Field></div>
          <div><Field label="Criticidad"><Select required value={f.crit} onChange={set('crit')} placeholder="Elegir…" options={meta.crit} /></Field></div>
          <div><Field label="Fecha de inspección"><input type="date" value={f.date} onChange={(e) => set('date')(e.target.value)} /></Field></div>
          <div><Field label="N° de OT" hint="(obligatorio para cerrar)"><input type="text" inputMode="numeric" pattern="[0-9]*" value={f.ot} onChange={(e) => set('ot')(digitsOnly(e.target.value))} /></Field></div>
        </div>
        <Field label="Qué se encontró"><Select required value={f.ftype} onChange={set('ftype')} placeholder="Elegir…" options={[...meta.types, ...extra, meta.other]} /></Field>
        {isOther && <Field label="Describí el problema encontrado"><textarea required autoFocus value={f.other} onChange={(e) => set('other')(e.target.value)} /></Field>}
        <Field label={edit ? 'Agregar fotos del estado encontrado' : 'Fotos del estado encontrado'}><PhotoPicker files={files} onChange={setFiles} /></Field>
        <div className="btns">
          <button className="btn y" disabled={busy}>{edit ? 'Guardar cambios' : 'Guardar hallazgo'}</button>
          <button type="button" className="btn l" onClick={() => nav(edit ? `/hallazgos/${finding.id}` : '/hallazgos')}>Cancelar</button>
        </div>
      </form>
      {edit && <div className="card"><h2>Fotos actuales</h2><Gallery ids={antes} base="/api/photos" onDelete={quitar} /></div>}
    </>
  )
}

export default function FindingForm() {
  const { id } = useParams()
  const eqS = useAsync(() => api.get('/api/equipment'), [])
  const fS = useAsync(() => (id ? api.get(`/api/findings/${id}`) : Promise.resolve({})), [id])
  const s = { data: eqS.data && fS.data ? { eq: eqS.data.items, f: id ? fS.data : null } : null, loading: eqS.loading || fS.loading, error: eqS.error || fS.error }
  return (
    <Async s={s}>
      {(d) => (d.f && d.f.status !== 'pendiente'
        ? <Msg kind="err">Un hallazgo solucionado no se puede editar. Podés <Link to={`/hallazgos/${d.f.id}/reparacion`}>editar la reparación</Link> o reabrirlo desde el detalle.</Msg>
        : <Form key={id || 'nuevo'} equipment={d.eq} finding={d.f} />)}
    </Async>
  )
}
