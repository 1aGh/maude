// The "connect another agent" state (universal ACP, plan B5/B6, DDR-252): which agents this person
// has connected to the Studio chat, and which proactive offers they have answered "Not now".
//
//   { connected: { [id]: { at, version } }, offerDismissed: { [id]: true } }
//
// PER PROFILE, OUTSIDE ANY PROJECT. The file lives in the profile's own config folder, next to its
// cloud.json / hubs.json (`~/.config/maude/agents.json`, or `…/profiles/<id>/agents.json`): the
// folder `credentialPathsFor` (acp/may-scope.ts) already puts on every chat session's Read deny
// list, so the agent that is being connected cannot read or rewrite its own consent record, and a
// project (which a clone or a teammate can plant) cannot pre-connect anything. Mode 0600 in a 0700
// folder, written atomically (temp file in the same folder → rename).
//
// The location is derived from the profile id and HOME/XDG alone, never from `MAUDE_CLOUD_CONFIG`
// or `HUBS_CONFIG_PATH` (an env pointer could name a folder the deny rules do not cover).

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

import { PROFILE_ID_RE } from '../../shell/profile.ts';

export interface ConnectedRecord {
  /** ms since the epoch the agent passed the connect check. */
  at: number;
  /** The agent version that passed it. */
  version: string | null;
}

export interface AgentState {
  connected: Record<string, ConnectedRecord>;
  offerDismissed: Record<string, true>;
}

type Env = Record<string, string | undefined>;

const ID_RE = /^[a-z0-9][a-z0-9:_-]{0,63}$/;

export const emptyState = (): AgentState => ({ connected: {}, offerDismissed: {} });

/** The folder of the profile this process runs as (a sibling of its cloud.json / hubs.json). */
export function agentStateDir(
  env: Env = process.env,
  home: string = env.HOME || homedir()
): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 && isAbsolute(xdg) ? xdg : join(home, '.config');
  const id = env.MAUDE_PROFILE_ID;
  if (id && id !== 'default' && PROFILE_ID_RE.test(id)) return join(base, 'maude', 'profiles', id);
  return join(base, 'maude');
}

export function agentStatePath(env: Env = process.env, home?: string): string {
  return join(agentStateDir(env, home), 'agents.json');
}

/** Read a parsed document into the shape; anything else (a hand edit, a future shape) is dropped. */
function normalise(raw: unknown): AgentState {
  const out = emptyState();
  if (!raw || typeof raw !== 'object') return out;
  const { connected, offerDismissed } = raw as Record<string, unknown>;
  if (connected && typeof connected === 'object') {
    for (const [id, rec] of Object.entries(connected as Record<string, unknown>)) {
      if (!ID_RE.test(id) || !rec || typeof rec !== 'object') continue;
      const { at, version } = rec as { at?: unknown; version?: unknown };
      if (typeof at !== 'number' || !Number.isFinite(at)) continue;
      out.connected[id] = {
        at,
        version: typeof version === 'string' ? version.slice(0, 64) : null,
      };
    }
  }
  if (offerDismissed && typeof offerDismissed === 'object') {
    for (const [id, v] of Object.entries(offerDismissed as Record<string, unknown>)) {
      if (ID_RE.test(id) && v === true) out.offerDismissed[id] = true;
    }
  }
  return out;
}

export interface AgentStateStore {
  readonly path: string;
  /** Always re-reads the file: another tab's server (same profile) may have written it. */
  read(): AgentState;
  markConnected(id: string, version: string | null, at?: number): void;
  disconnect(id: string): void;
  dismissOffer(id: string): void;
}

/** A store over one file. Writes are read-modify-write of the whole document, then atomic. */
export function createAgentStateStore(path: string = agentStatePath()): AgentStateStore {
  const read = (): AgentState => {
    try {
      if (!existsSync(path)) return emptyState();
      return normalise(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      return emptyState(); // an unreadable file reads as nothing connected: fail closed
    }
  };
  const write = (state: AgentState): void => {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = join(dir, `.agents.json.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  };
  const change = (fn: (s: AgentState) => void): void => {
    const s = read();
    fn(s);
    write(s);
  };
  const checked = (id: string): string => {
    if (!ID_RE.test(id)) throw new Error('invalid agent id');
    return id;
  };
  return {
    path,
    read,
    markConnected: (id, version, at = Date.now()) =>
      change((s) => {
        s.connected[checked(id)] = { at, version };
      }),
    disconnect: (id) =>
      change((s) => {
        delete s.connected[checked(id)];
      }),
    dismissOffer: (id) =>
      change((s) => {
        s.offerDismissed[checked(id)] = true;
      }),
  };
}
