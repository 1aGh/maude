// Asset state — "Waiting for Jonas's Mac" vs Missing, the studio half (S8.19,
// contract `client/v2/contracts/S8-S9-asset-presence.md` §5.5, decision
// v2-contract-asset-presence-probe-fed).
//
// The studio combines three things into one answer per asset path:
//   1. the disk (a file here is `here`),
//   2. this Mac's own upload queue (`uploading` — never asked of the hub),
//   3. the hub's presence answer (`GET /api/projects/:p/v1/asset-presence`).
//
// Anything uncertain degrades to a quiet `waiting` ("Not here yet"), never to a
// false `missing`: a hub that is offline, older than the route (404), or that
// answers `unknown` all read as waiting. Only a local project (no hub) or the
// hub's own `missing` is Missing.
//
// It also owns the FEED half the plane-speaking desktop needs: the journal
// file plane replaced the legacy sweep, so nothing would ever tell the hub
// "this Mac holds these" — `reportHeld` sends the same `/_asset-probe` call the
// sweep makes, flagged `held` + `sweep.final`, once the plane has a picture of
// the disk (see `createHeldReporter`).
//
// Hub answers are untrusted (DDR-054): only rels we asked about, only known
// states, a display name only.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';

import { listPushableAssets } from './asset-push.ts';
import { type CanvasGroupLike, classifyProjectFile } from './file-membership.ts';

export interface AssetWho {
  name: string | null;
  kind: 'mac' | 'pc' | 'linux' | null;
  /** Another device of the asking person's own account ("your other Mac"). */
  self: boolean;
}

export type AssetState =
  | { state: 'here' }
  | { state: 'uploading'; progress?: number }
  /** `syncing`: the hub has the bytes, this Mac has not pulled them yet ("Syncing…"). */
  | { state: 'waiting'; who?: AssetWho; syncing?: true }
  | { state: 'missing' };

export type HubPresenceState = 'here' | 'waiting' | 'missing' | 'unknown';
export interface HubPresenceItem {
  rel: string;
  state: HubPresenceState;
  who?: AssetWho;
}

/** Contract §5.4: at most this many rels per hub query (and per shell call). */
export const MAX_ASSET_STATE_RELS = 256;
/** §5.5: a hub answer is reused for this long per rel. */
export const ASSET_STATE_TTL_MS = 60_000;
/** The probe's own cap (hub `MAX_PROBE_PATHS`) — a held report is chunked to it. */
export const MAX_HELD_BATCH = 1000;

const HUB_STATES = new Set<HubPresenceState>(['here', 'waiting', 'missing', 'unknown']);
const KINDS = new Set(['mac', 'pc', 'linux']);
const PRESENCE_TIMEOUT_MS = 10_000;

/** A designRoot-relative path the shell may ask about: no escape, no runtime dirs. */
export function isAssetStateRel(rel: unknown): rel is string {
  if (typeof rel !== 'string' || !rel || rel.length > 512) return false;
  if (rel.startsWith('/') || rel.includes('\\') || /^[A-Za-z]:/.test(rel)) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point.
  if (/[\u0000-\u001f\u007f]/.test(rel)) return false;
  const parts = rel.split('/');
  if (parts.length < 2 || parts.length > 8) return false;
  return parts.every((p) => p && p !== '.' && p !== '..' && !p.startsWith('_'));
}

/**
 * The §5.5 table, pure.
 *
 * @param hub the hub's item for this rel; `null` = offline, route absent (404),
 *            or no answer at all.
 */
export function combineAssetState(input: {
  onDisk: boolean;
  uploading?: { progress?: number } | null;
  linked: boolean;
  hub: HubPresenceItem | null;
}): AssetState {
  if (input.onDisk) {
    if (input.uploading) {
      return input.uploading.progress === undefined
        ? { state: 'uploading' }
        : { state: 'uploading', progress: input.uploading.progress };
    }
    return { state: 'here' };
  }
  if (!input.linked) return { state: 'missing' }; // local project: absent = Missing (O1)
  const hub = input.hub;
  if (!hub) return { state: 'waiting' };
  switch (hub.state) {
    case 'missing':
      return { state: 'missing' };
    case 'here':
      return { state: 'waiting', syncing: true };
    case 'waiting':
      return hub.who ? { state: 'waiting', who: hub.who } : { state: 'waiting' };
    default:
      return { state: 'waiting' }; // unknown — the same quiet "Not here yet"
  }
}

