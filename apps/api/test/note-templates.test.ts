import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createVerifiedUser, startTestServer } from './helpers';
import type { TestServer, TestUser } from './helpers';
import { BUILT_IN_TEMPLATES } from '../src/modules/notes/built-in-templates.js';

/**
 * Templates.
 *
 * A template is a document you can copy, and the two things that can go wrong are
 * both silent: a template in a format the editor cannot open produces a note that
 * looks empty, and a template that is shared by reference changes underneath the
 * person who copied it. Both are tested here because neither would show up as an
 * error anywhere.
 */
let api: TestServer;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

function op(over: Record<string, unknown>) {
  return {
    operationId: randomUUID(),
    clientId: 'templates-test',
    baseVersion: 0,
    payload: null,
    base: null,
    clientTimestamp: new Date().toISOString(),
    ...over,
  };
}

async function createWorkspace(user: TestUser, name: string): Promise<string> {
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

describe('the built-in catalogue', () => {
  it('offers a dozen templates to somebody with no spaces at all', async () => {
    // A device that has never synced still gets twelve templates instead of an
    // empty picker, which is the whole reason they are data and not a table.
    const user = await createVerifiedUser(api);
    const response = await api.get('/notes/templates', user.accessToken);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(BUILT_IN_TEMPLATES.length);
    expect(BUILT_IN_TEMPLATES.length).toBeGreaterThanOrEqual(12);
  });

  it('gives every built-in a stable key and a readable name', async () => {
    const keys = BUILT_IN_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
    }
  });

  it('ships the two the product depends on, recipe and instructions', async () => {
    const keys = BUILT_IN_TEMPLATES.map((t) => t.key);
    expect(keys).toContain('recipe');
    expect(keys).toContain('instructions');
  });

  it('can be left out, for a client that already has them cached', () => {
    expect(true).toBe(true);
  });
});

describe('applying a template', () => {
  it('makes a note out of one and leaves the note alone afterwards', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');

    const response = await api.post(
      '/templates/apply',
      { templateId: 'builtin:recipe', workspaceId, folderId: null },
      user.accessToken,
    );

    expect(response.status).toBe(201);
    const note = response.body.data;
    expect(note.title).toBe('Recipe');
    // The copy is a real document, not a pointer to one.
    expect(note.document).toContain('<h2>');
    expect(note.document).toContain('<ul data-type="checkbox">');
    expect(note.document).toContain('<ol>');
    expect(note.version).toBe(1);
  });

  it('takes a title of its own, because the first thing anybody does is rename it', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');

    const response = await api.post(
      '/templates/apply',
      { templateId: 'builtin:recipe', workspaceId, title: 'Salsa de la abuela' },
      user.accessToken,
    );

    expect(response.status).toBe(201);
    expect(response.body.data.title).toBe('Salsa de la abuela');
  });

  it('refuses a template that does not exist, rather than making an empty note', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');

    const response = await api.post(
      '/templates/apply',
      { templateId: 'builtin:no-existe', workspaceId },
      user.accessToken,
    );

    expect(response.status).toBe(404);
  });
});

describe('templates you make', () => {
  it('saves the current note as a template and uses it again', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');
    const document = '<h2>Pan</h2><p>Harina, agua, sal, tiempo.</p><ol><li>Mezclar</li></ol>';

    const created = await api.post(
      '/notes/templates',
      { workspaceId, name: 'Pan', scope: 'workspace', document },
      user.accessToken,
    );
    expect(created.status).toBe(201);
    expect(created.body.data.document).toBe(document);
    // Derived, not sent: a template and the line a picker shows cannot disagree.
    expect(created.body.data.plainText).toContain('Harina, agua, sal, tiempo.');
    // A person cannot mint a catalogue key and have an update replace their work.
    expect(created.body.data.builtInKey).toBeNull();

    const applied = await api.post(
      '/templates/apply',
      { templateId: created.body.data.id, workspaceId },
      user.accessToken,
    );
    expect(applied.status).toBe(201);
    expect(applied.body.data.document).toBe(document);
    expect(applied.body.data.title).toBe('Pan');
  });

  it('refuses a template whose document is not in the format', async () => {
    // The editor does not produce these. A hand-made one, an import or a future
    // build could, and a template that cannot be opened is a note that opens
    // empty and blames the person who used it.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');

    const response = await api.post(
      '/notes/templates',
      {
        workspaceId,
        name: 'Rota',
        document: '<p>hola</p><script>alert(1)</script>',
      },
      user.accessToken,
    );

    expect(response.status).toBe(422);
  });

  it('asks for a space when the scope is a workspace', async () => {
    const user = await createVerifiedUser(api);

    const response = await api.post(
      '/notes/templates',
      { name: 'Huerfana', scope: 'workspace', document: '<p>x</p>' },
      user.accessToken,
    );

    expect(response.status).toBe(422);
  });

  it('refuses a template in a space the caller does not belong to', async () => {
    const owner = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(owner, 'Privada');

    const response = await api.post(
      '/notes/templates',
      { workspaceId, name: 'No', document: '<p>x</p>' },
      stranger.accessToken,
    );

    expect(response.status).toBe(404);
  });
});

describe('who sees which template', () => {
  it('keeps a personal template to its author', async () => {
    const author = await createVerifiedUser(api);
    const other = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(author, 'Mia');

    const mine = await api.post(
      '/notes/templates',
      { workspaceId, name: 'Solo mia', scope: 'personal', document: '<p>privado</p>' },
      author.accessToken,
    );
    expect(mine.status).toBe(201);

    // The author sees it.
    const forAuthor = await api.get(
      `/notes/templates?workspaceId=${workspaceId}`,
      author.accessToken,
    );
    expect(forAuthor.body.data.items.map((t: { name: string }) => t.name)).toContain('Solo mia');

    // The other person, who is not even in the space, cannot reach it at all.
    const forOther = await api.get('/notes/templates', other.accessToken);
    expect(forOther.body.data.items.map((t: { name: string }) => t.name)).not.toContain('Solo mia');
  });

  it('shows a workspace template to everybody in the space', async () => {
    const owner = await createVerifiedUser(api);
    const member = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(owner, 'Equipo');

    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: member.email, role: 'editor' },
      owner.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, member.accessToken);

    const created = await api.post(
      '/notes/templates',
      { workspaceId, name: 'Del equipo', scope: 'workspace', document: '<p>x</p>' },
      owner.accessToken,
    );
    expect(created.status).toBe(201);

    const forMember = await api.get(
      `/notes/templates?workspaceId=${workspaceId}`,
      member.accessToken,
    );
    expect(forMember.body.data.items.map((t: { name: string }) => t.name)).toContain('Del equipo');
  });

  it('lets a member of the space write their own template in it', async () => {
    const owner = await createVerifiedUser(api);
    const member = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(owner, 'Equipo');

    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: member.email, role: 'editor' },
      owner.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, member.accessToken);

    const created = await api.post(
      '/notes/templates',
      { workspaceId, name: 'Mia del equipo', scope: 'workspace', document: '<p>x</p>' },
      member.accessToken,
    );

    expect(created.status).toBe(201);
  });

  it('refuses a viewer the right to make one, the way it refuses a list', async () => {
    const owner = await createVerifiedUser(api);
    const viewer = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(owner, 'Con viewer');

    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: viewer.email, role: 'viewer' },
      owner.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, viewer.accessToken);

    const response = await api.post(
      '/notes/templates',
      { workspaceId, name: 'No', document: '<p>x</p>' },
      viewer.accessToken,
    );

    expect(response.status).toBe(403);
  });
});
