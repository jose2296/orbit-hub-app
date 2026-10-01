#!/usr/bin/env node
/**
 * Sembrar datos de ejemplo en una cuenta ya verificada, para poder abrir la app
 * y mirarla con contenido en vez de con pantallas vacías.
 *
 *   node scripts/seed-showcase.mjs --dry-run
 *   API=... EMAIL=... PASSWORD=... node scripts/seed-showcase.mjs
 *
 * Todo va por la API HTTP. No toca la base de datos por la puerta de atrás, y la
 * cuenta tiene que estar **verificada**: `/sync/push` responde
 * `email_verification_required` en cuanto se escribe algo sin verificar.
 *
 * A diferencia de `seed-people.mjs`, este no lee el token de verificación del log
 * del servidor. La cuenta se verifica una vez, a mano, con el correo que le llega
 * a su dueño. Eso es lo que lo hace funcionar contra un servidor desplegado,
 * donde el log no es tuyo.
 *
 * --- Lo que este archivo copió del contrato, y por qué importa ---------------
 *
 * Las formas de las entidades salen de `packages/contracts/src/sync.ts` y de
 * `apps/api/src/db/content-schema.ts`. Lo que no aparece ahí, en comentario,
 * porque es donde se pierden las horas:
 *
 *   - **No existe una entidad `task`.** Las entidades son `workspace`,
 *     `membership`, `folder`, `list`, `list_item`, `note`, `attachment`,
 *     `dashboard`. Una tarea es un `list_item` con `completed` a true o false.
 *     Mandar `task` es un error de validación.
 *   - **Un `list_item` solo se dibuja como cartel si tiene `externalId`.** Sin
 *     esa columna, `mediaCardOf` devuelve null y la lista cae a una fila de
 *     texto. Para un catálogo es exactamente el resultado que no se quiere.
 *   - **El prefijo del `externalId` dice qué es.** `providerRefOf` lee `movie:` y
 *     `tv:` para decidir que es de TMDB, y para los libros mira
 *     `metadata.type === "book"`. Un id sin prefijo cae en un default y la lista
 *     se dibuja como texto.
 *   - **`metadata` es jsonb libre**, pero el póster tiene que estar ahí dentro
 *     como `imageUrl`, porque es de ahí de donde lo lee la tarjeta.
 *   - **Los iconos son claves, no emojis.** `ITEM_ICONS` en
 *     `packages/contracts/src/item-icons.ts`; uno que no esté en la lista se
 *     guarda y la app no lo puede dibujar.
 *   - **`mediaCardOf` devuelve null si no hay `imageUrl`.** Con una foto de
 *     picsum la hay; con una URL inventada también la hay, y se ve rota.
 */

const API = (process.env.API ?? 'https://orbithub-api.jrz-labs.com/api/v1').replace(/\/$/, '');
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const DRY = process.argv.includes('--dry-run');

if (!DRY && !(EMAIL && PASSWORD)) {
  console.error('Faltan EMAIL y PASSWORD.\n');
  console.error('  node scripts/seed-showcase.mjs --dry-run');
  console.error('  API=https://orbithub-api.jrz-labs.com/api/v1 \\');
  console.error('  EMAIL=tu@correo PASSWORD=clave node scripts/seed-showcase.mjs');
  process.exit(1);
}

