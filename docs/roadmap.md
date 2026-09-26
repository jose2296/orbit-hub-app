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
- [x] Transporte real de Resend con reintentos, timeout y sin romper el registro si falla
- [x] Plantillas de verificación y recuperación en español e inglés
- [ ] Dominio de envío verificado en Resend (falta la clave y el DNS)

### 1.6 App ✅
- [x] Registro y login reales conectados a la API
- [x] Pantalla de verificación de email con reenvío **y consumo del token del enlace**
- [x] Pantalla de reset de contraseña (el endpoint existía, la ruta no)
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
- [x] Endpoints REST de lectura (workspaces, carpetas, miembros, dashboard)
- [x] Caché local de entidades: SQLite en nativo, Web Storage en web
- [x] Pull a la caché con cursor por dispositivo
- [x] Escrituras optimistas: se ve al instante, se encolan y se sincronizan
- [x] Pantallas de workspaces y carpetas, con árbol e indentación
- [x] Home conectada a los workspaces reales
- [x] Dashboard: editor de widgets con layout validado y autorreparado
- [ ] Mover y reordenar carpetas con arrastrar (ahora hay subir/bajar en el panel)
- [ ] Renombrar en línea y hoja de acciones por carpeta
- [ ] Invitaciones y transferencia de propiedad (fase de colaboración)

**Criterio de salida:** crear, renombrar, mover y borrar un workspace y una carpeta desde dos
dispositivos, online y offline, sin duplicados ni sobrescrituras silenciosas.

**Estado:** sincronización, lectura, escritura local y editor del dashboard funcionando y
probados (106 tests). Las escrituras van siempre por el outbox, también estando online: hay un
único camino de escritura, con versión, permisos y conflictos.

**Pendiente:** arrastrar para mover carpetas (hoy se ordenan con botones) y las invitaciones,
que llegan con la fase de colaboración.

---

## Fase 3 — Listas y búsqueda 🟡

- [x] Esquema: `lists` y `list_items` con una forma única para los tres tipos
- [x] `list` y `list_item` como entidades sincronizables con campos acotados
- [x] Los items heredan el workspace de su lista, comprobado antes de insertar
- [x] Lecturas: `GET /lists`, `/lists/:id`, `/lists/:id/items` con filtros
- [x] Búsqueda global en el servidor: workspaces, carpetas, listas y elementos
- [x] Pantallas de listas y de detalle con elementos
- [x] Búsqueda en la app sobre la caché local, funciona sin conexión
- [x] Metadatos de proveedor guardados (`externalId` + `metadata`)
- [x] Integraciones reales con TheMovieDB y Google Books detrás de la API
- [x] Detalle de película, serie y libro: póster, sinopsis, año, duración, géneros,
      puntuación, reparto, temporada/editorial e ISBN
- [x] Duplicar una lista con sus elementos, su estado y su registro de proveedor
- [x] Reordenar elementos
- [ ] Fechas límite y recurrencia (descartadas en alcance, vuelve en revisión)
- [ ] Plantillas

**Criterio de salida:** una lista creada en un avión aparece una sola vez, y en orden, en otro
dispositivo al aterrizar. ✅ Cubierto por un test de integración que reproduce el caso: un
dispositivo encola la lista y sus tres elementos sin conexión, el lote sale **dos veces** como haría
un cliente que reconecta y reintenta, y el segundo dispositivo la recibe **una sola vez y en
orden**.

**Estado:** fase completa. Catálogos reales detrás de la API con detalle de película, serie y libro;
duplicado que conserva el estado de completado y el registro del proveedor, y que no roba la
favorita del original; reordenado con posiciones siempre contiguas desde cero.

**Reordenar con flechas, no arrastrando.** Un arrastre necesita una librería de gestos y una lista
que se lleve la fila por delante, que en web significa reimplementar el arrastre nativo y renunciar
a las filas simples que usa el resto de la app. Dos botones funcionan en las tres plataformas, son
alcanzables con lector de pantalla y teclado, y no se pueden cancelar a medias. Queda anotado como
decisión, no como descuido.

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

## Parecerse a la app antigua

Todo lo que se ha pedido para que la interfaz se parezca a la de la app vieja. Cada línea
está verificada conduciendo la app en un navegador real antes de su commit. Es la lista
que hay que seguir.

Leyenda: ✅ hecho y verificado · 🟡 a medias · ⬜ sin empezar

### Hecho y verificado

