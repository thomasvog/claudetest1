import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { Async, FindingCard, useAsync } from '../ui.jsx'

const statIcons = {
  pending: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  solved: <><circle cx="12" cy="12" r="8.5" /><path d="m8 12 2.5 2.5L16 9" /></>,
  high: <><path d="M12 3 22 20H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
  total: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h4" /></>,
}

function StatCard({ to, tone, icon, label, value, detail }) {
  return (
    <Link className={`stat-card ${tone}`} to={to}>
      <span className="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{statIcons[icon]}</svg></span>
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      <span className="stat-detail">{detail}</span>
    </Link>
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
          const tot = d.pending + d.solved
          const mx = Math.max(1, ...d.byArea.map((a) => a.n))
          const progress = tot ? Math.round((d.solved * 100) / tot) : 0
          const high = d.byCrit.alta || 0
          return (
            <>
              <section className={`priority-panel ${d.overdue || high ? 'is-critical' : 'is-clear'}`} aria-label="Alertas prioritarias">
                <span className="priority-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 22 20H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></svg></span>
                <div className="priority-copy"><span className="section-kicker">ALERTAS PRIORITARIAS</span><b>{d.overdue || high ? 'Requieren atención' : 'Todo bajo control'}</b><p>{d.overdue ? `${d.overdue} pendiente${d.overdue === 1 ? '' : 's'} con más de 30 días.` : 'No hay pendientes con más de 30 días.'} {high ? `${high} hallazgo${high === 1 ? '' : 's'} de criticidad alta.` : 'Sin hallazgos pendientes de criticidad alta.'}</p></div>
                <div className="priority-actions">
                  {d.overdue > 0 && <Link className="btn alert-action" to="/hallazgos?status=pendiente&overdue=1">Ver vencidos <span aria-hidden="true">→</span></Link>}
                  {high > 0 && <Link className="btn danger-action" to="/hallazgos?crit=alta&status=pendiente">Ver alta criticidad <span aria-hidden="true">→</span></Link>}
                </div>
              </section>
              <div className="stats-grid">
                <StatCard to="/hallazgos?status=pendiente" tone="orange" icon="pending" label="HALLAZGOS PENDIENTES" value={d.pending} detail="Requieren seguimiento" />
                <StatCard to="/hallazgos?status=solucionado" tone="green" icon="solved" label="HALLAZGOS SOLUCIONADOS" value={d.solved} detail={tot ? `${progress}% del total registrado` : 'Sin registros todavía'} />
                <StatCard to="/hallazgos?crit=alta&status=pendiente" tone="red" icon="high" label="RIESGO ALTO" value={high} detail="Pendientes de criticidad alta" />
                <StatCard to="/hallazgos" tone="blue" icon="total" label="TOTAL DE HALLAZGOS" value={tot} detail="Registros de inspección" />
              </div>
              <div className="section-heading dashboard-section-title"><div><span className="section-kicker">PRIORIZACIÓN</span><h2>Pendientes por criticidad</h2></div></div>
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
