// agent-runs.ts — the hook routes' view of the AI run registry (V2-1.11 §5.4, V2-1.15 §5.4).
//
// A run is keyed by Claude Code's `session_id` (or, from a Maude chat, by its `chat`): run/begin
// opens it, run/end closes it, and every Edit/Write the PreToolUse hook clears CLAIMS the
// artboards it reaches — "one AI per artboard" (A4). Since S5.3 this is a VIEW: the runs, their
// claims (= leases) and their touched files live in ai/runs.ts, the one registry; nothing here
// keeps a second map. The API stays synchronous for routes/agent.ts — a claim is reserved in the
// registry at once (so the next hook call already sees it) and settled on the lease home after.
//
// `changedArtboards` is the pure "which artboards does this edit reach" map, shared by edit/check
// (before the write) and edit/touched (after it).

import { parseSync } from 'oxc-parser';
import { createLocalLeaseHome } from './ai/lease-home.ts';
import type { RunRecord } from './ai/run-lifecycle.ts';
import { createRunRegistry, type RunRegistry } from './ai/runs.ts';
import { walkIdElements } from './element-ids.ts';

export const RUN_ACTORS = ['maude-chat', 'claude-code'] as const;
export const RUN_OUTCOMES = ['done', 'stopped', 'failed', 'warnings'] as const;
export type RunActor = (typeof RUN_ACTORS)[number];
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** A ⌘/ selection-scoped run (G-AI-6): it may change only these artboards of this canvas. */
export interface RunScope {
  /** designRoot-relative canvas */
  canvas: string;
  /** empty = the whole canvas */
  artboards: string[];
  /** S2.19 — a ⌘/ ask on a selection: the elements it may change (and what is inside them) */
  elements?: Array<{ artboard: string; element: string }>;
}

export interface AgentRun {
  run: string;
  session: string;
  actor: RunActor;
  label: string | null;
  state: 'open' | 'ended';
  outcome?: RunOutcome;
  startedAt: number;
  endedAt?: number;
  promptIds: string[];
  /** designRoot-relative path → artboards touched + last touch */
  touched: Record<string, { artboards: string[]; at: number }>;
  /** `${canvas}#${artboard}`, or `${canvas}#*` for a change at module scope */
  claims: Set<string>;
  /** set by a ⌘/ chat (G-AI-6); edit/check denies `out-of-scope` outside it */
  scope: RunScope | null;
}

/** Side effects of the run lifecycle (http.ts wires them; all optional). */
export interface RunBracket {
  begin?(run: AgentRun): void;
  touch?(run: AgentRun, path: string): void;
  /** p8-a1-claims — edit/check replayed these exact bytes for `path`: the run's, before they land */
  claim?(run: AgentRun, path: string, after: string): void;
  /**
   * p8-a1-claims — a Bash call that cannot claim opens/closes its window for the files it names;
   * p8-sec2-attrib A1 — `all`: it names none, so the window covers every canvas (no hold)
   */
  window?(
    run: AgentRun,
    call: string,
    open: boolean,
    files: readonly string[],
    all?: boolean
  ): void;
  end?(run: AgentRun, outcome: RunOutcome): void;
}

export interface RunConflict {
  artboard: string;
  run: string;
  who: RunActor;
  label: string | null;
  /** the holder is a run of this Mac's person (`mine`) — else a member's, by its home `actor` */
  mine: boolean;
  /** a member's run: the home's actor identity (never shown raw — routes/agent.ts names it) */
  actor?: string;
}

export type AgentRuns = ReturnType<typeof createAgentRuns>;

/** A change at module scope rides as the artboard key `*`: it reaches every artboard. */
const WHOLE = '*';

const hitOf = (held: string, artboards: string[] | '*') =>
  artboards === WHOLE
    ? held
    : held === WHOLE
      ? (artboards[0] ?? null)
      : artboards.includes(held)
        ? held
        : null;

const toScope = (s: RunScope | null | undefined) =>
  s ? { canvas: s.canvas, artboards: s.artboards.length ? s.artboards : ('*' as const) } : null;

