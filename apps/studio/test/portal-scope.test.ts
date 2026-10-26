// Every portal into document.body keeps the app's `.maude` scope (client/v2/portal-scope.jsx): the kit's
// rules are scoped under `.maude`, so a bare body portal renders unstyled buttons (D5 02 ob-ai-connect,
// 13 ds-edge-trash). A file still on the list below is a known debt — remove it once it uses portalToBody.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..', 'client');
const DEBT = new Set<string>([]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx|tsx|js|ts)$/.test(name)) out.push(p);
  }
  return out;
}

describe('portal scope', () => {
  test('no bare createPortal(…, document.body) outside the debt list', () => {
    const bare: string[] = [];
    for (const f of walk(ROOT)) {
      const rel = relative(join(import.meta.dir, '..'), f);
      if (rel === 'client/v2/portal-scope.jsx') continue;
      const src = readFileSync(f, 'utf8');
      if (/createPortal\([\s\S]*?,\s*document\.body\s*\)/.test(src)) {
        // every body portal's root re-establishes the scope itself (a className starting with "maude" on the
        // element it portals — checked in the first lines after each createPortal call)
        const calls = src
          .split('createPortal(')
          .slice(1)
          .filter((c) => /,\s*document\.body\s*\)/.test(c));
        const scoped = calls.every((c) => /className="maude[ "]/.test(c.slice(0, 700)));
        if (!scoped && !DEBT.has(rel)) bare.push(rel);
      }
    }
    expect(bare).toEqual([]);
  });

  test('portalToBody wraps its node in .maude', async () => {
    const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
    GlobalRegistrator.register();
    try {
      const { createRoot } = await import('react-dom/client');
      const { act, createElement } = await import('react');
      const { portalToBody } = await import('../client/v2/portal-scope.jsx');
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      await act(async () => root.render(portalToBody(createElement('button', { id: 'p' }, 'x'))));
      const b = document.getElementById('p') as HTMLElement;
      expect(host.contains(b)).toBe(false);
      expect(b.closest('.maude')).not.toBeNull();
      await act(async () => root.unmount());
    } finally {
      GlobalRegistrator.unregister();
    }
  });
});
