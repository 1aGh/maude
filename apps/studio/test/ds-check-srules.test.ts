// V2-2.15 (V2-1.13 §5.7, §7): one fixture per S-rule kind with its exemptions, change-scoped
// mode, mechanical fixes (byte-minimal, idempotent, ids kept) and the --hook contract.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkCanvas, colourLiterals, fixCanvas } from '../ds/canvas-check.ts';
import { canvasContext } from '../ds/canvas-cli.ts';
import { loadProject, runDsCheck } from '../ds/cli.ts';
import { conformantFiles, fixtureConfig } from './_ds-fixture.ts';

const root = mkdtempSync(join(tmpdir(), 'ds-srules-'));
const D = join(root, '.design');
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(D, rel)), { recursive: true });
  writeFileSync(join(D, rel), text);
};
for (const [rel, text] of Object.entries(conformantFiles())) put(rel, text);
// a second system, so "foreign" names exist
for (const [rel, text] of Object.entries(
  conformantFiles(
    fixtureConfig({
      name: 'other',
      path: 'system/other',
      tokensCssRel: 'system/other/colors_and_type.css',
      rootClass: 'other',
    })
  )
))
  put(rel, text.replace('--bg-0:', '--other-only: 1px;\n  --bg-0:'));
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
      {
        name: 'other',
        path: 'system/other',
        rootClass: 'other',
        themes: ['light', 'dark'],
        themeDefault: 'light',
      },
    ],
    activeFamilies: ['accent', 'status', 'presence'],
    colorSpace: 'oklch', // the fixture manifests were emitted with it
  })
);
put('system/fx/preview/_kit.tsx', 'export const Kit = () => null;\n');
put('ui/_kit.css', '.k { --k-gap: 4px; }\n');
const meta = (ds = 'fx', extra: Record<string, unknown> = {}) =>
  JSON.stringify({ designSystem: ds, ...extra });

function canvas(name: string, tsx: string, css?: string, m: string | null = meta()) {
  put(`ui/${name}.tsx`, tsx);
  if (css !== undefined) put(`ui/${name}.css`, css);
  if (m !== null) put(`ui/${name}.meta.json`, m);
  return `ui/${name}.tsx`;
}
const run = (rel: string, strict = false) =>
  checkCanvas(canvasContext(loadProject(root, {})), rel, { strict });
