// agent-runs.ts — the AI run registry behind the design plugin's hooks (contract V2-1.11 §5.4).
//
// A run is keyed by Claude Code's `session_id`: UserPromptSubmit opens it (`run/begin`), Stop
// closes it (`run/end`). While it is open, every Edit/Write the PreToolUse hook clears CLAIMS the
// artboards it reaches — "one AI per artboard" (A4): a second open run reaching a claimed artboard
// is denied `artboard-busy`. In-memory, per studio process. Until V2-1.15 (runs + leases) lands,
// the injected `RunBracket` maps begin/touch/end onto today's beginAiAction/endAiAction and the
// ai-activity banner (wired in http.ts).
//
// `changedArtboards` is the pure "which artboards does this edit reach" map, shared by edit/check
// (before the write) and edit/touched (after it).

import { randomBytes } from 'node:crypto';
import { parseSync } from 'oxc-parser';

export const RUN_ACTORS = ['maude-chat', 'claude-code'] as const;
export const RUN_OUTCOMES = ['done', 'stopped', 'failed', 'warnings'] as const;
export type RunActor = (typeof RUN_ACTORS)[number];
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

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
}

/** Side effects of the run lifecycle (http.ts wires them; all optional). */
export interface RunBracket {
  begin?(run: AgentRun): void;
  touch?(run: AgentRun, path: string): void;
  end?(run: AgentRun, outcome: RunOutcome): void;
}

export interface RunConflict {
  artboard: string;
  run: string;
  who: RunActor;
  label: string | null;
}

export type AgentRuns = ReturnType<typeof createAgentRuns>;

export function createAgentRuns(bracket: RunBracket = {}, now: () => number = Date.now) {
  const bySession = new Map<string, AgentRun>();
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* a bracket side effect never fails the hook */
    }
  };
  const open = (session: string) => {
    const r = bySession.get(session);
    return r && r.state === 'open' ? r : null;
  };

  function begin(b: {
    session: string;
    promptId?: string;
    actor: RunActor;
    label?: string;
  }): AgentRun {
    const cur = open(b.session);
    if (cur) {
      if (b.promptId && !cur.promptIds.includes(b.promptId)) cur.promptIds.push(b.promptId);
      return cur;
    }
    const run: AgentRun = {
      run: `r_${randomBytes(6).toString('hex')}`,
      session: b.session,
      actor: b.actor,
      label: b.label ?? null,
      state: 'open',
      startedAt: now(),
      promptIds: b.promptId ? [b.promptId] : [],
      touched: {},
      claims: new Set(),
    };
    bySession.set(b.session, run);
    safe(() => bracket.begin?.(run));
    return run;
  }

  /** The open run of `session`, opening one (actor claude-code) when the prompt hook never ran. */
  function ensure(session: string): AgentRun {
    return open(session) ?? begin({ session, actor: 'claude-code' });
  }

  /** Another open run's claim that `artboards` (or `'*'` = the whole canvas) would cross. */
  function conflict(
    session: string,
    canvas: string,
    artboards: string[] | '*'
  ): RunConflict | null {
    for (const r of bySession.values()) {
      if (r.state !== 'open' || r.session === session) continue;
      for (const c of r.claims) {
        const hash = c.lastIndexOf('#');
        if (c.slice(0, hash) !== canvas) continue;
        const held = c.slice(hash + 1);
        const hit =
          artboards === '*'
            ? held
            : held === '*'
              ? artboards[0]
              : artboards.includes(held)
                ? held
                : null;
        if (hit) return { artboard: hit, run: r.run, who: r.actor, label: r.label };
      }
    }
    return null;
  }

  function claim(session: string, canvas: string, artboards: string[] | '*') {
    const r = ensure(session);
    for (const a of artboards === '*' ? ['*'] : artboards) r.claims.add(`${canvas}#${a}`);
  }

  function touch(session: string, path: string, artboards: string[]) {
    const r = ensure(session);
    const prev = r.touched[path]?.artboards ?? [];
    r.touched[path] = { artboards: [...new Set([...prev, ...artboards])], at: now() };
    safe(() => bracket.touch?.(r, path));
  }

  function end(session: string, outcome: RunOutcome): AgentRun | null {
    const r = open(session);
    if (!r) return null;
    r.state = 'ended';
    r.outcome = outcome;
    r.endedAt = now();
    r.claims.clear();
    safe(() => bracket.end?.(r, outcome));
    return r;
  }

  return { begin, ensure, conflict, claim, touch, end, get: open };
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
  const out: Span[] = [];
  const stack: unknown[] = [parsed.program];
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

/** The artboards a [from, to) range of `source` reaches; `outside` = it also changes code outside every artboard. */
function reach(source: string, spans: Span[], from: number, to: number) {
  const ids: string[] = [];
  if (from === to) {
    for (const s of spans) if (s.start < from && from < s.end) ids.push(s.id);
    return { ids, outside: false };
  }
  let outside = false;
  let pos = from;
  for (const s of spans) {
    if (s.end <= from || s.start >= to) continue;
    ids.push(s.id);
    if (s.start > pos && source.slice(pos, s.start).trim()) outside = true;
    pos = Math.max(pos, s.end);
  }
  if (pos < to && source.slice(pos, to).trim()) outside = true;
  return { ids, outside };
}

/**
 * Which artboards turning `before` into `after` reaches. `before` null = a new file (every
 * artboard it has). A change outside every artboard (imports, shared consts, styles) — or a side
 * that does not parse — reaches the whole file. Pure.
 */
export function changedArtboards(
  before: string | null,
  after: string
): { scope: 'artboards' | 'file' | 'new'; artboards: string[] } {
  const afterSpans = artboardSpans(after);
  if (before === null) return { scope: 'new', artboards: (afterSpans ?? []).map((s) => s.id) };
  const beforeSpans = artboardSpans(before);
  const all = [...new Set([...(beforeSpans ?? []), ...(afterSpans ?? [])].map((s) => s.id))];
  if (!beforeSpans || !afterSpans) return { scope: 'file', artboards: all };
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before.charCodeAt(p) === after.charCodeAt(p)) p++;
  let s = 0;
  while (
    s < max - p &&
    before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)
  )
    s++;
  const b = reach(before, beforeSpans, p, before.length - s);
  const a = reach(after, afterSpans, p, after.length - s);
  if (b.outside || a.outside) return { scope: 'file', artboards: all };
  const ids = new Set([...b.ids, ...a.ids]);
  return { scope: 'artboards', artboards: all.filter((id) => ids.has(id)) };
}
