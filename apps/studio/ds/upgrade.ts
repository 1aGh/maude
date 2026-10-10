// "Bring it up to the schema" — the system-file half of the engine (V2-1.13 §5.10).
// Deterministic: a mechanical plan from the check, judged items merged in, invariants V1–V3
// validated, then the plan applied to the tokens CSS as byte-minimal span edits. The staging,
// visual proof and one-undo apply (steps 5–8) build on these functions.

import { checkSystem } from './check.ts';
import { ownCustomProperties, splitSelectorList } from './css-scan.ts';
import { aliasFor, type RegistryIndex } from './registry.ts';
import {
  type Declaration,
  type DsFs,
  loadSystem,
  type SystemConfig,
  type SystemModel,
} from './system.ts';
import { exactVarRef, varRefs } from './value-types.ts';

export type ItemKind =
  | 'scope-selector'
  | 'invert-alias'
  | 'prefix-own'
  | 'add-role'
  | 'resolve-collision'
  | 'map-component'
  | 'add-type-role'
  | 'add-brand-piece'
  | 'canvas-codemod'
  | 'set-design-system'
  | 'set-pinned'
  | 'emit-manifests';

export interface PlanItem {
  id: string;
  kind: ItemKind;
  status: 'mechanical' | 'needs-judgement' | 'judged' | 'needs-pick';
  by?: 'ai' | 'person';
  native?: string;
  v1?: string;
  as?: string;
  themes?: string[];
  /** add-role: per-theme values, or `*` for an invariant role */
  values?: Record<string, string>;
  sources?: string[];
  note?: string;
  options?: unknown[];
  picked?: unknown;
  newHue?: boolean;
}

export interface UpgradePlan {
  format: 'maude.ds-upgrade-plan';
  v: 1;
  system: string;
  registry: 1;
  items: PlanItem[];
}

/** Step 2 — the mechanical plan: scope selectors, alias inversion, own prefixes; roles to judge. */
export function planMechanical(model: SystemModel, idx: RegistryIndex): UpgradePlan {
  const report = checkSystem(model, idx);
  const items: PlanItem[] = [];
  if (report.noDsScope.length) {
    items.push({
      id: 'scope',
      kind: 'scope-selector',
      status: 'mechanical',
      themes: model.config.themes,
    });
  }
  for (const a of report.aliases) {
    if (a.inverted) continue;
    const own = idx.ownToken.test(a.v1);
    const conflict = model.declared.has(a.v1);
    items.push({
      id: `${own ? 'own' : 'alias'}:${a.native}`,
      kind: own ? 'prefix-own' : 'invert-alias',
      status: conflict ? 'needs-judgement' : 'mechanical',
      native: a.native,
      ...(own ? { as: a.v1 } : { v1: a.v1 }),
      ...(conflict ? { note: `${a.v1} is already declared` } : {}),
    });
  }
  const viaAlias = new Set(Object.keys(report.tier1.coveredByAlias));
  for (const name of report.tier1.missing) {
    if (viaAlias.has(name)) continue;
    items.push({ id: `role:${name}`, kind: 'add-role', status: 'needs-judgement' });
  }
  items.push({ id: 'manifests', kind: 'emit-manifests', status: 'mechanical' });
  return { format: 'maude.ds-upgrade-plan', v: 1, system: model.config.name, registry: 1, items };
}

/** Merge judged items (by id) into a plan. */
export function mergeJudged(plan: UpgradePlan, judged: PlanItem[]): UpgradePlan {
  const byId = new Map(judged.map((j) => [j.id, j]));
  const items = plan.items.map((i) => byId.get(i.id) ?? i);
  for (const j of judged) if (!plan.items.some((i) => i.id === j.id)) items.push(j);
  return { ...plan, items };
}

export interface Refusal {
  invariant: 'V1' | 'V2' | 'V3' | 'V4' | 'V8';
  item: string;
  detail: string;
}

