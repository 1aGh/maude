// acp/policy/enforce.ts — the bridge's permission gate for a bridge-enforced (non-Claude) ACP agent.
// Contract: `.ai/plans/notes/universal-acp-contract.md` § "Bridge-enforced rule set" (rules 1–13), DDR-252.
//
// The boundary itself is the agent's own launch policy (Codex's Seatbelt profile, opencode's permission
// engine — acp/policy/launch-*.ts). This gate is the SECOND gate: it answers every
// `session/request_permission` from ACP `kind` + `locations` + `rawInput`, never a tool name (only Claude
// has `_meta.claudeCode.toolName`). It is pure: no I/O beyond realpath, no bridge state but what the
// caller passes in `GateState`, so the replay tests can drive it with recorded frames.
//
// Rule map (contract numbering):
//   1  stopped session → cancelled                         `gatePermission`
//   2  normalise kind / targets / command                  `normaliseRequest`
//   3  credential refusal, no card                         may-scope.ts `credentialRefusalByKind`
//   4  "AI may" refusal, no card                           may-scope.ts `mayRefusalByKind`
//   5  writes: inside → once, outside → card, none → refuse  write-scope.ts `writeVerdictForPaths`
//   6  reads:  inside → once, outside → card, none → refuse
//   7  shell:  os-sandbox → always card; command-text → auto verb / plain inside read → once, else card
//   8  anything else → refuse
//   9  never pick an "always" option; strip it from the card  `cardOptions`
//   10 refused modes                                       `isRefusedMode` (the pin itself is the bridge's)
//   11 fs/* and terminal/* → JSON-RPC error                 `isForbiddenClientMethod`
//   12 tripwire on completed tool updates                  `tripwire`
//   13 a refusal that ends the turn says why               `refusalNotice`
//
// Every refusal picks the request's `reject_once` option, or `cancelled` when there is none. An allow
// is `allowOnce` + `audienceHold: true`: the bridge still runs its audience check (H1) before granting.

import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';

import { MAUDE_VERBS, type VerbDef, verbTier } from '../../actions/verbs.ts';
import { agentPath } from '../agent-path.ts';
import type { AgentDescriptor, Enforcement, PolicyCtx } from '../agents/descriptor.ts';
import {
  assetsRootsFor,
  bashReadOnlyInside,
  credentialRefusalByKind,
  type KindRequest,
  mayRefusalByKind,
  plainWords,
} from '../may-scope.ts';
import { isInsideRoot, resolveRealPath, writeVerdictForPaths } from '../write-scope.ts';

// ---------------------------------------------------------------------------------------------------
// Types (the call-site interface; the lead reconciles with acp/policy/gate-types.ts at merge)

export type GateDecision = 'allow_once' | 'reject' | 'ask';

export type GateReason =
  | 'stopped'
  | 'not-enforced'
  | 'no-tool-call'
  | 'credentials'
  | 'web'
  | 'assets'
  | 'write-inside'
  | 'write-outside'
  | 'write-no-target'
  | 'read-inside'
  | 'read-outside'
  | 'read-no-target'
  | 'shell-escalation'
  | 'shell-auto-verb'
  | 'shell-read-inside'
  | 'shell-ask'
  | 'shell-no-command'
  | 'fetch'
  | 'unknown-kind'
  | 'no-allow-option';

export interface GateResult {
  decision: GateDecision;
  /** The option to answer with: allow → the `allow_once` option, reject → `reject_once` (absent → cancelled). */
  optionId?: string;
  reason: GateReason;
  /** What the person's card may offer: only `allow_once` / `reject_once`, never a persistent option. */
  strippedOptions: PermissionOption[];
  /** An allow still goes through the bridge's audience check (H1) before it is granted. */
  audienceHold: boolean;
  /** What the card shows: the resolved paths (never the model's own spelling), the command, the cwd. */
  shown: { paths: string[]; command?: string; cwd: string };
  /** The request's toolCallId, when it had one. */
  toolCallId?: string;
}

/** Per-request facts the bridge holds live; everything else is in `PolicyCtx` (per session). */
export interface GateState {
  /** The session was stopped: every late request is `cancelled` (rule 1). */
  stopped: boolean;
  /** Folders the person let this chat read (ai/attach-grants.ts), read live: readable, never writable. */
  grantRoots?: readonly string[];
  /** A run's own write scope (S8.10 Handoff): every write target must be one of these. */
  onlyPaths?: readonly string[] | null;
  /** The home folder `~` expands to (default: $HOME). */
  home?: string;
}

export type EnforcedDescriptor = AgentDescriptor & { enforcement: Enforcement };

