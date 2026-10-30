// ds/override-map.ts — S10.10: an element's overrides → waiting edits ("Update <Heading> for every canvas…").
//
// `POST /_api/ds/pending {ds, from: {canvas, elementId, target}}` lands here (routes/ds.ts). The inspector
// (S2.12 type styles, S2.17 instances) only says WHICH element and WHAT it should become; the CSS is worked out on
// the server from the canvas's own source, so nothing the page sends is trusted as CSS (DDR-172 D8).
//
//   target { kind: 'component', name, variant? }   a master: `components[name][.<class>][prop]`
//       the selector is the class `components.json` declares for it; paint (fill, text colour) goes to the
//       variant's class when the instance has one and the file declares it, everything else to the base class
//   target { kind: 'typeRole', role }              a type role: `components['<class>'][.<class>][prop]`
//       the class is `components.json` `typeRoles[role]` (else `t-<role>`); only the seven properties a style owns
//
// Values are read only when they are literals in the file (`borderRadius: 6`, `background: 'tomato'`); an
// expression is skipped and named in `skipped`, never guessed. Placement (position, margin, z-index …) belongs to
// the canvas and never reaches a master. A value that could leave its declaration is dropped the same way.

import { CanvasEditError, readAttributeState } from '../canvas-edit.ts';
import { PLACEMENT_PROPS, readInstance } from '../edit-ops/instance-model.ts';
import { ROLE_CLASS_RE, TYPE_PROPS } from '../edit-ops/text-style.ts';
import { safeCssValue } from './board/types.ts';
import { DsEngineError, type PendingComponents } from './engine.ts';

export type PushTarget =
  | { kind: 'typeRole'; role: string }
  | { kind: 'component'; name: string; variant?: string };

export interface MappedPush {
  components: PendingComponents;
  /** how many declarations wait */
  entries: number;
  /** kebab-case properties the element sets in code (or unsafely) and so were not pushed */
  skipped: string[];
}

