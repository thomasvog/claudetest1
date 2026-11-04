import { useState } from 'react'
import { useApp } from '../App.jsx'
import { Msg } from '../ui.jsx'

const monthNames = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const reports = [
  {
    title: 'Hallazgos pendientes',
    description: 'Hallazgos detectados en el período, priorizados por criticidad y antigüedad.',
    href: '/api/reports/pending.pdf',
    action: 'Descargar informe de hallazgos pendientes',
    tone: 'report-alert',
  },
  {
    title: 'Hallazgos solucionados',
    description: 'Hallazgos cuya fecha de solución corresponde al período seleccionado.',
    href: '/api/reports/solved.pdf',
    action: 'Descargar informe de hallazgos solucionados',
    tone: 'report-success',
  },
  {
    title: 'Informe ejecutivo de KPIs',
    description: 'Indicadores y distribuciones de hallazgos detectados en el período.',
    href: '/api/reports/executive.pdf',
    action: 'Descargar informe ejecutivo de KPIs',
    tone: 'report-executive',
  },
]

export default function ReportsPage() {
  const { user } = useApp()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const now = new Date()
  const [period, setPeriod] = useState('month')
  const [month, setMonth] = useState(String(now.getMonth() + 1))
  const [year, setYear] = useState(String(now.getFullYear()))

  const download = async (report) => {
    const query = new URLSearchParams({ period, year })
    if (period === 'month') query.set('month', month)
    const href = `${report.href}?${query}`
    const format = report.format || 'pdf'
    const contentType = format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf'
    const signature = format === 'xlsx' ? 'PK' : '%PDF-'
    setBusy(report.href)
    setError('')
    try {
      const response = await fetch(href, {
        credentials: 'same-origin',
        headers: { Accept: contentType },
      })
      const bytes = await response.arrayBuffer()
      if (!response.ok) {
        let message = `No se pudo generar el archivo (HTTP ${response.status}).`
        try {
          const body = JSON.parse(new TextDecoder().decode(bytes))
          if (body.error) message = body.error
        } catch { /* el servidor puede responder HTML ante un error de infraestructura */ }
        throw new Error(message)
      }
      const mime = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
      const actualSignature = new TextDecoder().decode(bytes.slice(0, signature.length))
      if (mime !== contentType || actualSignature !== signature) {
        throw new Error(`El servidor no devolvió un archivo ${format.toUpperCase()} válido. Revisá los registros de la API.`)
      }
      const disposition = response.headers.get('Content-Disposition') || ''
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || report.href.split('/').pop()
      const url = URL.createObjectURL(new Blob([bytes], { type: contentType }))
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
      <section className="card report-period" aria-label="Período de los informes">
        <div className="report-period-heading">
          <h2>Período del informe</h2>
          <p>Seleccioná el alcance para los informes y la lista de OT.</p>
        </div>
        <label>
          <span>Frecuencia</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value)}>
            <option value="month">Mensual</option>
            <option value="year">Anual</option>
          </select>
        </label>
        {period === 'month' && (
          <label>
            <span>Mes</span>
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              {monthNames.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}
            </select>
          </label>
        )}
        <label>
          <span>Año</span>
          <input type="number" min="1900" max="9998" value={year} onChange={(event) => setYear(event.target.value)} />
        </label>
      </section>
      <div className="reports-grid">
        {reports.map((report) => (
          <section className={`card report-option ${report.tone}`} key={report.href}>
            <div className="report-option-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3.5h9l5 5v12H5z" /><path d="M14 3.5v5h5M8 13h8M8 16.5h5" /></svg></div>
            <div className="report-option-copy"><span className="section-kicker">PDF · PETROCUYO HAZLOC</span><h2>{report.title}</h2><p>{report.description}</p></div>
            <button type="button" className="btn y report-download" onClick={() => download(report)} disabled={!!busy}>{busy === report.href ? 'Generando PDF…' : report.action}<span aria-hidden="true">↓</span></button>
          </section>
        ))}
        {user.role === 'admin' && (
          <section className="card report-option report-ot">
            <div className="report-option-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3.5h9l5 5v12H5z" /><path d="M14 3.5v5h5M8 13h8M8 16.5h8" /></svg></div>
            <div className="report-option-copy"><span className="section-kicker">EXCEL · PETROCUYO HAZLOC</span><h2>Números de OT</h2><p>Una sola columna con las OT registradas en hallazgos del período, según su fecha de inspección.</p></div>
            <button type="button" className="btn y report-download" onClick={() => download({ href: '/api/reports/ot.xlsx', format: 'xlsx' })} disabled={!!busy}>{busy === '/api/reports/ot.xlsx' ? 'Generando Excel…' : 'Descargar números de OT'}<span aria-hidden="true">↓</span></button>
          </section>
        )}
      </div>
    </>
  )
}