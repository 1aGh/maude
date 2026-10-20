// Team libraries — the linking side (S10.18b; V2-1.6 §5.14, canvases 13/ds-many-library, 13/ds-many-linked).
//
// A LIBRARY is a design system inside another project's hub (S10.18a serves its `head` and its revisions). A
// LINKING project holds a full local copy: the working files materialised from the linked head, the revisions
// copied in under the SAME ids (content addressing keeps them byte-identical) and a `head.json` `library` record.
//
//   link    url (+ a grant) → the hub's `/health` must list `ds-library` (an older hub fails closed: nothing is
//           offered, nothing is written) → head → the head revision, verified → config entry + the Design system
//           canvas (our template, never upstream bytes) + revision + working files → head.json LAST.
//   check   head only; `library.upstreamHead` moves when the hub's head moved (head.json is written only then —
//           a quiet check writes nothing to the shared file). At most once per 30 min unless forced.
//   review  `{changes: diff(head → upstream), by, at, canvases}` — what "Update from <system>? N changes" and the
//           project's own "Update N canvases" draw. Read-only here (the revision is fetched and verified, not kept).
//   update  ONE action: the verified revision in, the working files materialised, the unticked canvases left out
//           at the old head (the kernel), head = base = upstream, log `library`. ⌘Z goes through ds/undo-hook.ts.
//   unlink  `library` → null; the copy becomes an ordinary local system and its revisions stay.
//
// UNTRUSTED UPSTREAM (DDR-054). Every byte from the hub is hostile until proven otherwise:
//   - a revision is written only after `verifyRevision` (id = sha256 of the canonical body, every file's sha256);
//   - a revision may carry exactly the four working files (one top-level tokens `.css`, `tokens.json`,
//     `components.json`, `preview/_components.css`) — any other key refuses the whole revision;
//   - every read is bounded (head 256 KiB, revision 2 MiB) by the bytes actually read, never `Content-Length`;
//   - no redirect is followed (a bearer never reaches a second origin); https only (http on loopback);
//   - writes stay inside `<designRoot>/system/<name>/` and refuse a symlinked folder on the way;
//   - names, labels and summaries are display data (DDR-172 D8): bounded, shown, never obeyed.
// The grant is a credential: it lives in this Mac's own store, keyed by the hub origin it was issued for, and is
// sent to that origin only — never in head.json (which syncs to peers), never in a URL. A peer that rewrites
// `library.hub` in head.json gets no credential sent and no request made (this Mac holds nothing for that origin).
//
// THE LINK IS THIS MAC'S TOO (gate-b-sec1, A3). head.json syncs: a peer with Can edit can point its `library`
// record at ANY hub, project and system — one where THIS Mac holds a grant or a member token (hubs.json) the peer
// does not. So a credential is used only for a library this Mac linked itself: the same store keeps, per local
// design root and system, the address the person linked here (`links`, never synced). A record that is not in it
// — a peer's rewrite, or a copy that arrived by sync — sends nothing and asks nothing: `ds-library-relink`, and
// the card names the hub's host so "Link again" is a choice the person makes knowingly.
//
// IN A CELL (A5) the studio is the hub's own process, shared by every member, behind the cloud's network: a
// library link there is https to a named host only (no loopback, no IP literal), and the route refuses every
// library action but Unlink (the hub's manifest refuses the whole route too). See decision
// `maude/v2-gate-b-sec1-no-library-in-cell`.

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { atomicWrite } from '../sync/atomic-write.ts';
import { hubHealth } from '../sync/journal-client.ts';
import { isWorkspaceMode } from '../workspace-mode.ts';
import { designSystemCanvasMeta, designSystemCanvasSource } from './board/template.ts';
import {
  COMPONENTS_JSON_KEY,
  DS_CANVAS,
  DS_META,
  type DsEngine,
  DsEngineError,
  TOKENS_JSON_KEY,
  type TokenChange,
  tokenDiff,
  withLock,
} from './engine.ts';
import { parseSystem, type TokenModel } from './generate.ts';
import { type By, type HeadDoc, type LogEntry, newHead, readHead, writeHead } from './head.ts';
import {
  COMPONENTS_CSS_KEY,
  DEFAULT_TOKENS_KEY,
  REVISION_MAX_BYTES,
  type RevisionBody,
  revisionWritePlan,
  serializeRevision,
  verifyRevision,
} from './revision.ts';
import type { SystemConfig } from './system.ts';

export const LIBRARY_FORMAT = 'maude.ds-library';
export const LIBRARY_CAPABILITY = 'ds-library';
/** "on project open and every 30 min online" (V2-1.6 Q6) */
export const LIBRARY_CHECK_MS = 30 * 60 * 1000;
export const LIBRARY_HEAD_MAX_BYTES = 256 * 1024;
export const LIBRARY_TIMEOUT_MS = 10_000;
const LOG_SEEN = 20;

/* ------------------------------------------------------------------ errors */

export type LibraryErrorCode =
  | 'ds-library-url'
  | 'ds-library-unsupported'
  | 'ds-library-unreachable'
  | 'ds-library-denied'
  | 'ds-library-not-found'
  | 'ds-library-invalid'
  | 'ds-library-too-large'
  | 'ds-library-moved'
  | 'ds-library-not-linked'
  | 'ds-library-up-to-date'
  | 'ds-library-no-grant'
  | 'ds-library-relink';

