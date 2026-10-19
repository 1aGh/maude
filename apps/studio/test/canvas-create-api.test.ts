// /_api/canvas — Phase 22 UI add-on. Create a blank brief board from the browser.
//
// Two layers:
//   (1) the pure name-validation boundary (the ONE security gate — path +
//       JSX + JSON injection), tested directly;
//   (2) the POST endpoint round-trip (boots a real server against a sandbox),
//       covering happy path, the rejection matrix, group allowlist, duplicate.

import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { componentNameFrom, renderBriefBoard, validateCanvasName } from '../canvas-create.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

describe('canvas-create / validateCanvasName (the security boundary)', () => {
  test('accepts ordinary names (incl. spaces + accents)', () => {
    for (const n of ['Onboarding Brief', 'checkout-flow', 'Krok_1', 'Přihlášení', 'A1']) {
      const v = validateCanvasName(n);
      expect(v.ok).toBe(true);
      expect(v.name).toBe(n);
    }
  });

  test('trims surrounding whitespace', () => {
    const v = validateCanvasName('  Onboarding  ');
    expect(v.ok).toBe(true);
    expect(v.name).toBe('Onboarding');
  });

  // The rejection matrix — path traversal, separators, and template/JSON
  // injection vectors must ALL be refused by the one allowlist regex.
  const REJECT: Array<[string, unknown]> = [
    ['empty', ''],
    ['whitespace only', '   '],
    ['non-string', 123],
    ['null', null],
    ['parent traversal', '../evil'],
    ['nested traversal', 'a/../../etc/passwd'],
    ['forward slash', 'ui/Sneaky'],
    ['back slash', 'ui\\Sneaky'],
    ['leading dot', '.hidden'],
    ['dot-dot', '..'],
    ['JSX break-out', 'X</div><script>alert(1)</script>'],
    ['angle bracket', 'a<b'],
    ['double quote (JSON break-out)', 'a"b'],
    ['backslash (JSON break-out)', 'a\\b'],
    ['too long (61)', 'x'.repeat(61)],
    ['tab', 'a\tb'],
    ['newline', 'a\nb'],
    ['null byte', 'a\u0000b'],
  ];
  for (const [label, value] of REJECT) {
    test(`rejects ${label}`, () => {
      expect(validateCanvasName(value).ok).toBe(false);
    });
  }

  // S1.23 G2 (`v2-lead-canvas-names-any-filename-safe`): braces and a leading hyphen are filename-safe, so
  // they are accepted — the braces are ESCAPED where they reach the JSX text of a template.
  test('braces and a leading hyphen are accepted; the braces cannot become a JSX expression', () => {
    expect(validateCanvasName('A{2+2}B').ok).toBe(true);
    expect(validateCanvasName('-dash').ok).toBe(true);
    const out = renderBriefBoard({
      name: 'A{2+2}B',
      componentName: 'AB',
      dsName: 'project',
      platform: 'desktop',
      seedHint: 'seed',
      historyDir: '.design/_history/ui-ab',
    });
    expect(out).toContain('A&#123;2+2&#125;B\n');
  });

  test('componentNameFrom yields a valid identifier', () => {
    expect(componentNameFrom('Onboarding Brief')).toBe('OnboardingBrief');
    expect(componentNameFrom('checkout-flow v2')).toBe('CheckoutFlowV2');
    expect(componentNameFrom('123')).toMatch(/^Board/); // digit-leading → prefixed
    // Unicode letters survive (review #1) — not ASCII-mangled to "PIhlEn".
    expect(componentNameFrom('Přihlášení')).toBe('Přihlášení');
    expect(componentNameFrom('123abc')).toBe('Board123abc'); // digit-leading → prefixed, body kept
  });

  test('collapses internal double-spaces so the slug methods agree (review #4)', () => {
    const v = validateCanvasName('Two  Spaces');
    expect(v.ok).toBe(true);
    expect(v.name).toBe('Two Spaces'); // " +" → " " ; a tab would still be rejected
  });

  test('renderBriefBoard substitutes every placeholder (no {{…}} left)', () => {
    const out = renderBriefBoard({
      name: 'Onboarding Brief',
      componentName: 'OnboardingBrief',
      dsName: 'project',
      platform: 'desktop',
      seedHint: 'seed',
      historyDir: '.design/_history/ui-onboarding_brief',
    });
    expect(out).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(out).toContain('export default function OnboardingBrief()');
    expect(out).toContain('@kind        brief-board');
    expect(out).toContain('Onboarding Brief');
  });
});