export function createAgentRuns(
  bracket: RunBracket = {},
  now: () => number = Date.now,
  registry?: RunRegistry
) {
  const reg =
    registry ??
    createRunRegistry({
      designRoot: null,
      home: createLocalLeaseHome({ actor: 'you', now }),
      now,
      autoRenew: false,
    });
  const promptIds = new Map<string, string[]>();
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* a bracket side effect never fails the hook */
    }
  };
  const keyPrefix = reg.canvasKey('');
  const relOf = (key: string) => (key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key);
  const actorOf = (origin: RunRecord['origin']): RunActor =>
    origin === 'maude-chat' ? 'maude-chat' : 'claude-code';

  function asAgentRun(r: RunRecord): AgentRun {
    const outcome: RunOutcome | undefined = r.outcome
      ? r.outcome === 'done' || r.outcome === 'failed'
        ? r.outcome
        : 'stopped'
      : undefined;
    return {
      run: r.runId,
      session: r.sessionId ?? '',
      actor: actorOf(r.origin),
      label: r.label || null,
      state: r.state === 'ended' ? 'ended' : 'open',
      ...(outcome ? { outcome } : {}),
      startedAt: r.startedAt ?? r.createdAt,
      ...(r.endedAt !== undefined ? { endedAt: r.endedAt } : {}),
      promptIds: promptIds.get(r.runId) ?? [],
      touched: Object.fromEntries(
        Object.entries(r.touched).map(([p, a]) => [
          p,
          { artboards: a, at: r.hookAt ?? r.createdAt },
        ])
      ),
      claims: new Set(r.leases.map((l) => `${relOf(l.canvas)}#${l.artboard}`)),
      scope: r.scope?.canvas
        ? {
            canvas: r.scope.canvas,
            artboards: r.scope.artboards === WHOLE ? [] : [...r.scope.artboards],
            ...(r.scope.elements?.length
              ? {
                  elements: r.scope.elements.map((e) => ({
                    artboard: e.artboard,
                    element: e.element,
                  })),
                }
              : {}),
          }
        : null,
    };
  }

  /**
   * V2-1.15 §5.4 "Binding the hook run key": every hook call resolves `(chat ?? session)` to a
   * run. The run each key resolved to last is remembered, so a run that ENDED under the key
   * (`lease-lost`) can still be named by the next hook call of the same turn.
   */
  const last = new Map<string, string>();
  const keysOf = (session: string, chat?: string | null) =>
    chat ? [`c:${chat}`, `s:${session}`] : [`s:${session}`];
  function resolve(session: string, chat?: string | null): RunRecord | null {
    const r = reg.resolve({ chat: chat ?? null, session });
    if (r) remember(session, chat, r.runId);
    return r;
  }
  function remember(session: string, chat: string | null | undefined, runId: string) {
    for (const k of keysOf(session, chat)) {
      last.delete(k);
      last.set(k, runId);
    }
    // insertion order = recency: keep the newest keys (one per session / chat in practice)
    while (last.size > 1000) last.delete(last.keys().next().value as string);
  }

  const open = (session: string, chat?: string | null) => {
    const r = resolve(session, chat);
    return r ? asAgentRun(r) : null;
  };

  /**
   * The run this hook key lost its turn on (§5.9.4 / §5.6: outcome `lease-lost`), while no live
   * run answers the key. The next prompt opens a new run, which clears it.
   */
  function lost(session: string, chat?: string | null): RunRecord | null {
    if (resolve(session, chat)) return null;
    for (const k of keysOf(session, chat)) {
      const id = last.get(k);
      const r = id ? reg.get(id) : null;
      if (r) return r.outcome === 'lease-lost' ? r : null;
    }
    return null;
  }

  function begin(b: {
    session: string;
    promptId?: string;
    actor: RunActor;
    label?: string;
    scope?: RunScope | null;
    /** MAUDE_CHAT_ID — binds to that chat's live run instead of opening a second one (H5) */
    chat?: string;
  }): AgentRun {
    const cur = resolve(b.session, b.chat);
    if (cur) {
      if (b.promptId) {
        const ids = promptIds.get(cur.runId) ?? [];
        if (!ids.includes(b.promptId)) promptIds.set(cur.runId, [...ids, b.promptId]);
      }
      const bound =
        reg.hookEvent(cur.runId, {
          sessionId: b.session,
          ...(b.scope !== undefined ? { scope: toScope(b.scope) } : {}),
        }) ?? cur;
      return asAgentRun(bound);
    }
    const { rec } = reg.open({
      chatId: b.chat ?? null,
      sessionId: b.session,
      origin: b.actor === 'maude-chat' ? 'maude-chat' : 'claude-code',
      label: b.label,
      scope: toScope(b.scope),
      agent: 'Claude Code',
    });
    if (b.promptId) promptIds.set(rec.runId, [b.promptId]);
    remember(b.session, b.chat, rec.runId);
    // a hook run is lazy: it leases what each edit reaches, at that edit's claim
    void reg.admit(rec, { lazy: true }).catch(() => null);
    const run = asAgentRun(reg.get(rec.runId) ?? rec);
    safe(() => bracket.begin?.(run));
    return run;
  }

  /** The open run of `session` / `chat`, opening one when the prompt hook never ran. */
  function ensure(session: string, chat?: string | null): AgentRun {
    return (
      open(session, chat) ??
      begin({ session, actor: chat ? 'maude-chat' : 'claude-code', ...(chat ? { chat } : {}) })
    );
  }

  /** Another live run's lease that `artboards` (or `'*'` = the whole canvas) would cross. */
  function conflict(
    session: string,
    canvas: string,
    artboards: string[] | '*',
    chat?: string | null
  ): RunConflict | null {
    const self = resolve(session, chat);
    const key = reg.canvasKey(canvas);
    for (const r of reg.live()) {
      if (r.runId === self?.runId) continue;
      for (const l of r.leases) {
        const hit = l.canvas === key ? hitOf(l.artboard, artboards) : null;
        if (hit)
          return {
            artboard: hit,
            run: r.runId,
            who: actorOf(r.origin),
            label: r.label || null,
            mine: true,
          };
      }
    }
    for (const o of reg.view().others)
      for (const a of o.artboards) {
        const hit = a.canvas === key ? hitOf(a.artboard, artboards) : null;
        if (hit)
          return {
            artboard: hit,
            run: o.runId,
            who: actorOf(o.origin),
            label: o.label || null,
            mine: false,
            actor: o.actor,
          };
      }
    return null;
  }

  function claim(session: string, canvas: string, artboards: string[] | '*', chat?: string | null) {
    const r = ensure(session, chat);
    const key = reg.canvasKey(canvas);
    const keys = (artboards === WHOLE ? [WHOLE] : artboards).map((a) => ({
      canvas: key,
      artboard: a,
    }));
    const need = reg.reserve(r.run, keys);
    void reg.settle(r.run, need).catch(() => null);
  }

  /** An edit was denied `artboard-busy`: the end of the turn continues that artboard (§5.5). */
  function noteBusy(session: string, canvas: string, artboard: string, chat?: string | null) {
    const r = resolve(session, chat);
    if (r && artboard !== WHOLE) reg.noteBusy(r.runId, { canvas: reg.canvasKey(canvas), artboard });
  }

  function touch(
    session: string,
    path: string,
    artboards: string[],
    chat?: string | null,
    /** S5.5b — the elements the edit changed: the run holds them until it ends */
    elements: Array<{ artboard: string; element: string }> = []
  ) {
    const r = ensure(session, chat);
    const key = reg.canvasKey(path);
    const rec = reg.hookEvent(r.run, {
      touched: [path, artboards],
      ...(elements.length ? { objects: elements.map((e) => ({ canvas: key, ...e })) } : {}),
    });
    if (rec) safe(() => bracket.touch?.(asAgentRun(rec), path));
  }

  function end(session: string, outcome: RunOutcome, chat?: string | null): AgentRun | null {
    const r = resolve(session, chat);
    if (!r) return null;
    // the hook's end closes the run now; its leases go back to the home after
    const closed = reg.endNow(
      r.runId,
      outcome === 'failed' ? 'failed' : outcome === 'stopped' ? 'stopped' : 'done'
    );
    const run = asAgentRun(closed ?? r);
    run.outcome = outcome;
    safe(() => bracket.end?.(run, outcome));
    return run;
  }

  /** The one open run on this project, or null when there are none or several. */
  function soleOpen(): AgentRun | null {
    const live = reg.live().filter((r) => !r.behind);
    return live.length === 1 ? asAgentRun(live[0] as RunRecord) : null;
  }

  /** Every open run — V2-3.4: `GET /_api/shell/status` counts them (routes/shell.ts). */
  function openRuns(): AgentRun[] {
    return reg.live().map(asAgentRun);
  }

  return {
    begin,
    ensure,
    conflict,
    claim,
    touch,
    end,
    get: open,
    lost,
    noteBusy,
    soleOpen,
    openRuns,
    registry: reg,
  };
}