const STATUS: Record<LibraryErrorCode, number> = {
  'ds-library-url': 400,
  'ds-library-unsupported': 409,
  'ds-library-unreachable': 502,
  'ds-library-denied': 403,
  'ds-library-not-found': 404,
  'ds-library-invalid': 422,
  'ds-library-too-large': 413,
  'ds-library-moved': 409,
  'ds-library-not-linked': 409,
  'ds-library-up-to-date': 409,
  'ds-library-no-grant': 409,
  'ds-library-relink': 409,
};

export class DsLibraryError extends Error {
  readonly code: LibraryErrorCode;
  readonly status: number;
  constructor(code: LibraryErrorCode, message: string) {
    super(message);
    this.name = 'DsLibraryError';
    this.code = code;
    this.status = STATUS[code];
  }
}
const fail = (code: LibraryErrorCode, m: string) => new DsLibraryError(code, m);

/* ---------------------------------------------------------------- the URL */

const SYSTEM_RE = /^[a-z][a-z0-9-]{0,63}$/;
const PROJECT_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ID_RE = /^[0-9a-f]{64}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** an IP literal host (v4 dotted, or a bracketed v6) — never a library's home from a cell */
const IP_LITERAL = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]*\])$/i;

export interface UrlRules {
  /** this process is a workspace cell: https to a named host only */
  cell?: boolean;
}
const API_PATH = /^\/api\/projects\/([^/]+)\/v1\/ds\/([^/]+)(?:\/head)?\/?$/;

export interface LibraryAddress {
  /** the hub's origin, e.g. `https://alligators.cloud.maude.sh` */
  hub: string;
  project: string;
  system: string;
}

/**
 * `https://<hub>/api/projects/<project>/v1/ds/<system>[/head]` → its parts. https only (http on loopback, a
 * self-hosted hub on this Mac); no user info, no query, no fragment — a credential never rides in a URL.
 */
export function parseLibraryUrl(raw: unknown, rules: UrlRules = {}): LibraryAddress {
  const cell = rules.cell ?? isWorkspaceMode();
  if (typeof raw !== 'string' || !raw || raw.length > 2048)
    throw fail('ds-library-url', 'The library link is a web address.');
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw fail('ds-library-url', 'That is not a library link.');
  }
  const https = u.protocol === 'https:';
  if (!https && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname) && !cell))
    throw fail('ds-library-url', 'A library link starts with https://.');
  // a cell sits inside the cloud's network: a link names a public host, never this machine or an address
  if (
    cell &&
    (LOOPBACK.has(u.hostname) ||
      IP_LITERAL.test(u.hostname) ||
      !u.hostname.includes('.') ||
      /\.(?:localhost|internal|local)$/i.test(u.hostname))
  )
    throw fail('ds-library-url', 'A library link names its hub’s web address.');
  if (u.username || u.password || u.search || u.hash)
    throw fail('ds-library-url', 'A library link carries no password, query or #part.');
  const m = API_PATH.exec(u.pathname);
  if (!m) throw fail('ds-library-url', 'That is not a library link.');
  let project: string;
  let system: string;
  try {
    project = decodeURIComponent(m[1]);
    system = decodeURIComponent(m[2]);
  } catch {
    throw fail('ds-library-url', 'That is not a library link.');
  }
  if (!PROJECT_RE.test(project) || !SYSTEM_RE.test(system))
    throw fail('ds-library-url', 'That is not a library link.');
  return { hub: u.origin, project, system };
}

/* ------------------------------------------------------------ the grants */

/** This Mac's library grants — a credential store, outside every project tree. */
export interface GrantStore {
  get(hub: string, project: string, system: string): string | null;
  set(hub: string, project: string, system: string, grant: string): void;
  delete(hub: string, project: string, system: string): void;
  /**
   * The libraries linked ON THIS MAC (A3): local design root + local system → the address the person linked.
   * Never synced; a head.json `library` record that is not here gets no credential.
   */
  linkOf(root: string, ds: string): LibraryAddress | null;
  setLink(root: string, ds: string, a: LibraryAddress): void;
  deleteLink(root: string, ds: string): void;
}

const GRANT_RE = /^[A-Za-z0-9._~+/=-]{8,4096}$/;
const grantKey = (hub: string, project: string, system: string) => `${hub}|${project}|${system}`;
/** the design root as the disk names it (a /var ↔ /private/var spelling is one root) */
function rootKey(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}
const linkKey = (root: string, ds: string) => `${rootKey(root)}|${ds}`;
const sameAddress = (a: LibraryAddress | null, b: LibraryAddress) =>
  !!a && a.hub === b.hub && a.project === b.project && a.system === b.system;

function asAddress(v: unknown): LibraryAddress | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return typeof o.hub === 'string' && typeof o.project === 'string' && typeof o.system === 'string'
    ? { hub: o.hub, project: o.project, system: o.system }
    : null;
}

/** `~/.config/maude/ds-library-grants.json`, mode 0600 (XDG-aware; `MAUDE_DS_LIBRARY_GRANTS_PATH` overrides). */
export function grantsPath(env: Record<string, string | undefined> = process.env): string {
  if (env.MAUDE_DS_LIBRARY_GRANTS_PATH) return env.MAUDE_DS_LIBRARY_GRANTS_PATH;
  const base = env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(base, 'maude', 'ds-library-grants.json');
}