function cleanWho(raw: unknown): AssetWho | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const w = raw as Record<string, unknown>;
  const name =
    typeof w.name === 'string' && w.name.length > 0 && w.name.length <= 64 && !w.name.includes('@')
      ? w.name
      : null;
  const kind =
    typeof w.kind === 'string' && KINDS.has(w.kind) ? (w.kind as AssetWho['kind']) : null;
  return { name, kind, self: w.self === true };
}

/**
 * Ask the hub. `null` = this hub cannot answer (offline, 404, non-2xx, a body
 * that is not an `items` list) — the caller reads that as "Not here yet".
 */
export async function askHubPresence(opts: {
  fetchImpl: typeof fetch;
  base: string;
  token: string;
  rels: readonly string[];
  project?: string;
}): Promise<Map<string, HubPresenceItem> | null> {
  const base = opts.base.replace(/\/+$/, '');
  const asked = new Set(opts.rels);
  const out = new Map<string, HubPresenceItem>();
  const rels = [...asked];
  for (let i = 0; i < rels.length; i += MAX_ASSET_STATE_RELS) {
    const chunk = rels.slice(i, i + MAX_ASSET_STATE_RELS);
    const q = chunk.map((r) => `rel=${encodeURIComponent(r)}`).join('&');
    let data: { items?: unknown } | null = null;
    try {
      const res = await opts.fetchImpl(
        `${base}/api/projects/${encodeURIComponent(opts.project ?? 'current')}/v1/asset-presence?${q}`,
        {
          headers: { authorization: `Bearer ${opts.token}` },
          signal: AbortSignal.timeout(PRESENCE_TIMEOUT_MS),
        }
      );
      if (!res.ok) return null;
      data = (await res.json()) as { items?: unknown };
    } catch {
      return null;
    }
    if (!Array.isArray(data?.items)) return null;
    for (const item of data.items as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      if (typeof it.rel !== 'string' || !asked.has(it.rel)) continue;
      if (typeof it.state !== 'string' || !HUB_STATES.has(it.state as HubPresenceState)) continue;
      const who = it.state === 'waiting' ? cleanWho(it.who) : undefined;
      out.set(it.rel, {
        rel: it.rel,
        state: it.state as HubPresenceState,
        ...(who ? { who } : {}),
      });
    }
  }
  return out;
}

/** True when a regular file (not a symlink, not a dir) sits at `rel` under designRoot. */
function fileOnDisk(designRoot: string, rel: string): boolean {
  const abs = path.join(designRoot, rel);
  const relBack = path.relative(designRoot, abs);
  if (relBack.startsWith('..') || path.isAbsolute(relBack)) return false;
  try {
    return existsSync(abs) && lstatSync(abs).isFile();
  } catch {
    return false;
  }
}

export interface AssetStateService {
  /** One state per asked rel (invalid rels are left out). */
  states(rels: readonly string[]): Promise<Record<string, AssetState>>;
  /** Forget cached hub answers (reconnect, a finished sweep). */
  invalidate(): void;
}

/**
 * @param hub  the linked hub's asker, or null for a local project. Read per
 *             call: a project can link or unlink while the server runs.
 */
export function createAssetStateService(deps: {
  designRoot: string;
  hub: () => { ask(rels: readonly string[]): Promise<Map<string, HubPresenceItem> | null> } | null;
  uploading?: () => ReadonlyMap<string, { progress?: number }> | null;
  now?: () => number;
  ttlMs?: number;
}): AssetStateService {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? ASSET_STATE_TTL_MS;
  const cache = new Map<string, { at: number; item: HubPresenceItem | null }>();

  return {
    invalidate: () => cache.clear(),
    async states(rels) {
      const wanted = [...new Set(rels)].filter(isAssetStateRel).slice(0, MAX_ASSET_STATE_RELS);
      const hub = deps.hub();
      const queue = deps.uploading?.() ?? null;
      const onDisk = new Map(wanted.map((r) => [r, fileOnDisk(deps.designRoot, r)]));
      const t = now();
      if (hub) {
        const stale = wanted.filter((r) => {
          if (onDisk.get(r)) return false;
          const c = cache.get(r);
          return !c || t - c.at >= ttl;
        });
        if (stale.length) {
          const answer = await hub.ask(stale).catch(() => null);
          for (const r of stale) {
            // An offline / 404 answer is stored already stale: it reads as
            // "Not here yet" now, and the next ask goes to the hub again.
            cache.set(
              r,
              answer ? { at: t, item: answer.get(r) ?? null } : { at: t - ttl, item: null }
            );
          }
        }
      }
      const out: Record<string, AssetState> = {};
      for (const r of wanted) {
        out[r] = combineAssetState({
          onDisk: onDisk.get(r) === true,
          uploading: queue?.get(r) ?? null,
          linked: hub !== null,
          hub: hub ? (cache.get(r)?.item ?? null) : null,
        });
      }
      return out;
    },
  };
}

