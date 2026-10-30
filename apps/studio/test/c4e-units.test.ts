// gate-b-c4e — the unit halves of the ethical-hacker round 2 on C4 (the booted halves are in
// c4e-frame-leaks.test.ts):
//   1b  the canvas build refuses any import of the design root's runtime state (`_*`), and it
//       reports every file it inlined (`inputs`, held to the frame's closure on serve);
//   1c  `inputsRefusal` refuses a module with any inlined design-root file the session does not see;
//   2   the closure: comments and plain strings are not imports; an imported canvas never counts in a
//       frame (gate-b-c4j: not even for an opener who may read it); a canvas's board is never a module;
//   3   a bridged export's Selection is pinned to the active canvas, `resolveScope` ignores a
//       selection naming another canvas, and the inspector drops a select naming one.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closureFor, importScanText, type ProjectReader } from '../access/closure.ts';
import { inputsRefusal, narrowToFrame } from '../access/frame.ts';
import { resolveAccess } from '../access/scope.ts';
import { buildCanvasModule } from '../canvas-build.ts';
import { bridgedExportPayload } from '../client/export-bridge-scope.js';
import { type Context, createBus } from '../context.ts';
import { resolveScope } from '../exporters/scope.ts';
import { createInspect } from '../inspect.ts';
import { makeSandbox } from './_helpers.ts';

function sandboxWith(files: Record<string, string>) {
  const { root, designRoot } = makeSandbox();
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(designRoot, rel, '..'), { recursive: true });
    writeFileSync(join(designRoot, rel), text);
  }
  return { root, designRoot };
}

