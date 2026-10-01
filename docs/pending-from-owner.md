# Pendiente de decisiones y credenciales

Todo lo que necesito de ti para cerrar la Fase 1 y poder desplegar. Nada de esto bloquea el
desarrollo: la API funciona con valores de desarrollo y los tests no dependen de ningún servicio
externo.

Estado: ⬜ pendiente · 🟡 en curso · ✅ hecho

---

## 1. Identidad de los commits ✅ (ya está puesta)

`git config user.name` y `git config user.email` ya están configurados en este repositorio, y
el autor del último commit es el tuyo, no el provisional. No hay nada que reescribir.

Este punto llevaba en la lista desde el principio y se había quedado obsoleto: lo he
comprobado contra el repositorio en vez de fiarme de la nota.

---

## 2. Google OAuth 🟡 (claves puestas, falta un URI en la consola de Google)

El botón **ya está activo** y la app llega a Google: `EXPO_PUBLIC_GOOGLE_CLIENT_ID` en el
servicio web de Railway y `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` en el de la API. El
intercambio de código y el linking los hace la API, y `POST /auth/google` tiene su test.

**Lo que falla hoy es una línea en la consola de Google:** `redirect_uri_mismatch`. Google
devuelve eso en la URL de error, con el texto *"el URI redirigido no coincide con el URI de
redirecto autorizado para esta aplicación"*, y el popup se queda ahí. **No llega ninguna
petición a la API**, porque el código nunca se llega a canjear.

El URI lo pide la app a partir del propio origen de la página, no de una variable:

```
https://orbithub-app.jrz-labs.com/auth/google
```

Se registró `app.jrz-labs.com` cuando el dominio se llamaba así, así que el nombre nuevo no
está. Añádelo en el cliente **Web** del proyecto `959281134147`:

- **APIs y servicios → Credenciales → (el ID de cliente web) → URI de redirección
  autorizada**, y añadir `https://orbithub-app.jrz-labs.com/auth/google`.
- **Sin barra final**: `.../auth/google/` es un URI distinto y Google lo rechaza igual.

Y en **Pantalla de consentimiento OAuth → Dominios autorizados**, `jrz-labs.com`.

**Copia el client id entero, incluido el prefijo numérico.** Esto costó un despliegue: en
Railway quedó puesto `kp8bp7djedqrcv0l2tm98bhmbpusi1ni.apps.googleusercontent.com` en vez de
`959281134147-kp8bp7djedqrcv0l2tm98bhmbpusi1ni.apps.googleusercontent.com`. Un id de cliente
de Google empieza por el número de proyecto, y sin él Google responde `invalid_client` —que
la API traducía a `unauthorized` con el mensaje genérico "Google sign-in could not be
completed", sin decir nada del id. **El motivo sí sale en el log del servidor**
(`google code exchange rejected … reason="invalid_client"`), que es donde hay que mirar.

Estos son los pasos completos, por si hay que rehacerlos o crear los clientes de móvil:

