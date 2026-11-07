// #151 §3 (T2.3) — a canvas that renders components imported from a sibling file (a shared hi-fi
// library: `import { Phone } from './hifi'`) had NO `data-cd-id` on any element inside them: the
// pipeline stamped only the canvas's own source, so a comment, a selection or an arrow aimed at
// such an element had nothing durable to hold. Elements of an imported local module are now
// stamped too, with an id scoped to that module (never colliding with the canvas's own), without
// the canvas-only edit surface (no locator entry, no inline-edit marker — the edit engine reads
// the canvas file, so offering an edit there would only fail).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCanvasModule } from '../canvas-build.ts';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const HIFI = `export function Phone({ title }: { title: string }) {
  return (
    <div className="ldm-hifi">
      <span>{title}</span>
      <Chip label="x" />
    </div>
  );
}
function Chip({ label }: { label: string }) {
  return <i>{label}</i>;
}
export function Fixed() {
  return <b data-cd-id="authored-bold">kept</b>;
}
`;

const CANVAS = `import { DesignCanvas, DCSection, DCArtboard } from '@maude/canvas-lib';
import { Phone, Fixed } from './hifi';
import { Frame } from './system/ds/frame';
export default function C() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="s">
        <DCArtboard id="a" label="a" width={300} height={300}>
          <Phone title="hi" />
          <Fixed />
          <Frame />
          <p>own</p>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'maude-imp-stamp-'));
  roots.push(root);
  mkdirSync(join(root, 'system', 'ds'), { recursive: true });
  writeFileSync(join(root, 'hifi.tsx'), HIFI);
  writeFileSync(
    join(root, 'system', 'ds', 'frame.tsx'),
    'export function Frame() { return <section>ds</section>; }\n'
  );
  const abs = join(root, 'canvas.tsx');
  writeFileSync(abs, CANVAS);
  const r = await buildCanvasModule(abs, CANVAS, { designRoot: root });
  return { root, r };
}

/** The bundled text of one local module, from its `// <path>` banner to the next banner. */
function moduleText(js: string, file: string): string {
  const at = js.indexOf(`/${file}\n`);
  expect(at).toBeGreaterThan(-1);
  const next = js.indexOf('\n// ', at + 1);
  return js.slice(at, next === -1 ? undefined : next);
}

describe('elements of an imported local module are stamped', () => {
  test('every host element of the imported component carries a data-cd-id', async () => {
    const { r } = await fixture();
    const hifi = moduleText(r.js, 'hifi.tsx');
    const ids = (tag: string) =>
      new RegExp(`jsxs?\\d*\\("${tag}", \\{[^}]*"data-cd-id": "([0-9a-f]{8})"`).exec(hifi)?.[1];
    expect(ids('div')).toBeTruthy();
    expect(ids('span')).toBeTruthy();
    expect(ids('i')).toBeTruthy();
    // an authored id stays exactly as written
    expect(hifi).toContain('"data-cd-id": "authored-bold"');
  });

  test('ids are unique across the canvas and the module', async () => {
    const { r } = await fixture();
    const all = [...r.js.matchAll(/"data-cd-id": "([0-9a-f]{8})"/g)].map((m) => m[1]);
    expect(all.length).toBeGreaterThan(4);
    expect(new Set(all).size).toBe(all.length);
  });

  test('the locator stays the canvas file only, and no inline-edit marker leaks into the module', async () => {
    const { root, r } = await fixture();
    for (const e of Object.values(r.locator)) expect(e.canvas).toBe(join(root, 'canvas.tsx'));
    expect(moduleText(r.js, 'hifi.tsx')).not.toContain('data-cd-editable');
  });

  test('the design system folder stays opaque (its components are selected as instances)', async () => {
    const { r } = await fixture();
    expect(moduleText(r.js, 'system/ds/frame.tsx')).not.toContain('data-cd-id');
  });
});
