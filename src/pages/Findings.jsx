import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, qs } from '../api.js'
import { Async, Field, FindingCard, Select, useAsync } from '../ui.jsx'
import { useApp } from '../App.jsx'

export default function Findings() {
  const { meta } = useApp()
  const [sp, setSp] = useSearchParams()
  const p = Object.fromEntries(sp.entries())
  const q = qs(p)
  const s = useAsync(() => api.get('/api/findings' + q), [q])
  const [text, setText] = useState(p.q || '')
  useEffect(() => { setText(p.q || '') }, [p.q])
  const set = (k, v) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v); else n.delete(k)
    setSp(n, { replace: true })
  }
  return (
    <>
      <h1>Hallazgos {s.data && <small>({s.data.total})</small>}</h1>
      <form className="card" onSubmit={(e) => { e.preventDefault(); set('q', text.trim()) }}>
        <div className="grid">
          <div><Field label="Buscar"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="TAG, texto u OT" /></Field></div>
          <div><Field label="Área"><Select value={p.loc || ''} onChange={(v) => set('loc', v)} placeholder="Todas" options={meta.areas.map((a) => ({ value: a.id, label: a.name }))} /></Field></div>
          <div><Field label="Zona"><Select value={p.zone || ''} onChange={(v) => set('zone', v)} placeholder="Todas" options={meta.zones} /></Field></div>
          <div><Field label="Criticidad"><Select value={p.crit || ''} onChange={(v) => set('crit', v)} placeholder="Todas" options={meta.crit} /></Field></div>
          <div><Field label="Estado"><Select value={p.status || ''} onChange={(v) => set('status', v)} placeholder="Todos" options={['pendiente', 'solucionado']} /></Field></div>
        </div>
        <label className="chk"><input type="checkbox" checked={!!p.overdue} onChange={(e) => set('overdue', e.target.checked ? '1' : '')} /> Solo pendientes con más de 30 días</label>
        <div className="btns">
          <button className="btn">Buscar</button>
          <button type="button" className="btn l" onClick={() => setSp({}, { replace: true })}>Limpiar</button>
          <a className="btn y" href={`/api/findings/export.xlsx${q}`}>Exportar a Excel</a>
        </div>
      </form>
      <Async s={s}>
        {(d) => (d.items.length ? (
          <>
            {d.items.map((f) => <FindingCard key={f.id} f={f} />)}
            {d.total > d.items.length && <p className="mu">Se muestran los primeros {d.items.length}. Usá los filtros o exportá a Excel para ver todos.</p>}
          </>
        ) : <p className="mu">Ningún hallazgo coincide con estos filtros.</p>)}
      </Async>
    </>
  )
}
