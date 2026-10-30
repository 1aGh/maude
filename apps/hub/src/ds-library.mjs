// Team libraries over the hub — Maude v2 S10.18a (V2-1.6 §5.14, S10-slices row S10.18a).
//
//   GET /api/projects/:p/v1/ds/:system/head            → { head, log }   (the last 20 log entries)
//   GET /api/projects/:p/v1/ds/:system/revisions/:rev  → the revision JSON, byte for byte
//
// A LIBRARY is a design system inside this hub's project. A LINKING project copies its
// revisions in by id (S10.18b) and verifies each one before writing it (V2-1.6 §5.6), so
// these routes hand out bytes the receiver distrusts anyway (DDR-054).
//
// WHO MAY READ.
//   - A member of this project (any role that holds `read`, Can view included). A machine
//     token's DDR-053 scope must cover the file, exactly like the file door. A canvas-only
//     session never reaches the handler: the row is `project`-scoped and not a canvasDoor,
//     so the access gate refuses it (fail closed, V2-1.16 U1).
//   - A NON-member holding a library read grant for THAT system (`verifyGrant`). The grant
//     reaches exactly two files per system — `<ds.path>/revisions/head.json` and
//     `<ds.path>/revisions/<64 hex>.json` — and nothing else: every other path under
//     `/v1/ds/`, another system, another project, a symlinked file and a missing file give
//     ONE answer, the same 404 body (U1: invisible = absent).
//
// WHAT THE GRANT IS — the credential a non-member presents — lives in `ds-grants.mjs`
// (S10.18a-2, option A: a hub-minted token for one system, stored hashed, revocable). This
// module takes it as a seam, `verifyGrant(token) → { system, fetcher } | null`; the hub wires
// the grant store's verifier, which answers null while MAUDE_DS_LIBRARY_GRANTS is off — so a
// non-member is refused (401), never admitted, until Michal turns a cell on.
//
// GUESSING. A bearer that is neither a member's nor a live grant is a 401, and repeated 401s
// are limited per remote address and per bearer (`DS_GRANT_DOOR_LIMITS`): past the limit the
// door answers 429 before it looks at the grant at all. A member is never limited here.
//
// WHAT A GRANT HOLDER LEARNS. The pointer and the log's own words: per entry `rev`,
// `parent`, `action`, `at`, `by` and `summary`. Not `drafts`, not the library record, not
// the kernel `actionId`, and not `updated` / `leftOut` (this project's canvas counts, U5).
// "Used by N projects" goes to members only.
//
// "USED BY N PROJECTS" (§5.14): the distinct grant fetchers that read `head` in the last 90
// days, plus this project, where the library is edited. Kept in the hub's data dir — on a
// cell with an ephemeral disk it restarts from 1 after a rollout (a display count only).

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { presentedBearer } from './access-gate.mjs';
import { matchesScope } from './tokens.mjs';

/** The `/health` capability a v2 studio looks for before it offers "Link a team library…". */
export const DS_LIBRARY_CAPABILITY = 'ds-library';

/** How many log entries `head` returns (§5.14). */
export const DS_LIBRARY_LOG_ENTRIES = 20;
/** The revision cap (V2-1.6 §5.6, `ds/revision.ts REVISION_MAX_BYTES`). */
export const DS_REVISION_MAX_BYTES = 2 * 1024 * 1024;
/** head.json holds ≤ 50 log entries and ≤ a few drafts; anything larger is not one. */
export const DS_HEAD_MAX_BYTES = 256 * 1024;
/** "Used by N projects" looks back this far. */
export const DS_LIBRARY_USAGE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** A fetcher's last-seen time is rewritten at most this often (one write per fetcher per hour). */
const USAGE_TOUCH_MS = 60 * 60 * 1000;
const MAX_FETCHERS_PER_SYSTEM = 1000;
const MAX_SYSTEMS = 64;

const PROJECT = '[A-Za-z0-9._-]{1,128}';
/** Everything under a project's `/v1/ds` — one row, so no ds path falls through to another door. */
export const DS_LIBRARY_ROUTE = new RegExp(`^/api/projects/(${PROJECT})/v1/ds(?:/.*)?$`);
const HEAD_PATH = new RegExp(`^/api/projects/(${PROJECT})/v1/ds/([^/]{1,192})/head$`);
const REVISION_PATH = new RegExp(
  `^/api/projects/(${PROJECT})/v1/ds/([^/]{1,192})/revisions/([0-9a-f]{64})$`
);
/** The config door's system-name rule (`project-config-door.mjs`). */
const SYSTEM_NAME = /^[\w .-]{1,64}$/;
const FETCHER = /^[A-Za-z0-9._:@-]{1,128}$/;

