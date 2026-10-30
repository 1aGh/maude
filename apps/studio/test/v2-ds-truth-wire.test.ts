// S10.11 — the outside-change / conflict cards against the REAL routes and the REAL engine (a converted scratch
// project): what the client reads is what `routes/ds.ts` serves, what Keep / Undo / "Use this" send is what the
// routes accept, and the files end up where the card said they would.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { loadTruth, writeOutside, writePick, writePickHead } from '../client/v2/ds/truth-host.jsx';
import { TRUTH_WORDS } from '../client/v2/ds/truth-model.js';
import { createDsRoutes } from '../routes/ds.ts';
import { conflictCopyName } from '../sync/decide-file.ts';
import {
  ACCENT,
  cleanup,
  DS,
  DS_PATH,
  makeProject,
  PERSON,
  type Project,
  TOKENS_CSS,
} from './_ds-engine-fixture.ts';

afterAll(cleanup);

const claims: Record<string, AccessClaim> = {
  owner: { v: 1, role: 'owner' },
  view: { v: 1, role: 'observer' },
};
const CSS = `${DS_PATH}/colors_and_type.css`;
const quieter = TOKENS_CSS.replace('--fg-0: #111111;', '--fg-0: #222222;');
const fileAccent = TOKENS_CSS.replace('oklch(0.55 0.2 255)', 'oklch(0.45 0.15 180)');

/** `fetch` served by the real route table (the board and the revisions answer from the engine's own folder). */
function wire(p: Project, who: keyof typeof claims = 'owner') {
  const specs = createDsRoutes({
    engine: () => p.engine,
    access: () => resolveAccess(claims[who]),
    person: async () => ({ name: 'Michal' }),
  });
  return (async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const pathname = url.split('?')[0];
    const spec = specs.find((s) => s.method === method && s.path === pathname);
    if (!spec) throw new Error(`no ${method} ${pathname}`);
    return spec.handle(
      new Request(`http://localhost${url}`, {
        method,
        ...(init?.body ? { body: init.body, headers: { 'content-type': 'application/json' } } : {}),
      }),
      {}
    );
  }) as unknown as typeof fetch;
}

describe('an outside edit, through the routes', () => {
  test('nothing outside: the cards have nothing to say', async () => {
    const p = await makeProject();
    expect(await loadTruth(DS, wire(p))).toBeNull();
  });

  test('an edit arrives as a review; Keep moves base only and the review goes', async () => {
    const p = await makeProject();
    await p.outside(CSS, quieter);
    const got = await loadTruth(DS, wire(p));
    expect(got?.truth.outside?.changes.map((c: { css: string }) => c.css)).toEqual(['--fg-0']);
    expect(got?.truth.marks).toEqual({ outside: ['--fg-0'], conflicts: [] });
    expect(got?.truth.outside?.files[0]).toMatchObject({ path: 'colors_and_type.css' });
    expect(await writeOutside(DS, 'keep', wire(p))).toEqual({ ok: true });
    const h = p.head();
    expect(h.head).toBe(p.R0); // canvases keep head until "Update N canvases"
    expect(h.base).not.toBe(p.R0);
    expect(p.read(CSS)).toBe(quieter);
    expect(await loadTruth(DS, wire(p))).toBeNull();
  });

  test('Undo writes the old bytes back and leaves base alone', async () => {
    const p = await makeProject();
    await p.outside(CSS, quieter);
    const before = p.read(`${DS_PATH}/revisions/head.json`);
    expect(await writeOutside(DS, 'undo', wire(p))).toEqual({ ok: true });
    expect(p.read(CSS)).toBe(TOKENS_CSS);
    expect(p.read(`${DS_PATH}/revisions/head.json`)).toBe(before);
    expect(await loadTruth(DS, wire(p))).toBeNull();
  });

  test('Can view reads the card and is refused both buttons, in words; the file is untouched', async () => {
    const p = await makeProject();
    await p.outside(CSS, quieter);
    const seen = await loadTruth(DS, wire(p, 'view'));
    expect(seen?.truth.outside).not.toBeNull();
    expect(await writeOutside(DS, 'keep', wire(p, 'view'))).toMatchObject({
      ok: false,
      message: TRUTH_WORDS.forbidden,
    });
    expect(await writeOutside(DS, 'undo', wire(p, 'view'))).toMatchObject({ ok: false });
    expect(p.read(CSS)).toBe(quieter);
  });

  test('a review that is already gone says so in words', async () => {
    const p = await makeProject();
    expect(await writeOutside(DS, 'keep', wire(p))).toMatchObject({
      ok: false,
      message: TRUTH_WORDS.gone,
    });
  });
});

