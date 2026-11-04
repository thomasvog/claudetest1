import { useId, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, formData } from '../api.js'
import { Async, digitsOnly, Field, Gallery, Msg, PhotoPicker, Select, today, useAsync } from '../ui.jsx'
import { useApp } from '../App.jsx'

const GENERIC_EQUIPMENT_TAGS = ['MAC BAGGING', 'MAC EXTRUS', 'MAC POLIMERO', 'MAC SERVICIO', 'MAC UNID 500']
const GENERIC_EQUIPMENT_TYPES = ['Caja de derivación', 'Instrumento', 'Junction Box', 'Luminaria']

function Form({ equipment, finding }) {
  const { meta, user } = useApp()
  const nav = useNavigate()
  const edit = !!finding
  const t = finding && finding.type
  const equipmentListId = useId()
  const [f, setF] = useState({
    eq: finding ? (finding.equipmentId ? String(finding.equipmentId) : finding.tag ? 'keep' : '') : '',
    loc: finding ? String(finding.areaId) : '',
    zone: finding ? finding.zone : '',
    crit: finding ? finding.crit : '',
    date: finding ? finding.date : today(),
    ftype: finding ? t || meta.other : '',
    other: finding && (!t || t === meta.other) ? finding.description : '',
    equipmentType: finding ? finding.equipmentType || '' : '',
    equipmentLocation: finding ? finding.equipmentLocation || '' : '',
    ot: finding ? digitsOnly(finding.ot || '') : '',
  })
  const [files, setFiles] = useState([])
  const [antes, setAntes] = useState(finding ? finding.photos.antes : [])
  const [tagQuery, setTagQuery] = useState(() => (
    equipment.find((x) => String(x.id) === String(finding?.equipmentId))?.tag || finding?.tag || ''
  ))
  const [tagListOpen, setTagListOpen] = useState(false)
  const [activeTagIndex, setActiveTagIndex] = useState(0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const pickTag = (v) => {
    const e = equipment.find((x) => String(x.id) === v)
    const tag = v === 'keep' ? finding?.tag : e?.tag
    const generic = GENERIC_EQUIPMENT_TAGS.includes((tag || '').toUpperCase())
    setF((x) => ({
      ...x,
      eq: v,
      loc: e && e.areaId ? String(e.areaId) : x.loc,
      zone: e && e.zone ? e.zone : x.zone,
      equipmentType: generic ? x.equipmentType : '',
      equipmentLocation: generic ? x.equipmentLocation : '',
    }))
    setTagQuery(v === 'keep' ? finding?.tag || '' : e?.tag || '')
    setTagListOpen(false)
  }
  const filteredEquipment = equipment.filter((e) => e.tag.toLowerCase().includes(tagQuery.trim().toLowerCase()))
  const legacyTagMatches = finding && !finding.equipmentId && finding.tag?.toLowerCase() === tagQuery.trim().toLowerCase()
  const tagOptions = [
    ...(!tagQuery.trim() ? [{ key: '', label: '— Sin tag —', value: '' }] : []),
    ...(edit && finding.tag && !finding.equipmentId && finding.tag.toLowerCase().includes(tagQuery.trim().toLowerCase())
      ? [{ key: 'keep', label: `${finding.tag} (tag anterior)`, value: 'keep' }]
      : []),
    ...filteredEquipment.map((e) => ({
      key: String(e.id),
      label: `${e.tag}${e.area ? ` · ${e.area}` : ''}${e.description ? ` · ${e.description}` : ''}`,
      value: String(e.id),
    })),
  ]
  const selectedEquipment = equipment.find((e) => String(e.id) === f.eq)
  const selectedTag = f.eq === 'keep' ? finding?.tag : selectedEquipment?.tag
  const isGenericEquipment = GENERIC_EQUIPMENT_TAGS.includes((selectedTag || '').toUpperCase())
  const tagNeedsSelection = !!tagQuery.trim() && !(
    (selectedEquipment && selectedEquipment.tag.toLowerCase() === tagQuery.trim().toLowerCase())
    || (f.eq === 'keep' && legacyTagMatches)
  )
  const tagListId = `equipment-options-${equipmentListId}`
  const chooseTagOption = (index) => {
    const option = tagOptions[index]
    if (option) pickTag(option.value)
  }
  const onTagKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setTagListOpen(true)
      setActiveTagIndex((index) => Math.min(index + 1, tagOptions.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setTagListOpen(true)
      setActiveTagIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && tagListOpen && tagOptions.length) {
      event.preventDefault()
      chooseTagOption(activeTagIndex)
    } else if (event.key === 'Escape') {
      setTagListOpen(false)
    }
  }
  const extra = t && !meta.types.includes(t) && t !== meta.other ? [t] : []
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    if (tagNeedsSelection) {
      setErr('Elegí un TAG de la lista o dejá el campo vacío.')
      return
    }
    setBusy(true)
    const fields = { equipment_id: f.eq, location_id: f.loc, zone: f.zone, criticality: f.crit, inspected_at: f.date, finding_type: f.ftype, other_text: f.other, equipment_type: f.equipmentType, equipment_location: f.equipmentLocation, ot: f.ot }
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
        <label className="f" htmlFor={equipmentListId}>Tag / equipo</label>
        <div className="tag-picker">
          <input
            id={equipmentListId}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={tagListOpen}
            aria-controls={tagListId}
            aria-activedescendant={tagListOpen && tagOptions[activeTagIndex] ? `${tagListId}-${activeTagIndex}` : undefined}
            value={tagQuery}
            onFocus={() => { setTagListOpen(true); setActiveTagIndex(0) }}
            onChange={(e) => {
              setTagQuery(e.target.value)
              setF((x) => ({ ...x, eq: '', equipmentType: '', equipmentLocation: '' }))
              setActiveTagIndex(0)
              setTagListOpen(true)
            }}
            onKeyDown={onTagKeyDown}
            onBlur={() => setTagListOpen(false)}
            placeholder="Escribí para filtrar o elegí un TAG"
            autoComplete="off"
          />
          {tagListOpen && (
            <div className="tag-picker-list" id={tagListId} role="listbox" aria-label="Tags de equipos">
              {tagOptions.map((option, index) => (
                <div
                  className={`tag-picker-option${index === activeTagIndex ? ' active' : ''}`}
                  id={`${tagListId}-${index}`}
                  key={option.key || 'empty'}
                  role="option"
                  aria-selected={f.eq === option.value}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveTagIndex(index)}
                  onClick={() => chooseTagOption(index)}
                >
                  {option.label}
                </div>
              ))}
              {!tagOptions.length && <div className="tag-picker-empty">No hay TAG que coincidan.</div>}
            </div>
          )}
        </div>
        {isGenericEquipment && (
          <>
            <Field label="Tipo de elemento">
              <Select value={f.equipmentType} onChange={set('equipmentType')} placeholder="Elegir…" options={GENERIC_EQUIPMENT_TYPES} />
            </Field>
            <Field label="Ubicación aproximada en planta">
              <input value={f.equipmentLocation} onChange={(e) => set('equipmentLocation')(e.target.value)} placeholder="Ej.: nave, sector o referencia cercana" />
            </Field>
          </>
        )}
        {tagNeedsSelection && <p className="mu" role="status">Elegí un TAG de la lista o dejá el campo vacío.</p>}
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
