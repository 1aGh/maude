// gate-b-sec2 finding 3 — the S8.10 Handoff to production run is bounded in its Bash maude verbs
// too, not only in Edit/Write (write-scope `outside-run-scope`). Planted attack: a peer-written
// canvas label steers the run to `maude design annotate …` / `read-annotations --root …`, which the
// ordinary chat auto-approves.
//
// Two layers: the bridge auto-approves only the run's own verbs (scopedAllowedTools), and the design
// plugin's pre-bash hook denies the rest (cli/lib/design-hook.mjs HANDOFF_RUN_VERBS — hooks.test.mjs).

import { describe, expect, test } from 'bun:test';

import { HANDOFF_RUN_VERBS as HOOK_VERBS } from '../../../cli/lib/design-hook.mjs';
import {
  MAUDE_DEFAULT_ALLOWED_TOOLS,
  newSessionParams,
  scopedAllowedTools,
} from '../acp/bridge.ts';
import { HANDOFF_RUN_VERBS } from '../handoff/write-scopes.ts';

type Opts = { allowedTools?: string[] };
// The read boundary's `Read(//abs/**)` rules (M2) are the same for a scoped run; this file is about
// the rest of the list.
const toolsOf = (p: ReturnType<typeof newSessionParams>) =>
  (
    ((p._meta?.claudeCode as { options?: Opts } | undefined)?.options?.allowedTools ??
      []) as string[]
  ).filter((t) => !t.startsWith('Read('));

describe('Handoff to production run — maude verbs', () => {
  test('the hook and the studio name the same verbs', () => {
    expect([...HOOK_VERBS]).toEqual([...HANDOFF_RUN_VERBS]);
  });

  test('a scoped run auto-approves only its own maude verbs; the rest of the defaults stay', () => {
    const all = toolsOf(newSessionParams('/p'));
    expect(all).toEqual([...MAUDE_DEFAULT_ALLOWED_TOOLS]);
    expect(all).toContain('Bash(maude design read-annotations:*)');
    const scoped = toolsOf(
      newSessionParams('/p', undefined, undefined, { onlyVerbs: HANDOFF_RUN_VERBS })
    );
    expect(scoped).toEqual(scopedAllowedTools(HANDOFF_RUN_VERBS));
    const bash = scoped.filter((t) => t.startsWith('Bash('));
    for (const t of bash)
      expect(HANDOFF_RUN_VERBS.some((v) => t === `Bash(maude design ${v}:*)`)).toBe(true);
    for (const t of [
      'Bash(maude design read-annotations:*)',
      'Bash(maude design annotate:*)',
      'Bash(maude design trash:*)',
      'Bash(maude design comments:*)',
    ])
      expect(scoped).not.toContain(t);
    // the non-Bash defaults are untouched
    expect(scoped.filter((t) => !t.startsWith('Bash('))).toEqual(
      all.filter((t) => !t.startsWith('Bash('))
    );
  });
});
