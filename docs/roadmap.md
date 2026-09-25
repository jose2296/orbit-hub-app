# Roadmap

Vista general de todo lo que queda, incluidas las fases futuras. Las fases están ordenadas por
dependencia, no por importancia: cada una termina en algo usable y verificable.

Leyenda: ✅ hecho · 🟡 en curso · ⬜ pendiente

---

## Fase 0 — Fundación ✅

Monorepo, app, API y documentación. Detalle en el commit inicial.

- Monorepo `apps/mobile`, `apps/api`, `packages/contracts`, `packages/config`
- Expo SDK 57 + Expo Router + React Native Web, export estático, manifest PWA
- Design system: tokens, temas claro/oscuro, 5 acentos, kit de componentes
- Shell de la app: onboarding, registro, login, recuperación, tabs, ajustes, centro de sync
- i18n es/en persistido
- Cliente de auth: almacenamiento seguro, refresh single-flight, flujo Google PKCE
- Offline: `LocalStore` (SQLite / Web Storage), outbox, tabla de conflictos
- API: entorno validado, envelope de errores, request id, Helmet, CORS, health, tests
- CI: typecheck, tests, config Expo, expo-doctor, export web

**Estado:** commit `c98a704`, publicado en `main`.

---

## Fase 1 — Auth y datos 🟡

El objetivo es una cuenta real de principio a fin: registrarse, verificar, entrar en dos
dispositivos, revocar uno y cerrar sesión en todos.

### 1.1 Datos
- [ ] ADR 0006: decisión de ORM/capa de acceso
- [ ] Esquema Drizzle: `users`, `auth_identities`, `sessions`, `email_tokens`, `devices`, `audit_logs`
- [ ] Migración SQL generada y versionada
- [ ] Cliente de base de datos con transacciones y pool
- [ ] Tests de integración contra PGlite (Postgres real en proceso, sin servidor)

### 1.2 Contratos
- [ ] Esquemas Zod de request/response de todos los endpoints de auth
- [ ] `AuthResult`, `Session`, `Device`, `User` compartidos con la app

### 1.3 Seguridad
- [ ] Hashing Argon2id con sal por usuario
- [ ] Access tokens JWT (`jose`), refresh tokens opacos almacenados hasheados
- [ ] Rotación de refresh token con detección de replay (revoca la familia)
- [ ] Verificación de email con token de un solo uso y expiración
- [ ] Recuperación de contraseña sin revelar si la cuenta existe
- [ ] Rate limiting en `/auth/*` por IP y por email
- [ ] Audit log: login, logout, refresh, revocación, linking, cambio de contraseña

### 1.4 Endpoints
- [ ] `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`
- [ ] `POST /auth/verify-email`, `/auth/verify-email/resend`
- [ ] `POST /auth/password/forgot`, `/auth/password/reset`, `/auth/password/change`
- [ ] `POST /auth/google` (intercambio de código + linking seguro)
- [ ] `GET /auth/me`, `GET /auth/devices`, `DELETE /auth/devices/:id`

### 1.5 Email
- [ ] Abstracción `EmailSender` con transporte de consola en desarrollo
- [ ] Plantillas de verificación y recuperación

### 1.6 App
- [ ] Registro y login reales conectados a la API
- [ ] Pantalla de verificación de email alcanzable desde el flujo real
- [ ] Ajustes → Dispositivos: listar y revocar
- [ ] Mensajes de error del API por código, no por texto

**Criterio de salida:** un usuario se registra, verifica el correo, entra en dos dispositivos,
los ve en Ajustes, revoca uno y cierra sesión en todos. Probado con tests de integración.

---

## Fase 2 — Organización

- [ ] Workspaces CRUD y membresías; primer workspace al registrarse
- [ ] Carpetas anidadas, mover y reordenar
- [ ] Dashboard con layout persistido
- [ ] Caché local de workspaces, carpetas y membresías
- [ ] `POST /sync/push` y `POST /sync/pull` para estas entidades
- [ ] Autenticación: invite pendiente, rol por recurso, propiedad

**Criterio de salida:** crear, renombrar, mover y borrar un workspace y una carpeta desde dos
dispositivos, online y offline, sin duplicados ni sobrescrituras silenciosas.

---

## Fase 3 — Listas y búsqueda

- [ ] Listas (tareas, películas, libros) e items
- [ ] Posición, completada, prioridad, etiquetas, favoritos
- [ ] Búsqueda global sobre todas las entidades
- [ ] Plantillas, duplicar, acciones rápidas
- [ ] Integraciones con proveedores **detrás de la API** (TheMovieDB, Google Books); ninguna
      clave en el cliente
