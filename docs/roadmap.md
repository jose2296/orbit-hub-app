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

### 1.1 Datos ✅
- [x] ADR 0006: Drizzle ORM con doble driver (node-postgres / PGlite)
- [x] Esquema: `users`, `auth_identities`, `sessions`, `email_tokens`, `audit_logs`
- [x] Migración SQL generada y versionada
- [x] Cliente de base de datos con transacciones y pool
- [x] Tests de integración contra PGlite (Postgres real en proceso, sin servidor)

### 1.2 Contratos ✅
- [x] Esquemas Zod de request/response de todos los endpoints de auth
- [x] `AuthResult`, `Session`, `Device`, `User` compartidos con la app

### 1.3 Seguridad ✅
- [x] Hashing Argon2id con sal por usuario y rehash oportunista
- [x] Access tokens JWT (`jose`), refresh tokens opacos almacenados hasheados
- [x] Rotación de refresh token con detección de replay (revoca la familia)
- [x] Verificación de email con token de un solo uso y expiración
- [x] Recuperación de contraseña sin revelar si la cuenta existe
- [x] Rate limiting en `/auth/*` por IP y por email
- [x] Audit log: login, logout, refresh, revocación, linking, cambio de contraseña

### 1.4 Endpoints ✅
- [x] `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`
- [x] `POST /auth/verify-email`, `/auth/verify-email/resend`
- [x] `POST /auth/password/forgot`, `/auth/password/reset`, `/auth/password/change`
- [x] `POST /auth/google` (intercambio de código + linking seguro)
- [x] `GET /auth/me`, `GET /auth/devices`, `DELETE /auth/devices/:id`
- [x] `DELETE /auth/account` con reautenticación

### 1.5 Email ✅
- [x] Abstracción `EmailSender` con transporte de consola en desarrollo
- [x] Plantillas de verificación y recuperación en español e inglés
- [ ] Proveedor de email real (pendiente de decidir)

### 1.6 App ✅
- [x] Registro y login reales conectados a la API
- [x] Pantalla de verificación de email con reenvío
- [x] Ajustes → Dispositivos: listar, revocar y cerrar sesión en todos
- [x] Mensajes de error del API por código, no por texto
- [x] Tests del cliente HTTP (envelope, refresh, reintento, errores, timeout)

**Estado:** implementada. 45 tests en verde (36 de API, 9 de app), de los cuales 25 son de
integración contra Postgres real.

**Pendiente para cerrar la fase:**
- [ ] Proveedor de email real y dominio de producción
- [ ] Credenciales reales de Google OAuth (las aporta el usuario)
- [ ] Ejecutar el mismo esquema en PostgreSQL gestionado
- [ ] Empaquetado de la API para el entorno de destino

**Criterio de salida cumplido:** un usuario se registra, verifica el correo, entra en dos
dispositivos, los ve en Ajustes, revoca uno y cierra sesión en todos, con tests que lo cubren.

---

## Fase 2 — Organización 🟡

- [x] Esquema: `workspaces`, `memberships`, `folders`, `dashboard_layouts`
- [x] Tablas de sincronización: `sync_operations`, `sync_conflicts`, `sync_cursors`
- [x] `POST /sync/push` con idempotencia por `operationId`
- [x] `POST /sync/pull` con cursor por dispositivo y tombstones
- [x] Fusión de tres vías: los cambios en campos distintos se fusionan solos
- [x] Conflictos explícitos: `GET /sync/conflicts`, nunca sobrescritura silenciosa
- [x] Autorización por rol en cada escritura (workspace que no se ve = 404)
- [x] Outbox del cliente con estado base (`base`) para la fusión
- [ ] Workspaces CRUD como endpoints REST (además de sync)
- [ ] Carpetas anidadas: mover, reordenar y arrastrar
- [ ] Dashboard con layout persistido y editor visual
- [ ] Caché local de entidades para lectura sin conexión
- [ ] Pantallas de workspaces y carpetas en la app
- [ ] Invitaciones y transferencia de propiedad (fase de colaboración)

**Criterio de salida:** crear, renombrar, mover y borrar un workspace y una carpeta desde dos
dispositivos, online y offline, sin duplicados ni sobrescrituras silenciosas.

**Estado:** el motor de sincronización está completo y probado (20 tests). Falta la capa de
lectura: endpoints REST de consulta y las pantallas de la app.

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
