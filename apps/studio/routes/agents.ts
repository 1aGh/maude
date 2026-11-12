// /_api/agents — universal ACP (plan B1 discovery half = F2, B5 auth half + B6 server half = F7;
// contract .ai/plans/notes/universal-acp-contract.md, DDR-252): which ACP agents this Mac has, which
// of them the person connected to the Studio chat, and the routes that connect, sign in, disconnect
// and silence the one-time offer.
//
//   GET  /_api/agents[?refresh=1]
//     → { agents: [Row], offerAgents: [id] }
//        Row = { id, label, vendor, installed, realBin, version, fit, policy, offerable,   (F2)
//                connected, connectedAt, auth, offerDismissed, offer, health, connectNote, state }
//        auth   'signed-in' | 'signed-out' | 'not-needed' | 'unknown'
//        health 'ok' | 'unavailable'  (acp/agents/health.ts: caught breaking Maude's limits this run)
//        state  the Settings › AI agents list word: 'connected' | 'sign-in' | 'untested' |
//               'unavailable' | 'available'
//        offer  Studio may show the one-time offer for this agent;  offerAgents = the ids with offer
//               (the UI draws ONE shared line from it)
//   POST /_api/agents/:id/connect       body { consent?: boolean }
//   POST /_api/agents/:id/signin        → { ok } · GET /signin-status → { auth, inFlight, … }
//   POST /_api/agents/:id/signin-cancel
//   POST /_api/agents/:id/disconnect · POST /_api/agents/:id/dismiss-offer
//
// Claude keeps its own `/_api/claude/*` routes untouched. Here Claude is reported from the same
// readiness probe the chat panel uses (`probeAcpAvailabilityAuthed`), so the two cannot disagree, and
// its sign-in / status / cancel verbs delegate to the same functions those routes call. Connect,
// disconnect and dismiss are refused for it: Claude is the chat, not a connectable extra.
//
// PRIVILEGED: `origin: 'main'`, in neither canvas allowlist; every table spec sits behind the CSRF
// + loopback-Host double gate (`guardTableRoute`). About this Mac, not a canvas: `none` in
// test/_acl-route-classes.ts, `read`/`local` in sync/writer-registry.ts, refused in a cell (a cell
// runs no local AI; the `:id` paths match no manifest entry and are refused default-closed). The
// writes are refused in a read-only session, as Claude's own sign-in is.

import {
  type AgentAuthState,
  agentAuthStatus,
  agentSigninState,
  cancelAgentSignin,
  startAgentSignin,
} from '../acp/agents/auth.ts';
import { agentById, CATALOG } from '../acp/agents/catalog.ts';
import type { AgentDescriptor, AgentId } from '../acp/agents/descriptor.ts';
import { agentHealth } from '../acp/agents/health.ts';
import {
  type DiscoveredAgent,
  type DiscoverOptions,
  discoverAgents,
} from '../acp/agents/discover.ts';
import { type AgentStateStore, createAgentStateStore } from '../acp/agents/state.ts';
import {
  cancelSignin,
  getClaudeAuthStatus,
  isSigninInFlight,
  startSignin,
} from '../acp/login-state.ts';
import { probeAcpAvailabilityAuthed } from '../acp/probe.ts';
import type { RouteSpec } from './table.ts';

export type { AgentAuthState };

/** The conformance probe's answer (acp/agents/conformance.ts, another worker's, wired later). */
export interface ConformanceResult {
  pass: boolean;
  /** A short, human sentence for the Connect step when it fails. */
  detail?: string;
}

export interface AgentsRouteDeps {
  /** The discovery to ask; defaults to the real one. Tests hand it a stub. */
  discover?: (opts?: DiscoverOptions) => Promise<DiscoveredAgent[]>;
  /** The catalog `:id` is looked up in; defaults to the real one. */
  catalog?: readonly AgentDescriptor[];
  /** The connected / dismissed store; defaults to this profile's `agents.json`, opened lazily. */
  store?: AgentStateStore;
  /**
   * The conformance probe a connect must pass. Default: bridge-enforced passes, anything else does
   * not: the real probe (acp/agents/conformance.ts) replaces it when it is wired.
   */
  conformance?: (d: AgentDescriptor, realBin: string) => Promise<ConformanceResult>;
  authStatus?: (d: AgentDescriptor, realBin: string) => Promise<AgentAuthState>;
  startSignin?: typeof startAgentSignin;
  signinState?: typeof agentSigninState;
  cancelSignin?: typeof cancelAgentSignin;
  /** 'ok', or 'unavailable' when this run caught the agent breaking Maude's limits (acp/agents/health.ts). */
  health?: (id: string) => string;
  /** Claude's side, from the same functions `/_api/claude/*` and `/_api/acp/status` use. */
  claude?: {
    available(): Promise<{ available: boolean }>;
    authLoggedIn(): Promise<boolean | null>;
    startSignin(): { ok: boolean; reason?: string };
    cancelSignin(): void;
    signinInFlight(): boolean;
  };
}

