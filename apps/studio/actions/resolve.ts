// actions/resolve.ts — predicate evaluation + focus-scoped key resolution (V2-1.3 contract §5.5,
// Gate 0 C26). Pure: no DOM, no React — runs in the shell, the canvas iframe, the server
// (predicate half) and the tests. Works on the full registry (`ActionDef`) and on the slim
// generated canvas keymap (`KeyedAction`) alike.

import { hasCommandMod, TEXT_RESERVED } from './keys.ts';
import {
  type ActionDef,
  type Chord,
  type KeyBinding,
  type KeyCtx,
  type KeyedAction,
  LAYERS,
  type Pred,
  ROLE_RANK,
} from './types.ts';

export function holds(p: Pred | undefined, ctx: KeyCtx): boolean {
  if (!p) return true;
  if (p.minRole && ROLE_RANK[ctx.role] < ROLE_RANK[p.minRole]) return false;
  if (p.shell && !p.shell.includes(ctx.shell)) return false;
  if (p.notShell?.includes(ctx.shell)) return false;
  if (p.mode && !p.mode.includes(ctx.mode)) return false;
  if (p.focus && !p.focus.includes(ctx.focus)) return false;
  if (p.selection && !p.selection.includes(ctx.selection)) return false;
  if (p.facts && !p.facts.every((f) => ctx.facts.has(f))) return false;
  if (p.notFacts?.some((f) => ctx.facts.has(f))) return false;
  if (p.any && !p.any.some((q) => holds(q, ctx))) return false;
  return true;
}

/** Rule 12 — the one visibility test every surface (menus, ⌘K, "?", panels, native) calls. */
export function isVisible(a: Pick<KeyedAction, 'visible'>, ctx: KeyCtx): boolean {
  return holds(a.visible, ctx);
}

/** Visible and not greyed. A disabled action is shown greyed, never hidden. */
export function isEnabled(a: Pick<KeyedAction, 'visible' | 'enabled'>, ctx: KeyCtx): boolean {
  return isVisible(a, ctx) && holds(a.enabled, ctx);
}

export interface Bound<A extends KeyedAction = ActionDef> {
  action: A;
  binding: KeyBinding;
}

export type KeyIndex<A extends KeyedAction = ActionDef> = ReadonlyMap<Chord, readonly Bound<A>[]>;

/** chord → every binding that uses it, in registry order. Build once per registry (and per
 *  document — `keep` narrows it to the bindings one document resolves, see documents.ts). */
export function indexKeys<A extends KeyedAction = ActionDef>(
  actions: readonly A[],
  keep: (action: A, binding: KeyBinding) => boolean = () => true
): KeyIndex<A> {
  const m = new Map<Chord, Bound<A>[]>();
  for (const action of actions)
    for (const binding of action.keys ?? []) {
      if (!keep(action, binding)) continue;
      const list = m.get(binding.chord) ?? [];
      list.push({ action, binding });
      m.set(binding.chord, list);
    }
  return m;
}

/** Does the binding fire while a text field has focus? (§5.5) */
export function bindingInText(b: KeyBinding): boolean {
  return b.inText ?? (hasCommandMod(b.chord) && !TEXT_RESERVED.has(b.chord));
}

/** Is this binding live in this context (press kind aside)? */
export function bindingLive<A extends KeyedAction>(b: Bound<A>, ctx: KeyCtx): boolean {
  if (ctx.focus === 'text' && !bindingInText(b.binding)) return false;
  if (ctx.focus === 'modal' && !b.binding.inModal) return false;
  // Timeline-layer bindings need timeline focus; the other layers are reachable from any focus.
  if (b.binding.layer === 'timeline' && ctx.focus !== 'timeline') return false;
  return isVisible(b.action, ctx) && holds(b.binding.when, ctx);
}

export interface Resolution<A extends KeyedAction = ActionDef> {
  action: A;
  binding: KeyBinding;
  /** Same-layer competitors — must be empty; the uniqueness test enforces it. */
  ambiguous: Bound<A>[];
}

/**
 * C26: focused text field › timeline focus › selection › mode tools › global. The first layer (in
 * LAYERS order) with a live binding wins. Tap and hold never compete. Returns null when the key is
 * not ours (let the browser / the text field have it). A disabled winner still wins — the caller
 * swallows the key without running it (no fall-through to a lower layer).
 */
export function resolveChord<A extends KeyedAction = ActionDef>(
  index: KeyIndex<A>,
  chord: Chord,
  ctx: KeyCtx,
  press: 'tap' | 'hold' = 'tap'
): Resolution<A> | null {
  const candidates = index.get(chord);
  if (!candidates?.length) return null;
  const live = candidates.filter(
    (b) => (press === 'hold') === !!b.binding.hold && bindingLive(b, ctx)
  );
  if (!live.length) return null;
  for (const layer of LAYERS) {
    const here = live.filter((b) => b.binding.layer === layer);
    if (here.length)
      return { action: here[0].action, binding: here[0].binding, ambiguous: here.slice(1) };
  }
  return null;
}

/** An action's primary (first non-alias) binding, if any. */
export function primaryBinding(a: Pick<KeyedAction, 'keys'>): KeyBinding | undefined {
  return a.keys?.find((b) => !b.alias) ?? a.keys?.[0];
}
