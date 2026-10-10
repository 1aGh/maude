// V2-2.15 (V2-1.13 §5.10): the system half of Bring-up — mechanical plan, span edits, and the
// invariants V1/V2/V3/V8 refusing a bad plan.
import { describe, expect, test } from 'bun:test';
import { checkSystem } from '../ds/check.ts';
import { indexRegistry, loadRegistry } from '../ds/registry.ts';
import { loadSystem } from '../ds/system.ts';
import {
  applySystemPlan,
  mergeJudged,
  modelWithCss,
  planMechanical,
  validatePlan,
  validateResult,
} from '../ds/upgrade.ts';
import { conformantFiles, fixtureConfig, memFs } from './_ds-fixture.ts';

const idx = indexRegistry(loadRegistry());
const cfg = fixtureConfig();
const CSS = cfg.tokensCssRel;

// A legacy system: no .ds scope, native names, one functional role missing.
const legacy = (() => {
  const f = conformantFiles();
  f[CSS] = f[CSS]
    .replace(/,\n\.ds\[data-theme="[a-z]+"\]/g, '')
    .replace(/(\n {2})--weight-semibold: ([^;]*);/, '$1--w-semibold: $2;')
    .replace(/(\n {2})--accent-soft: ([^;]*);/g, '$1--accent-muted: $2; /* chip bg */')
    .replace(/\n {2}--scrim: [^;]*;/g, '')
    .replace('--bg-0:', '--spark: oklch(0.6 0.2 36);\n  --bg-0:');
  return f;
})();
const fs = memFs(legacy);
const model = loadSystem(fs, cfg);
const scrim = {
  id: 'role:--scrim',
  kind: 'add-role' as const,
  status: 'judged' as const,
  values: {
    light: 'color-mix(in oklch, var(--fg-0) 40%, transparent)',
    dark: 'color-mix(in oklch, var(--bg-0) 60%, transparent)',
  },
};

describe('ds-upgrade (system half)', () => {
  test('the mechanical plan names scope, aliases, own prefixes; new roles need judgement', () => {
    const plan = planMechanical(model, idx);
    const byId = Object.fromEntries(plan.items.map((i) => [i.id, i.status]));
    expect(byId).toMatchObject({
      scope: 'mechanical',
      'alias:--w-semibold': 'mechanical',
      'alias:--accent-muted': 'mechanical',
      'own:--spark': 'mechanical',
      'role:--scrim': 'needs-judgement',
      manifests: 'mechanical',
    });
  });

  test('V8: a needs-judgement item refuses the plan', () => {
    const plan = planMechanical(model, idx);
    expect(validatePlan(model, idx, plan).map((r) => r.invariant)).toContain('V8');
  });

  test('a judged plan applies, keeps every old declaration (V1/V2) and the system checks clean', () => {
    const plan = mergeJudged(planMechanical(model, idx), [scrim]);
    expect(validatePlan(model, idx, plan)).toEqual([]);
    const css = applySystemPlan(model, plan);
    const after = modelWithCss(fs, cfg, css);
    expect(validateResult(model, after, plan)).toEqual([]);
    expect(css).toContain('--accent-muted: var(--accent-soft); /* chip bg */');
    expect(css).toContain('--spark: var(--x-spark);');
    const r = checkSystem(after, idx);
    expect(r.reasons).toEqual(['manifest-stale']); // tokens.json was emitted before the upgrade
    // stripping the scope selectors gives the original selector text back byte-for-byte
    const stripped = css.replace(/,\n[ \t]*\.ds\[data-theme="[a-z0-9-]+"\]/g, '');
    expect(stripped.split('{')[0]).toBe(legacy[CSS].split('{')[0]);
  });

  test('V3: a new colour that is a literal (a new hue) is refused', () => {
    const bad = { ...scrim, values: { light: 'oklch(0 0 0 / 0.5)', dark: 'var(--bg-0)' } };
    const plan = mergeJudged(planMechanical(model, idx), [bad]);
    expect(validatePlan(model, idx, plan).map((r) => r.invariant)).toEqual(['V3']);
  });

  test('V1: a result that changes an existing value is refused', () => {
    const plan = mergeJudged(planMechanical(model, idx), [scrim]);
    const css = applySystemPlan(model, plan).replace(/--bg-1: [^;]*;/, '--bg-1: oklch(0.5 0 0);');
    expect(
      validateResult(model, modelWithCss(fs, cfg, css), plan).map((r) => r.invariant)
    ).toContain('V1');
  });

  test('V2: dropping the native alias line is refused', () => {
    const plan = mergeJudged(planMechanical(model, idx), [scrim]);
    const css = applySystemPlan(model, plan).replace(
      /\n {2}--w-semibold: var\(--weight-semibold\);/,
      ''
    );
    expect(
      validateResult(model, modelWithCss(fs, cfg, css), plan).map((r) => r.invariant)
    ).toContain('V2');
  });

  test('a selector named inside a comment is never edited', () => {
    const f = {
      ...legacy,
      [CSS]: `/* applies at :root and .fx[data-theme="light"] */\n${legacy[CSS]}`,
    };
    const m = loadSystem(memFs(f), cfg);
    const css = applySystemPlan(m, mergeJudged(planMechanical(m, idx), [scrim]));
    expect(css.split('\n')[0]).toBe('/* applies at :root and .fx[data-theme="light"] */');
  });
});
