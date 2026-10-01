# Despliegue de la API en Railway

La API es un servicio Node del monorepo, y Railway la construye desde la raíz del
repositorio con el `Dockerfile` de la raíz. No hay `railway.json`: toda la
configuración son variables de entorno, y por eso no hay nada que se pueda quedar
desincronizado en un fichero que nadie recuerda editar.

## Por qué la raíz del repo y no `apps/api`

El `Dockerfile` compila `packages/contracts` y `packages/config` antes que la API,
porque esbuild lee su `dist`, no su código fuente. Esos paquetes son hermanos de la
API en el monorepo, así que el contexto de build tiene que ser el repositorio
entero. Poner la raíz en `apps/api` rompería el build, y no por algo visible: esbuild
no falla, compila contra lo que encuentre.

## Los tres pasos

1. **New → Database → PostgreSQL** en un proyecto de Railway.
2. **New → Service → GitHub Repo**, el repo de la API, con:
   - **Root Directory**: `/` (o vacío)
   - **Builder**: `Dockerfile`
   - **Dockerfile Path**: `Dockerfile`
3. Las variables del servicio (abajo).

## Las variables, todas

Las que no llevan valor las genera el panel, y las de referencia `${{...}}` apuntan al
servicio de Postgres sin copiar la contraseña a ningún sitio.

| Variable | Valor | Por qué |
| --- | --- | --- |
| `NODE_ENV` | `production` | Sin esto el `.env` de desarrollo manda y la API acepta la base embebida |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | `env.ts` la exige en producción: el Postgres embebido está en memoria dentro del proceso |
| `DATABASE_SSL` | `false` | Por la red privada de Railway el tráfico no sale de Railway |
| `JWT_SECRET` | **generar** | 32 caracteres o más. Sin él el arranque falla |
| `WEB_ORIGIN` | `https://orbithub-app.jrz-labs.com` | Ver la sección siguiente: es de dónde salen los enlaces de los correos |
| `CORS_ORIGINS` | el origen de la web, ver abajo | Origen del export web. Varios separados por coma |
| `EMAIL_TRANSPORT` | `resend` | `console` está rechazado en producción por `env.ts` |
| `RESEND_API_KEY` | la clave (`re_...`) | `env.ts` comprueba prefijo y longitud al arrancar |
| `EMAIL_FROM` | `no-reply@jrz-labs.com` | |
| `GOOGLE_CLIENT_ID` | el de **web**, **entero** | Login con Google. Empieza por el número de proyecto y **copiarlo a medias da `invalid_client`** |
| `GOOGLE_CLIENT_SECRET` | el secreto de **web** | Nunca en la app, solo aquí |
| `TMDB_API_KEY` | la clave | Catálogo de películas y series |
| `GOOGLE_BOOKS_API_KEY` | la clave | Catálogo de libros |
| `GOOGLE_BOOKS_SEARCH_ENGINE_ID` | el id | Búsqueda de libros |
| `STORAGE_DRIVER` | `s3` cuando haya bucket | `local` está rechazado en producción |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | cuando toque | Los cuatro, o el arranque falla |
| `PORT` | **no ponerla** | Railway la inyecta y espera que el proceso escuche en ella |
| `RUN_MIGRATIONS_ON_BOOT` | **no ponerla** | Por defecto las migraciones se aplican al arrancar |

**Sobre Google en nativo.** `GOOGLE_IOS_CLIENT_ID` y `GOOGLE_ANDROID_CLIENT_ID` son
**públicos y sin secreto**: Google rechaza un cliente web en una app instalada. Son
opcionales y solo hacen falta cuando existan los clientes de móvil. El par web es el que
decide si el botón está activo, y con él puesto el login funciona en web y también en
nativo —allí el móvil manda el `code_verifier` en lugar de un secreto—, pero Google pide
un cliente por plataforma para las stores.

`PUSHER_*` está en el `.env` local para el realtime de la Fase 5 y no se usa todavía.

## Qué es `WEB_ORIGIN` y cuál es

Es **el sitio donde se sirve la web**, no la API. Y solo se usa para una cosa: construir los
enlaces que van dentro de los correos. `email.ts` los compone así:

```
${WEB_ORIGIN}/verify-email?token=...
${WEB_ORIGIN}/reset-password?token=...
${WEB_ORIGIN}/invite/<token>
${WEB_ORIGIN}/shared
```