- [ ] Metadatos de proveedor cacheados para render offline

**Criterio de salida:** una lista creada en un avión aparece una sola vez, y en orden, en otro
dispositivo al aterrizar.

---

## Fase 4 — Notas y adjuntos

- [ ] Esquema de documento portable y su validador
- [ ] Editor rico web
- [ ] Editor nativo
- [ ] Autoguardado con control de versión
- [ ] Adjuntos: escritura local, subida encolada, descarga autorizada
- [ ] Búsqueda sobre `plain_text`

---

## Fase 5 — Colaboración y realtime

- [ ] Invitaciones por email y por enlace: aceptar, rechazar, revocar
- [ ] Roles (`owner`, `editor`, `viewer`) en cada lectura y escritura
- [ ] Canal realtime por workspace, con alcance por rol
- [ ] Transferencia de propiedad, salir del workspace
- [ ] Comentarios e historial de actividad

---

## Fase 6 — Offline endurecido

- [ ] Caché de entidades con política de expulsión
- [ ] Sincronización al abrir, al reconectar y por intervalo
- [ ] Backoff, presupuesto de reintentos, rechazos permanentes
- [ ] Centro de sincronización: conflictos, resolución, mezcla por campo
- [ ] Cuota de almacenamiento y "vaciar caché"
- [ ] Coalescencia de operaciones por entidad

---

## Fase 7 — Planificador, notificaciones, enlaces, PWA

- [ ] Planificador rediseñado: plantillas, copiar semana, deshacer, layouts móvil y web
- [ ] Notificaciones push, preferencias por tipo, horas de silencio, resumen diario
- [ ] Deep links y universal links (AASA, Asset Links) con un único esquema de rutas
- [ ] PWA: prompt de instalación, shell offline, web push donde el navegador lo permita

---

## Fase 8 — Calendario

- [ ] Eventos, recurrencia, recordatorios
- [ ] Zonas horarias, importación/exportación ICS
- [ ] Integración con la vista de planner

---

## Fase 9 — Datos, privacidad y datos heredados

- [ ] Exportación de la cuenta (JSON/CSV) como trabajo en segundo plano
- [ ] Importación/exportaciónadvanced de contenido
- [ ] Herramienta de migración desde `utility-app-native` / `utility-app-turbo`
      (ver [migration/legacy-migration.md](migration/legacy-migration.md))
- [ ] Páginas de términos y privacidad, consentimiento web

---

## Fase 10 — Pulido de plataforma

- [ ] Accesibilidad: contraste, lectores de pantalla, foco, teclado completo en web
- [ ] Entrada por voz y transcripción
- [ ] Perfiles de build EAS, metadatos de store, firma
- [ ] Observabilidad: métricas, seguimiento de errores, comprobaciones de disponibilidad
- [ ] Presupuesto de rendimiento por pantalla y por arranque

---

## Transversal (arrastra a todas las fases)

- [ ] Rate limiting y protección de abuso en todos los endpoints de escritura
- [ ] Logs estructurados con request id, tracking de errores, comprobaciones de disponibilidad
- [ ] Secretos en el gestor de secretos del hosting, nunca en el repositorio
- [ ] CI: tests de integración, builds de previsualización de EAS
- [ ] Rotación de secretos heredados antes de cualquier despliegue

---

## Dependencias entre fases

```text
Fase 1 (auth + datos)
   └─> Fase 2 (organización)
          └─> Fase 3 (listas) ─┐
          └─> Fase 4 (notas)  ─┼─> Fase 5 (colaboración)
                                └─> Fase 6 (offline endurecido)
                                       └─> Fase 7 (planificador, push, PWA)
                                              └─> Fase 8 (calendario)
                                                     └─> Fase 9 (migración heredada)
Fase 10 (pulido) es continua y transversal
```

## Riesgos que ya están identificados

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| PWA completa vs. límites del navegador | Web más débil que nativo | Degradación explícita en la UI, sin Fingir capacidades |
| Auth propio | Seguridad de contraseñas y sesiones nuestra | Argon2id, rotación con detección de replay, rate limiting, audit log |
| Alcance del MVP muy amplio | Entrega tardía | Fases verticales con criterio de salida; nada se declara terminado sin probarlo |
| Sincronización offline | Complejidad real | Outbox idempotente, conflictos explícitos, pruebas con dos dispositivos simulados |
| Editores nativos y web | Divergencia de formato | Un único formato de documento validado por esquema |
| Migración heredada | Datos corruptos si se hace tarde | Transformación pura, versionada y reversible, con informe de anomalías |
