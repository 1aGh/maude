// sub-verbs.mjs — `maude design <verb> <sub>` forms for verbs whose read-only steps are flags.
//
// The AI chat auto-allows a verb with a prefix rule (`Bash(maude design <verb>:*)`,
// apps/studio/actions/verbs.ts). A prefix rule can't name a step that is a flag AFTER a positional
// (`ds-upgrade <ds> --analyse`), and it can't see what follows it. So a read-only step gets a
// sub-verb (`ds-upgrade analyse <ds>`), the tier table auto-allows exactly that prefix, and this
// module turns it back into the helper's flag form — refusing any step flag after the sub-verb,
// so `ds-upgrade analyse x --apply p.json` can't ride the auto rule into a write.
//
// Lead answer (c), decision:maude/v2-2.4b-held-and-prompting-verbs. Leaf module: no imports.

/** verb → sub-verb → { step: the flag it maps to, plan: whether a plan-file word follows the ds }. */
export const SUB_VERBS = {
  'ds-upgrade': {
    analyse: { step: '--analyse', plan: false },
    plan: { step: '--plan-mechanical', plan: false },
    validate: { step: '--validate', plan: true },
  },
};

const STEP_FLAGS = {
  'ds-upgrade': ['--analyse', '--plan-mechanical', '--validate', '--stage', '--apply'],
};

/** Flags that take a value (so the value isn't read as a positional). */
const VALUE_FLAGS = new Set(['--root']);

/**
 * `rest` = the words after the verb. Returns `{ args }` (what to hand the helper) or
 * `{ error }` (exit 2). Anything that isn't a sub-verb passes through unchanged.
 */
export function subVerbArgs(verb, rest) {
  const map = SUB_VERBS[verb];
  const sub = map && Object.hasOwn(map, rest[0] ?? '') ? map[rest[0]] : null;
  if (!sub) return { args: rest };
  const name = rest[0];
  const steps = STEP_FLAGS[verb] ?? [];
  const positional = [];
  const flags = [];
  const words = rest.slice(1);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const bare = w.split('=')[0];
    if (steps.includes(bare)) {
      return {
        error: `maude design ${verb} ${name}: the sub-verb sets the step — drop ${bare} (use \`maude design ${verb} <ds> ${bare} …\` for another step)`,
      };
    }
    if (w.startsWith('--')) {
      flags.push(w);
      if (VALUE_FLAGS.has(w) && i + 1 < words.length) flags.push(words[++i]);
    } else positional.push(w);
  }
  const want = sub.plan ? 2 : 1;
  if (positional.length !== want) {
    return {
      error: `usage: maude design ${verb} ${name} <ds>${sub.plan ? ' <plan.json>' : ''} [--root <project>]`,
    };
  }
  const [ds, plan] = positional;
  return { args: sub.plan ? [ds, ...flags, sub.step, plan] : [ds, ...flags, sub.step] };
}
