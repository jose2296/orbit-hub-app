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

Un solo editor en las tres plataformas, HTML como formato, en
[ADR 0009](architecture/adr/0009-one-native-editor.md) y
[notes-editor.md](architecture/notes-editor.md). Sustituye a la
[ADR 0007](architecture/adr/0007-notes-editor.md), que era dos editores.

- [x] Resolver si la nota es entidad propia o columna de un elemento
      ([ADR 0008](architecture/adr/0008-note-entity.md): entidad propia; `list_items.notes`
      pasa a llamarse `annotation`)
- [x] Migrar `list_items.notes` a `annotation` y anadir `note` y `note_template` a
      `shareNodeTypeSchema`, con su CHECK y su autorizacion
- [x] Validador del documento: lista blanca estricta de etiquetas, sin DOM
- [x] `noteDocumentSchema` pasa de JSON ProseMirror a HTML validado
- [x] Tabla `notes` + `attachments`, con su migración, e índices de búsqueda
- [x] `note` en `SYNC_ENTITIES` y en `SYNC_WRITABLE_FIELDS`
- [x] API de notas: crear, leer, listar, editar, borrar, con versionado y por papel
- [x] Editor en pantalla con `react-native-enriched-html` y su barra de formato
- [x] Cliente: `note-record`, `useNotes`/`useNote`, caché local y outbox
- [x] `note` en el `pull`, con su rama para compartir una nota
- [x] Pantalla de nota y autoguardado con rebote de 800 ms
- [x] Atajos de markdown (`- `, `## `, `[] `, `> `, ` ``` `) en el editor
- [x] Un `update` se funde en su `create` pendiente, y la respuesta del servidor
      actualiza la versión en la caché
- [x] Plantillas: entidad, ámbitos personal/workspace/público y catálogo de 12
- [x] Búsqueda sobre `plain_text`, en el servidor y en la caché local
- [x] Adjuntos: cola de subida propia, descarga autorizada por nota, `attachment_count` contado
- [x] Verificado en Android (API 35) con dev build: editor, atajos, plantillas, adjuntos,
      sin conexión y ambos temas
- [ ] Publicar una plantilla en el catálogo público (responde `501` a propósito)
- [ ] Verificar en iOS

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
| 20d | Compartir, y el menú del espacio | Hecho y verificado con dos personas. Menú del espacio con editar, compartir y eliminar; invitaciones por correo y por enlace, con rol, caducidad, revocar, aceptar y rechazar | `1aa255b` |
| 21 | Panel con `w`/`h` por tarjeta, colocar y guardar, como el de la app antigua | Hecho y verificado. Las tarjetas son las listas de cada persona, se ponen de un color a otro, se colocan con un lápiz y se guardan con Guardar | `6efb917` |
| 22 | El color de cada espacio, obligatorio | Hecho y verificado. Ocho colores, se elige en el menú del espacio, y las tarjetas del panel se pintan con él | `6efb917` |
| 23 | Escritorio: cajón lateral y ancho máximo | Hecho y verificado a 1280px. En pantalla ancha la navegación pasa a una columna a la izquierda con los espacios y su color, y el contenido se limita a una columna de 720 (1000 el panel) | `2e9ca51` |
| 26 | Compartir de verdad (invitar a alguien) | Hecho y verificado en navegador con dos personas. La API solo tenía `GET /members`: ahora hay tabla de invitaciones, token, correo, pantalla de aceptar y menú de personas | `1aa255b` |

### Sin empezar

| # | Qué se pidió | Notas |
| --- | --- | --- |
| 24 | Al escribir un elemento, si coincide con uno ya completado, ofrecer volverlo a pendiente | Hecho y verificado, de las dos maneras que hacía falta. La **bandeja de completados**, fija abajo, con sus casillas; el **resultado de la búsqueda** con su casilla; y al **escribir el nombre** en el panel de crear, la fila que ofrece devolver a pendientes. Ver abajo |
| 25 | Los detalles con el aspecto de los de la app vieja | Hecho y verificado. Portada a la izquierda con la nota al lado, lema en grande, sinopsis que se despliega, y los datos en una línea con etiquetas. La colección y los similares siguen siendo el carrusel de portadas que pediste | `f703e41` |


### Iconos de los elementos

Hecho y verificado en navegador. 131 iconos en 10 grupos, la clave es **la palabra que se
escribe** ("pan", "pilas", "pastilla"), así que el buscador encuentra lo que se busca sin
tener que traducirlo a otro idioma. Se eligen con buscador, con el color (12) y con el
dibujo (contorno o relleno), y el elegido se marca **con un borde**: el color es lo que
elegiste para el icono, y al marcarlo se perdía.

Archivos: `packages/contracts/src/item-icons.ts` (los 131 y sus grupos), `apps/mobile/src/lib/lists/item-icons.ts` (el buscador y las etiquetas), `apps/mobile/src/lib/lists/item-glyphs.ts` (el dibujo de cada uno, con los dos comprobados), `apps/mobile/src/components/lists/icon-picker.tsx`.

**Un bug que costó encontrar:** elegir un icono y luego un color **borraba el icono**. El
selector mandaba el icono entero en cada cambio, y lo que mandaba era lo que él creía que
tenía la fila, que era el valor de antes de elegirlo. Ahora cada control manda solo lo que
cambia, y la pantalla de la lista guarda el **id** de la fila abierta y no una copia: una
copia se queda vieja en la primera escritura, y el panel se lo devuelve al servidor.

**Otro, y este es de infraestructura:** el proceso del API estaba en pie desde antes de
que existiera el contrato de los iconos, así que rechazaba `icon: "pan"` y un `pull`
borraba lo que habías elegido en el móvil. Parecía un fallo del selector. Merece la pena
un `watch` en el API mientras se tocan los contratos.

### Añadir elementos: un botón, no un formulario

Hecho y verificado. Debajo de la lista ya no hay un formulario: hay **un botón fijo abajo a
la derecha**, y es el mismo botón para todas las listas. En una lista de tareas abre el
panel del elemento para escribirlo con todo (icono, color, etiquetas, urgencia); en una
lista de películas, series o libros abre el catálogo, porque un título escrito a mano no tiene
cartel y no hay nada que enseñar.

El panel es **el mismo** en los dos casos, con un `mode` de crear: son los mismos campos, y
dos paneles para una fila son dos sitios que dejan de estar de acuerdo.

La fila ya no dice "+ Etiqueta" debajo del nombre, y las etiquetas se editan en el panel.

### Marcar y desmarcar

Hecho y verificado. El panel del elemento tiene una fila con la casilla: "Marcar como hecho"
y, si ya lo está, "Devolver a pendientes". Y la bandeja de completados del punto anterior,
que es lo que hace utilizable en una lista larga.

### Rendimiento con 1000 elementos

Medido con `lista-grande-e2e.mjs`, en Chrome sin cabeza a 430×932, con el servidor de
desarrollo puesto (que es como se mide aquí, y hay que decirlo):

| Qué | Antes | Ahora |
| --- | --- | --- |
| Filas montadas en el DOM al pintar | 420 | **26** |
| Filas visibles a la vez | 7 | 7 |
| 20 saltos de una pantalla | 427 ms, 2 cuadros perdidos | **458 ms, 0 cuadros perdidos** |
| Filas en el DOM tras recorrerla | 470 | **60** |

El cambio fue `windowSize` de 7 a 5 en la lista. Se nota en el arranque y no se nota al
desplazar.

**Y un dato que desactiva la alarma:** abrir la lista de 1000 elements tarda lo mismo que
abrir una pantalla vacía (4967 ms contra 4988 ms de mediana: **-21 ms**). Con 100 elements
tarda lo mismo que con 1000. Los ~5 s son de recargar el *bundle* del servidor de
desarrollo, no de la lista. Por eso el arranque en caliente se mide **restando** una
pantalla vacía: sin esa resta el número no dice nada.

Lo que **no** se ha medido y sigue sin medirse: en un móvil de verdad, con el bundle
minificado, y con la lista abierta mientras se sincroniza. El 97 px de alto por fila es de
la versión de escritorio con etiquetas; en un móvil es más bajo.

### Arrastrar en vivo

Hecho y verificado en el navegador, con el dedo apretado en mitad del camino.

Las filas se apartan mientras arrastras: la que va detrás sube (o baja) una fila y
deja el hueco donde va a caer la que arrastras. Lo que se escribe al final sigue
siendo una sola operación, porque lo que se mueve durante el arrastre es la fila
y no los datos.

**El bug de verdad no era el reordenado: era que no habia `GestureHandlerRootView`.**
Sin esa raiz el gestor de gestos no registra los gestos en la web —no pone
`touch-action: none` a las filas— y el navegador se queda con el dedo para
desplazar la lista. El arrastre no empezaba nunca. Se nota en que el sintoma era
"no se reordena en vivo" y en realidad era "no se arrastra": dos cosas que parecen
la misma y no lo son.

`apps/mobile/src/lib/lists/drag-shift.ts` tiene la aritmética (qué fila se aparta y
hacia dónde, y dónde caería) con 13 pruebas, y el componente la usa. La prueba
del navegador (`arrastre-e2e.mjs`) aprieta, mueve en pasos sin soltar, mira las
posiciones en mitad, suelta y comprueba el orden guardado.

**Lo que NO se ha comprobado:** el arrastre en un móvil de verdad, que es donde
importa. En el navegador funciona; en nativo la raiz tambien esta puesta ahora, pero
no lo he visto en un dispositivo.

### Las acciones van en el header

Hecho y verificado, vista por vista.

- **Lista:** duplicar y eliminar ocupaban media pantalla debajo de las filas. Ahora
  hay un botón de menú en el header, y es **el mismo** `ListMenuSheet` que el de una
  lista dentro de un espacio: dos menús de una lista son dos listas de lo que se
  puede hacer con ella, y dejan de estar de acuerdo.
- **Detalle de una peli:** dos botones de pantalla completa al final del texto
  ("buscar este título" y "marcar como vista"), que además duplicaban los dos
  botones pequeños que ya había al lado del cartel. "Buscar este título" se ha
  bajado al menú de medios, que es donde está el resto de lo que se puede hacer
  con una peli. Los dos botones pequeños se quedan, porque son la acción principal
  de esa pantalla y miden 154 px.
- **Sincronización:** "sincronizar ahora" estaba dentro de una tarjeta y era lo
  único que la tarjeta hacía. Ahora está arriba, con el título.

**Lo que dejo como está, y por qué:** el "cerrar sesión" de ajustes. Es una acción
de página y no de una cosa, y esconderla en un menú la haría más difícil de
encontrar sin ganar nada. Si prefieres que también vaya en el header, se mueve.

La prueba (`header-acciones-e2e.mjs`) no busca el texto: busca el texto **y mide el
ancho del botón que lo lleva**, porque "Marcar como vista" tiene que seguir
 appearing en un botón pequeño al lado del cartel y solo deja de estar bien en uno
de pantalla completa.

### El cajon: empuja de verdad

Hecho, y por fin como se queria: **la app no se adapta, se sale**.

Medido a 430 con el menu abierto: la app mide **430 px igual que cerrada** y lo
visible son sus primeros 146. Las filas siguen midiendo 366 y salen enteras con su
icono y su nombre; la cabecera sigue en una linea. No hay fila apilada, no hay
cabecera partida, no hay nada que se degrade. Lo que se ve es la app entera, cortada
por donde la tapa el menu.

Lo que hacia mal, y eran tres cosas:

- **La app se encogia a 146 en vez de salirse.** El empuje era por ancho, y una app
  de 146 px reordena todo dentro para caber: la fila dejaba de ser fila y el nombre
  desaparecia. Ahora el empuje es por desplazamiento y la app mide lo mismo que
  siempre.
- **`flex: 1` ganaba al ancho que se le ponia.** Su base es 0, asi que el ancho
  explicito no hacia nada y el hijo se encogia igual. Con `flexShrink: 0` y la base
  en `auto`, el ancho manda.
- **La pagina crecia a 714 en un movil de 430** y salia una barra de scroll
  horizontal: el menu empujando te dejaba arrastrar la pantalla de lado. El
  contenedor recorta.

La medida es la que manda: `cajon-ancho-e2e.mjs` comprueba que la app conserva el
ancho de la pantalla con el menu abierto a 430 y a 360, y que las filas no se
encogen.

### Donde verla

Hecho y verificado en el navegador, con datos de verdad. `GET /catalog/providers` en la
API contra el `watch/providers` de TMDB, y una hoja en el detalle, en el menu de medios.

Tres cosas que hace y que una lista de nombres no hace:

- **Dice de que pais responde.** Lo que hay en Netflix en Espana no es lo que hay en
  Mexico, y una hoja que contesta por el pais equivocado te manda a pagar por un
  servicio que no lo tiene. La region sale del idioma de la app y se muestra, para que
  una suposicion equivocada se vea y no sea un misterio.
- **"No esta en nada aqui" es una respuesta.** La region vuelve en la respuesta, asi
  que vacio significa "no hay en ES", no "no se ha podido mirar". Una hoja que se
  abre vacia y no dice nada parece rota.
- **No se abre antes de saber.** Dice que esta mirando.

Los logos son los del propio servicio, del mismo servidor de imagenes que los
carteles: una columna de nombres es una lista que hay que leer, y "Netflix" es una cosa
que se reconoce.

**Un fallo que se ve y no esta arreglado:** TMDB devuelve el mismo servicio varias
veces con nombres distintos ("Movistar Plus+" y "Movistar Plus+ ...", "Amazon Prime" y
"Amazon Prime ...", "HBO Max Amazon"), y la hoja los enseña como tarjetas separadas.
La deduplicacion es por nombre y tipo, y dos entradas del mismo servicio llegan con
nombres distintos. Lo siguiente es deduplicar por logotipo, que es lo unico que
comparten, y decidir que hacer con "HBO Max Amazon" —que es un bundle, no un servicio.

### Compartir: empezar por el esquema

**Parte 1 de 3, hecha: las dos tablas.** `shares` (la concesion: quien, que nodo, que
papel, y `revoked_at` en vez de borrar) y `share_mounts` (donde lo ha colocado quien
lo recibio: que espacio, que carpeta, en que orden, y `placed_at`).

Tres cosas que se decidieron al escribirlas, no antes:

- **Una nota no es una tabla.** La nota es la columna `notes` de un elemento, asi que
  compartir una nota es compartir ese elemento. No hay un cuarto tipo de nodo.
  > **Corregido por [ADR 0008](architecture/adr/0008-note-entity.md).** Era una decision
  > sobre compartir escrita como una afirmacion sobre el modelo de datos, y la Fase 4 la
  > contradice: una nota es un documento ProseMirror y no cabe en un `varchar(2000)`. La
  > nota **si** es una tabla y **si** es un tipo de nodo compartible. La columna del
  > elemento se llama ahora `annotation` y es una anotacion corta, no una nota. El texto
  > de arriba se deja como estaba porque en su momento era la decision que se tomo.
- **`revoked_at` y no borrar la fila.** El que lo recibio tiene que enterarse de que
  dejo de estar, y un movil que estaba sin conexion necesita algo que leer en su
  proximo `pull`. Una fila desaparecida es indistinguible de una concesion que nunca
  existio.
- **`placed_at` a null es lo que separa "lo he recibido y no lo he puesto" de "esta
  en la carpeta de Viajes".** Sin esa columna no hay forma de saber que filas son las
  de "compartido conmigo" y cuales ya estan colocadas, y las dos cosas se
  confunden.

La migracion la genero `drizzle-kit` desde el esquema, y a mano solo lo que el no sabe
expresar: los dos CHECK de columna (`node_type` y `role` con cuatro y dos valores) y
los dos **indices parciales** — el de concesiones vivas, que se pregunta en cada
borrado para decir a cuantos les afecta, y el de lo no colocado, que se pregunta cada
vez que se abre "compartido conmigo". Un indice parcial no es una 查询 mas rapida: es
que la consulta se responde con el indice en vez de recorriendo lo que esa persona ha
colocado.

**Lo que sigue, y es lo gordo:** el sync. Un `pull` tiene que traer lo compartido y un
`push` tiene que dejar escribir en un nodo donde no eres miembro pero si tienes
concesion. Sin esa tercera parte las dos tablas son decorativas y la app no puede
enseñarte nada.

### Compartir: parte 2, el servicio

Hecho y probado contra la base de verdad, 8 pruebas de extremo a extremo del servicio.

`createShare`, `revokeShare`, `placeShare`, `inbox` y `whoHas`. Lo que se ha decidido
al escribirlas y no antes:

- **El orden dentro del servicio es el servicio.** Primero que el nodo exista y tenga
  nombre, despues que quien comparte pueda compartir, y despues que no se comparta
  consigo mismo. Un orden distinto deja filas a medias.
- **Compartirte a ti mismo es un error explicito**, y no por descuido. `access.ts` saca
  el techo de las membresias, y quien no es miembro de nada no tiene techo: un
  auto-compartir seria **la unica via** para sacar editor sobre una lista en el espacio
  de otro. Ese es el agujero que la regla de permisos no coge.
- **Quien recibe elige el sitio, y el sitio se comprueba.** Un montaje en el espacio de
  otro seria compartir por la puerta de atras, y una carpeta de otro espacio con el
  id del tuyo es un `folder_id` que no pertenece ahi.
- **La bandeja solo trae lo no colocado.** En cuanto eliges donde va, esa lista es de
  un espacio tuyo y la bandeja ha hecho su trabajo.
- **`whoHas` es la pregunta de un borrado**: "esto va a desaparecer de dos sitios". Y
  cuenta solo concesion vivas, porque una revocada no le afecta a un borrado.

**Un fallo mio de una hora, y es el segundo del mismo tipo:** el helper de push de la
prueba no mandaba `clientTimestamp`, que el contrato exige, y las cuatro operaciones
salian rechazadas sin decir por que. Es el mismo `clientTimestamp` que me hizo perder
tiempo en la prueba de iconos hace unas horas, en el otro bando. El mensaje de
rechazo es generico a proposito —no filtra que espacios existen—, asi que en el test hay
que sacar el motivo del log del servidor, y eso se me hizo evidente tarde.

### Compartir: parte 3, el push deja escribir en lo compartido

Hecho y probado. Una lista compartida ya se puede **tachar** desde el movil de quien la
recibio, sin que sea miembro del espacio.

`assertCanWrite` miraba solo la membresia del espacio, asi que una lista compartida era
una lista que se podia mirar y no tocar — y a nadie le dijeron eso cuando se compartio.
Ahora el nodo se consulta tambien: si no eres miembro pero hay una concesion viva que
llega a el, `accessOf` decide. Y el 404 por "no tienes acceso" se sigue pareciendo
exactamente al 404 de "esto no existe".

**Tres fallos que ha encontrado la prueba, y los tres eran de los que no se ven leyendo
el codigo:**

1. **Una concesion sobre una lista no llegaba a sus elementos.** La cadena de
   antepasados incluia el elemento, el espacio y la carpeta de la lista — pero no la
   lista. O sea que "comparte esta lista" y "comparte esta lista vacia" eran lo mismo, y
   el que la recibio no podia tachar nada. Es justo el caso que nadie probaba.
2. **Un array metido en `sql` crudo no sale como una lista de un `IN`.** Sale como un
   parametro, y la comparacion no encuentra nada: cero concessiones visibles, en
   silencio. `inArray` es lo que sabe traducirlo.
3. **Solo cablee la rama de creacion y no la de actualizacion ni la de borrado**, que
   son las que de verdad usa la app para cambiar una fila. Por eso la prueba de tachar
   —que es un `update`— seguia dando "Workspace not found".

Y uno mio de antes, que ha salido aqui tambien: **resolver el nodo antes de comprobar
la membresia cambia el mensaje de error de un id que no existe**, y eso filtra que ids
son reales en un espacio que no has visto nunca. Rompio un test previo que justo
comprueba eso. Ahora la resolucion se traga su fallo y se cae al 404 de siempre.

**Lo que queda de la parte 3: el `pull`.** Un `pull` tiene que traer lo compartido, y
eso no es coser un filtro mas: el pull va por cursor y por fecha, y traer "todo lo que
cuelga de una carpeta compartida" es recorrer un subarbol, que no cabe en esa forma.
La decision que propongo es traer **las cadenas** —el nodo compartido y sus
antepasados— y que las listas de dentro lleguen segun cambien, una a una, en orden de
cursor, que es como la app ya se come los cambios. Lo escribo aqui para que quede
decidido y no se pierda.

### Compartir parte 3b: rutas HTTP y el pull

Hecho y probado. `POST /shares`, `DELETE /shares/:id`, `POST /shares/:id/place`,
`GET /shares/inbox`, `GET /shares/:nodeType/:nodeId/reach`.

**Por que `/shares` y no dentro de `/workspaces` o de `/sync`.** Porque lo que se
comparte no es un espacio, y metido ahi diria que si. Y porque una concesion es un acto
entre dos personas, no contenido que alguien edita sin conexion: no se puede encolar en un
dispositivo que ya no es de nadie, ni aplicar dos veces por un reintento que la segunda
vez significa otra cosa. Es el mismo razonamiento que sazo las invitaciones a su propia
tabla.

**El pull trae las cadenas, no los subarboles.** El pull anda por cursor y por fecha, y
"todo lo que cuelga de esa carpeta" es recorrer un arbol en mitad de una consulta que
deberia ser un trozo de linea de tiempo. Lo que un nodo compartido necesita para llegar
es **su cadena**: el, su lista, su carpeta y el espacio, porque un movil no puede pintar
una lista sin carpeta. Lo que cuelga *dentro* de una carpeta compartida llega en orden de
cursor como cualquier otra cosa, fila a fila, segun cambia, y la app no necesita saber que
esta compartido.

**Dos fallos reales de esta parte, y el segundo es el clasico:**

1. El filtro de cada entidad es un **"o"** entre "esta en un espacio tuyo" y "esta en una
   cadena". Escribi primero un "y" y hacia desaparecer justo lo tuyo que no estuviera en
   ninguna cadena compartida. Hay una prueba que lo coge, porque es el fallo que solo se ve
   en produccion.
2. `GET /shares/:nodeType/:nodeId/reach` resuelve el nodo **antes** de mirar si puedes
   verlo, y un id que no existe respondia "no found" con un mensaje distinto al del
   "existe pero no es tuyo". Eso convierte un 404 en un manera de averiguar que ids son
   reales. Ahora comprueba el acceso y, si no llega, cae al mismo 404.

### Compartir parte 4: la app, la bandeja y el aviso de borrar

Hecho. El cajon tiene "Compartido conmigo" con lo que te han pasado y no has
colocado, y al tocarlo sale un panel que pregunta en que espacio de los tuyos va.
El aviso de borrar dice a cuantas personas afecta y quien son, antes de confirmar. Un
espacio que te han compartido lleva un simbolo en el menu.

**La bandeja no es offline-first, y el motivo es el mismo que da la API:** una
concesion es un acto entre dos personas decidido en el servidor cuando alguien pulsa un
boton. Una copia cacheada de "compartido conmigo" puede estar equivocada sobre si quien
te lo mando sigue queriendote en su lista — y la bandeja es justo la pantalla donde
equivocarse importa, porque lo que ofrece es "pon esto en mi espacio".

Lo que **si** funciona sin conexion es la cosa en si: creada la concesion, el sync
baja la lista como cualquier otra, y puedes tacharla en modo avion. Ver la bandeja
necesita red; usar lo que te dieron no.

**Tres decisiones que no eran obvias:**

1. **"Compartido conmigo" solo aparece cuando hay algo.** Con la vacia son dos lineas
   diciendolo, para siempre. Y un encabezado que esta siempre deja de leerse, que es
   justo cuando haria falta.
2. **El papel de un espacio compartido es el mas amplio de tus concesiones.** Alguien
   con una lista en solo lectura y una carpeta con permiso de edicion esta en ese
   espacio como editor, porque es lo que va a encontrar al entrar. Si saliera el
   primero que llego, entraria pensando que no puede tocar nada.
3. **`shared` es una bandera, no un papel.** Un `viewer` invitado y un `viewer` al que
   le compartieron una lista son el mismo `role` y no la misma cosa: el primero es
   miembro y el segundo tiene a alguien al otro lado que puede quitarselo. Con un solo
   campo, el simbolo iba a caer en los espacios equivocados.

**Un fallo mio que cago la prueba de traducciones:** puse el mismo texto en
`.one` y en `.other` del contador de la bandeja, con `{count}` en los dos. Funciona y
por eso no se ve: sale "Compartido conmigo · 1" bien. Pero es un plural que no
pluraliza, y la prueba de las frases que la app promete al compartir (que comprueba
las oraciones enteras, no que la clave exista) lo cazo a la primera.

Queda: la deduplicacion de proveedores por `logoPath` en "Donde verlo", y el aviso
dentro de la app a quien le revocan algo.

### Compartir parte 5: revocar de verdad, y los duplicados de "donde verlo"

Hecho y probado. Al revocar, el pull manda un **entierro** del nodo, asi que el movil
que ya lo tenia cacheado lo borra de verdad. Y "donde verlo" ya no sale con el mismo
servicio dos veces.

**Revocar sin el entierro era un fallo seriouso que se escribio como si no pasara.** El
filtro de cadenas deja de traer filas nuevas, pero la fila que ya esta en la cache es
*tuya* y nada en el flujo del cursor dice que dejo de serlo. La persona seguia viendo la
lista en el menu, y sin conexion hasta podia editarla. Parar de traer no devuelve lo que
ya te trajeron. El entierro es un tombstone —`deletedAt` puesto, la misma forma que
produce un borrar— y no un tipo de entidad nuevo, porque la app ya filtra `deletedAt` para
sus propios borrados y una segunda manera de decir "desaparece" seria una cosa mas que
aprender en cada lectura.

**El nodo tiene que mover su propio reloj al compartir y al revocar, y esto no se ve
leyendo el codigo.** El pull es un paseo por el tiempo y el cursor es una fecha, asi que
la unica forma de que un dispositivo se entere de un nodo es que su `updatedAt` sea
posterior a donde lo dejo. Compartir una lista que no se toca desde el martes no mandaba
nada: la fila no es mas nueva que el cursor, el cursor no avanza, y el movil —que acababa
de recibir un entierro de esa lista, o que nunca la tuvo— no se entera de que existe. La
concesion es nueva y nadie la esta mirando. Se marca el **nodo**, no la concesion, porque
el timestamp de la concesion no esta en el flujo que lee el cliente. Y no es mentira: el
conjunto de lectores del nodo cambio de verdad en ese momento, que es lo unico que
`updatedAt` deberia significar.

**Un bug de verdad, de los que el comentario ya describia bien y nadie ejecuto:** al
volver a compartir tras revocar, `createShare` insertaba **antes** de mirar la fila
previa, y hay un indice unico en (nodo, persona). Chocaba contra el indice. El codigo de
abajo tenia el comentario correcto sobre el diseno y la rama estaba despues del insert,
y todas las pruebas compartian una vez y paraban. El orden de las ramas no es un detalle
de estilo: es lo unico que separaba "volver a compartir" de "error de base de datos".

**El cursor lo lleva el cliente y el servidor solo lo guarda.** Lo decia el subagente al
depurarlo y es la razon de que dos pruebas dieran el mismo sintoma por causas distintas:
una mandaba `lastPulledAt` en vez de `cursor` (el esquema tiene `null` por defecto, asi
que no falla: baja la historia entera desde 1970 y "el entierro vuelve siempre" pasa a
ser la respuesta correcta), y las otras no devolvian el cursor, que es un movil que ha
perdido el sitio.

Y **"donde verlo" deduplica por logo, no por nombre**, porque los nombres son lo que
discrepa: hoy en Espana una peli viene con "Movistar Plus+" y "Movistar Plus+ Utd", y
"Amazon Prime" junto a "Amazon Prime Video". Se queda el nombre **mas corto**, y no por
gusto: las variantes de TMDB son el mismo nombre con un calificador pegado al final
("Utd", "Espana", "International"), y quedarse con la mas larga deja el nombre interno del
distribuidor en vez del que se dice de viva voz. **El mismo servicio en suscripcion y en
alquiler son dos tarjetas, a proposito** —la tienda de Apple es dos decisiones y un
precio distinto— y los **paquetes se dejan en paz**: "HBO Max Amazon" tiene su logo y su
suscripcion, y fusionarlo con cualquiera de las dos partes dira a alguien que pague a la
que no es.

### Compartir parte 6: el boton de compartir

Hecho y verificado en navegador. "Compartir" es una **pagina del panel del menu de la
lista**, no un panel encima del otro. Dos paneles en una pantalla son dos fondos, y un
toque que llega al que no toca cierra lo de debajo en vez de hacer lo que se le pidio.

El panel dice **que es un vinculo antes de que pulses nada**, y nombra los papeles desde
quien los recibe: "Podra editarla" / "Solo podra verla". Y no es offline-first, ni la
concesion: una concesion se decide en el servidor cuando alguien pulsa ese boton, y
encolarla seria decir que funciono cuando aun no se ha decidido.

### Los 27 `accessibilityHint` de la app no existen en web

**Encontrado al mirar una captura, no el codigo.** `accessibilityHint` es una prop de iOS.
react-native-web 0.21.2 **no tiene la cadena en ningun sitio del paquete** y filtra las
props por una lista blanca estricta, asi que en web la pista se borra en el limite del
`<View>`: sin atributo ARIA, sin fuga como atributo desconocido, sin aviso. Las 27
pistas de esta app funcionan en un movil y no existen en un navegador, y ni el DOM ni la
consola lo dicen. Una auditoria de accesibilidad no puede encontrar un hueco que no
deja rastro.

Hecho en los **27 sitios, 12 ficheros**, y verificado midiendo, no mirando el codigo.

**El destino en web es `aria-describedby`, que quiere el id de un elemento**, no una
cadena — asi que el texto tiene que existir en el documento. De ahi el nodo oculto: esta
en el arbol de accesibilidad, no se pinta, y no lo lee nadie que este mirando la
pantalla. Fuera de pantalla y no con `display: none` ni `opacity: 0`, porque los dos lo
sacan del arbol, que es justo para lo que esta.

**El nodo va siempre como HERMANO, nunca envuelto**, y en fragment si hace falta. Un
`View` alrededor habria roto `position: absolute` (el boton flotante de la lista, el
asa de reordenar, el boton de menu de la tarjeta), `flex: 1` (las tarjetas del panel, que
viven en celdas absolutas) y `alignSelf: stretch` (los botones con `fullWidth`). Y donde
el `Pressable` esta dentro de un `.map` —los destinos y los espacios del cajon lateral,
las filas de la bandeja de completados, las opciones del panel— **no se puede llamar al
hook en el bucle**, asi que se extrajo un componente por fila.

**Dos bugs que aparecieron al hacerlo y que no eran hipoteticos:**

1. **El helper devolvia `{}` en nativo**, y en los dos primeros sitios habia quitado el
   `accessibilityHint` del `Pressable` al poner el spread. Es decir: arreglar un bug de
   web habia **borrado la pista de iOS y Android**, que antes funcionaba. Ahora el
   `props` lleva `aria-describedby` en web y `accessibilityHint` en nativo, y ninguna
   plataforma pierde lo que ya tenia.
2. **El nodo se comia un pixel en la esquina del control.** Medido: con
   `position: absolute` sin `left`, el nodo cae en el pixel superior izquierdo del
   boton al que pertenece, y `elementFromPoint` ahi devuelve la pista en vez del boton.
   Un pixel, en una esquina, nunca en el centro — o sea que no habia nada visiblemente
   roto ni nada pulsable por error, pero "nunca en el centro" es una propiedad de la
   maqueta y no una garantia. Resuelto con `left: -9999`, medido: **11 945 sondeos de
   `elementFromPoint` (centro, 4 esquinas y una rejilla de 10 px sobre tres pantallas) y
   cero contaminados**, cero `aria-describedby` rotos, y `scrollWidth` 430 = `clientWidth`
   430, o sea que el nodo no crea scroll.

**Y un decision de producto, no de layout:** en las opciones del panel **no** hay pista.
La descripcion ya esta pintada dentro del boton, asi que un lector de pantalla la llega
sola; apuntar `aria-describedby` a una segunda copia es decir lo mismo dos veces —una
como contenido del boton y otra como su descripcion— y la que solo es pista es la que
la gente aprende a saltar. La pista es para lo que no esta en pantalla: lo que explica
que va a hacer un boton cuyo nombre no lo dice.

**Comprobado en el arbol de accesibilidad real** (CDP `Accessibility.getFullAXTree`, no
solo que el id exista):
`role=button name="Documentacion Pistas" description="Abre la carpeta dentro de Documentacion Pistas."`

### Lo que ya no hace falta decidir

- **Orden manual por persona o por lista:** por lista. Todos los colaboradores ven el
  mismo orden, que es lo único que hace que la lista que ordenó otro siga significando
  algo. Decidido y hecho.
- **Si se puede arrastrar en otro orden:** no. Solo en manual, y la lista lo avisa.

---

## Tanda del 28 de septiembre — interfaz 🟡

Todo lo pedido de una vez el 28 de septiembre de 2026, en el orden en que se puede
comprobar. Se trabaja **de una en una** y cada una se cierra conduciendo la app, no
leyéndola.

Dos decisiones van antes que nada, porque **cambian la forma del header** y por lo tanto
invalidan el trabajo de la fila 1 y la 2 si se elige mal:

- **D1. ¿Se quitan las tres pestañas de abajo?** Si el panel pasa a ser pantalla del
  `Stack`, su cabecera hecha a mano deja de tener sentido y unificarla es natural. Si
  las pestañas se quedan, la unificación se hace sobre las dos cabeceras que hay hoy.
- **D2. El `+` con submenú, ¿genérico desde el principio?** Va a decir "lo reutilizaremos
  en más sitios", y genérico de verdad es decidir la API antes del primer uso.

Leyenda: ✅ hecho y comprobado · 🟡 en curso · ⬜ sin empezar · ⛔ esperando decisión

| # | Qué se pidió | Dónde | Estado | Cómo se comprueba |
| --- | --- | --- | --- | --- |
| 1 | La hamburguesa en todas las pantallas, **con márgenes**, no pegada al borde | `app/(app)/_layout.tsx` | ✅ **ver abajo** | Margen del botón de menú en las 8 rutas: **12 px en las ocho** |
| 2 | Toda pantalla con acciones las tiene **en el header** | `components/ui/header-action.tsx`, `app/(app)/_layout.tsx` | ✅ **ver abajo** | El lápiz del panel está en la cabecera: medido 40×40, a 12 del borde, a 20 del margen |
| 3 | En espacio y carpetas los items **sin degradado**, color plano | `lib/workspace/color.ts` (`spaceTint`), `folders/folder-browser.tsx` | ✅ | `scripts/verify-app-regression.mjs`, y contando `LinearGradient`: solo queda el de la cabecera del espacio |
| 4 | En listas de películas/series: al pasar por recomendados o colecciones, **añadir a la lista** y **ver siempre** tráiler y proveedores | `components/catalog/catalog-result-row.tsx`, `item/[itemId].tsx` | ⬜ | Navegar el carrusel y comprobar que el botón de añadir y el de "dónde verlo" están sin entrar a la ficha |
| 5 | **Revisión visual** de todas las pantallas | todas | ⬜ | Capturas de las 19 rutas en claro/oscuro y móvil/escritorio, revisadas a ojo |
| 6 | El selector de workspace: en **"Termina en"** los colores no enseñan el degradado | `workspace/workspace-color-picker.tsx` | 🟡 **ver abajo** | Comparar las muestras con la previsualización grande, con los dos extremos en colores **distintos** |
| 7 | **Quitar el input de texto** del color (ya hay picker) | `workspace/workspace-color-picker.tsx` | ✅ | El campo de hexadecimal no está |
| 8 | **Colores recientes** en cada tab, sobre todo en el otro para poder hacer degradado a partir de ahí | `lib/workspace/recent-colors.ts`, `workspace/workspace-color-picker.tsx` | ✅ | Poner un color a mano, cerrar, reabrir: está en recientes de los dos tabs |
| 9 | **Quitar las pestañas de abajo** | `app/(app)/_layout.tsx` | ✅ **ver abajo** | No hay barra inferior; panel, buscar y ajustes se llegan por el cajón |
| 10 | En workspaces: el `+` abre el **formulario de editar/crear** abajo a la derecha, como el resto | `app/(app)/workspaces.tsx`, `components/workspace/workspace-create-sheet.tsx` | ✅ | El `+` de la esquina abre un formulario con nombre y color; al guardar aparece el espacio y se entra en él |
| 11 | Icono de carpeta con **solo trazo**, como en el resto | `app/(app)/workspaces.tsx` | ✅ | Un espacio sin emoji propio se dibuja con `folder-outline`, no con el emoji `📁` |
| 12 | En workspaces, **quitar título y descripción** (la cabecera ya tiene el título) | `app/(app)/workspaces.tsx` | ✅ | El título sale **una vez**, en la cabecera; la pantalla empieza por la lista |
| 13 | Botón de **añadir página** en el panel | `components/dashboard/panel-grid.tsx`, `db/constants.ts`, migración `0014` | ✅ **ver abajo** | El ⊕ de la barra añade una pantalla y **sobrevive al guardado**: `pages` sale en caché y en el *outbox* |
| 14 | El `+` del panel abre **submenú** de añadir item o página | `components/ui/add-menu.tsx`, `panel-grid.tsx` | ✅ **ver abajo** | El `+` ofrece «Tarjetas» y «Una pantalla», y cada una hace lo suyo |
| 15 | En el picker dentro de un bottom sheet, **arrastrar no cierra el sheet** | `workspace/workspace-color-picker.tsx` | ✅ | Arrastrar la pista de saturación y comprobar que el sheet sigue abierto |
| 16 | Cabeceras de carpetas y módulos **sin color de fondo**, e identificar el espacio de otra manera | `folder/[folderId].tsx`, `list/[listId].tsx` | ⬜ | Decisión de producto abierta: punto de color en el título, espacio en las migas, chip de espacio, o tinte en la cabecera |

### Las ideas de la fila 16

Ninguna vuelve a poner el degradado en una cabecera, que es lo que estorba. De menos a
más invasiva:

1. **Un punto del color del espacio** junto al título. Lo más barato: cero layout, se lee
   a cualquier tamaño, y `SpaceDot` ya está hecho.
2. **El espacio en las migas, con su color**: "Regresion / Personas", donde *Regresion* va
   en el tinte del espacio. Informa y ya existe el componente.
3. **Un chip de espacio** pulsable junto al título, que abra el selector de espacios.
   Además de identificar, sirve de navegación rápida.
4. **Tinte sutil del `surfaceMuted` del espacio** en el fondo de la cabecera. Delata el
   espacio sin gritar, pero tiñe toda la barra.
5. **El emoji del espacio** —que ya es un campo— junto al título.

**Recomendación: 1 + 3.** Identifican sin ruido, no pelean con el tema, y el chip resuelve
además "estoy en un espacio de doce y no sé cuál".

### La fila 6, lo que se sabe y lo que no

No se ha cerrado y **no se va a cerrar a ojo**. Lo que se ha medido:

- El código pasa `colorKey={par.desde}` y `colorToKey={par.hasta}` a las dos muestras
  **igual en los dos tabs**. No hay ninguna ruta en la que un tab enseñe el degradado
  y el otro no: es el mismo componente con el mismo `par`.
- Con los dos extremos en el **mismo** color el degradado no se ve, y no se ve en
  ninguna parte: tampoco en "Así se verá" cuando los dos extremos son iguales. Eso no
  es un fallo, es una resta de un color consigo mismo.
- Donde **sí** se ha visto una discrepancia de verdad: con los dos extremos iguales,
  las muestras "Diagonal" y "Vertical" salen **planas** y la previsualización grande
  "Así se verá" sale **degradada**. Las dos deberían enseñar lo mismo, y no lo enseñan.

Lo que hace falta para cerrarlo: un caso concreto. Con los dos extremos en colores
distintos, una captura de cada tab, y decir cuál de las dos muestras es la que falta.

### La fila 7 y la 8, hechas

El campo de hexadecimal fuera, y los recientes por extremo con **los dos en la misma
fila**: en "Termina en" se ofrecen los colores que se usaron en "Empieza en", que es lo
que permite hacer un degradado *desde* un color en vez de buscarlo dos veces.

Comprobado en el navegador: la fila no aparece hasta que se usa un color (un
encabezado sobre cuatro círculos vacíos es algo que leer sin motivo), aparece en el
primer tab al pulsar una muestra, y aparece en el segundo con lo del primero.

**Un bug que salió al hacerlo, y es de los que no se ven:** las muestras de la paleta
llaman a `escribir(color.key)` — `"rose"`, no un hexadecimal — y `rememberColor`
descarta en silencio lo que no tiene forma de color. La fila no aparecía nunca y
parecía un problema de estado. El tipo del parámetro era `string` en los dos sitios y
los dos eran correctos: lo que no se podía saber leyendo es que una de las dos
vocablos es una clave y la otra un color.

### Las filas 1 y 2: una sola cabecera en toda la app

Había **dos cabeceras**: la que dibuja el `Stack` y la que las tres pestañas se
hacían a mano. De ahí el margen que se veía, que medido era peor de lo que parecía:

| Pantalla | Margen del botón de menú |
| --- | --- |
| Pestañas (panel, buscar, ajustes) | 8 px |
| Stack (espacios, listas, sync, dispositivos, catálogo) | **−8 px** |

En las pantallas del `Stack` el botón **empezaba en −8 con 40 de ancho**: ocho píxeles
fuera de la ventana, no pegados al borde sino cortados. Dos implementaciones de la
misma idea y nada que las mantuviera de acuerdo.

Las tres pestañas ahora usan la cabecera del `Stack` — sin la suya — así que hay
**una sola** en la app, y las ocho rutas miden lo mismo: **12 px de margen, botón de
40, a 12 del borde**.

Tres cosas que salieron al hacerlo, y ninguna la enseña el typecheck:

1. **El margen no es un `padding`, es una corrección.** `headerLeft` no empieza en
   cero: coloca su contenedor en **x = −8**. El `paddingLeft` vale `xs + lg` (4 + 16)
   y no un 12 redondo, porque tiene que restar 8 de voladizo más el margen que se
   quiere. Un 12 a secas deja el botón en 4.
2. **Dentro de una pestaña, `setOptions` va a la pestaña.** `useNavigation()` es el
   navegador de pestañas, así que el título se puso en la **etiqueta del icono** —la
   barra de abajo decía «Hola, Regresion»— y el `headerRight` se perdió entero: el
   lápiz no aparecía. `useScreenTitle` y el panel ahora suben al `Stack` con
   `getParent()`.
3. **La flecha de atrás no tenía a dónde ir.** En las tres raíces `canGoBack()` es
   falso y el botón se dibujaba igualmente, junto a una hamburguesa que sí funciona.
   Un flecha muerta al lado de una viva hace desconfiar de las dos.

La fila 2 queda a medias y por una razón concreta: el pencil y el Guardar del panel
ya están en la cabecera, pero **quitar las pestañas de abajo (fila 9) sigue sin
decidirse**, y hasta que se decida hay pantallas que llevan a un sitio y a otro.

### Las filas 10, 11 y 12

**La 12** era la más fácil y la más vista: la cabecera ya decía «Espacios de trabajo» y
la pantalla lo repetía debajo, con su línea de «cada proyecto tiene su propio sitio»,
antes de haber mirado un solo espacio. Medido después del cambio: el título aparece
**una vez** en la página entera.

**La 10** era un formulario entero al final de la lista. Es decir: la única manera de
crear un espacio era bajar más allá de la lista de los que ya tienes, y el formulario
no tenía color, así que un espacio nacía gris y había que visitarlo y editarlo para
que dejara de serlo. Ahora el `+` de la esquina —el mismo botón y en el mismo sitio
que en el resto de pantallas— abre un formulario con el nombre y el color juntos, que
es lo que hace el menú de un espacio que ya existe.

Comprobado de punta a punta: se abre la hoja, se escribe el nombre, se elige un color
por su nombre accesible («Rosa»), se pulsa Crear, **la hoja se cierra, el espacio
aparece en la lista y se entra en su pantalla**. El badge dice «1 cambio sin subir»,
que es la conducta local-first funcionando y además la prueba de que la escritura
quedó en cola en vez de evaporarse.

**Un texto que se quedó colgando:** el pie de esa pantalla decía «usa el campo de arriba
para crear otro». Ese campo ya no existe, así que la instrucción apuntaba al vacío.
Ahora dice «el botón + para crear otro». Borrar una cosa y no sus referencias es la
mitad del trabajo de borrar una cosa.

**La 11** era un emoji 📁: relleno, multicoloreado y del sistema, la única marca
rellena de la app y la única de la pantalla cuyo color no tenía que ver con el
espacio. Las filas de carpeta ya usaban `folder-outline`; el que quedaba era la
reserva de la lista de espacios, y ahora es el mismo glifo de trazo. Un espacio con
emoji propio lo conserva, que ese es de la persona.

### D1: fuera las pestañas, y lo que salió al hacerlo

Las tres destinos —panel, buscar y ajustes— son ahora pantallas del `Stack` de la app, y
la barra de abajo no existe. Comprobado en las tres: **no hay barra**, el menú las tiene
las tres, y pulsar «Buscar» en el menú lleva a `/search`.

De paso: **el indicador de la ruta activa del cajón nunca funcionó**, y ahora sí. Se
comparaba `usePathname()` —la URL— con la ruta del router, y para el panel eso es `/`
contra `/(app)`, que nunca son iguales. Ahora cada destino lleva las dos direcciones y se
compara con la correcta.

Y al quitar las pestañas desapareció **el segundo navegador entre la cabecera y la
pantalla**, que es lo que de verdad estaba costando. Y destapó tres bugs que estaban
escondidos detrás:

### Una pantalla no puede escribir en la cabecera que dibuja el layout

`navigation.setOptions({ title, headerRight })` desde la pantalla **no funciona en esta
app**, y no es culpa de la pantalla. Un `<Stack.Screen>` del layout que lleve cualquier
`options` las vuelve a aplicar en cada render del layout, y volver a aplicarlas
**reemplaza el objeto entero** de opciones de esa pantalla. El layout gana siempre.

Medido, tres veces distintas según lo que se le quitara al layout:

| El layout declara | Lo que se ve |
| --- | --- |
| `title: "Inicio"` | La cabecera dice «Inicio» y el saludo se pierde |
| nada | La cabecera dice **`index`**, el nombre de la ruta |
| `headerShown` | El saludo tampoco aparece |

Y la ranura derecha —que existe, 297 px de ancho— salía **vacía** en todas.

**La solución va al revés de lo natural:** el layout dibuja la cabecera y llena sus
ranuras, y la pantalla *publica* lo que va en la derecha. `components/ui/header-action.tsx`
es esa pieza: un proveedor en el layout, `useHeaderAction` en la pantalla, y el valor es
una **función** y no un elemento, para que nada se compare por identidad.

Tres cosas que salen al hacerlo y que ninguna está en el typecheck:

1. **Un componente no puede proveerse un contexto a sí mismo.** El layout leía el valor
   que él mismo publicaba, y como está *fuera* de su propio proveedor le llegaba el valor
   por defecto: ranura vacía y un `setAction` que no hacía nada. Por eso ahora son dos
   componentes, el que provee y el que navega.
2. **`useCallback` con `useA11yHint` en las dependencias no es estable.** Ese hook
   construye su objeto en cada render, así que la función que se publica era nueva
   siempre, el efecto se re-disparaba, y la app entraba en
   `Maximum update depth exceeded` con la pantalla en blanco. La referencia va **dentro
   del hook**, no en el `useCallback` de quien lo llama: una cabecera que solo se puede
   llenar acertando las dependencias no es una cabecera, es una trampa.
3. **Una función pasada a un setter de `useState` no es un valor: es un actualizador.**
   `setAction(estable)` guardaba lo que la función **devuelve** —el elemento del botón— y
   la cabecera acababa intentando llamar a un elemento. El error salía de dentro de la
   cabecera, con la pantalla en blanco y sin nada en el árbol que señalara el sitio.
   `setAction(() => estable)` lo arregla y **no se ve ni revisando la línea**: es un
   carácter más y nada más.

### D2 y las filas 13 y 14: un `+` que decide, y pantallas que existen

**El submenú** (`components/ui/add-menu.tsx`) no es un panel con dos filas: es la regla
completa. **Una opción hace la cosa; dos abren un menú.** El panel tenía una, así que su
`+` iba directo al selector de tarjetas — que era lo correcto mientras fuera una — y en
cuanto hubo una segunda cosa, ese mismo botón tuvo que elegir. Comprobado: el `+` ofrece
«Tarjetas» y «Una pantalla», y cada una hace lo suyo. La regla está en un hook y no en
cada pantalla, así que añadir una tercera cosa no mueve el botón ni le da un gemelo en
otra esquina.

**La fila 13 no era un botón: era un dato que no existía.** El número de pantallas se
*derivaba* —la más alta con una tarjeta, más una—, así que una pantalla sin tarjetas no
existía, y un botón que añadía una añadía una que se borraba al guardar. Es el peor
género de botón: hace algo, y luego no lo ha hecho.

Ahora el número **se guarda**. De punta a punta:

- una **migración** (`0014_dashboard_pages.sql`) con la columna, y el esquema, el
  repositorio y el servicio guardándola y saneándola **entre 1 y 8**;
- `SYNC_WRITABLE_FIELDS.dashboard` pasa a admitir `pages` — el servidor solo guardaba
  `layout` y tiraba el resto del payload;
- `pageCount(layout, pages)` en el panel, y `useDashboard` lo lee de la fila en vez de
  tenerlo en estado, porque una fila que llega de un *pull* o de otro dispositivo deja
  obsoleto un número guardado en memoria.

Comprobado de punta a punta: sembradas dos pantallas, el ⊕ de la barra lleva a **tres
puntos**, se pulsa Guardar, y **`pages: 3` sale en la caché y en la operación del
*outbox***. La escritura existe, que es la parte que antes fallaba en silencio.

Tres cosas que salieron, ninguna en el typecheck:

1. **La ranura de la derecha era una fotografía.** El valor que publica la pantalla es
   una función estable, así que el layout **no se vuelve a dibujar** cuando el estado de
   la pantalla cambia: el lápiz se quedaba puesto con `editing` ya a `true`. Medido
   así: el clic sí funcionaba —la pantalla se re-renderizaba y el log lo decía— y la
   cabecera seguía diciendo «Colocar las tarjetas» sin Guardar en ninguna parte. El
   contexto lleva ahora una `version` que la pantalla invalida cuando su botón cambia, y
   el layout la lee **para eso**, sin usarla. Se ve como una línea leída y tirada, y es
   todo el arreglo.
2. **`screens` leía la prop, no el borrador.** Añadir una pantalla no cambiaba nada hasta
   guardar, y el botón parecía no hacer nada. El número que estás mirando tiene que ser
   el que estás editando.
3. **La sincronía con lo que llega de fuera solo puede crecer.** Poner el recuento
   «a lo que dice la fila» deshacía en silencio la pantalla que alguien acababa de
   añadir, en cuanto un re-render pasaba un array nuevo e igual por delante.

### El sync que se había perdido: no se había perdido

Dos rondas marcando `y llega al servidor` en rojo, con un item que salía en la lista y
no aparecía en el servidor. Estaba anotado como «la mitad de un bug» y como posible
pérdida de datos. **Era la comprobación.** `verify-app-regression.mjs` pedía
`{ since: null, limit: 500 }` y grepeaba la respuesta, pero el pull contesta
`{ changes, nextCursor, hasMore }`: con más de 500 cambios en la base devuelve solo la
**página más antigua**. El item recién creado es el cambio más nuevo, se cae por el
final, y el test informaba de un sync que funcionaba como de uno que perdía la
escritura.

Medido: la base tenía **501 cambios**, el item estaba en la **página 2**, y el servidor
sí lo tenía. La comprobación ahora pagina por `nextCursor` hasta el final.

El error era el criterio, y la lección es de las que ya están en este documento: la
fila en pantalla y el `pull` son dos cosas, pero un `pull` que no se pagina **no** es
el servidor, es un trozo del servidor. Faltaba una comprobación que preguntara
«dónde está» y acabó preguntando «existe».

### Un bug de verdad que salió al mirar esto

Buscando por qué se perdía, se salió del item y se miró el *outbox* mientras un create
era rechazado. El camino de pérdida que la comprobación **no** estaba midiendo:

| t | outbox | servidor |
| --- | --- | --- |
| 0,0 s | `list_item create, attempts 0` | |
| 1,6 s | `attempts 1, "The operation failed"` | `rejected` |
| 4,8 s | `attempts 3` | `rejected` |
| 9,2 s | `attempts 6` | `rejected` |
| **12,0 s** | **`[]`** — borrado | `rejected` ×8 |

Un `rejected` del servidor es **permanente** por definición: repetir la misma
operación ocho veces no la va a arreglar. Y aun así `sync-service.ts` la reintenta
cada 1,5 s, y al 8º intento hace `store.remove()` y desaparece. Sin más rastro:

- `result.failed` **no lo lee nadie** — ni el motor ni el centro de sincronización.
- El rechazo **no cuenta como error** (`result.error` queda `null`), así que el
  *backoff* que crece con los fallos de transporte se queda en `0` y la siguiente
  espera es la de siempre.
- La fila en caché no se toca, así que **el item sigue en la lista** para siempre.
- `sync_conflicts` no se toca, porque eso solo pasa con `conflict`, no con `rejected`.

Es decir: el peor caso —el servidor dice que no, para siempre— es exactamente el que
borra la escritura y no dice nada. Con datos válidos no se ha podido provocar: el
`rejected` que se ha visto aquí era de una lista que el propio script no llegó a
sembrar. Queda como **fallo latente**, y se arregla aparte de esta tanda.

Ninguno de los de esta lista era una opinión sobre el aspecto: eran cosas que no
funcionaban, y se encontraron conduciendo la app.

| Qué pasaba | Por qué no lo veía el typecheck |
| --- | --- |
| La página siguiente se veía en reposo, 16 px, sin haber hecho swipe | El `overflow: hidden` estaba en el track, que es tan ancho como todas las pantallas; el que recorta es el tablero, que es de una |
| El panel se quedaba a un tercio de página de donde decía la barra de puntos | `origin` se fijaba al empezar el gesto y `settle` aleja `trackX` de ahí; en reposo la goma se comía la distancia correcta |
| El swipe de fondo no cambiaba de página estando en modo edición | La capa de fondo es el primer hijo del track, debajo de las pantallas, y las pantallas se comían todos los toques |
| **Los cambios del selector se perdían al pulsar Guardar** | El panel guarda su propio `draft` y solo lo re-sincroniza al salir de edición; el selector escribía en el layout guardado y `finish` lo sobrescribía |
| `<body>` seguía al SO, no al tema | `+html.tsx` lo pinta con una media query; el tema de la app va en `Screen`, no en el body |
| `Segmented` no decía qué opción estaba marcada | `accessibilityState.selected` sale como `aria-selected`, que no es válido en `role="radio"`; no salía ni `aria-checked` ni `aria-selected` |
| Una operación rechazada se culpaba al panel | `readEntity(raw) ?? 'dashboard'`: mandar `item` en vez de `list_item` volvía como quince rechazos del **dashboard** |
| `verify-panel.mjs` contaba pantallas como tarjetas | `[...grid.children]` son las pantallas del track; por eso comparaba dos tarjetas con una pantalla |
| **Arrastrar en el picker de color cerraba el bottom sheet** | Los dos gestos eran `PanResponder`, y en web el navegador decide el gesto antes que el responder: sin `touch-action: none` se queda con el dedo. **`touchAction: "none"` en el `StyleSheet` no sirve** — react-native-web se lo come y medido seguía en `auto`. Convertidos a `Gesture.Pan`, que sí lo pone |

### El picker de color, dos bugs en el mismo sitio

El arrastre **tampoco cambiaba el color**, y no se veía mirando la captura porque el
cuadrado se ve igual de lleno antes y después. Los dos eran la misma línea:

- Los gestos eran `PanResponder`, el camino que en web **no reclama el gesto** sin
  `touch-action: none`. Es el mismo fallo que el arrastre de la lista, documentado
  más abajo en "Arrastrar en vivo", y ya tenía la misma causa.
- Poner `touchAction: "none"` en el estilo **no lo arregla**: react-native-web valida
  las propiedades y la descarta. Medido antes y después, `touch-action` seguía en
  `auto`.
- Con `Gesture.Pan` el `touch-action: none` lo pone la librería, y los dos gestos
  funcionan: el anillo se mueve, el color cambia, y el sheet no se cierra.

**Medido, no mirado.** Con eventos táctiles reales y con ratón, por etapas: el anillo
va de (131, 591) a (133, 637) y el `sheet` sigue en `true` en las cuatro. Antes el
color no se movía en absoluto. El hex del campo de texto **no sirve** para comprobar
esto: es el campo donde se escribe a mano, y se vacía solo al cambiar de color —que es
como se pierde una comprobación que parece estar midiendo lo que no mide.

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
| **Elegir un icono y luego un color borraba el icono.** Parecía que el selector no guardaba | El selector mandaba el icono entero en cada cambio, con el valor que él tenía, que era el de antes. El typecheck lo daba por bueno: los dos tipos eran correctos |
| **El icono no llegaba al móvil.** Parecía un fallo del selector y era del servidor | El proceso del API llevaba en pie desde antes del contrato nuevo, así que rechazaba la clave. El typecheck no ve un proceso que se quedó con un módulo viejo |
| **El arrastre no arrancaba en web.** Parecía que el reordenado en vivo no estaba hecho | La app no tenía `GestureHandlerRootView`: sin ella el gestor de gestos no pone `touch-action: none` y el navegador se queda con el dedo para desplazar. El typecheck no ve una raiz que falta |
| **El panel del elemento no cabía en un móvil y no se desplazaba**, con el botón de guardar debajo de la pantalla | El panel solo se hacía desplazable en la página de iconos, cuando entonces cabía. Al añadir una fila dejó de caber |
| **Escribir una tarea a mano rompía la lista.** Salía `item.tags.length` de undefined | La fila se escribía a mano en la caché, sin el campo nuevo, y el contrato no lo comprueba |
| **El servidor tiraba el icono, las etiquetas y el orden al crear** | El `create` escribía los campos uno a uno y el `insert` no mencionaba los nuevos |
| **Un libro escrito a mano no se podía abrir** | El detalle pedía el proveedor de la lista en vez del elemento, y sin id no hay nada que pedir |
| **Un libro con 3/5 salía como 3.0/10** | La escala venía asumida, no viaja con la nota |
| **El botón del menú era un botón dentro del botón de la tarjeta** | HTML inválido; un lector de pantalla lo lee como un control |
| **Dos controles con el mismo nombre en pantalla** (el icono de una fila y la fila) | El navegador pulsaba el equivocado al hacer la prueba |
| **El menú de una lista solo salía con pulsación larga** | En web no hay pulsación larga, y en móvil nadie lo descubre |
| **La tecla Enter no hacía nada en el campo de etiqueta** | En web el campo no está en un formulario |
| **El lápiz del panel abría el selector de listas** | Los dos botones compartían manejador, así que el modo de colocar no se podía entrar |
| **Los controles de tamaño no se veían en una tarjeta de 127 px** | Eran una fila de botones dentro de la tarjeta, y la tarjeta es un tercio de móvil |
| **El rol salía dos veces en la fila de una persona** | Se pintaba en el subtítulo *y* en la derecha, según quién fuera |
| **"Vas a entrar como Puede editar."** | El nombre del rol es una etiqueta y se había metido en una frase |
| **"1 personas dentro"** | El número no pasaba por el plural del diccionario |
| **Un 401 por cada enlace abierto sin sesión** | La pantalla pedía la vista previa antes de saber si había sesión |
| **La barra de abajo decía "index", "search" y "settings"** | Las tres pantallas se compartían en un fragmento, y el router lee sus hijos directamente: no ve a través de un fragmento |
| **El cajón se dibujaba abajo, en la barra** | Faltaba ponerlo a la izquierda; con la barra de abajo encima quedaba una columna de 264px pegada al borde inferior |
| **El cajón solo salía en las tres pestañas** | Estaba en el layout de las pestañas, así que el panel, una lista o un detalle se quedaban sin navegación |
| **La etiqueta decía "Released" en una pantalla en español** | El estado viene del proveedor en inglés y salía sin traducir, junto a una etiqueta que sí estaba traducida |
| **El año, el tipo, el estado y los géneros salían dos veces** | Estaba en la línea de datos y también en la tarjeta de detalles, y no se sabe cuál es la buena |

### Lo que sale de verdad a flotas

**Arreglado, y no era el test.** `GET /api/v1/health` fallaba con "Test timed out in
5000ms" al correr los 11 ficheros a la vez. La causa era de verdad y estaba en el
producto: `pingDatabase()` abría la conexión **dentro de la petición**, así que la
primera llamada al endpoint de salud pagaba el arranque en frío —1,7 s medidos—. Una
sonda de vida que paga un arranque en frío es una sonda que mata el arranque de lo que
la vigila, y el endpoint de salud es justo donde ser lento es peor.

Ahora el servidor abre la conexión antes de escuchar, y la prueba la calienta en su
`beforeAll` como hace el servidor de verdad. 187 de 187, dos veces seguidas, con la
máquina ocupada.

Lo que **queda** delparrandeado: los 11 ficheros comparten una base de datos y cada uno
corre migraciones en su `beforeAll`. Con once workers a la vez eso se nota, y el
`timeout` de 5 s no es un número mágico sino el sitio donde se nota. Arreglarlo es dar
una base de datos por fichero, y eso es un bloque entero.

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
