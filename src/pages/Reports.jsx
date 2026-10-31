import { useState } from 'react'
import { Msg } from '../ui.jsx'

const reports = [
  {
    title: 'Hallazgos pendientes',
    description: 'Listado completo priorizado por criticidad y antigüedad.',
    href: '/api/reports/pending.pdf',
    action: 'Descargar informe de hallazgos pendientes',
    tone: 'report-alert',
  },
  {
    title: 'Hallazgos solucionados',
    description: 'Registros cerrados ordenados por fecha de solución.',
    href: '/api/reports/solved.pdf',
    action: 'Descargar informe de hallazgos solucionados',
    tone: 'report-success',
  },
  {
    title: 'Informe ejecutivo de KPIs',
    description: 'Indicadores, distribuciones, gráficos y metodología de cálculo.',
    href: '/api/reports/executive.pdf',
    action: 'Descargar informe ejecutivo de KPIs',
    tone: 'report-executive',
  },
]

export default function ReportsPage() {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const download = async (report) => {
    setBusy(report.href)
    setError('')
    try {
      const response = await fetch(report.href, {
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
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || report.href.split('/').pop()
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (downloadError) {
      setError(downloadError.message || 'No se pudo descargar el informe. Intentá nuevamente.')
    } finally {
      setBusy('')
    }
  }
  return (
    <>
      <div className="page-heading">
        <div><span className="section-kicker">SUPERVISIÓN</span><h1>Informes y reportes</h1><p className="page-lede">Documentos generados con los registros actuales del sistema.</p></div>
      </div>
      <Msg kind="err">{error}</Msg>
      <div className="reports-grid">
        {reports.map((report) => (
          <section className={`card report-option ${report.tone}`} key={report.href}>
            <div className="report-option-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3.5h9l5 5v12H5z" /><path d="M14 3.5v5h5M8 13h8M8 16.5h5" /></svg></div>
            <div className="report-option-copy"><span className="section-kicker">PDF · PETROCUYO HAZLOC</span><h2>{report.title}</h2><p>{report.description}</p></div>
            <button type="button" className="btn y report-download" onClick={() => download(report)} disabled={!!busy}>{busy === report.href ? 'Generando PDF…' : report.action}<span aria-hidden="true">↓</span></button>
          </section>
        ))}
      </div>
    </>
  )
}