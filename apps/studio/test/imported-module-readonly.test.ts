// #151 T2.3b — an element of an imported local module (a shared hi-fi file) is selectable and
// commentable (T2.3 stamps it with a data-cd-id), but the edit engine reads only the canvas file, so
// an edit aimed at it used to fail with "not on this canvas" / "data-cd-id … not found in <abs path>".
// It is now edit-READ-ONLY and says why: the build stamps `data-cd-module="<design-root-relative
// path>"` on every element of the module (the marker the inspector and the canvas read), and the server
// recognises such an id by walking the canvas's own imports (ids stay 8 hex, so the id alone cannot
// carry the file). Every edit route answers a refusal that NAMES the file; nothing is written.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { buildCanvasModule } from '../canvas-build.ts';
import { type Context, createBus } from '../context.ts';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOp } from '../edit-ops/types.ts';
import { moduleOwningId } from '../imported-module-ids.ts';
import { makeSandbox } from './_helpers.ts';

const HIFI = `import { Chip } from './atoms';
export function Phone({ title }: { title: string }) {
  return (
    <div className="ldm-hifi">
      <span>{title}</span>
      <Chip label="x" />
    </div>
  );
}
export function Fixed() {
  return <b data-cd-id="authored-bold">kept</b>;
}
`;
const ATOMS = `export function Chip({ label }: { label: string }) {
  return <i>{label}</i>;
}
`;
const CANVAS = `import { DesignCanvas, DCSection, DCArtboard } from '@maude/canvas-lib';
import { Phone, Fixed } from './hifi';
export default function C() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="s">
        <DCArtboard id="a" label="a" width={300} height={300}>
          <Phone title="hi" />
          <Fixed />
          <p data-cd-id="own">own</p>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

async function rig() {
  const { root, designRoot } = makeSandbox();
  roots.push(root);
  writeFileSync(join(designRoot, 'ui', 'hifi.tsx'), HIFI);
  writeFileSync(join(designRoot, 'ui', 'atoms.tsx'), ATOMS);
  mkdirSync(join(designRoot, 'system', 'ds'), { recursive: true });
  const abs = join(designRoot, 'ui', 'C.tsx');
  writeFileSync(abs, CANVAS);
  const built = await buildCanvasModule(abs, CANVAS, { designRoot });
  return { root, designRoot, abs, js: built.js };
}

/** The bundled text of one local module, from its `// <path>` banner to the next banner. */
function moduleText(js: string, file: string): string {
  const at = js.indexOf(`/${file}\n`);
  expect(at).toBeGreaterThan(-1);
  const next = js.indexOf('\n// ', at + 1);
  return js.slice(at, next === -1 ? undefined : next);
}
const idOf = (text: string, tag: string) =>
  new RegExp(`jsxs?\\d*\\("${tag}", \\{[^}]*"data-cd-id": "([0-9a-f]{8})"`).exec(
    text
  )?.[1] as string;

describe('the build marks every element of an imported module', () => {
  test('each carries data-cd-module = its design-root-relative path (authored ids too)', async () => {
    const { js } = await rig();
    const hifi = moduleText(js, 'ui/hifi.tsx');
    for (const tag of ['div', 'span', 'b'])
      expect(
        new RegExp(`jsxs?\\d*\\("${tag}", \\{[^}]*"data-cd-module": "ui/hifi.tsx"`).test(hifi)
      ).toBe(true);
    expect(moduleText(js, 'ui/atoms.tsx')).toContain('"data-cd-module": "ui/atoms.tsx"');
  });

  test('the canvas’s own elements carry no module marker', async () => {
    const { js } = await rig();
    expect(moduleText(js, 'ui/C.tsx')).not.toContain('data-cd-module');
  });
});

describe('moduleOwningId — which imported file an id lives in', () => {
  test('a computed id, an authored id and a transitive import resolve to their own file', async () => {
    const { abs, designRoot, js } = await rig();
    const phoneDiv = idOf(moduleText(js, 'ui/hifi.tsx'), 'div');
    const chipI = idOf(moduleText(js, 'ui/atoms.tsx'), 'i');
    expect(moduleOwningId(abs, designRoot, phoneDiv)).toBe('ui/hifi.tsx');
    expect(moduleOwningId(abs, designRoot, 'authored-bold')).toBe('ui/hifi.tsx');
    expect(moduleOwningId(abs, designRoot, chipI)).toBe('ui/atoms.tsx');
  });

  test('the canvas’s own id and an unknown id are not a module’s', async () => {
    const { abs, designRoot } = await rig();
    expect(moduleOwningId(abs, designRoot, 'own')).toBeNull();
    expect(moduleOwningId(abs, designRoot, 'deadbeef')).toBeNull();
  });
});

