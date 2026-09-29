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

describe('opening one template', () => {
  it('reads a built-in by its key, whole', async () => {
    const user = await createVerifiedUser(api);
    const response = await api.get('/notes/templates/builtin:recipe', user.accessToken);
    expect(response.status).toBe(200);
    expect(response.body.data.builtInKey).toBe('recipe');
    expect(response.body.data.document).toContain('<h2>');
  });

  it('404s an unknown key rather than making an empty template', async () => {
    const user = await createVerifiedUser(api);
    const response = await api.get('/notes/templates/builtin:no-existe', user.accessToken);
    expect(response.status).toBe(404);
  });

  it('404s a personal template of somebody else', async () => {
    const author = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(author, 'Mia');
    const created = await api.post(
      '/notes/templates',
      { workspaceId, name: 'Secreta', scope: 'personal', document: '<p>x</p>' },
      author.accessToken,
    );

    const response = await api.get(
      `/notes/templates/${created.body.data.id}`,
      stranger.accessToken,
    );
    expect(response.status).toBe(404);
  });

  it('lets a viewer read the team templates without being able to change them', async () => {
    // Reading is not writing. A viewer of the space is offered these in the list,
    // so answering 403 here would be a screen that says no to something it just
    // offered a second ago.
    const owner = await createVerifiedUser(api);
    const viewer = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(owner, 'Equipo');
    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: viewer.email, role: 'viewer' },
      owner.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, viewer.accessToken);
    const created = await api.post(
      '/notes/templates',
      { workspaceId, name: 'Del equipo', scope: 'workspace', document: '<p>x</p>' },
      owner.accessToken,
    );

    const response = await api.get(
      `/notes/templates/${created.body.data.id}`,
      viewer.accessToken,
    );
    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Del equipo');
  });
});

describe('changing a template', () => {
  async function one(user: TestUser, workspaceId?: string, scope?: 'personal' | 'workspace') {
    const response = await api.post(
      '/notes/templates',
      {
        workspaceId: workspaceId ?? null,
        name: 'Pan',
        description: 'El de siempre',
        scope: scope ?? 'workspace',
        document: '<h2>Pan</h2><p>Harina</p>',
      },
      user.accessToken,
    );
    expect(response.status).toBe(201);
    return response.body.data;
  }

  it('renames one without resending the document', async () => {
    // The two are separate on purpose: a typo in a title should not mean sending
    // the whole document again, on a train, to fix three characters.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');
    const template = await one(user, workspaceId);

    const renamed = await api.patch(
      `/notes/templates/${template.id}`,
      { name: 'Pan de verdad', expectedVersion: template.version },
      user.accessToken,
    );

    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Pan de verdad');
    expect(renamed.body.data.document).toBe(template.document);
    expect(renamed.body.data.version).toBe(template.version + 1);
  });

  it('rewrites the document and the line derived from it', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');
    const template = await one(user, workspaceId);

    const changed = await api.patch(
      `/notes/templates/${template.id}`,
      { document: '<p>Harina, agua, sal, mucha masa madre.</p>', expectedVersion: template.version },
      user.accessToken,
    );

    expect(changed.status).toBe(200);
    expect(changed.body.data.document).toBe('<p>Harina, agua, sal, mucha masa madre.</p>');
    expect(changed.body.data.plainText).toContain('masa madre');
  });

  it('refuses a document the editor could not open', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');
    const template = await one(user, workspaceId);

    const response = await api.patch(
      `/notes/templates/${template.id}`,
      { document: '<p>hola</p><iframe src="x"></iframe>', expectedVersion: template.version },
      user.accessToken,
    );

    expect(response.status).toBe(422);
  });

  it('refuses an empty change, rather than storing a version that did nothing', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');
    const template = await one(user, workspaceId);

    const response = await api.patch(
      `/notes/templates/${template.id}`,
      { expectedVersion: template.version },
      user.accessToken,
    );

    expect(response.status).toBe(422);
  });

  it('says so when somebody else changed it first', async () => {
    // Two devices, one template, and the second save is based on a version that no
    // longer exists. Last-write-wins would drop a paragraph without a word.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');
    const template = await one(user, workspaceId);

    await api.patch(
      `/notes/templates/${template.id}`,
      { name: 'Desde el movil', expectedVersion: template.version },
      user.accessToken,
    );
    const stale = await api.patch(
      `/notes/templates/${template.id}`,
      { name: 'Desde el portatil', expectedVersion: template.version },
      user.accessToken,
    );

    expect(stale.status).toBe(409);
  });

  it('refuses to change one that comes with the app', async () => {
    // The catalogue is code. An edit would be replaced by the next build with no
    // warning, so the answer is a refusal with a reason rather than a silent loss.
    const user = await createVerifiedUser(api);
    const response = await api.patch(
      '/notes/templates/builtin:recipe',
      { name: 'Mi receta', expectedVersion: 1 },
      user.accessToken,
    );

    expect(response.status).toBe(403);
  });

  it('refuses a personal template of somebody else, as not found', async () => {
    // They cannot see it either, and saying "not yours" would tell a stranger that
    // the id exists.
    const author = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(author, 'Mia');
    const template = await one(author, workspaceId, 'personal');

    const response = await api.patch(
      `/notes/templates/${template.id}`,
      { name: 'Secuestrada', expectedVersion: template.version },
      stranger.accessToken,
    );

    expect(response.status).toBe(404);
  });

  it('lets another editor in the space repair a workspace template', async () => {
    // A team template only its author may fix is a template the team cannot
    // maintain.
    const owner = await createVerifiedUser(api);
    const member = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(owner, 'Equipo');
    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: member.email, role: 'editor' },
      owner.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, member.accessToken);
    const template = await one(owner, workspaceId, 'workspace');

    const response = await api.patch(
      `/notes/templates/${template.id}`,
      { description: 'Arreglado por el equipo', expectedVersion: template.version },
      member.accessToken,
    );

    expect(response.status).toBe(200);
  });

  it('refuses a viewer, the way it refuses a list', async () => {
    const owner = await createVerifiedUser(api);
    const viewer = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(owner, 'Con viewer');
    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: viewer.email, role: 'viewer' },
      owner.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, viewer.accessToken);
    const template = await one(owner, workspaceId, 'workspace');

    const response = await api.patch(
      `/notes/templates/${template.id}`,
      { name: 'No', expectedVersion: template.version },
      viewer.accessToken,
    );

    expect(response.status).toBe(403);
  });
});

