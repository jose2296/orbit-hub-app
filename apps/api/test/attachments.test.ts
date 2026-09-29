import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';

/**
 * Files on a note.
 *
 * The whole point of the two-step upload and the signed link is that a file is
 * reachable by the people who may see the note and by nobody else, ever, and that
 * a failed upload cannot cost somebody their text. Both are invisible in a happy
 * path, so the tests here are mostly about what happens when something is wrong
 * or when the wrong person calls.
 */
let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

/**
 * The bytes the tests actually upload, so the declared size and the stored size
 * are the same number. A mismatch is refused on purpose — see the truncated
 * upload test — and a fixture that tripped it by accident would be testing nothing.
 */
const BYTES = 'falso binario';

const PNG = {
  fileName: 'salsa.png',
  mimeType: 'image/png',
  sizeBytes: BYTES.length,
  width: 800,
  height: 600,
};

function op(over: Record<string, unknown>) {
  return {
    operationId: randomUUID(),
    clientId: 'attachments-test',
    baseVersion: 0,
    payload: null,
    base: null,
    clientTimestamp: new Date().toISOString(),
    ...over,
  };
}

async function workspace(user: TestUser, name: string): Promise<string> {
  const id = randomUUID();
  const response = await api.post(
    '/sync/push',
    {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: [op({ entity: 'workspace', kind: 'create', entityId: id, payload: { name } })],
    },
    user.accessToken,
  );
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

async function note(user: TestUser, workspaceId: string, title = 'Salsa'): Promise<string> {
  const id = randomUUID();
  const response = await api.post(
    '/sync/push',
    {
      deviceId: randomUUID(),
      lastPulledAt: null,
      operations: [
        op({
          entity: 'note',
          kind: 'create',
          entityId: id,
          payload: { workspaceId, title, document: '<p>Con foto</p>' },
        }),
      ],
    },
    user.accessToken,
  );
  expect(response.body.data.results[0].status).toBe('applied');
  return id;
}

/** The whole upload, the way the app does it. */
async function upload(
  user: TestUser,
  noteId: string,
  overrides: Partial<typeof PNG> = {},
): Promise<{ status: number; body: any }> {
  const meta = { ...PNG, ...overrides };
  const ticket = await api.post(`/notes/${noteId}/attachments`, meta, user.accessToken);
  if (ticket.status !== 201) return ticket;

  await fetch(`${api.url}/attachments/upload/${ticket.body.data.storageKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': meta.mimeType },
    body: BYTES,
  });

  return api.post(
    `/notes/${noteId}/attachments/confirm`,
    { ...meta, storageKey: ticket.body.data.storageKey },
    user.accessToken,
  );
}

describe('uploading a file', () => {
  it('takes the two steps and leaves a file on the note', async () => {
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Fotos');
    const noteId = await note(user, spaceId);

    const response = await upload(user, noteId);

    expect(response.status).toBe(201);
    expect(response.body.data.fileName).toBe('salsa.png');
    expect(response.body.data.mimeType).toBe('image/png');
    // The key is the server's and never leaves it.
    expect(response.body.data.storageKey).toBe('');
  });

  it('raises the count the note shows', async () => {
    // The number is read on every card, so it is counted rather than incremented
    // and it has to be true the moment the file exists.
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Conteo');
    const noteId = await note(user, spaceId, 'Con dos');

    const before = await api.get(`/notes/${noteId}`, user.accessToken);
    expect(before.body.data.attachmentCount).toBe(0);

    await upload(user, noteId);
    await upload(user, noteId, { fileName: 'otra.png' });

    const after = await api.get(`/notes/${noteId}`, user.accessToken);
    expect(after.body.data.attachmentCount).toBe(2);
  });

  it('lists what is on the note', async () => {
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Listado');
    const noteId = await note(user, spaceId);

    await upload(user, noteId, { fileName: 'primera.png' });
    await upload(user, noteId, { fileName: 'segunda.png' });

    const response = await api.get(`/notes/${noteId}/attachments`, user.accessToken);
    expect(response.status).toBe(200);
    expect(response.body.data.items.map((a: { fileName: string }) => a.fileName)).toEqual([
      'primera.png',
      'segunda.png',
    ]);
  });

  it('refuses a kind of file the format does not have', async () => {
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Tipos');
    const noteId = await note(user, spaceId);

    // A script is a document that runs code, and an SVG is one too. Neither is on
    // the list, and the reason the list exists at all is that a client asking
    // "what will you take" must get the real answer.
    const script = await api.post(
      `/notes/${noteId}/attachments`,
      { fileName: 'x.html', mimeType: 'text/html', sizeBytes: 10 },
      user.accessToken,
    );
    expect(script.status).toBe(422);

    const svg = await api.post(
      `/notes/${noteId}/attachments`,
      { fileName: 'x.svg', mimeType: 'image/svg+xml', sizeBytes: 10 },
      user.accessToken,
    );
    expect(svg.status).toBe(422);
  });

  it('refuses a file larger than its kind is allowed to be', async () => {
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Tamaños');
    const noteId = await note(user, spaceId);

    const response = await api.post(
      `/notes/${noteId}/attachments`,
      { fileName: 'corta.mp4', mimeType: 'video/mp4', sizeBytes: 1 },
      user.accessToken,
    );
    // A kind not on the list at all, which is the first thing to catch.
    expect(response.status).toBe(422);

    const huge = await api.post(
      `/notes/${noteId}/attachments`,
      { fileName: 'enorme.png', mimeType: 'image/png', sizeBytes: 500 * 1024 * 1024 },
      user.accessToken,
    );
    expect(huge.status).toBe(422);
  });

  it('refuses to confirm a file whose bytes never arrived', async () => {
    // A row pointing at nothing is a note with a broken image and a message a week
    // later, so a client that says it uploaded and did not is turned away.
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Ausente');
    const noteId = await note(user, spaceId);

    const ticket = await api.post(`/notes/${noteId}/attachments`, PNG, user.accessToken);
    expect(ticket.status).toBe(201);

    const response = await api.post(
      `/notes/${noteId}/attachments/confirm`,
      { ...PNG, storageKey: ticket.body.data.storageKey },
      user.accessToken,
    );
    expect(response.status).toBe(422);

    const listed = await api.get(`/notes/${noteId}/attachments`, user.accessToken);
    expect(listed.body.data.items).toHaveLength(0);
  });

  it('refuses an upload that was cut short', async () => {
    // A connection dropped halfway leaves a file there, and "the file exists"
    // would accept it — putting a broken image in somebody's note with a row
    // insisting it is fine.
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, ' truncada');
    const noteId = await note(user, spaceId);

    const ticket = await api.post(`/notes/${noteId}/attachments`, PNG, user.accessToken);
    const key = ticket.body.data.storageKey as string;
    await fetch(`${api.url}/attachments/upload/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': PNG.mimeType },
      body: 'corta',
    });

    const response = await api.post(
      `/notes/${noteId}/attachments/confirm`,
      { ...PNG, storageKey: key },
      user.accessToken,
    );
    expect(response.status).toBe(422);

    const listed = await api.get(`/notes/${noteId}/attachments`, user.accessToken);
    expect(listed.body.data.items).toHaveLength(0);
  });

  it('refuses a key that belongs to another note', async () => {
    // The prefix is the only thing tying an upload to its note, and a client that
    // can hand back somebody else's key would be writing into their space.
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Ajena');
    const mine = await note(user, spaceId, 'Mía');
    const other = await note(user, spaceId, 'Otra');

    const ticket = await api.post(`/notes/${other}/attachments`, PNG, user.accessToken);
    expect(ticket.status).toBe(201);
    const key = ticket.body.data.storageKey as string;
    await fetch(`${api.url}/attachments/upload/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': PNG.mimeType },
      body: BYTES,
    });

    const response = await api.post(
      `/notes/${mine}/attachments/confirm`,
      { ...PNG, storageKey: key },
      user.accessToken,
    );
    expect(response.status).toBe(404);
  });
});

describe('reading a file', () => {
  it('hands out a short-lived link and the bytes come back through it', async () => {
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Descarga');
    const noteId = await note(user, spaceId);
    const created = await upload(user, noteId);

    const link = await api.post(
      `/notes/attachments/${created.body.data.id}/link`,
      {},
      user.accessToken,
    );
    expect(link.status).toBe(200);
    // The key is encoded into the path and never appears as a readable segment,
    // and the name is covered by the signature rather than merely sitting beside
    // it, so a link whose own contents can be edited is not a link anybody can
    // reason about.
    expect(link.body.data.url).toContain('signature=');
    expect(decodeURIComponent(link.body.data.url)).toContain('salsa.png');
    expect(link.body.data.storageKey).toBeUndefined();

    const bytes = await fetch(`${api.url.replace('/api/v1', '')}${link.body.data.url}`);
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe(BYTES);
  });

  it('refuses a link whose signature does not match', async () => {
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Firmas');
    const noteId = await note(user, spaceId);
    const created = await upload(user, noteId);
    const link = await api.post(
      `/notes/attachments/${created.body.data.id}/link`,
      {},
      user.accessToken,
    );

    const tampered = String(link.body.data.url).replace(/signature=[^&]+/, 'signature=alterada');
    const response = await fetch(`${api.url.replace('/api/v1', '')}${tampered}`);

    // 403 and not 404: the caller holds a link that is no longer good, and saying
    // so is what lets the app fetch a new one.
    expect(response.status).toBe(403);
  });

  it('refuses to serve the bytes with no signature at all', async () => {
    // Not 403: with no signature there is nothing to compare, so the request is
    // malformed. Either way it is refused, and the difference is only in the log.
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Sin firma');
    const noteId = await note(user, spaceId);
    const created = await upload(user, noteId);
    const key = created.body.data.id;

    const response = await fetch(
      `${api.url.replace('/api/v1', '')}/api/v1/attachments/file/${key}?expires=99999999999&name=x.png`,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses a link that has expired', async () => {
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Caducada');
    const noteId = await note(user, spaceId);
    const created = await upload(user, noteId);
    const link = await api.post(
      `/notes/attachments/${created.body.data.id}/link`,
      {},
      user.accessToken,
    );

    const expired = String(link.body.data.url).replace(/expires=\d+/, 'expires=1');
    const response = await fetch(`${api.url.replace('/api/v1', '')}${expired}`);
    expect(response.status).toBe(403);
  });

  it('does not give a link to somebody who cannot see the note', async () => {
    const owner = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const spaceId = await workspace(owner, 'Privada');
    const noteId = await note(owner, spaceId);
    const created = await upload(owner, noteId);

    const response = await api.post(
      `/notes/attachments/${created.body.data.id}/link`,
      {},
      stranger.accessToken,
    );
    // 404 and not 403: the note is not theirs and does not exist as far as they are
    // concerned, and a 403 would tell them it does.
    expect(response.status).toBe(404);
  });
});

describe('who may change a note', () => {
  it('refuses a viewer the right to attach anything', async () => {
    const owner = await createVerifiedUser(api);
    const viewer = await createVerifiedUser(api);
    const spaceId = await workspace(owner, 'Con viewer');

    const link = await api.post(
      `/workspaces/${spaceId}/invitations`,
      { email: viewer.email, role: 'viewer' },
      owner.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, viewer.accessToken);

    const noteId = await note(owner, spaceId);
    // May read.
    expect((await api.get(`/notes/${noteId}/attachments`, viewer.accessToken)).status).toBe(200);
    // May not write.
    expect((await api.post(`/notes/${noteId}/attachments`, PNG, viewer.accessToken)).status).toBe(403);
  });

  it('removes the file and fixes the count', async () => {
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Borrar');
    const noteId = await note(user, spaceId);
    const created = await upload(user, noteId);

    const response = await api.request(`/notes/attachments/${created.body.data.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    expect(response.status).toBe(204);

    const listed = await api.get(`/notes/${noteId}/attachments`, user.accessToken);
    expect(listed.body.data.items).toHaveLength(0);
    const after = await api.get(`/notes/${noteId}`, user.accessToken);
    expect(after.body.data.attachmentCount).toBe(0);
  });

  it('requires a session for everything but the bytes', async () => {
    const user = await createVerifiedUser(api);
    const spaceId = await workspace(user, 'Sin sesión');
    const noteId = await note(user, spaceId);

    expect((await api.get(`/notes/${noteId}/attachments`)).status).toBe(401);
    expect((await api.post(`/notes/${noteId}/attachments`, PNG)).status).toBe(401);
  });
});