/** Step 4 — invariants on the system half (V3, V4, V8 on the plan; V1/V2 on the result). */
export function validatePlan(model: SystemModel, idx: RegistryIndex, plan: UpgradePlan): Refusal[] {
  const out: Refusal[] = [];
  for (const it of plan.items) {
    if (it.status === 'needs-judgement' || (it.status === 'needs-pick' && it.picked == null)) {
      out.push({ invariant: 'V8', item: it.id, detail: `${it.status} at stage time` });
    }
    if (it.kind === 'add-role' && it.values) {
      const role = idx.roles.get(it.id.replace(/^role:/, ''));
      for (const [theme, v] of Object.entries(it.values)) {
        if (role?.type !== 'color' || it.newHue) continue;
        // V3: a new colour references only the system's own tokens (var / color-mix / relative).
        const refs = varRefs(v);
        const literal = v
          .replace(/var\([^)]*\)/g, '')
          .match(/#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklch|oklab|lab|lch)a?\(\s*[\d.]/i);
        if (!refs.length || literal) {
          out.push({
            invariant: 'V3',
            item: it.id,
            detail: `${theme}: ${v} is not built from the system's tokens`,
          });
        }
        for (const r of refs) {
          const known =
            model.declared.has(r.name) ||
            plan.items.some((p) => p.id === `role:${r.name}` || p.v1 === r.name || p.as === r.name);
          if (!known)
            out.push({
              invariant: 'V3',
              item: it.id,
              detail: `${theme}: var(${r.name}) is not declared by the system`,
            });
        }
      }
    }
  }
  return out;
}

interface Edit {
  at: number;
  end: number;
  text: string;
}

function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.at - a.at || b.end - a.end);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return out;
}

function lineIndent(text: string, offset: number): string {
  const ls = text.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(ls))?.[0] ?? '';
}