export function fileGrantStore(file: string = grantsPath()): GrantStore {
  type Doc = { grants: Record<string, string>; links: Record<string, LibraryAddress> };
  const read = (): Doc => {
    const out: Doc = { grants: {}, links: {} };
    try {
      const v = JSON.parse(readFileSync(file, 'utf8'));
      const g =
        v && typeof v === 'object' && v.grants && typeof v.grants === 'object' ? v.grants : {};
      for (const [k, t] of Object.entries(g))
        if (typeof t === 'string' && GRANT_RE.test(t)) setOwn(out.grants, k, t);
      const l = v && typeof v === 'object' && v.links && typeof v.links === 'object' ? v.links : {};
      for (const [k, a] of Object.entries(l)) {
        const addr = asAddress(a);
        if (addr) setOwn(out.links, k, addr);
      }
    } catch {
      /* none yet */
    }
    return out;
  };
  const write = (d: Doc) => {
    mkdirSync(path.dirname(file), { recursive: true });
    atomicWrite(file, `${JSON.stringify(d, null, 2)}\n`);
    try {
      chmodSync(file, 0o600);
    } catch {
      /* not POSIX */
    }
  };
  return {
    get: (h, p, s) => read().grants[grantKey(h, p, s)] ?? null,
    set(h, p, s, grant) {
      const d = read();
      setOwn(d.grants, grantKey(h, p, s), grant);
      write(d);
    },
    delete(h, p, s) {
      const d = read();
      if (!(grantKey(h, p, s) in d.grants)) return;
      delete d.grants[grantKey(h, p, s)];
      write(d);
    },
    linkOf: (root, ds) => read().links[linkKey(root, ds)] ?? null,
    setLink(root, ds, a) {
      const d = read();
      setOwn(d.links, linkKey(root, ds), { hub: a.hub, project: a.project, system: a.system });
      write(d);
    },
    deleteLink(root, ds) {
      const d = read();
      if (!(linkKey(root, ds) in d.links)) return;
      delete d.links[linkKey(root, ds)];
      write(d);
    },
  };
}

/** An in-memory store (tests, and a session that should keep nothing). */
export function memoryGrantStore(seed: Record<string, string> = {}): GrantStore {
  const g = new Map(Object.entries(seed));
  const l = new Map<string, LibraryAddress>();
  return {
    get: (h, p, s) => g.get(grantKey(h, p, s)) ?? null,
    set: (h, p, s, t) => void g.set(grantKey(h, p, s), t),
    delete: (h, p, s) => void g.delete(grantKey(h, p, s)),
    linkOf: (root, ds) => l.get(linkKey(root, ds)) ?? null,
    setLink: (root, ds, a) =>
      void l.set(linkKey(root, ds), { hub: a.hub, project: a.project, system: a.system }),
    deleteLink: (root, ds) => void l.delete(linkKey(root, ds)),
  };
}

/* ------------------------------------------------------------- the record */

export interface LibraryRecord {
  hub: string;
  project: string;
  system: string;
  label: string;
  linkedAt: string;
  linkedBy: By;
  upstreamHead: string | null;
  checkedAt: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const DISPLAY_STRIP = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
/** Display text from upstream: control / format characters dropped, bounded. Never a command. */
export const displayText = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(DISPLAY_STRIP, '').trim().slice(0, max);
  return s || null;
};

/** head.json's `library`, as this module wrote it — or null when it is not one (a peer's edit). */
export function libraryOf(doc: HeadDoc, rules: UrlRules = {}): LibraryRecord | null {
  const l = doc.library;
  if (!isObj(l)) return null;
  let addr: LibraryAddress;
  try {
    const hub = typeof l.hub === 'string' ? new URL(l.hub).origin : '';
    addr = parseLibraryUrl(
      `${hub}/api/projects/${encodeURIComponent(String(l.project))}/v1/ds/${encodeURIComponent(String(l.system))}`,
      rules
    );
  } catch {
    return null;
  }
  const rev = (v: unknown) => (typeof v === 'string' && ID_RE.test(v) ? v : null);
  return {
    ...addr,
    label: displayText(l.label, 120) ?? addr.system,
    linkedAt: typeof l.linkedAt === 'string' ? l.linkedAt.slice(0, 40) : '',
    linkedBy: isObj(l.linkedBy) ? (l.linkedBy as By) : { kind: 'person' },
    upstreamHead: rev(l.upstreamHead),
    checkedAt: typeof l.checkedAt === 'string' ? l.checkedAt.slice(0, 40) : null,
  };
}

/* ---------------------------------------------------------- the hub client */

/** The projected head the hub serves: `{head, log}` (S10.18a). */
export interface UpstreamHead {
  head: string | null;
  log: {
    rev: string;
    parent: string | null;
    action: string;
    at: string | null;
    by: By | null;
    summary: string | null;
  }[];
  usedBy: number | null;
}