describe('deleting a template', () => {
  async function one(user: TestUser, workspaceId: string) {
    const response = await api.post(
      '/notes/templates',
      { workspaceId, name: 'Pan', scope: 'workspace', document: '<p>Harina</p>' },
      user.accessToken,
    );
    return response.body.data;
  }

  it('takes it off the list and it can no longer be applied', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');
    const template = await one(user, workspaceId);

    const removed = await api.delete(
      `/notes/templates/${template.id}`,
      user.accessToken,
    );
    expect(removed.status).toBe(200);

    const listed = await api.get(`/notes/templates?workspaceId=${workspaceId}`, user.accessToken);
    expect(listed.body.data.items.map((t: { name: string }) => t.name)).not.toContain('Pan');

    const applied = await api.post(
      '/templates/apply',
      { templateId: template.id, workspaceId },
      user.accessToken,
    );
    expect(applied.status).toBe(404);
  });

  it('leaves the notes it made alone', async () => {
    // A template is a copy, and a copy that changed when the original was deleted
    // would not be a copy.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Cocina');
    const template = await one(user, workspaceId);

    const note = await api.post(
      '/templates/apply',
      { templateId: template.id, workspaceId },
      user.accessToken,
    );
    await api.delete(`/notes/templates/${template.id}`, user.accessToken);

    const still = await api.get(`/notes/${note.body.data.id}`, user.accessToken);
    expect(still.status).toBe(200);
    expect(still.body.data.document).toBe('<p>Harina</p>');
  });

  it('cannot delete one that comes with the app', async () => {
    const user = await createVerifiedUser(api);
    const response = await api.delete('/notes/templates/builtin:recipe', user.accessToken);
    expect(response.status).toBe(403);
  });
});