// ── which elements an edit changed (S5.5b) ──────────────────────────────────────────────────

/** The most elements one edit hands its run (a rewrite of a whole canvas holds no more). */
export const MAX_CHANGED_ELEMENTS = 50;

/**
 * The innermost `data-cd-id` elements whose source changed (or appeared) from `before` to
 * `after`, inside an artboard — an ancestor whose only change is a changed child is not one.
 * Either side not parsing = none (the artboard lease already covers it). Pure.
 */
export function changedElements(
  before: string | null,
  after: string
): Array<{ artboard: string; element: string }> {
  if (before === null) return [];
  const a = walkIdElements(after);
  const b = walkIdElements(before);
  if (!a.ok || !b.ok) return [];
  const was = new Map<string, string>();
  for (const e of b.elements) if (e.id) was.set(e.id, before.slice(e.start, e.end));
  const changed = new Set<number>();
  for (const e of a.elements)
    if (e.id && e.artboard && was.get(e.id) !== after.slice(e.start, e.end)) changed.add(e.i);
  const byIndex = new Map(a.elements.map((e) => [e.i, e]));
  const hasChangedChild = new Set<number>();
  for (const i of changed) {
    let p = byIndex.get(i)?.parent ?? -1;
    while (p >= 0 && !hasChangedChild.has(p)) {
      hasChangedChild.add(p);
      p = byIndex.get(p)?.parent ?? -1;
    }
  }
  const out: Array<{ artboard: string; element: string }> = [];
  for (const i of changed) {
    const e = byIndex.get(i);
    if (!e?.id || !e.artboard || hasChangedChild.has(i)) continue;
    if (e.id === e.artboard) continue; // the artboard itself is a lease, not an object
    out.push({ artboard: e.artboard, element: e.id });
    if (out.length >= MAX_CHANGED_ELEMENTS) break;
  }
  return out;
}

