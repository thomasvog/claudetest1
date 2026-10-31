import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { Async, FindingCard, useAsync } from '../ui.jsx'
import { useApp } from '../App.jsx'

const icons = {
  pending: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  solved: <><circle cx="12" cy="12" r="8.5" /><path d="m8 12 2.5 2.5L16 9" /></>,
  high: <><path d="M12 3 22 20H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
  total: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
  pdf: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  excel: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13l4 5m0-5-4 5" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
}

function Icon({ name, className = '' }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>
}

function StatCard({ to, tone, icon, label, value, detail, note, progress, percentage }) {
  const content = (
    <>
      <span className="stat-icon"><Icon name={icon} /></span>
      <span className="stat-label">{label}</span>
      <span className="stat-value-line"><b className="stat-value">{value}</b>{percentage !== undefined && <span className="stat-percentage">{percentage == null ? '—' : `${percentage.toFixed(1)}%`}</span>}</span>
      <span className="stat-detail">{detail}</span>
      {note && <span className="stat-note">{note}</span>}
      {progress !== undefined && <span className="stat-progress" role="progressbar" aria-label="Porcentaje de resolución" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></span>}
    </>
  )
  return (
    to
      ? <Link className={`stat-card ${tone}`} to={to}>{content}</Link>
      : <div className={`stat-card ${tone}`}>{content}</div>
  )
}

export default function Dashboard() {
  const { user } = useApp()
  const canReports = user.role !== 'tecnico'
  const s = useAsync(() => api.get('/api/dashboard'), [])
  return (
    <div className="dashboard-page">
      <section className="institution-card" aria-labelledby="institution-title">
        <div className="institution-meta">
          <div className="institution-standard"><span>NORMATIVA</span><b>IEC/IECEx 60079</b></div>
          <span className="institution-divider" aria-hidden="true" />
          <div className="institution-scope"><span>SUPERVISIÓN DE</span><b>INTEGRIDAD EN PLANTA</b></div>
        </div>
        <h1 id="institution-title">Monitoreo de Integridad Eléctrica en Áreas Clasificadas</h1>
        <p className="institution-description">Control de hallazgos en atmósferas explosivas (gases y polvos combustibles), verificación de sellos Ex d, cajas Ex e, desclasificaciones e instrumentación intrínseca.</p>
        <div className="institution-actions">
          {canReports && <Link className="institution-action" to="/informes"><Icon name="pdf" />Informes PDF</Link>}
          <a className="institution-action" href="/api/findings/export.xlsx"><Icon name="excel" />Exportar Excel</a>
          <Link className="institution-action institution-action-primary" to="/hallazgos/nuevo"><Icon name="plus" />Cargar Hallazgo</Link>
        </div>
      </section>
      <Async s={s}>
        {(d) => {
          const mx = Math.max(1, ...d.byArea.map((a) => a.n))
          const progress = d.resolutionRate == null ? 0 : Math.min(100, Math.max(0, d.resolutionRate))
          const high = d.byCrit.alta || 0
          return (
            <>
              {d.overdue > 0 ? (
                <section className="overdue-alert" aria-labelledby="overdue-alert-title">
                  <span className="overdue-alert-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 22 20H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></svg>
                  </span>
                  <div className="overdue-alert-copy">
                    <span className="section-kicker">HALLAZGOS PENDIENTES · MÁS DE 30 DÍAS</span>
                    <b id="overdue-alert-title">{d.overdue} hallazgo{d.overdue === 1 ? '' : 's'} pendiente{d.overdue === 1 ? '' : 's'} con más de 30 días</b>
                    <p>Requieren atención prioritaria para mantener la conformidad de planta.</p>
                  </div>
                  <Link className="btn overdue-alert-action" to="/hallazgos?status=pendiente&overdue=1">Ver cuáles son <Icon name="arrow" /></Link>
                </section>
              ) : (
                <div className="overdue-clear" role="status">
                  <span className="overdue-clear-icon"><Icon name="solved" /></span>
                  <span>No hay hallazgos pendientes con más de 30 días</span>
                </div>
              )}
              <div className="stats-grid">
                <StatCard to="/hallazgos?status=pendiente" tone="orange" icon="pending" label="PENDIENTES" value={d.pending} detail="Requieren acción técnica" />
                <StatCard to="/hallazgos?status=solucionado" tone="green" icon="solved" label="SOLUCIONADOS" value={d.solved} detail={d.resolutionRate == null ? 'Sin registros todavía' : 'Del total de hallazgos'} percentage={d.resolutionRate} progress={progress} />
                <StatCard to="/hallazgos?crit=alta&status=pendiente" tone="red" icon="high" label="RIESGO ALTO" value={high} detail="Pendientes de criticidad alta" />
                <StatCard tone="blue" icon="total" label="TOTAL INSPECCIONES" value={d.pending + d.solved} detail="Pendientes y solucionados" />
              </div>
              <section className="criticality-panel" aria-labelledby="criticality-title">
                <div className="criticality-heading"><h2 id="criticality-title">Pendientes por Criticidad</h2><span>Filtrar por nivel</span></div>
                <div className="criticality-grid">
                  {['alta', 'media', 'baja'].map((c) => (
                    <Link key={c} className={`criticality-card ${c}`} to={`/hallazgos?crit=${c}&status=pendiente`}>
                      <span>{c.toUpperCase()}</span><b>{d.byCrit[c] || 0}</b><small>{c === 'alta' ? 'Intervención prioritaria' : c === 'media' ? 'Requieren seguimiento' : 'Seguimiento preventivo'}</small>
                    </Link>
                  ))}
                </div>
              </section>
              <div className="dashboard-directory-link"><Link to="/hallazgos">Ver todos los hallazgos <Icon name="arrow" /></Link></div>
              <div className="section-heading urgent-heading"><div><span className="section-kicker">DISTRIBUCIÓN</span><h2>Pendientes por área</h2></div><span className="section-note">{d.byArea.length} áreas</span></div>
              <div className="card">
                {d.byArea.length ? d.byArea.map((a) => (
                  <div className="abar" key={a.id}>
                    <Link to={`/hallazgos?loc=${a.id}&status=pendiente`}><i className="sw" style={{ background: a.color }} />{a.name}</Link>
                    <div className="tr"><i style={{ width: `${(a.n * 100) / mx}%`, background: a.color }} /></div>
                    <b>{a.n}</b>
                  </div>
                )) : <p className="empty-state">No hay áreas para mostrar.</p>}
              </div>
              <div className="section-heading urgent-heading"><div><span className="section-kicker">PARA SEGUIR</span><h2>Pendientes más urgentes</h2></div><Link to="/hallazgos?status=pendiente">Abrir listado <span aria-hidden="true">→</span></Link></div>
              {d.urgent.length ? d.urgent.map((u) => <FindingCard key={u.id} f={{ ...u, status: 'pendiente' }} />) : <p className="empty-state">No hay hallazgos pendientes.</p>}
            </>
          )
        }}
      </Async>
    </div>
  )
}