/** A request reduced to what the rules judge (rule 2). */
export interface NormalisedRequest extends KindRequest {
  hasToolCall: boolean;
  toolCallId?: string;
  /** Paths the request names WITHOUT its cwd: a cwd is a folder to resolve from, not a write target. */
  targets: string[];
}

// ---------------------------------------------------------------------------------------------------
// Rule 2 — normalisation

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function pathsOf(toolCall: Record<string, unknown>, targetKeys: readonly string[]): string[] {
  const out: string[] = [];
  if (Array.isArray(toolCall.locations)) {
    for (const l of toolCall.locations) {
      const p = obj(l)?.path;
      if (typeof p === 'string' && p) out.push(p);
    }
  }
  const raw = obj(toolCall.rawInput) ?? {};
  for (const k of targetKeys) {
    const v = raw[k];
    if (typeof v === 'string' && v) out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x) out.push(x);
  }
  return out;
}

function commandOf(raw: Record<string, unknown>): string {
  const c = raw.command;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => typeof x === 'string').join(' ');
  return '';
}

/**
 * Rule 2: `kind`; targets = `locations[].path` ∪ `rawInput[targetKeys]` (∪ `rawInput.cwd` in `paths`);
 * command = `rawInput.command` (a string, or an argv joined with spaces); relative paths resolve from
 * the request's own cwd (spelled through agent-path.ts), else from the session's scope root.
 */
export function normaliseRequest(
  req: Pick<RequestPermissionRequest, 'toolCall'> | null | undefined,
  enforcement: Pick<Enforcement, 'targetKeys'>,
  ctx: Pick<PolicyCtx, 'scopeRoot'>,
  home: string = process.env.HOME || homedir()
): NormalisedRequest {
  const toolCall = obj(req?.toolCall);
  if (!toolCall) {
    return {
      hasToolCall: false,
      kind: undefined,
      paths: [],
      targets: [],
      command: '',
      cwd: ctx.scopeRoot,
    };
  }
  const raw = obj(toolCall.rawInput) ?? {};
  const targets = pathsOf(toolCall, enforcement.targetKeys);
  const rawCwd = typeof raw.cwd === 'string' && raw.cwd ? raw.cwd : null;
  const spelledCwd = rawCwd ? agentPath(rawCwd, ctx.scopeRoot, home) : null;
  const url = raw.url;
  return {
    hasToolCall: true,
    toolCallId: typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : undefined,
    kind: typeof toolCall.kind === 'string' ? toolCall.kind : undefined,
    targets,
    paths: rawCwd ? [...targets, rawCwd] : targets,
    command: commandOf(raw),
    cwd: spelledCwd?.abs ?? ctx.scopeRoot,
    webShaped: typeof url === 'string' && /^\s*https?:/i.test(url),
  };
}

// ---------------------------------------------------------------------------------------------------
// Rule 9 — options

/** Option ids known to persist a rule or widen the session, whatever `kind` they claim. */
export const PERSISTENT_OPTION_IDS: ReadonlySet<string> = new Set([
  'accept_execpolicy_amendment', // Codex: writes an exec-policy rule into CODEX_HOME
  'allow_for_session', // Codex: "don't ask again for these files"
  'always', // opencode: widens the session
  'allow_always',
]);

/** The options a card may show: `allow_once` and `reject_once` only, minus any persistent id. */
export function cardOptions(options: unknown): PermissionOption[] {
  if (!Array.isArray(options)) return [];
  return (options as PermissionOption[]).filter(
    (o) =>
      !!o &&
      typeof o.optionId === 'string' &&
      (o.kind === 'allow_once' || o.kind === 'reject_once') &&
      !PERSISTENT_OPTION_IDS.has(o.optionId)
  );
}

// ---------------------------------------------------------------------------------------------------
// Rule 7 helper — `maude design <auto-tier verb>`

const DESIGN_DEFS = new Map<string, VerbDef>(
  MAUDE_VERBS.filter((v) => v.scope === 'design').map((v) => [v.verb, v])
);

/**
 * True when `command` is exactly ONE plain `maude design <verb> …` call (no operator, redirect,
 * expansion or glob — `plainWords`) of an auto-tier verb (actions/verbs.ts `verbTier`). A two-word
 * entry (`ds-upgrade analyse`) is matched before its verb's own entry, as the registry says.
 */
export function isAutoDesignVerbCall(command: string): boolean {
  const w = plainWords(command);
  if (w?.[0] !== 'maude' || w[1] !== 'design' || !w[2]) return false;
  const def = (w[3] && DESIGN_DEFS.get(`${w[2]} ${w[3]}`)) || DESIGN_DEFS.get(w[2]);
  return !!def && verbTier(def) === 'auto';
}

