import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { collections } from '../src/db/content-schema.js';

describe('la tabla collections', () => {
  it('declara el nombre con el ancho que el contrato tambien exige', () => {
    const columns = getTableColumns(collections);
    expect(columns.name).toBeDefined();
    expect('length' in columns.name ? columns.name.length : null).toBe(120);
  });

  it('cuelga de un workspace y de una carpeta opcional', () => {
    const columns = getTableColumns(collections);
    expect(columns.workspaceId).toBeDefined();
    expect(columns.folderId).toBeDefined();
    expect(columns.version).toBeDefined();
    expect(columns.deletedAt).toBeDefined();
  });
});
