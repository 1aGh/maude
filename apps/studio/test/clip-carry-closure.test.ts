// #122 (122-A) — C4: a paste must never make a canvas inline something its frame would refuse. Every import a
// cross-canvas paste ADDS passes the same rule the closure's import walk applies (`importAllowed`, access/closure.ts):
// an importable extension, not a canvas, nothing under a `_` runtime folder, and it resolves — transitively.
// Refused → nothing written, the words tell the person what to do.

import { beforeEach, describe, expect, test } from 'bun:test';

import { importAllowed } from '../access/closure.ts';
import { _resetClips } from '../edit-ops/clipboard.ts';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { ClipScope } from '../edit-ops/types.ts';

const A = 'ui/a/Home.tsx';
const B = 'ui/b/Other.tsx';

const canvasOf = (
  name: string,
  body: string
) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function ${name}() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={600}>
        <div data-cd-id="page">
${body}
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

const A_SRC = `import { Teaser } from './Teaser';
import { Fancy } from '../../components/Fancy';
import { Note } from '../../_state/note';
import notes from './notes.md';
import { Plain } from '../../components/Plain';
${canvasOf(
  'Home',
  `          <Teaser data-cd-id="teaser" />
          <Fancy data-cd-id="fancy" />
          <Note data-cd-id="note" />
          <p data-cd-id="md">{notes}</p>
          <Plain data-cd-id="plain" />`
)}`;

const FILES: Record<string, string> = {
  [A]: A_SRC,
  [B]: canvasOf('Other', '          <h1 data-cd-id="head">Hi</h1>'),
  // a canvas (renders DesignCanvas) next to A
  'ui/a/Teaser.tsx': canvasOf('Teaser', '          <b>t</b>'),
  // a component that itself imports a canvas (the walk is transitive)
  'components/Fancy.tsx': `import { Teaser } from '../ui/a/Teaser';\nexport const Fancy = () => <Teaser />;\n`,
  '_state/note.ts': 'export const Note = () => null;\n',
  'ui/a/notes.md': '# notes\n',
  'components/Plain.tsx': 'export const Plain = () => <i>plain</i>;\n',
};

function harness(clipScope?: ClipScope) {
  const files = new Map(Object.entries(FILES));
  const writes: string[] = [];
  const deps: DispatchDeps = {
    resolve: (f) => (f === A || f === B ? f : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      writes.push(rel);
      files.set(rel, after);
    },
    writeLayout: async () => {},
    heldByAi: () => null,
    log: createWriteLog(),
    ...(clipScope ? { clipScope } : {}),
  };
  const run = (op: string, file: string, targets: string[], params?: Record<string, unknown>) =>
    dispatchEditOp(
      {
        file,
        op,
        targets: targets.map((element) => ({ artboard: 'desktop', element })),
        ...(params ? { params } : {}),
      },
      deps
    );
  const copyPaste = async (id: string) => {
    const c = await run('object.copy', A, [id]);
    if (!c.ok) throw new Error(c.message);
    const clip = (c.detail as { clip: { id: string } }).clip.id;
    return run('canvas.paste', B, ['head'], { clip });
  };
  return { files, writes, copyPaste };
}

beforeEach(() => _resetClips());

describe('importAllowed — the C4 import rule for one import a paste would add', () => {
  const project = { text: (rel: string) => FILES[rel] ?? null };
  test('a component module: allowed', () => {
    expect(importAllowed('../../components/Plain', B, project).ok).toBe(true);
  });
  test('a bare or virtual specifier is not walked: allowed', () => {
    expect(importAllowed('@maude/canvas-lib', B, project).ok).toBe(true);
  });
  test('a canvas, directly or through a component: refused as a canvas', () => {
    const direct = importAllowed('../a/Teaser', B, project);
    const through = importAllowed('../../components/Fancy', B, project);
    expect(direct).toEqual({ ok: false, why: 'canvas', canvases: ['ui/a/Teaser.tsx'] });
    // C4 errs to "canvas": a module importing a name that carries DesignCanvas is one itself (lib-proxy rule)
    expect(through).toEqual({ ok: false, why: 'canvas', canvases: ['components/Fancy.tsx'] });
  });
  test('under a `_` runtime folder, a non-importable extension, outside the design root, missing', () => {
    expect(importAllowed('../../_state/note', B, project).ok).toBe(false);
    expect(importAllowed('../a/notes.md', B, project).ok).toBe(false);
    expect(importAllowed('../../../outside/x', B, project).ok).toBe(false);
    expect(importAllowed('../../components/Gone', B, project)).toMatchObject({
      ok: false,
      why: 'missing',
    });
  });
});

describe('a paste that would add a refused import writes nothing', () => {
  for (const [id, words] of [
    ['teaser', /canvas.*component/i],
    ['fancy', /canvas.*component/i],
    ['note', /can’t be pasted/],
    ['md', /can’t be pasted/],
  ] as const) {
    test(`${id}: refused in words`, async () => {
      const h = harness();
      const r = await h.copyPaste(id);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(words);
      expect(h.writes).toEqual([]);
      expect(h.files.get(B)).toBe(FILES[B]);
    });
  }

  test('an allowed component import pastes', async () => {
    const h = harness();
    const r = await h.copyPaste('plain');
    expect(r.ok).toBe(true);
    expect(h.files.get(B)).toContain("import { Plain } from '../../components/Plain';");
  });

  test('a canvas-only member: the same refusal, nothing written', async () => {
    const scope: ClipScope = { subject: 'm_1', sees: (c) => c === A || c === B };
    const h = harness(scope);
    const r = await h.copyPaste('teaser');
    expect(r.ok).toBe(false);
    expect(h.writes).toEqual([]);
  });
});
