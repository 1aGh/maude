// S10.7 (13 · ds-edit-colour): a token edited in place waits as ONE `dsPending` entry. Two Macs on different
// tokens merge; the same token → the later one re-reads; a locked brand colour refuses; the Design system
// bar says "1 change waiting". Driven through the real routes and the real client writer (token-write.js),
// so the panel, the registry action and an agent are one path.
import { afterAll, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { resolveAccess } from '../access/scope.ts';
import {
  darkFollowsOf,
  fetchBoard,
  runTokenAction,
  TOKEN_WORDS,
  writeToken,
} from '../client/v2/ds/token-write.js';
import { buildBoardModel } from '../ds/board/build-model.ts';
import { DsBarView, waitingWords } from '../ds/board/ds-bar.tsx';
import { DsEngineError } from '../ds/engine.ts';
import { emitTokensJson, parseSystem } from '../ds/generate.ts';
import { newHead, writeHead } from '../ds/head.ts';
import { buildRevision, revisionWritePlan } from '../ds/revision.ts';
import { createDsRoutes } from '../routes/ds.ts';
import {
  COMPONENTS_CSS,
  cleanup,
  DS,
  DS_PATH,
  makeProject,
  PERSON,
  type Project,
  TOKENS_CSS,
} from './_ds-engine-fixture.ts';

afterAll(cleanup);

const CANVAS = `${DS_PATH}/design-system.tsx`;
const pendingOf = (p: Project) =>
  ((p.meta(CANVAS).dsPending as { tokens?: Record<string, Record<string, unknown>> }) ?? {})
    .tokens ?? {};

/** `fetch` for the client writer, answered by the real route table of this project. */
function bridge(p: Project, role: 'view' | 'edit' = 'edit'): typeof fetch {
  const claim =
    role === 'view'
      ? { v: 1 as const, role: 'observer' as const }
      : { v: 1 as const, role: 'member' as const };
  const specs = createDsRoutes({
    engine: () => p.engine,
    access: () => resolveAccess(claim),
    person: async () => ({ name: 'Michal' }),
  });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const spec = specs.find((s) => s.method === method && s.path === u.pathname);
    if (!spec) return new Response('{}', { status: 404 });
    const req = new Request(u, {
      method,
      body: init?.body as BodyInit | undefined,
      headers: init?.headers,
    });
    return spec.handle(req, {});
  }) as typeof fetch;
}

/** acme, with `--fg-0` a frozen brand colour (tokens.json says so) — the head revision carries it. */
async function lockedProject(): Promise<Project> {
  const p = await makeProject();
  const tm = parseSystem({
    config: { name: DS, rootClass: 'acme', themes: ['light', 'dark'], defaultTheme: 'light' },
    tokensCss: TOKENS_CSS,
    tokensJson: null,
  });
  tm.tokens['--fg-0'].data.locked = true;
  const json = emitTokensJson(tm);
  const R1 = buildRevision(DS, {
    'colors_and_type.css': TOKENS_CSS,
    'preview/_components.css': COMPONENTS_CSS,
    'tokens.json': json,
  });
  for (const w of revisionWritePlan(() => null, R1, {})) p.write(`${DS_PATH}/${w.path}`, w.text);
  p.write(`${DS_PATH}/tokens.json`, json);
  writeHead(p.dsAbs, { ...newHead(DS, { head: R1.id, base: R1.id }) }, { head: p.R0, base: p.R0 });
  return p;
}

describe('GET /_api/ds/board — the model the panel edits from', () => {
  test('values per theme, locked, usage and what waits — the same builder the canvas uses', async () => {
    const p = await makeProject();
    const model = await fetchBoard(DS, bridge(p));
    expect(model?.format).toBe('maude.ds-board');
    const accent = model?.tokens.find((t: { css: string }) => t.css === '--accent');
    expect(accent.values).toEqual({ light: 'oklch(0.55 0.2 255)', dark: 'oklch(0.65 0.2 255)' });
    expect(accent.locked).toBe(false);
    expect(accent.pending).toBeNull();
    expect(accent.darkFollows).toBeNull();
    expect(darkFollowsOf(accent)).toBe(true); // never said: it follows
    expect(model).toEqual(
      JSON.parse(JSON.stringify(buildBoardModel(p.designRoot, p.engine.systems()[0])))
    );
  });

  test('a system that is not there is answered as one that does not exist', async () => {
    const p = await makeProject();
    expect(await fetchBoard('nope', bridge(p))).toBeNull();
  });
});

