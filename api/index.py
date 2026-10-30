"""Backend (API JSON) de la plataforma de inspecciones HAZLOC. Flask + Postgres (Neon). Se despliega en Vercel como función Python."""
import csv
import hashlib
import hmac
import io
import os
import re
import secrets
import unicodedata
from datetime import date, datetime
from functools import wraps

import psycopg
from flask import Flask, abort, g, jsonify, request, send_file, session
from flask.json.provider import DefaultJSONProvider
from openpyxl import Workbook, load_workbook
from PIL import Image, ImageOps
from psycopg.rows import dict_row
from werkzeug.security import check_password_hash, generate_password_hash


class Provider(DefaultJSONProvider):
    ensure_ascii = False

    @staticmethod
    def default(o):
        if isinstance(o, (date, datetime)):
            return o.isoformat()
        return DefaultJSONProvider.default(o)


URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or ""
SETUP_KEY = os.environ.get("SETUP_KEY", "")

app = Flask(__name__)
app.json = Provider(app)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY") or hashlib.sha256(("hazloc|" + URL).encode()).hexdigest(),
    MAX_CONTENT_LENGTH=4 * 1024 * 1024,  # Vercel admite ~4,5 MB por request
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.environ.get("VERCEL")),
)

AREAS = ["Polímeros", "Extrusión", "Unidad 500", "Servicios", "Bagging"]  # áreas fijas
OTHER = "Otro"  # tipo de hallazgo con descripción libre (fijo)
DEFAULT_TYPES = ["Falta tornillo", "Falta tapón", "Prensacable en mal estado", "Deterioro", "Polvo en superficie", "Rotura"]
ZONES = ["0", "1", "2", "20", "21", "22", "0/20", "1/21", "2/22", "Segura"]
ZMAP = {z.lower().replace(" ", ""): z for z in ZONES}
AREA_COLORS = ["#2563a8", "#7a4fb5", "#1aa3c8", "#5b6b7b", "#c2409b"]  # azul, violeta, celeste, gris, magenta
CRIT = ["alta", "media", "baja"]
PROT = ["Ex d", "Ex e", "Ex i", "Ex p", "Ex n", "Ex m", "Ex o", "Ex q", "Ex t", "Otro / N.A."]
ROLES = {"tecnico": 1, "supervisor": 2, "admin": 3}
ROLE_LABEL = {"tecnico": "Técnico", "supervisor": "Supervisor", "admin": "Administrador"}

