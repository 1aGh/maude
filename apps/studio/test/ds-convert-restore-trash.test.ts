// fix/ds-convert-hooks-cli #7 / #8 — Restore in a hub-linked project, and a stale Design system
// canvas no supported path could remove.
//
// #7: Restore MOVED the Design system canvas with a bare rename. To sync that is "gone from this
// disk", never "deleted from the project" — only the canvas delete route's `canvas-deleted` event is
// (sync/index.ts noteToHub → a tombstone). So the hub brought design-system.tsx + .meta.json straight
// back, and the next `ds convert` ended with `ds-convert-exists`. The route now says it.
// #8: that resurrected canvas could not be trashed — `trash move` / fs-delete refused every file
// under the `system` group. A Design system canvas of a FOLDER system now goes to the Trash where
// Restore puts one (`_trash/ds-convert/`), with the same `canvas-deleted`; a converted system's
// canvas still refuses, naming Restore.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApi } from '../api.ts';
import { type Context, createBus } from '../context.ts';
import { createDsConvert, RESTORE_TRASH_REL, trashFolderDsCanvas } from '../ds/convert.ts';
import { execDsPlan } from '../ds/ds-verb.ts';
import { createDsEngine } from '../ds/engine.ts';
import { runConvertOp } from '../routes/ds-convert.ts';
import {
  readPendingDeletes,
  recordPendingDelete,
  takePendingDeletes,
} from '../sync/pending-deletes.ts';

const PERSON = { kind: 'person', name: 'Tereza' } as const;
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CSS = `.gator[data-theme="light"], .ds[data-theme="light"] {
  --bg-0: oklch(0.98 0 0);
  --fg-0: oklch(0.2 0 0);
  --accent: oklch(0.55 0.15 150);
}
.gator[data-theme="dark"], .ds[data-theme="dark"] {
  --bg-0: oklch(0.2 0 0);
  --fg-0: oklch(0.95 0 0);
  --accent: oklch(0.6 0.15 150);
}
`;