describe('a finished drag is ONE waiting entry (13 · ds-edit-colour)', () => {
  test('Light changes, Dark follows keeping the pair’s relation, the bar says "1 change waiting"', async () => {
    const p = await makeProject();
    const f = bridge(p);
    const r = await writeToken(
      { ds: DS, css: '--accent', edit: { theme: 'light', value: 'oklch(0.45 0.2 255)' } },
      f
    );
    expect(r.ok).toBe(true);
    const entry = pendingOf(p)['--accent'];
    expect(entry.light).toBe('oklch(0.45 0.2 255)');
    // 0.55 → 0.65 in the files: the new Light 0.45 keeps the +0.10 gap
    const dark = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(String(entry.dark));
    expect(dark).not.toBeNull();
    expect(Math.abs(Number(dark?.[1]) - 0.55)).toBeLessThan(0.02);
    expect(entry.darkFollows).toBeUndefined(); // the file says nothing, it follows: nothing to wait for
    expect((entry.by as { name: string }).name).toBe('Michal');

    const model = await fetchBoard(DS, f);
    expect(model?.pendingCount).toBe(1);
    expect(waitingWords(model?.pendingCount)).toBe('1 change waiting');
    const bar = renderToStaticMarkup(DsBarView({ model, mode: 'light', onMode: () => {} }));
    expect(bar).toContain('1 change waiting');
    expect(bar).toContain('data-testid="ds-bar-pending"');
  });

  test('Dark by hand: it no longer follows, and a later Light edit leaves Dark alone', async () => {
    const p = await makeProject();
    const f = bridge(p);
    await writeToken(
      { ds: DS, css: '--accent', edit: { theme: 'dark', value: 'oklch(0.7 0.1 30)' } },
      f
    );
    let e = pendingOf(p)['--accent'];
    expect(e.dark).toBe('oklch(0.7 0.1 30)');
    expect(e.darkFollows).toBe(false);
    const model = await fetchBoard(DS, f);
    expect(darkFollowsOf(model?.tokens.find((t: { css: string }) => t.css === '--accent'))).toBe(
      false
    );
    await writeToken(
      { ds: DS, css: '--accent', edit: { theme: 'light', value: 'oklch(0.4 0.2 255)' } },
      f
    );
    e = pendingOf(p)['--accent'];
    expect(e.light).toBe('oklch(0.4 0.2 255)');
    expect(e.dark).toBe('oklch(0.7 0.1 30)');
    expect(e.darkFollows).toBe(false);
  });

  test('Dark follows turned back on re-derives Dark from the Light on screen', async () => {
    const p = await makeProject();
    const f = bridge(p);
    await writeToken(
      { ds: DS, css: '--accent', edit: { theme: 'dark', value: 'oklch(0.7 0.1 30)' } },
      f
    );
    await writeToken({ ds: DS, css: '--accent', edit: { follows: true } }, f);
    const e = pendingOf(p)['--accent'];
    expect(e.darkFollows).toBeUndefined(); // back to what the file says
    expect(e.dark).not.toBe('oklch(0.7 0.1 30)');
  });

  test('the colour’s own name is kept in both modes while Dark follows', async () => {
    const p = await makeProject();
    const f = bridge(p);
    await writeToken({ ds: DS, css: '--accent', edit: { theme: 'light', value: '#336699' } }, f);
    await writeToken(
      { ds: DS, css: '--accent', edit: { theme: 'light', name: 'Deeper azure' } },
      f
    );
    expect(pendingOf(p)['--accent'].valueNames).toEqual({
      light: 'Deeper azure',
      dark: 'Deeper azure',
    });
  });

  test('a value that is not one value is never sent', async () => {
    const p = await makeProject();
    const r = await writeToken(
      { ds: DS, css: '--accent', edit: { theme: 'light', value: 'red; } body { display:none' } },
      bridge(p)
    );
    expect(r).toMatchObject({ ok: false, message: TOKEN_WORDS.invalid });
    expect(pendingOf(p)['--accent']).toBeUndefined();
  });

  test('the registry actions are the same write (ds.set-token · ds.set-dark-follows)', async () => {
    const p = await makeProject();
    const f = bridge(p);
    const a = await runTokenAction(
      'ds.set-token',
      { ds: DS, css: '--accent', value: '#224466' },
      f
    );
    expect(a.ok).toBe(true);
    expect(pendingOf(p)['--accent'].light).toBe('#224466');
    const b = await runTokenAction(
      'ds.set-dark-follows',
      { ds: DS, css: '--accent', follows: false },
      f
    );
    expect(b.ok).toBe(true);
    expect(pendingOf(p)['--accent'].darkFollows).toBe(false);
    expect(
      (await runTokenAction('ds.set-token', { ds: DS, css: 'nope', value: '#fff' }, f)).ok
    ).toBe(false);
    expect((await runTokenAction('ds.set-token', { css: '--accent', value: '#fff' }, f)).ok).toBe(
      false
    );
  });
});

