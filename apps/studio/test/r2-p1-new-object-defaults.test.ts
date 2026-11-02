// r2-p1-create · TD3 (Michal, UX audit F02): a new object is drawn in NEUTRAL role tokens with a fixed literal
// fallback — shape `--bg-3`, frame `--bg-1` (+ a hairline border), line / path `--fg-1`, text `--fg-0` + the body
// font. Never `--accent` (the accent is a signal), never `currentColor`, and never invisible after deselect: with no
// design system the artboard is `var(--bg-0, #ffffff)`, so every fallback must differ from white. ds-check must not
// flag the fallback literal that sits behind a role token.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { applyInsertElementIntoArtboard, readAttributeState } from '../canvas-edit.ts';
import { checkCanvas } from '../ds/canvas-check.ts';
import { canvasContext } from '../ds/canvas-cli.ts';
import { loadProject } from '../ds/cli.ts';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import {
  FRAME_BORDER,
  FRAME_FILL,
  LINE_STROKE,
  SHAPE_FILL,
  TEXT_COLOR,
} from '../edit-ops/insert-shape.ts';
import { PATH_STROKE } from '../edit-ops/path.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { conformantFiles } from './_ds-fixture.ts';

const FILE = 'ui/Home.tsx';
const HOME = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}></DCArtboard>
    </DesignCanvas>
  );
}
`;

function harness() {
  const files = new Map<string, string>([[FILE, HOME]]);
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f) ? f : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _before, after) => {
      files.set(rel, after);
    },
    writeLayout: async () => {},
    heldByAi: () => null,
    log: createWriteLog(),
  };
  const run = (params: Record<string, unknown>) =>
    dispatchEditOp({ file: FILE, op: 'object.insert-shape', targets: [], params }, deps);
  return { run, src: () => files.get(FILE) as string };
}
const good = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const style = (src: string, id: string, prop: string) => {
  const s = readAttributeState(FILE, src, id, `style.${prop}`);
  return s.kind === 'literal' ? s.value : s.kind;
};

/** `var(--role, #hex)` → [role, hex]; anything else → null. */
const roleWithLiteral = (v: string): [string, string] | null => {
  const m = /var\((--[a-z0-9-]+),\s*(#[0-9a-f]{6})\)/i.exec(v);
  return m ? [m[1], m[2].toLowerCase()] : null;
};

describe('TD3 — neutral role tokens with a fixed literal fallback', () => {
  test('each default names its neutral role and a literal, never the accent or currentColor', () => {
    expect(roleWithLiteral(SHAPE_FILL)?.[0]).toBe('--bg-3');
    expect(roleWithLiteral(FRAME_FILL)?.[0]).toBe('--bg-1');
    expect(roleWithLiteral(FRAME_BORDER)?.[0]).toBe('--border-default');
    expect(roleWithLiteral(LINE_STROKE)?.[0]).toBe('--fg-1');
    expect(roleWithLiteral(PATH_STROKE)?.[0]).toBe('--fg-1');
    expect(roleWithLiteral(TEXT_COLOR)?.[0]).toBe('--fg-0');
    for (const v of [SHAPE_FILL, FRAME_FILL, FRAME_BORDER, LINE_STROKE, PATH_STROKE, TEXT_COLOR]) {
      expect(v).not.toContain('currentColor');
      expect(v).not.toContain('--accent');
    }
  });

  test('no design system: every fallback differs from the white artboard it lands on', () => {
    for (const v of [SHAPE_FILL, FRAME_BORDER, LINE_STROKE, PATH_STROKE, TEXT_COLOR]) {
      const lit = roleWithLiteral(v)?.[1];
      expect(lit).toBeDefined();
      expect(lit).not.toBe('#ffffff');
    }
    // a frame's fill may be near-white; its border is what keeps it visible after deselect
    expect(roleWithLiteral(FRAME_FILL)?.[1]).not.toBe('#ffffff');
  });

  test('the op writes them: rectangle, frame (fill + border, size kept), line, text (colour + body font)', async () => {
    const h = harness();
    const rect = { artboard: 'desktop', rect: { x: 10, y: 10, w: 100, h: 80 } };
    good(await h.run({ ...rect, kind: 'rectangle' }));
    good(await h.run({ ...rect, kind: 'frame' }));
    good(await h.run({ artboard: 'desktop', kind: 'line', line: { x1: 0, y1: 0, x2: 50, y2: 0 } }));
    good(await h.run({ artboard: 'desktop', kind: 'text', at: { x: 5, y: 5 } }));
    const src = h.src();
    expect(style(src, 'rectangle', 'background')).toBe(SHAPE_FILL);
    expect(style(src, 'frame', 'background')).toBe(FRAME_FILL);
    expect(style(src, 'frame', 'border')).toBe(`1px solid ${FRAME_BORDER}`);
    expect(style(src, 'frame', 'boxSizing')).toBe('border-box');
    expect(style(src, 'line', 'borderTop')).toBe(`2px solid ${LINE_STROKE}`);
    expect(style(src, 'text', 'color')).toBe(TEXT_COLOR);
    expect(style(src, 'text', 'fontFamily')).toBe(
      'var(--font-body, system-ui, -apple-system, sans-serif)'
    );
    expect(src).not.toContain('currentColor');
  });

  test('a text that wears the system body style keeps the style’s own colour', async () => {
    const h = harness();
    good(await h.run({ artboard: 'desktop', kind: 'text', at: { x: 5, y: 5 }, role: 't-body' }));
    expect(style(h.src(), 'text', 'color')).toBe('absent');
  });
});

describe('the insert palette (+) uses the same defaults', () => {
  test('a box is the shape fill, a text the text colour + body font', () => {
    const box = applyInsertElementIntoArtboard(
      '/x/ui/Home.tsx',
      HOME,
      'desktop',
      'inside-end',
      'div'
    );
    expect(box.source).toContain(SHAPE_FILL);
    expect(box.source).not.toContain("'var(--bg-2)'");
    const text = applyInsertElementIntoArtboard(
      '/x/ui/Home.tsx',
      HOME,
      'desktop',
      'inside-end',
      'text'
    );
    expect(text.source).toContain(TEXT_COLOR);
  });
});

describe('ds-check does not flag the fallback behind a role token', () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-p1-ds-'));
  const D = join(root, '.design');
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(D, rel)), { recursive: true });
    writeFileSync(join(D, rel), text);
  };
  for (const [rel, text] of Object.entries(conformantFiles())) put(rel, text);
  put(
    'config.json',
    JSON.stringify({
      designSystems: [
        {
          name: 'fx',
          path: 'system/fx',
          rootClass: 'fx',
          themes: ['light', 'dark'],
          themeDefault: 'light',
        },
      ],
      activeFamilies: ['accent', 'status', 'presence'],
      colorSpace: 'oklch',
    })
  );
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const check = (name: string, tsx: string) => {
    put(`ui/${name}.tsx`, tsx);
    put(`ui/${name}.meta.json`, JSON.stringify({ designSystem: 'fx' }));
    return checkCanvas(canvasContext(loadProject(root, {})), `ui/${name}.tsx`, { strict: true });
  };

  test('a canvas made of fresh objects is switchable, no S1 finding', async () => {
    const h = harness();
    const rect = { artboard: 'desktop', rect: { x: 10, y: 10, w: 100, h: 80 } };
    good(await h.run({ ...rect, kind: 'rectangle' }));
    good(await h.run({ ...rect, kind: 'frame' }));
    good(await h.run({ artboard: 'desktop', kind: 'line', line: { x1: 0, y1: 0, x2: 50, y2: 0 } }));
    good(await h.run({ artboard: 'desktop', kind: 'text', at: { x: 5, y: 5 } }));
    const r = check('fresh', h.src());
    expect(r.findings.filter((f) => f.rule === 'S1')).toEqual([]);
    expect(r.state).toBe('switchable');
  });

  test('a literal is still a literal: bare, or behind a name that is not a role', () => {
    const r = check(
      'still',
      'export default () => (<div>\n  <p style={{ background: "#123456" }} />\n  <p style={{ color: "var(--my-thing, #abcdef)" }} />\n</div>);\n'
    );
    expect(
      r.findings
        .filter((f) => f.rule === 'S1')
        .map((f) => f.name)
        .sort()
    ).toEqual(['#123456', '#abcdef']);
  });

  // V2-8.9 r2 F5 (attacker) — the exemption could be forced: declare the role yourself (`'--bg-3':
  // 'initial'`) and the fallback ALWAYS applies, so the literal decides the colour and a system switch
  // changes nothing, with no finding. A file that declares a registry role loses the exemption for that
  // role, and the local declaration is itself a finding.
  test('a file that declares a role itself: its fallback is a literal again, and the declaration is flagged', () => {
    const r = check(
      'forced',
      "export default () => (<div style={{ '--bg-3': 'initial' }}>\n  <p style={{ background: 'var(--bg-3, #ff00ff)' }} />\n  <p style={{ color: 'var(--fg-1, #111111)' }} />\n</div>);\n"
    );
    const s1 = r.findings.filter((f) => f.rule === 'S1');
    expect(s1.map((f) => f.name).sort()).toEqual(['#ff00ff', '--bg-3']);
    expect(s1.find((f) => f.name === '--bg-3')?.kind).toBe('role-declared');
    expect(s1.every((f) => f.severity === 'blocker')).toBe(true);
    expect(r.state).not.toBe('switchable');
  });
});