SCHEMA = [
    "CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pw TEXT NOT NULL, role TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS locations(id SERIAL PRIMARY KEY, parent_id INT REFERENCES locations(id), name TEXT NOT NULL)",
    """CREATE TABLE IF NOT EXISTS findings(id SERIAL PRIMARY KEY, location_id INT NOT NULL REFERENCES locations(id),
       tag TEXT, zone TEXT NOT NULL, protection TEXT, criticality TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendiente',
       description TEXT NOT NULL, inspector_id INT REFERENCES users(id) ON DELETE SET NULL, inspected_at DATE NOT NULL,
       resolution TEXT, closed_by INT REFERENCES users(id) ON DELETE SET NULL, closed_at DATE)""",
    """CREATE TABLE IF NOT EXISTS photos(id SERIAL PRIMARY KEY, finding_id INT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
       kind TEXT NOT NULL, data BYTEA NOT NULL, created_at DATE NOT NULL)""",
    "CREATE TABLE IF NOT EXISTS attempts(id SERIAL PRIMARY KEY, username TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE",
    """CREATE TABLE IF NOT EXISTS equipment(id SERIAL PRIMARY KEY, tag TEXT NOT NULL, description TEXT,
       location_id INT NOT NULL REFERENCES locations(id), zone TEXT NOT NULL, protection TEXT)""",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_eq_tag ON equipment(lower(tag))",
    "ALTER TABLE findings ADD COLUMN IF NOT EXISTS equipment_id INT REFERENCES equipment(id) ON DELETE SET NULL",
    "ALTER TABLE findings ADD COLUMN IF NOT EXISTS inspector_name TEXT",
    "ALTER TABLE findings ADD COLUMN IF NOT EXISTS closer_name TEXT",
    "ALTER TABLE findings ALTER COLUMN inspector_id DROP NOT NULL",
    "UPDATE findings f SET inspector_name=u.name FROM users u WHERE u.id=f.inspector_id AND f.inspector_name IS NULL",
    "UPDATE findings f SET closer_name=u.name FROM users u WHERE u.id=f.closed_by AND f.closer_name IS NULL",
    *[("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='findings_%s_fkey' AND confdeltype <> 'n') THEN "
       "ALTER TABLE findings DROP CONSTRAINT findings_%s_fkey; "
       "ALTER TABLE findings ADD CONSTRAINT findings_%s_fkey FOREIGN KEY (%s) REFERENCES users(id) ON DELETE SET NULL; "
       "END IF; END $$") % (c, c, c, c) for c in ("inspector_id", "closed_by")],
    """CREATE TABLE IF NOT EXISTS declassifications(id SERIAL PRIMARY KEY, location_id INT NOT NULL REFERENCES locations(id),
       reason TEXT NOT NULL, description TEXT NOT NULL, done_at DATE NOT NULL, responsible TEXT NOT NULL,
       created_by INT REFERENCES users(id) ON DELETE SET NULL, set_safe BOOLEAN NOT NULL DEFAULT FALSE)""",
    """CREATE TABLE IF NOT EXISTS declass_tags(id SERIAL PRIMARY KEY, declass_id INT NOT NULL REFERENCES declassifications(id) ON DELETE CASCADE,
       equipment_id INT REFERENCES equipment(id) ON DELETE SET NULL, tag TEXT NOT NULL, prev_zone TEXT)""",
    """CREATE TABLE IF NOT EXISTS declass_photos(id SERIAL PRIMARY KEY, declass_id INT NOT NULL REFERENCES declassifications(id) ON DELETE CASCADE,
       kind TEXT NOT NULL, data BYTEA NOT NULL, created_at DATE NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS ix_dt ON declass_tags(declass_id)",
    "CREATE INDEX IF NOT EXISTS ix_dp ON declass_photos(declass_id)",
    "UPDATE users SET role='tecnico' WHERE role='carga'",
    "UPDATE users SET role='supervisor' WHERE role='cierre'",
    "ALTER TABLE equipment ALTER COLUMN location_id DROP NOT NULL",
    "ALTER TABLE equipment ALTER COLUMN zone DROP NOT NULL",
    "ALTER TABLE findings ADD COLUMN IF NOT EXISTS finding_type TEXT",
    "CREATE TABLE IF NOT EXISTS finding_types(id SERIAL PRIMARY KEY, name TEXT NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_ft_name ON finding_types(lower(name))",
    "ALTER TABLE finding_types ADD COLUMN IF NOT EXISTS pos INT",
    "UPDATE finding_types SET pos=id WHERE pos IS NULL",
    "CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)",
    "ALTER TABLE findings ADD COLUMN IF NOT EXISTS ot TEXT",
    "CREATE INDEX IF NOT EXISTS ix_f ON findings(status, criticality, zone, location_id)",
    "CREATE INDEX IF NOT EXISTS ix_p ON photos(finding_id)",
]
_ready = False


def sync_areas():
    """Asegura las áreas configuradas sin modificar ni eliminar datos existentes."""
    try:
        run("CREATE UNIQUE INDEX IF NOT EXISTS ux_loc_name ON locations(name)")
    except psycopg.errors.UniqueViolation:
        pass
    for n in AREAS:
        run("INSERT INTO locations(name) SELECT %s WHERE NOT EXISTS (SELECT 1 FROM locations WHERE name=%s)", n, n)


def seed_types():
    """Carga los tipos de hallazgo iniciales una única vez (luego el administrador los gestiona)."""
    if run("INSERT INTO meta(key,value) VALUES('types_seeded','1') ON CONFLICT DO NOTHING RETURNING key").fetchone():
        for n in DEFAULT_TYPES:
            run("INSERT INTO finding_types(name,pos) SELECT %s, COALESCE(MAX(pos), 0) + 1 FROM finding_types ON CONFLICT DO NOTHING", n)


def db():
    if "db" not in g:
        g.db = psycopg.connect(URL, row_factory=dict_row, autocommit=True, prepare_threshold=None)
    return g.db


@app.teardown_appcontext
def close_db(_):
    d = g.pop("db", None)
    if d:
        d.close()


def rows(sql, *p):
    return db().execute(sql, p).fetchall()


def one(sql, *p):
    r = db().execute(sql, p).fetchone()
    if r is None:
        abort(404)
    return r


def run(sql, *p):
    return db().execute(sql, p)


def dt(s):
    try:
        return date.fromisoformat(s)
    except (TypeError, ValueError):
        return date.today()


def has_users():
    return db().execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None


def locs():
    r = rows("SELECT id, name FROM locations ORDER BY array_position(%s::text[], name), name", AREAS)
    return [(x["id"], x["name"], 1) for x in r], {x["id"]: x["name"] for x in r}


def equipment_list():
    return rows("SELECT e.*, l.name area FROM equipment e LEFT JOIN locations l ON l.id=e.location_id ORDER BY lower(e.tag)")


def types_list():
    return rows("SELECT id, name FROM finding_types ORDER BY pos, id")


def jpeg_under(im, limit=300 * 1024):
    """Guarda la imagen como JPEG de hasta `limit` bytes bajando calidad y, si hace falta, tamaño."""
    q = 82
    while True:
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q, optimize=True)
        if buf.tell() <= limit or min(im.size) <= 320:
            return buf.getvalue()
        if q > 45:
            q -= 8
        else:
            im = im.resize((int(im.width * .85), int(im.height * .85)), Image.LANCZOS)


def add_photos(fid, kind, tbl="photos", col="finding_id", field="photos"):
    n = 0
    for f in request.files.getlist(field):
        if not f.filename:
            continue
        try:
            im = ImageOps.exif_transpose(Image.open(f.stream)).convert("RGB")
            im.thumbnail((1600, 1600))
        except Exception:
            g.setdefault("warns", []).append(f.filename)
            continue
        buf = io.BytesIO()
        buf.write(jpeg_under(im))
        run("INSERT INTO %s(%s,kind,data,created_at) VALUES(%%s,%%s,%%s,%%s)" % (tbl, col),
            fid, kind, buf.getvalue(), date.today())
        n += 1
    return n


def findings():
    a, w, p = request.args, [], []
    if a.get("loc", "").isdigit():
        w.append("f.location_id=%s")
        p.append(int(a["loc"]))
    if a.get("overdue"):
        w.append("f.status='pendiente' AND CURRENT_DATE - f.inspected_at > 30")
    for k, col in (("zone", "zone"), ("crit", "criticality"), ("status", "status")):
        if a.get(k):
            w.append("f.%s=%%s" % col)
            p.append(a[k])
    if a.get("q"):
        w.append("(f.tag ILIKE %s OR f.description ILIKE %s OR f.resolution ILIKE %s OR f.ot ILIKE %s)")
        p += ["%" + a["q"] + "%"] * 4
    sql = ("SELECT f.*, COALESCE(u.name, f.inspector_name, 'Usuario eliminado') inspector, "
           "CASE WHEN f.closed_at IS NOT NULL THEN COALESCE(c.name, f.closer_name, 'Usuario eliminado') END closer FROM findings f "
           "LEFT JOIN users u ON u.id=f.inspector_id LEFT JOIN users c ON c.id=f.closed_by"
           + (" WHERE " + " AND ".join(w) if w else "")
           + " ORDER BY f.status='solucionado', CASE f.criticality WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,"
             " f.inspected_at DESC, f.id DESC")
    return rows(sql, *p)


SYN = {"tag": {"tag", "tags", "equipo", "tagequipo", "tagoequipo", "codigo"},
       "description": {"descripcion", "description", "desc", "detalle", "nombre"},
       "area": {"area"}, "zone": {"zona", "zone"},
       "protection": {"proteccion", "proteccionex", "protection", "tipodeproteccion", "tipoproteccion", "ex"}}
PROT_BARE = {"d", "e", "i", "p", "n", "m", "o", "q", "t", "db", "eb", "ia", "ib", "ic", "ma", "mb", "tb"}
PROT_NA = {"", "na", "n a", "n/a", "otro", "otro / n.a.", "otro n a", "no aplica", "ninguna", "-"}
MAX_ROWS = 5000


def _norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def _key(s):
    return re.sub(r"[^a-z0-9]", "", _norm(s))


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def read_rows(f):
    name, raw = (f.filename or "").lower(), f.read()
    if name.endswith(".xlsx"):
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        out = [[_cell(c) for c in r] for r in wb.worksheets[0].iter_rows(values_only=True)]
        wb.close()
        return out
    if name.endswith((".csv", ".txt")):
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("cp1252")
        first = text.splitlines()[0] if text.strip() else ""
        d = max(";,\t", key=first.count)
        return [[c.strip() for c in r] for r in csv.reader(io.StringIO(text), delimiter=d)]
    raise ValueError("Formato no admitido. Subí un archivo .xlsx o .csv (si es .xls, guardalo como .xlsx).")


def norm_prot(v):
    """Devuelve (valor, advertencia)."""
    n = _norm(v)
    if n in PROT_NA:
        return (None if not n else "Otro / N.A."), False
    m = re.match(r"^ex\s*([deipnmoqt])", n)
    if m:
        return "Ex " + m.group(1), False
    if n in PROT_BARE:
        return "Ex " + n[0], False
    return "Otro / N.A.", True


def import_tags(f, save):
    rows_ = [(n, r) for n, r in enumerate(read_rows(f), 1) if any(r)]
    if not rows_:
        raise ValueError("La planilla está vacía.")
    cols = {"tag": 0, "description": 1, "area": 2, "zone": 3, "protection": 4}
    hdr = {}
    for ci, h in enumerate(rows_[0][1]):
        for name, keys in SYN.items():
            if _key(h) in keys and name not in hdr:
                hdr[name] = ci
    if "tag" in hdr:
        cols, rows_ = hdr, rows_[1:]
    if len(rows_) > MAX_ROWS:
        raise ValueError("La planilla tiene más de %d filas. Dividila en partes." % MAX_ROWS)
    amap = {_key(n): i for i, n, _ in locs()[0]}
    out, errs, warns, dups = {}, [], [], 0
    for n, r in rows_:
        g = lambda k: r[cols[k]].strip() if k in cols and cols[k] < len(r) else ""
        tag, desc, area, zone, prot = g("tag"), g("description"), g("area"), g("zone"), g("protection")
        if not tag:
            errs.append((n, "falta el tag"))
            continue
        loc = amap.get(_key(area)) if area else None
        if area and not loc:
            errs.append((n, "área «%s» no válida" % area))
            continue
        z = None
        if zone:
            z = ZMAP.get(re.sub(r"^(zona|zone|z)\s*", "", _norm(zone)).replace(" ", ""))
            if not z:
                errs.append((n, "zona «%s» no válida" % zone))
                continue
        p, w = norm_prot(prot)
        if w:
            warns.append((n, "protección «%s» no reconocida: se cargó como «Otro / N.A.»" % prot))
        k = tag.lower()
        if k in out:
            dups += 1
            o = out[k]
            o["tag"] = tag
            for key, val in (("loc", loc), ("zone", z), ("desc", desc), ("prot", p)):
                if val:
                    o[key] = val
        else:
            out[k] = dict(tag=tag, desc=desc, loc=loc, zone=z, prot=p)
    ex = {r["tag"].lower(): r for r in rows("SELECT * FROM equipment")}
    ins, upd, same = [], [], 0
    for k, o in out.items():
        e = ex.get(k)
        if not e:
            ins.append((o["tag"], o["desc"], o["loc"], o["zone"], o["prot"]))
            continue
        new = (o["tag"], o["desc"] or e["description"] or "", o["loc"] or e["location_id"], o["zone"] or e["zone"], o["prot"] or e["protection"])
        if new == (e["tag"], e["description"] or "", e["location_id"], e["zone"], e["protection"]):
            same += 1
        else:
            upd.append(new + (e["id"],))
    if save and (ins or upd):
        try:
            with db().transaction():
                cur = db().cursor()
                cur.executemany("INSERT INTO equipment(tag,description,location_id,zone,protection) VALUES(%s,%s,%s,%s,%s)", ins)
                cur.executemany("UPDATE equipment SET tag=%s, description=%s, location_id=%s, zone=%s, protection=%s WHERE id=%s", upd)
                cur.executemany("UPDATE findings SET tag=%s WHERE equipment_id=%s", [(u[0], u[5]) for u in upd])
        except psycopg.Error:
            app.logger.exception("import de tags")
            raise ValueError("No se pudo guardar y no se aplicó ningún cambio. Probá de nuevo.")
    return dict(saved=save, total=len(rows_), new=len(ins), updated=len(upd), same=same, dups=dups, errs=errs, warns=warns)


# ---------- respuestas, sesión y permisos ----------
def err(msg, code=400):
    return jsonify(error=msg), code


def need(role="tecnico"):
    def deco(fn):
        @wraps(fn)
        def w(*a, **k):
            if "uid" not in session:
                return err("Necesitás ingresar.", 401)
            if ROLES[session["role"]] < ROLES[role]:
                return err("No tenés permiso para esta acción.", 403)
            return fn(*a, **k)
        return w
    return deco


@app.before_request
def gate():
    global _ready
    if not URL:
        return err("Falta conectar la base de datos (variable DATABASE_URL). Ver el README.", 503)
    if not _ready:
        try:
            for s in SCHEMA:
                db().execute(s)
            for fn in (sync_areas, seed_types):
                fn()
        except psycopg.Error as e:
            app.logger.error("No se pudo inicializar la base de datos (%s)", type(e).__name__)
            return err("No se pudo preparar la base de datos. Revisá la conexión y los permisos del usuario de Neon.", 503)
        _ready = True
    session.setdefault("csrf", secrets.token_hex(16))
    if request.method not in ("GET", "HEAD", "OPTIONS") and not hmac.compare_digest(request.headers.get("X-CSRF-Token", ""), session["csrf"]):
        return err("La sesión venció. Recargá la página e intentá de nuevo.", 400)
    if "uid" in session:
        u = db().execute("SELECT role, active, name FROM users WHERE id=%s", (session["uid"],)).fetchone()
        if not u or not u["active"]:
            session.clear()
            session["csrf"] = secrets.token_hex(16)
            if request.endpoint != "me":
                return err("Necesitás ingresar.", 401)
        else:
            session["role"], session["name"] = u["role"], u["name"]


@app.errorhandler(413)
def too_big(_):
    return err("Las fotos pesan demasiado (máximo 4 MB por envío). Subí menos fotos a la vez.", 413)


@app.errorhandler(404)
def not_found(_):
    return err("No se encontró lo que buscabas.", 404)


@app.errorhandler(405)
def bad_method(_):
    return err("Operación no permitida.", 405)


@app.errorhandler(psycopg.Error)
def database_error(e):
    app.logger.error("Falló una operación de base de datos (%s)", type(e).__name__)
    return err("No se pudo completar la operación en la base de datos. Probá de nuevo.", 503)


@app.errorhandler(Exception)
def boom(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return err(e.description or "Error.", e.code or 500)
    app.logger.exception("error no controlado")
    return err("Ocurrió un error inesperado. Probá de nuevo.", 500)


def user_json():
    return {"id": session["uid"], "name": session["name"], "role": session["role"]} if "uid" in session else None


def meta():
    return dict(zones=ZONES, crit=CRIT, prot=PROT, other=OTHER, roles=ROLE_LABEL,
                areas=[{"id": i, "name": n, "color": AREA_COLORS[AREAS.index(n)] if n in AREAS else "#888888"} for i, n, _ in locs()[0]],
                types=[t["name"] for t in types_list()])


def body():
    return request.get_json(silent=True) or {}


def iso(d):
    return d.isoformat() if d else None


@app.get("/api/me")
def me():
    return jsonify(user=user_json(), csrf=session["csrf"], needsSetup=not has_users(), meta=meta())


@app.post("/api/setup")
def setup():
    if has_users():
        return err("La instalación ya se hizo.", 409)
    f = body()
    un, nm, pw = str(f.get("username", "")).strip().lower(), str(f.get("name", "")).strip(), str(f.get("password", ""))
    if not SETUP_KEY or not secrets.compare_digest(str(f.get("key", "")), SETUP_KEY):
        return err("Código de instalación incorrecto (es el valor de la variable SETUP_KEY en Vercel).", 403)
    if not un or not nm or len(pw) < 8:
        return err("Completá usuario y nombre. La contraseña debe tener al menos 8 caracteres.")
    run("INSERT INTO users(username,name,pw,role) VALUES(%s,%s,%s,'admin')", un, nm, generate_password_hash(pw))
    return jsonify(ok=True)


@app.post("/api/login")
def login():
    f = body()
    un = str(f.get("username", "")).strip().lower()
    if one("SELECT COUNT(*) n FROM attempts WHERE username=%s AND at > now() - interval '10 minutes'", un)["n"] >= 5:
        return err("Demasiados intentos fallidos. Esperá 10 minutos.", 429)
    u = db().execute("SELECT * FROM users WHERE username=%s", (un,)).fetchone()
    if u and u["active"] and check_password_hash(u["pw"], str(f.get("password", ""))):
        run("DELETE FROM attempts WHERE username=%s", un)
        session.clear()
        session.update(uid=u["id"], name=u["name"], role=u["role"], csrf=secrets.token_hex(16))
        return jsonify(user=user_json(), csrf=session["csrf"])
    run("INSERT INTO attempts(username) VALUES(%s)", un)
    return err("Usuario o contraseña incorrectos.", 401)


@app.post("/api/logout")
def logout():
    session.clear()
    session["csrf"] = secrets.token_hex(16)
    return jsonify(ok=True, csrf=session["csrf"])


@app.post("/api/password")
@need()
def password():
    f = body()
    u = one("SELECT username, pw FROM users WHERE id=%s", session["uid"])
    cur, new = str(f.get("current", "")), str(f.get("new", ""))
    if one("SELECT COUNT(*) n FROM attempts WHERE username=%s AND at > now() - interval '10 minutes'", u["username"])["n"] >= 5:
        return err("Demasiados intentos fallidos. Esperá 10 minutos.", 429)
    if not check_password_hash(u["pw"], cur):
        run("INSERT INTO attempts(username) VALUES(%s)", u["username"])
        return err("La contraseña actual no es correcta.")
    if len(new) < 8:
        return err("La contraseña nueva debe tener al menos 8 caracteres.")
    if new != str(f.get("repeat", "")):
        return err("Las contraseñas nuevas no coinciden.")
    if new == cur:
        return err("La contraseña nueva debe ser distinta de la actual.")
    run("UPDATE users SET pw=%s WHERE id=%s", generate_password_hash(new), session["uid"])
    run("DELETE FROM attempts WHERE username=%s", u["username"])
    return jsonify(ok=True)


# ---------- resumen ----------
@app.get("/api/dashboard")
@need()
def dashboard():
    st = {r["status"]: r["n"] for r in rows("SELECT status, COUNT(*) n FROM findings GROUP BY 1")}
    by_crit = {r["k"]: r["n"] for r in rows("SELECT criticality k, COUNT(*) n FROM findings WHERE status='pendiente' GROUP BY 1")}
    cnt = {r["location_id"]: r["n"] for r in rows("SELECT location_id, COUNT(*) n FROM findings WHERE status='pendiente' GROUP BY 1")}
    old = one("SELECT COUNT(*) n FROM findings WHERE status='pendiente' AND CURRENT_DATE - inspected_at > 30")["n"]
    ls, paths = locs()
    top = rows("SELECT id, tag, zone, criticality, location_id, inspected_at, description, ot FROM findings WHERE status='pendiente' "
               "ORDER BY CASE criticality WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, inspected_at LIMIT 8")
    return jsonify(pending=st.get("pendiente", 0), solved=st.get("solucionado", 0), overdue=old,
                   byCrit={c: by_crit.get(c, 0) for c in CRIT},
                   byArea=[{"id": i, "name": n, "color": AREA_COLORS[AREAS.index(n)] if n in AREAS else "#888888", "n": cnt.get(i, 0)} for i, n, _ in ls],
                   urgent=[{"id": r["id"], "tag": r["tag"] or "", "zone": r["zone"], "crit": r["criticality"], "area": paths.get(r["location_id"], ""),
                            "date": iso(r["inspected_at"]), "description": r["description"], "ot": r["ot"] or ""} for r in top])


# ---------- hallazgos ----------
def fjson(f, paths):
    return dict(id=f["id"], tag=f["tag"] or "", equipmentId=f["equipment_id"], areaId=f["location_id"], area=paths.get(f["location_id"], ""),
                zone=f["zone"], protection=f["protection"], crit=f["criticality"], status=f["status"], type=f["finding_type"],
                description=f["description"], ot=f["ot"] or "", date=iso(f["inspected_at"]), inspector=f["inspector"], closer=f["closer"],
                closedAt=iso(f["closed_at"]), resolution=f["resolution"])


def photo_ids(table, col, fid):
    out = {"antes": [], "despues": []}
    for p in rows("SELECT id, kind FROM %s WHERE %s=%%s ORDER BY id" % (table, col), fid):
        out[p["kind"]].append(p["id"])
    return out


def get_finding(fid):
    rs = [f for f in findings_by_id(fid)]
    if not rs:
        abort(404)
    return rs[0]


def findings_by_id(fid):
    return rows("SELECT f.*, COALESCE(u.name, f.inspector_name, 'Usuario eliminado') inspector, "
                "CASE WHEN f.closed_at IS NOT NULL THEN COALESCE(c.name, f.closer_name, 'Usuario eliminado') END closer FROM findings f "
                "LEFT JOIN users u ON u.id=f.inspector_id LEFT JOIN users c ON c.id=f.closed_by WHERE f.id=%s", fid)


@app.get("/api/findings")
@need()
def findings_list():
    paths = locs()[1]
    items = findings()
    return jsonify(total=len(items), items=[fjson(f, paths) for f in items[:1000]])


@app.get("/api/findings/export.xlsx")
@need()
def findings_export():
    paths = locs()[1]
    wb = Workbook()
    ws = wb.active
    ws.title = "Hallazgos"
    ws.append(["ID", "Área", "TAG / equipo", "Zona", "Protección Ex", "Criticidad", "Estado", "Tipo de hallazgo", "Descripción", "N° de OT",
               "Inspector", "Fecha inspección", "Resolución", "Cerrado por", "Fecha cierre", "Fotos antes", "Fotos después"])
    cnt = {(r["finding_id"], r["kind"]): r["n"] for r in rows("SELECT finding_id, kind, COUNT(*) n FROM photos GROUP BY 1, 2")}
    for f in findings():
        ws.append([f["id"], paths.get(f["location_id"]), f["tag"], f["zone"], f["protection"], f["criticality"], f["status"], f["finding_type"],
                   f["description"], f["ot"], f["inspector"], f["inspected_at"], f["resolution"], f["closer"], f["closed_at"],
                   cnt.get((f["id"], "antes"), 0), cnt.get((f["id"], "despues"), 0)])
    for col, wd in zip("ABCDEFGHIJKLMNOPQ", (6, 18, 18, 8, 12, 10, 12, 26, 60, 14, 20, 14, 50, 20, 13, 11, 13)):
        ws.column_dimensions[col].width = wd
    ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="hallazgos_%s.xlsx" % date.today(),
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def read_finding(f, fd=None):
    """Valida los datos del formulario de un hallazgo. Devuelve (valores, error)."""
    sel = f.get("equipment_id", "")
    eq = db().execute("SELECT * FROM equipment WHERE id=%s", (int(sel),)).fetchone() if sel.isdigit() else None
    if sel == "keep" and fd:
        tag, eqid, prot = fd["tag"], fd["equipment_id"], fd["protection"]
    else:
        tag, eqid, prot = (eq["tag"], eq["id"], eq["protection"]) if eq else ("", None, None)
    loc = f.get("location_id") or (str(eq["location_id"]) if eq and eq["location_id"] else "")
    zone = f.get("zone") or (eq["zone"] if eq else None)
    ft, other = f.get("finding_type", ""), f.get("other_text", "").strip()
    names = [t["name"] for t in types_list()]
    extra = fd["finding_type"] if fd and fd["finding_type"] and fd["finding_type"] not in names and fd["finding_type"] != OTHER else None
    desc = other if ft == OTHER else ft
    if ft == OTHER and not other:
        return None, "Describí el problema encontrado."
    if not (loc.isdigit() and zone in ZONES and f.get("criticality") in CRIT and desc and (ft == OTHER or ft in names or ft == extra)):
        return None, "Completá área, zona, criticidad y qué se encontró."
    return dict(loc=int(loc), tag=tag, eqid=eqid, zone=zone, prot=prot, crit=f["criticality"], desc=desc, ft=ft,
                date=dt(f.get("inspected_at")), ot=f.get("ot", "").strip() or None), None


@app.post("/api/findings")
@need()
def finding_create():
    v, e = read_finding(request.form)
    if e:
        return err(e)
    r = run("INSERT INTO findings(location_id,tag,equipment_id,zone,protection,criticality,description,finding_type,inspector_id,inspector_name,inspected_at,ot)"
            " VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id", v["loc"], v["tag"], v["eqid"], v["zone"], v["prot"], v["crit"], v["desc"],
            v["ft"], session["uid"], session["name"], v["date"], v["ot"]).fetchone()
    add_photos(r["id"], "antes")
    return jsonify(ok=True, id=r["id"])


@app.get("/api/findings/<int:fid>")
@need()
def finding_get(fid):
    f = get_finding(fid)
    d = fjson(f, locs()[1])
    d["photos"] = photo_ids("photos", "finding_id", fid)
    return jsonify(d)


@app.put("/api/findings/<int:fid>")
@need()
def finding_update(fid):
    fd = get_finding(fid)
    if fd["status"] != "pendiente":
        return err("Un hallazgo solucionado no se puede editar. Podés editar la reparación o reabrirlo.", 409)
    v, e = read_finding(request.form, fd)
    if e:
        return err(e)
    run("UPDATE findings SET location_id=%s, tag=%s, equipment_id=%s, zone=%s, protection=%s, criticality=%s, description=%s, finding_type=%s, "
        "inspected_at=%s, ot=%s WHERE id=%s AND status='pendiente'", v["loc"], v["tag"], v["eqid"], v["zone"], v["prot"], v["crit"], v["desc"],
        v["ft"], v["date"], v["ot"], fid)
    add_photos(fid, "antes")
    return jsonify(ok=True)


def closing_values(fd):
    f = request.form
    res, ot = f.get("resolution", "").strip(), f.get("ot", "").strip() or (fd["ot"] or "")
    if not res:
        return None, "Describí qué se reparó o cambió."
    if not ot:
        return None, "Cargá el N° de OT para poder cerrar el hallazgo."
    return (res, ot, dt(f.get("closed_at"))), None


@app.post("/api/findings/<int:fid>/close")
@need()
def finding_close(fid):
    fd = get_finding(fid)
    if fd["status"] != "pendiente":
        return err("El hallazgo ya está solucionado.", 409)
    v, e = closing_values(fd)
    if e:
        return err(e)
    run("UPDATE findings SET status='solucionado', resolution=%s, ot=%s, closed_by=%s, closer_name=%s, closed_at=%s WHERE id=%s",
        v[0], v[1], session["uid"], session["name"], v[2], fid)
    add_photos(fid, "despues")
    return jsonify(ok=True)


@app.post("/api/findings/<int:fid>/repair")
@need()
def finding_repair(fid):
    fd = get_finding(fid)
    if fd["status"] != "solucionado":
        return err("Solo se puede editar la reparación de un hallazgo solucionado.", 409)
    v, e = closing_values(fd)
    if e:
        return err(e)
    run("UPDATE findings SET resolution=%s, ot=%s, closed_at=%s WHERE id=%s AND status='solucionado'", v[0], v[1], v[2], fid)
    add_photos(fid, "despues")
    return jsonify(ok=True)


@app.post("/api/findings/<int:fid>/reopen")
@need()
def finding_reopen(fid):
    one("SELECT 1 FROM findings WHERE id=%s", fid)
    run("UPDATE findings SET status='pendiente', resolution=NULL, closed_by=NULL, closer_name=NULL, closed_at=NULL WHERE id=%s", fid)
    return jsonify(ok=True)


@app.post("/api/findings/<int:fid>/photos")
@need()
def finding_photos_add(fid):
    one("SELECT 1 FROM findings WHERE id=%s", fid)
    kind = request.form.get("kind")
    if kind not in ("antes", "despues"):
        return err("Tipo de foto inválido.")
    n = add_photos(fid, kind)
    return jsonify(ok=True, added=n) if n else err("No se agregó ninguna foto.")


@app.delete("/api/findings/<int:fid>/photos/<int:pid>")
@need()
def finding_photo_delete(fid, pid):
    fd = one("SELECT status FROM findings WHERE id=%s", fid)
    p = one("SELECT kind FROM photos WHERE id=%s AND finding_id=%s", pid, fid)
    if (p["kind"] == "antes" and fd["status"] != "pendiente") or (p["kind"] == "despues" and fd["status"] != "solucionado"):
        return err("No se pueden quitar estas fotos en el estado actual del hallazgo.", 409)
    run("DELETE FROM photos WHERE id=%s", pid)
    return jsonify(ok=True)


def image_response(table, pid):
    r = one("SELECT data FROM %s WHERE id=%%s" % table, pid)
    resp = send_file(io.BytesIO(r["data"]), mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "private, max-age=86400"
    return resp


@app.get("/api/photos/<int:pid>")
@need()
def photo_file(pid):
    return image_response("photos", pid)


@app.get("/api/dphotos/<int:pid>")
@need()
def dphoto_file(pid):
    return image_response("declass_photos", pid)


# ---------- tags de equipos ----------
def eq_json(e):
    return dict(id=e["id"], tag=e["tag"], description=e["description"] or "", areaId=e["location_id"], area=e.get("area"), zone=e["zone"],
                protection=e["protection"], nf=e.get("nf", 0))


def eq_fields(f):
    tag, loc, zone, prot = str(f.get("tag") or "").strip(), str(f.get("areaId") or ""), str(f.get("zone") or ""), f.get("protection")
    if not tag or (loc and not loc.isdigit()) or (zone and zone not in ZONES):
        return None
    return tag, str(f.get("description") or "").strip(), int(loc) if loc else None, zone or None, prot if prot in PROT else None


@app.get("/api/equipment")
@need()
def equipment_get():
    q = request.args.get("q", "").strip()
    items = rows("SELECT e.*, l.name area, (SELECT COUNT(*) FROM findings f WHERE f.equipment_id=e.id) nf FROM equipment e "
                 "LEFT JOIN locations l ON l.id=e.location_id WHERE (%s='' OR e.tag ILIKE %s OR e.description ILIKE %s OR l.name ILIKE %s) "
                 "ORDER BY lower(e.tag)", q, "%" + q + "%", "%" + q + "%", "%" + q + "%")
    return jsonify(items=[eq_json(e) for e in items])


@app.post("/api/equipment")
@need("supervisor")
def equipment_create():
    v = eq_fields(body())
    if not v:
        return err("Escribí el tag.")
    try:
        r = run("INSERT INTO equipment(tag,description,location_id,zone,protection) VALUES(%s,%s,%s,%s,%s) RETURNING id", *v).fetchone()
    except psycopg.errors.UniqueViolation:
        return err("Ya existe un tag con ese nombre.", 409)
    except psycopg.errors.ForeignKeyViolation:
        return err("El área elegida no existe.")
    return jsonify(ok=True, id=r["id"])


@app.put("/api/equipment/<int:eid>")
@need("supervisor")
def equipment_update(eid):
    one("SELECT 1 FROM equipment WHERE id=%s", eid)
    v = eq_fields(body())
    if not v:
        return err("Escribí el tag.")
    try:
        run("UPDATE equipment SET tag=%s, description=%s, location_id=%s, zone=%s, protection=%s WHERE id=%s", *v, eid)
        run("UPDATE findings SET tag=%s WHERE equipment_id=%s", v[0], eid)
    except psycopg.errors.UniqueViolation:
        return err("Ya existe otro tag con ese nombre.", 409)
    except psycopg.errors.ForeignKeyViolation:
        return err("El área elegida no existe.")
    return jsonify(ok=True)


@app.delete("/api/equipment/<int:eid>")
@need("supervisor")
def equipment_remove(eid):
    one("SELECT 1 FROM equipment WHERE id=%s", eid)
    run("DELETE FROM equipment WHERE id=%s", eid)
    return jsonify(ok=True)


@app.post("/api/equipment/import")
@need("admin")
def equipment_import():
    f = request.files.get("file")
    if not f or not f.filename:
        return err("Elegí un archivo .xlsx o .csv.")
    try:
        return jsonify(import_tags(f, request.form.get("mode") == "import"))
    except ValueError as e:
        return err(str(e))
    except Exception:
        app.logger.exception("lectura de planilla")
        return err("No se pudo leer el archivo. Verificá que sea un .xlsx o .csv válido.")


@app.get("/api/equipment/template.xlsx")
@need("admin")
def equipment_template():
    wb = Workbook()
    ws = wb.active
    ws.title = "Tags"
    ws.append(["Tag", "Descripción", "Área", "Zona", "Protección Ex"])
    ws.append(["TB-12", "Tablero de fuerza", AREAS[0], "1", "Ex d"])
    for col, wd in zip("ABCDE", (16, 40, 16, 8, 14)):
        ws.column_dimensions[col].width = wd
    v = wb.create_sheet("Valores válidos")
    v.append(["Áreas", "Zonas", "Protección Ex"])
    for i in range(max(len(AREAS), len(ZONES), len(PROT))):
        v.append([AREAS[i] if i < len(AREAS) else None, ZONES[i] if i < len(ZONES) else None, PROT[i] if i < len(PROT) else None])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="planilla_tags.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ---------- desclasificaciones ----------
@app.get("/api/declass")
@need()
def declass_list():
    a, w, p = request.args, [], []
    if a.get("loc", "").isdigit():
        w.append("d.location_id=%s")
        p.append(int(a["loc"]))
    if a.get("q"):
        w.append("(d.reason ILIKE %s OR d.description ILIKE %s OR d.responsible ILIKE %s OR EXISTS "
                 "(SELECT 1 FROM declass_tags t WHERE t.declass_id=d.id AND t.tag ILIKE %s))")
        p += ["%" + a["q"] + "%"] * 4
    items = rows("SELECT d.*, l.name area, (SELECT string_agg(t.tag, ', ' ORDER BY t.tag) FROM declass_tags t WHERE t.declass_id=d.id) tags, "
                 "(SELECT COUNT(*) FROM declass_tags t WHERE t.declass_id=d.id) nt FROM declassifications d "
                 "JOIN locations l ON l.id=d.location_id" + (" WHERE " + " AND ".join(w) if w else "")
                 + " ORDER BY d.done_at DESC, d.id DESC", *p)
    return jsonify(items=[dict(id=d["id"], area=d["area"], areaId=d["location_id"], date=iso(d["done_at"]), responsible=d["responsible"],
                               reason=d["reason"], tags=d["tags"] or "", nt=d["nt"]) for d in items])


@app.post("/api/declass")
@need()
def declass_create():
    f = request.form
    ids = sorted({int(x) for x in f.getlist("equipment_id") if x.isdigit()})
    loc = f.get("location_id", "")
    reason, desc, resp = f.get("reason", "").strip(), f.get("description", "").strip(), f.get("responsible", "").strip()
    eqs = db().execute("SELECT id, tag, zone FROM equipment WHERE id = ANY(%s) AND location_id=%s", (ids, int(loc))).fetchall() if loc.isdigit() and ids else []
    if not (loc.isdigit() and reason and desc and resp):
        return err("Completá área, motivo, trabajo realizado y responsable.")
    if not eqs or len(eqs) != len(ids):
        return err("Elegí al menos un tag del área seleccionada.")
    with db().transaction():
        did = run("INSERT INTO declassifications(location_id,reason,description,done_at,responsible,created_by,set_safe) VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                  int(loc), reason, desc, dt(f.get("done_at")), resp, session["uid"], f.get("set_safe") in ("1", "true", "on")).fetchone()["id"]
        db().cursor().executemany("INSERT INTO declass_tags(declass_id,equipment_id,tag,prev_zone) VALUES(%s,%s,%s,%s)", [(did, e["id"], e["tag"], e["zone"]) for e in eqs])
        if f.get("set_safe") in ("1", "true", "on"):
            run("UPDATE equipment SET zone='Segura' WHERE id = ANY(%s)", [e["id"] for e in eqs])
    add_photos(did, "antes", "declass_photos", "declass_id", "photos_antes")
    add_photos(did, "despues", "declass_photos", "declass_id", "photos_despues")
    return jsonify(ok=True, id=did)


@app.get("/api/declass/<int:did>")
@need()
def declass_get(did):
    d = one("SELECT d.*, l.name area FROM declassifications d JOIN locations l ON l.id=d.location_id WHERE d.id=%s", did)
    return jsonify(id=d["id"], area=d["area"], areaId=d["location_id"], date=iso(d["done_at"]), responsible=d["responsible"], reason=d["reason"],
                   description=d["description"], setSafe=d["set_safe"], photos=photo_ids("declass_photos", "declass_id", did),
                   tags=[{"tag": t["tag"], "prevZone": t["prev_zone"]} for t in rows("SELECT * FROM declass_tags WHERE declass_id=%s ORDER BY tag", did)])


@app.post("/api/declass/<int:did>/photos")
@need()
def declass_photos_add(did):
    one("SELECT 1 FROM declassifications WHERE id=%s", did)
    kind = request.form.get("kind")
    if kind not in ("antes", "despues"):
        return err("Tipo de foto inválido.")
    n = add_photos(did, kind, "declass_photos", "declass_id")
    return jsonify(ok=True, added=n) if n else err("No se agregó ninguna foto.")


# ---------- áreas, tipos de hallazgo y usuarios (administrador) ----------
@app.get("/api/areas")
@need("admin")
def areas_list():
    return jsonify(items=[dict(id=a["id"], name=a["name"], color=AREA_COLORS[AREAS.index(a["name"])] if a["name"] in AREAS else "#888888",
                               tags=a["ne"], pending=a["np"], total=a["nf"]) for a in rows(
        "SELECT l.id, l.name, (SELECT COUNT(*) FROM equipment e WHERE e.location_id=l.id) ne, (SELECT COUNT(*) FROM findings f WHERE f.location_id=l.id) nf, "
        "(SELECT COUNT(*) FROM findings f WHERE f.location_id=l.id AND f.status='pendiente') np FROM locations l "
        "ORDER BY array_position(%s::text[], l.name), l.name", AREAS)])


def type_rows():
    return rows("SELECT t.id, t.name, (SELECT COUNT(*) FROM findings f WHERE f.finding_type=t.name) n FROM finding_types t ORDER BY t.pos, t.id")


@app.get("/api/types")
@need("admin")
def types_get():
    return jsonify(items=type_rows())


@app.post("/api/types")
@need("admin")
def types_create():
    name = str(body().get("name", "")).strip()
    if not name or _norm(name) == _norm(OTHER):
        return err("Escribí un nombre (distinto de «%s», que ya está siempre al final)." % OTHER)
    try:
        run("INSERT INTO finding_types(name,pos) SELECT %s, COALESCE(MAX(pos), 0) + 1 FROM finding_types", name)
    except psycopg.errors.UniqueViolation:
        return err("Ya existe un tipo con ese nombre.", 409)
    return jsonify(ok=True)


@app.put("/api/types/<int:tid>")
@need("admin")
def types_rename(tid):
    name = str(body().get("name", "")).strip()
    if not name or _norm(name) == _norm(OTHER):
        return err("Escribí un nombre (distinto de «%s», que ya está siempre al final)." % OTHER)
    old = one("SELECT name FROM finding_types WHERE id=%s", tid)["name"]
    try:
        run("UPDATE finding_types SET name=%s WHERE id=%s", name, tid)
        run("UPDATE findings SET finding_type=%s, description=%s WHERE finding_type=%s AND description=%s", name, name, old, old)
    except psycopg.errors.UniqueViolation:
        return err("Ya existe un tipo con ese nombre.", 409)
    return jsonify(ok=True)


@app.delete("/api/types/<int:tid>")
@need("admin")
def types_delete(tid):
    run("DELETE FROM finding_types WHERE id=%s", tid)
    return jsonify(ok=True)


@app.post("/api/types/<int:tid>/move")
@need("admin")
def types_move(tid):
    act = body().get("dir")
    ids = [r["id"] for r in rows("SELECT id FROM finding_types ORDER BY pos, id")]
    if tid in ids and act in ("up", "down"):
        i = ids.index(tid)
        j = i - 1 if act == "up" else i + 1
        if 0 <= j < len(ids):
            ids[i], ids[j] = ids[j], ids[i]
        with db().transaction():
            db().cursor().executemany("UPDATE finding_types SET pos=%s WHERE id=%s", [(n, x) for n, x in enumerate(ids, 1)])
    return jsonify(ok=True)


def user_row(u):
    return dict(id=u["id"], username=u["username"], name=u["name"], role=u["role"], active=u["active"], nf=u.get("nf", 0))


@app.get("/api/users")
@need("admin")
def users_get():
    return jsonify(items=[user_row(u) for u in rows(
        "SELECT u.*, (SELECT COUNT(*) FROM findings f WHERE f.inspector_id=u.id) nf FROM users u ORDER BY lower(u.username)")])


@app.post("/api/users")
@need("admin")
def users_create():
    f = body()
    un, nm, role, pw = str(f.get("username", "")).strip().lower(), str(f.get("name", "")).strip(), f.get("role"), str(f.get("password", ""))
    if not un or not nm or role not in ROLES or len(pw) < 8:
        return err("Usuario, nombre y rol son obligatorios; la contraseña debe tener al menos 8 caracteres.")
    try:
        run("INSERT INTO users(username,name,pw,role) VALUES(%s,%s,%s,%s)", un, nm, generate_password_hash(pw), role)
    except psycopg.errors.UniqueViolation:
        return err("Ya existe un usuario con ese nombre de usuario.", 409)
    return jsonify(ok=True)


@app.put("/api/users/<int:uid>")
@need("admin")
def users_update(uid):
    one("SELECT 1 FROM users WHERE id=%s", uid)
    f = body()
    un, nm, role, pw = str(f.get("username", "")).strip().lower(), str(f.get("name", "")).strip(), f.get("role"), str(f.get("password", ""))
    active = bool(f.get("active"))
    if uid == session["uid"]:
        role, active = "admin", True
    if not un or not nm or role not in ROLES or (pw and len(pw) < 8):
        return err("Usuario, nombre y rol son obligatorios; la contraseña nueva debe tener al menos 8 caracteres.")
    try:
        run("UPDATE users SET username=%s, name=%s, role=%s, active=%s WHERE id=%s", un, nm, role, active, uid)
    except psycopg.errors.UniqueViolation:
        return err("Ya existe otro usuario con ese nombre de usuario.", 409)
    run("UPDATE findings SET inspector_name=%s WHERE inspector_id=%s", nm, uid)
    run("UPDATE findings SET closer_name=%s WHERE closed_by=%s", nm, uid)
    if pw:
        run("UPDATE users SET pw=%s WHERE id=%s", generate_password_hash(pw), uid)
        run("DELETE FROM attempts WHERE username=%s", un)
    return jsonify(ok=True)


@app.delete("/api/users/<int:uid>")
@need("admin")
def users_delete(uid):
    if uid == session["uid"]:
        return err("No podés eliminar tu propio usuario.", 409)
    u = one("SELECT username FROM users WHERE id=%s", uid)
    run("DELETE FROM attempts WHERE username=%s", u["username"])
    run("DELETE FROM users WHERE id=%s", uid)
    return jsonify(ok=True)
