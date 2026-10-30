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
  return (
    <>
      <div className="page-heading">
        <div><span className="section-kicker">SUPERVISIÓN</span><h1>Informes y reportes</h1><p className="page-lede">Documentos generados con los registros actuales del sistema.</p></div>
      </div>
      <div className="reports-grid">
        {reports.map((report) => (
          <section className={`card report-option ${report.tone}`} key={report.href}>
            <div className="report-option-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3.5h9l5 5v12H5z" /><path d="M14 3.5v5h5M8 13h8M8 16.5h5" /></svg></div>
            <div className="report-option-copy"><span className="section-kicker">PDF · PETROCUYO HAZLOC</span><h2>{report.title}</h2><p>{report.description}</p></div>
            <a className="btn y report-download" href={report.href} download>{report.action}<span aria-hidden="true">↓</span></a>
          </section>
        ))}
      </div>
    </>
  )
}