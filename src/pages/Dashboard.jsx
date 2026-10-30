import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { Async, FindingCard, useAsync } from '../ui.jsx'

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
          const tot = d.pending + d.solved
          const mx = Math.max(1, ...d.byArea.map((a) => a.n))
          const progress = tot ? Math.round((d.solved * 100) / tot) : 0
          return (
            <>
              <div className="overview-grid">
                <section className="card overview-total">
                  <div className="overview-head"><div><span className="section-kicker">SEGUIMIENTO GENERAL</span><p className="overview-title">Hallazgos registrados</p></div><span className="total-badge">{tot} en total</span></div>
                  <div className="overview-metrics"><div><b className="big">{d.pending}</b><span>Pendientes</span></div><div className="solved-metric"><b>{d.solved}</b><span>Solucionados</span></div></div>
                  <div className="completion-label"><span>Progreso de resolución</span><b>{progress}%</b></div>
                  <div className="split"><i style={{ width: `${progress}%` }} /></div>
                </section>
                <section className={`card attention-card ${d.overdue ? 'has-overdue' : 'clear'}`}>
                  <span className="section-kicker">ATENCIÓN REQUERIDA</span>
                  <div className="attention-count">{d.overdue}</div>
                  <p>{d.overdue ? `Pendiente${d.overdue === 1 ? '' : 's'} con más de 30 días` : 'Sin hallazgos vencidos por antigüedad'}</p>
                  {d.overdue > 0 && <Link to="/hallazgos?status=pendiente&overdue=1" className="attention-link">Revisar pendientes <span aria-hidden="true">→</span></Link>}
                </section>
              </div>
              <div className="section-heading"><div><span className="section-kicker">PRIORIZACIÓN</span><h2>Pendientes por criticidad</h2></div></div>
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