// ---------------------------------------------------------------------------------------------------
// Rule 6 helper — reads

const GLOB_RE = /[*?[{]/;
const climbs = (p: string) => p.split(/[\\/]/).includes('..');

/** Every target, resolved on disk from `cwd`, lies in `roots` (a glob by its literal prefix). */
function readsInside(
  targets: readonly string[],
  cwd: string,
  roots: readonly string[],
  home: string
): boolean {
  return targets.every((t) => {
    let p = t;
    if (GLOB_RE.test(p)) {
      if (climbs(p)) return false;
      p = p.split(GLOB_RE)[0] || '.';
    }
    const a = agentPath(p, cwd, home);
    if (!a || a.odd) return false;
    const real = resolveRealPath(a.abs, cwd);
    return roots.some((r) => r === real || isInsideRoot(real, r));
  });
}

const realRoots = (roots: readonly string[]) =>
  roots.filter((r) => isAbsolute(r)).flatMap((r) => [resolve(r), resolveRealPath(r, r)]);

function resolvedForCard(paths: readonly string[], cwd: string, home: string): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    const a = agentPath(p, cwd, home);
    if (a) out.add(resolveRealPath(a.abs, cwd));
  }
  return [...out];
}

// ---------------------------------------------------------------------------------------------------
// The gate

const WRITE_KINDS = new Set(['edit', 'delete', 'move']);
const READ_KINDS = new Set(['read', 'search']);

/**
 * Rules 1–9 and 11–13 for one `session/request_permission` of a bridge-enforced agent. Pure: the
 * bridge applies the result (answer now, or show `strippedOptions` and check the answer with
 * `answerCard`).
 */
export function gatePermission(
  req: Pick<RequestPermissionRequest, 'toolCall' | 'options'> | null | undefined,
  d: AgentDescriptor,
  ctx: PolicyCtx,
  state: GateState
): GateResult {
  const home = state.home ?? (process.env.HOME || homedir());
  const strippedOptions = cardOptions(req?.options);
  const rejectOpt = strippedOptions.find((o) => o.kind === 'reject_once');
  const allowOpt = strippedOptions.find((o) => o.kind === 'allow_once');
  const enforcement = d.policy === 'bridge-enforced' ? d.enforcement : undefined;
  const n = normaliseRequest(req, enforcement ?? { targetKeys: [] }, ctx, home);
  const shown = {
    paths: resolvedForCard(n.paths, n.cwd, home),
    command: n.command || undefined,
    cwd: n.cwd,
  };
  const base = { strippedOptions, shown, toolCallId: n.toolCallId };
  const reject = (reason: GateReason): GateResult => ({
    ...base,
    decision: 'reject',
    optionId: reason === 'stopped' ? undefined : rejectOpt?.optionId,
    reason,
    audienceHold: false,
  });
  const ask = (reason: GateReason): GateResult => ({
    ...base,
    decision: 'ask',
    reason,
    audienceHold: false,
  });
  const allow = (reason: GateReason): GateResult =>
    allowOpt
      ? { ...base, decision: 'allow_once', optionId: allowOpt.optionId, reason, audienceHold: true }
      : ask('no-allow-option');

  // 1
  if (state.stopped) return reject('stopped');
  if (!enforcement) return reject('not-enforced');
  // 8 (a missing toolCall names nothing to judge)
  if (!n.hasToolCall) return reject('no-tool-call');
  // 3
  if (credentialRefusalByKind(n, ctx.credentialPaths, home)) return reject('credentials');
  // 4
  const assetsRoots = ctx.designRoots.flatMap((dr) => assetsRootsFor(ctx.scopeRoot, dr));
  const may = mayRefusalByKind(n, ctx.may, ctx.scopeRoot, assetsRoots, home);
  if (may) return reject(may);

  const kind = n.kind ?? '';
  const readRoots = [...ctx.readRoots, ...realRoots(state.grantRoots ?? [])];

  // 5
  if (WRITE_KINDS.has(kind)) {
    if (!n.targets.length) return reject('write-no-target');
    const v = writeVerdictForPaths(
      n.targets,
      n.cwd,
      ctx.writeRoots,
      state.grantRoots ?? [],
      state.onlyPaths ?? null,
      ctx.designRoots
    );
    if (v.reason === 'no-target') return reject('write-no-target');
    return v.inside ? allow('write-inside') : ask('write-outside');
  }
  // 6
  if (READ_KINDS.has(kind)) {
    if (!n.paths.length) return reject('read-no-target');
    return readsInside(n.paths, n.cwd, readRoots, home)
      ? allow('read-inside')
      : ask('read-outside');
  }
  // 7
  if (kind === 'execute') {
    if (!n.command.trim()) return reject('shell-no-command');
    if (enforcement.shellGate === 'os-sandbox') return ask('shell-escalation');
    if (isAutoDesignVerbCall(n.command)) return allow('shell-auto-verb');
    if (bashReadOnlyInside(n.command, n.cwd, readRoots, home)) return allow('shell-read-inside');
    return ask('shell-ask');
  }
  // web on (an off switch refused it at rule 4): the network boundary is the launch policy; the
  // person decides each fetch, with no standing option.
  if (kind === 'fetch') return ask('fetch');
  // 8 — think, switch_mode, other, unknown, absent
  return reject('unknown-kind');
}

