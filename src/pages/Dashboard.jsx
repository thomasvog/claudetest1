import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { Async, FindingCard, useAsync } from '../ui.jsx'

const statIcons = {
  pending: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  solved: <><circle cx="12" cy="12" r="8.5" /><path d="m8 12 2.5 2.5L16 9" /></>,
  high: <><path d="M12 3 22 20H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
  total: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
}

function StatCard({ to, tone, icon, label, value, detail, progress }) {
  const content = (
    <>
      <span className="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{statIcons[icon]}</svg></span>
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      <span className="stat-detail">{detail}</span>
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
  const s = useAsync(() => api.get('/api/dashboard'), [])
  return (
    <>
      <div className="page-heading">
        <div><span className="section-kicker">VISTA GENERAL</span><h1>Estado de los hallazgos</h1><p className="page-lede">Seguimiento de inspecciones y acciones pendientes.</p></div>
        <Link className="btn l dashboard-link" to="/hallazgos">Ver todos los hallazgos <span aria-hidden="true">→</span></Link>
      </div>
      <Async s={s}>
        {(d) => {
          const tot = d.total
          const mx = Math.max(1, ...d.byArea.map((a) => a.n))
          const progress = d.resolutionRate == null ? 0 : Math.min(100, Math.max(0, d.resolutionRate))
          const high = d.byCrit.alta || 0
          return (
            <>
              {d.overdue > 0 && (
                <section className="overdue-alert" aria-labelledby="overdue-alert-title">
                  <span className="overdue-alert-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 22 20H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></svg>
                  </span>
                  <div className="overdue-alert-copy">
                    <span className="section-kicker">HALLAZGOS PENDIENTES · MÁS DE 30 DÍAS</span>
                    <b id="overdue-alert-title">{d.overdue} requieren atención prioritaria</b>
                    <p>Requieren atención prioritaria para mantener la conformidad de planta.</p>
                  </div>
                  <Link className="btn overdue-alert-action" to="/hallazgos?status=pendiente&overdue=1">Ver cuáles son <span aria-hidden="true">→</span></Link>
                </section>
              )}
              <div className="stats-grid">
                <StatCard to="/hallazgos?status=pendiente" tone="orange" icon="pending" label="PENDIENTES" value={d.pending} detail="Requieren acción técnica" />
                <StatCard to="/hallazgos?status=solucionado" tone="green" icon="solved" label="SOLUCIONADOS" value={d.solved} detail={d.resolutionRate == null ? 'Sin registros todavía' : `${progress.toFixed(1)}% de resolución`} progress={progress} />
                <StatCard to="/hallazgos?crit=alta&status=pendiente" tone="red" icon="high" label="RIESGO ALTO" value={high} detail="Pendientes de criticidad alta" />
                <StatCard tone="blue" icon="total" label="TOTAL INSPECCIONES" value="—" detail={`Inspecciones: no registradas. Hallazgos: ${tot}.`} />
              </div>
              <div className="section-heading dashboard-section-title"><div><span className="section-kicker">PRIORIZACIÓN</span><h2>Pendientes por Criticidad</h2></div></div>
              <div className="tiles">
                {['alta', 'media', 'baja'].map((c) => (
                  <Link key={c} className={`tile ${c}`} to={`/hallazgos?crit=${c}&status=pendiente`}>
                    <span>{c[0].toUpperCase() + c.slice(1)}</span><b>{d.byCrit[c] || 0}</b><small>pendientes</small>
                  </Link>
                ))}
              </div>
              <div className="card">
                <div className="section-heading"><div><span className="section-kicker">DISTRIBUCIÓN</span><h2>Pendientes por área</h2></div><span className="section-note">{d.byArea.length} áreas</span></div>
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
    </>
  )
}
