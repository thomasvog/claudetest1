# Inspecciones HAZLOC · Petrocuyo (frontend React + backend API)

Un solo repositorio y un solo proyecto de Vercel con dos partes:

- **Frontend** (`index.html`, `src/`, `public/`): aplicación React hecha con Vite. Vercel la compila sola.
- **Backend** (`api/index.py`): API JSON en Flask que corre como función de Python en Vercel. Toda la lógica y los permisos están ahí.
- **Base de datos:** la misma de Neon (Postgres) que ya usás. El backend crea o actualiza las tablas al arrancar, y los datos existentes se conservan.

El frontend y la API comparten el mismo dominio, así que no hay que configurar CORS ni claves extra.

## Estructura

    index.html              entrada del frontend
    package.json            dependencias del frontend (React, React Router, Vite)
    package-lock.json
    vite.config.js
    vercel.json             envía /api/* al backend y el resto a la aplicación React
    requirements.txt        dependencias del backend (Flask, psycopg, Pillow, openpyxl)
    api/index.py            backend
    public/logo.png         logo de la barra superior
    src/                    pantallas y componentes de React

## Puesta en marcha (todo desde el navegador)

Conviene crear un repositorio y un proyecto de Vercel **nuevos**, y dejar el anterior como respaldo hasta que todo funcione.

1. **GitHub:** crear un repositorio nuevo. En *Add file › Upload files*, arrastrar **el contenido** de la carpeta descomprimida (los archivos y las carpetas `api`, `public` y `src`) y confirmar con *Commit changes*. Comprobar después, en la página del repositorio, que se vean las carpetas `api`, `public` y `src`.
2. **Vercel:** *Add New › Project*, importar el repositorio. Vercel detecta **Vite** solo: no hay que cambiar nada en *Build and Output Settings*.
3. **Variables de entorno:** antes del primer deploy, en *Settings › Environment Variables*, configurar `DATABASE_URL` con la URL pooled de Neon (host que incluye `-pooler` y `sslmode=require`) y `SECRET_KEY` con un valor aleatorio largo y estable. Si la base está vacía, configurar también `SETUP_KEY` temporal para crear el primer administrador. Aplicarlas al entorno de producción (y a Preview solo si se usa una base separada).
4. **Base de datos:** en el proyecto, pestaña *Storage*, conectar la base de Neon que ya existe (o copiar `DATABASE_URL` desde *Settings › Environment Variables* del proyecto anterior y agregarla en el nuevo). No pegar credenciales en el código ni en el repositorio.
5. **Deploy:** presionar *Deploy*. Después de agregar o modificar variables en un proyecto ya desplegado, usar *Deployments* › menú ⋯ del último despliegue › *Redeploy*.
6. Abrir la URL del proyecto e ingresar con los usuarios que ya existen.

Si se usa una base de Neon **nueva y vacía**, `SETUP_KEY` debe estar definido. La primera vez, la aplicación pide ese código para crear el administrador.

## Qué hace la API

Todas las rutas empiezan con `/api/`. Las que modifican datos exigen el encabezado `X-CSRF-Token` (el frontend lo envía solo) y una sesión iniciada.

- Sesión: `GET /me`, `POST /login`, `POST /logout`, `POST /setup`, `POST /password`.
- Resumen: `GET /dashboard`.
- Hallazgos: `GET/POST /findings`, `GET/PUT /findings/<id>`, `DELETE /findings/<id>` (solo administrador), `POST /findings/<id>/close|repair|reopen|photos`, `DELETE /findings/<id>/photos/<foto>`, `GET /findings/export.xlsx`, `GET /photos/<foto>`.
- Tags: `GET/POST /equipment`, `PUT/DELETE /equipment/<id>`, `POST /equipment/import`, `GET /equipment/template.xlsx`.
- Desclasificaciones: `GET/POST /declass`, `GET /declass/<id>`, `POST /declass/<id>/photos`, `GET /dphotos/<foto>`.
- Administración: `/areas`, `/types` (con `POST /types/<id>/move`), `/users`.
- Informes (supervisor y administrador): `GET /reports/pending.pdf`, `GET /reports/solved.pdf`, `GET /reports/executive.pdf`; admiten `period=month&year=2026&month=10` o `period=year&year=2026`. Pendientes y KPIs se filtran por fecha de detección; solucionados, por fecha de cierre. El administrador también puede descargar `GET /reports/ot.xlsx`, una columna con los números de OT de los hallazgos filtrados por fecha de inspección. Sin parámetros, se conserva el informe histórico completo. Informe individual solucionado: `GET /reports/findings/<id>.pdf`.

## Informes y situación de seguridad

- Los informes se generan en el servidor con ReportLab y se entregan como `application/pdf`; los informes generales usan datos consultados en una transacción de solo lectura.
- `vercel.json` incluye explícitamente `public/logo.png` en el paquete de la función Python para que el encabezado PDF conserve el logo al desplegar.
- El informe individual de un hallazgo solucionado es A4 de una página. Incluye hasta cuatro miniaturas fotográficas; si hay más, el documento informa cuántas quedaron fuera para preservar la legibilidad.
- El informe ejecutivo presenta cuatro indicadores destacados, una tabla de hallazgos por área y estado, y una síntesis dinámica de criticidad y antigüedad. Sus cifras se calculan desde los registros actuales; incluye una aclaración de que el resumen no acredita por sí solo inspecciones, pruebas funcionales ni conformidad normativa.
- El dashboard inicia con la tarjeta institucional, presenta una alerta de pendientes de más de 30 días (o una confirmación discreta sin atrasos), cuatro indicadores y filtros por criticidad; todos los conteos de hallazgos provienen de consultas a Neon.
- El esquema actual no registra inspecciones independientes, así que el total de inspecciones no puede inferirse con seguridad del total de hallazgos y se muestra como no disponible.
- El listado de hallazgos recupera únicamente IDs de fotos; las miniaturas y la galería reutilizan `/api/photos/<id>`, que mantiene la autenticación existente.

## Reglas importantes

- **N° de OT:** es opcional al cargar o editar un hallazgo y **obligatorio para cerrarlo** (también al editar la reparación).
- **Equipos genéricos:** los tags MAC BAGGING, MAC EXTRUS, MAC POLIMERO, MAC SERVICIO y MAC UNID 500 permiten indicar el tipo de elemento (Caja de derivación, Instrumento, Junction Box o Luminaria) y su ubicación aproximada en planta al cargar un hallazgo.
- Roles: Técnico (carga, edita, cierra y reabre hallazgos; registra desclasificaciones), Supervisor (además administra tags) y Administrador (además usuarios, áreas, tipos de hallazgo, importación de tags y eliminación de hallazgos).
- Fotos: el navegador las reduce y el servidor las comprime a 300 KB como máximo; cada envío admite hasta 4 MB (límite de Vercel).
- Las áreas son fijas y están en la constante `AREAS` de `api/index.py`.

## Si algo falla

- *«Falta conectar la base de datos»*: falta la variable `DATABASE_URL` en el proyecto; revisar el paso 3 y hacer Redeploy.
- Pantalla en blanco o error 404 en `/api/...`: revisar que en el repositorio estén `vercel.json` y la carpeta `api` en la raíz.
- Error 500: en Vercel, pestaña *Logs*, filtrar por *Errors* y copiar la última línea.

## Desarrollo local (opcional)

    npm install && npm run dev        # frontend en http://localhost:5173
    pip install -r requirements.txt && DATABASE_URL=... flask --app api/index run --port 5000
