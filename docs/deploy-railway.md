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
| `WEB_ORIGIN` | `https://app.jrz-labs.com` | Ver la sección siguiente: es de dónde salen los enlaces de los correos |
| `CORS_ORIGINS` | `https://app.jrz-labs.com` | Origen del export web. Varios separados por coma |
| `EMAIL_TRANSPORT` | `resend` | `console` está rechazado en producción por `env.ts` |
| `RESEND_API_KEY` | la clave (`re_...`) | `env.ts` comprueba prefijo y longitud al arrancar |
| `EMAIL_FROM` | `no-reply@jrz-labs.com` | |
| `GOOGLE_CLIENT_ID` | el de **web** | Login con Google. Sin él `isGoogleConfigured()` es `false` y el botón sale desactivado |
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

Son tres valores distintos y no se pueden confundir:

| Variable | Qué es | Valor |
| --- | --- | --- |
| `WEB_ORIGIN` | La web, en la API, para los correos | `https://app.jrz-labs.com` |
| `EXPO_PUBLIC_WEB_ORIGIN` | La web, en la app | La PWA y la app web |
| `EXPO_PUBLIC_API_URL` | La API | `https://api.jrz-labs.com/api/v1` |

La web y la API son dos servicios con dos dominios. La alternativa —servirlas en el mismo
origen, con la API bajo `/api/v1` detrás del nginx de la web— quita CORS y los dos
certificados, a cambio de que el proxy tenga que aguantar también las subidas de adjuntos.

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

## Los dos cosas que no funcionan en Railway todavía

1. **Los adjuntos se pierden.** `STORAGE_DRIVER=local` escribe en `.data/attachments`,
   y el disco de un contenedor de Railway es efímero: se borra en cada redeploy. El
   driver `s3` ya existe y está implementado; lo que falta son las variables
   (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) y decidir el
   proveedor. Hasta entonces, las fotos de las notas se suben y desaparecen.
2. **Más de una réplica corre migraciones a la vez.** Con una sola instancia no pasa
   nada. Si se sube el número de réplicas, poner `RUN_MIGRATIONS_ON_BOOT=false` y
   correrlas como un paso aparte, o Drizzle se encuentra con dos procesos aplicando la
   misma migración.

La primera tiene una trampa que ya está resuelta en la imagen y conviene entender, porque
es fácil reintroducirla: el servidor corre como `node` (uid 1000) y **no** como root.
Todo lo que escribe la imagen se crea como root, así que un directorio que el proceso
necesite escribir tiene que ser de `node` explícitamente. El `Dockerfile` lo hace para
`/app/.data`, y sin eso el arranque falla con `EACCES` — después de que la API ya esté
escuchando y el health check ya responda, que es la parte incómoda: el despliegue parece
bueno y falla en el primer adjunto que suba alguien.

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

El export es **plano**: 19 `.html` en la raíz y ninguna carpeta. Un enlace directo a
`/workspaces` no encuentra nada, y la regla que lo arregla es:

```nginx
try_files $uri $uri.html $uri/index.html /index.html;
```

El último `/index.html` es lo que hace que una ruta que no existe en build time —el id de
una nota, el de una carpeta— abra la app y la dibuje el router, en vez de dar un 404.

Además: los `.html` van con `no-cache` porque un despliegue nuevo cambia lo que hace
`/workspaces`, y los bundles con `immutable` porque llevan hash en el nombre. Y
`/service-worker.js` responde 404 a propósito hasta que exista el worker.

## Comprobar que todo está vivo

```bash
curl -fsS https://api.jrz-labs.com/api/v1/health    # database.status == "ok"
curl -fsS https://app.jrz-labs.com/workspaces      # 200, y el body es el HTML de la app
```

El health check abre la conexión a la base a propósito: si responde `ok` con
`driver: "postgres"`, el despliegue está talking de verdad con el Postgres de Railway
y no con la base embebida.