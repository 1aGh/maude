// S7.20 — `GET /_api/kinds/presets`: the one catalogue for the F size picker, with the person's Recent chips.
// MinRole edit (a viewer / Can comment session is refused by the server, not just shown no panel), main origin only
// (in neither canvas allowlist), read-only. A pick is remembered through `PATCH /_api/ui-prefs { recentSizes }`.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveAccess } from '../access/scope.ts';
import { CANVAS_SAFE_API } from '../http.ts';
import { PRESETS } from '../kinds/presets.ts';
import { allSpecs } from '../routes/index.ts';
import { createKindRoutes } from '../routes/kinds.ts';
import { mountRoutes } from '../routes/table.ts';
import { UI_PREFS_DEFAULTS, validateUiPrefsPatch } from '../ui-prefs.ts';
import { stubDeps } from './_route-stubs.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'maude-kinds-'));
  dirs.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    join(designRoot, 'ui', 'Home.tsx'),
    'export default function H() { return null; }\n'
  );
  return { designRoot };
}
const claim = (role: string) => resolveAccess({ v: 1, role } as never);
const routes = (role: string | null, recent?: unknown) => {
  const { designRoot } = sandbox();
  return createKindRoutes({
    designRoot,
    designRel: '.design',
    ...(role ? { access: () => claim(role) } : {}),
    recentIds: () => recent,
  });
};
const get = (url = '/_api/kinds/presets?file=.design/ui/Home.tsx') =>
  new Request(`http://localhost${url}`);

describe('in the one table', () => {
  test('main origin only, in neither canvas allowlist, declared once', () => {
    const specs = allSpecs(stubDeps()).filter((s) => s.path === '/_api/kinds/presets');
    expect(specs.map((s) => [s.method, s.origin, s.readOnly])).toEqual([
      ['GET', 'main', 'allowed'],
    ]);
    expect(mountRoutes(allSpecs(stubDeps())).canvasPaths).not.toContain('/_api/kinds/presets');
    expect(CANVAS_SAFE_API.has('/_api/kinds/presets')).toBe(false);
  });
});

describe('the list', () => {
  test('five groups with badges, the Custom size… tile and the kind words', async () => {
    const [spec] = routes('member');
    const r = await (spec as NonNullable<typeof spec>).handle(get(), {});
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      kinds: Record<string, string>;
      groups: Array<{
        id: string;
        title: string;
        badge: string;
        presets: Array<{ id: string; sizeText: string }>;
      }>;
      custom: { id: string; name: string };
      recent: unknown[];
    };
    expect(body.groups.map((g) => [g.id, g.title, g.badge, g.presets.length])).toEqual([
      ['app', 'App', 'Fixed size', 4],
      ['web', 'Web page', 'Grows as you add', 4],
      ['social', 'Social', 'Fixed size', 6],
      ['print', 'Print', 'mm, with bleed', 7],
      ['video', 'Video', 'Has a timeline', 3],
    ]);
    expect(body.groups.flatMap((g) => g.presets.map((p) => p.id))).toEqual(
      PRESETS.map((p) => p.id)
    );
    expect(body.custom).toMatchObject({ id: 'print-custom', name: 'Custom size…' });
    expect(body.kinds.digital).toBe('Fixed size');
    expect(body.recent).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('aliases');
  });

  test('Recent: ids that still name a preset, newest first, three at most', async () => {
    const [spec] = routes('owner', [
      'social-fb-event',
      'gone',
      'social-post-4-5',
      'print-a6',
      'app-desktop',
    ]);
    const body = (await (
      (await (spec as NonNullable<typeof spec>).handle(get(), {})) as Response
    ).json()) as {
      recent: Array<{ id: string; kind: string; name: string }>;
    };
    expect(body.recent.map((p) => [p.id, p.kind])).toEqual([
      ['social-fb-event', 'digital'],
      ['social-post-4-5', 'digital'],
      ['print-a6', 'print'],
    ]);
  });
});

describe('who may ask', () => {
  test.each([
    'viewer',
    'observer',
  ])('%s (Can comment / Can view) is refused with a 403, not shown an empty list', async (role) => {
    const [spec] = routes(role);
    const r = await (spec as NonNullable<typeof spec>).handle(get(), {});
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe('forbidden');
  });

  test('no access wired: refused (fail closed)', async () => {
    const [spec] = routes(null);
    expect((await (spec as NonNullable<typeof spec>).handle(get(), {})).status).toBe(403);
  });

  test.each(['member', 'owner'])('%s is served', async (role) => {
    const [spec] = routes(role);
    expect((await (spec as NonNullable<typeof spec>).handle(get(), {})).status).toBe(200);
  });
});

describe('PATCH /_api/ui-prefs { recentSizes }', () => {
  test('a short list of size ids is accepted and de-duplicated', () => {
    const r = validateUiPrefsPatch({ recentSizes: ['social-fb-event', 'print-a6', 'print-a6'] });
    expect(r).toEqual({ ok: true, patch: { recentSizes: ['social-fb-event', 'print-a6'] } });
    expect(UI_PREFS_DEFAULTS.recentSizes).toBeUndefined();
  });

  test.each([
    ['a string', 'print-a6'],
    ['more than eight', Array.from({ length: 9 }, (_, i) => `p-${i}`)],
    ['an id that is not one', ['Print A6']],
    ['a path', ['../etc']],
    ['a number', [3]],
  ])('%s is refused', (_n, v) => {
    expect(validateUiPrefsPatch({ recentSizes: v }).ok).toBe(false);
  });
});