const kinds = (rel: string, strict = false) =>
  run(rel, strict).findings.map((f) => `${f.rule}:${f.kind}`);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('S-rules', () => {
  test('a clean canvas is switchable', () => {
    const c = canvas(
      'clean',
      'export default () => <div className="ds" style={{ color: "var(--fg-0)", padding: "var(--space-2)" }} />;\n'
    );
    const r = run(c);
    expect(r.findings).toEqual([]);
    expect(r.state).toBe('switchable');
  });

  test('S1 colour literal (CSS, style, fill) — and its exemptions', () => {
    const c = canvas(
      's1',
      [
        'export default () => (<div>',
        '  <svg><rect fill="#ff0000" /></svg>',
        '  <p style={{ background: "rgb(1, 2, 3)" }} />',
        '  <p style={{ background: "color-mix(in oklch, var(--accent) 10%, var(--bg-1))" }} />',
        '  <div data-ds-exempt="S1"><p style={{ color: "red" }} /></div>',
        '</div>);',
      ].join('\n'),
      '.a { color: white; border-color: transparent; }\n.root { --c-brand: #123456; }\n'
    );
    const r = run(c);
    expect(
      r.findings
        .filter((f) => f.rule === 'S1')
        .map((f) => f.name)
        .sort()
    ).toEqual(['#ff0000', 'rgb(1, 2, 3)', 'white']);
    expect(r.pins['local-palette']).toBeUndefined(); // declared but unused
    expect(r.state).toBe('review');
    expect(kinds(c, true).filter((k) => k === 'S1:literal').length).toBe(3);
    expect(run(c, true).state).toBe('review'); // strict makes S1 a blocker finding; state stays review (a pin)
    expect(run(c, true).findings.find((f) => f.rule === 'S1')?.severity).toBe('blocker');
  });

  test('colourLiterals: var() inside a colour function is not a literal', () => {
    expect(colourLiterals('color-mix(in oklch, var(--a) 14%, transparent)')).toEqual([]);
    expect(colourLiterals('oklch(0.5 0.1 250 / 0.2)').map((x) => x.text)).toEqual([
      'oklch(0.5 0.1 250 / 0.2)',
    ]);
    expect(colourLiterals('"Red Hat Display", sans-serif')).toEqual([]);
  });

  test('S2: Tier 1 and locals ok; alias autofix; foreign + undefined block; the imported _kit.css is a source', () => {
    const c = canvas(
      's2',
      'import "./_kit.css";\nexport default () => <div style={{ gap: "var(--k-gap)", color: "var(--w-semibold)", margin: "var(--other-only)", top: "var(--nope)" }} />;\n'
    );
    const r = run(c);
    expect(r.findings.filter((f) => f.rule === 'S2').map((f) => `${f.kind}:${f.name}`)).toEqual([
      'alias:--w-semibold',
      'foreign:--other-only',
      'undefined:--nope',
    ]);
    expect(r.findings.find((f) => f.kind === 'alias')?.fix).toBe('--weight-semibold');
    expect(r.state).toBe('blocked');
  });

  test('S3 / S4 literals; .t-* and token-built values exempt', () => {
    const c = canvas(
      's34',
      'export default () => <p className="t-body" style={{ fontSize: "13px" }} />;\n',
      '.a { font-size: 13px; padding: 0 var(--space-1); margin: 7px; gap: calc(var(--space-1) * 2); }\n'
    );
    expect(kinds(c).sort()).toEqual(['S3:literal', 'S4:literal']);
  });

  test('S5: own css autofix, kit module + other system block', () => {
    const c = canvas(
      's5',
      'import "../system/fx/colors_and_type.css";\nimport { Kit } from "../system/fx/preview/_kit";\nimport "../system/other/colors_and_type.css";\nexport default () => <Kit />;\n'
    );
    expect(kinds(c)).toEqual(['S5:own-css', 'S5:kit-module', 'S5:other-system']);
    expect(run(c).state).toBe('blocked');
  });

  test('S6 wrapper, S8 fonts, S9 meta', () => {
    const c6 = canvas(
      's6',
      'export default () => <div className="fx shell" data-theme="dark" />;\n'
    );
    expect(kinds(c6)).toEqual(['S6:wrapper']);
    const c8 = canvas(
      's8',
      'export default () => <p />;\n',
      '@font-face { font-family: X; src: url(x.woff2); }\n.a { font-family: "Comic Sans", sans-serif; }\n'
    );
    expect(kinds(c8)).toEqual(['S8:font', 'S3:literal', 'S8:font']);
    const c9 = canvas('s9', 'export default () => <p />;\n', undefined, null);
    expect(kinds(c9)).toEqual(['S9:meta']);
    expect(run(c9).state).toBe('blocked');
    const c9b = canvas('s9b', 'export default () => <p />;\n', undefined, meta('nope'));
    expect(kinds(c9b)).toEqual(['S9:meta']);
  });

  test('pinned: meta.dsPinned or opt_out_scope full', () => {
    const c = canvas(
      'pinned',
      'export default () => <p style={{ color: "red" }} />;\n',
      undefined,
      meta('fx', { dsPinned: true })
    );
    expect(run(c).state).toBe('pinned');
  });

  test('--changed reports findings on the changed lines only', () => {
    const c = canvas(
      'changed',
      'export default () => (<div>\n  <p style={{ color: "red" }} />\n  <p style={{ color: "blue" }} />\n</div>);\n'
    );
    const all = JSON.parse(
      runDsCheck(['--canvas', `.design/${c}`, '--json', '--root', root], {}).stdout
    );
    expect(all.canvases[0].findings.length).toBe(2);
    const scoped = JSON.parse(
      runDsCheck(['--changed', `.design/${c}:3-3`, '--json', '--root', root], {}).stdout
    );
    expect(scoped.canvases[0].findings.map((f: { name: string }) => f.name)).toEqual(['blue']);
  });

  test('exit codes: 12 for a blocked canvas, 0 otherwise', () => {
    expect(runDsCheck(['--canvas', '.design/ui/s5.tsx', '--root', root], {}).code).toBe(12);
    expect(runDsCheck(['--canvas', '.design/ui/clean.tsx', '--root', root], {}).code).toBe(0);
  });
});

