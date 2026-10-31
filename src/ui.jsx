import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

export const RANK = { tecnico: 1, supervisor: 2, admin: 3 }
export const fmtDate = (s) => (s ? s.split('-').reverse().join('/') : '')
export const today = () => new Date().toISOString().slice(0, 10)

// Carga datos de la API y permite recargarlos.
export function useAsync(fn, deps) {
  const [s, set] = useState({ data: null, error: '', loading: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    set((x) => ({ ...x, loading: true }))
    return fn().then((data) => set({ data, error: '', loading: false })).catch((e) => set({ data: null, error: e.message, loading: false }))
  }, deps)
  useEffect(() => { run() }, [run])
  return { ...s, reload: run }
}

export const Msg = ({ kind = '', children }) => (children ? <div className={`alert ${kind}`} role={kind === 'err' ? 'alert' : 'status'}>{children}</div> : null)

// Muestra «cargando», el error o el contenido cuando llegan los datos.
export function Async({ s, children }) {
  if (s.loading && !s.data) return <div className="loading-state" role="status"><span className="loader" /> Cargando…</div>
  if (s.error && !s.data) return <Msg kind="err">{s.error}</Msg>
  return s.data ? children(s.data) : null
}

export const Pill = ({ kind, children }) => <span className={`pill ${kind}`}>{children}</span>
// Etiqueta asociada a su campo (input, select o textarea); si el contenido es otra cosa, se agrupa con aria-labelledby.
export function Field({ label, hint, children }) {
  const id = useId()
  const one = Children.count(children) === 1 ? Children.toArray(children)[0] : null
  const ctl = isValidElement(one) && (['input', 'select', 'textarea'].includes(one.type) || one.type === Select)
  return (
    <>
      <label className="f" id={`${id}-l`} htmlFor={ctl ? id : undefined}>{label} {hint && <span className="hint">{hint}</span>}</label>
      {ctl ? cloneElement(one, { id }) : <div role="group" aria-labelledby={`${id}-l`}>{children}</div>}
    </>
  )
}
export const Select = ({ value, onChange, options, placeholder, required, ...p }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} required={required} {...p}>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map((o) => (typeof o === 'object' ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o} value={o}>{o}</option>))}
  </select>
)

// Reduce la foto en el navegador antes de enviarla (cada envío admite ~4 MB).
export async function shrink(file, max = 1400) {
  if (!file.type.startsWith('image/')) return file
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k)
    c.height = Math.round(bmp.height * k)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

function Thumb({ file, onRemove }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!URL.createObjectURL) return undefined
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL && URL.revokeObjectURL(u)
  }, [file])
  return (
    <div className="thm">
      {url && <img src={url} alt={`Foto ${file.name}`} />}
      <button type="button" aria-label="Quitar foto" onClick={onRemove}>×</button>
    </div>
  )
}

// Selector de fotos: cámara del dispositivo o galería; se pueden acumular varias y quitarlas antes de enviar.
export function PhotoPicker({ files, onChange }) {
  const cam = useRef(null)
  const gal = useRef(null)
  const add = async (e) => {
    const list = await Promise.all([...e.target.files].map((f) => shrink(f)))
    e.target.value = ''
    onChange([...files, ...list])
  }
  return (
    <div className="pw">
      <div className="btns" style={{ marginTop: '.3rem' }}>
        <button type="button" className="btn l" onClick={() => cam.current.click()}>Sacar foto con la cámara</button>
        <button type="button" className="btn l" onClick={() => gal.current.click()}>Elegir de la galería</button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={add} />
      <input ref={gal} type="file" accept="image/*" multiple hidden onChange={add} />
      <div className="pth">
        {files.map((f, i) => <Thumb key={`${f.name}-${i}`} file={f} onRemove={() => onChange(files.filter((_, j) => j !== i))} />)}
      </div>
    </div>
  )
}