/** U1 — one answer for missing, invisible, malformed and refused-by-shape. */
export const DS_LIBRARY_NOT_FOUND = Object.freeze({ error: 'not found', code: 'not-found' });
const UNAUTHENTICATED = Object.freeze({
  error: 'sign in to this project first',
  code: 'unauthenticated',
});
const METHOD_NOT_ALLOWED = Object.freeze({ error: 'method not allowed', code: 'method' });
const RATE_LIMITED = Object.freeze({
  error: 'too many tries — wait a few minutes',
  code: 'rate-limited',
});

/**
 * Repeated 401s at this door, per remote address and per bearer, in a sliding window.
 * Generous for a linking project (it checks every 30 min, S10.18b) and fatal to a guesser.
 */
export const DS_GRANT_DOOR_LIMITS = Object.freeze({
  perAddress: 30,
  perBearer: 10,
  windowMs: 15 * 60 * 1000,
});
const MAX_TRACKED_KEYS = 10_000;

/** Failures per key in a sliding window — memory only (a restart forgives; the secret is 256 bits). */
function createFailureWindow({ windowMs }) {
  const hits = new Map();
  const recent = (key, t) => (hits.get(key) ?? []).filter((at) => at > t - windowMs);
  return {
    count(key, t) {
      const list = recent(key, t);
      if (list.length === 0) hits.delete(key);
      else hits.set(key, list);
      return list.length;
    },
    add(key, t) {
      const list = recent(key, t);
      list.push(t);
      if (!hits.has(key) && hits.size >= MAX_TRACKED_KEYS) {
        for (const [k, v] of hits) if (!v.some((at) => at > t - windowMs)) hits.delete(k);
        if (hits.size >= MAX_TRACKED_KEYS) hits.delete(hits.keys().next().value);
      }
      hits.set(key, list);
    },
  };
}

const LOG_ENTRY_KEYS = ['rev', 'parent', 'action', 'at', 'summary'];

function decodeSystem(raw) {
  let name;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return SYSTEM_NAME.test(name) ? name : null;
}

/**
 * A contained, symlink-free regular file's bytes, or null. Strict on purpose: the grant
 * names exact paths, so ANY link on the way (DDR-054: a peer can commit one) is refused,
 * even one that stays inside the design root.
 */
export function readExactFile(designRoot, rel, maxBytes) {
  let fd = null;
  try {
    const realRoot = realpathSync(designRoot);
    const abs = join(realRoot, rel);
    if (realpathSync(abs) !== abs) return null;
    fd = openSync(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > maxBytes) return null;
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = readSync(fd, buf, off, st.size - off, off);
      if (n <= 0) break;
      off += n;
    }
    return off === st.size ? buf : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function projectLogEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const out = {};
  for (const k of LOG_ENTRY_KEYS) {
    if (typeof e[k] === 'string') out[k] = e[k];
    else if (e[k] === null && (k === 'parent' || k === 'rev')) out[k] = null;
  }
  if (e.by && typeof e.by === 'object' && typeof e.by.kind === 'string') {
    out.by = { kind: e.by.kind, ...(typeof e.by.name === 'string' ? { name: e.by.name } : {}) };
  }
  return out;
}