async function readBounded(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw fail('ds-library-too-large', 'The library sent more than a design system can be.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/** The projected head, checked: `head` an id or null, at most 20 log entries of display data. */
export function parseUpstreamHead(text: string): UpstreamHead {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw fail('ds-library-invalid', 'The library answered with something that is not a head.');
  }
  if (!isObj(doc) || !(doc.head === null || (typeof doc.head === 'string' && ID_RE.test(doc.head))))
    throw fail('ds-library-invalid', 'The library answered with something that is not a head.');
  const log: UpstreamHead['log'] = [];
  for (const e of Array.isArray(doc.log) ? doc.log.slice(0, LOG_SEEN) : []) {
    if (!isObj(e) || typeof e.rev !== 'string' || !ID_RE.test(e.rev)) continue;
    const by = isObj(e.by)
      ? ({
          kind: 'peer',
          ...(displayText(e.by.name, 64) ? { name: displayText(e.by.name, 64) } : {}),
        } as By)
      : null;
    log.push({
      rev: e.rev,
      parent: typeof e.parent === 'string' && ID_RE.test(e.parent) ? e.parent : null,
      action: displayText(e.action, 16) ?? '',
      at: typeof e.at === 'string' ? e.at.slice(0, 40) : null,
      by,
      summary: displayText(e.summary, 200),
    });
  }
  const usedBy =
    Number.isSafeInteger(doc.usedBy) && (doc.usedBy as number) >= 1 && (doc.usedBy as number) < 1e6
      ? (doc.usedBy as number)
      : null;
  return { head: doc.head as string | null, log, usedBy };
}

/** The keys a library revision may carry; anything else refuses the whole revision. */
export function libraryTokensKey(body: RevisionBody): string {
  const css: string[] = [];
  for (const k of Object.keys(body.files)) {
    if (k === TOKENS_JSON_KEY || k === COMPONENTS_JSON_KEY || k === COMPONENTS_CSS_KEY) continue;
    if (/^[A-Za-z0-9_-]{1,64}\.css$/.test(k)) css.push(k);
    else
      throw fail(
        'ds-library-invalid',
        `The library revision carries a file it may not (${k.slice(0, 60)}).`
      );
  }
  if (css.length !== 1)
    throw fail('ds-library-invalid', 'The library revision does not carry one tokens file.');
  return css[0];
}

export interface LibraryOptions {
  fetchImpl?: typeof fetch;
  grants?: GrantStore;
  /** a member credential this Mac already holds for that hub origin (hubs.json), when no grant is stored */
  memberToken?: (hub: string) => string | null;
  now?: () => number;
  /** this process is a workspace cell (default: MAUDE_WORKSPACE_MODE=1) — https to a named host only */
  cell?: boolean;
}

export interface LinkInput {
  url: string;
  grant?: string;
  label?: string;
  by: By;
}

export interface LibraryReview {
  format: typeof LIBRARY_FORMAT;
  v: 1;
  system: string;
  library: LibraryRecord;
  expectHead: string | null;
  upstream: string;
  changes: TokenChange[];
  /** the components' CSS or manifest changed too */
  components: boolean;
  by: By | null;
  at: string | null;
  summary: string | null;
  /** "Used by N projects" — only when the hub said it (it tells members, not link holders) */
  usedBy: number | null;
  canvases: ReturnType<DsEngine['review']>['canvases'];
}

const STRIP_HEAD_PIN = /\s+data-ds-rev=(?:"head"|'head'|\{\s*["']head["']\s*\})/g;
const metaText = (o: Record<string, unknown>) => `${JSON.stringify(o, null, 2)}\n`;
const metaRelOf = (rel: string) => rel.replace(/\.tsx$/i, '.meta.json');

function readText(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function readJsonObj(abs: string): Record<string, unknown> | null {
  const t = readText(abs);
  if (t === null) return null;
  try {
    const v = JSON.parse(t);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

function setOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

export function createDsLibrary(engine: DsEngine, opts: LibraryOptions = {}) {
  const designRoot = engine.designRoot;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const grants = opts.grants ?? fileGrantStore();
  const rules: UrlRules = { cell: opts.cell ?? isWorkspaceMode() };
  const now = opts.now ?? engine.now;
  const iso = () => new Date(now()).toISOString();
  const configAbs = path.join(designRoot, 'config.json');
  /** system → when this process last asked the hub (the 30-min throttle; memory only) */
  const lastCheck = new Map<string, number>();
  /** system → "used by N projects" as the hub last said it (members only; memory only — S10.18c's card) */
  const usedBy = new Map<string, number | null>();

  /* ------------------------------------------------------------ the hub */

  function credentialFor(a: LibraryAddress): string | null {
    return grants.get(a.hub, a.project, a.system) ?? opts.memberToken?.(a.hub) ?? null;
  }

  /** Did a person link `ds` to exactly this address on THIS Mac (A3)? */
  const linkedHere = (ds: string, a: LibraryAddress) =>
    sameAddress(grants.linkOf(designRoot, ds), a);

  async function get(a: LibraryAddress, tail: string, token: string, max: number): Promise<string> {
    const url = `${a.hub}/api/projects/${encodeURIComponent(a.project)}/v1/ds/${encodeURIComponent(a.system)}/${tail}`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(LIBRARY_TIMEOUT_MS),
      });
    } catch {
      throw fail('ds-library-unreachable', 'The library’s hub does not answer right now.');
    }
    if (res.status >= 300 && res.status < 400)
      throw fail(
        'ds-library-unreachable',
        'The library’s hub sent us elsewhere; nothing was taken.'
      );
    if (res.status === 401 || res.status === 403)
      throw fail(
        'ds-library-denied',
        'This library link no longer opens — ask its owner to share it again.'
      );
    if (res.status === 404) throw fail('ds-library-not-found', 'The library is not there.');
    if (!res.ok)
      throw fail('ds-library-unreachable', 'The library’s hub does not answer right now.');
    return readBounded(res, max);
  }

  async function supported(a: LibraryAddress): Promise<void> {
    const h = await hubHealth({ hubUrl: a.hub, fetchImpl });
    // an older hub (no capabilities, or no `ds-library`) fails closed: no link, nothing written
    if (!h.capabilities?.includes(LIBRARY_CAPABILITY))
      throw fail('ds-library-unsupported', 'That hub does not share team libraries yet.');
  }

  async function upstreamHead(a: LibraryAddress, token: string): Promise<UpstreamHead> {
    return parseUpstreamHead(await get(a, 'head', token, LIBRARY_HEAD_MAX_BYTES));
  }

  /** The revision `id`, verified and checked for the library file set — or a refusal. */
  async function upstreamRevision(a: LibraryAddress, token: string, id: string) {
    const text = await get(a, `revisions/${id}`, token, REVISION_MAX_BYTES);
    const v = verifyRevision(id, text);
    if (!v.ok)
      throw fail(
        'ds-library-invalid',
        `The library sent a revision that does not check out (${v.detail}).`
      );
    if (v.body.system !== a.system)
      throw fail('ds-library-invalid', 'The library sent another system’s revision.');
    const tokensKey = libraryTokensKey(v.body);
    return { id, body: v.body, bytes: serializeRevision(v.body), text, tokensKey };
  }

  /* --------------------------------------------------------- local files */

  const systemOf = (ds: string): SystemConfig => {
    const s = engine.systems().find((x) => x.name === ds);
    if (!s)
      throw new DsEngineError(
        'ds-unknown-system',
        `no design system named ${String(ds).slice(0, 64)}`
      );
    return s;
  };

  /** Refuse a symlink anywhere from the design root down to `rel` (a write must stay in its folder). */
  function assertPlain(rel: string) {
    let cur = designRoot;
    for (const part of rel.split('/').filter(Boolean)) {
      cur = path.join(cur, part);
      try {
        if (lstatSync(cur).isSymbolicLink())
          throw fail(
            'ds-library-invalid',
            'The system folder holds a link to elsewhere; nothing was written.'
          );
      } catch (err) {
        if (err instanceof DsLibraryError) throw err;
        return; // the rest does not exist yet
      }
    }
  }

  /** Write `files` (keys relative to `<sysRel>`) — each key is contained, plain and named in `allow`. */
  function writeInto(
    sysRel: string,
    files: { path: string; text: string }[],
    allow: (k: string) => boolean
  ) {
    const root = path.join(designRoot, sysRel);
    for (const w of files) {
      if (!allow(w.path))
        throw fail('ds-library-invalid', `refusing to write ${w.path.slice(0, 60)}`);
      const abs = path.join(root, w.path);
      if (!abs.startsWith(`${root}${path.sep}`))
        throw fail('ds-library-invalid', 'a path left the system folder');
      assertPlain(path.posix.join(sysRel, path.posix.dirname(w.path)));
      mkdirSync(path.dirname(abs), { recursive: true });
      assertPlain(path.posix.join(sysRel, w.path));
      atomicWrite(abs, w.text);
    }
  }

  const workingAllow = (tokensKey: string, id: string) => (k: string) =>
    k === tokensKey ||
    k === TOKENS_JSON_KEY ||
    k === COMPONENTS_JSON_KEY ||
    k === COMPONENTS_CSS_KEY ||
    k === `revisions/${id}.json` ||
    k === `revisions/${id}.tokens.css` ||
    k === `revisions/${id}.components.css`;

  function modelOf(s: SystemConfig, files: Record<string, string>, tokensKey: string): TokenModel {
    return parseSystem({
      config: {
        name: s.name,
        rootClass: s.rootClass,
        themes: s.themes,
        defaultTheme: s.themeDefault,
        colorSpace: s.colorSpace,
      },
      tokensCss: files[tokensKey] ?? null,
      tokensJson: files[TOKENS_JSON_KEY] ?? null,
    });
  }

  const filesOf = (b: RevisionBody): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, f] of Object.entries(b.files)) setOwn(out, k, f.text);
    return out;
  };

  function linked(ds: string) {
    const s = systemOf(ds);
    const abs = path.join(designRoot, s.path);
    const h = readHead(abs);
    if (h.state !== 'ok')
      throw new DsEngineError('ds-not-converted', `${ds} is not a linked library`);
    const lib = libraryOf(h.doc, rules);
    if (!lib) throw fail('ds-library-not-linked', `${ds} is not linked to a team library`);
    return { s, abs, doc: h.doc, lib };
  }

  /**
   * The credential for `ds`'s library — only when a person linked `ds` to that very address on this Mac. No
   * credential at all: `ds-library-no-grant` (a peer of whoever linked it). A credential, but the record is not
   * this Mac's link (a peer rewrote head.json, or the copy arrived by sync): `ds-library-relink` — nothing sent.
   */
  function tokenOf(ds: string, lib: LibraryRecord): string {
    const t = credentialFor(lib);
    if (!t)
      throw fail(
        'ds-library-no-grant',
        'This Mac has no access to that library yet — open its link again.'
      );
    if (!linkedHere(ds, lib))
      throw fail(
        'ds-library-relink',
        `This Mac did not link this library from ${new URL(lib.hub).host} — link it again to use it here.`
      );
    return t;
  }

  /* --------------------------------------------------------------- link */

  async function linkLocked(inp: LinkInput, a: LibraryAddress) {
    const grant = inp.grant ?? null;
    if (grant !== null && !GRANT_RE.test(grant))
      throw fail('ds-library-url', 'That is not a library grant.');
    const token = grant ?? opts.memberToken?.(a.hub) ?? null;
    if (!token) throw fail('ds-library-no-grant', 'The library link needs its access key.');
    const rel = `system/${a.system}`;
    const abs = path.join(designRoot, rel);
    const cfg = readJsonObj(configAbs);
    if (cfg === null && existsSync(configAbs))
      throw new DsEngineError('ds-make-invalid', 'config.json is not valid JSON — fix it first');
    const list = Array.isArray(cfg?.designSystems) ? (cfg?.designSystems as unknown[]) : [];
    if (
      list.some((e) => isObj(e) && (e.name === a.system || e.path === rel)) ||
      (existsSync(abs) && readdirSync(abs).length)
    )
      throw new DsEngineError('ds-exists', `a design system named ${a.system} already exists`);
    // everything from the hub is read and checked BEFORE the first byte is written here
    await supported(a);
    const up = await upstreamHead(a, token);
    if (!up.head) throw fail('ds-library-not-found', 'That library has nothing published yet.');
    const rev = await upstreamRevision(a, token, up.head);
    const label = displayText(inp.label, 64) ?? a.system;
    const at = iso();
    const record: LibraryRecord = {
      ...a,
      label,
      linkedAt: at,
      linkedBy: inp.by,
      upstreamHead: up.head,
      checkedAt: at,
    };
    const priorConfig = readText(configAbs);
    const wrote: string[] = [];
    try {
      assertPlain(rel);
      const fresh = readJsonObj(configAbs) ?? {};
      const entries = Array.isArray(fresh.designSystems)
        ? [...(fresh.designSystems as unknown[])]
        : [];
      entries.push({
        name: a.system,
        label,
        path: rel,
        themes: ['light', 'dark'],
        themeDefault: 'light',
        rootClass: a.system,
        ...(rev.tokensKey !== DEFAULT_TOKENS_KEY
          ? { tokensCssRel: `${rel}/${rev.tokensKey}` }
          : {}),
      });
      setOwn(fresh, 'designSystems', entries);
      atomicWrite(configAbs, `${JSON.stringify(fresh, null, 2)}\n`);
      // the Design system canvas is OUR template (view only here), never upstream bytes
      const meta = { title: label, ...designSystemCanvasMeta(a.system, []) };
      const own = [
        { path: DS_CANVAS, text: designSystemCanvasSource(a.system, label, []) },
        { path: DS_META, text: `${JSON.stringify(meta, null, 2)}\n` },
      ];
      const plan = [
        ...own,
        ...revisionWritePlan(() => null, rev, filesOf(rev.body), rev.tokensKey),
      ];
      const allow = workingAllow(rev.tokensKey, rev.id);
      writeInto(rel, plan, (k) => k === DS_CANVAS || k === DS_META || allow(k));
      for (const w of plan) wrote.push(path.join(abs, w.path));
      const doc: HeadDoc = {
        ...newHead(a.system, { head: rev.id, base: rev.id }),
        library: record as unknown as Record<string, unknown>,
        log: [
          {
            rev: rev.id,
            parent: null,
            action: 'library',
            at,
            by: inp.by,
            summary: `Linked ${label}`.slice(0, 200),
            actionId: null,
            was: { head: null, base: null },
            is: { head: rev.id, base: rev.id },
          } as LogEntry,
        ],
      };
      writeHead(abs, doc, 'absent');
      if (grant) grants.set(a.hub, a.project, a.system, grant);
      grants.setLink(designRoot, a.system, a);
    } catch (err) {
      for (const f of wrote.reverse()) rmSync(f, { force: true });
      if (priorConfig === null) rmSync(configAbs, { force: true });
      else atomicWrite(configAbs, priorConfig);
      for (const d of [path.join(abs, 'preview'), path.join(abs, 'revisions'), abs])
        try {
          rmSync(d, { recursive: false });
        } catch {
          /* not empty or gone */
        }
      throw err;
    }
    lastCheck.set(a.system, now());
    return {
      action: 'link',
      rev: rev.id,
      actionId: null,
      system: a.system,
      path: rel,
      library: record,
    };
  }

  function link(inp: LinkInput) {
    const a = parseLibraryUrl(inp.url, rules);
    return withLock(path.join(designRoot, 'system', a.system), () =>
      withLock(configAbs, () => linkLocked(inp, a))
    );
  }

  /* -------------------------------------------------------------- check */

  /** Ask the hub where its head is; move `upstreamHead` when it moved. `force` skips the 30-min throttle. */
  function check(ds: string, o: { force?: boolean } = {}) {
    return withLock(path.join(designRoot, systemOf(ds).path), async () => {
      const L = linked(ds);
      const last = lastCheck.get(ds);
      if (!o.force && last !== undefined && now() - last < LIBRARY_CHECK_MS)
        return {
          system: ds,
          library: L.lib,
          waiting: L.lib.upstreamHead !== null && L.lib.upstreamHead !== L.doc.head,
          usedBy: usedBy.get(ds) ?? null,
          checked: false,
        };
      const up = await upstreamHead(L.lib, tokenOf(ds, L.lib));
      lastCheck.set(ds, now());
      usedBy.set(ds, up.usedBy);
      let lib = L.lib;
      if (up.head && up.head !== L.lib.upstreamHead) {
        lib = { ...L.lib, upstreamHead: up.head, checkedAt: iso() };
        writeHead(
          L.abs,
          { ...L.doc, library: lib as unknown as Record<string, unknown> },
          { head: L.doc.head, base: L.doc.base }
        );
      }
      return {
        system: ds,
        library: lib,
        waiting: lib.upstreamHead !== null && lib.upstreamHead !== L.doc.head,
        usedBy: up.usedBy,
        checked: true,
      };
    });
  }

  /** Every linked system whose check is due (project open, then every 30 min). Failures stay quiet. */
  async function checkDue() {
    const out: { system: string; waiting: boolean }[] = [];
    for (const s of engine.systems()) {
      const h = readHead(path.join(designRoot, s.path));
      if (h.state !== 'ok' || !libraryOf(h.doc, rules)) continue;
      try {
        const r = await check(s.name);
        out.push({ system: s.name, waiting: r.waiting });
      } catch {
        /* offline or refused: the card says so when someone opens it */
      }
    }
    return out;
  }

  /* ------------------------------------------------------------- review */

  async function reviewOf(ds: string) {
    const L = linked(ds);
    const token = tokenOf(ds, L.lib);
    const up = await upstreamHead(L.lib, token);
    lastCheck.set(ds, now());
    usedBy.set(ds, up.usedBy);
    if (!up.head || up.head === L.doc.head)
      throw fail('ds-library-up-to-date', 'Nothing new in the library.');
    const rev = await upstreamRevision(L.lib, token, up.head);
    const tokensKey = path.posix.relative(L.s.path, L.s.tokensCssRel);
    if (rev.tokensKey !== tokensKey)
      throw fail(
        'ds-library-invalid',
        'The library moved its tokens to another file; link it again.'
      );
    const headText = L.doc.head
      ? readText(path.join(L.abs, 'revisions', `${L.doc.head}.json`))
      : null;
    const headV = L.doc.head && headText !== null ? verifyRevision(L.doc.head, headText) : null;
    const before = headV?.ok ? filesOf(headV.body) : {};
    const after = filesOf(rev.body);
    const entry = up.log.find((e) => e.rev === up.head) ?? null;
    return { L, rev, up, before, after, entry, tokensKey };
  }

  async function review(ds: string): Promise<LibraryReview> {
    const R = await reviewOf(ds);
    return {
      format: LIBRARY_FORMAT,
      v: 1,
      system: ds,
      library: { ...R.L.lib, upstreamHead: R.up.head },
      expectHead: R.L.doc.head,
      upstream: R.rev.id,
      changes: tokenDiff(
        modelOf(R.L.s, R.before, R.tokensKey),
        modelOf(R.L.s, R.after, R.tokensKey)
      ),
      components:
        R.before[COMPONENTS_CSS_KEY] !== R.after[COMPONENTS_CSS_KEY] ||
        R.before[COMPONENTS_JSON_KEY] !== R.after[COMPONENTS_JSON_KEY],
      by: R.entry?.by ?? null,
      at: R.entry?.at ?? null,
      summary: R.entry?.summary ?? null,
      usedBy: R.up.usedBy,
      canvases: engine.review(ds).canvases,
    };
  }

  /* ------------------------------------------------------------- update */

  interface UpdateInput {
    expectHead: string | null;
    upstream: string;
    canvases?: { path: string; ticked: boolean }[];
    by: By;
  }

  async function updateLocked(ds: string, inp: UpdateInput) {
    const R = await reviewOf(ds);
    const { L, rev } = R;
    if (inp.expectHead !== L.doc.head)
      throw new DsEngineError('ds-head-moved', 'the system changed since this review opened', {
        head: L.doc.head,
      });
    if (inp.upstream !== rev.id)
      throw fail(
        'ds-library-moved',
        'The library changed again since this review opened — look again.'
      );
    const st = engine.state(ds);
    if (st.outside)
      throw new DsEngineError(
        'ds-outside-unreviewed',
        'the system files changed outside Maude — Undo that first'
      );
    if (st.publishedInTwoPlaces)
      throw new DsEngineError(
        'ds-two-places',
        'the system was published in two places — pick one first'
      );
    const oldHead = L.doc.head;
    const over = new Map((inp.canvases ?? []).map((c) => [c.path, c.ticked === true]));
    const rows = engine
      .review(ds)
      .canvases.map((r) => (over.has(r.path) ? { ...r, ticked: over.get(r.path) as boolean } : r));
    const metas: { rel: string; text: string }[] = [];
    for (const r of rows) {
      const meta = readJsonObj(path.join(designRoot, metaRelOf(r.path))) ?? {};
      if (r.ticked && typeof meta.dsRev === 'string') {
        delete meta.dsRev;
        metas.push({ rel: metaRelOf(r.path), text: metaText(meta) });
        const src = readText(path.join(designRoot, r.path));
        STRIP_HEAD_PIN.lastIndex = 0;
        if (src !== null && STRIP_HEAD_PIN.test(src))
          metas.push({ rel: r.path, text: src.replace(STRIP_HEAD_PIN, '') });
        STRIP_HEAD_PIN.lastIndex = 0;
      } else if (!r.ticked && typeof meta.dsRev !== 'string' && oldHead) {
        setOwn(meta, 'dsRev', oldHead);
        metas.push({ rel: metaRelOf(r.path), text: metaText(meta) });
      }
    }
    const port = metas.length ? engine.kernel() : null;
    if (metas.length && !port)
      throw new DsEngineError(
        'ds-kernel-unavailable',
        "No project home answers right now — update when you're back online."
      );
    // 1–2: the verified revision + siblings, then the working files (only the library's own file set)
    const read = (k: string) => readText(path.join(L.abs, k));
    const plan = revisionWritePlan(read, rev, R.after, R.tokensKey);
    const prior: Record<string, string | null> = {};
    for (const w of plan) if (!w.path.startsWith('revisions/')) prior[w.path] = read(w.path);
    writeInto(L.s.path, plan, workingAllow(R.tokensKey, rev.id));
    const putBack = () => {
      for (const [k, was] of Object.entries(prior)) {
        const abs = path.join(L.abs, k);
        if (readText(abs) !== R.after[k]) continue;
        if (was === null) unlinkSync(abs);
        else atomicWrite(abs, was);
      }
    };
    const summary =
      `Update from ${L.lib.label}${R.entry?.summary ? `: ${R.entry.summary}` : ''}`.slice(0, 200);
    // 3: the canvases left out stay at the old head — one kernel action
    let actionId: string | null = null;
    if (metas.length) {
      try {
        const r = await (port as NonNullable<typeof port>).propose(metas, {
          kind: 'edit',
          label: summary,
        });
        if (!r)
          throw new DsEngineError(
            'ds-kernel-unavailable',
            "No project home answers right now — update when you're back online."
          );
        if (r.status !== 'accepted')
          throw new DsEngineError(
            'ds-kernel-rejected',
            `the project refused the change (${r.code ?? 'rejected'})`
          );
        actionId = r.actionId ?? null;
      } catch (err) {
        putBack();
        throw err;
      }
    }
    // 4: head.json last — head = base = upstream, log `library`
    const updated = rows.filter((r) => r.ticked).length;
    const at = iso();
    const lib: LibraryRecord = { ...L.lib, upstreamHead: rev.id, checkedAt: at };
    const was = { head: L.doc.head, base: L.doc.base };
    const is = { head: rev.id, base: rev.id };
    writeHead(
      L.abs,
      {
        ...L.doc,
        head: rev.id,
        base: rev.id,
        library: lib as unknown as Record<string, unknown>,
        log: [
          {
            rev: rev.id,
            parent: oldHead,
            action: 'library',
            at,
            by: inp.by,
            summary,
            updated,
            leftOut: rows.length - updated,
            actionId,
            was,
            is,
          } as LogEntry,
          ...L.doc.log,
        ],
      },
      was
    );
    return {
      action: 'library',
      rev: rev.id,
      actionId,
      updated,
      leftOut: rows.length - updated,
      summary,
    };
  }

  function update(ds: string, inp: UpdateInput) {
    return withLock(path.join(designRoot, systemOf(ds).path), () => updateLocked(ds, inp));
  }

  /* ------------------------------------------------------------- unlink */

  function unlink(ds: string, inp: { by: By }) {
    void inp;
    return withLock(path.join(designRoot, systemOf(ds).path), async () => {
      const L = linked(ds);
      writeHead(L.abs, { ...L.doc, library: null }, { head: L.doc.head, base: L.doc.base });
      grants.delete(L.lib.hub, L.lib.project, L.lib.system);
      grants.deleteLink(designRoot, ds);
      lastCheck.delete(ds);
      return { action: 'unlink', rev: L.doc.head, actionId: null };
    });
  }

  /* ------------------------------------------------------------- relink */

  /**
   * "Link again" (A3): the person, shown the hub's host, makes `ds`'s CURRENT library record this Mac's link —
   * with an access key when the link came with one. Nothing is asked of the hub here; the next check is.
   */
  function relink(ds: string, inp: { grant?: string; by: By }) {
    void inp.by;
    return withLock(path.join(designRoot, systemOf(ds).path), async () => {
      const L = linked(ds);
      const grant = inp.grant ?? null;
      if (grant !== null && !GRANT_RE.test(grant))
        throw fail('ds-library-url', 'That is not a library grant.');
      if (!grant && !credentialFor(L.lib))
        throw fail('ds-library-no-grant', 'The library link needs its access key.');
      if (grant) grants.set(L.lib.hub, L.lib.project, L.lib.system, grant);
      grants.setLink(designRoot, ds, L.lib);
      lastCheck.delete(ds);
      return { action: 'relink', system: ds, library: L.lib };
    });
  }

  /** The linked systems (`{system, library}`), for the card and the verb. */
  function linkedSystems() {
    const out: { system: string; library: LibraryRecord; head: string | null }[] = [];
    for (const s of engine.systems()) {
      const h = readHead(path.join(designRoot, s.path));
      const lib = h.state === 'ok' ? libraryOf(h.doc, rules) : null;
      if (h.state === 'ok' && lib) out.push({ system: s.name, library: lib, head: h.doc.head });
    }
    return out;
  }

  return { link, check, checkDue, review, update, unlink, relink, linkedSystems };
}

export type DsLibrary = ReturnType<typeof createDsLibrary>;