export function Gallery({ ids, base, onDelete }) {
  if (!ids.length) return <p className="mu">Sin fotos.</p>
  return (
    <div className="photos">
      {ids.map((id) => (
        <div key={id}>
          <a href={`${base}/${id}`} target="_blank" rel="noreferrer"><img loading="lazy" src={`${base}/${id}`} alt={`Foto ${id}`} /></a>
          {onDelete && <button type="button" className="btn l sm" onClick={() => onDelete(id)}>Quitar</button>}
        </div>
      ))}
    </div>
  )
}

function FindingPhotoViewer({ f, ids, index, setIndex, onClose }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') setIndex((index + ids.length - 1) % ids.length)
      if (event.key === 'ArrowRight') setIndex((index + 1) % ids.length)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [f.id, ids.length, index, onClose, setIndex])
  const photoUrl = `/api/photos/${ids[index]}`
  return (
    <div className="photo-viewer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="photo-viewer" role="dialog" aria-modal="true" aria-label={`Fotografías del hallazgo ${f.tag || f.id}`}>
        <div className="photo-viewer-header">
          <b>{f.tag || `Hallazgo #${f.id}`}</b>
          <button type="button" className="btn l sm" onClick={onClose} aria-label="Cerrar fotografías">Cerrar ×</button>
        </div>
        <div className="photo-viewer-image">
          {failed
            ? <p role="status">No se pudo cargar esta fotografía. Verificá el acceso y la conexión.</p>
            : <img src={photoUrl} alt={`Fotografía ${index + 1} de ${ids.length}`} onError={() => setFailed(true)} />}
        </div>
        <div className="photo-viewer-footer">
          <button type="button" className="btn l sm" onClick={() => setIndex((index + ids.length - 1) % ids.length)} disabled={ids.length < 2}>← Anterior</button>
          <span>{index + 1} / {ids.length}</span>
          <button type="button" className="btn l sm" onClick={() => setIndex((index + 1) % ids.length)} disabled={ids.length < 2}>Siguiente →</button>
          <Link className="btn y sm" to={`/hallazgos/${f.id}`}>Abrir detalle completo</Link>
        </div>
      </section>
    </div>
  )
}

export const FindingCard = ({ f }) => {
  const [photoIndex, setPhotoIndex] = useState(null)
  const [photoError, setPhotoError] = useState(false)
  const photoIds = f.photoIds || []
  useEffect(() => { setPhotoError(false) }, [photoIds[0]])
  return (
    <article className={`it finding-card ${f.status === 'solucionado' ? 'solucionado' : f.crit}`}>
      <Link to={`/hallazgos/${f.id}`} className="finding-card-link">
        <div className="l1">
          <b className="tag">{f.tag || `#${f.id}`}</b>
          <span><Pill kind={f.crit}>{f.crit}</Pill> <Pill kind={f.status}>{f.status}</Pill></span>
        </div>
        <div className="mu l2">{f.area} · Zona {f.zone}{f.protection ? ` · ${f.protection}` : ''}{f.ot ? ` · OT ${f.ot}` : ''}</div>
        <div>{f.description}</div>
        <div className="mu l2">{fmtDate(f.date)}{f.inspector ? ` · ${f.inspector}` : ''}</div>
      </Link>
      {photoIds.length
        ? <button type="button" className="finding-photo-button" onClick={() => setPhotoIndex(0)} aria-label={`Ver fotografías del hallazgo ${f.tag || f.id}`}>
            {photoError
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-label="Fotografía no disponible"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m21 15-5-5L5 20" /></svg>
              : <img src={`/api/photos/${photoIds[0]}`} alt="" loading="lazy" onError={() => setPhotoError(true)} />}
            {photoIds.length > 1 && <span className="finding-photo-count">+{photoIds.length - 1}</span>}
          </button>
        : <span className="finding-photo-empty" aria-label="Sin fotografías"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-5-5L5 20" /></svg></span>}
      {photoIndex !== null && <FindingPhotoViewer f={f} ids={photoIds} index={photoIndex} setIndex={setPhotoIndex} onClose={() => setPhotoIndex(null)} />}
    </article>
  )
}
