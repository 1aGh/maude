// S10.17 (13 · ds-edge-contrast, ds-edge-trash, ds-edge-suggest, canvases 26–28): the engine half. "Lighten to 4.5:1" is
// ONE waiting edit that clears the pair; the trash sheet's question is answered from the system; "Add it to the
// system" is a waiting `add`; an off-system colour is a literal on a CHANGED line with the nearest system colour.
import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';

import { buildBoardModel } from '../ds/board/build-model.ts';
import { contrastOf } from '../ds/contrast.ts';
import { planDsVerb } from '../ds/ds-verb.ts';
import { createDsEdges, DsEdgeError, gitChangedRanges, themeValuesOf } from '../ds/edges.ts';
import { cleanup, DS, DS_PATH, makeProject, PERSON } from './_ds-engine-fixture.ts';

afterAll(cleanup);

const CSS = `/* acme tokens */
:root,
.acme[data-theme="light"],
.ds[data-theme="light"] {
  --accent: oklch(0.55 0.2 255);
  --bg-0: #fbfbf8;
  --bg-1: #f1f1ec;
  --fg-0: #111111;
  --fg-2: #5a6b60;
  --x-line-fine: #dddddd;
  --x-line-mid: #bbbbbb;
}

.acme[data-theme="dark"],
.ds[data-theme="dark"] {
  --accent: oklch(0.65 0.2 255);
  --bg-0: #141815;
  --bg-1: #1c211d;
  --fg-0: #eeeeee;
  --fg-2: #4d6354;
  --x-line-fine: #333333;
  --x-line-mid: #555555;
}
`;

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof DsEdgeError ? err.code : String(err);
  }
};

async function project() {
  const p = await makeProject({ tokensCss: CSS });
  return { p, edges: createDsEdges(p.engine, { changedRanges: () => [] }) };
}
const model = (p: Awaited<ReturnType<typeof makeProject>>) =>
  buildBoardModel(p.designRoot, p.engine.systems()[0]);
const dsPending = (p: Awaited<ReturnType<typeof makeProject>>) =>
  (p.meta(`${DS_PATH}/design-system.tsx`).dsPending ?? {}) as {
    tokens?: Record<string, Record<string, unknown>>;
  };

describe('fix-contrast', () => {
  test('plans only the mode that fails, and says what it would write', async () => {
    const { p, edges } = await project();
    const plan = edges.planFix(DS, '--fg-2');
    expect(plan.fixes.map((f) => f.theme)).toEqual(['dark']);
    expect(plan.fixes[0].direction).toBe('lighten');
    expect(plan.fixes[0].ratio).toBeGreaterThanOrEqual(4.5);
    expect(dsPending(p).tokens).toBeUndefined(); // a plan writes nothing
  });

  test('writes ONE waiting edit; with it in, the pair clears in the mode that failed and nothing else moved', async () => {
    const { p, edges } = await project();
    const before = model(p);
    expect(contrastOf('--fg-2', themeValuesOf(before, 'dark')).some((r) => r.pass === false)).toBe(
      true
    );

    const r = await edges.fixContrast({ ds: DS, css: '--fg-2', by: PERSON });
    expect(r.fixes.map((f) => f.theme)).toEqual(['dark']);
    expect(r.result.action).toBeTruthy();

    const entry = dsPending(p).tokens?.['--fg-2'] as Record<string, unknown>;
    expect(entry.dark).toBe(r.fixes[0].value);
    expect(entry.light).toBeUndefined(); // Light passed: untouched
    expect(entry.darkFollows).toBe(false); // Dark is set by hand now

    const after = model(p);
    for (const theme of ['light', 'dark'])
      for (const row of contrastOf('--fg-2', themeValuesOf(after, theme)))
        expect(row.pass).toBe(true);
    // the files did not change: nothing reaches a canvas until "Update N canvases"
    expect(p.read(`${DS_PATH}/colors_and_type.css`)).toBe(CSS);
    expect(p.head().head).toBe(p.R0);
  });

  test('what already waits on the token stays (the engine replaces the entry)', async () => {
    const { p, edges } = await project();
    await p.engine.mergePending(DS, {
      tokens: { '--fg-2': { light: '#556a5c', valueNames: { light: 'Šedozelená' } } },
      by: PERSON,
    });
    await edges.fixContrast({ ds: DS, css: '--fg-2', by: PERSON });
    const entry = dsPending(p).tokens?.['--fg-2'] as Record<string, unknown>;
    expect(entry.light).toBe('#556a5c');
    expect(entry.valueNames).toEqual({ light: 'Šedozelená' });
    expect(typeof entry.dark).toBe('string');
  });

  test('a second press has nothing to fix; an unknown token and a bad mode are refused in words', async () => {
    const { edges } = await project();
    await edges.fixContrast({ ds: DS, css: '--fg-2', by: PERSON });
    expect(await code(edges.fixContrast({ ds: DS, css: '--fg-2', by: PERSON }))).toBe(
      'ds-nothing-to-fix'
    );
    expect(await code(edges.fixContrast({ ds: DS, css: '--nope', by: PERSON }))).toBe(
      'ds-unknown-token'
    );
    expect(
      await code(edges.fixContrast({ ds: DS, css: '--fg-2', theme: 'sepia', by: PERSON }))
    ).toBe('ds-edge-invalid');
    expect(await code(edges.fixContrast({ ds: 'nope', css: '--fg-2', by: PERSON }))).toBe(
      'ds-unknown-system'
    );
  });

  test('Dark follows Light: fixing the Light value moves Dark with it', async () => {
    const light = CSS.replace('--fg-2: #5a6b60;', '--fg-2: #9aa89f;').replace(
      '--fg-2: #4d6354;',
      '--fg-2: #d6e0d9;'
    );
    const p = await makeProject({ tokensCss: light });
    const edges = createDsEdges(p.engine, { changedRanges: () => [] });
    const r = await edges.fixContrast({ ds: DS, css: '--fg-2', by: PERSON });
    expect(r.fixes.map((f) => f.theme)).toEqual(['light']);
    const entry = dsPending(p).tokens?.['--fg-2'] as Record<string, unknown>;
    expect(typeof entry.dark).toBe('string'); // followed
    expect(entry.darkFollows).toBeUndefined();
  });
});

