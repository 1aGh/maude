// V2-2.8 S4 / V2-2.4b — every `maude` verb has a permission tier (contract V2-1.11 §5.3, §5.5).
//
// The AI chat's allow list is generated from `apps/studio/actions/verbs.ts`: one
// `Bash(maude design <verb>:*)` per auto-tier verb (effect `none` / `project`), plus the closed
// top-level read rules. These tests pin three things:
//   1. coverage — every verb `maude design` dispatches (BIN_VERBS ∪ SUBCOMMANDS in
//      cli/commands/design.mjs) and every top-level `maude` command is classified, so a new verb
//      can't land without a deliberate tier;
//   2. the bridge's allow list IS the generated list (no hand-kept second copy);
//   3. the tier rule — auto iff effect is `none`/`project` and the verb is not held.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAUDE_DEFAULT_ALLOWED_TOOLS } from '../acp/bridge.ts';
import { autoAllowRules, MAUDE_VERBS, verbTier } from '../actions/verbs.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');

/** The string members of `const <name> = new Set([ … ])` in a source file. */
function setLiteral(src: string, name: string): string[] {
  const m = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(src);
  if (!m) throw new Error(`no Set literal ${name}`);
  const body = (m[1] as string).replace(/\/\/.*$/gm, '');
  return [...body.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((x) => x[1] as string);
}

describe('maude verb tiers — coverage', () => {
  const design = readFileSync(join(ROOT, 'cli/commands/design.mjs'), 'utf8');
  const designVerbs = new Set([
    ...setLiteral(design, 'BIN_VERBS'),
    ...setLiteral(design, 'SUBCOMMANDS'),
  ]);
  const top = readFileSync(join(ROOT, 'cli/bin/maude.mjs'), 'utf8');
  const commands = /const COMMANDS = \{([\s\S]*?)\n\};/.exec(top)?.[1] ?? '';
  const topVerbs = [...commands.matchAll(/^\s*'?([a-z][a-z0-9-]*)'?:/gm)].map((x) => x[1]);

  test('every `maude design` verb has exactly one tier entry', () => {
    const tiered = MAUDE_VERBS.filter((v) => v.scope === 'design').map((v) => v.verb);
    expect(new Set(tiered).size).toBe(tiered.length);
    expect([...designVerbs].filter((v) => !tiered.includes(v))).toEqual([]);
    expect(tiered.filter((v) => !designVerbs.has(v))).toEqual([]);
  });

  test('every top-level `maude` command is classified (whole, or per sub-verb)', () => {
    expect(topVerbs.length).toBeGreaterThan(10);
    const tiered = MAUDE_VERBS.filter((v) => v.scope === 'top').map((v) => v.verb.split(' ')[0]);
    expect(topVerbs.filter((v) => v !== 'design' && !tiered.includes(v as string))).toEqual([]);
  });
});

describe('maude verb tiers — the generated allow list', () => {
  test('the bridge allow list carries exactly the generated rules', () => {
    const bash = MAUDE_DEFAULT_ALLOWED_TOOLS.filter((t) => t.startsWith('Bash'));
    expect(bash).toEqual(autoAllowRules());
  });

  test('the allow list equals the manifest’s auto verbs (§5.5)', () => {
    const m = JSON.parse(readFileSync(join(ROOT, 'apps/studio/actions.manifest.json'), 'utf8')) as {
      verbs: { verb: string; tier: string }[];
    };
    const fromManifest = m.verbs
      .filter((v) => v.tier === 'auto')
      .map((v) => `Bash(maude ${v.verb}:*)`);
    expect(MAUDE_DEFAULT_ALLOWED_TOOLS.filter((t) => t.startsWith('Bash'))).toEqual(fromManifest);
  });

  test('auto iff effect none/project and not held; prompt for the rest; human stays human', () => {
    for (const v of MAUDE_VERBS) {
      const want =
        v.effect === 'human'
          ? 'human'
          : (v.effect === 'none' || v.effect === 'project') && !v.hold
            ? 'auto'
            : 'prompt';
      expect({ verb: v.verb, tier: verbTier(v) }).toEqual({ verb: v.verb, tier: want });
    }
  });

  test('a rule per auto verb and none for any other', () => {
    const rules = autoAllowRules();
    for (const v of MAUDE_VERBS) {
      const rule = `Bash(maude ${v.scope === 'design' ? 'design ' : ''}${v.verb}:*)`;
      expect({ rule, present: rules.includes(rule) }).toEqual({
        rule,
        present: verbTier(v) === 'auto',
      });
    }
  });

  test('no auto rule is a raw string prefix of a non-auto verb (export → export-cloud)', () => {
    // Belt and braces in case the CLI's prefix match ever ignores the word boundary.
    const rules = autoAllowRules().map((r) => r.slice('Bash('.length, -':*)'.length));
    for (const v of MAUDE_VERBS.filter((x) => verbTier(x) !== 'auto')) {
      const cmd = `maude ${v.scope === 'design' ? 'design ' : ''}${v.verb}`;
      expect({ cmd, hit: rules.find((p) => cmd.startsWith(p)) }).toEqual({ cmd, hit: undefined });
    }
  });

  test('the security-relevant verbs are pinned to prompt or human', () => {
    const tier = (verb: string) => {
      const v = MAUDE_VERBS.find((x) => x.verb === verb);
      if (!v) throw new Error(`unclassified ${verb}`);
      return verbTier(v);
    };
    for (const v of ['curl-local', 'generate', 'draw-build', 'to-lottie', 'fetch-asset']) {
      expect({ v, t: tier(v) }).toEqual({ v, t: 'prompt' });
    }
    for (const v of ['link', 'adopt', 'unlink', 'detach', 'hub']) {
      expect({ v, t: tier(v) }).toEqual({ v, t: 'human' });
    }
  });
});
