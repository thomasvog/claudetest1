import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { Async, FindingCard, useAsync } from '../ui.jsx'

export default function Dashboard() {
  const s = useAsync(() => api.get('/api/dashboard'), [])
  return (
    <>
      <h1>Estado de los hallazgos</h1>
      <p><Link className="btn y" to="/hallazgos/nuevo">Cargar hallazgo</Link></p>
      <Async s={s}>
        {(d) => {
          const tot = d.pending + d.solved
          const mx = Math.max(1, ...d.byArea.map((a) => a.n))
          return (
            <>
              <div className="card">
                <div className="big">{d.pending} <span className="mu" style={{ fontSize: '1.1rem', fontWeight: 400 }}>pendientes de {tot} registrados</span></div>
                <div className="split"><i style={{ width: `${tot ? (d.solved * 100) / tot : 0}%` }} /></div>
                <div className="mu">{d.solved} solucionados{tot ? ` (${Math.round((d.solved * 100) / tot)}%)` : ''}</div>
              </div>
              {d.overdue > 0 && (
                <div className="card" style={{ borderColor: 'var(--alta)', display: 'flex', flexWrap: 'wrap', gap: '.6rem 1rem', alignItems: 'center', justifyContent: 'space-between' }}>
                  <b style={{ color: 'var(--alta)' }}>{d.overdue} pendiente{d.overdue === 1 ? '' : 's'} con más de 30 días</b>
                  <Link className="btn" to="/hallazgos?status=pendiente&overdue=1">Ver cuáles son</Link>
                </div>
              )}
              <h2>Pendientes por criticidad</h2>
              <div className="tiles">
                {['alta', 'media', 'baja'].map((c) => (
                  <Link key={c} className={`tile ${c}`} to={`/hallazgos?crit=${c}&status=pendiente`}>
                    <span>{c[0].toUpperCase() + c.slice(1)}</span><b>{d.byCrit[c] || 0}</b><small>pendientes</small>
                  </Link>
                ))}
              </div>
              <div className="card">
                <h2>Pendientes por área</h2>
                {d.byArea.map((a) => (
                  <div className="abar" key={a.id}>
                    <Link to={`/hallazgos?loc=${a.id}&status=pendiente`}><i className="sw" style={{ background: a.color }} />{a.name}</Link>
                    <div className="tr"><i style={{ width: `${(a.n * 100) / mx}%`, background: a.color }} /></div>
                    <b>{a.n}</b>
                  </div>
                ))}
              </div>
              <h2>Pendientes más urgentes</h2>
              {d.urgent.length ? d.urgent.map((u) => <FindingCard key={u.id} f={{ ...u, status: 'pendiente' }} />) : <p className="mu">No hay hallazgos pendientes.</p>}
            </>
          )
        }}
      </Async>
    </>
  )
}
