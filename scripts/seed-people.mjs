/**
 * Seeds a local API with people who have actually shared things, so the picker and
 * the people screen can be looked at with rows in them.
 *
 * Four accounts:
 *  - Ana: a space, a note and a list, and she has shared with Beto and Carla.
 *  - Beto: received a note from Ana.
 *  - Carla: received a list from Ana, and is also in Ana's space.
 *  - Dolo: exists in the database and shares nothing with Ana. She must NOT appear
 *    in the directory — that is the whole privacy claim, and seeing her there is
 *    the bug this script is set up to make visible.
 *
 * The API is expected to be running with `EMAIL_TRANSPORT=console`, because a new
 * account cannot sign in until its address is verified and the verification link
 * only ever leaves by mail. Reading it back out of the server's own stdout is the
 * same trick `apps/api/test/helpers.ts` plays against the in-memory buffer, and it
 * is a development affordance, not a way around anything: the token still has to be
 * presented to `/auth/verify-email` and it is still single use.
 *
 *   API=http://localhost:4001/api/v1 API_LOG=/tmp/orbit-api.log node scripts/seed-people.mjs
 */
import { readFileSync } from "node:fs";

const API = process.env.API ?? "http://localhost:4001/api/v1";
const API_LOG = process.env.API_LOG ?? "/tmp/orbit-api.log";

async function call(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
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
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  }
  return json?.data ?? json;
}

const stamp = Date.now();
const PASSWORD = "Con-un-muy-largo-secreto-1";

/**
 * The verification link for an address, out of the API's own log.
 *
 * Matches on the address and takes the last one, so re-running the script does not
 * verify an account with a token from the previous run.
 */