/**
 * S2.19 — the changed elements (as `changedElements` names them: the innermost `data-cd-id` ones) that are
 * neither one of the `allowed` elements nor inside one: what a ⌘/ ask on a selection may NOT touch. An
 * element is inside when it or any ancestor (in `after`) is allowed. Unparseable source, or nothing to
 * compare, is none — the artboard-level rule still covers it. Pure.
 */
export function elementsOutsideScope(
  before: string | null,
  after: string,
  allowed: ReadonlyArray<{ artboard: string; element: string }>
): Array<{ artboard: string; element: string }> {
  const changed = changedElements(before, after);
  if (!changed.length || !allowed.length) return [];
  const walk = walkIdElements(after);
  if (!walk.ok) return [];
  const ok = new Set(allowed.map((a) => `${a.artboard}\u0000${a.element}`));
  const byIndex = new Map(walk.elements.map((e) => [e.i, e]));
  const inside = (i: number): boolean => {
    for (let n = byIndex.get(i); n; n = byIndex.get(n.parent)) {
      if (n.id && n.artboard && ok.has(`${n.artboard}\u0000${n.id}`)) return true;
      if (n.parent < 0) break;
    }
    return false;
  };
  return changed.filter(
    (c) =>
      !walk.elements.some((e) => e.id === c.element && e.artboard === c.artboard && inside(e.i))
  );
}

// ── which artboards an edit reaches ──────────────────────────────────────────────────────────

interface Span {
  id: string;
  start: number;
  end: number;
}

type AstNode = { type?: string; start?: number; end?: number; [k: string]: unknown };

