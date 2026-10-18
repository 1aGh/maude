// Asset presence — "Waiting for Jonas's Mac" vs Missing (S8.19, contract
// `apps/studio/client/v2/contracts/S8-S9-asset-presence.md`, decision
// v2-contract-asset-presence-probe-fed).
//
// The hub records, per asset path, which devices HOLD it (from `/_asset-probe`
// batches flagged `held`) and, per device, when its last sweep FINISHED (the
// batch flagged `sweep.final`). `GET /api/projects/:p/v1/asset-presence?rel=…`
// turns that into `here | waiting{who} | missing | unknown`, filtered by what
// the asking session sees.
//
// Hub RUNTIME, never a project file: `<dataDir>/asset-presence.json`, outside
// the design root, so no DDR-115 list changes and nothing here ever syncs.
//
// The conservative side wins every tie: a path the session does not see is
// `unknown` (byte-identical to a path the hub never heard of — V2-1.16 U1), and
// `missing` needs at least one device that SWEPT after the reference appeared
// and did not report the file. A team where no device ever sweeps (v1-only
// studios, which never send the fields) keeps every absent file `waiting`.
//
// A device is named by display name only (L17): `who` never carries an e-mail
// or a device id, and `account` is an opaque hash, never the address.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAccess } from '../../studio/access/scope.ts';
import { fileAccessFor } from './access-files.mjs';
import { claimForMatch, presentedBearer } from './access-gate.mjs';
import { checkoutRelShape, presenceHolds, presenceVisible } from './assets.mjs';

export const PRESENCE_FILE = 'asset-presence.json';
export const MAX_PRESENCE_PATHS = 50_000;
export const MAX_PRESENCE_DEVICES = 64;
/** A holder entry or a device not seen for this long is dropped (contract O3). */
export const PRESENCE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
/** Writes are debounced to at most one per this window. */
export const PRESENCE_WRITE_DEBOUNCE_MS = 5000;
/** Max `rel` per presence query. */
export const MAX_PRESENCE_QUERY_RELS = 256;

const SWEEP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const KINDS = new Set(['mac', 'pc', 'linux']);

/** The display name the people list uses (L17) — never the address itself. */
export const presenceNameOf = (email) => {
  const local = String(email ?? '').split('@')[0];
  return local ? local : null;
};

/** An opaque, stable account id: the same person on two Macs matches, nothing reverses it. */
export const presenceAccountOf = (email, salt = '') => {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!e) return '';
  return createHash('sha256').update(`maude-presence\0${salt}\0${e}`).digest('hex').slice(0, 24);
};

const emptyStore = () => ({ v: 1, holders: {}, devices: {}, firstAskedAt: {} });

function sanitize(raw) {
  const out = emptyStore();
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return out;
  for (const [k, d] of Object.entries(raw.devices ?? {})) {
    if (!d || typeof d !== 'object' || !Number.isFinite(d.seenAt)) continue;
    out.devices[k] = {
      name: typeof d.name === 'string' ? d.name : null,
      kind: KINDS.has(d.kind) ? d.kind : null,
      account: typeof d.account === 'string' ? d.account : '',
      seenAt: d.seenAt,
      ...(Number.isFinite(d.sweptAt) ? { sweptAt: d.sweptAt } : {}),
    };
  }
  for (const [rel, hs] of Object.entries(raw.holders ?? {})) {
    if (!hs || typeof hs !== 'object') continue;
    const row = {};
    for (const [k, h] of Object.entries(hs)) {
      if (h && Number.isFinite(h.seenAt)) {
        row[k] = { seenAt: h.seenAt, ...(typeof h.sweep === 'string' ? { sweep: h.sweep } : {}) };
      }
    }
    if (Object.keys(row).length) out.holders[rel] = row;
  }
  for (const [rel, at] of Object.entries(raw.firstAskedAt ?? {})) {
    if (Number.isFinite(at)) out.firstAskedAt[rel] = at;
  }
  return out;
}

