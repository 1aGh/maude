// V2-8.9 r2 F4 (attacker) — the Recent colours row accepted image references. `RECENT_COLOUR_RE`
// (server) and `recentOk` (hydrate) let `url(/_api/…)` and `image-set(…)` through; a hydrated value is
// drawn as a swatch `background` in the TRUSTED shell (same-origin GETs) and a click writes it into the
// source as a "colour". In a cloud cell one prefs.json sits behind a session write, so any member — a
// viewer too — could plant entries editors then see and click.
// Now: only `isCssColor` values or `var(--name[, <colour>])`, on the server AND on hydrate; a cell
// refuses writing `recentColours` and serves none.
// Not changed (said in the hand-back): the list key stays the project's NAME — no project id reaches
// the Inspector without a new /_config field.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { createRecentStore, pushRecent } from '../client/v2/inspector/sections/recent-colours.js';
import { isRecentColour } from '../edit-ops/words-paint.ts';
import { validateUiPrefsPatch } from '../ui-prefs.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const BAD = [
  'url(/_api/canvas-source?file=ui/a.tsx)',
  'url(//attacker.example/x.png)',
  'image-set("x.png" 1x)',
  'image-set(url(x.png) 1x)',
  'color-mix(in srgb, red 50%, transparent), url(/x)',
  'rgb(1 2 3 / url(x))',
  'red, linear-gradient(red, blue)',
  'linear-gradient(red, blue)',
  'var(--x, url(a))',
  'var(--accent, image-set(a 1x))',
  'expression(alert(1))',
  'paint(worklet)',
];
const GOOD = [
  '#ff0000',
  'rgb(10 20 30)',
  'oklch(0.7 0.1 30)',
  'var(--accent)',
  'var(--bg-3, #d4d4d8)',
  'color-mix(in srgb, var(--accent) 50%, transparent)',
];

describe('isRecentColour (pure, shared by server and client)', () => {
  for (const c of BAD) test(`refused: ${c}`, () => expect(isRecentColour(c)).toBe(false));
  for (const c of GOOD) test(`kept: ${c}`, () => expect(isRecentColour(c)).toBe(true));
});

describe('the server accepts only colours', () => {
  test('a planted image reference is refused, the whole patch with it', () => {
    for (const c of BAD) {
      const r = validateUiPrefsPatch({ recentColours: { alligators: ['#fff', c] } });
      expect([c, r.ok]).toEqual([c, false]);
    }
    const ok = validateUiPrefsPatch({ recentColours: { alligators: GOOD } });
    expect(ok.ok).toBe(true);
  });
});

describe('the client keeps only colours on hydrate and push', () => {
  test('hydrate drops an image reference stored in prefs.json', () => {
    const store = createRecentStore();
    store.hydrate({ recentColours: { alligators: ['url(/_api/x)', '#fff', 'image-set(a 1x)'] } });
    expect(store.get('alligators')).toEqual(['#fff']);
  });
  test('push refuses one too', () => {
    expect(pushRecent(['#fff'], 'url(/_api/x)')).toEqual(['#fff']);
    expect(pushRecent([], 'var(--accent)')).toEqual(['var(--accent)']);
  });
});

describe('a cloud cell neither stores nor serves Recent colours', () => {
  const procs: Subprocess[] = [];
  let cell = '';
  let prefs = '';
  beforeAll(async () => {
    const { root } = makeSandbox();
    prefs = join(root, 'prefs.json');
    // a planted list from before this fix
    writeFileSync(prefs, JSON.stringify({ recentColours: { alligators: ['#123456'] } }));
    const port = nextPort();
    procs.push(
      await bootServer(root, port, {
        MAUDE_WORKSPACE_MODE: '1',
        MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
        HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
        MAUDE_PROJECT_NAME: 'Alligators',
        MAUDE_UI_PREFS_PATH: prefs,
      })
    );
    cell = `http://localhost:${port}`;
  }, 60000);
  afterAll(async () => {
    for (const p of procs) await killProc(p);
  });

  const claim = (c: unknown) => Buffer.from(JSON.stringify(c)).toString('base64url');
  const viewer = { 'x-maude-access': claim({ v: 1, role: 'observer' }), 'x-maude-readonly': '1' };

  test('a member (a viewer here) cannot write one', async () => {
    const r = await fetch(`${cell}/_api/ui-prefs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: cell, ...viewer },
      body: JSON.stringify({ recentColours: { alligators: ['#ff00ff'] } }),
    });
    expect(r.status).toBe(403);
    const disk = existsSync(prefs) ? JSON.parse(readFileSync(prefs, 'utf8')) : {};
    expect(disk.recentColours?.alligators).toEqual(['#123456']);
  });

  test('the stored list is not served', async () => {
    const r = await fetch(`${cell}/_api/ui-prefs`, { headers: viewer });
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect('recentColours' in body).toBe(false);
  });
});
