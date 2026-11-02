// S10.5 — the design-system usage index (V2-1.6 §5.13): `places` = direct + via components,
// artboard attribution, element ids (Q11), incremental update, and the "only what this Mac
// holds" boundary. Hand counts on a fixture, not a re-run of the extractor.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { IndexContext } from '../index/extract.ts';
import { createIndexService, type IndexService } from '../index/service.ts';

let root: string;
let designRoot: string;
let indexDir: string;
const prevIndexDir = process.env.MAUDE_INDEX_DIR;
let svc: IndexService | null = null;

const put = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(designRoot, rel)), { recursive: true });
  writeFileSync(path.join(designRoot, rel), text);
};
const drop = (rel: string) => rmSync(path.join(designRoot, rel), { force: true });

const TOKENS = `:root, .fx { --accent: oklch(0.6 0.1 250); --fg-0: oklch(0.2 0 0); --line: oklch(0.8 0 0); --bg-1: oklch(0.97 0 0); --space-2: 8px; }
.fx[data-theme="dark"] { --accent: oklch(0.7 0.1 250); }
`;
const COMPONENTS = `.btn { background: var(--accent); color: var(--fg-0); }
.btn--ghost { border: 1px solid var(--line); }
.card { background: var(--bg-1); padding: var(--space-2); }
`;

const canvasA = (extra = '') => `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';
export default function A() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={600}>
        <div data-cd-id="hero" style={{ background: 'var(--accent)' }}>
          <button className="btn btn--ghost">Go</button>
          <button className="btn">Two</button>
        </div>
      </DCArtboard>
      <DCArtboard id="mobile" label="Mobile" width={375} height={800}>
        <p style={{ color: 'var(--accent)' }}>x</p>
        <div className="card" />
        ${extra}
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const canvasB = `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';
export default function B() {
  return (
    <DesignCanvas>
      <DCArtboard id="only" label="Only" width={400} height={400}>
        <i style={{ color: 'var(--accent)' }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const meta = (ds: string) => `${JSON.stringify({ designSystem: ds })}\n`;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'maude-dsu-'));
  designRoot = path.join(root, '.design');
  indexDir = mkdtempSync(path.join(tmpdir(), 'maude-dsu-idx-'));
  process.env.MAUDE_INDEX_DIR = indexDir;
  put(
    'config.json',
    `${JSON.stringify({
      project: 't',
      designSystems: [{ name: 'fx', path: 'system/fx', rootClass: 'fx' }],
      defaultDesignSystem: 'fx',
    })}\n`
  );
  put('system/fx/colors_and_type.css', TOKENS);
  put('system/fx/preview/_components.css', COMPONENTS);
  put('ui/A.tsx', canvasA());
  put('ui/A.meta.json', meta('fx'));
  put('ui/B.tsx', canvasB);
  put('ui/B.meta.json', meta('fx'));
  // on disk but outside every canvas group: this Mac does not hold it as a canvas
  put('private/Z.tsx', canvasB);
  put('private/Z.meta.json', meta('fx'));
});
afterEach(() => {
  svc?.stop();
  svc = null;
  rmSync(root, { recursive: true, force: true });
  rmSync(indexDir, { recursive: true, force: true });
  if (prevIndexDir === undefined) delete process.env.MAUDE_INDEX_DIR;
  else process.env.MAUDE_INDEX_DIR = prevIndexDir;
});

const ctx = (): IndexContext => ({
  designRoot,
  groups: [{ path: 'ui', label: 'UI' }],
  defaultDs: 'fx',
  designSystems: [{ name: 'fx', path: 'system/fx' }],
});
function boot(persist = false) {
  svc = createIndexService({
    root,
    designRel: '.design',
    context: ctx,
    project: () => ({ name: 't', label: null, formatVersion: 1, linkedHub: null, managed: false }),
    persist: false,
    dsUsage: { persist },
  });
  const u = svc.dsUsage();
  if (!u) throw new Error('dsUsage not hosted');
  return { svc, u };
}

