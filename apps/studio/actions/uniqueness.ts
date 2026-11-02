// actions/uniqueness.ts — invariant 1 (V2-1.3 contract §5.11): per layer, at most one live binding
// per chord and press for EVERY context. Checked exactly, not by sampling: for each chord only the
// context dimensions its bindings' predicates mention can change the outcome, so the lattice is
// the product of those dimensions alone (focus is always enumerated — the resolver itself reads
// it). Pure; used by the uniqueness test and `scripts/gen-actions.mjs --check`.

import { indexKeys, resolveChord } from './resolve.ts';
import type {
  ActionDef,
  Chord,
  Fact,
  Focus,
  KeyCtx,
  Mode,
  Pred,
  Role,
  SelKind,
  Shell,
} from './types.ts';

export const ROLES: readonly Role[] = ['view', 'comment', 'edit', 'owner'];
export const SHELLS: readonly Shell[] = ['desktop', 'browser', 'cloud', 'viewer', 'embed', 'home'];
export const MODES: readonly Mode[] = ['edit', 'preview', 'present', 'viewing'];
export const FOCI: readonly Focus[] = ['text', 'timeline', 'canvas', 'chrome', 'modal'];
export const SELECTIONS: readonly SelKind[] = [
  'none',
  'artboard',
  'object',
  'annotation',
  'video-artboard',
  'generated-image',
  'clip',
];

interface Dims {
  role: boolean;
  shell: boolean;
  mode: boolean;
  selection: boolean;
  facts: Set<Fact>;
}

function collect(p: Pred | undefined, d: Dims): void {
  if (!p) return;
  if (p.minRole) d.role = true;
  if (p.shell || p.notShell) d.shell = true;
  if (p.mode) d.mode = true;
  if (p.selection) d.selection = true;
  for (const f of p.facts ?? []) d.facts.add(f);
  for (const f of p.notFacts ?? []) d.facts.add(f);
  for (const q of p.any ?? []) collect(q, d);
}

function subsets<T>(items: readonly T[]): T[][] {
  const out: T[][] = [[]];
  for (const it of items) for (const s of out.slice()) out.push([...s, it]);
  return out;
}

export interface Ambiguity {
  chord: Chord;
  press: 'tap' | 'hold';
  layer: string;
  ids: string[];
  /** One context that shows it. */
  example: KeyCtx;
}

/** Every (chord, press, layer) where two bindings are live at once in some context. */
export function findAmbiguities(actions: readonly ActionDef[]): Ambiguity[] {
  const index = indexKeys(actions);
  const found = new Map<string, Ambiguity>();
  for (const [ch, bound] of index) {
    for (const press of ['tap', 'hold'] as const) {
      const group = bound.filter((b) => (press === 'hold') === !!b.binding.hold);
      if (group.length < 2) continue;
      const d: Dims = {
        role: false,
        shell: false,
        mode: false,
        selection: false,
        facts: new Set(),
      };
      for (const b of group) {
        collect(b.action.visible, d);
        collect(b.binding.when, d);
      }
      const roles = d.role ? ROLES : (['owner'] as const);
      const shells = d.shell ? SHELLS : (['browser'] as const);
      const modes = d.mode ? MODES : (['edit'] as const);
      const sels = d.selection ? SELECTIONS : (['none'] as const);
      const factSets = subsets([...d.facts]);
      const only = new Map([[ch, group]]);
      for (const role of roles)
        for (const shell of shells)
          for (const mode of modes)
            for (const focus of FOCI)
              for (const selection of sels)
                for (const fs of factSets) {
                  const ctx: KeyCtx = { role, shell, mode, focus, selection, facts: new Set(fs) };
                  const r = resolveChord(only, ch, ctx, press);
                  if (!r?.ambiguous.length) continue;
                  const key = `${ch} ${press} @${r.binding.layer}`;
                  const prev = found.get(key);
                  const ids = new Set(prev?.ids ?? []);
                  ids.add(r.action.id);
                  for (const a of r.ambiguous) ids.add(a.action.id);
                  found.set(key, {
                    chord: ch,
                    press,
                    layer: r.binding.layer,
                    ids: [...ids].sort(),
                    example: prev?.example ?? ctx,
                  });
                }
    }
  }
  return [...found.values()];
}