Con `WEB_ORIGIN=http://localhost:8081` —que es lo que hay ahora en el `.env` local— cada
correo de verificación que saliera de producción llevaría un enlace a localhost, y quien lo
recibe no podría activarse la cuenta. Es la variable más fácil de dejar mal y la más difícil
de notar desde el servidor: **el correo se envía sin errores y el enlace está roto**.

Son cuatro valores distintos y no se pueden confundir:

| Variable | Qué es | Valor |
| --- | --- | --- |
| `WEB_ORIGIN` | La web, en la API, para los correos | `https://orbithub-app.jrz-labs.com` |
| `EXPO_PUBLIC_WEB_ORIGIN` | La web, en la app | `https://orbithub-app.jrz-labs.com` |
| `EXPO_PUBLIC_API_URL` | La API, **con `/api/v1` al final** | `https://orbithub-api.jrz-labs.com/api/v1` |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | El client id de Google (es público) | el de la aplicación web |

Las cuatro `EXPO_PUBLIC_*` van en el **servicio web**, no en el de la API. Y no se pueden
cambiar sin redesplegar, porque van horneadas dentro del JavaScript en tiempo de build.

La web y la API son dos servicios con dos dominios. La alternativa —servirlas en el mismo
origen, con la API bajo `/api/v1` detrás del nginx de la web— quita CORS y los dos
certificados, a cambio de que el proxy tenga que aguantar también las subidas de adjuntos.

### Por qué el prefijo `/api/v1` es obligatorio

El router monta **todo** bajo `API_PREFIX`, y la app concatena las rutas encima de la base
en vez de encima del origen. Con la base en `https://orbithub-api.jrz-labs.com` la app pide
`https://orbithub-api.jrz-labs.com/auth/login`, que da **404** — y un 404 en una pantalla de
login se lee como "contraseña incorrecta", no como "dirección equivocada".

## CORS: qué origen se acepta

`CORS_ORIGINS` es una lista separada por comas, y tiene que incluir **el origen desde el que
se sirve la web**:

```
CORS_ORIGINS=https://orbithub-app.jrz-labs.com,https://<servicio-web>.up.railway.app
```

El segundo es el dominio de Railway, que sigue sirviendo la misma web. Con solo el dominio
propio, un navegador que abra la URL de Railway manda ese `Origin` y la API lo rechaza.

## Lo que comprueba el build de la web

`scripts/assert-export-env.mjs` corre dos veces en `Dockerfile.web`: antes del export y
**después, leyendo los ficheros del bundle**, porque "la variable estaba puesta" y "el
empaquetador la usó" son dos afirmaciones distintas y solo la segunda se despliega.

Las tres cosas que ha pillado, todas de la misma causa — *una variable de build que no llega
al `RUN` porque Docker no la entrega sin `ARG`*:

| Lo que faltaba | Cómo se manifestaba |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | La web cargaba y **no tenía a quién llamar**: todo iba a `localhost:4000` |
| El prefijo `/api/v1` | `404` en login, leído como contraseña incorrecta |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | Un **botón desactivado con su explicación debajo**, que además daba una causa que no era la real |

## Lo que ya está resuelto dentro de la imagen

- **Las migraciones se aplican solas.** `src/index.ts` las corre antes de escuchar, y
  la imagen lleva `apps/api/drizzle` entero, `_journal.json` incluido, que es lo que
  lee el migrador de Drizzle.
- **`pg_trgm` se crea solo.** La migración `0012` hace `CREATE EXTENSION IF NOT EXISTS`
  antes de sus índices, y el usuario `postgres` de Railway puede crear extensiones.
- **El bundle lleva dentro contracts y config**, así que la imagen de runtime no los
  necesita instalados.
- **`@node-rs/argon2` es nativo**, y la imagen es `node:22-slim` (glibc) a propósito:
  los binarios precompilados que trae son `linux-x64-gnu`, `linux-arm64-gnu` y los musl.

## Los adjuntos no sobreviven a un redeploy ⬜

**Es la deuda que queda abierta, y es deliberada.** `STORAGE_DRIVER=local` escribe en
`.data/attachments`, dentro del contenedor, y el disco de Railway es efímero: se borra
en cada redeploy. Una foto subida a una nota sobrevive hasta el siguiente despliegue y
después es un 404.

