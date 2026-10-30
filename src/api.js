// Cliente de la API: manda el token CSRF en cada operación que modifica datos.
let csrf = ''
export const setCsrf = (t) => { csrf = t }

async function req(method, url, body) {
  const opt = { method, headers: { 'X-CSRF-Token': csrf }, credentials: 'same-origin' }
  if (body instanceof FormData) opt.body = body
  else if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json'
    opt.body = JSON.stringify(body)
  }
  let r
  try {
    r = await fetch(url, opt)
  } catch {
    throw new Error('No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.')
  }
  let data = null
  try { data = await r.json() } catch { /* respuesta sin cuerpo */ }
  if (!r.ok) {
    if (r.status === 401 && url !== '/api/login') window.dispatchEvent(new Event('auth-expired'))
    const e = new Error((data && data.error) || 'No se pudo completar la acción.')
    e.status = r.status
    throw e
  }
  return data
}

export const api = {
  get: (u) => req('GET', u),
  post: (u, b) => req('POST', u, b === undefined ? {} : b),
  put: (u, b) => req('PUT', u, b === undefined ? {} : b),
  del: (u) => req('DELETE', u),
}

export const qs = (o) => {
  const p = new URLSearchParams()
  Object.entries(o).forEach(([k, v]) => { if (v !== '' && v != null && v !== false) p.set(k, v === true ? '1' : v) })
  const s = p.toString()
  return s ? '?' + s : ''
}

// Arma un FormData con campos simples y archivos (un mismo nombre de campo admite varios archivos).
export function formData(fields, files = {}) {
  const fd = new FormData()
  Object.entries(fields).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x))
    else if (v != null) fd.append(k, v)
  })
  Object.entries(files).forEach(([k, list]) => list.forEach((f) => fd.append(k, f, f.name)))
  return fd
}