describe('--fix=mechanical', () => {
  test('alias, own-css and wrapper fixes are byte-minimal, idempotent and keep ids', () => {
    const src =
      'import "../system/fx/preview/_components.css";\nexport default () => <div id="hero" data-cd-id="x1" className="fx" data-theme="light" style={{ color: "var(--w-medium)" }} />;\n';
    const c = canvas('fix', src, '.a { font-weight: var(--w-semibold); }\n');
    const dry = runDsCheck(
      ['--fix=mechanical', '--dry-run', '--canvas', `.design/${c}`, '--root', root],
      {}
    );
    expect(dry.stdout).toContain('would fix');
    expect(readFileSync(join(D, c), 'utf8')).toBe(src);
    runDsCheck(['--fix=mechanical', '--canvas', `.design/${c}`, '--root', root], {});
    const after = readFileSync(join(D, c), 'utf8');
    expect(after).toBe(
      'export default () => <div id="hero" data-cd-id="x1" className="ds" data-theme="light" style={{ color: "var(--weight-medium)" }} />;\n'
    );
    expect(readFileSync(join(D, 'ui/fix.css'), 'utf8')).toBe(
      '.a { font-weight: var(--weight-semibold); }\n'
    );
    const again = runDsCheck(['--fix=mechanical', '--canvas', `.design/${c}`, '--root', root], {});
    expect(again.stdout).toContain('nothing to fix');
    const ctx = canvasContext(loadProject(root, {}));
    expect(fixCanvas(ctx, checkCanvas(ctx, c)).size).toBe(0);
  });
});

describe('--hook', () => {
  test('always exit 0, valid hook JSON from stdin input, within budget', () => {
    const t0 = performance.now();
    const r = runDsCheck(
      ['--hook', '--root', root],
      {},
      JSON.stringify({ tool_input: { file_path: join(D, 'ui/s5.tsx') } })
    );
    const ms = performance.now() - t0;
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(j.hookSpecificOutput.additionalContext).toContain('S5 kit-module');
    expect(ms).toBeLessThan(1500);
    expect(
      runDsCheck(
        ['--hook', '--root', root],
        {},
        JSON.stringify({ tool_input: { file_path: join(D, 'ui/clean.tsx') } })
      ).stdout
    ).toBe('');
    expect(runDsCheck(['--hook', '--root', root], {}, 'not json').code).toBe(0);
  });

  test('an edit to a system tokens file reports the system level', () => {
    const r = runDsCheck(
      ['--hook', '--root', root],
      {},
      JSON.stringify({ tool_input: { file_path: join(D, 'system/fx/colors_and_type.css') } })
    );
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain(
      'ds-check fx: conformant (0)'
    );
  });

  test('config.schemaLint: off silences it', () => {
    const cfg = JSON.parse(readFileSync(join(D, 'config.json'), 'utf8'));
    put('config.json', JSON.stringify({ ...cfg, schemaLint: 'off' }));
    const r = runDsCheck(
      ['--hook', '--root', root],
      {},
      JSON.stringify({ tool_input: { file_path: join(D, 'ui/s5.tsx') } })
    );
    put('config.json', JSON.stringify(cfg));
    expect(r.stdout).toBe('');
  });
});

describe('--hook on an Edit', () => {
  test('lints only the lines the edit wrote (legacy debt elsewhere stays out of the context)', () => {
    const added = '  <p style={{ color: "#ff3366" }} />';
    const c = canvas(
      'hook-edit',
      `export default () => (<div>\n  <p style={{ color: "red" }} />\n${added}\n</div>);\n`
    );
    const input = {
      tool_name: 'Edit',
      tool_input: { file_path: join(D, c), old_string: 'x', new_string: added },
    };
    const r = runDsCheck(['--hook', '--root', root], {}, JSON.stringify(input));
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain('#ff3366');
    expect(ctx).not.toContain('S1 literal red');
  });
});