describe('ds-usage index', () => {
  test('direct use: var(--accent) written in a canvas counts per artboard, with element ids', () => {
    const { u } = boot();
    const e = u.system('fx')?.tokens['--accent']?.['ui/B.tsx'];
    expect(e?.direct).toBe(1);
    expect(e?.viaComponents).toBe(0);
    expect(e?.places).toBe(1);
    expect(e?.artboards).toEqual({ only: 1 });
    expect(e?.elements).toHaveLength(1);
    expect(e?.elements[0]?.artboard).toBe('only');
    // an element with no authored id carries the pipeline's computed 8-hex id
    expect(e?.elements[0]?.id).toMatch(/^[0-9a-f]{8}$/);
  });

  test('use via a component: instances of a class whose _components.css rule references the token', () => {
    const { u } = boot();
    const s = u.system('fx');
    const accent = s?.tokens['--accent']?.['ui/A.tsx'];
    // hand count: 2 direct (hero, the paragraph) + 2 .btn instances
    expect(accent?.direct).toBe(2);
    expect(accent?.viaComponents).toBe(2);
    expect(accent?.places).toBe(4);
    // --line is only referenced by .btn--ghost, a variant of btn: both buttons are btn instances
    expect(s?.tokens['--line']?.['ui/A.tsx']).toMatchObject({
      direct: 0,
      viaComponents: 2,
      places: 2,
    });
    expect(s?.tokens['--bg-1']?.['ui/A.tsx']).toMatchObject({ direct: 0, viaComponents: 1 });
    expect(s?.components.btn?.['ui/A.tsx']).toMatchObject({
      instances: 2,
      artboards: { desktop: 2 },
    });
    expect(s?.components.card?.['ui/A.tsx']).toMatchObject({
      instances: 1,
      artboards: { mobile: 1 },
    });
    // a token the system declares but no canvas uses has no row
    expect(s?.tokens['--space-2']?.['ui/B.tsx']).toBeUndefined();
  });

  test('artboard attribution: counts split by DCArtboard, authored ids kept', () => {
    const { u } = boot();
    const accent = u.system('fx')?.tokens['--accent']?.['ui/A.tsx'];
    expect(accent?.artboards).toEqual({ desktop: 3, mobile: 1 });
    expect(accent?.elements.map((x) => x.id)).toContain('hero');
    expect(accent?.elements.find((x) => x.id === 'hero')?.artboard).toBe('desktop');
    // places split exactly: every place sits in an artboard here
    const sum = Object.values(accent?.artboards ?? {}).reduce((a, b) => a + b, 0);
    expect(sum).toBe(accent?.places);
  });

  test('a canvas gets its state and pins from ds-check; draft = no canvas uses the system', () => {
    put('ui/A.tsx', canvasA(`<span style={{ color: '#ff0000' }} />`));
    const { u } = boot();
    const c = u.system('fx')?.canvases['ui/A.tsx'];
    expect(c?.follows).toBe(true);
    expect(c?.dsRev).toBeNull();
    expect(c?.elementPins).toEqual({ head: 0 });
    expect(c?.pins['literal-colour']).toBeGreaterThanOrEqual(1);
    expect(c?.state).not.toBe('switchable');
    expect(u.system('fx')?.draft).toBe(false);
  });

  test('ACL subset: only canvases the index holds are counted', () => {
    const { u } = boot();
    const s = u.system('fx');
    expect(Object.keys(s?.canvases ?? {}).sort()).toEqual(['ui/A.tsx', 'ui/B.tsx']);
    expect(s?.tokens['--accent']?.['private/Z.tsx']).toBeUndefined();
    const q = u.query('fx', { css: '--accent' });
    expect(q.canvases.map((c) => c.rel).sort()).toEqual(['ui/A.tsx', 'ui/B.tsx']);
    expect(q.places).toBe(5);
  });

  test('incremental: one canvas save re-scans only that canvas', () => {
    const { svc, u } = boot();
    u.system('fx');
    const before = u.stats().scanned;
    put(
      'ui/B.tsx',
      canvasB.replace(
        `<i style={{ color: 'var(--accent)' }} />`,
        `<i style={{ color: 'var(--accent)', background: 'var(--accent)' }} />`
      )
    );
    svc.update(['ui/B.tsx']);
    expect(u.stats().scanned).toBe(before + 1);
    expect(u.system('fx')?.tokens['--accent']?.['ui/B.tsx']?.places).toBe(2);
    expect(u.system('fx')?.tokens['--accent']?.['ui/A.tsx']?.places).toBe(4);
    expect(u.stats().lastScanMs).toBeLessThan(50);
  });

  test('a removed canvas drops its places', () => {
    const { svc, u } = boot();
    expect(u.query('fx', { css: '--accent' }).places).toBe(5);
    drop('ui/B.tsx');
    drop('ui/B.meta.json');
    svc.update(['ui/B.tsx']);
    const s = u.system('fx');
    expect(s?.canvases['ui/B.tsx']).toBeUndefined();
    expect(s?.tokens['--accent']?.['ui/B.tsx']).toBeUndefined();
    expect(u.query('fx', { css: '--accent' }).places).toBe(4);
  });

  test('a system file change re-derives the component map without re-scanning canvases', () => {
    const { svc, u } = boot();
    u.system('fx');
    const before = u.stats().scanned;
    put('system/fx/preview/_components.css', `${COMPONENTS}.card { border-color: var(--line); }\n`);
    svc.update(['system/fx/preview/_components.css']);
    expect(u.stats().scanned).toBe(before);
    expect(u.system('fx')?.tokens['--line']?.['ui/A.tsx']).toMatchObject({ viaComponents: 3 });
  });

  test('a stylesheet next to the canvas counts as a source, attributed through its classes', () => {
    put('ui/B.css', `.pill { background: var(--accent); }\n`);
    put(
      'ui/B.tsx',
      canvasB.replace(`<i style={{ color: 'var(--accent)' }} />`, `<i className="pill" />`)
    );
    const { u } = boot();
    const e = u.system('fx')?.tokens['--accent']?.['ui/B.tsx'];
    expect(e).toMatchObject({ direct: 1, places: 1, artboards: { only: 1 } });
    expect(e?.elements).toHaveLength(1);
  });

  test('a restart reuses the persisted file: unchanged canvases are not re-scanned', () => {
    const first = boot(true);
    first.u.system('fx');
    first.u.flush();
    const file = path.join(designRoot, '_cache', 'index', 'ds-usage.json');
    expect(existsSync(file)).toBe(true);
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk.format).toBe('maude.ds-usage');
    expect(onDisk.v).toBe(1);
    expect(onDisk.sources['ui/A.tsx'].sha256).toMatch(/^[0-9a-f]{64}$/);
    first.svc.stop();
    const second = boot(true);
    expect(second.u.system('fx')?.tokens['--accent']?.['ui/A.tsx']?.places).toBe(4);
    expect(second.u.stats().scanned).toBe(0);
  });
});
