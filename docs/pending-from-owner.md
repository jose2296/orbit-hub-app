# Pendiente de decisiones y credenciales

Todo lo que necesito de ti para cerrar la Fase 1 y poder desplegar. Nada de esto bloquea el
desarrollo: la API funciona con valores de desarrollo y los tests no dependen de ningún servicio
externo.

Estado: ⬜ pendiente · 🟡 en curso · ✅ hecho

---

## 1. Identidad de los commits (bloqueante para el historial) 🟡

Ahora mismo los commits llevan un autor provisional (`OrbitHub <dev@orbithub.local>`) porque no
hay `user.name` ni `user.email` configurados en el repositorio.

**Necesito de ti:** el nombre y el correo que quieres que aparezca en el historial.

```bash
git config user.name "Tu Nombre"
git config user.email "tu@correo.com"
```

Con eso reescribo el autor de los commits existentes (son pocos, y aún no hay collaborators).

---

## 2. Google OAuth ✅ (claves puestas, probado)

Hoy el botón está implemented pero **desactivado**: el cliente no existe, así que la app lo
muestra deshabilitado con un aviso. En cuanto me pases el par, lo activo.

### Pasos en Google Cloud Console

1. Crea o usa un proyecto en [console.cloud.google.com](https://console.cloud.google.com).
2. **APIs y servicios → Pantalla de consentimiento OAuth**. Tipo: *Externo*. Añade:
   - correo de soporte
   - correo del desarrollador
   - scopes: `openid`, `email`, `profile`
   - pantalla de consentimiento: correo de soporte
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth**:
   - **Tipo de aplicación web**: URI de redirección autorizada
     `https://app.orbithub.com/auth/google` (en desarrollo, `http://localhost:8081/auth/google`)
   - **Tipo de aplicación iOS**: bundle id `com.orbithub.app`
   - **Tipo de aplicación Android**: package `com.orbithub.app` y huella SHA-1 del keystore de
     firma
4. Añade el dominio `app.orbithub.com` en **Dominios autorizados** de la pantalla de consentimiento.

**Necesito de ti:**

| Dato | Dónde lo pongo |
| --- | --- |
| `client_id` (web) | `apps/mobile/.env` → `EXPO_PUBLIC_GOOGLE_CLIENT_ID` |
| `client_id` (iOS/Android) | igual que el anterior, sirve para los tres |
| `client_secret` | **solo** en `apps/api/.env` → `GOOGLE_CLIENT_SECRET` |

> El `client_secret` nunca va en la app. Solo se usa en la API para canjear el código.

Si prefieres, también sirve un **secreto de cliente de la app móvil** (Google lo llama
"client secret" también en iOS/Android); pásamelo y lo guardo igual en la API.

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

## 3. Proveedor de email — Resend 🟡 (integrado, falta la clave)

**Decidido: Resend.** El transporte ya está implementado y probado
(`apps/api/src/modules/email/email.ts`): reintenta ante 429 y errores 5xx, distingue un rechazo
definitivo (no reintenta), tiene timeout de 10 s y nunca hace fallar un registro porque el correo
no salió: el fallo queda en el audit trail y el usuario puede pedir el reenvío.

**Me falta esto:**

| Dato | Dónde se saca | Dónde va |
| --- | --- | --- |
| `RESEND_API_KEY` | [resend.com/api-keys](https://resend.com/api-keys), tipo **Sending access** y permisos **Only** (enviar es lo único que hacemos) | `apps/api/.env` |
| Dominio verificado | [resend.com/domains](https://resend.com/domains), añade los registros DNS que te dé (DKIM + SPF). Vale un subdominio: `mail.orbithub.com` | — |
| `EMAIL_FROM` | El remitente que quieras, por ejemplo `OrbitHub <no-reply@mail.orbithub.com>` | `apps/api/.env` |
| `EMAIL_TRANSPORT=resend` | — | `apps/api/.env` |

**Pruebas:**

```bash
# 1. Antes de verificar el dominio solo puedes enviar a tu propio correo
make -C apps/api email-test EMAIL=tu-correo@ejemplo.com

# 2. Cuando la clave esté puesta
make -C apps/api email-test EMAIL=otro-correo@ejemplo.com
```

Si el dominio aún no está verificado, Resend solo permite enviar a la dirección de tu cuenta
usando `onboarding@resend.dev`. Sirve para probar, no para producción.

Plan gratuito: 3.000 correos al mes y 100 al día. Suficiente para empezar.

## 4. PostgreSQL de producción ⬜

En desarrollo uso un Postgres embebido (PGlite) en `apps/api/.data/pglite`. Para desplegar
necesito un Postgres gestionado real.

**Proveedores recomendados:** Neon, Supabase (solo Postgres), Railway, o cualquier servidor
propio. Todos sirven: la API solo necesita una connection string.

**Necesito de ti:**

| Dato | Nota |
| --- | --- |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/orbit_hub` |
| ¿Requiere SSL? | casi siempre sí → `DATABASE_SSL=true` |
| ¿Permite migraciones? | permiso DDL para el usuario de la app |

**Mientras tanto:** no hace falta nada. `npm run api` funciona sin base de datos externa.

---

## 5. Identificadores de la app y dominio ⬜

Confirmar antes de crear las cuentas en las stores, porque después no se pueden cambiar.

| Elemento | Valor provisional | Estado |
| --- | --- | --- |
| Bundle id iOS | `com.orbithub.app` | ⬜ confirmar |
| Package Android | `com.orbithub.app` | ⬜ confirmar |
| Dominio web | `app.orbithub.com` | ⬜ confirmar o elegir otro |
| Correo de soporte | `support@orbithub.com` | ⬜ confirmar |

**Sobre el dominio:** lo necesito antes de la Fase 7 (deep links, universal links, AASA y
Asset Links requieren que el dominio apunte a la web y a la app).

---

## 6. Cuentas de las stores ⬜

No bloquean el desarrollo, pero abren camino a la Fase 10.

- [ ] Apple Developer Program (membresía anual) → para TestFlight y la App Store
- [ ] Google Play Console (cuenta de desarrollador, 25 USD una vez) → para la Play Store
- [ ] EAS (Expo) → se configura con `eas login` y un proyecto de EAS cuando haya bundle id y
      cuenta de Apple/Google

---

## 7. Lo que yo hago con cada cosa

| | Cuando me lo des | Qué hago |
| --- | --- |
| `client_id` + `client_secret` | Activo el login con Google y añado tests del intercambio y del linking |
| Proveedor de email | Integro el transporte, plantillas reales y reintentos |
| `DATABASE_URL` | Ejecuto las migraciones contra producción y verifico el health check |
| Nombre y correo de Git | Reescribo el autor de los commits |
| Bundle id y dominio definitivos | Los fijo en config, AASA, Asset Links y en EAS |
| Cuentas de las stores | Configuro `eas.json`, firma y builds de previsualización |

---

## Resumen: lo mínimo para seguir trabajando

Nada de lo de arriba bloquea el desarrollo de la **Fase 2** (workspaces, carpetas, dashboard y
sincronización). Solo dos cosas son urgentes de verdad:

1. **Identidad de Git** → dime nombre y correo.
2. **La clave de Resend y el dominio verificado** → la integración está hecha, solo falta la clave.

El resto (Postgres de producción, stores) puede llegar más adelante, con avisos.

---

## 8. Dominio `jrz-labs.com` ✅ (puesto, falta alojaje)

Ya está configurado como origen de los correos. Para que funcione de verdad falta:

| Qué | Para qué |
| --- | --- |
| Apuntar el dominio (o `app.jrz-labs.com`) al hosting de la web | Para que la PWA se sirva y los enlaces de los correos abran la app |
| Registros DNS de Resend (DKIM + SPF) en `jrz-labs.com` | Para que los correos no acaben en spam |
| `https://<dominio>/auth/google` en el cliente OAuth de Google | Redirect URI del login con Google |
| `AASA` (iOS) y `Asset Links` (Android) | Deep links y universal links, Fase 7 |

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