const uuid = () => crypto.randomUUID();

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status}: ${json?.data?.message ?? json?.message ?? JSON.stringify(json)}`,
    );
  }
  return json?.data ?? json;
}

/**
 * Una operación por push, y el resultado comprobado.
 *
 * Una operación rechazada vuelve con `status: "rejected"` y un HTTP 200, así que
 * un seed que solo mira el código se pasa por alto la nota que no se creó y
 * falla tres pasos después al compartir algo que no existe, que es un sitio
 * mucho peor para averiguar por qué.
 */
async function push(session, operations) {
  for (const op of operations) {
    const result = await call('/sync/push', {
      method: 'POST',
      token: session.token,
      body: {
        deviceId: session.deviceId,
        lastPulledAt: null,
        operations: [
          {
            operationId: uuid(),
            clientId: 'seed-showcase',
            baseVersion: 0,
            payload: {},
            clientTimestamp: new Date().toISOString(),
            ...op,
          },
        ],
      },
    });
    const outcome = result.results?.[0];
    if (outcome?.status !== 'applied') {
      throw new Error(`no se pudo ${op.kind} ${op.entity}: ${JSON.stringify(outcome)}`);
    }
  }
}

// ------------------------------------------------------------------ datos ----

/** Colores de `WORKSPACE_COLORS`, packages/contracts/src/workspace.ts. */
const ESPACIOS = [
  { name: 'Casa', color: 'teal' },
  { name: 'Trabajo', color: 'indigo' },
  { name: 'Para hoy', color: 'amber' },
  { name: 'Películas', color: 'rose' },
  { name: 'Series', color: 'violet' },
  { name: 'Libros', color: 'moss' },
];

const NOTAS = [
  ['Casa', 'Lista de la compra', '<p>Pan, leche y el café del bueno.</p><p>Y algo verde, que se nos acaba la semana que viene.</p>'],
  ['Casa', 'Bombilla del baño', '<p>La de 3000K, no la de 4000K. La otra deslumbra.</p>'],
  ['Trabajo', 'Reunión del lunes', '<p>Traer los números del trimestre y una propuesta, no cinco.</p><ul><li>Churn: 4,2%</li><li>Retención a 90 días: 61%</li></ul>'],
  ['Trabajo', 'Ideas para el roadmap', '<p>Lo que más se pidió en las entrevistas, en orden:</p><ol><li>Búsqueda que entienda sin comillas</li><li>Compartir una nota con un enlace</li><li>Modo sin conexión de verdad</li></ol>'],
  ['Para hoy', 'Lo que hay que hacer hoy', '<p>Contestar el correo de la mudanza antes de comer, que luego se me olvida.</p>'],
];

/**
 * `kind` sale de `listKindSchema`: tasks, movies, series, movies_and_series, books.
 * Las tareas son `list_item` con `completed`, no una entidad aparte.
 *
 * `icon` son claves de `ITEM_ICONS`, no emojis: la API acepta cualquier cosa y
 * la app no puede dibujar la que no conoce.
 */
const TAREAS = [
  {
    espacio: 'Casa',
    titulo: 'Mudanza',
    items: [
      ['Pedir cajas de 20', true, 'high', 'caja'],
      ['Medir el hueco del armario', false, 'medium', 'herramienta'],
      ['Llamar a la compañía del gas', false, 'none', 'telefono'],
      ['Devolver las llaves del piso viejo', false, 'low', 'llave'],
    ],
  },
  {
    espacio: 'Trabajo',
    titulo: 'Tareas del trimestre',
    items: [
      ['Escribir el informe', false, 'high', 'cuaderno'],
      ['Preparar la demo', true, 'medium', 'monitor'],
      ['Hablar con soporte sobre el ticket de ayer', false, 'none', 'auriculares'],
    ],
  },
  {
    espacio: 'Para hoy',
    titulo: 'Para hoy',
    items: [
      ['Comprar pan', true, 'none', 'pan'],
      ['Llamar al dentista', false, 'none', 'pastilla'],
    ],
  },
];

/**
 * Catálogo. `metadata` es jsonb libre, pero el póster tiene que estar ahí como
 * `imageUrl`, porque es de donde lo lee `mediaCardOf`.
 *
 * Las imágenes son de picsum, así que son deistas: en una captura de la tienda
 * se ven como imágenes de relleno, que es lo que son. No son pósters de películas
 * reales y no se puede arreglar sin claves de TMDB.
 */
const CATALOGO = [
  {
    espacio: 'Películas',
    titulo: 'Para ver',
    kind: 'movies',
    items: [
      ['Dune', 1984, 'movie'],
      ['Blade Runner', 1982, 'movie'],
      ['La llamada', 2002, 'movie'],
      ['Marte', 2015, 'movie'],
      ['El viaje', 2021, 'movie'],
      ['La casa de las muñecas', 1998, 'movie'],
    ],
  },
  {
    espacio: 'Series',
    titulo: 'Para ver',
    kind: 'series',
    items: [
      ['Mr. Robot', 2017, 'tv'],
      ['Chernobyl', 2019, 'tv'],
      ['Breaking Bad', 2008, 'tv'],
      ['The Leftovers', 2015, 'tv'],
    ],
  },
  {
    espacio: 'Libros',
    titulo: 'Para leer',
    kind: 'books',
    items: [
      ['El nombre de la rosa', 1980, 'book'],
      ['Cien años de soledad', 1967, 'book'],
      ['La sombra del viento', 2001, 'book'],
      ['Ficciones', 1944, 'book'],
    ],
  },
];

function resumen() {
  const espacios = ESPACIOS.length;
  const notas = NOTAS.length;
  const tareas = TAREAS.reduce((n, t) => n + t.items.length, 0);
  const titulos = CATALOGO.reduce((n, c) => n + c.items.length, 0);
  return {
    espacios,
    notas,
    listas: TAREAS.length + CATALOGO.length,
    tareas,
    titulos,
    operaciones: espacios + notas + TAREAS.length + CATALOGO.length + tareas + titulos,
  };
}

// ------------------------------------------------------------------- dry ----

if (DRY) {
  const r = resumen();
  console.log('[dry-run] no se ha llamado a la API. Esto es lo que se sembraría:\n');
  for (const e of ESPACIOS) console.log(`  espacio   ${e.name} (${e.color})`);
  for (const [esp, titulo] of NOTAS) console.log(`  nota      ${titulo}  → ${esp}`);
  for (const t of TAREAS) console.log(`  lista     ${t.titulo} · ${t.items.length} tareas  → ${t.espacio}`);
  for (const c of CATALOGO) console.log(`  catálogo  ${c.titulo} · ${c.items.length} títulos  → ${c.espacio}`);
  console.log(`\n  ${r.espacios} espacios, ${r.notas} notas, ${r.listas} listas, ${r.tareas} tareas,`);
  console.log(`  ${r.titulos} títulos de catálogo. ${r.operaciones} operaciones en total.`);
  process.exit(0);
}

// -------------------------------------------------------------- ejecución ----

console.log(`[seed] conectando como ${EMAIL}`);

const login = await call('/auth/login', {
  method: 'POST',
  body: { email: EMAIL, password: PASSWORD, device: { label: 'Seed', platform: 'web' } },
});
if (login.status !== 'authenticated') throw new Error(`login dijo ${JSON.stringify(login)}`);

const me = await call('/auth/me', { token: login.session.accessToken });
console.log(`[seed] sesión iniciada como ${me.displayName}`);

// Ya poblada: volver a sembrar duplicaría todo, y no sabrías cuál de las dos
// copias sale en las capturas.
const pulled = await call('/sync/pull', {
  method: 'POST',
  token: login.session.accessToken,
  body: { deviceId: uuid(), lastPulledAt: null, limit: 200 },
});
const counts = {};
for (const row of pulled.changes ?? []) counts[row.entity] = (counts[row.entity] ?? 0) + 1;
const ocupadas = Object.values(counts).reduce((a, b) => a + b, 0);
if (ocupadas > 0) {
  console.error(`\n[seed] esta cuenta ya tiene ${ocupadas} entidades:`, counts);
  console.error('    Volver a sembrar lo duplicaría, y no sabrías cuál copia sale en');
  console.error('    las capturas. Borra la cuenta o usa otra.\n');
  process.exit(1);
}

const session = { token: login.session.accessToken, deviceId: uuid() };

const espacioId = {};
for (const e of ESPACIOS) {
  espacioId[e.name] = uuid();
  await push(session, [
    { kind: 'create', entity: 'workspace', entityId: espacioId[e.name], payload: { name: e.name, color: e.color } },
  ]);
}
console.log(`[seed] ${ESPACIOS.length} espacios`);

for (const [espacio, titulo, document] of NOTAS) {
  await push(session, [
    {
      kind: 'create',
      entity: 'note',
      entityId: uuid(),
      payload: { workspaceId: espacioId[espacio], folderId: null, title: titulo, document, tags: [] },
    },
  ]);
}
console.log(`[seed] ${NOTAS.length} notas`);

let tareas = 0;
for (const t of TAREAS) {
  const listId = uuid();
  await push(session, [
    {
      kind: 'create',
      entity: 'list',
      entityId: listId,
      payload: { workspaceId: espacioId[t.espacio], folderId: null, title: t.titulo, kind: 'tasks', position: 0 },
    },
  ]);
  let position = 0;
  for (const [titulo, completed, priority, icon] of t.items) {
    await push(session, [
      {
        kind: 'create',
        entity: 'list_item',
        entityId: uuid(),
        payload: { listId, title: titulo, position: position++, completed, priority, icon, tags: [] },
      },
    ]);
    tareas += 1;
  }
}
console.log(`[seed] ${TAREAS.length} listas, ${tareas} tareas`);

let titulos = 0;
for (const c of CATALOGO) {
  const listId = uuid();
  await push(session, [
    {
      kind: 'create',
      entity: 'list',
      entityId: listId,
      payload: { workspaceId: espacioId[c.espacio], folderId: null, title: c.titulo, kind: c.kind, position: 0 },
    },
  ]);
  let position = 0;
  for (const [titulo, year, tipo] of c.items) {
    const esLibro = tipo === 'book';
    // El prefijo no es decorativo: providerRefOf lo lee para saber si esto es
    // una película, una serie o un libro.
    const externalId = esLibro
      ? `seed-libro-${year}-${titulo.toLowerCase().replace(/\W+/g, '-')}`
      : `${tipo === 'tv' ? 'tv' : 'movie'}:${year}-${titulo.toLowerCase().replace(/\W+/g, '-')}`;
    await push(session, [
      {
        kind: 'create',
        entity: 'list_item',
        entityId: uuid(),
        payload: {
          listId,
          title: titulo,
          position: position++,
          completed: false,
          priority: 'none',
          tags: [],
          externalId,
          metadata: {
            type: tipo,
            provider: esLibro ? 'google-books' : 'tmdb',
            title: titulo,
            year: String(year),
            imageUrl: `https://picsum.photos/seed/${encodeURIComponent(titulo)}/300/450`,
          },
        },
      },
    ]);
    titulos += 1;
  }
}
console.log(`[seed] ${CATALOGO.length} listas de catálogo, ${titulos} títulos`);

const r = resumen();
console.log(`\n[seed] listo. Entra con ${EMAIL} y la contraseña de PASSWORD.`);
console.log(`[seed] ${r.espacios} espacios, ${r.notas} notas, ${r.listas} listas, ${r.tareas} tareas, ${r.titulos} títulos.`);