describe('a token in two places, through the routes', () => {
  async function clash() {
    const p = await makeProject();
    await p.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
      by: PERSON,
    });
    await p.outside(CSS, fileAccent);
    return p;
  }

  test('the clash is marked "2 versions", Keep is refused with a reason, canvases keep head', async () => {
    const p = await clash();
    const got = await loadTruth(DS, wire(p));
    expect(got?.truth.conflicts.map((c: { css: string }) => c.css)).toEqual(['--accent']);
    expect(got?.truth.marks.conflicts).toEqual(['--accent']);
    expect(got?.truth.marks.outside).not.toContain('--accent');
    expect(await writeOutside(DS, 'keep', wire(p))).toMatchObject({
      ok: false,
      message: 'Pick one of the two values first.',
    });
    expect(p.head().head).toBe(p.R0);
  });

  test('"Use this" on the canvas side writes the canvas value into the file and drops the clash', async () => {
    const p = await clash();
    expect(await writePick(DS, '--accent', 'canvas', wire(p))).toEqual({ ok: true });
    expect(p.read(CSS)).toContain('--accent: oklch(0.5 0.19 255);');
    expect(p.meta(`${DS_PATH}/design-system.tsx`).dsPending).toBeUndefined();
    expect(p.head().head).toBe(p.R0);
    const after = await loadTruth(DS, wire(p));
    expect(after?.truth.conflicts ?? []).toEqual([]);
  });

  test('"Use this" on the file side keeps the file and drops the waiting canvas edit', async () => {
    const p = await clash();
    expect(await writePick(DS, '--accent', 'file', wire(p))).toEqual({ ok: true });
    expect(p.read(CSS)).toBe(fileAccent);
    expect(p.meta(`${DS_PATH}/design-system.tsx`).dsPending).toBeUndefined();
    expect(await loadTruth(DS, wire(p))).toBeNull();
  });

  test('the card names the value canvases keep, from the head revision', async () => {
    const p = await clash();
    const got = await loadTruth(DS, wire(p));
    // the scratch system gives its values no names, so the card says what it can: no invented name
    expect(got?.headNames).toEqual({});
    expect(got?.truth.head).toBe(p.R0);
  });
});

describe('"Published in two places", through the routes', () => {
  test('two Macs published from one head; the pick keeps one and loses nothing', async () => {
    const a = await makeProject({ machine: 'm_a' });
    const b = await makeProject({ machine: 'm_b' });
    await a.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
      by: { kind: 'person', name: 'Tereza' },
    });
    const ra = await a.engine.publish(DS, {
      expectHead: a.R0,
      by: { kind: 'person', name: 'Tereza' },
    });
    await b.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.4 0.1 30)', 'oklch(0.7 0.1 30)'),
      by: PERSON,
    });
    const rb = await b.engine.publish(DS, { expectHead: b.R0, by: PERSON });
    for (const n of readdirSync(path.join(a.dsAbs, 'revisions')))
      if (n !== 'head.json' && !existsSync(path.join(b.dsAbs, 'revisions', n)))
        writeFileSync(
          path.join(b.dsAbs, 'revisions', n),
          readFileSync(path.join(a.dsAbs, 'revisions', n))
        );
    for (const rel of ['revisions/head.json', 'colors_and_type.css', 'tokens.json']) {
      renameSync(
        path.join(b.dsAbs, rel),
        path.join(b.dsAbs, conflictCopyName(rel, Date.UTC(2026, 9, 18), 'm_b'))
      );
      writeFileSync(path.join(b.dsAbs, rel), readFileSync(path.join(a.dsAbs, rel)));
    }
    const got = await loadTruth(DS, wire(b));
    expect(got?.truth.twice?.map((x: { head: string }) => x.head)).toEqual([ra.rev, rb.rev]);
    expect(await writePickHead(DS, rb.rev as string, wire(b))).toEqual({ ok: true });
    expect([b.head().head, b.head().base]).toEqual([rb.rev, rb.rev]);
    expect(b.read(CSS)).toContain('oklch(0.4 0.1 30)');
    expect(await loadTruth(DS, wire(b))).toBeNull();
  });
});