/** Every `<DCArtboard id="…">…</DCArtboard>` element span (literal ids only), in source order. */
export function artboardSpans(source: string): Span[] | null {
  const parsed = parseSync('canvas.tsx', source, { sourceType: 'module', lang: 'tsx' });
  if (parsed.errors.length) return null;
  return spansOf(parsed.program);
}

function spansOf(program: unknown): Span[] {
  const out: Span[] = [];
  const stack: unknown[] = [program];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (Array.isArray(n)) {
      for (const c of n) stack.push(c);
      continue;
    }
    const node = n as AstNode;
    if (node.type === 'JSXElement') {
      const open = node.openingElement as AstNode | undefined;
      const name = open?.name as (AstNode & { name?: string }) | undefined;
      if (name?.type === 'JSXIdentifier' && name.name === 'DCArtboard') {
        const attrs = (open?.attributes as AstNode[] | undefined) ?? [];
        const idAttr = attrs.find(
          (a) => a.type === 'JSXAttribute' && (a.name as AstNode & { name?: string })?.name === 'id'
        );
        const v = idAttr?.value as (AstNode & { value?: unknown }) | undefined;
        if (v?.type === 'Literal' && typeof v.value === 'string')
          out.push({ id: v.value, start: node.start ?? 0, end: node.end ?? 0 });
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'parent') continue;
      const v = node[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** A part of the source an edit inside reaches exactly these artboards. */
interface Zone {
  ids: string[];
  start: number;
  end: number;
}

interface TopDecl {
  name: string;
  /** the binding identifier's own position (not a reference) */
  idStart: number;
  start: number;
  end: number;
}

/** Top-level `function X`, `class X`, `const X = …` (also exported), one span per name. */
function topDecls(program: AstNode): TopDecl[] {
  const out: TopDecl[] = [];
  const named = (n: AstNode | undefined, start: number, end: number) => {
    const id = n?.id as (AstNode & { name?: string }) | undefined;
    if (id?.type === 'Identifier' && typeof id.name === 'string')
      out.push({ name: id.name, idStart: id.start ?? -1, start, end });
  };
  for (const stmt of (program.body as AstNode[] | undefined) ?? []) {
    const s = stmt.start ?? 0;
    const e = stmt.end ?? 0;
    const inner =
      stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration'
        ? (stmt.declaration as AstNode | undefined)
        : stmt;
    if (!inner) continue;
    if (inner.type === 'FunctionDeclaration' || inner.type === 'ClassDeclaration')
      named(inner, s, e);
    else if (inner.type === 'VariableDeclaration') {
      const ds = (inner.declarations as AstNode[] | undefined) ?? [];
      for (const d of ds)
        named(d, ds.length === 1 ? s : (d.start ?? 0), ds.length === 1 ? e : (d.end ?? 0));
    }
  }
  return out;
}

/**
 * S12.16 (S5) — the helpers an artboard renders. A top-level declaration (a component, a const) is
 * a zone when every reference to it lies inside an artboard, or inside another declaration that
 * resolves (transitively): an edit inside it reaches exactly those artboards. A declaration that
 * holds an artboard itself (the canvas component), one referenced anywhere else (module scope, a
 * cycle), or one nobody references is not a zone — an edit there still reaches the whole file.
 * References are counted by name, so a shadowing local only ever adds artboards (sound).
 */
function helperZones(program: AstNode, artboards: Span[]): Zone[] {
  const decls = topDecls(program);
  if (!decls.length) return [];
  const byName = new Map<string, TopDecl>();
  const dup = new Set<string>();
  for (const d of decls) {
    if (byName.has(d.name)) dup.add(d.name);
    byName.set(d.name, d);
  }
  const refs = new Map<string, number[]>();
  const stack: unknown[] = [program];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (Array.isArray(n)) {
      for (const c of n) stack.push(c);
      continue;
    }
    const node = n as AstNode & { name?: unknown };
    if (
      (node.type === 'Identifier' || node.type === 'JSXIdentifier') &&
      typeof node.name === 'string' &&
      byName.has(node.name) &&
      typeof node.start === 'number'
    ) {
      const list = refs.get(node.name) ?? [];
      list.push(node.start);
      refs.set(node.name, list);
    }
    for (const k of Object.keys(node)) {
      if (k === 'parent') continue;
      const v = node[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  const FILE = null;
  const memo = new Map<string, Set<string> | null>();
  const busy = new Set<string>();
  const inside = (p: number, s: { start: number; end: number }) => s.start <= p && p < s.end;
  function resolve(d: TopDecl): Set<string> | null {
    if (memo.has(d.name)) return memo.get(d.name) as Set<string> | null;
    if (busy.has(d.name) || dup.has(d.name)) return FILE;
    if (artboards.some((a) => a.start >= d.start && a.end <= d.end)) {
      memo.set(d.name, FILE);
      return FILE;
    }
    busy.add(d.name);
    let out: Set<string> | null = new Set();
    for (const p of refs.get(d.name) ?? []) {
      if (p === d.idStart || inside(p, d)) continue; // its own name, or itself (recursion)
      const a = artboards.find((s) => inside(p, s));
      if (a) {
        out.add(a.id);
        continue;
      }
      const host = decls.find((x) => x !== d && inside(p, x));
      const via = host ? resolve(host) : FILE;
      if (via === FILE) {
        out = FILE;
        break;
      }
      for (const id of via) out.add(id);
    }
    busy.delete(d.name);
    memo.set(d.name, out);
    return out;
  }
  const zones: Zone[] = [];
  for (const d of decls) {
    const r = resolve(d);
    if (r?.size) zones.push({ ids: [...r], start: d.start, end: d.end });
  }
  return zones;
}

/** The artboards and the helpers that render them, as zones. Null = the source does not parse. */
function artboardZones(source: string): { spans: Span[]; zones: Zone[] } | null {
  const parsed = parseSync('canvas.tsx', source, { sourceType: 'module', lang: 'tsx' });
  if (parsed.errors.length) return null;
  const spans = spansOf(parsed.program);
  const zones: Zone[] = [
    ...spans.map((s) => ({ ids: [s.id], start: s.start, end: s.end })),
    ...helperZones(parsed.program as unknown as AstNode, spans),
  ].sort((a, b) => a.start - b.start);
  return { spans, zones };
}

/** The artboards a [from, to) range of `source` reaches; `outside` = it also changes code no zone covers. */
function reach(source: string, zones: Zone[], from: number, to: number) {
  const ids: string[] = [];
  if (from === to) {
    for (const s of zones) if (s.start < from && from < s.end) ids.push(...s.ids);
    return { ids, outside: false };
  }
  let outside = false;
  let pos = from;
  for (const s of zones) {
    if (s.end <= from || s.start >= to) continue;
    ids.push(...s.ids);
    if (s.start > pos && source.slice(pos, s.start).trim()) outside = true;
    pos = Math.max(pos, s.end);
  }
  if (pos < to && source.slice(pos, to).trim()) outside = true;
  return { ids, outside };
}

/**
 * Which artboards turning `before` into `after` reaches. `before` null = a new file (every
 * artboard it has). A change inside a helper the artboards render reaches the artboards that
 * render it (`helperZones`, S12.16); a change no artboard or helper covers (imports, an unused
 * helper, module scope) — or a side that does not parse — reaches the whole file. Pure.
 */
export function changedArtboards(
  before: string | null,
  after: string
): { scope: 'artboards' | 'file' | 'new'; artboards: string[] } {
  const afterZ = artboardZones(after);
  if (before === null) return { scope: 'new', artboards: (afterZ?.spans ?? []).map((s) => s.id) };
  const beforeZ = artboardZones(before);
  const all = [...new Set([...(beforeZ?.spans ?? []), ...(afterZ?.spans ?? [])].map((s) => s.id))];
  if (!beforeZ || !afterZ) return { scope: 'file', artboards: all };
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before.charCodeAt(p) === after.charCodeAt(p)) p++;
  let s = 0;
  while (
    s < max - p &&
    before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)
  )
    s++;
  const b = reach(before, beforeZ.zones, p, before.length - s);
  const a = reach(after, afterZ.zones, p, after.length - s);
  if (b.outside || a.outside) return { scope: 'file', artboards: all };
  const ids = new Set([...b.ids, ...a.ids]);
  return { scope: 'artboards', artboards: all.filter((id) => ids.has(id)) };
}