describe('1b — the build refuses runtime state and reports its inputs', () => {
  const RUNTIME_IMPORTS = [
    "import k from '../_state/frame-cap.key' with { type: 'text' };",
    "import c from '../_comments/ui-b.json' with { type: 'text' };",
    "import c from '../_chat/log.json';",
    "import a from '../_active.json';",
    "import p from '../_photo/x.bgremove.tsx';",
  ];
  for (const line of RUNTIME_IMPORTS) {
    test(`refused: ${line}`, async () => {
      const { designRoot } = sandboxWith({
        '_state/frame-cap.key': 'SECRET-KEY\n',
        '_comments/ui-b.json': '{"t":"SECRET-COMMENT"}',
        '_chat/log.json': '{"t":"SECRET-CHAT"}',
        '_active.json': '{"t":"SECRET-ACTIVE"}',
        '_photo/x.bgremove.tsx': "export default () => 'SECRET-HARNESS';",
      });
      const abs = join(designRoot, 'ui', 'leak.tsx');
      const src = `${line}\nexport default () => <p>{String(${line.split(' ')[1]})}</p>;\n`;
      writeFileSync(abs, src);
      let err: unknown = null;
      try {
        await buildCanvasModule(abs, src, { designRoot, restrictImportsTo: designRoot });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect(String((err as Error).message)).toContain('runtime state');
      expect(String((err as Error).message)).not.toContain('SECRET-');
    });
  }

  test('a normal canvas builds and lists what it inlined (helper, tokens, JSON)', async () => {
    const { designRoot } = sandboxWith({
      'ui/parts/btn.tsx': 'export default (p: { l: string }) => <b>{p.l}</b>;',
      'ui/data.json': '{"l":"ok"}',
      'system/ds/tokens.css': ':root{--x:1px}',
    });
    const abs = join(designRoot, 'ui', 'c.tsx');
    const src =
      "import B from './parts/btn.tsx';\nimport d from './data.json';\nimport '../system/ds/tokens.css';\nexport default () => <B l={d.l} />;\n";
    writeFileSync(abs, src);
    const r = await buildCanvasModule(abs, src, { designRoot, restrictImportsTo: designRoot });
    const real = realpathSync(designRoot);
    const rels = r.inputs
      .filter((p) => p.startsWith(real))
      .map((p) => p.slice(real.length + 1))
      .sort();
    expect(rels).toEqual(['system/ds/tokens.css', 'ui/c.tsx', 'ui/data.json', 'ui/parts/btn.tsx']);
  });
});

describe('1c — inputsRefusal', () => {
  const roots = ['/p/.design', '/private/p/.design'];
  const sees = (rel: string) => rel === 'ui/a.tsx' || rel === 'ui/parts/btn.tsx';
  test('every inlined design-root file seen → served', () => {
    expect(
      inputsRefusal(
        ['/p/.design/ui/a.tsx', '/private/p/.design/ui/parts/btn.tsx', '/m/lib.tsx'],
        roots,
        sees,
        { ours: ['/m'] } // gate-b-c4g: an out-of-root input must be one of our module roots
      )
    ).toBeNull();
  });
  test('one unseen file (another canvas’s board) → the missing-file answer', async () => {
    const r = inputsRefusal(
      ['/p/.design/ui/a.tsx', '/private/p/.design/ui-b.annotations.json'],
      roots,
      sees
    );
    expect(r?.status).toBe(403);
    expect(await r?.json()).toEqual({ error: 'not-in-scope', reason: 'not-in-scope' });
  });
});

describe('2 — the closure', () => {
  test('importScanText drops comments and plain strings, keeps specifiers', () => {
    const t = importScanText(
      "// import './b.tsx'\n/* from './c.tsx' */\nconst s = \"import './d.tsx'\";\nimport X from './x.tsx';\nexport * from './y';\nconst z = import('./z.tsx');\nconst q = 'don\\'t';\n"
    );
    expect(t).not.toContain('./b.tsx');
    expect(t).not.toContain('./c.tsx');
    expect(t).not.toContain('./d.tsx');
    for (const k of ["'./x.tsx'", "'./y'", "'./z.tsx'"]) expect(t).toContain(k);
    // CSS: `//` is a URL, not a comment
    expect(
      importScanText("@import './t.css'; a { b: url(//x/y) } /* @import './n.css'; */", true)
    ).toContain("'./t.css'");
    expect(importScanText("/* @import './n.css'; */", true)).not.toContain('./n.css');
  });

  function project(files: Record<string, string>): ProjectReader {
    return { list: () => Object.keys(files), text: (r) => files[r] ?? null, head: () => 'h1' };
  }
  const FILES = {
    'ui/a.tsx':
      "import B from './b.tsx';\nimport H from '../components/h.tsx';\n// import C from './c.tsx'\nexport default () => <B />;\n",
    'ui/a.meta.json': '{}',
    'ui/b.tsx': 'export default () => <p>B</p>;',
    'ui/b.meta.json': '{}',
    'ui/c.tsx': 'export default () => <p>C</p>;',
    'ui/c.meta.json': '{}',
    'components/h.tsx': 'export default () => <i />;',
    'ui/board.tsx': "import x from '../ui-b.annotations.json';\nexport default () => x;",
    'ui-b.annotations.json': '{}',
  };
  const grantA = { v: 1 as const, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' as const }] };

  test('a member of A only: imported canvas B no, mentioned canvas C no, helper no (c4l)', () => {
    const c = closureFor(resolveAccess(grantA), project(FILES));
    // gate-b-c4l — A's walk refused B: A reads only what it owns, the helper included
    expect(c.read.has('components/h.tsx')).toBe(false);
    expect(c.read.has('ui/b.tsx')).toBe(false);
    expect(c.read.has('ui/c.tsx')).toBe(false);
  });

  test('the owner’s frame on A (narrowed): B does not count either (gate-b-c4j), nor C', () => {
    const frame = narrowToFrame(resolveAccess({ v: 1, role: 'owner' }), ['ui/a.tsx']);
    expect(frame.canvasOnly).toBe(true);
    const c = closureFor(frame, project(FILES));
    expect(c.read.has('ui/b.tsx')).toBe(false);
    expect(c.read.has('ui/c.tsx')).toBe(false);
  });

  test('a frame of a member of A only on A: B does not count (narrowing never widens)', () => {
    const frame = narrowToFrame(resolveAccess(grantA), ['ui/a.tsx']);
    expect(closureFor(frame, project(FILES)).read.has('ui/b.tsx')).toBe(false);
  });

  test("another canvas's board is never a module, whoever reads", () => {
    const frame = narrowToFrame(resolveAccess({ v: 1, role: 'owner' }), ['ui/board.tsx']);
    expect(closureFor(frame, project(FILES)).read.has('ui-b.annotations.json')).toBe(false);
  });
});

describe('3 — a bridged export renders only its own canvas', () => {
  const A = '.design/ui/a.tsx';
  test('bridgedExportPayload pins options.selection.file to the active canvas', () => {
    const r = bridgedExportPayload(
      { scope: 'selection', options: { selection: { selector: '#x', file: '.design/ui/b.tsx' } } },
      A,
      '.design'
    ) as { ok: true; payload: { options: { selection: { file: string }; canvasFile: string } } };
    expect(r.ok).toBe(true);
    expect(r.payload.options.selection.file).toBe(A);
    expect(r.payload.options.canvasFile).toBe(A);
  });

  test('resolveScope ignores a stored or hinted selection naming another canvas', async () => {
    const designRoot = '/abs/proj/.design';
    for (const [selected, hint] of [
      [{ file: '.design/ui/b.tsx', selector: '#b' }, undefined],
      [null, { file: '.design/ui/b.tsx', selector: '#b' }],
    ] as const) {
      const t = await resolveScope({
        scope: 'selection',
        activeJson: { active: A, selected: selected as never },
        designRoot,
        options: { canvasFile: A, ...(hint ? { selection: hint } : {}) },
      });
      expect(t.length).toBeGreaterThan(0);
      for (const x of t) if (x.kind === 'element') expect(x.file).toBe(A);
    }
    // its own selection still exports
    const own = await resolveScope({
      scope: 'selection',
      activeJson: { active: A, selected: { file: A, selector: '#a' } as never },
      designRoot,
      options: { canvasFile: A },
    });
    expect(own.map((x) => (x.kind === 'element' ? [x.file, x.cssPath] : null))).toEqual([
      [A, '#a'],
    ]);
  });

  test('the inspector drops a select naming another canvas than the active one', () => {
    const { root, designRoot } = makeSandbox();
    const ctx = {
      cfg: {} as Context['cfg'],
      projectLabel: 'test',
      bus: createBus(),
      paths: {
        repoRoot: root,
        designRel: '.design',
        designRoot,
        serverInfoFile: join(designRoot, '_server.json'),
        activeFile: join(designRoot, '_active.json'),
        commentsDir: join(designRoot, '_comments'),
        canvasStateDir: join(designRoot, '_canvas-state'),
        historyDir: join(designRoot, '_history'),
        tokensUrlRel: '',
        systemDirRel: 'system',
      },
    } as Context;
    const inspect = createInspect(ctx, async () => []);
    inspect.setActive('.design/ui/fixture.html');
    const sel = (file: string) => ({
      file,
      selector: 'h1',
      tag: 'h1',
      classes: '',
      text: '',
      dom_path: [],
    });
    inspect.setSelected(sel('.design/ui/fixture.html'));
    expect((inspect.state.selected as { selector: string }).selector).toBe('h1');
    inspect.setSelected({ ...sel('.design/ui/other.tsx'), selector: '#planted' });
    expect((inspect.state.selected as { selector: string }).selector).toBe('h1');
    inspect.setSelected([{ ...sel('.design/ui/other.tsx'), selector: '#planted' }]);
    expect(JSON.stringify(inspect.state.selected)).not.toContain('#planted');
  });
});