/**
 * One hub's presence store.
 *
 * @param {{ dataDir?: string | null, now?: () => number,
 *           setTimer?: (fn: () => void, ms: number) => unknown,
 *           clearTimer?: (t: unknown) => void }} opts
 */
export function createAssetPresence({
  dataDir = null,
  salt = '',
  now = Date.now,
  setTimer = (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimer = (t) => clearTimeout(t),
} = {}) {
  const file = dataDir ? join(dataDir, PRESENCE_FILE) : null;
  let store = emptyStore();
  if (file && existsSync(file)) {
    try {
      store = sanitize(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      store = emptyStore(); // a torn file costs history, never a boot
    }
  }

  let timer = null;
  let dirty = false;
  function flush() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (!dirty || !file) return;
    dirty = false;
    try {
      mkdirSync(dataDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(store));
      renameSync(tmp, file);
    } catch (err) {
      console.error(`[asset-presence] write failed: ${err?.message ?? err}`);
    }
  }
  function touch() {
    dirty = true;
    if (timer === null) timer = setTimer(flush, PRESENCE_WRITE_DEBOUNCE_MS);
  }

  /** Drop every holder entry and device past the expiry window. */
  function expire() {
    const floor = now() - PRESENCE_EXPIRY_MS;
    let changed = false;
    for (const [k, d] of Object.entries(store.devices)) {
      if (d.seenAt < floor) {
        delete store.devices[k];
        changed = true;
      }
    }
    for (const [rel, hs] of Object.entries(store.holders)) {
      for (const [k, h] of Object.entries(hs)) {
        if (h.seenAt < floor || !store.devices[k]) {
          delete hs[k];
          changed = true;
        }
      }
      if (Object.keys(hs).length === 0) delete store.holders[rel];
    }
    if (changed) touch();
  }

  /** Room for one more device: evict the least recently seen (and its holdings). */
  function ensureDevice(key, info) {
    const at = now();
    const prev = store.devices[key];
    if (!prev) {
      const keys = Object.keys(store.devices);
      if (keys.length >= MAX_PRESENCE_DEVICES) {
        keys.sort((a, b) => store.devices[a].seenAt - store.devices[b].seenAt);
        const gone = keys[0];
        delete store.devices[gone];
        for (const [rel, hs] of Object.entries(store.holders)) {
          delete hs[gone];
          if (Object.keys(hs).length === 0) delete store.holders[rel];
        }
      }
    }
    store.devices[key] = {
      name: info.name ?? null,
      kind: KINDS.has(info.kind) ? info.kind : null,
      account: info.account ?? '',
      seenAt: at,
      ...(prev && Number.isFinite(prev.sweptAt) ? { sweptAt: prev.sweptAt } : {}),
    };
    return store.devices[key];
  }

  /**
   * One probe batch from one device. `rels` are ALREADY filtered to the paths
   * the caller sees and may write (the probe's gate) — this trusts its caller,
   * never the body.
   *
   * @param {{ device: { key: string, name?: string|null, kind?: string|null, account?: string },
   *           rels: string[], sweep?: { id: string, final?: boolean } | null }} batch
   */
  function recordProbe({ device, rels, sweep = null }) {
    if (!device || typeof device.key !== 'string' || !device.key) return;
    expire();
    const d = ensureDevice(device.key, device);
    const at = d.seenAt;
    const sweepId = sweep && SWEEP_ID.test(sweep.id) ? sweep.id : null;
    let paths = Object.keys(store.holders).length;
    for (const rel of rels) {
      let hs = store.holders[rel];
      if (!hs) {
        if (paths >= MAX_PRESENCE_PATHS) continue; // full: the claim is dropped, never a crash
        hs = store.holders[rel] = {};
        paths += 1;
      }
      hs[device.key] = { seenAt: at, ...(sweepId ? { sweep: sweepId } : {}) };
      // Bytes are on their way: the reference is no longer "first asked" news.
    }
    if (sweepId && sweep.final === true) {
      d.sweptAt = at;
      // It no longer has what it held before and did not report in this run.
      for (const [rel, hs] of Object.entries(store.holders)) {
        const h = hs[device.key];
        if (h && h.sweep !== sweepId) delete hs[device.key];
        if (Object.keys(hs).length === 0) delete store.holders[rel];
      }
    }
    touch();
  }

  /**
   * The §5.3 state of one path. The caller decided scope and bytes.
   *
   * @param {{ rel: string, inScope: boolean, hasBytes: boolean,
   *           asker: { key: string, account: string } }} q
   * @returns {{ state: 'here'|'waiting'|'missing'|'unknown',
   *             who?: { name: string|null, kind: string|null, self: boolean } }}
   */
  function stateFor({ rel, inScope, hasBytes, asker }) {
    if (!inScope) return { state: 'unknown' }; // nothing recorded (U1)
    if (hasBytes) {
      if (store.firstAskedAt[rel] !== undefined) {
        delete store.firstAskedAt[rel];
        touch();
      }
      return { state: 'here' };
    }
    expire();
    const whoOf = (k) => {
      const d = store.devices[k];
      return {
        name: d?.name ?? null,
        kind: d?.kind ?? null,
        self: Boolean(d?.account && asker?.account && d.account === asker.account),
      };
    };
    // The first in-scope query that finds no bytes starts the clock — before
    // the holder check, so a holder that later sweeps without the file has
    // swept AFTER the reference appeared.
    let first = store.firstAskedAt[rel];
    if (first === undefined) {
      if (Object.keys(store.firstAskedAt).length < MAX_PRESENCE_PATHS) {
        first = store.firstAskedAt[rel] = now();
        touch();
      } else {
        first = now(); // full: never recorded, so it can never turn missing
      }
    }

    // 3. Someone else holds it.
    const hs = store.holders[rel] ?? {};
    let best = null;
    for (const [k, h] of Object.entries(hs)) {
      if (k === asker?.key || !store.devices[k]) continue;
      if (!best || h.seenAt > hs[best].seenAt) best = k;
    }
    if (best) return { state: 'waiting', who: whoOf(best) };

    // 4. Some recent device has not finished a sweep since.
    const recent = Object.values(store.devices);
    // Nobody ever sweeps here (a v1-only team, or no studio yet) — conservative.
    if (recent.length === 0) return { state: 'waiting' };
    for (const d of recent) {
      if (!Number.isFinite(d.sweptAt) || d.sweptAt <= first) return { state: 'waiting' };
    }
    // 5. Every recent device swept after the reference appeared; none holds it.
    return { state: 'missing' };
  }

  /**
   * The `/_asset-probe` hook (§5.2): a v1 body records nothing; a `held` body
   * records the caller's device as holder of each path it sees and may write.
   * Never throws into the probe — presence is a hint, the probe's answer is not.
   */
  function feedProbe({ match, access, body, paths }) {
    try {
      const fields = probePresenceFields(body);
      if (!fields || !match || !access || !Array.isArray(paths)) return;
      const rels = paths.filter(
        (rel) =>
          typeof rel === 'string' && checkoutRelShape(rel) && presenceMayHold(match, access, rel)
      );
      recordProbe({ device: presenceDeviceFor(match, { salt }), rels, sweep: fields.sweep });
    } catch (err) {
      console.error(`[asset-presence] probe feed failed: ${err?.message ?? err}`);
    }
  }

  return {
    recordProbe,
    feedProbe,
    stateFor,
    flush,
    salt,
    /** Test seam: the live store (read-only by convention). */
    snapshot: () => JSON.parse(JSON.stringify(store)),
  };
}

// ------------------------------------------------------------- probe feeding

/**
 * The two optional `/_asset-probe` body fields (§5.2), read defensively.
 * A v1 body (no fields) yields `null` — nothing is recorded.
 */
export function probePresenceFields(body) {
  if (!body || body.held !== true) return null;
  const s = body.sweep;
  const sweep =
    s && typeof s === 'object' && typeof s.id === 'string' && SWEEP_ID.test(s.id)
      ? { id: s.id, final: s.final === true }
      : null;
  return { sweep };
}

/** The device a verified peer token stands for (one label per linked Mac). */
export function presenceDeviceFor(match, { salt = '' } = {}) {
  return {
    key: String(match?.label ?? ''),
    name: presenceNameOf(match?.owner),
    kind: null, // no source on the hub yet: the client words a null kind neutrally
    account: presenceAccountOf(match?.owner, salt),
  };
}

/**
 * May this session claim to HOLD `rel`? The probe's existing gate (it already
 * passed the `edit` door) plus `sees` and, for a canvas-only session, its own
 * write predicate (§5.6: "only closure paths").
 */
export function presenceMayHold(match, access, rel) {
  if (!access || !access.sees(rel)) return false;
  if (access.mode === 'canvas') return access.writes(rel, { exists: true });
  if (access.mode !== 'project') return false;
  if (match?.readOnly) return false;
  return resolveAccess(claimForMatch(match)).can('edit', null);
}

// --------------------------------------------------------------- query route

const PRESENCE_PATH = /^\/api\/projects\/[A-Za-z0-9._-]{1,128}\/v1\/asset-presence$/;
export const ASSET_PRESENCE_PATTERN = PRESENCE_PATH;

/**
 * `GET /api/projects/:p/v1/asset-presence?rel=…` — the routes-v2 row's handler.
 * `ctx.deps.presence` = `{ store, dataDir, designRoot, journal, materializer,
 * checkReadRateLimit? }`, built once by `server.mjs`.
 */
export async function handleAssetPresenceRoute(ctx) {
  const dep = ctx.deps?.presence;
  if (!dep?.store) return false; // a hub without the store: the lane's own 404
  if (!PRESENCE_PATH.test(ctx.path)) return false;
  if (ctx.method !== 'GET') {
    ctx.respondJson(405, { error: 'method not allowed' });
    return true;
  }
  const token = presentedBearer(ctx.request);
  let match = null;
  try {
    match = token ? ctx.verify(token) : null;
  } catch {
    match = null;
  }
  if (!match) {
    ctx.respondJson(401, { error: 'unauthorized' });
    return true;
  }
  if (dep.checkReadRateLimit && !dep.checkReadRateLimit(match.label)) {
    ctx.respondJson(429, { error: 'rate limited' });
    return true;
  }
  const url = new URL(ctx.request.url ?? '/', 'http://hub.invalid');
  const rels = url.searchParams.getAll('rel');
  if (rels.length > MAX_PRESENCE_QUERY_RELS) {
    ctx.respondJson(413, { error: `at most ${MAX_PRESENCE_QUERY_RELS} rels per query` });
    return true;
  }
  if (rels.length === 0 || rels.some((r) => !checkoutRelShape(r))) {
    ctx.respondJson(400, { error: 'expected ?rel=<path>' });
    return true;
  }
  const access = fileAccessFor(match, {
    designRoot: dep.designRoot,
    journal: dep.journal,
    dataDir: dep.dataDir,
  });
  const asker = presenceDeviceFor(match, { salt: dep.store.salt });
  const items = rels.map((rel) => {
    const inScope = presenceVisible(access, dep.designRoot, rel);
    const hasBytes = inScope && presenceHolds(dep, rel);
    const s = dep.store.stateFor({ rel, inScope, hasBytes, asker });
    return { rel, state: s.state, ...(s.who ? { who: s.who } : {}) };
  });
  ctx.respondJson(200, { items });
  return true;
}

/** The routes-v2 rows for this area (S9 Q12): one GET, filtered, a canvas door. */
export const ASSET_PRESENCE_ROWS = Object.freeze([
  Object.freeze({
    pattern: ASSET_PRESENCE_PATTERN,
    cap: Object.freeze({ safe: 'read', unsafe: 'edit' }),
    scope: 'filtered',
    // A canvas-only session is answered here, per rel: `unknown` outside its
    // closure, the same bytes as a path the hub never heard of (U1).
    canvasDoor: true,
    handler: handleAssetPresenceRoute,
  }),
]);