function makeProject() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-ds-restore-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  const write = (rel: string, text: string) => {
    const abs = path.join(designRoot, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  const config = {
    designSystems: [
      {
        name: 'gator',
        label: 'Alligators',
        path: 'system/gator',
        rootClass: 'gator',
        themes: ['light', 'dark'],
        themeDefault: 'light',
      },
    ],
    defaultDesignSystem: 'gator',
    canvasGroups: [{ path: 'ui' }, { path: 'system' }],
  };
  write('config.json', `${JSON.stringify(config, null, 2)}\n`);
  write('system/gator/colors_and_type.css', CSS);
  write('system/gator/preview/_components.css', '.btn {}\n');
  write('system/gator/preview/colors.tsx', 'export default () => <p>c</p>;\n');
  write('ui/Home.tsx', 'export default () => <h1>Home</h1>;\n');
  const engine = createDsEngine({ designRoot, kernel: null, log: { warn() {}, error() {} } });
  let clock = Date.parse('2026-11-05T10:00:00Z');
  const eng = { ...engine, now: () => (clock += 1000) };
  return { root, designRoot, engine: eng, write };
}

function opContext(engine: ReturnType<typeof makeProject>['engine']) {
  const events: Array<[string, unknown]> = [];
  return {
    events,
    c: {
      engine,
      outside: null,
      usage: null,
      access: { can: () => true },
      by: PERSON,
      emit: (e: string, p: unknown) => events.push([e, p]),
    } as never,
  };
}

const DS_CANVAS_REL = 'system/gator/design-system.tsx';

describe('#7 Restore propagates as a deletion', () => {
  test('the restore route emits canvas-deleted for the Design system canvas', async () => {
    const p = makeProject();
    const { c, events } = opContext(p.engine);
    await runConvertOp({ systems: ['gator'] }, c);
    expect(existsSync(path.join(p.designRoot, DS_CANVAS_REL))).toBe(true);
    events.length = 0;
    const r = await runConvertOp({ restore: 'gator' }, c);
    expect(r.status).toBe(200);
    expect(events).toContainEqual(['canvas-deleted', { slug: 'system-gator-design-system' }]);
    expect(events.map(([e]) => e)).toContain('canvas-list-update');
  });
});

describe('#8 a stale Design system canvas goes to the Trash Restore uses', () => {
  test('a folder system’s leftover canvas is trashed into _trash/ds-convert/; convert works again', async () => {
    const p = makeProject();
    const cv = createDsConvert(p.engine);
    await cv.convert({ systems: ['gator'], by: PERSON });
    const canvas = readFileSync(path.join(p.designRoot, DS_CANVAS_REL), 'utf8');
    const meta = readFileSync(
      path.join(p.designRoot, 'system/gator/design-system.meta.json'),
      'utf8'
    );
    await cv.restore({ ds: 'gator', by: PERSON });
    // sync brings the canvas back (the hub re-creates it): the next convert is refused…
    p.write(DS_CANVAS_REL, canvas);
    p.write('system/gator/design-system.meta.json', meta);
    expect(cv.plan(['gator']).systems[0].refused?.code).toBe('ds-convert-exists');
    // …until the leftover is trashed — through the canvas delete route, the one `trash move` uses
    const ctx: Context = {
      cfg: {
        canvasGroups: [
          { label: 'Design system', path: 'system' },
          { label: 'Canvases', path: 'ui' },
        ],
      } as Context['cfg'],
      projectLabel: 'test',
      bus: createBus(),
      paths: {
        repoRoot: p.root,
        designRel: '.design',
        designRoot: p.designRoot,
        serverInfoFile: path.join(p.designRoot, '_server.json'),
        activeFile: path.join(p.designRoot, '_active.json'),
        commentsDir: path.join(p.designRoot, '_comments'),
        canvasStateDir: path.join(p.designRoot, '_canvas-state'),
        historyDir: path.join(p.designRoot, '_history'),
        tokensUrlRel: '',
        systemDirRel: 'system',
      },
    };
    const deleted: unknown[] = [];
    ctx.bus.on('canvas-deleted', (x: unknown) => deleted.push(x));
    const api = createApi(ctx, {
      onCommentsChanged: () => {},
      isRoomPinned: () => false,
      flushAndDropRoom: async () => {},
    });
    const r = await api.deleteCanvas({ file: DS_CANVAS_REL });
    expect(r.ok).toBe(true);
    expect(deleted).toEqual([{ slug: 'system-gator-design-system' }]);
    expect(existsSync(path.join(p.designRoot, DS_CANVAS_REL))).toBe(false);
    expect(existsSync(path.join(p.designRoot, 'system/gator/design-system.meta.json'))).toBe(false);
    expect(r.ok && r.trashDir).toContain(`.design/${RESTORE_TRASH_REL}/gator-`);
    expect(cv.plan(['gator']).systems[0].refused).toBeNull();
    await cv.convert({ systems: ['gator'], by: PERSON });
    // a converted system's canvas IS the system: refused, naming Restore
    const again = await api.deleteCanvas({ file: DS_CANVAS_REL });
    expect(again.ok).toBe(false);
    expect(!again.ok && again.error).toContain('--restore');
    expect(trashFolderDsCanvas(p.designRoot, 'system/gator')).toBeNull();
    expect(existsSync(path.join(p.designRoot, DS_CANVAS_REL))).toBe(true);
  });
});

// #7, studio closed — `maude design ds convert <ds> --restore` runs IN-PROCESS when no studio
// answers (ds/ds-verb.ts execDsPlan, studio: null). There is no bus, so the deletion went nowhere and
// the next boot pulled the hub's copy back (live repro on a local cell, 2026-11-05). The run now
// writes the deletion down; the next sync boot keeps the pull off it and tells the project.
describe('#7 Restore with no studio running', () => {
  test('an in-process Restore records the Design system canvas as a pending deletion', async () => {
    const p = makeProject();
    const o = { root: p.root, studio: null, by: PERSON };
    const conv = await execDsPlan({ op: 'convert', input: { systems: ['gator'] } } as never, o);
    expect(conv.status).toBe(200);
    expect(readPendingDeletes(p.designRoot)).toEqual([]);
    const r = await execDsPlan({ op: 'convert', input: { restore: 'gator' } } as never, o);
    expect(r.status).toBe(200);
    expect(readPendingDeletes(p.designRoot).map((d) => [d.slug, d.rel])).toEqual([
      ['system-gator-design-system', DS_CANVAS_REL],
    ]);
    // Boot takes it once: still a deletion (the file is gone), and the record is cleared.
    expect(takePendingDeletes(p.designRoot).map((d) => d.slug)).toEqual([
      'system-gator-design-system',
    ]);
    expect(readPendingDeletes(p.designRoot)).toEqual([]);
  });

  test('a canvas that is back by the next boot is no longer a deletion', () => {
    const p = makeProject();
    expect(recordPendingDelete(p.designRoot, { slug: 'ui-home', rel: 'ui/Home.tsx' })).toBe(true);
    expect(takePendingDeletes(p.designRoot)).toEqual([]);
    // Nothing outside the design root or under runtime state is ever recorded.
    expect(recordPendingDelete(p.designRoot, { slug: 'x', rel: '../outside.tsx' })).toBe(false);
    expect(recordPendingDelete(p.designRoot, { slug: 'y', rel: '_trash/y.tsx' })).toBe(false);
  });
});