| # | Qué se pidió | Dónde | Commit |
| --- | --- | --- | --- |
| 1 | Películas y libros en carrusel horizontal con portadas | `list/[listId].tsx`, `media-carousel.tsx` | `e934351` |
| 2 | Tareas separadas en pendientes y completadas | `list/[listId].tsx` | `e934351` |
| 3 | Una lista nunca mezcla películas, series, libros y tareas | `ListKind` de 5 tipos, en el contrato y en la API | `0db7a24` |
| 4 | Listas con muchísimos elementos que van bien | `FlatList` + consulta por lista en el almacén | `8aafd2e` |
| 5 | Arrastrar para reordenar | `draggable-row.tsx` | `87511f0` |
| 6 | Masonry en el panel | `masonry.tsx` | `b764077` |
| 7 | Detalle con colección (franquicia) y similares | `item/[itemId].tsx` | `0a70ec2` |
| 8 | El espacio muestra sus listas, el inicio muestra contenido real | `workspace/[workspaceId].tsx`, `index.tsx` | `724d002` |
| 9 | Siempre se puede ir atrás y se sabe dónde estás | Cabecera con atrás, título y migas | `23bfc09` |
| 10 | Carpetas como pantallas, y un botón para crear cualquier cosa | `folder/[folderId].tsx`, `create-sheet.tsx` | `0db7a24` |
| 11 | Marcar una película como vista, o un libro como leído | `media-actions-sheet.tsx` | `0fe4304` |
| 12 | En el detalle se puede hacer todo, y quitar de la lista | `item/[itemId].tsx` | `0fe4304` |
| 13 | Un libro sin ficha abría "Algo ha ido mal" | `provider-ref.ts` | `4b98bf5` |
| 14 | Iconos por defecto (tomate, pan, papel…) | `item-presentation.ts`, 28 claves en el contrato | `e89547d` |
| 15 | Etiquetas por elemento (Mercadona, Carrefour) | `item-presentation.ts` | `e89547d` |
| 16 | Filtrar por etiqueta, por lo que queda y por texto | `item-picker.tsx` | `e89547d` |
| 17 | Orden manual **de la lista** y compartido, más otros seis | `list.orderMode` | `e89547d` |
| 18 | Solo se puede arrastrar en orden manual, y la app lo dice | `canReorder` | `e89547d` |
| 19 | El orden elegido no renumera nada: el manual se conserva | `orderItems` | `e89547d` |

### A medias

| # | Qué se pidió | Estado | Commit |
| --- | --- | --- | --- |
| 20 | Menú por lista: renombrar, favorita, pinear, duplicar, eliminar | Hecho y verificado. Renombrar, favorita, pinear y duplicar hacen lo que dicen; eliminar avisa de cuántos elementos se van y que no se puede deshacer | — |
| 20b | Menú por carpeta: crear una lista dentro, renombrar, eliminar | Hecho y verificado. Eliminar una carpeta **no** borra las listas de dentro: se quedan sin carpeta | — |
| 20c | Botón de menú visible en cada fila | Estaba solo en la pulsación larga, que en web no existe. Ahora hay un botón `⋯` | — |
| 20d | Compartir, y el menú del espacio | Sin empezar. Compartir necesita tabla de invitaciones, token, correo y pantalla de aceptar | — |

### Sin empezar

| # | Qué se pidió | Notas |
| --- | --- | --- |
| 21 | Panel con posición y tamaño de cada tarjeta editables | Hoy el masonry existe y las tarjetas se ordenan, pero no se mueven ni se redimensionan. El modelo ya tiene `x/y/w/h` en 12 columnas y falta la edición |
| 22 | Cada espacio con su color | El modelo **no tiene color**: hay que añadirlo a `workspaces`, migrar, y teñir las tarjetas de cada espacio |
| 23 | Al escribir un elemento, si coincide con uno ya completado, ofrecer volverlo a pendiente | La lista de la compra no tiene nada de esto |
| 24 | Escritorio: cajón lateral, ancho máximo | Todo está pensado para móvil; la versión ancha es la de móvil estirada |
| 25 | Los detalles con el aspecto de los de la app vieja | Hay datos, no la maquetación |
| 26 | Compartir de verdad (invitar a alguien) | La API solo tiene leer miembros. Invitar es un bloque entero: tabla de invitaciones, token, correo y pantalla de aceptar |

### Lo que ya no hace falta decidir

- **Orden manual por persona o por lista:** por lista. Todos los colaboradores ven el
  mismo orden, que es lo único que hace que la lista que ordenó otro siga significando
  algo. Decidido y hecho.
- **Si se puede arrastrar en otro orden:** no. Solo en manual, y la lista lo avisa.

---

## Qué hay que revisar tú

Todo lo anterior está comprobado por un script que conduce un navegador real y falla si
la pantalla no dice lo que dice el código. Eso es una buena prueba y no es una mirada:
estas son las cosas que una prueba no puede saber si te gustan.