**El driver `s3` ya está escrito y probado** (`apps/api/src/modules/notes/storage.ts`): el
API no sirve los bytes, da una URL firmada y el fichero va del móvil al bucket. Lo único
que falta son cuatro variables y elegir dónde vive el bucket:

| Variable | Qué es |
| --- | --- |
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET` | El nombre del bucket |
| `S3_REGION` | Su región |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Credenciales con permiso de escritura |
| `S3_ENDPOINT` | Opcional; para un bucket que no es de AWS, como Cloudflare R2 |

**Por qué `local` en producción dejó de ser un error de arranque.** Era un
`superRefine` que rechazaba la configuración, y eso tenía la API entera caída —auth,
sync, listas, notas, todo— por una cosa que usa una parte de la app. Un servidor que no
arranca no se puede mirar, y uno que arranca con un aviso sí. Los ficheros se siguen
perdiendo: eso no se ha degradado, ha dejado de ser motivo para tener la API caída.

Ahora avisa al arrancar, y el aviso es el que dice qué arreglar:

```
attachments are being written to this container's disk, which a restart or redeploy erases
  driver: local   dir: .data/attachments
  fix: set STORAGE_DRIVER=s3 and the four S3_* variables
```

### La trampa de los permisos

El servidor corre como `node` (uid 1000) y **no** como root, y todo lo que escribe la
imagen se crea como root. Un directorio que el proceso necesite escribir tiene que ser
de `node` explícitamente: el `Dockerfile` lo hace para `/app/.data`, porque sin el
`chown` el arranque falla con `EACCES` —después de que la API ya escuche y el health
check ya responda, que es la parte incómoda: el despliegue parece bueno y falla en el
primer adjunto que suba alguien.

## Más de una réplica correría migraciones a la vez ⬜

Con una sola instancia no pasa nada. Si se sube el número de réplicas, poner
`RUN_MIGRATIONS_ON_BOOT=false` y correrlas como un paso aparte, o Drizzle se encuentra
con dos procesos aplicando la misma migración.

## Desplegar la web: segundo servicio

La web es **otro servicio**, con `Dockerfile.web` y nginx. No se sirve desde la API: es un
export estático de 94 ficheros y nada de Node en tiempo de ejecución.

**New → Service → GitHub Repo**, el mismo repo, con:

| Ajuste | Valor |
| --- | --- |
| Root Directory | `/` |
| Builder | `Dockerfile` |
| **Dockerfile Path** | **`Dockerfile.web`** |

Lo último es la única diferencia con el servicio de la API, y es lo que hay que mirar dos
veces: si se deja en `Dockerfile`, Railway despliega la API otra vez con otro nombre.

El servicio web **no lleva ninguna variable**. El export hornea `EXPO_PUBLIC_API_URL` en el
bundle en tiempo de build, así que la dirección de la API queda **dentro del JavaScript**:
cambiarla exige redesplegar la web, no basta con tocar una variable.

De ahí sale la consecuencia práctica: **el dominio de la API tiene que existir antes de
desplegar la web**. Si no, el bundle lleva una dirección que no responde y la app web abre
en blanco.

### Por qué `nginx.conf` existe

El export es **plano**: 21 `.html` en la raíz y ninguna carpeta. Un enlace directo a
`/workspaces` no encuentra nada, y la regla que lo arregla es:

```nginx
try_files $uri $uri.html $uri/index.html /index.html;
```

Esa segunda regla es también lo que hace que `/privacy` y `/terms` funcionen sin tocar
nada aquí: son dos `.html` más en la raíz, y por eso son URLs públicas de la web y no
rutas de la API.

El último `/index.html` es lo que hace que una ruta que no existe en build time —el id de
una nota, el de una carpeta— abra la app y la dibuje el router, en vez de dar un 404.

Además: los `.html` van con `no-cache` porque un despliegue nuevo cambia lo que hace
`/workspaces`, y los bundles con `immutable` porque llevan hash en el nombre. Y
`/service-worker.js` responde 404 a propósito hasta que exista el worker.

## Comprobar que todo está vivo

```bash
curl -fsS https://orbithub-api.jrz-labs.com/api/v1/health    # database.status == "ok"
curl -fsS https://orbithub-app.jrz-labs.com/workspaces      # 200, y el body es el HTML de la app
```

El health check abre la conexión a la base a propósito: si responde `ok` con
`driver: "postgres"`, el despliegue está talking de verdad con el Postgres de Railway
y no con la base embebida.