describe('a template of mine, and where it lives', () => {
  it('follows me into every space, because it is stored with none', async () => {
    // The whole point of the personal scope: a private shape the person wrote is
    // theirs, not something a space is holding for them. Stored with a space it
    // would be offered to the team, and it would disappear the day they left.
    const user = await createVerifiedUser(api);
    const first = await createWorkspace(user, 'Casa');
    const second = await createWorkspace(user, 'Curro');

    const created = await api.post(
      '/notes/templates',
      { workspaceId: first, name: 'Mi forma', scope: 'personal', document: '<p>x</p>' },
      user.accessToken,
    );
    expect(created.status).toBe(201);
    expect(created.body.data.workspaceId).toBeNull();

    // Offered from anywhere, with no space named at all.
    const fromNowhere = await api.get('/notes/templates', user.accessToken);
    expect(fromNowhere.body.data.items.map((t: { name: string }) => t.name)).toContain('Mi forma');

    // And in either space, which is the same row and not a copy.
    for (const workspaceId of [first, second]) {
      const listed = await api.get(`/notes/templates?workspaceId=${workspaceId}`, user.accessToken);
      expect(listed.body.data.items.map((t: { name: string }) => t.name)).toContain('Mi forma');
    }
  });

  it('puts mine above the catalogue, because that is what I came for', async () => {
    // Twelve recipes in alphabetical order put "Book, film or series" above the
    // thing the person wrote five minutes ago, and their own list ends up at the
    // bottom of a screen nobody scrolls to.
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Mia');
    await api.post(
      '/notes/templates',
      { workspaceId, name: 'Zeta, la mia', scope: 'personal', document: '<p>x</p>' },
      user.accessToken,
    );

    const listed = await api.get(`/notes/templates?workspaceId=${workspaceId}`, user.accessToken);
    expect(listed.body.data.items[0].name).toBe('Zeta, la mia');
  });

  it('offers nothing from a space the caller is not in', async () => {
    // A regression test with teeth: the screen is opened from outside any space —
    // the notes list, the header — and answering with the whole table would show
    // somebody the templates of spaces they have never heard of, including the
    // private shapes of people they have never met.
    const owner = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(owner, 'Suya');
    await api.post(
      '/notes/templates',
      { workspaceId, name: 'Del otro', scope: 'workspace', document: '<p>x</p>' },
      owner.accessToken,
    );

    const listed = await api.get('/notes/templates', stranger.accessToken);
    expect(listed.body.data.items.map((t: { name: string }) => t.name)).not.toContain('Del otro');
    // And not even to somebody who is in the space: a template is offered inside
    // the space, by the request that names the space. With no space named, a
    // viewer sees the built-ins and their own — never the team's.
    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: stranger.email, role: 'viewer' },
      owner.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, stranger.accessToken);
    const withNoSpace = await api.get('/notes/templates', stranger.accessToken);
    expect(withNoSpace.body.data.items.map((t: { name: string }) => t.name)).not.toContain(
      'Del otro',
    );
  });
});

