// V2-8.9 defender L1 + attacker L3 — the object clipboard is keyed by SUBJECT (the cell member a
// request is vouched for, '' on a desktop), a paste re-checks that the paster still sees the canvas
// the clip was read from, and each subject has its own cap (one member never evicts another's).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveAccess } from '../access/scope.ts';
import { _resetClips } from '../edit-ops/clipboard.ts';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { ClipScope, EditOpResult } from '../edit-ops/types.ts';
import { createEditRoutes } from '../routes/edit.ts';

const FILE = 'ui/Home.tsx';
const SECRET = 'ui/Secret.tsx';
const src = (
  name: string,
  text: string
) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function ${name}() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <strong data-cd-id="title">${text}</strong>
        <footer data-cd-id="footer">Footer</footer>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness() {
  const files = new Map<string, string>([
    [FILE, src('Home', 'Brand systems')],
    [SECRET, src('Secret', 'Launch plan')],
  ]);
  const writes: string[] = [];
  const base: DispatchDeps = {
    resolve: (f) => (files.has(f) ? f : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      writes.push(rel);
      files.set(rel, after);
    },
    heldByAi: () => null,
    log: createWriteLog(),
  };
  const run = (
    scope: ClipScope,
    op: string,
    targets: string[],
    params?: Record<string, unknown>,
    file = FILE
  ) =>
    dispatchEditOp(
      {
        file,
        op,
        targets: targets.map((element) => ({ artboard: 'desktop', element })),
        ...(params ? { params } : {}),
      },
      { ...base, clipScope: scope }
    );
  return { files, writes, run };
}

const all = () => true;
const handleOf = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return (r.detail as { clip: { id: string } }).clip.id;
};

beforeEach(() => _resetClips());

describe('clips belong to the subject that copied them', () => {
  test('another subject holding the handle cannot paste it; the copier can', async () => {
    const h = harness();
    const id = handleOf(
      await h.run({ subject: 'alice', sees: all }, 'object.copy', ['title'], undefined, SECRET)
    );
    const bob = await h.run({ subject: 'bob', sees: all }, 'canvas.paste', ['footer'], {
      clip: id,
    });
    expect(bob.ok).toBe(false);
    expect(h.writes).toEqual([]);
    const alice = await h.run({ subject: 'alice', sees: all }, 'canvas.paste', ['footer'], {
      clip: id,
    });
    expect(alice.ok).toBe(true);
  });

  test('a paste is refused once the paster no longer sees the canvas the clip came from', async () => {
    const h = harness();
    const id = handleOf(
      await h.run({ subject: 'm', sees: all }, 'object.copy', ['title'], undefined, SECRET)
    );
    const revoked = { subject: 'm', sees: (c: string) => c !== SECRET };
    const r = await h.run(revoked, 'canvas.paste', ['footer'], { clip: id });
    expect(r.ok).toBe(false);
    expect(h.writes).toEqual([]);
    expect(h.files.get(FILE)).not.toContain('Launch plan');
  });

  test('each subject has its own cap: one member copying a lot evicts none of another’s clips', async () => {
    const h = harness();
    const id = handleOf(await h.run({ subject: 'alice', sees: all }, 'object.copy', ['title']));
    for (let i = 0; i < 40; i++)
      handleOf(await h.run({ subject: 'bob', sees: all }, 'object.copy', ['footer']));
    const r = await h.run({ subject: 'alice', sees: all }, 'canvas.paste', ['footer'], {
      clip: id,
    });
    expect(r.ok).toBe(true);
  });
});

describe('/_api/edit-op names the subject from the request, never the body', () => {
  const dirs: string[] = [];
  const saved = process.env.MAUDE_WORKSPACE_MODE;
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    if (saved === undefined) delete process.env.MAUDE_WORKSPACE_MODE;
    else process.env.MAUDE_WORKSPACE_MODE = saved;
  });

  test('in a cell a member’s handle is not another member’s; a canvas-only grant pastes no unseen clip', async () => {
    process.env.MAUDE_WORKSPACE_MODE = '1';
    const root = mkdtempSync(join(tmpdir(), 'maude-clip-subject-'));
    dirs.push(root);
    const designRoot = join(root, '.design');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    writeFileSync(join(designRoot, FILE), src('Home', 'Brand systems'));
    writeFileSync(join(designRoot, SECRET), src('Secret', 'Launch plan'));
    const owner = resolveAccess({ v: 1, role: 'owner' });
    const homeOnly = resolveAccess({ v: 1, role: null, grants: [{ c: FILE, r: 'member' }] });
    const specs = createEditRoutes({
      designRoot,
      designRel: '.design',
      repoRoot: root,
      emit: () => {},
      access: (req) => (req.headers.get('x-maude-user') === 'carol' ? homeOnly : owner),
    });
    const editOp = specs.find((s) => s.path === '/_api/edit-op') as (typeof specs)[number];
    const call = async (user: string, body: Record<string, unknown>) => {
      const res = await editOp.handle(
        new Request('http://localhost/_api/edit-op', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-maude-user': user },
          body: JSON.stringify(body),
        }),
        {} as never
      );
      return (await res.json()) as EditOpResult;
    };
    const copied = await call('alice', {
      file: SECRET,
      op: 'object.copy',
      targets: [{ artboard: 'desktop', element: 'title' }],
    });
    const id = handleOf(copied);
    const paste = { file: FILE, op: 'canvas.paste', targets: [], params: { clip: id } };
    expect((await call('bob', paste)).ok).toBe(false);
    expect((await call('carol', paste)).ok).toBe(false);
    expect(readFileSync(join(designRoot, FILE), 'utf8')).not.toContain('Launch plan');
    expect((await call('alice', paste)).ok).toBe(true);
    expect(readFileSync(join(designRoot, FILE), 'utf8')).toContain('Launch plan');
  });
});
