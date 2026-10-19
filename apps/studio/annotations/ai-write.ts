/**
 * @file       annotations/ai-write.ts — the AI write surface on the registry (DDR-242 AD9)
 * @scope      apps/studio/annotations/ai-write.ts
 * @purpose    The engine behind `maude design annotate`. An agent speaks in
 *             WORLD coordinates and element ids; this turns each request into
 *             the same `put | patch | delete` ops the canvas sends
 *             (annotations/ops.ts), applying them to a local copy as it goes so
 *             later requests in the batch see earlier results (refs, geometry).
 *
 *             Everything type-specific comes from the registry: which fields a
 *             type has (and so what `update` accepts), where its text lives,
 *             whether an arrow can bind to it, how it translates. Nothing here
 *             is a per-type list that a new element type would have to extend.
 *
 *             Every created element is stamped `author: {kind: 'ai'}`. Updates
 *             are field patches that carry `expect` (the values the agent's
 *             read saw), so a text edit merges with a concurrent human edit
 *             instead of overwriting it (DDR-242 §4).
 */

import { type ParsedHostRef, parseHostRef } from './elements/_shared.ts';
import { anchorPoint, facingAnchor } from './elements/arrow.model.ts';
import { compareOrder, keyBetween } from './fractional-index.ts';
import { guardLockedOps, isLocked } from './lock.ts';
import { type ApplyResult, applyOps, type Op } from './ops.ts';
// No `import './ops-merge.ts'` here: ai-write is reached from the canvas-lib graph (S4.13 template-place),
// and ops-merge pulls sync/source-merge + the npm `diff` package into the canvas iframe. Server entry points
// (api.ts, collab, codec, bin/annotate.mjs) register the merge themselves.
import { defOf, extSpecOf, REGISTRY, specOf } from './registry.ts';
import { Scene } from './scene.ts';
import type { AnnotationElement, Box } from './types.ts';

export class AiOpError extends Error {}

/** Creation defaults per type — sizes only; colours etc. are the registry defaults. */
export const CREATE_SIZE: Readonly<Record<string, { w: number; h: number }>> = {
  sticky: { w: 200, h: 200 },
  shape: { w: 180, h: 80 },
  section: { w: 480, h: 320 },
  image: { w: 240, h: 160 },
  link: { w: 280, h: 72 },
  mediaref: { w: 280, h: 72 },
};

/** Keys an op may carry that are placement / batch plumbing, not element fields. */
const PLUMBING = new Set([
  'op',
  'type',
  'id',
  'ref',
  'in',
  'near',
  'pin',
  'pointer',
  'parent',
  'flowX',
  'flowY',
  'boardX',
  'boardY',
  'from',
  'to',
  'x1',
  'y1',
  'x2',
  'y2',
  'fromLabel',
  'toLabel',
  'expect',
]);

/** Fields `update` must not set directly (they have their own verbs). */
const IMMUTABLE = new Set(['id', 'type', 'index', 'parent', 'author']);

/**
 * Types that are people's, not the agent's (contract S4 Q5/Q7, Gate 0 A18): a vote, its ballots and a
 * stamp are a person's feedback — a made-up one would be a forged opinion. The agent reads them
 * (`read-annotations`) and answers with its own marks (stickies, status stickers); every write to one
 * of these is refused, whatever the op.
 */
export const PEOPLE_ONLY_TYPES: ReadonlySet<string> = new Set(['vote', 'ballot', 'stamp']);

/** What `resolved.by` says when the agent resolved a sticky (the UI draws "resolved by AI"). */
export const AI_RESOLVER = 'AI';

/** A canvas host the verb found in a `canvas-rects` manifest / canvas state: `ab:` or `el:` → its WORLD box. */
export type HostLookup = (ref: string) => { box: Box; label: string } | null;

export interface AiBatchOptions {
  /** Finds the world box + name of an `ab:` / `el:` host, so a bound end can cache its endpoint. */
  hosts?: HostLookup;
  /** Artboard rects (world), so a new box element can ride with the artboard its centre lands in (Q3). */
  artboards?: ReadonlyArray<{ id: string; x: number; y: number; w: number; h: number }>;
  /** `resolved.at` — injectable for tests. */
  now?: () => Date;
}

export function mintId(prefix = 's'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
}