describe('the edit-op dispatcher refuses an element of an imported module', () => {
  const OPS: EditOp[] = [
    {
      id: 'test.paint',
      apply: (src) => ({ source: `${src}// painted\n` }),
    },
  ];

  test('400 invalid with the file named; nothing is written', async () => {
    const { abs, designRoot, js } = await rig();
    const id = idOf(moduleText(js, 'ui/hifi.tsx'), 'div');
    const files = new Map<string, string>([['ui/C.tsx', CANVAS]]);
    const writes: string[] = [];
    const deps: DispatchDeps = {
      ops: OPS,
      resolve: (f) =>
        files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null,
      read: (rel) => files.get(rel) ?? null,
      write: async (rel) => {
        writes.push(rel);
      },
      heldByAi: () => null,
      log: createWriteLog(),
      moduleOf: (rel, elId) => moduleOwningId(join(designRoot, rel), designRoot, elId),
    } as DispatchDeps;
    const res = await dispatchEditOp(
      {
        file: '.design/ui/C.tsx',
        op: 'test.paint',
        targets: [{ artboard: 'a', element: id }],
      },
      deps
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('invalid');
    expect(res.message).toContain('ui/hifi.tsx');
    expect(res.message).not.toContain('not on this canvas');
    expect(res.message).not.toContain(abs);
    expect(writes).toEqual([]);
  });

  test('an element of the canvas itself still edits', async () => {
    const { designRoot } = await rig();
    const files = new Map<string, string>([['ui/C.tsx', CANVAS]]);
    const writes: string[] = [];
    const deps = {
      ops: OPS,
      resolve: (f: string) =>
        files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null,
      read: (rel: string) => files.get(rel) ?? null,
      write: async (rel: string) => {
        writes.push(rel);
      },
      heldByAi: () => null,
      log: createWriteLog(),
      moduleOf: (rel: string, elId: string) =>
        moduleOwningId(join(designRoot, rel), designRoot, elId),
    } as unknown as DispatchDeps;
    const res = await dispatchEditOp(
      { file: '.design/ui/C.tsx', op: 'test.paint', targets: [{ artboard: 'a', element: 'own' }] },
      deps
    );
    expect(res.ok).toBe(true);
    expect(writes).toEqual(['ui/C.tsx']);
  });
});

describe('the direct edit routes refuse it too (422, file named, nothing written)', () => {
  async function apiRig() {
    const r = await rig();
    const ctx: Context = {
      cfg: {} as Context['cfg'],
      projectLabel: 'test',
      bus: createBus(),
      paths: {
        repoRoot: r.root,
        designRel: '.design',
        designRoot: r.designRoot,
        serverInfoFile: join(r.designRoot, '_server.json'),
        activeFile: join(r.designRoot, '_active.json'),
        commentsDir: join(r.designRoot, '_comments'),
        canvasStateDir: join(r.designRoot, '_canvas-state'),
        historyDir: join(r.designRoot, '_history'),
        tokensUrlRel: '',
        systemDirRel: 'system',
      },
    };
    const api = createApi(ctx, { onCommentsChanged: () => {} });
    return { ...r, api };
  }

  test('edit-css, edit-text and edit-attr on a module element', async () => {
    const { api, abs, js } = await apiRig();
    const id = idOf(moduleText(js, 'ui/hifi.tsx'), 'span');
    const results = [
      await api.editCss({ canvas: 'ui/C', id, property: 'color', value: 'red' }),
      await api.editText({ canvas: 'ui/C', id, text: 'x' }),
      await api.editAttr({ canvas: 'ui/C', id, attr: 'aria-label', value: 'x' }),
    ];
    for (const res of results) {
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.status).toBe(422);
      expect(res.error).toContain('ui/hifi.tsx');
      expect(res.error).not.toContain(abs);
    }
    expect(await Bun.file(abs).text()).toBe(CANVAS);
  });

  test('the canvas’s own element still takes an edit', async () => {
    const { api, abs } = await apiRig();
    const res = await api.editCss({ canvas: 'ui/C', id: 'own', property: 'color', value: 'red' });
    expect(res.ok).toBe(true);
    expect(await Bun.file(abs).text()).toContain('color');
  });
});

describe('maude design canvas-edit refuses it', () => {
  test('exit 1, the file named, the canvas untouched', async () => {
    const { root, abs, js } = await rig();
    const id = idOf(moduleText(js, 'ui/hifi.tsx'), 'div');
    const bin = join(import.meta.dir, '..', 'bin', 'canvas-edit.sh');
    const r = spawnSync('bash', [bin, abs, id, 'className', 'x'], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain('ui/hifi.tsx');
    expect(readFileSync(abs, 'utf8')).toBe(CANVAS);
  });
});