describe('/_api/canvas — POST round-trip', () => {
  test('creates a brief board (.tsx + .meta.json), returns 201 + the tree path', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Onboarding Brief', kind: 'brief-board' }),
      });
      expect(r.status).toBe(201);
      const j = (await r.json()) as { ok: boolean; file: string; rel: string; slug: string };
      expect(j.ok).toBe(true);
      expect(j.file).toBe('.design/ui/Onboarding Brief.tsx');
      expect(j.rel).toBe('ui/Onboarding Brief.tsx');
      expect(j.slug).toBe('ui-onboarding_brief');

      const tsx = join(designRoot, 'ui', 'Onboarding Brief.tsx');
      const meta = join(designRoot, 'ui', 'Onboarding Brief.meta.json');
      expect(existsSync(tsx)).toBe(true);
      expect(existsSync(meta)).toBe(true);
      expect(readFileSync(tsx, 'utf8')).toContain('export default function OnboardingBrief()');
      expect(readFileSync(tsx, 'utf8')).toContain('Drop sticky notes');
      const m = JSON.parse(readFileSync(meta, 'utf8'));
      expect(m.kind).toBe('brief-board');
      expect(m.title).toBe('Onboarding Brief');
      expect(m.brief_sha).toBeUndefined(); // a board has no generation brief
    } finally {
      await killProc(proc);
    }
  });

  test('assembles a video-comp (kind: video-comp) from dropped clips (DDR-150 P4 Task 12)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Reel',
          kind: 'video-comp',
          fps: 30,
          clips: [
            { src: 'assets/a.mp4', mediaKind: 'video', durationInFrames: 60 },
            { src: 'assets/b.mp4', mediaKind: 'video' },
            { src: 'assets/music.mp3', mediaKind: 'audio' },
          ],
        }),
      });
      expect(r.status).toBe(201);
      const j = (await r.json()) as { ok: boolean; rel: string };
      expect(j.ok).toBe(true);
      const tsx = readFileSync(join(designRoot, 'ui', 'My Reel.tsx'), 'utf8');
      expect(tsx).toContain('<VideoComp component={Comp}');
      // <Video> from @remotion/media, not <OffthreadVideo> — the renderer
      // rejects the latter and the export loses its audio (RCA
      // issue-mp4-audio-export-html5audio-silent-degrade).
      expect(tsx).toContain('<Video src="assets/a.mp4" />');
      expect(tsx).toContain('<Audio src="assets/music.mp3" />');
      expect(tsx).toContain('name="clip-1"');
      const m = JSON.parse(readFileSync(join(designRoot, 'ui', 'My Reel.meta.json'), 'utf8'));
      expect(m.kind).toBe('video-comp');
    } finally {
      await killProc(proc);
    }
  });

  test('accepts an empty clips[] as the greenfield "New video" (201) and rejects a traversal src (400)', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      // enhanced-video-editing Task 20 — empty clips[] scaffolds an editable
      // empty comp (drop-first cut building), no longer a 400.
      const empty = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Empty', kind: 'video-comp', clips: [] }),
      });
      expect(empty.status).toBe(201);
      const created = (await empty.json()) as { file?: string };
      const tsx = await Bun.file(`${root}/${created.file}`).text();
      expect(tsx).toContain('Drop clips on the timeline');
      expect(tsx).toContain('<VideoComp');
      const bad = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bad',
          kind: 'video-comp',
          clips: [{ src: '../../etc/passwd', mediaKind: 'video' }],
        }),
      });
      expect(bad.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('rejects a cross-origin create (CSRF guard on /_api/canvas — DDR-150 P4)', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
        body: JSON.stringify({ name: 'Forged', kind: 'brief-board' }),
      });
      expect(r.status).toBe(403);
    } finally {
      await killProc(proc);
    }
  });

  test('create + delete emit canvas-list-update over the inspector WS (Phase 30)', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    let socket: WebSocket | null = null;
    try {
      const messages: Array<{ type: string; payload?: { action?: string; slug?: string } }> = [];
      const sock = new WebSocket(`ws://localhost:${port}/_ws`);
      socket = sock;
      await new Promise<void>((res, rej) => {
        sock.addEventListener('open', () => res());
        sock.addEventListener('error', () => rej(new Error('ws error')));
        setTimeout(() => rej(new Error('ws open timeout')), 2000);
      });
      sock.addEventListener('message', (ev) => {
        try {
          messages.push(JSON.parse(String(ev.data)));
        } catch {
          /* ignore non-JSON */
        }
      });

      const waitFor = async (pred: (m: (typeof messages)[number]) => boolean) => {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          const hit = messages.find(pred);
          if (hit) return hit;
          await Bun.sleep(25);
        }
        return undefined;
      };

      const created = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Live Add', kind: 'brief-board' }),
      });
      expect(created.status).toBe(201);
      const cj = (await created.json()) as { rel: string };

      const added = await waitFor(
        (m) => m.type === 'canvas-list-update' && m.payload?.action === 'added'
      );
      expect(added?.payload?.slug).toBe('ui-live_add');

      const del = await fetch(
        `http://localhost:${port}/_api/canvas?file=${encodeURIComponent(cj.rel)}`,
        { method: 'DELETE' }
      );
      expect(del.status).toBe(200);

      const removed = await waitFor(
        (m) => m.type === 'canvas-list-update' && m.payload?.action === 'removed'
      );
      expect(removed?.payload?.slug).toBe('ui-live_add');
    } finally {
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      await killProc(proc);
    }
  }, 10_000);

  test('defaults kind to brief-board when omitted', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Kind' }),
      });
      expect(r.status).toBe(201);
    } finally {
      await killProc(proc);
    }
  });

  test('rejects a traversal name with 400 and writes nothing', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '../../escape' }),
      });
      expect(r.status).toBe(400);
      // No file landed anywhere near the design root's parent.
      expect(existsSync(join(designRoot, '..', 'escape.tsx'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });

  test('rejects an unknown group with 400', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Valid', group: 'etc' }),
      });
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  // Phase 22 security review F2 — a config whose newCanvasDir TRAVERSES out of
  // the design root must NOT let the write escape, even though the traversing
  // group is technically "allowlisted" (it came from config). The designRoot
  // containment assert is the backstop.
  test('a config with a traversing newCanvasDir cannot escape the design root', async () => {
    const { root, designRoot } = makeSandbox();
    // Poison the config: newCanvasDir points outside the design root.
    writeFileSync(
      join(designRoot, 'config.json'),
      JSON.stringify({
        name: 'test',
        designRoot: '.design',
        newCanvasDir: '../../../../tmp',
        canvasGroups: [
          { label: 'System', path: 'system' },
          { label: 'UI', path: 'ui' },
        ],
      })
    );
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Escape' }),
      });
      expect(r.status).toBe(400);
      // Nothing was written up at the traversal target.
      expect(existsSync(join(root, '..', '..', 'tmp', 'Escape.tsx'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });

  test('rejects a non-brief-board kind with 400', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Valid', kind: 'canvas' }),
      });
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('a duplicate name returns 409', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const body = JSON.stringify({ name: 'Dup Board' });
      const first = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(first.status).toBe(201);
      const second = await fetch(`http://localhost:${port}/_api/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(second.status).toBe(409);
    } finally {
      await killProc(proc);
    }
  });

  test('unknown method (GET) returns 405', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/canvas`, { method: 'GET' });
      expect(r.status).toBe(405);
    } finally {
      await killProc(proc);
    }
  });
});

