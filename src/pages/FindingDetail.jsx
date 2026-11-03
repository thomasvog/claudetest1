import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, formData } from '../api.js'
import { useApp } from '../App.jsx'
import { Async, digitsOnly, Field, Gallery, Msg, PhotoPicker, Pill, fmtDate, today, useAsync } from '../ui.jsx'

function FindingReportPreview({ report, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="report-preview-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="report-preview" role="dialog" aria-modal="true" aria-label="Previsualización del informe PDF">
        <header className="report-preview-header">
          <b>Previsualización del informe</b>
          <button type="button" className="btn l sm" onClick={onClose} aria-label="Cerrar previsualización">Cerrar ×</button>
        </header>
        <object className="report-preview-document" data={report.url} type="application/pdf" aria-label="Informe PDF del hallazgo">
          <p>Este navegador no puede mostrar el PDF aquí. <a href={report.url} target="_blank" rel="noreferrer">Abrir el informe en otra pestaña</a>.</p>
        </object>
        <footer className="report-preview-footer">
          <a className="btn y sm" href={report.url} download={report.filename}>Descargar PDF</a>
          <a className="btn l sm" href={report.url} target="_blank" rel="noreferrer">Abrir en otra pestaña</a>
          <button type="button" className="btn l sm" onClick={onClose}>Cerrar</button>
        </footer>
      </section>
    </div>
  )
}

function AddPhotos({ id, kind, onDone }) {
  const [files, setFiles] = useState([])
  const [err, setErr] = useState('')
  const send = async () => {
    setErr('')
    try { await api.post(`/api/findings/${id}/photos`, formData({ kind }, { photos: files })); setFiles([]); onDone() } catch (x) { setErr(x.message) }
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

function CloseForm({ f, onDone }) {
  const [v, setV] = useState({ resolution: '', closed_at: today(), ot: digitsOnly(f.ot || '') })
  const [files, setFiles] = useState([])
  const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    try { await api.post(`/api/findings/${f.id}/close`, formData(v, { photos: files })); onDone() } catch (x) { setErr(x.message) }
  }
  return (
    <form onSubmit={submit}>
      <Msg kind="err">{err}</Msg>
      <Field label="Qué se reparó o cambió"><textarea required value={v.resolution} onChange={(e) => setV({ ...v, resolution: e.target.value })} /></Field>
      <div className="grid">
        <div><Field label="N° de OT" hint="(obligatorio)"><input type="text" inputMode="numeric" pattern="[0-9]*" value={v.ot} onChange={(e) => setV({ ...v, ot: digitsOnly(e.target.value) })} /></Field></div>
        <div><Field label="Fecha de cierre"><input type="date" value={v.closed_at} onChange={(e) => setV({ ...v, closed_at: e.target.value })} /></Field></div>
      </div>
      <Field label="Fotos del resultado"><PhotoPicker files={files} onChange={setFiles} /></Field>
      <div className="btns"><button className="btn g">Marcar como solucionado</button></div>
    </form>
  )
}

export function FindingDetail() {
  const { id } = useParams()
  const { user } = useApp()
  const nav = useNavigate()
  const s = useAsync(() => api.get(`/api/findings/${id}`), [id])
  const [err, setErr] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportPreview, setReportPreview] = useState(null)
  useEffect(() => {
    if (!reportPreview) return undefined
    return () => URL.revokeObjectURL(reportPreview.url)
  }, [reportPreview])
  const previewReport = async () => {
    setReportBusy(true)
    setReportError('')
    try {
      const response = await fetch(`/api/reports/findings/${id}.pdf`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/pdf' },
      })
      const bytes = await response.arrayBuffer()
      if (!response.ok) {
        let message = `No se pudo generar el PDF (HTTP ${response.status}).`
        try {
          const body = JSON.parse(new TextDecoder().decode(bytes))
          if (body.error) message = body.error
        } catch { /* el servidor puede responder HTML ante un error de infraestructura */ }
        throw new Error(message)
      }
      const mime = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
      const signature = new TextDecoder().decode(bytes.slice(0, 5))
      if (mime !== 'application/pdf' || signature !== '%PDF-') {
        throw new Error('El servidor no devolvió un archivo PDF válido. Revisá los registros de la API.')
      }
      const disposition = response.headers.get('Content-Disposition') || ''
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `hallazgo_${id}.pdf`
      setReportPreview({ url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), filename })
    } catch (previewError) {
      setReportError(previewError.message || 'No se pudo generar la previsualización. Intentá nuevamente.')
    } finally {
      setReportBusy(false)
    }
  }
  const reopen = async () => {
    if (!window.confirm('¿Reabrir este hallazgo? Vuelve a quedar pendiente.')) return
    try { await api.post(`/api/findings/${id}/reopen`); s.reload() } catch (x) { setErr(x.message) }
  }
  const remove = async () => {
    if (!window.confirm('¿Eliminar este hallazgo y todas sus fotos? Esta acción no se puede deshacer.')) return
    setErr('')
    setDeleting(true)
    try {
      await api.del(`/api/findings/${id}`)
      nav('/hallazgos')
    } catch (x) {
      setErr(x.message)
      setDeleting(false)
    }
  }
  return (
    <Async s={s}>
      {(f) => {
        const solved = f.status === 'solucionado'
        return (
          <>
            <p><Link to="/hallazgos">‹ Volver a hallazgos</Link></p>
            <h1><span className="tag">{f.tag || `Hallazgo #${f.id}`}</span> <Pill kind={f.crit}>{f.crit}</Pill> <Pill kind={f.status}>{f.status}</Pill></h1>
            <Msg kind="err">{err}</Msg>
            <div className="card">
              <dl>
                <dt>Área</dt><dd>{f.area}</dd>
                <dt>Zona</dt><dd>{f.zone}{f.protection ? ` · ${f.protection}` : ''}</dd>
                {f.type && <><dt>Tipo</dt><dd>{f.type}</dd></>}
                <dt>N° de OT</dt><dd>{f.ot || <span className="mu">sin cargar</span>}</dd>
                <dt>Inspección</dt><dd>{fmtDate(f.date)} · {f.inspector}</dd>
                {solved && <><dt>Cierre</dt><dd>{fmtDate(f.closedAt)} · {f.closer}</dd></>}
              </dl>
            </div>
            <div className="two">
              <div className="card">
                <h2>Estado encontrado</h2>
                <p style={{ whiteSpace: 'pre-wrap' }}>{f.description}</p>
                <Gallery ids={f.photos.antes} base="/api/photos" />
                {!solved && <p><Link className="btn l" to={`/hallazgos/${f.id}/editar`}>Editar hallazgo</Link></p>}
                <AddPhotos id={f.id} kind="antes" onDone={s.reload} />
              </div>
              <div className="card">
                <h2>Estado después de la reparación</h2>
                {solved ? (
                  <>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{f.resolution}</p>
                    <Gallery ids={f.photos.despues} base="/api/photos" />
                    <div className="btns" style={{ marginBottom: '.6rem' }}>
                      <button type="button" className="btn y" onClick={previewReport} disabled={reportBusy}>{reportBusy ? 'Generando PDF…' : 'Previsualizar informe PDF'}</button>
                      <Link className="btn l" to={`/hallazgos/${f.id}/reparacion`}>Editar reparación</Link>
                      <button type="button" className="btn l" onClick={reopen}>Reabrir hallazgo</button>
                    </div>
                    <Msg kind="err">{reportError}</Msg>
                    <AddPhotos id={f.id} kind="despues" onDone={s.reload} />
                  </>
                ) : <CloseForm f={f} onDone={s.reload} />}
              </div>
            </div>
            {user.role === 'admin' && <div className="finding-delete-action"><button type="button" className="btn d" disabled={deleting} onClick={remove}>{deleting ? 'Eliminando…' : 'Eliminar hallazgo'}</button></div>}
            {reportPreview && <FindingReportPreview report={reportPreview} onClose={() => setReportPreview(null)} />}
          </>
        )
      }}
    </Async>
  )
}

