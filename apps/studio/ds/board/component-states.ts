// ds/board/component-states.ts — S10.10: what a component master looks like in each state, read from the system's
// own `preview/_components.css` (13 · ds-edit-master, "variants × states × sizes").
//
// A pseudo-class cannot be held on an element, so the board draws a state with a class: every rule that styles a
// master's class in a state (`.btn:hover`, `.btn[disabled]`, `.btn:focus-visible`) is copied with the state swapped
// for `.ds-force-<state>` and scoped to the board (types.ts `boardComponentsCss`). The system's file is never
// changed and a canvas never sees these rules. Pure: text in, small data out.
//
// The copies are rebuilt from parsed declarations, each value checked by `safeCssValue`, so a hostile or odd file
// cannot get more than a plain declaration into the board's <style>.

import { ownDeclarations, scanCssRules, splitSelectorList } from '../css-scan.ts';
import { safeCssValue } from './types.ts';

/** In the order the board draws them. */
export const STATES = ['hover', 'active', 'focus', 'disabled'] as const;
export type MasterState = (typeof STATES)[number];

/** The properties the master editor changes (Corners · Fill · Text · Height). */
export const MASTER_PROPS = ['border-radius', 'background', 'color', 'height'] as const;

const STATE_PATTERNS: ReadonlyArray<readonly [MasterState, RegExp]> = [
  ['hover', /:hover\b/g],
  ['active', /:active\b/g],
  ['focus', /:focus-visible\b|:focus-within\b|:focus\b/g],
  ['disabled', /:disabled\b|\[disabled\]|\[aria-disabled=(?:"true"|true)\]|\.is-disabled\b/g],
];

/** The rule bodies are copied, never the selectors raw: this is the whole vocabulary a selector may use. */
const SAFE_SELECTOR = /^[.\w\s>+~:[\]="'*-]{1,240}$/;
const PROP_RE = /^[a-z][a-z-]{0,48}$/;
const classRe = (cls: string) =>
  new RegExp(`\\.${cls.replace(/[^A-Za-z0-9_-]/g, '')}(?![A-Za-z0-9_-])`);

export interface StateRule {
  /** the selector list, each entry already carrying `.ds-force-<state>` */
  selector: string;
  state: MasterState;
  /** `prop: value` pairs, each checked */
  decls: Array<[string, string]>;
}

const stateOf = (entry: string): MasterState | null => {
  for (const [state, re] of STATE_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(entry)) return state;
  }
  return null;
};

const forced = (entry: string, state: MasterState): string => {
  const [, re] = STATE_PATTERNS.find(([s]) => s === state) as readonly [MasterState, RegExp];
  return entry.replace(re, `.ds-force-${state}`).replace(/\s+/g, ' ').trim();
};

/**
 * The state rules of `classes` (a master's class, its variants and sizes) in `css`, in file order. Only top-level
 * rules count; a state the system styles inside an at-rule is not drawn.
 */
export function stateRulesOf(css: string | null, classes: readonly string[]): StateRule[] {
  if (!css || classes.length === 0) return [];
  const res = classes.filter(Boolean).map(classRe);
  const rules = scanCssRules(css);
  const out: StateRule[] = [];
  rules.forEach((r, i) => {
    if (r.atRule || r.parent !== -1 || r.nestedInAtRule) return;
    const byState = new Map<MasterState, string[]>();
    for (const raw of splitSelectorList(r.selector)) {
      const state = stateOf(raw);
      if (!state || !res.some((re) => re.test(raw))) continue;
      const entry = forced(raw, state);
      if (!SAFE_SELECTOR.test(entry)) continue;
      byState.set(state, [...(byState.get(state) ?? []), entry]);
    }
    if (byState.size === 0) return;
    const decls: Array<[string, string]> = [];
    for (const d of ownDeclarations(css, rules, i)) {
      const value = d.rawValue.replace(/!important\s*$/i, '').trim();
      if (PROP_RE.test(d.prop) && safeCssValue(value)) decls.push([d.prop, value]);
    }
    if (decls.length === 0) return;
    for (const [state, entries] of byState) out.push({ selector: entries.join(','), state, decls });
  });
  return out;
}

/** Which of the states a master has, in the board's order. */
export const statesOf = (rules: readonly StateRule[]): MasterState[] =>
  STATES.filter((s) => rules.some((r) => r.state === s));

/**
 * The master's own values for the editable properties: the LAST declaration of each in the top-level rule whose
 * selector is exactly `.<cls>` (the cascade's winner at equal specificity). A property it does not set is absent.
 */
export function lookOf(css: string | null, cls: string | null): Record<string, string> {
  const look: Record<string, string> = {};
  if (!css || !cls) return look;
  const want = `.${cls}`;
  const rules = scanCssRules(css);
  rules.forEach((r, i) => {
    if (r.atRule || r.parent !== -1 || r.nestedInAtRule) return;
    if (splitSelectorList(r.selector).join(',').replace(/\s+/g, ' ') !== want) return;
    for (const d of ownDeclarations(css, rules, i)) {
      const prop = d.prop.toLowerCase();
      const value = d.rawValue.replace(/!important\s*$/i, '').trim();
      if ((MASTER_PROPS as readonly string[]).includes(prop) && safeCssValue(value))
        look[prop] = value;
    }
  });
  return look;
}