describe('nearest (the trash sheet, the suggestion)', () => {
  test('a token to the trash: its closest colour, how many canvases use it, and whether it can go', async () => {
    const { edges } = await project();
    const r = edges.replacementFor(DS, '--x-line-fine', 40);
    expect(r).toMatchObject({
      format: 'maude.ds-edge',
      edge: 'trash',
      css: '--x-line-fine',
      used: 40,
      trashable: true,
      reason: null,
    });
    expect(r.replacement?.css).toBe('--x-line-mid');
    expect(r.replacement?.label).toBeTruthy();
  });

  test('a Tier-1 role is shown but cannot go to the trash', async () => {
    const { edges } = await project();
    const r = edges.replacementFor(DS, '--fg-2', null);
    expect(r.trashable).toBe(false);
    expect(r.reason).toBe('tier-1');
  });

  test('the suggestion for a hand-picked blue is Accent', async () => {
    const { edges } = await project();
    const r = edges.suggestFor(DS, '#3b6fe0');
    expect(r.nearest?.css).toBe('--accent');
    expect(r.nearest?.exact).toBe(false);
    expect(edges.suggestFor(DS, 'linear-gradient(red, blue)').nearest).toBeNull();
  });
});

describe('add-colour', () => {
  test('"Add it to the system" is a waiting add: both modes, a name, nothing published', async () => {
    const { p, edges } = await project();
    const r = await edges.addColour({ ds: DS, value: '#3b6fe0', label: 'Badge blue', by: PERSON });
    expect(r.css).toBe('--x-badge-blue');
    expect(r.label).toBe('Badge blue');
    const entry = dsPending(p).tokens?.['--x-badge-blue'] as Record<string, unknown>;
    expect(entry.light).toBe('#3b6fe0');
    expect(entry.dark).toBe('#3b6fe0');
    expect(entry.add).toMatchObject({ type: 'color', label: 'Badge blue' });
    expect(p.head().head).toBe(p.R0);
    const m = model(p);
    expect(m.tokens.find((t) => t.css === '--x-badge-blue')?.pending?.added).toBe(true);
  });

  test('a name that is taken gets the next free number; a given name must be an --x- name', async () => {
    const { edges } = await project();
    const a = await edges.addColour({ ds: DS, value: '#3b6fe0', label: 'Badge blue', by: PERSON });
    const b = await edges.addColour({ ds: DS, value: '#3b6fe1', label: 'Badge blue', by: PERSON });
    expect([a.css, b.css]).toEqual(['--x-badge-blue', '--x-badge-blue-2']);
    expect(
      await code(edges.addColour({ ds: DS, value: '#fff', css: '--accent', by: PERSON }))
    ).toBe('ds-edge-invalid');
    expect(await code(edges.addColour({ ds: DS, value: 'not a colour', by: PERSON }))).toBe(
      'ds-edge-invalid'
    );
  });
});

const CANVAS = `import { DesignCanvas, DCSection, DCArtboard } from '@maude/canvas-lib';
export default () => (
  <DesignCanvas>
    <DCSection id="s" title="S">
      <DCArtboard id="a" label="Pricing" width={400} height={300}>
        <div data-cd-id="badge" style={{ background: '#3b6fe0' }}>Save two months</div>
        <p data-cd-id="plain">Plain</p>
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);
`;

