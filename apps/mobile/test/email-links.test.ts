import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The share notification is an email with a button in it, and the button has a URL
 * in it. That URL is the only way the person who was given something finds out, and
 * nothing about a missing route looks like a bug from the server: the mail sends
 * fine, the static host answers 200 for every path because it is a single-page app,
 * and the recipient sees "Page could not be found" on the screen of somebody who has
 * just been told they have been given something.
 *
 * So the address in the mail is checked against the routes that exist. A missing
 * `/shared` is exactly what happened, and the typecheck said nothing about it: the
 * link is a string built at runtime from a constant.
 */

const ROOT = join(import.meta.dirname, '..');

/** Every route the app answers, as the paths a link would use. */
function routePaths(): Set<string> {
  const routes = new Set<string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        // A group in parentheses is not part of the URL: `(app)/shared.tsx` is
        // `/shared`. Getting that wrong here would report every grouped route as
        // unmatched, which is the kind of false alarm that teaches people to
        // ignore this test.
        const name = entry.name.startsWith('(') && entry.name.endsWith(')')
          ? ''
          : `/${entry.name}`;
        walk(path, `${prefix}${name}`);
        continue;
      }

      if (!entry.name.endsWith('.tsx')) continue;

      const file = entry.name.replace(/\.tsx$/, '');
      if (file.startsWith('+')) continue; // `_layout`, `+not-found`, `+html`
      if (file.startsWith('_')) continue; // private

      const segment = file === 'index' ? '' : `/${file}`;
      const full = `${prefix}${segment}` || '/';
      routes.add(full);

      // A dynamic segment answers more than its pattern does: `/note/abc` is what
      // the app answers, and the pattern is `/note/[noteId]`.
      if (segment.includes('[')) {
        routes.add(`${prefix}/${file.replace(/\[[^\]]+\]/g, 'example')}`);
      }
    }
  };

  walk(join(ROOT, 'src/app'), '');
  return routes;
}

describe('the share email points at a route that exists', () => {
  const routes = routePaths();

  it('knows about the routes it is checking against', () => {
    // If this fails the walk is broken and every other test in the file is
    // measuring nothing.
    expect(routes.has('/')).toBe(true);
    expect(routes.has('/workspaces')).toBe(true);
    expect(routes.has('/invite/example')).toBe(true);
  });

  it('the inbox the mail links to is a screen, not a hole', () => {
    // `/shared` is `absoluteLink('/shared')` in the share template. It was not a
    // route: the inbox lived inside the drawer, and a drawer is a panel, not an
    // address.
    expect(routes.has('/shared')).toBe(true);
  });

  it('every path the mail templates link to is a route', () => {
    const email = readFileSync(
      join(ROOT, '../api/src/modules/email/email.ts'),
      'utf8',
    );

    const linked = [...email.matchAll(/absoluteLink\('(\/[^']*)'\)/g)].map((m) => m[1]!);
    expect(linked.length).toBeGreaterThan(0);

    const missing = linked.filter((path) => !routes.has(path.replace(/\/$/, '') || '/'));
    expect(missing).toEqual([]);
  });
});