describe('/_api/canvas — DELETE (soft-delete)', () => {
  async function createBoard(port: number, name: string) {
    const r = await fetch(`http://localhost:${port}/_api/canvas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return (await r.json()) as { file: string; slug: string };
  }
  const del = (port: number, file: string) =>
    fetch(`http://localhost:${port}/_api/canvas?file=${encodeURIComponent(file)}`, {
      method: 'DELETE',
    });

  test('soft-deletes a canvas: moves .tsx + sidecars to _trash, gone from ui/', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Trash Me');
      // Seed an annotation sidecar to prove the whole set travels.
      writeFileSync(
        join(designRoot, `${created.slug}.annotations.svg`),
        '<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1"></svg>'
      );
      // Seed the per-machine camera view file (DDR-115) to prove it's swept too.
      mkdirSync(join(designRoot, '_canvas-state'), { recursive: true });
      const viewAbs = join(designRoot, '_canvas-state', `${created.slug}.view.json`);
      writeFileSync(viewAbs, JSON.stringify({ viewport: { x: 1, y: 2, zoom: 1 } }));
      const tsx = join(designRoot, 'ui', 'Trash Me.tsx');
      expect(existsSync(tsx)).toBe(true);

      const r = await del(port, created.file);
      expect(r.status).toBe(200);
      const j = (await r.json()) as { ok: boolean; trashed: string[] };
      expect(j.ok).toBe(true);
      expect(j.trashed.some((t) => t.endsWith('Trash Me.tsx'))).toBe(true);
      expect(j.trashed.some((t) => t.endsWith('.annotations.svg'))).toBe(true);
      expect(j.trashed.some((t) => t.endsWith('.view.json'))).toBe(true);

      // Gone from the group; present (recoverable) under _trash/ with a manifest.
      expect(existsSync(tsx)).toBe(false);
      expect(existsSync(join(designRoot, `${created.slug}.annotations.svg`))).toBe(false);
      expect(existsSync(viewAbs)).toBe(false);
      const trashDirs = readdirSync(join(designRoot, '_trash'));
      expect(trashDirs.length).toBe(1);
      const td = join(designRoot, '_trash', trashDirs[0] as string);
      expect(existsSync(join(td, 'Trash Me.tsx'))).toBe(true);
      expect(existsSync(join(td, `_canvas-state__${created.slug}.view.json`))).toBe(true);
      expect(existsSync(join(td, '_trash-manifest.json'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  // Task 2 bug fix: deleteCanvas now consumes canvas-artifacts.ts's inventory,
  // which closes two gaps the old hand-rolled sidecar list missed.
  test('also trashes the .ydoc.bin cache and the footage EDL (bug fix — canvas-artifacts.ts inventory)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Full Sweep');
      mkdirSync(join(designRoot, '_state'), { recursive: true });
      const ydocAbs = join(designRoot, '_state', `${created.slug}.ydoc.bin`);
      writeFileSync(ydocAbs, Buffer.from([1, 2, 3]));
      const edlAbs = join(designRoot, `${created.slug}.edl.json`);
      writeFileSync(edlAbs, JSON.stringify({ beats: [] }));

      const r = await del(port, created.file);
      expect(r.status).toBe(200);
      const j = (await r.json()) as { ok: boolean; trashed: string[] };
      expect(j.trashed.some((t) => t.endsWith('.ydoc.bin'))).toBe(true);
      expect(j.trashed.some((t) => t.endsWith('.edl.json'))).toBe(true);
      expect(existsSync(ydocAbs)).toBe(false);
      expect(existsSync(edlAbs)).toBe(false);
      const trashDirs = readdirSync(join(designRoot, '_trash'));
      const td = join(designRoot, '_trash', trashDirs[0] as string);
      expect(existsSync(join(td, `_state__${created.slug}.ydoc.bin`))).toBe(true);
      expect(existsSync(join(td, `${created.slug}.edl.json`))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('refuses to delete a design-system file (400, untouched)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'system', 'project'), { recursive: true });
      const dsFile = join(designRoot, 'system', 'project', 'Spec.tsx');
      writeFileSync(dsFile, 'export default function S(){return null}');
      const r = await del(port, '.design/system/project/Spec.tsx');
      expect(r.status).toBe(400);
      expect(existsSync(dsFile)).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('refuses a non-.tsx root file like config.json (400)', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await del(port, '.design/config.json');
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('a missing canvas returns 404', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await del(port, 'ui/Nope.tsx');
      expect(r.status).toBe(404);
    } finally {
      await killProc(proc);
    }
  });

  test('a traversal file is rejected (400)', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await del(port, 'ui/../../escape.tsx');
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });
});

// feature-file-tree-drag-drop-folders (dogfood follow-up) — DELETE now
// auto-detects a non-.tsx target as a folder delete.
describe('/_api/canvas — DELETE (folder delete, dogfood follow-up)', () => {
  async function createBoard(port: number, name: string) {
    const r = await fetch(`http://localhost:${port}/_api/canvas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return (await r.json()) as { file: string; slug: string };
  }
  const del = (port: number, file: string) =>
    fetch(`http://localhost:${port}/_api/canvas?file=${encodeURIComponent(file)}`, {
      method: 'DELETE',
    });

  test('deletes a folder: trashes every nested canvas, folder itself is gone', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const created = await createBoard(port, 'Inside');
      const moved = await fetch(`http://localhost:${port}/_api/fs-move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: created.file, toDir: 'ui/Box' }),
      });
      expect(moved.status).toBe(200);
      expect(existsSync(join(designRoot, 'ui', 'Box', 'Inside.tsx'))).toBe(true);

      const r = await del(port, 'ui/Box');
      expect(r.status).toBe(200);
      const j = (await r.json()) as { ok: boolean; trashed: string[] };
      expect(j.ok).toBe(true);
      expect(j.trashed.some((t) => t.endsWith('Inside.tsx'))).toBe(true);
      expect(existsSync(join(designRoot, 'ui', 'Box'))).toBe(false);
      const trashDirs = readdirSync(join(designRoot, '_trash'));
      expect(trashDirs.length).toBe(1);
    } finally {
      await killProc(proc);
    }
  });

  test('deletes an EMPTY folder (mkdir + delete, no canvases inside)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      await fetch(`http://localhost:${port}/_api/fs-mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: 'ui', name: 'Empty' }),
      });
      expect(existsSync(join(designRoot, 'ui', 'Empty'))).toBe(true);
      const r = await del(port, 'ui/Empty');
      expect(r.status).toBe(200);
      expect(existsSync(join(designRoot, 'ui', 'Empty'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });

  test('refuses deleting a canvas GROUP ROOT (400, untouched)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await del(port, 'ui');
      expect(r.status).toBe(400);
      expect(existsSync(join(designRoot, 'ui'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('refuses deleting a design-system folder (400, untouched)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'system', 'sub'), { recursive: true });
      const r = await del(port, 'system/sub');
      expect(r.status).toBe(400);
      expect(existsSync(join(designRoot, 'system', 'sub'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('a missing folder returns 404', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await del(port, 'ui/Nope');
      expect(r.status).toBe(404);
    } finally {
      await killProc(proc);
    }
  });

  // Security review finding — see the matching tests in canvas-move-api.test.ts
  // and fs-mkdir-api.test.ts.
  test('refuses deleting a symlinked "folder" (would rm -rf outside designRoot)', async () => {
    const { root, designRoot } = makeSandbox();
    const outside = join(root, 'OUTSIDE');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'Secret.txt'), 'do not delete me');
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      symlinkSync(outside, join(designRoot, 'ui', 'evil'));
      const r = await del(port, 'ui/evil');
      expect(r.status).toBe(400);
      expect(existsSync(join(outside, 'Secret.txt'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });
});