/** Properties that are the look of a variant rather than the master's shape. */
const PAINT = new Set([
  'background',
  'background-color',
  'background-image',
  'color',
  'border-color',
]);
/** A bare number is `px` except for these (React's own unitless list, the ones that matter here). */
const UNITLESS = new Set([
  'font-weight',
  'line-height',
  'opacity',
  'flex',
  'flex-grow',
  'flex-shrink',
  'z-index',
  'order',
  'zoom',
  'aspect-ratio',
  'scale',
]);
const ENTRIES_MAX = 24;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CLASS_RE = /^-?[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const ROLE_RE = /^[a-z][a-z0-9-]{0,40}$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const invalid = (m: string): never => {
  throw new DsEngineError('ds-pending-invalid', m);
};

function withUnit(prop: string, text: string): string {
  const t = text.trim();
  return /^-?\d+(\.\d+)?$/.test(t) && Number(t) !== 0 && !UNITLESS.has(prop) ? `${t}px` : t;
}

/** The literal value of one inline style property, or null (absent / written in code / unsafe). */
function literalOf(
  file: string,
  source: string,
  id: string,
  prop: string
): { value: string } | { skipped: true } | null {
  let st: ReturnType<typeof readAttributeState>;
  try {
    st = readAttributeState(file, source, id, `style.${prop}`);
  } catch (err) {
    if (err instanceof CanvasEditError) return invalid(`${id} is not in that canvas`);
    throw err;
  }
  if (st.kind === 'absent') return null;
  if (st.kind !== 'literal') return { skipped: true };
  const value = withUnit(prop, st.value);
  return safeCssValue(value) ? { value } : { skipped: true };
}

function put(out: PendingComponents, name: string, selector: string, prop: string, value: string) {
  const sels = out[name] ?? {};
  out[name] = sels;
  const props = sels[selector] ?? {};
  sels[selector] = props;
  props[prop] = { value };
}

function componentDef(json: unknown, name: string): { key: string; def: Record<string, unknown> } {
  const list = isObj(json) && isObj(json.components) ? json.components : {};
  for (const [key, def] of Object.entries(list))
    if (isObj(def) && (key === name || def.export === name)) return { key, def };
  return invalid(`${name} is not a component of this system`);
}

function mapComponent(
  input: { source: string; file: string; elementId: string; componentsJson: unknown },
  target: { name: string; variant?: string }
): MappedPush {
  if (!NAME_RE.test(target.name)) return invalid('not a component name');
  const { key, def } = componentDef(input.componentsJson, target.name);
  const cls = def.class;
  if (typeof cls !== 'string' || !CLASS_RE.test(cls))
    return invalid(`${target.name} declares no class to change`);
  let facts: ReturnType<typeof readInstance>;
  try {
    facts = readInstance(input.source, input.file, input.elementId);
  } catch (err) {
    if (err instanceof CanvasEditError) return invalid(err.message);
    throw err;
  }
  if (!facts || facts.component !== target.name)
    return invalid(`${input.elementId} is not an instance of ${target.name}`);
  const vcls =
    target.variant && isObj(def.variants) && typeof def.variants[target.variant] === 'string'
      ? (def.variants[target.variant] as string)
      : null;
  const paintSel = vcls && CLASS_RE.test(vcls) ? `.${vcls}` : `.${cls}`;
  const out: PendingComponents = {};
  const skipped: string[] = [];
  let entries = 0;
  for (const p of facts.style ?? []) {
    if (p.spread || !p.prop || p.prop.startsWith('--') || PLACEMENT_PROPS.has(p.prop)) continue;
    const got = literalOf(input.file, input.source, input.elementId, p.prop);
    if (!got) continue;
    if ('skipped' in got || entries >= ENTRIES_MAX) {
      skipped.push(p.prop);
      continue;
    }
    put(out, key, PAINT.has(p.prop) ? paintSel : `.${cls}`, p.prop, got.value);
    entries++;
  }
  return { components: out, entries, skipped };
}

function mapTypeRole(
  input: { source: string; file: string; elementId: string; componentsJson: unknown },
  target: { role: string }
): MappedPush {
  if (!ROLE_RE.test(target.role)) return invalid('not a type role');
  const roles =
    isObj(input.componentsJson) && isObj(input.componentsJson.typeRoles)
      ? input.componentsJson.typeRoles
      : {};
  const named = roles[target.role];
  const cls = typeof named === 'string' ? named : `t-${target.role}`;
  if (!ROLE_CLASS_RE.test(cls)) return invalid(`${target.role} is not a type role class`);
  const out: PendingComponents = {};
  const skipped: string[] = [];
  let entries = 0;
  for (const prop of TYPE_PROPS) {
    const got = literalOf(input.file, input.source, input.elementId, prop);
    if (!got) continue;
    if ('skipped' in got) {
      skipped.push(prop);
      continue;
    }
    put(out, cls, `.${cls}`, prop, got.value);
    entries++;
  }
  return { components: out, entries, skipped };
}

export function mapOverrides(input: {
  source: string;
  /** the canvas path (a `.tsx` name; only its extension matters to the parser) */
  file: string;
  elementId: string;
  target: unknown;
  /** parsed `components.json` (null when the system has none) */
  componentsJson: unknown;
}): MappedPush {
  const t = input.target;
  if (!isObj(t)) return invalid('target is a type role or a component');
  if (typeof input.elementId !== 'string' || !input.elementId || input.elementId.length > 200)
    return invalid('elementId is the element’s id');
  const base = {
    source: input.source,
    file: input.file,
    elementId: input.elementId,
    componentsJson: input.componentsJson,
  };
  let mapped: MappedPush;
  if (t.kind === 'component' && typeof t.name === 'string')
    mapped = mapComponent(base, {
      name: t.name,
      ...(typeof t.variant === 'string' ? { variant: t.variant } : {}),
    });
  else if (t.kind === 'typeRole' && typeof t.role === 'string')
    mapped = mapTypeRole(base, { role: t.role });
  else return invalid('target is a type role or a component');
  if (mapped.entries === 0)
    throw new DsEngineError(
      'ds-nothing-to-push',
      mapped.skipped.length
        ? 'what this element changes is written in code; there is nothing to push'
        : 'this element looks the way the system says; there is nothing to push',
      { skipped: mapped.skipped }
    );
  return mapped;
}