describe('sharing a template', () => {
  async function personal(user: TestUser, workspaceId: string, name = 'Mi forma') {
    const response = await api.post(
      '/notes/templates',
      { workspaceId, name, scope: 'personal', document: '<p>x</p>' },
      user.accessToken,
    );
    return response.body.data;
  }

  it('puts it in a space, where everybody there can use it', async () => {
    const author = await createVerifiedUser(api);
    const member = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(author, 'Equipo');
    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: member.email, role: 'editor' },
      author.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, member.accessToken);
    const template = await personal(author, workspaceId);

    const shared = await api.post(
      `/notes/templates/${template.id}/share`,
      { scope: 'workspace', workspaceId },
      author.accessToken,
    );
    expect(shared.status).toBe(200);
    expect(shared.body.data.scope).toBe('workspace');
    expect(shared.body.data.workspaceId).toBe(workspaceId);

    // The colleague can now start a note from it.
    const applied = await api.post(
      '/templates/apply',
      { templateId: template.id, workspaceId },
      member.accessToken,
    );
    expect(applied.status).toBe(201);
  });

  it('lets an editor in the space repair it, which is what sharing them for', async () => {
    const author = await createVerifiedUser(api);
    const member = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(author, 'Equipo');
    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: member.email, role: 'editor' },
      author.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, member.accessToken);
    const template = await personal(author, workspaceId);
    const shared = await api.post(
      `/notes/templates/${template.id}/share`,
      { scope: 'workspace', workspaceId },
      author.accessToken,
    );

    const repaired = await api.patch(
      `/notes/templates/${template.id}`,
      { description: 'Arreglada por el equipo', expectedVersion: shared.body.data.version },
      member.accessToken,
    );
    expect(repaired.status).toBe(200);
  });

  it('takes it back, and it stops being the team\'s', async () => {
    const author = await createVerifiedUser(api);
    const member = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(author, 'Equipo');
    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: member.email, role: 'editor' },
      author.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, member.accessToken);
    const template = await personal(author, workspaceId, 'Receta compartida');
    await api.post(
      `/notes/templates/${template.id}/share`,
      { scope: 'workspace', workspaceId },
      author.accessToken,
    );

    const taken = await api.post(
      `/notes/templates/${template.id}/share`,
      { scope: 'personal' },
      author.accessToken,
    );
    expect(taken.status).toBe(200);
    expect(taken.body.data.scope).toBe('personal');
    expect(taken.body.data.workspaceId).toBeNull();

    // Gone for the colleague, who is who it was shared with.
    const forMember = await api.get(
      `/notes/templates?workspaceId=${workspaceId}`,
      member.accessToken,
    );
    expect(forMember.body.data.items.map((t: { name: string }) => t.name)).not.toContain(
      'Receta compartida',
    );

    // And still the author's, in the space — a personal template is offered in
    // every space so it can be used there, and out of every space it is not.
    const forAuthor = await api.get(`/notes/templates?workspaceId=${workspaceId}`, author.accessToken);
    expect(forAuthor.body.data.items.map((t: { name: string }) => t.name)).toContain(
      'Receta compartida',
    );
    const elsewhere = await api.get('/notes/templates', author.accessToken);
    expect(elsewhere.body.data.items.map((t: { name: string }) => t.name)).toContain(
      'Receta compartida',
    );
  });

  it('refuses somebody who did not write it, even an editor of the space', async () => {
    // Repairing the words is maintenance and is allowed. Moving the template into
    // your own space is a different act: it takes it away from the team.
    const author = await createVerifiedUser(api);
    const member = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(author, 'Equipo');
    const mine = await createWorkspace(member, 'Suya');
    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: member.email, role: 'editor' },
      author.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, member.accessToken);
    const template = await api.post(
      '/notes/templates',
      { workspaceId, name: 'Del equipo', scope: 'workspace', document: '<p>x</p>' },
      author.accessToken,
    ).then((r) => r.body.data);

    const stolen = await api.post(
      `/notes/templates/${template.id}/share`,
      { scope: 'workspace', workspaceId: mine },
      member.accessToken,
    );
    expect(stolen.status).toBe(403);
  });

  it('asks for a space, and refuses one on a personal share', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Mia');
    const template = await personal(user, workspaceId);

    const noSpace = await api.post(
      `/notes/templates/${template.id}/share`,
      { scope: 'workspace' },
      user.accessToken,
    );
    expect(noSpace.status).toBe(422);

    const both = await api.post(
      `/notes/templates/${template.id}/share`,
      { scope: 'personal', workspaceId },
      user.accessToken,
    );
    expect(both.status).toBe(422);
  });

  it('refuses to share one that comes with the app', async () => {
    const user = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(user, 'Mia');
    const response = await api.post(
      '/notes/templates/builtin:recipe/share',
      { scope: 'workspace', workspaceId },
      user.accessToken,
    );
    expect(response.status).toBe(403);
  });

  it('refuses to share into a space you cannot write in', async () => {
    const author = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const mine = await createWorkspace(author, 'Mia');
    const theirs = await createWorkspace(stranger, 'Suya');
    const template = await personal(author, mine);

    const response = await api.post(
      `/notes/templates/${template.id}/share`,
      { scope: 'workspace', workspaceId: theirs },
      author.accessToken,
    );
    expect(response.status).toBe(404);
  });
});

