// S10.2 (V2-1.6 §5.10–§5.11 b, §5.7): a pending canvas value and an outside file edit of the same
// token are a conflict and a pick; equal values auto-resolve. Two Macs publishing from one head end
// "Published in two places" — a pick between the two heads, with nothing lost.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DsEngineError } from '../ds/engine.ts';
import { conflictCopyName } from '../sync/decide-file.ts';
import {
  ACCENT,
  cleanup,
  DS,
  DS_PATH,
  makeProject,
  PERSON,
  TOKENS_CSS,
} from './_ds-engine-fixture.ts';

afterAll(cleanup);

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof DsEngineError ? err.code : String(err);
  }
};
const CSS = `${DS_PATH}/colors_and_type.css`;
const fileAccent = TOKENS_CSS.replace('oklch(0.55 0.2 255)', 'oklch(0.45 0.15 180)');

describe('ds conflict pick', () => {
  test('pending ∩ outside with different values → one conflict; "Use this" (canvas)', async () => {
    const p = await makeProject();
    await p.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
      by: PERSON,
    });
    await p.outside(CSS, fileAccent);
    const st = p.engine.state(DS);
    expect(st.conflicts.map((c) => [c.css, c.canvas.light, c.file.light])).toEqual([
      ['--accent', 'oklch(0.5 0.19 255)', 'oklch(0.45 0.15 180)'],
    ]);
    expect(await code(p.engine.keepOutside(DS, { by: PERSON }))).toBe('ds-conflict');
    const r = await p.engine.pick(DS, { css: '--accent', use: 'canvas', by: PERSON });
    expect(r.actionId).toBeTruthy();
    const h = p.head();
    expect(h.head).toBe(p.R0); // canvases keep head throughout
    expect(h.base).toBe(r.rev);
    expect(h.log[0]).toMatchObject({ action: 'pick', parent: p.R0, actionId: r.actionId });
    expect(p.read(CSS)).toContain('--accent: oklch(0.5 0.19 255);');
    expect(p.read(CSS)).toContain('--accent: oklch(0.6 0.175 255);');
    expect(p.meta(`${DS_PATH}/design-system.tsx`).dsPending).toBeUndefined();
    const after = p.engine.state(DS);
    expect([after.outside, after.conflicts]).toEqual([null, []]);
    // the canvas value now waits to be published (head → base)
    expect(after.waiting.map((c) => c.css)).toEqual(['--accent']);
  });

  test('"Use this" (file): base = the working files, the pending entry goes, the file is kept', async () => {
    const p = await makeProject();
    await p.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
      by: PERSON,
    });
    await p.outside(CSS, fileAccent);
    const r = await p.engine.pick(DS, { css: '--accent', use: 'file', by: PERSON });
    expect(p.read(CSS)).toBe(fileAccent);
    expect(p.head().base).toBe(r.rev);
    expect(p.head().head).toBe(p.R0);
    expect(p.meta(`${DS_PATH}/design-system.tsx`).dsPending).toBeUndefined();
    expect(p.engine.state(DS).outside).toBeNull();
    // the canvas value is not lost: it is in Version history (the pick's undo brings it back)
    const u = await p.undo({ actionId: r.actionId });
    expect(u.status).toBe(200);
    expect(
      (p.meta(`${DS_PATH}/design-system.tsx`).dsPending as { tokens: Record<string, unknown> })
        .tokens['--accent']
    ).toBeTruthy();
  });

  test('equal values auto-resolve: no conflict, and Keep drops the entry', async () => {
    const p = await makeProject();
    // the waiting entry names Dark as the file has it: a Light-only entry would move a following Dark (S10.21b)
    await p.engine.mergePending(DS, {
      tokens: { '--accent': { light: 'oklch(0.45 0.15 180)', dark: 'oklch(0.65 0.2 255)' } },
      by: PERSON,
    });
    await p.outside(CSS, fileAccent);
    const st = p.engine.state(DS);
    expect(st.conflicts).toEqual([]);
    expect(st.outside?.changes.map((c) => c.css)).toEqual(['--accent']);
    const k = await p.engine.keepOutside(DS, { by: PERSON });
    expect(p.head().base).toBe(k.rev);
    expect(p.head().head).toBe(p.R0);
    expect(p.meta(`${DS_PATH}/design-system.tsx`).dsPending).toBeUndefined();
    expect(p.engine.state(DS).outside).toBeNull();
  });

  test('Undo (outside) rewrites the working files from base; base does not move', async () => {
    const p = await makeProject();
    await p.outside(CSS, fileAccent);
    const head0 = p.read(`${DS_PATH}/revisions/head.json`);
    await p.engine.undoOutside(DS, { by: PERSON });
    expect(p.read(CSS)).toBe(TOKENS_CSS);
    expect(p.read(`${DS_PATH}/revisions/head.json`)).toBe(head0);
  });

  test('two Macs publishing from one head → "Published in two places" → pick, nothing lost', async () => {
    const a = await makeProject({ machine: 'm_a' });
    const b = await makeProject({ machine: 'm_b' });
    expect(a.R0).toBe(b.R0); // content-addressed: the same R0 on both Macs
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
    expect(ra.rev).not.toBe(rb.rev);
    // Plane B delivers A's files to B: revisions are new files; head.json and the working files
    // collide — B's copies are renamed aside (DDR-226), A's land.
    for (const n of readdirSync(path.join(a.dsAbs, 'revisions')))
      if (n !== 'head.json' && !existsSync(path.join(b.dsAbs, 'revisions', n)))
        writeFileSync(
          path.join(b.dsAbs, 'revisions', n),
          readFileSync(path.join(a.dsAbs, 'revisions', n))
        );
    for (const rel of ['revisions/head.json', 'colors_and_type.css', 'tokens.json']) {
      const aside = conflictCopyName(rel, Date.UTC(2026, 9, 18), 'm_b');
      renameSync(path.join(b.dsAbs, rel), path.join(b.dsAbs, aside));
      writeFileSync(path.join(b.dsAbs, rel), readFileSync(path.join(a.dsAbs, rel)));
    }
    const st = b.engine.state(DS);
    expect(st.publishedInTwoPlaces?.map((x) => [x.file === null, x.head])).toEqual([
      [true, ra.rev],
      [false, rb.rev],
    ]);
    expect(st.outside).toBeNull();
    expect(await code(b.engine.publish(DS, { expectHead: ra.rev, by: PERSON }))).toBe(
      'ds-two-places'
    );
    // "Use this" on B's own publish
    await b.engine.pickPublished(DS, { head: rb.rev as string, by: PERSON });
    const h = b.head();
    expect([h.head, h.base]).toEqual([rb.rev, rb.rev]);
    expect(b.read(`${DS_PATH}/colors_and_type.css`)).toBe(
      b.read(`${DS_PATH}/revisions/${rb.rev}.tokens.css`)
    );
    expect(b.read(`${DS_PATH}/colors_and_type.css`)).toContain('oklch(0.4 0.1 30)');
    // nothing lost: both revisions exist, both publishes are in the log, the aside copy is kept
    expect(b.read(`${DS_PATH}/revisions/${ra.rev}.json`)).not.toBeNull();
    expect(b.read(`${DS_PATH}/revisions/${rb.rev}.json`)).not.toBeNull();
    expect(h.log.filter((e) => e.action === 'publish').map((e) => e.rev)).toEqual(
      expect.arrayContaining([ra.rev, rb.rev])
    );
    expect(readdirSync(path.join(b.designRoot, '_trash', 'ds-revisions', DS)).length).toBe(1);
    const after = b.engine.state(DS);
    expect(after.publishedInTwoPlaces).toBeNull();
    expect(after.outside).toBeNull();
  });
});