const THEME_RE = /^\.([A-Za-z0-9_-]+)\s*\[\s*data-theme\s*=\s*(["'])([^"']+)\2\s*\]$/;

/**
 * Step 5 (system half) — the plan applied to the tokens CSS. Every edit is a span edit:
 *  - scope-selector: `,\n<indent>.ds[data-theme="t"]` right after each `.<rootClass>[data-theme="t"]`
 *    selector (theme blocks AND their @media mirrors) — strip that pattern and the original
 *    selector text comes back byte-for-byte;
 *  - invert-alias / prefix-own: `--native: V;` → `--v1: V;\n<indent>--native: var(--v1);`
 *    in every block that declared it (V2: the native name stays declared);
 *  - add-role: appended before each target block's closing brace.
 */
export function applySystemPlan(model: SystemModel, plan: UpgradePlan): string {
  const css = model.css ?? '';
  const cfg = model.config;
  const edits: Edit[] = [];
  const allDecls = model.rules.flatMap((r, i) =>
    r.atRule ? [] : ownCustomProperties(css, model.rules, i)
  );
  const kinds = new Set(
    plan.items.filter((i) => i.status !== 'needs-judgement').map((i) => i.kind)
  );
  const blank = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (kinds.has('scope-selector') && cfg.rootClass) {
    model.rules.forEach((r) => {
      if (r.atRule) return;
      const sels = splitSelectorList(r.selector);
      const dsThemes = new Set(
        sels
          .map((s) => THEME_RE.exec(s.trim()))
          .filter((m) => m?.[1] === 'ds')
          .map((m) => (m as RegExpExecArray)[3])
      );
      let cursor = r.preludeStart;
      for (const s of sels) {
        const at = blank.indexOf(s, cursor); // never a mention inside a comment;
        if (at < 0 || at > r.bodyStart) break;
        cursor = at + s.length;
        const m = THEME_RE.exec(s.trim());
        if (!m || m[1] !== cfg.rootClass || dsThemes.has(m[3])) continue;
        edits.push({
          at: cursor,
          end: cursor,
          text: `,\n${lineIndent(css, at)}.ds[data-theme="${m[3]}"]`,
        });
      }
    });
  }
  for (const it of plan.items) {
    if (it.status === 'needs-judgement') continue;
    if ((it.kind === 'invert-alias' || it.kind === 'prefix-own') && it.native) {
      const target = (it.v1 ?? it.as) as string;
      // every block that declares it — theme blocks AND their @media mirrors (reduced motion)
      for (const d of allDecls.filter((x) => x.name === it.native)) {
        const ref = exactVarRef(d.rawValue);
        if (ref && ref.name === target) continue;
        const nameAt = css.lastIndexOf(it.native, d.valueStart); // not a mention in a comment
        const indent = lineIndent(css, nameAt);
        // `--native: V;` keeps its value span; only the name changes, then the alias follows.
        edits.push({ at: nameAt, end: nameAt + it.native.length, text: target });
        edits.push({
          at: d.declEnd,
          end: d.declEnd,
          text: `\n${indent}${it.native}: var(${target});`,
        });
      }
    }
  }
  const adds = plan.items.filter(
    (i) => i.kind === 'add-role' && i.values && i.status !== 'needs-judgement'
  );
  if (adds.length) {
    const blocks = targetBlocks(model);
    const perBlock = new Map<number, string[]>();
    for (const it of adds) {
      const name = it.id.replace(/^role:/, '');
      for (const [theme, value] of Object.entries(it.values as Record<string, string>)) {
        const rule = theme === '*' ? blocks.invariant : blocks.byTheme.get(theme);
        if (rule === undefined) throw new Error(`${name}: no block for theme ${theme}`);
        const list = perBlock.get(rule) ?? [];
        list.push(`${name}: ${value};${it.note ? ` /* ${it.note} */` : ''}`);
        perBlock.set(rule, list);
      }
    }
    for (const [rule, lines] of perBlock) {
      const r = model.rules[rule];
      const indent = '  ';
      const body = css.slice(r.bodyStart, r.bodyEnd);
      const trimmedEnd = r.bodyStart + body.trimEnd().length;
      const text = `\n\n${indent}/* ─── Schema v1 roles (V2-2.15 bring-up) ─── */\n${lines.map((l) => `${indent}${l}`).join('\n')}`;
      edits.push({ at: trimmedEnd, end: trimmedEnd, text });
    }
  }
  return applyEdits(css, edits);
}

/** The block a new per-theme role goes into (the theme's own block) and the invariant block. */
function targetBlocks(model: SystemModel): {
  byTheme: Map<string, number>;
  invariant: number | undefined;
} {
  const byTheme = new Map<string, number>();
  let invariant: number | undefined;
  for (const tr of model.themeRules) {
    if (model.rules[tr.rule].atRuleChain.length) continue;
    if (tr.themes.length === 1 && !byTheme.has(tr.themes[0])) byTheme.set(tr.themes[0], tr.rule);
    if (tr.themes.length === model.config.themes.length && invariant === undefined)
      invariant = tr.rule;
  }
  // No block covers every theme (maude: structure sits in the `:root` default block and light
  // inherits it) → invariant roles go to the default theme's own block, next to the others.
  if (invariant === undefined) invariant = byTheme.get(model.config.themeDefault);
  return { byTheme, invariant };
}

/**
 * V1 + V2 on the result: every declaration of the old file is still there with the same value,
 * except a native alias whose value moved to its v1 name (and which now reads `var(--v1)`).
 */
export function validateResult(
  before: SystemModel,
  after: SystemModel,
  plan: UpgradePlan
): Refusal[] {
  const out: Refusal[] = [];
  const moved = new Map<string, string>();
  for (const it of plan.items)
    if (it.native && (it.v1 || it.as)) moved.set(it.native, (it.v1 ?? it.as) as string);
  const sig = (d: Declaration) => `${d.themes.slice().sort().join('|')}`;
  for (const d of before.decls) {
    const target = moved.get(d.name);
    const afterList = after.byName.get(d.name) ?? [];
    const same = afterList.find((a) => sig(a) === sig(d));
    if (!same) {
      out.push({
        invariant: target ? 'V2' : 'V1',
        item: d.name,
        detail: 'declaration disappeared',
      });
      continue;
    }
    if (target) {
      const ref = exactVarRef(same.value);
      if (!ref || ref.name !== target)
        out.push({ invariant: 'V2', item: d.name, detail: `must read var(${target})` });
      const v1 = (after.byName.get(target) ?? []).find((a) => sig(a) === sig(d));
      if (!v1 || v1.value !== d.value)
        out.push({
          invariant: 'V1',
          item: target,
          detail: `must carry ${d.name}'s value ${d.value}`,
        });
    } else if (same.value !== d.value) {
      out.push({
        invariant: 'V1',
        item: d.name,
        detail: `value changed: ${d.value} → ${same.value}`,
      });
    }
  }
  return out;
}

/** Re-read a system from CSS text (for validation of a staged result). */
export function modelWithCss(fs: DsFs, cfg: SystemConfig, css: string): SystemModel {
  return loadSystem(
    { read: (rel) => (rel === cfg.tokensCssRel ? css : fs.read(rel)), list: fs.list },
    cfg
  );
}

export { aliasFor, ownCustomProperties };