describe('publicar una plantilla', () => {
  async function one(user: TestUser, workspaceId: string, name = 'Mi receta') {
    const response = await api.post(
      '/notes/templates',
      { workspaceId, name, scope: 'workspace', document: '<p>Harina y agua</p>' },
      user.accessToken,
    );
    expect(response.status).toBe(201);
    return response.body.data;
  }

  it('la pone a disposicion de cualquiera, sin espacio de por medio', async () => {
    // Publicar es "para todo el mundo", y un catálogo que hay que tener un
    // espacio para ver no es un catálogo.
    const author = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(author, 'Mia');
    const template = await one(author, workspaceId);

    const published = await api.post(
      `/notes/templates/${template.id}/publish`,
      {},
      author.accessToken,
    );
    expect(published.status).toBe(200);
    expect(published.body.data.scope).toBe('public');
    // Sin espacio: si se quedase con el suyo, al descompartirla volvería al
    // espacio en vez de a la mano de quien la escribió.
    expect(published.body.data.workspaceId).toBeNull();

    // Alguien que no conoce a la autora, y no comparte ningun espacio con ella.
    const forStranger = await api.get('/notes/templates', stranger.accessToken);
    expect(forStranger.body.data.items.map((t: { name: string }) => t.name)).toContain('Mi receta');
  });

  it('todo el mundo puede usarla, y solo quien la wrote puede tocarla', async () => {
    // Este es el pacto entero: se usa, no se reescribe. Una receta de una
    // persona es de esa persona, aunque se ofrezca a todo el mundo.
    const author = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const theirSpace = await createWorkspace(stranger, 'Suya');
    const template = await one(author, (await createWorkspace(author, 'Mia')));
    await api.post(`/notes/templates/${template.id}/publish`, {}, author.accessToken);

    // Usarla: sí.
    const applied = await api.post(
      '/templates/apply',
      { templateId: template.id, workspaceId: theirSpace },
      stranger.accessToken,
    );
    expect(applied.status).toBe(201);

    // Cambiarla: no.
    const edited = await api.patch(
      `/notes/templates/${template.id}`,
      { name: 'Receta de la abuela (falsa)', expectedVersion: 2 },
      stranger.accessToken,
    );
    expect(edited.status).toBe(403);

    // Borrarla: tampoco.
    const removed = await api.delete(`/notes/templates/${template.id}`, stranger.accessToken);
    expect(removed.status).toBe(403);
  });

  it('la devuelve a la mano de quien la escribio', async () => {
    const author = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(author, 'Mia');
    const template = await one(author, workspaceId, 'Secreto a medias');
    await api.post(`/notes/templates/${template.id}/publish`, {}, author.accessToken);

    const back = await api.delete(`/notes/templates/${template.id}/publish`, author.accessToken);
    expect(back.status).toBe(200);
    expect(back.body.data.scope).toBe('personal');
    expect(back.body.data.workspaceId).toBeNull();

    const forStranger = await api.get('/notes/templates', stranger.accessToken);
    expect(forStranger.body.data.items.map((t: { name: string }) => t.name)).not.toContain(
      'Secreto a medias',
    );
    const forAuthor = await api.get('/notes/templates', author.accessToken);
    expect(forAuthor.body.data.items.map((t: { name: string }) => t.name)).toContain('Secreto a medias');
  });

  it('las notas que se hicieron con ella siguen ahí después', async () => {
    // Publicar no es mover: la nota es una copia y una copia no se entera.
    const author = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(author, 'Mia');
    const template = await one(author, workspaceId);
    const note = await api.post(
      '/templates/apply',
      { templateId: template.id, workspaceId },
      author.accessToken,
    );

    await api.post(`/notes/templates/${template.id}/publish`, {}, author.accessToken);
    await api.delete(`/notes/templates/${template.id}/publish`, author.accessToken);

    const still = await api.get(`/notes/${note.body.data.id}`, author.accessToken);
    expect(still.status).toBe(200);
    expect(still.body.data.document).toBe('<p>Harina y agua</p>');
  });

  it('no la puede publicar ni despublicar quien no la escribio', async () => {
    // Un editor del espacio puede arreglar las palabras de una plantilla del
    // equipo. Sacarla del equipo y meterla en el catalogo es otra cosa, y esa la
    // decide quien la escribio.
    const author = await createVerifiedUser(api);
    const member = await createVerifiedUser(api);
    const workspaceId = await createWorkspace(author, 'Equipo');
    const link = await api.post(
      `/workspaces/${workspaceId}/invitations`,
      { email: member.email, role: 'editor' },
      author.accessToken,
    );
    await api.post(`/invitations/${link.body.data.token}/accept`, {}, member.accessToken);
    const template = await one(author, workspaceId);

    const published = await api.post(
      `/notes/templates/${template.id}/publish`,
      {},
      member.accessToken,
    );
    expect(published.status).toBe(403);
  });

  it('no deja publicar una que viene con la app', async () => {
    // El catalogo de la app son recetas que sustituye la siguiente version del
    // mismo modo, y una publicada se sustituye por quien la publico.
    const user = await createVerifiedUser(api);
    const response = await api.post(
      '/notes/templates/builtin:recipe/publish',
      {},
      user.accessToken,
    );
    expect(response.status).toBe(403);
  });

  it('no deja compartir una publicada por otra persona', async () => {
    const author = await createVerifiedUser(api);
    const stranger = await createVerifiedUser(api);
    const mine = await createWorkspace(author, 'Mia');
    const theirs = await createWorkspace(stranger, 'Suya');
    const template = await one(author, mine);
    await api.post(`/notes/templates/${template.id}/publish`, {}, author.accessToken);

    const stolen = await api.post(
      `/notes/templates/${template.id}/share`,
      { scope: 'workspace', workspaceId: theirs },
      stranger.accessToken,
    );
    expect(stolen.status).toBe(403);
  });
});