function RepairForm({ f }) {
  const nav = useNavigate()
  const [v, setV] = useState({ resolution: f.resolution || '', closed_at: f.closedAt || today(), ot: digitsOnly(f.ot || '') })
  const [files, setFiles] = useState([])
  const [despues, setDespues] = useState(f.photos.despues)
  const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    try { await api.post(`/api/findings/${f.id}/repair`, formData(v, { photos: files })); nav(`/hallazgos/${f.id}`) } catch (x) { setErr(x.message) }
  }
  const quitar = async (pid) => {
    if (!window.confirm('¿Quitar esta foto?')) return
    try { await api.del(`/api/findings/${f.id}/photos/${pid}`); setDespues(despues.filter((x) => x !== pid)) } catch (x) { setErr(x.message) }
  }
  return (
    <>
      <h1>Editar reparación · <span className="tag">{f.tag || `Hallazgo #${f.id}`}</span></h1>
      <form className="card" onSubmit={submit}>
        <Msg kind="err">{err}</Msg>
        <Field label="Qué se reparó o cambió"><textarea required value={v.resolution} onChange={(e) => setV({ ...v, resolution: e.target.value })} /></Field>
        <div className="grid">
          <div><Field label="N° de OT" hint="(obligatorio)"><input type="text" inputMode="numeric" pattern="[0-9]*" value={v.ot} onChange={(e) => setV({ ...v, ot: digitsOnly(e.target.value) })} /></Field></div>
          <div><Field label="Fecha de cierre"><input type="date" value={v.closed_at} onChange={(e) => setV({ ...v, closed_at: e.target.value })} /></Field></div>
        </div>
        <Field label="Agregar fotos del resultado"><PhotoPicker files={files} onChange={setFiles} /></Field>
        <div className="btns"><button className="btn y">Guardar cambios</button><button type="button" className="btn l" onClick={() => nav(`/hallazgos/${f.id}`)}>Cancelar</button></div>
      </form>
      <div className="card"><h2>Fotos actuales</h2><Gallery ids={despues} base="/api/photos" onDelete={quitar} /></div>
    </>
  )
}

export function RepairEdit() {
  const { id } = useParams()
  const s = useAsync(() => api.get(`/api/findings/${id}`), [id])
  return (
    <Async s={s}>
      {(f) => (f.status !== 'solucionado'
        ? <Msg kind="err">Solo se puede editar la reparación de un hallazgo solucionado. <Link to={`/hallazgos/${f.id}`}>Volver al hallazgo</Link></Msg>
        : <RepairForm key={id} f={f} />)}
    </Async>
  )
}
