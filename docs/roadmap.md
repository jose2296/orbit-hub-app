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

### El cajon: en movil tapa, en pantalla ancha empuja

Hecho, y **he cambiado una cosa que habias pedido**, asi que lo cuento con los numeros
que lo motivan.

Medido en 430x932 con el menu abierto, empujando: el menu se llevaba 284 y la app se
quedaba en **146 px**. Las filas quedaban en 82, los nombres de los items **no cabian
en absoluto** y "Tareas" iba **una letra por linea**. Eso no es un menu encima de una
app: es una app rota con un menu al lado. Push en todas partes no funciona en un movil,
y ninguna medida de "estrechar un poco mas el menu" lo arregla: a 146 tampoco se lee, y
a 130 (que es lo que seacia al 80%) menos.

- **Movil (menos de 900 px):** el menu **tapa**. La app se queda entera, con su ancho,
  y la franja que queda libre lleva un velo y se toca para cerrar. El menu es opaco,
  porque si no se ven las dos pantallas encima.
- **Pantalla ancha (900 o mas):** el menu **empuja**, con una franja del 30%. Ahi si
  queda una pantalla entera al lado, que es justo para lo que sirve empujar.

Es lo que hacia la app vieja segun lo que cuentas, y ahora esta medido y no de memoria.

**Lo que me equivoque al informar del bloque anterior:** di que el empuje no
funcionaba porque la app no se estrechaba. Es cierto que con el menu abierto la
columna de la app seguia midiendo 430 — pero **la prueba estaba abriendo el menu de la
lista, no el cajon**: el boton del cajon se llama "Abrir el menu" y el menu de la lista
"Menú de la lista", y mi prueba buscaba "Menu", que salia el segundo. Con el boton
correcto, el empuje funcionaba y la app se estrechaba bien. El `minWidth: 0` que puse
en el contenedor si hacia falta, y se queda.

Leccion, y la tercera vez que me pasa: **una prueba que no ha abierto lo que dice abrir
no mide nada**, y sus numeros hay que leerlos como una sospecha, no como un hecho. Los
tres numeros que cite antes (284, 146, 130) tambien salieron de ahi y no eran de la app
que yo creia estar midiendo.

`cajon-ancho-e2e.mjs` mide las dos cosas: que la app siga entera en movil, y que siga
siendo empujada a partir de 900. Falta probarlo en 1280.

### Escribir algo que ya esta hecho

Hecho y verificado en el navegador. Es la #24 del inventario, y es el caso de la
lista de la compra: compraste leche hace tres semanas, la fila sigue ahi hecha, y al
escribir "Leche" la app anadia una segunda leche. Ahora la lista dice que necesitas
leche y que ya tienes leche, y ninguna de las dos cosas es verdad.

Al escribir el nombre en el panel de crear, si el elemento ya esta en la lista y esta
hecho, aparece **una fila con la unica accion que sirve**: "Volver a pendientes
«Leche»". No un aviso de que ya existe —un aviso que nadie accionas— y no reutilizar
en silencio la fila vieja, porque una fila que hiciste hace tres semanas no es la
fila que estas escribiendo hoy: puede tener otro icono, otras etiquetas y otra
urgencia. Al tocarla, esa fila vuelve a pendientes y **no se crea nada nuevo**.

La comparacion **ignora mayusculas, tildes y espacios**, porque asi es como llega la
misma palabra escrita en un movil, y una coincidencia que solo salta con la
ortografia exacta no salta nunca. Con dos letras no ofrece nada: "p" coincide con
media tienda y una oferta que sale siempre no ofrece nada. Si hay varias iguales, da
la mas reciente, que es la que quieres decir.

`lib/lists/done-match.ts` con 9 pruebas, y `hecho-otra-vez-e2e.mjs` en el navegador.

### Tres fallos de textos que salieron de paso

Estaban en pantalla y nadie los habia buscado:

- **"items.priority.none" salia en crudo** en la pastilla de urgencia, en las dos
  lenguas. La clave no estaba en el diccionario y el typecheck no la echa: el mapa de
  traducciones acepta cualquier `TranslationKey` que exista, y esta no existia porque
  se construia con una plantilla. Ahora sale "Ninguna".
- **"1 completadas" y "1 pendientes"**: el plural se elige con `pluralKey`, que busca
  `.one` y `.other`, y las claves estaban sueltas, sin ninguna de las dos. Una clave
  suelta mas una `_one` no son la misma cosa. Ahora sale "1 completada" y "1
  pendiente".
- **"Completadas (1)"**, lo mismo en la cabecera de los completados.

### Las claves de traduccion detras de una plantilla

Arreglado de raiz, porque **los textos rotos de arriba no eran tres unlucky**: son el
sintoma de una clase. `t("lists.pendingCount")` lo comprueba el compilador —si la clave
no esta en el diccionario, el tipo `TranslationKey` no la tiene y la compilacion
falla—. `t(\`items.priority.${algo}\`)` no lo comprueba nadie, porque el compilador ve
una cadena y no una clave. Y ahi es donde viven las que faltan.

Hay **11 llamadas con plantilla** en la app, en siete familias: prioridades, orden,
roles, color del espacio, y el filtro de la lista. `test/translations.test.ts` las
recorre y comprueba, valor por valor, que todas las claves existen. Los valores se
leen del contrato (`prioritySchema`, `listOrderModeSchema`, `membershipRoleSchema`) y
de `WORKSPACE_COLORS`, no de una lista escrita en la prueba: mi primera version de la
prueba traia tres colores que no existen en la app, y habria fallado por lo
contrario.

Tambien comprueba que las dos lenguas tienen las mismas claves, que una clave de
plural tiene las dos formas (`.one` y `.other`, no una suelta mas una `_one`), y que
ninguna traduccion se queda vacia.

Una familia nueva necesita una linea en el test. Es el precio entero de la
comprobacion.

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