// ------------------------------------------------------------------ the feed

/** A sweep id the hub accepts (`[A-Za-z0-9_-]{1,64}`). */
export function newSweepId(): string {
  return `s${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}

/**
 * Tell the hub "this Mac holds these" — the `/_asset-probe` call with the two
 * optional §5.2 fields, chunked to the probe's cap, `final` on the last batch.
 * False when the hub refused or could not answer (nothing is retried here; the
 * next report re-sends the whole set).
 */
export async function reportHeld(opts: {
  fetchImpl: typeof fetch;
  base: string;
  token: string;
  rels: readonly string[];
  sweepId?: string;
}): Promise<boolean> {
  const base = opts.base.replace(/\/+$/, '');
  const id = opts.sweepId ?? newSweepId();
  const rels = [...opts.rels];
  const batches: string[][] = [];
  for (let i = 0; i < rels.length; i += MAX_HELD_BATCH)
    batches.push(rels.slice(i, i + MAX_HELD_BATCH));
  if (batches.length === 0) batches.push([]); // an empty Mac still finishes a sweep
  for (let i = 0; i < batches.length; i++) {
    const final = i === batches.length - 1;
    try {
      const res = await opts.fetchImpl(`${base}/_asset-probe`, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          paths: batches[i],
          held: true,
          sweep: final ? { id, final: true } : { id },
        }),
        signal: AbortSignal.timeout(PRESENCE_TIMEOUT_MS),
      });
      if (!res.ok) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** The media this Mac holds, as the plane would push it (designRoot-relative). */
export function heldMediaRels(
  designRoot: string,
  opts: { canvasGroups?: readonly CanvasGroupLike[] } = {}
): string[] {
  return listPushableAssets(designRoot, {
    canvasGroups: opts.canvasGroups,
    syncFiles: true,
  }).filter(
    (rel) => classifyProjectFile(rel, { canvasGroups: opts.canvasGroups }) === 'inert-media'
  );
}

/**
 * The plane-side reporter: after a file-plane pass, report the held set when
 * it changed or the last report is older than `refreshMs` — never more often
 * than `floorMs`. Single-flight. Never throws.
 */
export function createHeldReporter(deps: {
  designRoot: string;
  canvasGroups?: readonly CanvasGroupLike[];
  send: (rels: string[]) => Promise<boolean>;
  now?: () => number;
  refreshMs?: number;
  floorMs?: number;
  list?: () => string[];
}) {
  const now = deps.now ?? Date.now;
  const refreshMs = deps.refreshMs ?? 10 * 60_000;
  const floorMs = deps.floorMs ?? 15_000;
  const list =
    deps.list ?? (() => heldMediaRels(deps.designRoot, { canvasGroups: deps.canvasGroups }));
  let lastAt = -Infinity;
  let lastHash: string | null = null;
  let running = false;
  return {
    async afterPass(): Promise<boolean> {
      const t = now();
      if (running || t - lastAt < floorMs) return false;
      running = true;
      try {
        const rels = list();
        const hash = createHash('sha256').update(rels.join('\n')).digest('hex');
        if (hash === lastHash && t - lastAt < refreshMs) return false;
        const ok = await deps.send(rels);
        if (ok) {
          lastAt = t;
          lastHash = hash;
        }
        return ok;
      } catch {
        return false;
      } finally {
        running = false;
      }
    },
  };
}