describe('two Macs', () => {
  test('different tokens merge — both wait', async () => {
    const p = await makeProject();
    const f = bridge(p);
    // both read the board BEFORE either writes
    const seenA = await fetchBoard(DS, f);
    const seenB = await fetchBoard(DS, f);
    const a = await writeToken(
      { ds: DS, css: '--accent', edit: { theme: 'light', value: '#224466' }, model: seenA },
      f
    );
    const b = await writeToken(
      { ds: DS, css: '--fg-0', edit: { theme: 'light', value: '#222222' }, model: seenB },
      f
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(Object.keys(pendingOf(p)).sort()).toEqual(['--accent', '--fg-0']);
  });

  test('the same token: the later one re-reads, sees the other’s edit, and can go on from it', async () => {
    const p = await makeProject();
    const f = bridge(p);
    const seenA = await fetchBoard(DS, f);
    const seenB = await fetchBoard(DS, f);
    const a = await writeToken(
      { ds: DS, css: '--accent', edit: { theme: 'light', value: '#224466' }, model: seenA },
      f
    );
    expect(a.ok).toBe(true);
    const b = await writeToken(
      { ds: DS, css: '--accent', edit: { theme: 'light', value: '#aa3300' }, model: seenB },
      f
    );
    expect(b).toMatchObject({
      ok: false,
      code: 'ds-pending-conflict',
      message: TOKEN_WORDS.changed,
    });
    // nothing of B was written; the answer carries what is there now
    expect(pendingOf(p)['--accent'].light).toBe('#224466');
    const fresh = (
      b as {
        model: { tokens: Array<{ css: string; pending: { values: Record<string, string> } }> };
      }
    ).model;
    expect(fresh.tokens.find((t) => t.css === '--accent')?.pending.values.light).toBe('#224466');
    // B edits again on top of it
    const again = await writeToken(
      { ds: DS, css: '--accent', edit: { theme: 'light', value: '#aa3300' }, model: fresh },
      f
    );
    expect(again.ok).toBe(true);
    expect(pendingOf(p)['--accent'].light).toBe('#aa3300');
  });
});

describe('who may, and what is frozen', () => {
  test('a locked brand colour refuses — in the engine, before anything waits', async () => {
    const p = await lockedProject();
    await expect(
      p.engine.mergePending(DS, { tokens: { '--fg-0': { light: '#000000' } }, by: PERSON })
    ).rejects.toMatchObject({ code: 'ds-token-locked', status: 422 });
    expect(pendingOf(p)['--fg-0']).toBeUndefined();
    const r = await writeToken(
      { ds: DS, css: '--fg-0', edit: { theme: 'light', value: '#000000' } },
      bridge(p)
    );
    expect(r).toMatchObject({ ok: false, message: TOKEN_WORDS.locked });
    // the panel never even asks the server; an agent that does is refused all the same
    const direct = await bridge(p)('/_api/ds/pending', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ds: DS,
        tokens: { '--fg-0': { light: '#000000' } },
        expect: { '--fg-0': null },
      }),
    });
    expect(direct.status).toBe(422);
    expect((await direct.json()).code).toBe('ds-token-locked');
    // …and the model says it is locked
    const m = await fetchBoard(DS, bridge(p));
    expect(m?.tokens.find((t: { css: string }) => t.css === '--fg-0').locked).toBe(true);
    // an unlocked token of the same system still waits
    expect(
      (
        await writeToken(
          { ds: DS, css: '--accent', edit: { theme: 'light', value: '#224466' } },
          bridge(p)
        )
      ).ok
    ).toBe(true);
  });

  test('Can view reads the board and is refused the write, in words', async () => {
    const p = await makeProject();
    const f = bridge(p, 'view');
    expect((await fetchBoard(DS, f))?.format).toBe('maude.ds-board');
    const r = await writeToken(
      { ds: DS, css: '--accent', edit: { theme: 'light', value: '#224466' } },
      f
    );
    expect(r).toMatchObject({ ok: false, code: 'forbidden', message: TOKEN_WORDS.forbidden });
    expect(pendingOf(p)['--accent']).toBeUndefined();
  });

  test('a locked token of the engine error class carries its name', () => {
    const e = new DsEngineError('ds-token-locked', 'x');
    expect(e.status).toBe(422);
  });
});
