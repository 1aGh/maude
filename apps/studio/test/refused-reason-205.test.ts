// 2.0.5 (#205) — the person sees WHY a canvas is refused. A walk the closure blocked was already named
// (`canvasImportsCanvases`); a module refused AFTER the build (the inputs gate) is now kept per canvas on the
// server (access/refused-inputs.ts), reported on the main origin's /_index-data (`canvasRefusedInputs`, held to
// what the reader sees), drawn on the card, and printed by /design:smoke and ds-check — in one set of words.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { filterIndexData } from '../access/filters.ts';
import {
  createRefusedInputs,
  entryRel,
  MAX_NAMES,
  refusedDesignInputs,
} from '../access/refused-inputs.ts';
import { reasonLines } from '../bin/_canvas-reasons.mjs';
import { canvasRefusedOf } from '../client/canvas-url.js';
import { canvasImportsLines, canvasImportsText } from '../client/v2/code/canvas-imports-words.js';
import { runDsCheck } from '../ds/cli.ts';

const USES = 'This canvas uses ui/shared.tsx, which belongs to another canvas.';

describe('the words', () => {
  test('a blocked walk keeps its line; a refused file gets its own', () => {
    expect(canvasImportsText(['ui/b.tsx'], 'ui/components').title).toBe(
      'This canvas imports another canvas (ui/b.tsx).'
    );
    const only = canvasImportsText([], 'ui/components', ['ui/shared.tsx']);
    expect(only.title).toBe(USES);
    expect(only.also).toEqual([]);
    expect(only.body).toBe(
      'Move the shared part into a component file (e.g. ui/components/…) to render it here.'
    );
    const both = canvasImportsLines(['ui/b.tsx'], '', ['ui/x.tsx', 'ui/y.tsx']);
    expect(both).toEqual([
      'This canvas imports another canvas (ui/b.tsx).',
      'This canvas uses ui/x.tsx and ui/y.tsx, which belong to another canvas.',
      'Move the shared part into a component file (e.g. ui/components/…) to render it here.',
    ]);
  });

  test('the shell reads the refused list from the index', () => {
    const cfg = { canvasRefusedInputs: { '.design/ui/a.tsx': ['ui/shared.tsx', 7] } };
    expect(canvasRefusedOf(cfg, '.design/ui/a.tsx')).toEqual(['ui/shared.tsx']);
    expect(canvasRefusedOf(cfg, '.design/ui/b.tsx')).toBeNull();
  });
});

describe('the server keeps the reason, bounded', () => {
  const roots = ['/p/.design'];
  test('only the design-root inputs the frame does not see', () => {
    const inputs = [
      '/p/.design/ui/a.tsx',
      '/p/.design/ui/shared.tsx',
      '/maude/canvas-lib.tsx',
      '/p/.design/ui/components/Button.tsx',
    ];
    const sees = (r: string) => r === 'ui/a.tsx' || r.startsWith('ui/components/');
    expect(refusedDesignInputs(inputs, roots, sees)).toEqual(['ui/shared.tsx']);
    expect(entryRel('/p/.design/ui/a.tsx', roots)).toBe('ui/a.tsx');
    expect(entryRel('/elsewhere/a.tsx', roots)).toBeNull();
  });

  test('record / clear / report; oldest canvas dropped past the cap; names capped', () => {
    const s = createRefusedInputs(2);
    expect(s.record('ui/a.tsx', ['ui/x.tsx'])).toBe(true);
    expect(s.record('ui/a.tsx', ['ui/x.tsx'])).toBe(false); // unchanged: no nudge to the shell
    s.record('ui/b.tsx', ['ui/y.tsx']);
    s.record('ui/c.tsx', ['ui/z.tsx']);
    expect([...s.report().keys()]).toEqual(['ui/b.tsx', 'ui/c.tsx']);
    expect(s.clear('ui/b.tsx')).toBe(true);
    expect(s.clear('ui/b.tsx')).toBe(false);
    s.record(
      'ui/d.tsx',
      Array.from({ length: 50 }, (_, i) => `ui/f${String(i).padStart(2, '0')}.tsx`)
    );
    expect(s.report().get('ui/d.tsx')).toHaveLength(MAX_NAMES);
  });
});

describe('/_index-data holds the names to the reader', () => {
  test('a reader that sees A but not the file gets no entry (no probe oracle)', () => {
    const data = {
      groups: [],
      canvasDesignSystems: {},
      canvasKinds: {},
      canvasRefusedInputs: {
        '.design/ui/a.tsx': ['ui/shared.tsx', 'ui/seen.tsx'],
        '.design/ui/hidden.tsx': ['ui/seen.tsx'],
        '.design/ui/only-hidden.tsx': ['ui/shared.tsx'],
      },
    };
    const vis = {
      full: false,
      access: { canvasOnly: true },
      closure: () => null,
      sees: (r: string) => ['ui/a.tsx', 'ui/seen.tsx', 'ui/only-hidden.tsx'].includes(r),
    } as unknown as Parameters<typeof filterIndexData>[1];
    const out = filterIndexData(data, vis, '.design');
    expect(out.canvasRefusedInputs).toEqual({ '.design/ui/a.tsx': ['ui/seen.tsx'] });
    const full = filterIndexData(data, { full: true } as never, '.design');
    expect(full.canvasRefusedInputs).toEqual(data.canvasRefusedInputs);
  });
});

describe('smoke and ds-check say it', () => {
  test('smoke: one REFUSED line per canvas, both reasons', () => {
    const lines = reasonLines(
      {
        designRoot: '.design',
        canvasImportsCanvases: { '.design/ui/a.tsx': ['ui/b.tsx'] },
        canvasRefusedInputs: { '.design/ui/c.tsx': ['ui/shared.tsx'] },
      },
      'ui/components'
    );
    expect(lines).toEqual([
      'REFUSED  ui/a.tsx — This canvas imports another canvas (ui/b.tsx). Move the shared part into a component file (e.g. ui/components/…) to render it here.',
      `REFUSED  ui/c.tsx — ${USES} Move the shared part into a component file (e.g. ui/components/…) to render it here.`,
    ]);
    expect(reasonLines(null)).toEqual([]);
  });

  test('ds-check --canvas: a canvas that imports another canvas is told why', () => {
    const root = mkdtempSync(join(tmpdir(), 'refused-205-'));
    try {
      const d = join(root, '.design');
      mkdirSync(join(d, 'ui'), { recursive: true });
      writeFileSync(
        join(d, 'config.json'),
        JSON.stringify({ name: 't', canvasGroups: [{ label: 'UI', path: 'ui' }] })
      );
      writeFileSync(
        join(d, 'ui/b.tsx'),
        "import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas />;\n"
      );
      writeFileSync(join(d, 'ui/b.meta.json'), '{}\n');
      writeFileSync(
        join(d, 'ui/a.tsx'),
        "import { DesignCanvas } from '@maude/canvas-lib';\nimport B from './b.tsx';\nexport default () => <DesignCanvas><B /></DesignCanvas>;\n"
      );
      writeFileSync(join(d, 'ui/a.meta.json'), '{}\n');
      const r = runDsCheck(['--canvas', 'ui/a.tsx'], { CLAUDE_PROJECT_DIR: root }, null);
      expect(r.stdout).toContain('✗ This canvas imports another canvas (ui/b.tsx).');
      expect(r.stdout).toContain('✗ Move the shared part into a component file');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