### Cosas que son cuestión de gusto y solo tú puedes decir

1. **Las frases.** Están en español e inglés en el mismo archivo
   (`apps/mobile/src/lib/i18n/dictionaries.ts`). He escrito unas 90 en este bloque.
   ¿Suenan a ti? "Lo escribiste tú, así que no hay ficha de ningún catálogo" es
   deliberadamente honesto y algo largo; si suena raro, se cambia en un minuto.
2. **Los colores de los acentos y los nombres de los iconos.** El pan se llama "Pan" y se
   dibuja con un bocadillo porque no hay un glifo de pan. Si prefieres otra imagen para
   cada cosa, es una tabla.
3. **El sitio del botón de eliminar.** Va al final del menú, en rojo, y siempre con una
   hoja de confirmación delante. En la app vieja no preguntaba. Es una decisión mía.
4. **El aviso de "estás mirando otro orden".** Sale en la lista cada vez que el orden no es
   manual, y es un texto largo. Si molesta, se puede poner solo cuando se intenta arrastrar.

### Bugs que aparecieron y que conviene que mires

Cada uno estaba verificado como bug antes de arreglarlo, y son la razón de que esta vez
haya 335 pruebas donde antes había 287:

| Qué pasaba | Por qué no lo veía el typecheck |
| --- | --- |
| **Escribir una tarea a mano rompía la lista.** Salía `item.tags.length` de undefined | La fila se escribía a mano en la caché, sin el campo nuevo, y el contrato no lo comprueba |
| **El servidor tiraba el icono, las etiquetas y el orden al crear** | El `create` escribía los campos uno a uno y el `insert` no mencionaba los nuevos |
| **Un libro escrito a mano no se podía abrir** | El detalle pedía el proveedor de la lista en vez del elemento, y sin id no hay nada que pedir |
| **Un libro con 3/5 salía como 3.0/10** | La escala venía asumida, no viaja con la nota |
| **El botón del menú era un botón dentro del botón de la tarjeta** | HTML inválido; un lector de pantalla lo lee como un control |
| **Dos controles con el mismo nombre en pantalla** (el icono de una fila y la fila) | El navegador pulsaba el equivocado al hacer la prueba |
| **El menú de una lista solo salía con pulsación larga** | En web no hay pulsación larga, y en móvil nadie lo descubre |
| **La tecla Enter no hacía nada en el campo de etiqueta** | En web el campo no está en un formulario |

### Lo que NO he comprobado

- **Nada en un móvil ni una tablet de verdad.** Todo está verificado en la web a 430×932
  (tamaño de móvil) y el typecheck cubre Android e iOS, pero nadie ha ejecutado un
  `expo run:ios`/`run:android`. Es lo primero que hay que hacer.
- **El contraste de los textos y el orden de tabulación**, que son cosas de lector de
  pantalla y no se ven en una captura.
- **Con 300 elementos de verdad.** La prueba usa 500 filas sintéticas; con títulos
  largos, con portadas que fallan al cargar y con 20 personas editando a la vez, no.
- **Los conflictos de sincronización** entre dos personas editando la misma fila. Hay
  tests de la API, pero no una prueba con dos navegadores.

### Lo que depende de ti y bloquea el despliegue

| Qué | Por qué bloquea |
| --- | --- |
| `DATABASE_URL` de PostgreSQL de producción | La API usa PGlite en desarrollo, que es un Postgres en memoria dentro del proceso |
| Credenciales de Google OAuth **para Android e iOS** | Hay que crear dos clientes más, con `com.orbithub.app` |
| Cuentas de las stores, firma y perfiles de build | Sin esto no hay binario distribuible |
| Sección 8 del dominio `jrz-labs.com` | Sin el dominio propio no hay correo real |

---

## Cómo se comprueba cada bloque

Ningún bloque se commitea sin conducir la app en un navegador real y leer lo que sale.
El método está en `docs/verificacion-en-navegador.md` y los scripts en el directorio de
trabajo temporal, uno por flujo:

```bash
make -C apps/api dev     # API en el 4000, lee el .env al arrancar
make web                 # Expo en el 8081
node <script>.mjs        # conduce el navegador y falla si algo no encaja
```

Dos avisos que cuestan tiempo si no se saben:

- **Metro sirve bundles cacheados.** Ante un error que el typecheck no ve:
  `pkill -f "expo start"`, `rm -rf .expo node_modules/.cache`, y arrancar con `--clear`.
- **La API tiene rate limiting** y los propios scripts lo disparan. Reiniciarla limpia el
  contador.