1. Crea o usa un proyecto en [console.cloud.google.com](https://console.cloud.google.com).
2. **APIs y servicios → Pantalla de consentimiento OAuth**. Tipo: *Externo*. Añade:
   - correo de soporte
   - correo del desarrollador
   - scopes: `openid`, `email`, `profile`
   - pantalla de consentimiento: correo de soporte
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth**:
   - **Tipo de aplicación web**: URI de redirección autorizada
     `https://orbithub-app.jrz-labs.com/auth/google`
     (en desarrollo, `http://localhost:8081/auth/google`)
   - **Tipo de aplicación iOS**: bundle id `com.orbithub.app`
   - **Tipo de aplicación Android**: package `com.jrzlabs.orbithub` y huella SHA-1 de
     `apps/mobile/keys/orbit-hub-upload.jks`. Se saca con:
     `keytool -list -v -keystore apps/mobile/keys/orbit-hub-upload.jks -alias orbit-hub-upload`
4. Añade el dominio en **Dominios autorizados** de la pantalla de consentimiento.

| Dato | Dónde lo pongo |
| --- | --- |
| `client_id` (web) | `apps/mobile/.env` → `EXPO_PUBLIC_GOOGLE_CLIENT_ID` |
| `client_id` (iOS/Android) | igual que el anterior, sirve para los tres |
| `client_secret` | **solo** en `apps/api/.env` → `GOOGLE_CLIENT_SECRET` |

> El `client_secret` nunca va en la app. Solo se usa en la API para canjear el código.

**Lo que queda para las stores:** los clientes de iOS (`com.orbithub.app`) y Android
(`com.jrzlabs.orbithub`). El de web ya funciona; sin esos dos, el login con Google no
llega a un móvil.

---

## 2 bis. Claves ya heredadas del proyecto antiguo ✅

`make env-import-legacy` ya copió lo reutilizable a tus `.env` locales (sin mostrarlos ni
versionarlos):

| Clave | Origen | Nota |
| --- | --- | --- |
| `PUSHER_APP_ID` / `PUSHER_APP_KEY` / `PUSHER_SECRET` | `utility-app-turbo` | Realtime, Fase 5 |
| `TMDB_API_KEY` | `utility-app-native` | Movida a la API: la app ya no lleva claves de proveedor |
| `GOOGLE_BOOKS_API_KEY` | `utility-app-native` | Ídem |
| `GOOGLE_BOOKS_SEARCH_ENGINE_ID` | `utility-app-native` | Ídem |

**Lo que NO se ha copiado y por qué:** `DATABASE_URL` y las claves de Supabase (apuntarían a los
datos antiguos), `JWT_SECRET` (una clave nueva invalida los tokens viejos a propósito), las
claves de IA (la IA se eliminó) y las de Firebase (push necesita su propio proyecto en la Fase 6).

Buena noticia: los `.env` antiguos **no estaban versionados** en sus repos, así que las claves no
no están en el historial de git. Aun así, rota lo que importaste antes de producción.

## 3. Proveedor de email — Resend ✅ (integrado, probado y enviando)

**Decidido: Resend.** El transporte ya está implementado y probado
(`apps/api/src/modules/email/email.ts`): reintenta ante 429 y errores 5xx, distingue un rechazo
definitivo (no reintenta), tiene timeout de 10 s y nunca hace fallar un registro porque el correo
no salió: el fallo queda en el audit trail y el usuario puede pedir el reenvío.

**Ya está todo:**

| Dato | Estado |
| --- | --- |
| `RESEND_API_KEY` | ✅ puesta en `apps/api/.env` |
| Dominio | ✅ `jrz-labs.com` verificado, región `eu-west-1` (consultado a la API de Resend) |
| `EMAIL_FROM` | ✅ `no-reply@jrz-labs.com` |
| `EMAIL_TRANSPORT=resend` | ✅ puesto, y **enviando de verdad** |

```bash
make -C apps/api email-test EMAIL=tu-correo@ejemplo.com
```

Sale `✓ Enviado con resend` y un `id` del proveedor. Se mandó a `no-reply@jrz-labs.com` y
funcionó a la primera.

**Un fallo que salió al ponerlo, y que estaba escondido desde que se escribió el módulo:**
`EMAIL_TRANSPORT=resend` nunca se había ejecutado. El proceso moría al arrancar con
`Cannot access 'ResendEmailSender' before initialization`, porque el singleton se creaba
antes de que la clase existiera. El typecheck no lo ve y los tests usan `noop`, así que
estaba «probado» sin haberse ejecutado nunca. Arreglado moviendo el singleton al final del
fichero. Está escrito en el roadmap, en la sección 1.5.

Plan gratuito: 3.000 correos al mes y 100 al día. Suficiente para empezar.

## 4. PostgreSQL de producción ⬜ (decidido: Railway)

**Elegido Railway.** La razón es que ya lo usas: tienes allí los otros proyectos, el Postgres
lo provisiona el propio panel con un clic, y la API es un servicio Node que Railway despliega
sin Dockerfile. El [ADR 0004](architecture/adr/0004-external-postgresql.md) ya pedía un
Postgres gestionado externo con connection string, así que esto no cambia ninguna decisión:
es cumplirla.

En desarrollo uso un Postgres embebido (PGlite) en `apps/api/.data/pglite`. En producción
`DATABASE_URL` es **obligatoria**: `env.ts` la rechaza si `NODE_ENV=production` sin ella, a
propósito, porque el Postgres embebido está en memoria dentro del proceso.

### Los pasos

1. **New → Database → PostgreSQL** en un proyecto. Railway crea el servicio y pone un
   `DATABASE_URL` en los demás servicios del proyecto.
2. La API, como servicio Node en el **mismo proyecto**: `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
   Con la red privada de Railway **no hace falta SSL**, porque el tráfico no sale de Railway:
   `DATABASE_SSL=false`. Solo si abres la base al público (no deberías) sería `true`.
3. **Las migraciones corren solas al arrancar**: `index.ts` las ejecuta antes de escuchar,
   salvo que se ponga `RUN_MIGRATIONS_ON_BOOT=false`. No hay paso manual.
4. Exponer la API con **Networking → Generate Domain**, y apuntar `WEB_ORIGIN` al dominio.

**Lo que ya está comprobado y no va a faltar:** la migración `0012` crea
`CREATE EXTENSION IF NOT EXISTS pg_trgm` antes de sus índices, y el cliente ya tiene
`ssl: { rejectUnauthorized: false }` cuando `DATABASE_SSL=true`. El usuario `postgres` de
Railway puede crear extensiones, que es lo que hace falta.

**Lo que sí necesita tu cuenta:** `railway login` (la CLI está instalada pero sin sesión), y
el servicio de la API necesita `JWT_SECRET` de 32 caracteres o más y `NODE_ENV=production` —
la clave no se puede generar aquí porque no debe salir de tu máquina.

**Cuidado con una cosa:** las variables de Railway viven **solo en Railway**. La copia local
sigue con PGlite a propósito, para que `npm run api` funcione sin nada.

El paso a paso completo, con las variables y lo que no funciona todavía, está en
[deploy-railway.md](deploy-railway.md). El `Dockerfile` de la raíz ya está escrito y
construido, así que en Railway solo hay que señalar al repo.

### Los errores que costaron este despliegue ⬜

Los dos servicios fallaron al arrancar, y ninguno era un bug del código:

| Qué pasa | Por qué |
| --- | --- |
| `WEB_ORIGIN: Invalid URL` | Estaba a `temp`, un placeholder. Y **sin `https://`**: `z.string().url()` no acepta un dominio pelado |
| `DATABASE_URL` no puesta | El Postgres tenía la suya, pero nadie la conectó. Es `${{Postgres.DATABASE_URL}}` |
| El servicio web servía la API | `Dockerfile Path` en `Dockerfile` en vez de `Dockerfile.web`, y los dos logs salían idénticos |

`DATABASE_SSL=false` porque la red privada de Railway no sale de Railway.

### El almacenamiento se deja para luego ⬜

Los adjuntos **se pierden en cada redeploy**, y está escrito en
[deploy-railway.md](deploy-railway.md) con las cuatro variables del driver `s3`, que ya
está implementado. El API ahora avisa al arrancar en vez de negarse a arrancar: eso tenía
la API entera caída —auth, sync, listas, notas— por una cosa que usa una parte de la app.

---

## 5. Identificadores de la app y dominio ⬜

Confirmar antes de crear las cuentas en las stores, porque después no se pueden cambiar.

| Elemento | Valor | Estado |
| --- | --- | --- |
| Bundle id iOS | `com.orbithub.app` | ⬜ confirmar |
| Package Android | `com.jrzlabs.orbithub` | ✅ confirmado |
| Dominio web | `orbithub-app.jrz-labs.com` | ✅ en uso |
| Dominio de la API | `orbithub-api.jrz-labs.com` | ✅ en uso |
| Correo de soporte | `support@orbithub.com` | ⬜ confirmar |

**Sobre el dominio:** los dos dominios ya apuntan a Railway y funcionan, así que la Fase 7
solo necesita los `AASA` y los `Asset Links` encima de lo que ya está.

---

## 6. Cuentas de las stores ⬜

No bloquean el desarrollo, pero abren camino a la Fase 10.

- [ ] Apple Developer Program (membresía anual) → para TestFlight y la App Store
- [ ] Google Play Console (cuenta de desarrollador, 25 USD una vez) → para la Play Store
      — la cuenta de servicio ya está creada en Google Cloud
      (`orbit-hub-play-uploader@orbithub-509713.iam.gserviceaccount.com`); falta bajar su clave
      JSON y crear la app `com.jrzlabs.orbithub`. Ver [deploy-play.md](deploy-play.md).
- [ ] EAS (Expo) → no hace falta para publicar. El build y la subida son locales; `eas.json`
      sigue ahí por si algún día se quiere un build cloud.

---

## 7. Lo que yo hago con cada cosa

| | Cuando me lo des | Qué hago |
| --- | --- |
| `client_id` + `client_secret` | Activo el login con Google y añado tests del intercambio y del linking |
| Proveedor de email | Integro el transporte, plantillas reales y reintentos |
| `DATABASE_URL` | Ejecuto las migraciones contra producción y verifico el health check |
| Nombre y correo de Git | ~~Ya está~~ — no hace falta |
| Bundle id y dominio definitivos | Los fijo en config, AASA, Asset Links y en EAS |
| Cuentas de las stores | Nada en el código: `npm run release` ya está. Ver [deploy-play.md](deploy-play.md) |

---

## Resumen: lo mínimo para seguir trabajando

**No queda nada urgente de la lista inicial.** Identidad de Git, Google OAuth y Resend ya
están cerrados.

Lo único que bloquea el despliegue es de tu cuenta y son tres cosas:

1. **`railway login`** — la CLI está instalada pero sin sesión.
2. **Postgres en Railway** — un servicio, y la API apuntando a
   `${{Postgres.DATABASE_URL}}`. Está en [deploy-railway.md](deploy-railway.md).
3. **`JWT_SECRET` de 32 caracteres o más** en las variables de Railway. No lo genero aquí
   porque no debe salir de tu máquina.

---

## 8. Dominio `jrz-labs.com` ✅ (correo y web resueltos)

**Resuelto:** los registros DNS de Resend (DKIM + SPF) están puestos y el dominio sale
`verified`. Los correos se envían de verdad desde `no-reply@jrz-labs.com`. Y la web está
sirviéndose en `https://orbithub-app.jrz-labs.com`, con la API detrás de
`https://orbithub-api.jrz-labs.com`.

**Lo que queda:**

| Qué | Para qué |
| --- | --- |
| `AASA` (iOS) y `Asset Links` (Android) | Deep links y universal links, Fase 7 |

Para probar en local, `WEB_ORIGIN=http://localhost:8081` y se leen los enlaces del log. Está
explicado en [environment.md](environment.md#web_origin-en-desarrollo).

Para probar en local, `WEB_ORIGIN=http://localhost:8081` y se leen los enlaces del log. Está
explicado en [environment.md](environment.md#web_origin-en-desarrollo).


---

## Comandos para trabajar con las variables

```bash
make env-list           # inventario completo
make env-init           # crea los .env desde las plantillas
make env-check          # qué falta (solo nombres, nunca valores)
make env-jwt            # genera un JWT_SECRET estable
make env-import-legacy  # copia las claves reutilizables del proyecto antiguo
```

Referencia completa en [environment.md](environment.md).