const noStore = { 'Cache-Control': 'no-store' };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

const defaultClaude: NonNullable<AgentsRouteDeps['claude']> = {
  available: probeAcpAvailabilityAuthed,
  authLoggedIn: async () => (await getClaudeAuthStatus())?.loggedIn ?? null,
  startSignin,
  cancelSignin,
  signinInFlight: isSigninInFlight,
};

const defaultConformance = async (d: AgentDescriptor): Promise<ConformanceResult> => ({
  pass: d.policy === 'bridge-enforced',
});

/** The Settings word for a row (the plan's list: Connected · Sign in · Untested version · Unavailable). */
export function agentListState(args: {
  installed: boolean;
  fit: DiscoveredAgent['fit'];
  connected: boolean;
  auth: AgentAuthState;
}): 'connected' | 'sign-in' | 'untested' | 'unavailable' | 'available' {
  if (!args.installed || args.fit === 'too-old') return 'unavailable';
  if (args.fit === 'untested') return 'untested';
  if (args.auth === 'signed-out') return 'sign-in';
  return args.connected ? 'connected' : 'available';
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (!text || text.length > 4096) return {};
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createAgentsRoutes(deps: AgentsRouteDeps = {}): RouteSpec[] {
  const catalog = deps.catalog ?? CATALOG;
  const lookup = (id: string) => (deps.catalog ? catalog.find((d) => d.id === id) : agentById(id));
  const discover = (opts?: DiscoverOptions) =>
    deps.discover
      ? deps.discover(opts)
      : discoverAgents(deps.catalog ? { ...opts, catalog: deps.catalog } : opts);
  let lazyStore: AgentStateStore | undefined;
  const store = (): AgentStateStore => {
    if (deps.store) return deps.store;
    if (!lazyStore) lazyStore = createAgentStateStore();
    return lazyStore;
  };
  const conformance = deps.conformance ?? defaultConformance;
  const authOf = deps.authStatus ?? agentAuthStatus;
  const start = deps.startSignin ?? startAgentSignin;
  const signinState = deps.signinState ?? agentSigninState;
  const cancel = deps.cancelSignin ?? cancelAgentSignin;
  const health =
    deps.health ?? ((id: string) => (agentHealth(id as AgentId).available ? 'ok' : 'unavailable'));
  const claude = deps.claude ?? defaultClaude;

  /** The discovered row of one agent (cached discovery), or null. */
  const rowOf = async (id: string): Promise<DiscoveredAgent | null> =>
    (await discover()).find((r) => r.id === id) ?? null;

  /** Resolve `:id` to its descriptor + row, or the refusing response. */
  const target = async (
    params: Record<string, string>
  ): Promise<{ d: AgentDescriptor; row: DiscoveredAgent } | Response> => {
    const d = lookup(params.id ?? '');
    if (!d) return json({ ok: false, reason: 'unknown-agent' }, 404);
    const row = await rowOf(d.id);
    if (!row) return json({ ok: false, reason: 'unknown-agent' }, 404);
    return { d, row };
  };

  /** A write: main origin, refused in a read-only session. `path` stays a literal in each call. */
  const write = (spec: Pick<RouteSpec, 'path' | 'handle'>): RouteSpec => ({
    method: 'POST',
    origin: 'main',
    readOnly: 'refused',
    ...spec,
  });

  return [
    {
      method: 'GET',
      path: '/_api/agents',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const force = new URL(req.url).searchParams.get('refresh') === '1';
        try {
          const rows = await discover({ force });
          const state = store().read();
          const claudeAvail = rows.some((r) => r.id === 'claude' && r.installed)
            ? await claude.available()
            : { available: false };
          const agents = await Promise.all(
            rows.map(async (row) => {
              const d = lookup(row.id);
              const rec = state.connected[row.id];
              let auth: AgentAuthState = 'unknown';
              if (row.id === 'claude') {
                if (row.installed)
                  auth = claudeAvail.available
                    ? 'signed-in'
                    : (await claude.authLoggedIn()) === false
                      ? 'signed-out'
                      : 'unknown';
              } else if (d && row.installed && row.realBin && row.fit === 'ok') {
                auth = await authOf(d, row.realBin);
              } else if (d?.auth.gate === 'none') {
                auth = 'not-needed';
              }
              const connected = row.id === 'claude' ? claudeAvail.available : rec !== undefined;
              const offerDismissed = state.offerDismissed[row.id] === true;
              const healthy = health(row.id) === 'ok';
              const offer =
                healthy &&
                row.id !== 'claude' &&
                row.offerable &&
                !connected &&
                !offerDismissed &&
                rows.some((r) => r.id !== 'claude' && r.installed);
              return {
                ...row,
                connected,
                connectedAt: rec?.at ?? null,
                auth,
                offerDismissed,
                offer,
                health: healthy ? 'ok' : 'unavailable',
                connectNote: d?.connectNote ?? null,
                state: healthy
                  ? agentListState({ installed: row.installed, fit: row.fit, connected, auth })
                  : 'unavailable',
              };
            })
          );
          return json({ agents, offerAgents: agents.filter((a) => a.offer).map((a) => a.id) });
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : 'Could not look for agents.' },
            500
          );
        }
      },
    },

    write({
      path: '/_api/agents/:id/connect',
      handle: async (req, params) => {
        const t = await target(params);
        if (t instanceof Response) return t;
        const { d, row } = t;
        if (d.id === 'claude') return json({ ok: false, reason: 'use-claude-routes' }, 409);
        if (!row.installed || !row.realBin)
          return json({ ok: false, reason: 'not-installed' }, 409);
        if (row.fit === 'too-old') return json({ ok: false, reason: 'version-too-old' }, 409);
        if (row.fit !== 'ok') return json({ ok: false, reason: 'untested-version' }, 409);
        if (d.policy === 'unrestricted' && (await readBody(req)).consent !== true)
          return json({ ok: false, reason: 'consent-required' }, 409);
        if (d.auth.gate === 'session-new') {
          const auth = await authOf(d, row.realBin);
          if (auth === 'signed-out') return json({ ok: false, needsSignin: true });
        }
        let result: ConformanceResult;
        try {
          result = await conformance(d, row.realBin);
        } catch (err) {
          result = { pass: false, detail: err instanceof Error ? err.message : undefined };
        }
        if (!result.pass)
          return json({
            ok: false,
            reason: 'conformance-failed',
            ...(result.detail ? { detail: result.detail } : {}),
          });
        const at = Date.now();
        store().markConnected(d.id, row.version, at);
        return json({ ok: true, connected: true, at, version: row.version });
      },
    }),

    write({
      path: '/_api/agents/:id/signin',
      handle: async (_req, params) => {
        const t = await target(params);
        if (t instanceof Response) return t;
        const { d, row } = t;
        if (d.id === 'claude') {
          const r = claude.startSignin();
          return json(r, r.ok ? 200 : 409);
        }
        if (!row.installed || !row.realBin)
          return json({ ok: false, reason: 'not-installed' }, 409);
        const r = start(d, row.realBin);
        return json(r, r.ok ? 200 : 409);
      },
    }),

    {
      method: 'GET',
      path: '/_api/agents/:id/signin-status',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (_req, params) => {
        const t = await target(params);
        if (t instanceof Response) return t;
        const { d, row } = t;
        if (d.id === 'claude') {
          const loggedIn = row.installed ? await claude.authLoggedIn() : null;
          return json({
            auth: loggedIn === null ? 'unknown' : loggedIn ? 'signed-in' : 'signed-out',
            inFlight: claude.signinInFlight(),
            startedAt: null,
            lastExit: null,
          });
        }
        const sign = signinState(d.id);
        const auth: AgentAuthState =
          row.installed && row.realBin ? await authOf(d, row.realBin) : 'unknown';
        return json({ auth, ...sign });
      },
    },

    write({
      path: '/_api/agents/:id/signin-cancel',
      handle: async (_req, params) => {
        const d = lookup(params.id ?? '');
        if (!d) return json({ ok: false, reason: 'unknown-agent' }, 404);
        if (d.id === 'claude') claude.cancelSignin();
        else cancel(d.id);
        return json({ ok: true });
      },
    }),

    write({
      path: '/_api/agents/:id/disconnect',
      handle: async (_req, params) => {
        const d = lookup(params.id ?? '');
        if (!d) return json({ ok: false, reason: 'unknown-agent' }, 404);
        if (d.id === 'claude') return json({ ok: false, reason: 'use-claude-routes' }, 409);
        store().disconnect(d.id);
        return json({ ok: true });
      },
    }),

    write({
      path: '/_api/agents/:id/dismiss-offer',
      handle: async (_req, params) => {
        const d = lookup(params.id ?? '');
        if (!d) return json({ ok: false, reason: 'unknown-agent' }, 404);
        if (d.id === 'claude') return json({ ok: false, reason: 'use-claude-routes' }, 409);
        store().dismissOffer(d.id);
        return json({ ok: true });
      },
    }),
  ];
}
