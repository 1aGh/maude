// P8 G1a (09 ex-edges, 11 pn-cant-open) — a desktop window whose person was changed to Can view must lose Export,
// exactly like a cloud tab does. The role comes from the server's `/_config.access` (access-client.js
// `sessionRole`), never from `cloud.role` alone: a desktop linked to a v2 hub has no `cloud`, so the menu, the
// Export sheet, the vote sheet and View code read every read-only session as Can comment — a Can view person
// narrowed while the window was open kept Export… and ⇧⌘E (the server still refused the export: 403).
// Found by apps/desktop/e2e/share-roles/role-surfaces.test.mjs ("the owner changes Petra to Can view").

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { observerOn, sessionRole } from '../client/v2/access/access-client.js';
import { buildProjectMenu, menuCtx, modelIds } from '../client/v2/shell/project-menu-model.js';

const CLIENT = join(import.meta.dir, '..', 'client');
const desktopCanView = { readOnly: true, access: { role: 'observer', grants: [] } };
const desktopCanComment = { readOnly: true, access: { role: 'viewer', grants: [] } };
const menuFor = (cfg: unknown, rel: string | null) =>
  modelIds(
    buildProjectMenu(
      menuCtx({ native: true, readOnly: true, observer: observerOn(cfg, rel), canvasOpen: true })
    )
  );

describe('Can view on a desktop (no cloud tab): no Export anywhere', () => {
  test('observerOn reads the server’s access: project Can view, a Can view grant, never Can comment', () => {
    expect(observerOn(desktopCanView, 'ui/a.tsx')).toBe(true);
    expect(
      observerOn({ access: { role: null, grants: [{ c: 'ui/a.tsx', r: 'observer' }] } }, 'ui/a.tsx')
    ).toBe(true);
    expect(observerOn(desktopCanComment, 'ui/a.tsx')).toBe(false);
    // a project Can view with a Can comment grant on THIS canvas comments here
    expect(
      observerOn(
        { access: { role: 'observer', grants: [{ c: 'ui/a.tsx', r: 'viewer' }] } },
        'ui/a.tsx'
      )
    ).toBe(false);
    // an older server: a cloud tab's role
    expect(observerOn({ cloud: { role: 'observer' } }, null)).toBe(true);
    expect(sessionRole(desktopCanView, 'ui/a.tsx')).toBe('observer');
  });

  test('the menu a desktop Can view person sees has no Export and no Handoff; Can comment keeps Export', () => {
    const view = menuFor(desktopCanView, 'ui/a.tsx');
    expect(view).not.toContain('export.open');
    expect(view).not.toContain('handoff.open');
    expect(view).toContain('history.open');
    expect(menuFor(desktopCanComment, 'ui/a.tsx')).toContain('export.open');
  });

  test('the shell never decides a role from `cloud.role` alone (app.jsx, viewport.jsx)', () => {
    for (const rel of ['app.jsx', 'shell/viewport.jsx']) {
      const src = readFileSync(join(CLIENT, rel), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'));
      const hits = src.filter((l) => /cloud\?\.role\b/.test(l));
      expect({ rel, hits }).toEqual({ rel, hits: [] });
    }
  });
});