/** `{ head, log }` from head.json bytes, or null when they are not a ds-head. */
export function projectHead(bytes) {
  let doc;
  try {
    doc = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object' || doc.format !== 'maude.ds-head' || doc.v !== 1) return null;
  if (doc.head !== null && typeof doc.head !== 'string') return null;
  const log = Array.isArray(doc.log) ? doc.log : [];
  return {
    head: doc.head,
    log: log
      .slice(0, DS_LIBRARY_LOG_ENTRIES)
      .map(projectLogEntry)
      .filter((e) => e !== null),
  };
}

/**
 * The "used by N projects" counter: system → fetcher → last time it read `head`.
 *
 * @param {{ file?: string | null, now?: () => number }} [opts]  `file` null = memory only
 */
export function createDsLibraryUsage({ file = null, now = () => Date.now() } = {}) {
  let state = null;
  function load() {
    if (state) return state;
    state = {};
    if (!file) return state;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object' && raw.v === 1 && raw.systems) {
        for (const [sys, fetchers] of Object.entries(raw.systems).slice(0, MAX_SYSTEMS)) {
          if (!SYSTEM_NAME.test(sys) || !fetchers || typeof fetchers !== 'object') continue;
          const kept = {};
          for (const [f, at] of Object.entries(fetchers).slice(0, MAX_FETCHERS_PER_SYSTEM)) {
            if (FETCHER.test(f) && Number.isSafeInteger(at)) kept[f] = at;
          }
          state[sys] = kept;
        }
      }
    } catch {
      /* absent or unreadable: start at zero — a display count, never a gate */
    }
    return state;
  }
  function prune(fetchers, t) {
    for (const [f, at] of Object.entries(fetchers)) {
      if (at <= t - DS_LIBRARY_USAGE_WINDOW_MS) delete fetchers[f];
    }
  }
  function persist() {
    if (!file) return;
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify({ v: 1, systems: state })}\n`, { flag: 'wx' });
      renameSync(tmp, file);
    } catch {
      /* best effort: the count is display only */
    }
  }
  return {
    record(system, fetcher) {
      if (!SYSTEM_NAME.test(system) || !FETCHER.test(fetcher)) return;
      const s = load();
      const t = now();
      if (!s[system]) {
        if (Object.keys(s).length >= MAX_SYSTEMS) return;
        s[system] = {};
      }
      const fetchers = s[system];
      prune(fetchers, t);
      const last = fetchers[fetcher];
      if (last !== undefined && t - last < USAGE_TOUCH_MS) return;
      if (last === undefined && Object.keys(fetchers).length >= MAX_FETCHERS_PER_SYSTEM) return;
      fetchers[fetcher] = t;
      persist();
    },
    /** Distinct fetchers of `system` in the window (this project not included). */
    fetchers(system) {
      const fetchers = load()[system];
      if (!fetchers) return 0;
      const floor = now() - DS_LIBRARY_USAGE_WINDOW_MS;
      return Object.values(fetchers).filter((at) => at > floor).length;
    },
  };
}

/**
 * The runtime behind the row. `server.mjs` builds one per hub and hands it to
 * `runHubRoutes` as `deps.dsLibrary`.
 *
 * @param {object} deps
 * @param {string} deps.projectId                  this hub's project (`:p` must name it, or `current`)
 * @param {() => string | null} deps.designRoot    the checkout's design root; null = no library here
 * @param {() => Array<{ name: string, path: string }>} deps.systems  the project's design systems
 * @param {(request: object) => object | null} deps.auth  a member session `{ access, scope, ... }`
 * @param {((token: string) => { system: string, fetcher: string } | null) | null} [deps.verifyGrant]
 *        a non-member's library read grant: the ONE system it names and who fetches (the
 *        linking project). Null (the default) admits no non-member.
 * @param {ReturnType<typeof createDsLibraryUsage>} [deps.usage]
 * @param {(request: object) => string | null} [deps.clientIp]  the caller's address (the hub's
 *        trusted-proxy rule); default the socket's
 * @param {typeof DS_GRANT_DOOR_LIMITS | null} [deps.limits]  null = off (`rateLimit: false`)
 * @param {() => number} [deps.now]
 */
export function createDsLibraryRoutes({
  projectId,
  designRoot,
  systems,
  auth,
  verifyGrant = null,
  usage = createDsLibraryUsage(),
  clientIp = (request) => request?.socket?.remoteAddress ?? null,
  limits = DS_GRANT_DOOR_LIMITS,
  now = () => Date.now(),
}) {
  const failures = limits ? createFailureWindow({ windowMs: limits.windowMs }) : null;
  const bearerKey = (token) => `b:${createHash('sha256').update(token).digest('hex')}`;
  const addressKey = (request) => {
    let ip = null;
    try {
      ip = clientIp(request);
    } catch {
      ip = null;
    }
    return `a:${ip || 'unknown'}`;
  };
  /** Past the limit for this address or this bearer? */
  function limited(request, token) {
    if (!failures) return false;
    const t = now();
    return (
      failures.count(addressKey(request), t) >= limits.perAddress ||
      failures.count(bearerKey(token), t) >= limits.perBearer
    );
  }
  function failed(request, token) {
    if (!failures) return;
    const t = now();
    failures.add(addressKey(request), t);
    failures.add(bearerKey(token), t);
  }

  /** Is this hub serving libraries at all? `/health` and the row ask the same thing. */
  function enabled() {
    return typeof designRoot() === 'string';
  }

  function systemFor(name) {
    const list = Array.isArray(systems()) ? systems() : [];
    const d = list.find((s) => s && s.name === name);
    if (!d || typeof d.path !== 'string') return null;
    const p = d.path.replace(/\/+$/, '');
    if (!p || p.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(p) || /[\\\0]/.test(p)) return null;
    return { name, path: p };
  }

  /**
   * Who is asking: `{ kind: 'member', who }`, `{ kind: 'grant', system, fetcher }`, `null`
   * (a member session that may not read here), `undefined` (no credential that verifies) or
   * `'limited'` (a bearer from an address, or a bearer, past the 401 limit).
   */
  function reader(request) {
    const r = identify(request);
    const token = r === undefined ? presentedBearer(request) : null;
    if (token) failed(request, token);
    return r;
  }

  function identify(request) {
    const who = auth(request);
    if (who) {
      const access = who.access;
      // A non-peer credential (operator, cell secret) is project-level.
      if (!access) return { kind: 'member', who };
      if (access.canvasOnly || !access.can('read', null)) return null;
      return { kind: 'member', who };
    }
    const token = presentedBearer(request);
    if (!token) return undefined;
    if (limited(request, token)) return 'limited';
    if (typeof verifyGrant !== 'function') return undefined;
    let grant = null;
    try {
      grant = verifyGrant(token);
    } catch {
      grant = null;
    }
    if (!grant || typeof grant !== 'object') return undefined;
    if (typeof grant.system !== 'string' || !SYSTEM_NAME.test(grant.system)) return undefined;
    if (typeof grant.fetcher !== 'string' || !FETCHER.test(grant.fetcher)) return undefined;
    if (grant.project !== undefined && grant.project !== projectId) return undefined;
    return { kind: 'grant', system: grant.system, fetcher: grant.fetcher };
  }

  const scopeCovers = (r, rel) => r.kind !== 'member' || matchesScope(r.who.scope ?? '*', rel);

  /** One request. Returns true when answered, false when the path is not under `/v1/ds`. */
  async function handle({ path, method, request, respondJson, response }) {
    if (!DS_LIBRARY_ROUTE.test(path)) return false;
    const notFound = () => {
      respondJson(404, { ...DS_LIBRARY_NOT_FOUND });
      return true;
    };
    if (method !== 'GET' && method !== 'HEAD') {
      respondJson(405, { ...METHOD_NOT_ALLOWED });
      return true;
    }
    const root = designRoot();
    if (typeof root !== 'string') return notFound();

    const head = HEAD_PATH.exec(path);
    const rev = head ? null : REVISION_PATH.exec(path);
    const m = head ?? rev;
    // Identify the caller before judging the shape, so an anonymous probe learns nothing
    // about which ds paths exist.
    const rawSystem = /^\/api\/projects\/[^/]+\/v1\/ds\/([^/]{1,192})(?:\/|$)/.exec(path)?.[1];
    const askedSystem = rawSystem ? decodeSystem(rawSystem) : null;
    const r = reader(request);
    if (r === 'limited') {
      respondJson(429, { ...RATE_LIMITED });
      return true;
    }
    if (r === undefined) {
      respondJson(401, { ...UNAUTHENTICATED });
      return true;
    }
    if (r === null || !m) return notFound();
    const [, project, , revId] = m;
    if (project !== projectId && project !== 'current') return notFound();
    // A grant reaches its own system only; another one answers exactly as a missing one.
    if (r.kind === 'grant' && askedSystem !== r.system) return notFound();
    const sys = askedSystem ? systemFor(askedSystem) : null;
    if (!sys) return notFound();

    if (head) {
      const rel = `${sys.path}/revisions/head.json`;
      if (!scopeCovers(r, rel)) return notFound();
      const bytes = readExactFile(root, rel, DS_HEAD_MAX_BYTES);
      const body = bytes ? projectHead(bytes) : null;
      if (!body) return notFound();
      if (r.kind === 'grant') {
        usage.record(sys.name, r.fetcher);
        respondJson(200, body);
      } else {
        respondJson(200, { ...body, usedBy: 1 + usage.fetchers(sys.name) });
      }
      return true;
    }

    const rel = `${sys.path}/revisions/${revId}.json`;
    if (!scopeCovers(r, rel)) return notFound();
    const bytes = readExactFile(root, rel, DS_REVISION_MAX_BYTES);
    if (!bytes) return notFound();
    response
      .writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': bytes.length,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(method === 'HEAD' ? undefined : bytes);
    return true;
  }

  return { handle, enabled };
}

/** The row handler: the runtime comes in through `ctx.deps.dsLibrary` (server.mjs). */
async function dsLibraryHandler(ctx) {
  const lib = ctx.deps?.dsLibrary;
  if (!lib || typeof lib.handle !== 'function') return false;
  return lib.handle(ctx);
}

/**
 * The row (one table, S9 Q12). `read` on a GET for a member; a non-member's grant is not a
 * peer token, so the gate passes it to the handler, which judges it per system. `project`
 * scope and no canvasDoor: a canvas-only session is refused at the gate.
 */
export const DS_LIBRARY_ROWS = Object.freeze([
  {
    pattern: DS_LIBRARY_ROUTE,
    cap: { safe: 'read', unsafe: 'edit' },
    scope: 'project',
    handler: dsLibraryHandler,
  },
]);