function verificationTokenFor(email) {
  // Retries, because the mail is written to the log by the server **after** the
  // response goes out. Reading once was a race that failed about one run in three
  // with "no verification link", which is the kind of flake that makes a script
  // look like the thing it is checking is broken.
  const ultimo = Date.now() + 10_000;
  while (true) {
    let log = "";
    try {
      log = readFileSync(API_LOG, "utf8");
    } catch {
      throw new Error(
        `cannot read ${API_LOG}. Start the API with EMAIL_TRANSPORT=console and redirect its output there.`,
      );
    }
    const line = log
      .split("\n")
      .filter((one) => one.includes(email) && one.includes("verify-email"))
      .pop();
    const token = line ? /token=([A-Za-z0-9_-]+)/.exec(line)?.[1] : undefined;
    if (token) return token;
    if (Date.now() > ultimo) {
      throw new Error(`no verification link in the log for ${email}`);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }
}

async function register(nombre) {
  const email = `${nombre.toLowerCase()}.${stamp}@example.com`;
  const displayName = nombre;

  await call("/auth/register", {
    method: "POST",
    body: {
      email,
      password: PASSWORD,
      displayName,
      acceptedTermsAt: new Date().toISOString(),
      device: { label: "Seed", platform: "web" },
    },
  });

  await call("/auth/verify-email", {
    method: "POST",
    body: { token: verificationTokenFor(email) },
  });

  const sesion = await call("/auth/login", {
    method: "POST",
    body: { email, password: PASSWORD, device: { label: "Seed", platform: "web" } },
  });
  if (sesion.status !== "authenticated") {
    throw new Error(`login for ${nombre} said ${JSON.stringify(sesion)}`);
  }
  const me = await call("/auth/me", { token: sesion.session.accessToken });
  return {
    nombre,
    token: sesion.session.accessToken,
    userId: me.id,
    email: me.email,
    displayName: me.displayName,
  };
}

const uuid = () => crypto.randomUUID();

/**
 * One operation per push, and each one checked.
 *
 * Batched: a rejected operation comes back with `status: "rejected"` and an HTTP
 * 200, so a seed script that only looks at the status code walks past a note that
 * was never created and then fails three steps later on a share of something that
 * does not exist, which is a much worse place to find out why.
 */
async function push(user, operations) {
  const results = [];
  for (const operation of operations) {
    const r = await call("/sync/push", {
      method: "POST",
      token: user.token,
      body: {
        deviceId: user.deviceId,
        lastPulledAt: null,
        operations: [
          {
            operationId: uuid(),
            clientId: "seed-client-people",
            baseVersion: 0,
            payload: {},
            clientTimestamp: new Date().toISOString(),
            ...operation,
          },
        ],
      },
    });
    const outcome = r.results?.[0];
    if (outcome?.status !== "applied") {
      throw new Error(
        `could not ${operation.kind} ${operation.entity} ${operation.entityId}: ${JSON.stringify(outcome)}`,
      );
    }
    results.push(outcome);
  }
  return results;
}

const ana = await register("Ana");
const beto = await register("Beto");
const carla = await register("Carla");
const dolo = await register("Dolo");
const elena = await register("Elena");

for (const user of [ana, beto, carla, dolo]) user.deviceId = uuid();

const spaceId = uuid();
const folderId = uuid();
const noteId = uuid();
const listId = uuid();

await push(ana, [
  { kind: "create", entity: "workspace", entityId: spaceId, payload: { name: "Casa", color: "teal" } },
  { kind: "create", entity: "folder", entityId: folderId, payload: { workspaceId: spaceId, name: "Vacaciones", position: 0 } },
  {
    kind: "create",
    entity: "note",
    entityId: noteId,
    payload: {
      workspaceId: spaceId,
      folderId: null,
      title: "Lista de la compra",
      document: "<p>Pan, leche y el café del bueno.</p>",
      tags: [],
    },
  },
  {
    kind: "create",
    entity: "list",
    entityId: listId,
    payload: { workspaceId: spaceId, folderId, title: "Mudanza", kind: "tasks", position: 0 },
  },
]);

// Beto: shares with Ana only. The note is the flagship case.
// Carla: shares with Ana (a list) and then joins her space, so she arrives with two
// reasons at once and the row has to show both.
const conBeto = await call("/shares", {
  method: "POST",
  token: ana.token,
  body: { nodeType: "note", nodeId: noteId, granteeUserId: beto.userId, role: "editor" },
});
const conCarla = await call("/shares", {
  method: "POST",
  token: ana.token,
  body: { nodeType: "list", nodeId: listId, granteeUserId: carla.userId, role: "viewer" },
});

const invitacion = await call(`/workspaces/${spaceId}/invitations`, {
  method: "POST",
  token: ana.token,
  body: { role: "editor", email: carla.email },
});
await call(`/invitations/${invitacion.token}/accept`, {
  method: "POST",
  token: carla.token,
  body: {},
});

/*
  Una segunda lista, solo para mirar.
  Beto no es miembro del espacio de Ana, asi que esto es el unico caso del repo
  donde hay una concesion en solo lectura sin membresia: la insignia tiene que decir
  "solo puedes mirarlo" y el menu no puede ofrecer compartir. Con la lista que Ana le
  compartio como editor eso no se puede comprobar, porque el papel mas amplio gana y
  diria "puedes editarlo".
*/
const listaLecturaId = uuid();
await push(ana, [
  {
    kind: "create",
    entity: "list",
    entityId: listaLecturaId,
    payload: {
      workspaceId: spaceId,
      folderId: null,
      title: "Solo mirar",
      kind: "tasks",
      position: 1,
    },
  },
]);
const soloLectura = await call("/shares", {
  method: "POST",
  token: ana.token,
  body: {
    nodeType: "list",
    nodeId: listaLecturaId,
    granteeUserId: beto.userId,
    role: "viewer",
  },
});

/*
  Una lista de peliculas con su cartel y su ano.
  El modal de reordenar vive en la pantalla de medios y muestra el ano de cada
  pelicula al lado del asa de arrastre. Se siembra aqui porque es el unico sitio donde
  se puede mirar si el ano se cuela debajo del icono, y un caso escrito a mano en un
  test no lo ense馻a.
*/
const peliculasId = uuid();
const peliculas = [
  { title: "El silencio de Mr. Barnes", year: "2018", poster: true },
  { title: "Cien anos de soledad", year: "1967", poster: false },
  { title: "El averso", year: "2021", poster: true },
];

await push(ana, [
  {
    kind: "create",
    entity: "list",
    entityId: peliculasId,
    payload: { workspaceId: spaceId, folderId: null, title: "Peliculas", kind: "movies", position: 2 },
  },
]);

for (const [indice, pelicula] of peliculas.entries()) {
  await push(ana, [
    {
      kind: "create",
      entity: "list_item",
      entityId: uuid(),
      payload: {
        listId: peliculasId,
        title: pelicula.title,
        position: indice,
        externalId: `tmdb-${indice + 1}`,
        // `imageUrl` es lo que decide si hay cartel. La segunda se deja sin ella a
        // proposito: es el caso en el que el ano tiene que seguir viéndose igual, y
        // antes no se veia porque se leia a traves de la tarjeta, que sin cartel no
        // existe.
        metadata: {
          type: "movie",
          provider: "tmdb",
          year: pelicula.year,
          releaseDate: `${pelicula.year}-05-01`,
          ...(pelicula.poster
            ? { imageUrl: `https://picsum.photos/seed/pelicula${indice}/200/300` }
            : {}),
        },
      },
    },
  ]);
}

const directorio = await call("/people", { token: ana.token });

console.log(
  JSON.stringify(
    {
      login: { email: ana.email, password: PASSWORD },
      beto: { email: beto.email, password: PASSWORD },
      carla: { email: carla.email, password: PASSWORD },
      dolo: { email: dolo.email, password: PASSWORD },
      elena: { email: elena.email, password: PASSWORD },
      noteId,
      listId,
      listaLecturaId,
      peliculasId,
      spaceId,
      folderId,
      compartidas: {
        conBeto: conBeto.id,
        conCarla: conCarla.id,
        soloLectura: soloLectura.id,
      },
      directorio: directorio.items.map((p) => ({
        nombre: p.user.displayName,
        correo: p.user.email,
        relaciones: p.relations,
      })),
      doloFuera: !directorio.items.some((p) => p.user.email === dolo.email),
    },
    null,
    2,
  ),
);