describe('off-system (S10 Q12: a rule on the changed lines)', () => {
  async function withCanvas(ranges: { file: string; from: number; to: number }[]) {
    const p = await makeProject({ tokensCss: CSS });
    p.write('ui/Pricing.tsx', CANVAS);
    p.write('ui/Pricing.meta.json', `${JSON.stringify({ title: 'Pricing', designSystem: DS })}\n`);
    return createDsEdges(p.engine, { changedRanges: () => ranges });
  }

  test('a literal colour on a changed line: the nearest system colour and the element that carries it', async () => {
    const edges = await withCanvas([{ file: 'ui/Pricing.tsx', from: 1, to: 100 }]);
    const r = edges.offSystem('ui/Pricing.tsx');
    expect(r.system).toBe(DS);
    expect(r.findings.length).toBe(1);
    const f = r.findings[0];
    expect(f.literal).toBe('#3b6fe0');
    expect(f.nearest?.css).toBe('--accent');
    expect(f.target).toEqual({ artboard: 'a', element: 'badge' });
    expect(f.line).toBe(6);
  });

  test('a literal that was not touched this time says nothing', async () => {
    const edges = await withCanvas([{ file: 'ui/Pricing.tsx', from: 1, to: 3 }]);
    expect(edges.offSystem('ui/Pricing.tsx').findings).toEqual([]);
    const none = await withCanvas([]);
    expect(none.offSystem('ui/Pricing.tsx').findings).toEqual([]);
  });

  test('a canvas of no design system, and a system file, have no question', async () => {
    const edges = await withCanvas([{ file: 'ui/Pricing.tsx', from: 1, to: 100 }]);
    expect(edges.offSystem(`${DS_PATH}/design-system.tsx`).findings).toEqual([]);
    expect(code(Promise.resolve().then(() => edges.offSystem('ui/Nope.tsx')))).resolves.toBe(
      'ds-not-in-system'
    );
  });
});

describe('gitChangedRanges (what "changed" means)', () => {
  test('lines that differ from the last commit; a new file is all changed; no git says nothing', async () => {
    const p = await makeProject({ tokensCss: CSS });
    p.write('ui/Pricing.tsx', CANVAS);
    const git = (...a: string[]) =>
      execFileSync('git', ['-C', p.root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], {
        stdio: 'pipe',
      });
    expect(gitChangedRanges(p.root, 'ui/Pricing.tsx', '.design')).toEqual([]); // not a repo
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'x');
    expect(gitChangedRanges(p.root, 'ui/Pricing.tsx', '.design')).toEqual([]); // nothing changed
    p.write('ui/Pricing.tsx', CANVAS.replace('Plain', 'Plain!'));
    expect(gitChangedRanges(p.root, 'ui/Pricing.tsx', '.design')).toEqual([
      { file: 'ui/Pricing.tsx', from: 7, to: 7 },
    ]);
    p.write('ui/New.tsx', CANVAS);
    expect(gitChangedRanges(p.root, 'ui/New.tsx', '.design')).toEqual([
      { file: 'ui/New.tsx', from: 1, to: 1_000_000 },
    ]);
  });
});

describe('the verbs (the agent path of the three registry actions)', () => {
  test("fix-contrast, add-colour, nearest, off-system parse into the routes' input", () => {
    expect(
      planDsVerb(['fix-contrast', 'acme', '--fg-2', '--theme', 'dark', '--dry-run'])
    ).toMatchObject({
      op: 'fix-contrast',
      input: { ds: 'acme', css: '--fg-2', theme: 'dark', dryRun: true },
      read: true,
    });
    expect(planDsVerb(['fix-contrast', 'acme', '--fg-2'])).toMatchObject({ read: false });
    expect(planDsVerb(['add-colour', 'acme', '#3b6fe0', '--label', 'Badge blue'])).toMatchObject({
      op: 'add-colour',
      input: { ds: 'acme', value: '#3b6fe0', label: 'Badge blue' },
      read: false,
    });
    expect(planDsVerb(['nearest', 'acme', '--x-line-fine'])).toMatchObject({
      op: 'nearest',
      input: { ds: 'acme', css: '--x-line-fine' },
      read: true,
    });
    expect(planDsVerb(['nearest', 'acme', '--value', '#3b6fe0'])).toMatchObject({
      input: { ds: 'acme', value: '#3b6fe0' },
    });
    expect(planDsVerb(['off-system', '.design/ui/Pricing.tsx'])).toMatchObject({
      op: 'off-system',
      input: { canvas: 'ui/Pricing.tsx' },
      read: true,
    });
  });
});