/** One-line description of every registry type and its fields (the verb's help). */
export function describeTypes(): string {
  const lines: string[] = [];
  for (const [type, def] of REGISTRY) {
    const fields = Object.keys(def.fields).join(' ');
    const extra = def.caps.textSlot ? ` · text → ${def.caps.textSlot}` : '';
    const bind = def.caps.bindable ? ' · bindable' : '';
    if (PEOPLE_ONLY_TYPES.has(type)) {
      lines.push(`  ${type.padEnd(9)} (people only — read it, never write it)`);
      continue;
    }
    const ext = Object.keys(extSpecOf(type) ?? {}).join(' ');
    lines.push(`  ${type.padEnd(9)} ${fields}${extra}${bind}${ext ? ` · also ${ext}` : ''}`);
  }
  return lines.join('\n');
}

function isRec(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Estimated box of a text block (the editor re-measures it on the next edit). */
export function textBox(text: string, fontSize: number): { w: number; h: number } {
  const lines = text.split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return {
    w: Math.max(8, Math.round(longest * fontSize * 0.55)),
    h: Math.round(lines.length <= 1 ? fontSize * 1.2 : lines.length * fontSize * 1.25),
  };
}

type EndSpec =
  | { kind: 'el'; id: string }
  | { kind: 'free'; x: number; y: number }
  | { kind: 'host'; ref: string; parsed: ParsedHostRef; cache: [number, number] | null };

/** A host's name when nothing better is known: the element id / artboard id from its ref. */
function hostName(p: ParsedHostRef): string {
  return p.kind === 'ab' ? p.artboard : p.element;
}

export class AiBatch {
  state: Map<string, AnnotationElement>;
  /** The ops to send / persist, in order. */
  readonly ops: Op[] = [];
  /** `@ref` → minted id. */
  readonly refs = new Map<string, string>();
  readonly created: string[] = [];
  readonly updated = new Set<string>();
  readonly deleted: string[] = [];
  private sceneCache: Scene | null = null;

  constructor(
    elements: Iterable<AnnotationElement>,
    private readonly opts: AiBatchOptions = {}
  ) {
    this.state = new Map([...elements].map((e) => [e.id, e]));
  }

  get scene(): Scene {
    this.sceneCache ??= new Scene(this.state.values());
    return this.sceneCache;
  }

  get elements(): AnnotationElement[] {
    return [...this.state.values()];
  }

  /** Apply ops to the local copy; any rejection fails the whole batch loudly. */
  private apply(ops: Op[], what: string): ApplyResult {
    // Votes, ballots and stamps are people's (PEOPLE_ONLY_TYPES): no op may create, change or remove one.
    for (const o of ops) {
      const type = o.op === 'put' ? o.el.type : this.state.get(o.id)?.type;
      if (type && PEOPLE_ONLY_TYPES.has(type)) {
        const id = o.op === 'put' ? o.el.id : o.id;
        throw new AiOpError(
          `${what}: "${id}" is a ${type} — those are people's own votes and reactions; read them, ` +
            'but answer with a sticky or a status sticker of your own'
        );
      }
    }
    // #137 — a locked element is the user's "don't touch": the agent gets a
    // clear refusal (and how to unlock), never a silent partial edit.
    if (guardLockedOps(this.state, ops).blocked) {
      const hit =
        ops.find((o) => isLocked(this.state.get(o.op === 'put' ? o.el.id : o.id))) ??
        ops.find((o) => o.op === 'delete');
      const id = hit ? (hit.op === 'put' ? hit.el.id : hit.id) : '?';
      throw new AiOpError(
        `${what}: "${id}" is locked (or holds a locked element) — the user pinned it; ` +
          `unlock it first with {"op":"update","id":"${id}","locked":false} only if the user asked`
      );
    }
    const r = applyOps(this.state, ops);
    if (r.rejected.length) {
      const x = r.rejected[0] as ApplyResult['rejected'][number];
      const id = 'id' in x.op ? x.op.id : x.op.el?.id;
      throw new AiOpError(`${what}: the board refused the change to "${id}" (${x.reason})`);
    }
    this.state = r.state;
    this.sceneCache = null;
    this.ops.push(...ops);
    return r;
  }

  /** An id or `@ref` → the existing element's id. */
  resolve(idOrRef: unknown, what: string): string {
    if (typeof idOrRef !== 'string' || !idOrRef) throw new AiOpError(`${what}: missing id`);
    const id = idOrRef.startsWith('@') ? this.refs.get(idOrRef) : idOrRef;
    if (!id) throw new AiOpError(`${what}: unknown ref "${idOrRef}"`);
    if (!this.state.has(id)) throw new AiOpError(`${what}: unknown id "${id}"`);
    return id;
  }

  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  private get(id: string): AnnotationElement {
    return this.state.get(id) as AnnotationElement;
  }

  /** World origin of the container `parent` (0,0 at top level). */
  private originIn(parent: string | undefined): { x: number; y: number } {
    if (!parent) return { x: 0, y: 0 };
    const p = this.get(parent);
    const po = this.scene.originOf(p);
    return { x: po.x + (num(p.x) ? p.x : 0), y: po.y + (num(p.y) ? p.y : 0) };
  }

  /** A key above every current child of `parent`. */
  private topIndex(parent: string | undefined): string {
    const sibs = this.scene.childrenOf(parent ?? null);
    const last = sibs[sibs.length - 1];
    return keyBetween(last ? last.index : null, null);
  }

  private container(idOrRef: unknown, what: string): string {
    const id = this.resolve(idOrRef, what);
    if (!defOf(this.get(id).type)?.caps.container) {
      throw new AiOpError(`${what}: "${id}" is not a section`);
    }
    return id;
  }

  /**
   * Map the agent's field vocabulary onto the type's real fields:
   *   text  → the type's text slot (text / shape label / section title)
   *   color → `fill` on a type with no `color` field (a sticky's paper)
   *   shape → shape `kind` (rounded = rect with radius 8, circle = ellipse)
   *   label → a shape's label text
   *   null  → reset the field to its default
   * Unknown fields and values the type can't hold are errors, never dropped.
   */
  private fields(
    type: string,
    raw: Record<string, unknown>,
    cur: AnnotationElement | null,
    what: string
  ): { set: Record<string, unknown>; unset: string[] } {
    const spec = specOf(type);
    const def = defOf(type);
    if (!spec || !def) throw new AiOpError(`${what}: unknown type "${type}"`);
    const ext = extSpecOf(type) ?? {};
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    const put = (k: string, v: unknown) => {
      if (v === null) unset.push(k);
      else set[k] = v;
    };
    for (const [k0, v] of Object.entries(raw)) {
      if (v === undefined || PLUMBING.has(k0) || k0 === 'x' || k0 === 'y') continue;
      let k = k0;
      let val = v;
      if (k === 'text' && def.caps.textSlot === 'label') {
        k = 'label';
        val = { ...((cur?.label as object) ?? {}), text: v ?? '' };
      } else if (k === 'text' && def.caps.textSlot === 'title') {
        k = 'label';
      } else if (k === 'label' && def.caps.textSlot === 'label' && typeof v === 'string') {
        val = { ...((cur?.label as object) ?? {}), text: v };
      } else if (k === 'color' && !('color' in def.fields) && 'fill' in def.fields) {
        k = 'fill';
      } else if (k === 'shape' && type === 'shape') {
        k = 'kind';
        if (v === 'rounded') {
          val = 'rect';
          if (!('radius' in raw)) set.radius = 8;
        } else if (v === 'square') val = 'rect';
        else if (v === 'circle') val = 'ellipse';
      }
      if (IMMUTABLE.has(k)) {
        throw new AiOpError(
          `${what}: "${k}" can't be set here${k === 'parent' ? ' — use reparent' : ''}`
        );
      }
      // `locked` is a tail field every type carries (#137); the format-2 extension fields are
      // typed by `extSpecOf` (V2-1.12 R5) and obey the same strictness as the rest.
      const extField = Object.hasOwn(ext, k) ? ext[k] : undefined;
      if (!Object.hasOwn(def.fields, k) && !extField && k !== 'locked') {
        throw new AiOpError(
          `${what}: ${type} has no field "${k0}" (fields: ${[...Object.keys(def.fields), ...Object.keys(ext)].join(', ')})`
        );
      }
      if (k === 'resolved' && !Object.hasOwn(def.fields, k)) {
        // The agent says `true` (resolve now, as the AI) or `null` (reopen); it never forges who/when.
        if (val === true)
          val = {
            by: AI_RESOLVER,
            at: this.now()
              .toISOString()
              .replace(/\.\d+Z$/, 'Z'),
          };
        else if (val === false) val = null;
        else if (val !== null) {
          throw new AiOpError(
            `${what}: resolved is true (resolve) or null (reopen) — the board stamps who and when`
          );
        }
      }
      const parser = extField ?? spec[k];
      if (val !== null && parser?.parse(val) === undefined) {
        throw new AiOpError(`${what}: invalid value for ${type}.${k}: ${JSON.stringify(val)}`);
      }
      put(k, val);
    }
    return { set, unset };
  }

  /**
   * Create an element. Coordinates are WORLD; `parent` (id / @ref / null)
   * pins the container, else a box element joins the deepest section its
   * centre lands in — exactly where a person dropping it would put it.
   */
  create(type: string, op: Record<string, unknown>): string {
    const what = `create ${type}`;
    const def = defOf(type);
    if (!def) {
      throw new AiOpError(
        `create: unknown type "${type}" (types: ${[...REGISTRY.keys()].join(', ')})`
      );
    }
    const { set } = this.fields(type, op, null, what);
    const world: Record<string, unknown> = { ...set };
    if (def.caps.box) {
      const size = CREATE_SIZE[type];
      let w = num(op.w) ? op.w : size?.w;
      let h = num(op.h) ? op.h : size?.h;
      if (type === 'text' && (w === undefined || h === undefined)) {
        const tb = textBox(
          typeof op.text === 'string' ? op.text : '',
          num(op.fontSize) ? op.fontSize : 14
        );
        w ??= tb.w;
        h ??= tb.h;
      }
      if (!num(op.x) || !num(op.y) || !num(w) || !num(h)) {
        throw new AiOpError(`${what}: needs x, y (world) and a size`);
      }
      Object.assign(world, { x: op.x, y: op.y, w, h });
    } else if (type === 'arrow') {
      Object.assign(world, this.arrowEnds(op, what));
    } else if (type === 'pen') {
      if (!Array.isArray(op.points)) throw new AiOpError(`${what}: needs points [x0,y0,x1,y1,…]`);
    }
    const id = mintId();
    let draft = { id, type, index: 'a0', ...world } as AnnotationElement;
    // Which container: explicit, else where the centre lands (box elements).
    let parent: string | undefined;
    if (op.parent !== undefined && op.parent !== null) parent = this.container(op.parent, what);
    else if (op.parent === undefined && def.caps.box) {
      const b = def.bounds(draft, { origin: { x: 0, y: 0 }, resolve: () => null });
      const hit = b ? this.scene.containerAt(b.x + b.w / 2, b.y + b.h / 2) : null;
      if (hit) parent = hit.id;
    }
    if (parent) {
      const o = this.originIn(parent);
      draft = { ...draft, ...def.translate(draft, -o.x, -o.y), parent };
    }
    draft.index = this.topIndex(parent);
    draft.author = { kind: 'ai' };
    // Ride with the artboard the centre lands in (contract S4 Q3) — unless a section owns it.
    if (def.caps.box && !parent && draft.parentArtboard === undefined) {
      const ab = this.artboardAt(draft);
      if (ab) draft.parentArtboard = ab;
    }
    if (!def.meaningful(draft)) {
      throw new AiOpError(
        `${what}: too small or empty to keep (a ${type} needs real content/size)`
      );
    }
    this.apply([{ op: 'put', el: draft }], what);
    if (typeof op.ref === 'string' && op.ref.startsWith('@')) this.refs.set(op.ref, id);
    this.created.push(id);
    return id;
  }

  /** One arrow side as the agent wrote it: an annotation (id / @ref), a canvas host (`ab:` / `el:`), or a free point. */
  private endSpec(op: Record<string, unknown>, which: 'start' | 'end', what: string): EndSpec {
    const bound = which === 'start' ? op.from : op.to;
    if (bound !== undefined) {
      if (typeof bound === 'string' && parseHostRef(bound)) {
        const [kx, ky] = which === 'start' ? ['x1', 'y1'] : ['x2', 'y2'];
        const cache = num(op[kx]) && num(op[ky]) ? ([op[kx], op[ky]] as [number, number]) : null;
        return { kind: 'host', ref: bound, parsed: parseHostRef(bound) as ParsedHostRef, cache };
      }
      const id = this.resolve(bound, what);
      if (!this.bindable(id)) {
        throw new AiOpError(`${what}: "${id}" (${this.get(id).type}) can't take an arrow end`);
      }
      return { kind: 'el', id };
    }
    const raw = op[which];
    if (isRec(raw) && num(raw.x) && num(raw.y)) return { kind: 'free', x: raw.x, y: raw.y };
    const [kx, ky] = which === 'start' ? ['x1', 'y1'] : ['x2', 'y2'];
    if (num(op[kx]) && num(op[ky])) return { kind: 'free', x: op[kx], y: op[ky] };
    throw new AiOpError(`${what}: needs ${which === 'start' ? 'from or x1/y1' : 'to or x2/y2'}`);
  }

  /**
   * Both ends of a new arrow. A host end (`ab:<artboard>` / `el:<artboard>/<id>`, contract S4 Q1) is
   * written as the cached free point in `start` / `end` (a 1.x peer draws the arrow frozen there) plus
   * the `startHost` / `endHost` bind. The cache is where the arrow meets the host's box facing the
   * other end, so the verb needs the host's geometry (`hosts`, from a canvas-rects manifest) or an
   * explicit x/y — never a guess.
   */
  private arrowEnds(op: Record<string, unknown>, what: string): Record<string, unknown> {
    const specs = { start: this.endSpec(op, 'start', what), end: this.endSpec(op, 'end', what) };
    const found = (s: EndSpec) => (s.kind === 'host' ? (this.opts.hosts?.(s.ref) ?? null) : null);
    const hosts = { start: found(specs.start), end: found(specs.end) };
    const centre = (which: 'start' | 'end'): [number, number] | null => {
      const s = specs[which];
      if (s.kind === 'free') return [s.x, s.y];
      if (s.kind === 'el') {
        const b = this.worldBox(s.id);
        return b ? [b.x + b.w / 2, b.y + b.h / 2] : null;
      }
      const h = hosts[which];
      if (h) return [h.box.x + h.box.w / 2, h.box.y + h.box.h / 2];
      return s.cache;
    };
    const out: Record<string, unknown> = {};
    const round = (n: number) => Math.round(n * 10) / 10;
    for (const which of ['start', 'end'] as const) {
      const s = specs[which];
      if (s.kind === 'el') out[which] = { el: s.id };
      else if (s.kind === 'free') out[which] = { x: s.x, y: s.y };
      else {
        const h = hosts[which];
        let point: [number, number];
        if (s.cache) point = s.cache;
        else if (h) {
          const other = centre(which === 'start' ? 'end' : 'start') ?? [
            h.box.x + h.box.w + 40,
            h.box.y + h.box.h / 2,
          ];
          const a = facingAnchor(h.box, other[0], other[1]);
          point = anchorPoint(h.box, 0, a.nx, a.ny);
        } else {
          throw new AiOpError(
            `${what}: can't place ${s.ref} — pass --rects (a canvas-rects manifest) or --canvas-state so the ` +
              `verb can find it, or give ${which === 'start' ? 'x1/y1' : 'x2/y2'} as the end's last known point`
          );
        }
        out[which] = { x: round(point[0]), y: round(point[1]) };
        const given = op[which === 'start' ? 'fromLabel' : 'toLabel'];
        const label = h?.label || (typeof given === 'string' && given ? given : hostName(s.parsed));
        out[`${which}Host`] = {
          ref: s.ref,
          label,
          ...(h
            ? {
                box: { x: round(h.box.x), y: round(h.box.y), w: round(h.box.w), h: round(h.box.h) },
              }
            : {}),
        };
      }
    }
    for (const k of ['startHost', 'endHost'] as const) {
      if (out[k] !== undefined && extSpecOf('arrow')?.[k]?.parse(out[k]) === undefined) {
        throw new AiOpError(`${what}: invalid ${k}: ${JSON.stringify(out[k])}`);
      }
    }
    return out;
  }

  /** The artboard an element's centre is over, if the verb was told where the artboards are. */
  private artboardAt(el: AnnotationElement): string | null {
    const abs = this.opts.artboards;
    const def = defOf(el.type);
    if (!abs?.length || !def) return null;
    const b = def.bounds(el, { origin: { x: 0, y: 0 }, resolve: () => null });
    if (!b) return null;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return (
      abs.find((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h)?.id ?? null
    );
  }

  /**
   * Resolve stickies (`{"op":"resolve","id"|"ids"}`): stamps `resolved: {by: "AI", at}`. A sticky a
   * person already resolved keeps their name and time. Only stickies resolve; a locked one is the
   * person's to touch.
   */
  resolveStickies(op: Record<string, unknown>): string[] {
    const raw = Array.isArray(op.ids) ? op.ids : op.id !== undefined ? [op.id] : [];
    if (!raw.length) throw new AiOpError('resolve: needs id or ids');
    const done: string[] = [];
    for (const r of raw) {
      const id = this.resolve(r, 'resolve');
      const cur = this.get(id);
      if (cur.type !== 'sticky') {
        throw new AiOpError(`resolve: "${id}" is a ${cur.type} — only stickies are resolved`);
      }
      if (cur.resolved !== undefined) continue; // already resolved — keep who and when
      this.update({ id, resolved: true });
      done.push(id);
    }
    return done;
  }

  /**
   * Wrap elements in one new section sized to hold them (`{"op":"wrap-section","ids":[…],"text"?}`).
   * The section joins their shared container (top level when they differ), sits behind them, and every
   * member keeps its world position. A member nested inside another member stays where it is.
   */
  wrapSection(op: Record<string, unknown>): string {
    const raw = Array.isArray(op.ids) ? op.ids.map((r) => this.resolve(r, 'wrap-section')) : [];
    const ids = [...new Set(raw)];
    if (!ids.length) throw new AiOpError('wrap-section: needs ids');
    const chosen = new Set(ids);
    const members = ids.filter((id) => !this.scene.ancestors(id).some((a) => chosen.has(a)));
    const boxes = members.map((id) => this.worldBox(id)).filter((b): b is Box => !!b);
    if (!boxes.length) throw new AiOpError('wrap-section: those elements have no position');
    const pad = 40;
    const x0 = Math.min(...boxes.map((b) => b.x)) - pad;
    const y0 = Math.min(...boxes.map((b) => b.y)) - pad - 24; // room for the title
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + pad;
    const y1 = Math.max(...boxes.map((b) => b.y + b.h)) + pad;
    const parents = new Set(members.map((id) => this.scene.effectiveParent(this.get(id)) ?? null));
    const parent = parents.size === 1 ? ([...parents][0] ?? null) : null;
    const title =
      typeof op.text === 'string' ? op.text : typeof op.title === 'string' ? op.title : '';
    const sec = this.create('section', {
      ...(title ? { text: title } : {}),
      ...(typeof op.color === 'string' ? { color: op.color } : {}),
      x: Math.round(x0),
      y: Math.round(y0),
      w: Math.round(x1 - x0),
      h: Math.round(y1 - y0),
      parent,
    });
    const order = [...members].sort((a, b) => compareOrder(this.get(a), this.get(b)));
    for (const id of order) this.reparent({ id, parent: sec });
    this.reorder({ id: sec, to: 'back' });
    return sec;
  }

  /** Whether an arrow end can bind to `id` — the registry's answer, not a list. */
  bindable(id: string): boolean {
    const el = this.state.get(id);
    return !!el && !!this.scene.ctx(el).resolve(id)?.bindable;
  }

  /** World box of an element (arrows: the bounds of their endpoints). */
  worldBox(id: string): Box | null {
    return this.scene.worldBox(id);
  }

  /** A bound connector between two elements; a label becomes a text at its midpoint. */
  connect(op: Record<string, unknown>): string {
    const id = this.create('arrow', {
      ...Object.fromEntries(
        Object.entries(op).filter(([k]) => k !== 'label' && k !== 'text' && k !== 'op')
      ),
    });
    const label = typeof op.label === 'string' ? op.label : undefined;
    if (label) {
      const w = this.scene.arrowWorld(this.get(id));
      if (w) {
        this.create('text', {
          text: label,
          fontSize: 12,
          x: (w.x1 + w.x2) / 2 + 6,
          y: (w.y1 + w.y2) / 2 - 18,
          parent: null,
        });
      }
    }
    return id;
  }

  /** A free pointer arrow from a note to a world rect (a DOM element — not bindable). */
  pointer(fromId: string, target: Box): string | null {
    const from = this.worldBox(fromId);
    if (!from) return null;
    const a = facingAnchor(target, from.x + from.w / 2, from.y + from.h / 2);
    const [ex, ey] = anchorPoint(target, 0, a.nx, a.ny);
    return this.create('arrow', { from: fromId, x2: ex, y2: ey, parent: null });
  }

  /** Patch fields of an element (world x/y). `text` goes to the type's text slot. */
  update(op: Record<string, unknown>): void {
    const id = this.resolve(op.id, 'update');
    if (op.parent !== undefined)
      throw new AiOpError('update: "parent" can\'t be set here — use reparent');
    const cur = this.get(id);
    const def = defOf(cur.type);
    if (!def)
      throw new AiOpError(`update: "${id}" is an unknown type (${cur.type}) — read-only here`);
    const { set, unset } = this.fields(cur.type, op, cur, `update ${cur.type}`);
    // The agent speaks WORLD coordinates; the record stores parent-relative ones.
    const o = this.scene.originOf(cur);
    if (num(op.x) || num(op.y)) {
      if (!def.caps.box) {
        throw new AiOpError(`update: ${cur.type} has no x/y — use move`);
      }
      if (num(op.x)) set.x = op.x - o.x;
      if (num(op.y)) set.y = op.y - o.y;
    }
    if (Array.isArray(set.points)) {
      set.points = (set.points as number[]).map((v, i) => v - (i % 2 === 0 ? o.x : o.y));
    }
    for (const k of ['start', 'end'] as const) {
      const e = set[k];
      if (isRec(e) && num(e.x) && num(e.y)) set[k] = { x: e.x - o.x, y: e.y - o.y };
    }
    if (!Object.keys(set).length && !unset.length) throw new AiOpError('update: no fields to set');
    const keys = [...Object.keys(set), ...unset];
    const expect: Record<string, unknown> = {};
    for (const k of keys) expect[k] = cur[k];
    this.apply(
      [{ op: 'patch', id, set, ...(unset.length ? { unset } : {}), expect }],
      `update ${id}`
    );
    this.updated.add(id);
  }

  /**
   * Move by `dx`/`dy`, or so the element's world box starts at `x`/`y`. The
   * element then belongs to the section its centre lands in (the drop rule),
   * unless `keepParent` is set. A bound arrow end follows its host — moving an
   * arrow moves only its free ends.
   */
  move(op: Record<string, unknown>): void {
    const id = this.resolve(op.id, 'move');
    const cur = this.get(id);
    const def = defOf(cur.type);
    if (!def) throw new AiOpError(`move: "${id}" is an unknown type (${cur.type})`);
    let dx: number;
    let dy: number;
    if (num(op.dx) || num(op.dy)) {
      dx = num(op.dx) ? op.dx : 0;
      dy = num(op.dy) ? op.dy : 0;
    } else if (num(op.x) && num(op.y)) {
      const b = this.worldBox(id);
      if (!b) throw new AiOpError(`move: "${id}" has no position`);
      dx = op.x - b.x;
      dy = op.y - b.y;
    } else {
      throw new AiOpError('move: needs x/y (world) or dx/dy');
    }
    const set = def.translate(cur, dx, dy);
    if (!Object.keys(set).length) {
      throw new AiOpError(`move: "${id}" is bound at both ends — move the elements it connects`);
    }
    const expect: Record<string, unknown> = {};
    for (const k of Object.keys(set)) expect[k] = cur[k];
    this.apply([{ op: 'patch', id, set, expect }], `move ${id}`);
    this.updated.add(id);
    if (op.keepParent !== true && def.caps.box) {
      const b = this.worldBox(id);
      if (b) {
        const exclude = new Set([id]);
        const hit = this.scene.containerAt(b.x + b.w / 2, b.y + b.h / 2, exclude);
        const target = hit?.id ?? null;
        if (target !== (this.scene.effectiveParent(this.get(id)) ?? null)) {
          this.reparent({ id, parent: target });
        }
      }
    }
    this.refreshMembership(id);
  }

  /** A top-level box element rides with the artboard its centre is over now (Q3), when artboards are known. */
  private refreshMembership(id: string): void {
    const cur = this.get(id);
    if (!this.opts.artboards?.length || !defOf(cur.type)?.caps.box) return;
    if (this.scene.effectiveParent(cur)) return; // a section owns its members
    const want = this.artboardAt(cur) ?? undefined;
    if (want === cur.parentArtboard) return;
    this.apply(
      [
        {
          op: 'patch',
          id,
          set: want ? { parentArtboard: want } : {},
          ...(want ? {} : { unset: ['parentArtboard'] }),
          expect: { parentArtboard: cur.parentArtboard },
        },
      ],
      `move ${id}`
    );
  }

  /** Move an element into a section (or to top level with `parent: null`), keeping its world position. */
  reparent(op: Record<string, unknown>): void {
    const id = this.resolve(op.id, 'reparent');
    const cur = this.get(id);
    const def = defOf(cur.type);
    if (!def) throw new AiOpError(`reparent: "${id}" is an unknown type (${cur.type})`);
    if (op.parent === undefined)
      throw new AiOpError('reparent: needs parent (a section id, or null)');
    const next = op.parent === null ? undefined : this.container(op.parent, 'reparent');
    if (next === id || (next && this.scene.ancestors(next).includes(id))) {
      throw new AiOpError(`reparent: "${id}" can't go inside itself`);
    }
    const from = this.scene.originOf(cur);
    const to = this.originIn(next);
    const set: Record<string, unknown> = {
      ...def.translate(cur, from.x - to.x, from.y - to.y),
      index: this.topIndex(next),
    };
    const unset: string[] = [];
    if (next) set.parent = next;
    else unset.push('parent');
    const expect: Record<string, unknown> = {};
    for (const k of [...Object.keys(set), ...unset]) expect[k] = cur[k];
    this.apply(
      [{ op: 'patch', id, set, ...(unset.length ? { unset } : {}), expect }],
      `reparent ${id}`
    );
    this.updated.add(id);
  }

  /**
   * Change paint order among siblings: `to: "front" | "back" | "forward" |
   * "backward"`, or `before` / `after` another sibling id. One key changes —
   * the neighbours are never renumbered.
   */
  reorder(op: Record<string, unknown>): void {
    const id = this.resolve(op.id, 'reorder');
    const cur = this.get(id);
    const parent = this.scene.effectiveParent(cur);
    const sibs = [...this.scene.childrenOf(parent)].sort(compareOrder);
    const at = sibs.findIndex((s) => s.id === id);
    const rest = sibs.filter((s) => s.id !== id);
    let pos: number; // insert position in `rest`
    if (op.before !== undefined || op.after !== undefined) {
      const ref = this.resolve(op.before ?? op.after, 'reorder');
      const i = rest.findIndex((s) => s.id === ref);
      if (i < 0) throw new AiOpError(`reorder: "${ref}" is not a sibling of "${id}"`);
      pos = op.before !== undefined ? i : i + 1;
    } else if (op.to === 'front') pos = rest.length;
    else if (op.to === 'back') pos = 0;
    else if (op.to === 'forward') pos = Math.min(rest.length, at + 1);
    else if (op.to === 'backward') pos = Math.max(0, at - 1);
    else throw new AiOpError('reorder: needs to (front|back|forward|backward) or before/after');
    const lo = rest[pos - 1]?.index ?? null;
    const hi = rest[pos]?.index ?? null;
    if (pos === at) return; // already there
    let index: string;
    try {
      index = keyBetween(lo, hi);
    } catch {
      throw new AiOpError(
        `reorder: its neighbours share one order key — use to: "front" or "back" instead`
      );
    }
    this.apply(
      [{ op: 'patch', id, set: { index }, expect: { index: cur.index } }],
      `reorder ${id}`
    );
    this.updated.add(id);
  }

  /** Put the elements in one new group (appended as their outermost group). */
  group(op: Record<string, unknown>): string {
    const ids = Array.isArray(op.ids) ? op.ids.map((r) => this.resolve(r, 'group')) : [];
    if (new Set(ids).size < 2) throw new AiOpError('group: needs at least two ids');
    const gid = mintId('g');
    const ops: Op[] = ids.map((id) => {
      const cur = this.get(id);
      const groups = Array.isArray(cur.groups) ? (cur.groups as string[]) : [];
      return { op: 'patch', id, set: { groups: [...groups, gid] }, expect: { groups: cur.groups } };
    });
    this.apply(ops, 'group');
    for (const id of ids) this.updated.add(id);
    return gid;
  }

  /** Delete (a section's children move up; arrows bound to it keep their endpoint). */
  delete(op: Record<string, unknown>): void {
    const id = this.resolve(op.id, 'delete');
    this.apply([{ op: 'delete', id }], `delete ${id}`);
    this.deleted.push(id);
  }
}