/** The ACP answer for a decided (non-`ask`) result: the chosen option, or `cancelled`. */
export function toPermissionResponse(result: GateResult): RequestPermissionResponse {
  if (result.decision === 'ask' || !result.optionId) return { outcome: { outcome: 'cancelled' } };
  return { outcome: { outcome: 'selected', optionId: result.optionId } };
}

/**
 * The person's answer to an `ask` card, checked against what the card offered: an option it did not
 * show (an "always" one, a forged id) or no answer is `cancelled`.
 */
export function answerCard(
  result: GateResult,
  optionId: string | null | undefined
): RequestPermissionResponse {
  if (result.decision !== 'ask') return toPermissionResponse(result);
  const picked = result.strippedOptions.find((o) => o.optionId === optionId);
  return picked
    ? { outcome: { outcome: 'selected', optionId: picked.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

// ---------------------------------------------------------------------------------------------------
// Rules 10, 11, 13

/** Rule 10: a mode the bridge refuses to switch to (and the picker never lists). */
export function isRefusedMode(d: AgentDescriptor, modeId: string): boolean {
  return !!d.enforcement?.pinMode?.refuse.includes(modeId);
}

/** Rule 11: a client method a bridge-enforced agent must never call (never advertised). */
export function isForbiddenClientMethod(d: AgentDescriptor, method: string): boolean {
  return (
    d.policy === 'bridge-enforced' && (method.startsWith('fs/') || method.startsWith('terminal/'))
  );
}

/** The JSON-RPC error rule 11 answers with. */
export const FORBIDDEN_METHOD_ERROR = Object.freeze({
  code: -32601,
  message: 'Not available: Maude does not offer file or terminal access to this agent',
});

const REFUSED_WHAT: Partial<Record<GateReason, string>> = {
  credentials: 'a credential store',
  web: 'web access ("Search the web" is off)',
  assets: 'the assets folder ("Use Assets and footage" is off)',
  'write-no-target': 'a write that names no file',
  'read-no-target': 'a read that names no file',
  'shell-no-command': 'a shell call with no command',
  'no-tool-call': 'a request with no tool',
  'unknown-kind': 'a tool it cannot judge',
  'not-enforced': 'a tool from an agent it does not confine',
};

/**
 * Rule 13: when a refusal ends the agent's turn (`rejectEndsTurn`, Codex), the line the panel shows
 * instead of an error card. Null when the turn goes on, or the result is not a refusal Maude made.
 */
export function refusalNotice(d: AgentDescriptor, result: GateResult): string | null {
  if (!d.enforcement?.rejectEndsTurn || result.decision !== 'reject' || result.reason === 'stopped')
    return null;
  return `${d.label} stopped: Maude refused ${REFUSED_WHAT[result.reason] ?? 'this tool call'}`;
}

/** Rule 13, the person's own "No" on a card: still not an error. */
export function cardRefusalNotice(d: AgentDescriptor): string | null {
  return d.enforcement?.rejectEndsTurn ? `${d.label} stopped: you refused this step` : null;
}

// ---------------------------------------------------------------------------------------------------
// Rule 12 — tripwire

interface SeenCall {
  kind?: string;
  paths: string[];
  cwd?: string;
}

/** Per-session memory: a `tool_call_update` usually carries only its status, the first frame the rest. */
export interface TripwireMemory {
  calls: Map<string, SeenCall>;
  /** toolCallIds the person approved on a card: their targets were the person's call. */
  approved: Set<string>;
}

export function newTripwireMemory(): TripwireMemory {
  return { calls: new Map(), approved: new Set() };
}

export interface TripwireVerdict {
  violated: boolean;
  reason: string;
}

/**
 * Rule 12: a COMPLETED tool call whose targets break the launch policy. Evidence, never a gate: a
 * missing frame proves nothing (Codex reports none for a sandbox-denied command).
 *   • any bridge-enforced agent: a completed call that touched a credential store;
 *   • `readGate:'os-sandbox'`: a completed read/search outside the read roots, or a completed
 *     edit/delete/move outside the write roots, that the person did not approve on a card.
 * Pass the session's `memory` so a status-only `tool_call_update` is judged with what its
 * `tool_call` said; without it, the update alone is judged.
 */
export function tripwire(
  update: unknown,
  d: AgentDescriptor,
  ctx: PolicyCtx,
  memory?: TripwireMemory,
  home: string = process.env.HOME || homedir()
): TripwireVerdict {
  const none = { violated: false, reason: '' };
  const u = obj(update);
  const enforcement = d.policy === 'bridge-enforced' ? d.enforcement : undefined;
  if (!u || !enforcement) return none;
  if (u.sessionUpdate !== 'tool_call' && u.sessionUpdate !== 'tool_call_update') return none;
  const id = typeof u.toolCallId === 'string' ? u.toolCallId : undefined;
  const seen: SeenCall = (id && memory?.calls.get(id)) || { paths: [] };
  if (typeof u.kind === 'string') seen.kind = u.kind;
  const raw = obj(u.rawInput);
  if (raw && typeof raw.cwd === 'string' && raw.cwd) seen.cwd = raw.cwd;
  for (const p of pathsOf(u, enforcement.targetKeys))
    if (!seen.paths.includes(p)) seen.paths.push(p);
  if (id && memory) memory.calls.set(id, seen);
  if (u.status !== 'completed') return none;
  if (id && memory) memory.calls.delete(id);

  const cwd = seen.cwd
    ? (agentPath(seen.cwd, ctx.scopeRoot, home)?.abs ?? ctx.scopeRoot)
    : ctx.scopeRoot;
  const paths = seen.cwd ? [...seen.paths, seen.cwd] : seen.paths;
  const req: KindRequest = { kind: seen.kind, paths, command: '', cwd };
  if (credentialRefusalByKind(req, ctx.credentialPaths, home))
    return {
      violated: true,
      reason: `completed ${seen.kind ?? 'tool'} touched a credential store`,
    };
  if (enforcement.readGate !== 'os-sandbox' || (id && memory?.approved.has(id))) return none;
  const kind = seen.kind ?? '';
  if (
    READ_KINDS.has(kind) &&
    seen.paths.length &&
    !readsInside(seen.paths, cwd, ctx.readRoots, home)
  )
    return { violated: true, reason: `completed ${kind} outside the read roots` };
  if (WRITE_KINDS.has(kind) && seen.paths.length) {
    const v = writeVerdictForPaths(seen.paths, cwd, ctx.writeRoots);
    if (v.reason === 'outside' || v.reason === 'no-target')
      return { violated: true, reason: `completed ${kind} outside the write roots` };
  }
  return none;
}

// ---------------------------------------------------------------------------------------------------
// The adapter the bridge calls

export interface PermissionGate {
  /** Rules 1–9: the decision for one request. */
  decide(req: RequestPermissionRequest, state: GateState): GateResult;
  /** The person's card answer, checked against what was shown; an allow is remembered for rule 12. */
  answer(result: GateResult, optionId: string | null | undefined): RequestPermissionResponse;
  /** Rule 12, per streamed update. */
  observe(update: unknown): TripwireVerdict;
  isRefusedMode(modeId: string): boolean;
  isForbiddenClientMethod(method: string): boolean;
  refusalNotice(result: GateResult): string | null;
}

/** One gate per session: `ctx` is pinned at session start, the tripwire memory lives here. */
export function createPermissionGate(d: EnforcedDescriptor, ctx: PolicyCtx): PermissionGate {
  const memory = newTripwireMemory();
  return {
    decide: (req, state) => gatePermission(req, d, ctx, state),
    answer: (result, optionId) => {
      const res = answerCard(result, optionId);
      const picked = result.strippedOptions.find(
        (o) => res.outcome.outcome === 'selected' && o.optionId === res.outcome.optionId
      );
      if (result.toolCallId && picked?.kind === 'allow_once')
        memory.approved.add(result.toolCallId);
      return res;
    },
    observe: (update) => tripwire(update, d, ctx, memory),
    isRefusedMode: (modeId) => isRefusedMode(d, modeId),
    isForbiddenClientMethod: (method) => isForbiddenClientMethod(d, method),
    refusalNotice: (result) => refusalNotice(d, result),
  };
}
