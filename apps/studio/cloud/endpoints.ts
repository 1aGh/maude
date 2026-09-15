// Maude Cloud from inside the studio — Cloud Phase 23 C3, the dev-server half.
//
// The desktop app (and a plain `maude design serve` in a browser) signs into
// Maude Cloud WITHOUT any Rust and without CORS on the platform: every call to
// cloud.maude.sh happens HERE, server-side, and the client only talks to the
// loopback `/_api/cloud/*` routes. The personal token lives next to the hub
// credentials the link flow already trusts (`~/.config/maude/`), mode 0600,
// never in the repo and never in the browser.
//
// The lane, end to end (every hop verified live against production):
//   sign-in   POST /auth/device/code → human approves on /activate → poll
//   projects  GET /api/projects (Bearer personal token)
//   attach    POST /projects/open → project token → the CELL exchanges it at
//             POST /auth/login {token} (a POST body, never a URL) → a hub
//             user token → saveHubCredential() + linkedHub in config.json —
//             the exact state `maude design link` would have written by hand.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';

import { deleteHubCredential, saveHubCredential } from '../sync/hub-link.ts';
import { getHubToken, normalizeUrl } from '../sync/hubs-config.ts';

/**
 * Where Maude Cloud lives, resolved PER CALL rather than at module load.
 *
 * A module-level read baked whatever `MAUDE_CLOUD_URL` happened to be at
 * import time — so in a shared test process the first importer decided the
 * address for everyone (the e2e/unit stub silently talked to production and
 * the assertion failed 410), and the desktop shell could not set the env
 * after the module graph was already warm.
 */
function cloudUrl(): string {
  return (process.env.MAUDE_CLOUD_URL ?? 'https://cloud.maude.sh').replace(/\/+$/, '');
}

export interface CloudEndpointResult {
  status: number;
  json: unknown;
}

/**
 * Why a historical blob could not be produced — or the blob.
 *
 * `not-found` is the only AUTHORITATIVE negative: a commit's content never
 * changes, so the answer is stable and a caller may cache it. `unreachable`,
 * `not-linked` and the two argument refusals are all transient or caller-side,
 * and caching any of them turns an outage into a permanent 404.
 */
export type HistoryFileResult =
  | { ok: true; source: string }
  | { ok: false; reason: 'not-found' | 'unreachable' | 'not-linked' | 'bad-sha' | 'bad-path' };

/**
 * Ceiling on ONE response from a linked cell.
 *
 * Comfortably above the hub's own 2 MiB blob cap, so a legitimate answer is
 * never refused, and far below "buffer whatever arrives for eight seconds".
 */
const MAX_HUB_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Whatever the control plane answered. Read defensively at every use. */
type CloudBody = Record<string, unknown> & {
  token?: string;
  url?: string;
  role?: string;
  project?: string;
  user_code?: string;
  device_code?: string;
  verification_url?: string;
  interval?: number;
  projects?: unknown[];
  account?: { email?: string };
  error?: string;
};

interface CloudFile {
  url: string;
  token: string;
  email?: string;
  connectedAt: number;
}

function cloudConfigPath(): string {
  return process.env.MAUDE_CLOUD_CONFIG ?? join(homedir(), '.config', 'maude', 'cloud.json');
}

function readCloudFile(): CloudFile | null {
  const p = cloudConfigPath();
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    if (parsed && typeof parsed.token === 'string') return parsed as CloudFile;
  } catch {
    /* malformed → treat as signed out */
  }
  return null;
}

function writeCloudFile(file: CloudFile): void {
  const p = cloudConfigPath();
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(p, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* windows / read-only fs — best effort */
  }
}

async function cloudFetch(
  path: string,
  init: RequestInit = {},
  { timeoutMs = 15_000 } = {}
): Promise<{ status: number; body: CloudBody }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cloudUrl()}${path}`, { ...init, signal: ctl.signal });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (err) {
    return { status: 0, body: { error: (err as Error).message } };
  } finally {
    clearTimeout(timer);
  }
}

interface Ctx {
  paths: { repoRoot: string; designRoot: string };
  /**
   * The live sync runtime's owner (server.ts → sync/supervisor.ts). Optional:
   * unit tests and any non-serving embedder construct a Ctx without one, and a
   * missing supervisor degrades to exactly the old behaviour — linked on disk,
   * syncing after the next start.
   */
  /**
   * The link changed (attach / detach). Lets the server drop anything it
   * cached about "what a past version of this file looked like" — those
   * answers were produced under the OLD link and are keyed by nothing that
   * would distinguish them.
   */
  onLinkChanged?: () => void;
  syncControl?: {
    /** `null` = unlink: clear the runtime's in-memory link, cycle to solo. */
    restart(
      linkedHub?: {
        url: string;
        linkedAt: number;
        syncTsx?: boolean;
      } | null
    ): Promise<{ syncing: boolean; canvases: number; reason?: string; detail?: string }>;
  };
}

export function createCloudEndpoints(ctx: Ctx) {
  return {
    /**
     * Signed in? Who? And WHICH folder is asking? Cheap — reads two files,
     * never the network.
     *
     * `project` + `linkedHub` are the local half of the answer, and they exist
     * for one reason: a maude:// link names a CLOUD project, and the person
     * confirming it deserves to see which LOCAL folder is about to be attached
     * to it. Both are already-public facts (a directory name, and the
     * token-free `linkedHub` this same module writes into a committed
     * config.json) — no credential material widens by being reported here.
     */
    status(): CloudEndpointResult {
      const file = readCloudFile();
      return {
        status: 200,
        json: {
          connected: !!file,
          email: file?.email ?? null,
          url: file ? file.url : cloudUrl(),
          project: basename(ctx.paths.repoRoot),
          linkedHub: readLinkedHub(),
        },
      };
    },

    /** Start the device flow: hand the client the human-facing half. */
    async signinStart(): Promise<CloudEndpointResult> {
      const r = await cloudFetch('/auth/device/code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client: `Maude Studio on ${process.platform}` }),
      });
      if (r.status !== 200) {
        return {
          status: 502,
          json: { ok: false, error: 'Maude Cloud could not be reached. Try again in a moment.' },
        };
      }
      return {
        status: 200,
        json: {
          ok: true,
          userCode: r.body.user_code,
          verificationUrl: r.body.verification_url,
          deviceCode: r.body.device_code,
          interval: r.body.interval ?? 5,
        },
      };
    },

    /** One poll tick. On success the credential is stored server-side. */
    async signinPoll(deviceCode: string): Promise<CloudEndpointResult> {
      if (!deviceCode) return { status: 400, json: { ok: false, error: 'missing device code' } };
      const r = await cloudFetch('/auth/device/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_code: deviceCode }),
      });
      if (r.status === 202) return { status: 200, json: { ok: true, pending: true } };
      if (r.status !== 200 || !r.body?.token) {
        return {
          status: 410,
          json: { ok: false, error: 'The code expired. Start the sign-in again.' },
        };
      }
      writeCloudFile({
        url: cloudUrl(),
        token: r.body.token,
        email: r.body.account?.email ?? undefined,
        connectedAt: Date.now(),
      });
      return {
        status: 200,
        json: { ok: true, pending: false, email: r.body.account?.email ?? null },
      };
    },

    /** Forget the local credential. (Revocation lives on /account.) */
    signout(): CloudEndpointResult {
      try {
        unlinkSync(cloudConfigPath());
      } catch {
        /* already gone */
      }
      return { status: 200, json: { ok: true } };
    },

    /** The signed-in account's projects, states included. */
    async projects(): Promise<CloudEndpointResult> {
      const file = readCloudFile();
      if (!file)
        return { status: 401, json: { ok: false, error: 'Sign in to Maude Cloud first.' } };
      const r = await cloudFetch('/api/projects', {
        headers: { authorization: `Bearer ${file.token}` },
      });
      if (r.status === 401) {
        // Revoked from the dashboard — honor it locally too.
        this.signout();
        return {
          status: 401,
          json: { ok: false, error: 'This device was disconnected. Sign in again.' },
        };
      }
      if (r.status !== 200) {
        return { status: 502, json: { ok: false, error: 'Maude Cloud could not be reached.' } };
      }
      return { status: 200, json: { ok: true, projects: r.body.projects ?? [] } };
    },

    /**
     * Attach THIS project to a cloud workspace: open → exchange at the cell →
     * store the hub credential + linkedHub, exactly as `maude design link`
     * would — and then START SYNCING (linkToWorkspace cycles the live runtime
     * through ctx.syncControl). Connecting is the whole gesture; there is no
     * second step for the person to discover.
     */
    async attach(projectId: string): Promise<CloudEndpointResult> {
      const file = readCloudFile();
      if (!file)
        return { status: 401, json: { ok: false, error: 'Sign in to Maude Cloud first.' } };
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(projectId ?? ''))) {
        return { status: 400, json: { ok: false, error: 'unknown project' } };
      }

      const opened = await cloudFetch('/projects/open', {
        method: 'POST',
        headers: { authorization: `Bearer ${file.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ project: projectId }),
      });
      // `url` is checked alongside `token`: linkToWorkspace requires a
      // workspace URL, and a 200 body missing it would have linked against
      // `undefined` rather than refusing.
      if (opened.status !== 200 || !opened.body?.token || !opened.body.url) {
        return {
          status: 502,
          json: { ok: false, error: 'The project could not be opened with this account.' },
        };
      }
      return linkToWorkspace({
        workspaceUrl: opened.body.url,
        projectToken: opened.body.token,
        role: opened.body.role,
      });
    },

    /**
     * Open a project as a MANAGED local copy (T21): the same open → cell
     * exchange → stored credential as `attach`, but nothing is written into
     * the folder this studio happens to serve — the desktop creates the
     * project's own copy and switches to it.
     */
    async openManaged(projectId: string): Promise<CloudEndpointResult> {
      const file = readCloudFile();
      if (!file)
        return { status: 401, json: { ok: false, error: 'Sign in to Maude Cloud first.' } };
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(projectId ?? ''))) {
        return { status: 400, json: { ok: false, error: 'unknown project' } };
      }
      const opened = await cloudFetch('/projects/open', {
        method: 'POST',
        headers: { authorization: `Bearer ${file.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ project: projectId }),
      });
      if (opened.status !== 200 || !opened.body?.token || !opened.body.url) {
        return {
          status: 502,
          json: { ok: false, error: 'The project could not be opened with this account.' },
        };
      }
      return exchangeAtCell({
        workspaceUrl: opened.body.url,
        projectToken: opened.body.token,
        role: opened.body.role,
        project: projectId,
      });
    },

    /** The maude:// handoff lane, as a managed copy (see `attachCode`). */
    async openManagedCode(code: string, claimedProject?: string): Promise<CloudEndpointResult> {
      if (typeof code !== 'string' || !/^mhc_[0-9a-f]{16,128}$/.test(code)) {
        return { status: 400, json: { ok: false, error: 'That link is not valid.' } };
      }
      const exchanged = await cloudFetch('/auth/handoff/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (exchanged.status !== 200 || !exchanged.body?.token || !exchanged.body.url) {
        return {
          status: 410,
          json: {
            ok: false,
            error:
              'That link expired — it works once, for two minutes. Press “Open in Maude” on the project page again.',
          },
        };
      }
      if (claimedProject && exchanged.body.project && claimedProject !== exchanged.body.project) {
        return {
          status: 409,
          json: {
            ok: false,
            error: `That link said ${claimedProject} but it opens ${exchanged.body.project}. Nothing was opened — open the project from its own page instead.`,
          },
        };
      }
      return exchangeAtCell({
        workspaceUrl: exchanged.body.url,
        projectToken: exchanged.body.token,
        role: exchanged.body.role,
        project: exchanged.body.project,
      });
    },

    /**
     * Attach via a one-time handoff code — the maude:// lane (Phase 17). The
     * code came from an untrusted URL, so it is exchanged ONLY against the
     * configured Maude Cloud address (never one the link names), and the
     * workspace we then link is the one THAT exchange returns. Needs no
     * personal token: the code itself proves the dashboard session.
     */
    async attachCode(code: string, claimedProject?: string): Promise<CloudEndpointResult> {
      if (typeof code !== 'string' || !/^mhc_[0-9a-f]{16,128}$/.test(code)) {
        return { status: 400, json: { ok: false, error: 'That link is not valid.' } };
      }
      const exchanged = await cloudFetch('/auth/handoff/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (exchanged.status !== 200 || !exchanged.body?.token || !exchanged.body.url) {
        return {
          status: 410,
          json: {
            ok: false,
            error:
              'That link expired — it works once, for two minutes. Press “Open in Maude” on the project page again.',
          },
        };
      }

      // The link CLAIMED a project name and the person confirmed THAT name.
      // The exchange is the only authority on which project the code really
      // opens, so the two must agree — otherwise a code minted for the
      // attacker's own project, wrapped in a link naming something familiar,
      // would be confirmed by a victim and then linked, sending their local
      // work to the attacker's workspace. Refuse rather than silently link
      // something the person did not agree to.
      if (claimedProject && exchanged.body.project && claimedProject !== exchanged.body.project) {
        return {
          status: 409,
          json: {
            ok: false,
            error: `That link said ${claimedProject} but it opens ${exchanged.body.project}. Nothing was connected — open the project from its own page instead.`,
          },
        };
      }

      return linkToWorkspace({
        workspaceUrl: exchanged.body.url,
        projectToken: exchanged.body.token,
        role: exchanged.body.role,
        project: exchanged.body.project,
      });
    },

    /**
     * THE HISTORY THAT IS ACTUALLY BEING WRITTEN — feature-cloud-managed-git-
     * posture.
     *
     * In cloud-managed posture the cell is the sole committer (DDR-198/209/213)
     * and the local repo has no commits at all, so the desktop's History tab
     * read a repo nobody writes and reported "No saved versions yet" directly
     * under "Cloud is saving". This asks the cell instead.
     *
     * SERVER-SIDE, ALWAYS. The hub credential resolved here never reaches the
     * browser — the client talks only to the loopback `/_api/cloud/history`,
     * exactly as it does for every other call in this module.
     */
    async history(pathRaw?: string | null, limitRaw?: string | null): Promise<CloudEndpointResult> {
      const hub = credentialedHub();
      if (!hub) return { status: 200, json: { ok: false, reason: 'not-linked' } };

      const qs = new URLSearchParams();
      const rel = designRelative(pathRaw);
      if (rel) qs.set('path', rel);
      const limit = Number(limitRaw);
      if (Number.isFinite(limit) && limit > 0)
        qs.set('limit', String(Math.min(100, Math.trunc(limit))));

      const r = await hubFetch(hub, `/api/history?${qs.toString()}`);
      if (!r.ok) return { status: 200, json: { ok: false, reason: 'unreachable' } };
      // Clamp what the cell says before it reaches a renderer. The hub caps its
      // own page at 100 rows, but a compromised cell does not run that code.
      const clamp = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
      const body = (r.body ?? {}) as { entries?: unknown; branch?: unknown; project?: unknown };
      const rows = Array.isArray(body.entries) ? body.entries.slice(0, 100) : [];
      return {
        status: 200,
        json: {
          ok: true,
          entries: rows.map((e) => {
            const r0 = (e ?? {}) as Record<string, unknown>;
            return {
              sha: clamp(r0.sha, 40),
              message: clamp(r0.message, 500),
              author: clamp(r0.author, 120),
              date: clamp(r0.date, 40),
            };
          }),
          branch: typeof body.branch === 'string' ? body.branch.slice(0, 200) : null,
          project: typeof body.project === 'string' ? body.project.slice(0, 200) : null,
          hubHost: hubHost(hub.url),
        },
      };
    },

    /**
     * One file's source at one cloud commit — what the version preview builds
     * from when the sha exists only on the cell.
     *
     * `sha` is validated HERE as well as on the hub. It reaches the preview
     * route from the UNTRUSTED canvas origin (DDR-054), and "the other side
     * checks it" is how a guard ends up existing on neither side.
     */
    async historyFile(sha: string, pathRaw: string): Promise<HistoryFileResult> {
      // WHY THIS REPORTS A REASON INSTEAD OF JUST `null`.
      //
      // The caller caches a miss so a repeated bad sha costs nothing. If every
      // failure looked alike, an UNREACHABLE cell (or an unlinked project)
      // would be remembered as "this version does not exist" — and the entry
      // outlives the outage, so a version stays permanently unpreviewable. That
      // is the same collapse of "could not reach" into "is not there" this
      // whole feature exists to undo; the panel is careful about it one layer
      // up, and it would be silly to re-introduce it one layer down.
      //
      // Only `not-found` is authoritative. Everything else is transient.
      if (!/^[0-9a-f]{7,40}$/.test(String(sha ?? ''))) return { ok: false, reason: 'bad-sha' };
      const rel = designRelative(pathRaw);
      if (!rel) return { ok: false, reason: 'bad-path' };
      const hub = credentialedHub();
      if (!hub) return { ok: false, reason: 'not-linked' };

      const qs = new URLSearchParams({ sha, path: rel });
      const r = await hubFetch(hub, `/api/history/file?${qs.toString()}`, { text: true });
      if (r.ok && typeof r.text === 'string') return { ok: true, source: r.text };
      // A 404 is the cell's ONE indistinguishable refusal (out-of-scope,
      // out-of-tree, wrong class, absent). Treating it as authoritative is
      // correct for caching: none of those become true later for the same
      // (sha, path), because a commit's content never changes.
      return { ok: false, reason: r.status === 404 ? 'not-found' : 'unreachable' };
    },

    /**
     * Detach THIS project from its workspace — the in-app `maude design
     * unlink` (fix 7's Disconnect, sync RCA 2026-08-10). Drops the committed
     * `linkedHub` AND the stored hub credential for that address (the CLI
     * default), then cycles the runtime back to solo so syncing stops NOW
     * rather than at the next restart. Idempotent: disconnecting an unlinked
     * project answers ok, not an error.
     */
    async detach(): Promise<CloudEndpointResult> {
      const cfgPath = join(ctx.paths.designRoot, 'config.json');
      let cfg: Record<string, unknown> = {};
      try {
        cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      } catch {
        /* absent/malformed → nothing linked */
      }
      const linked = (cfg as { linkedHub?: { url?: unknown } }).linkedHub;
      const url = typeof linked?.url === 'string' ? linked.url : null;
      if (linked) {
        delete cfg.linkedHub;
        // Temp + rename (security review 2026-08-10, F5) — config.json is the
        // SERVED project config (tokensCssRel, canvasGroups); a crash mid-write
        // would corrupt it. Same atomic posture as `hub-link.ts`, but WITHOUT
        // the credential store's 0o600 (this file is committed + world-readable
        // by design), so it inherits the umask like the plain write it replaces.
        const tmp = `${cfgPath}.${process.pid}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
        renameSync(tmp, cfgPath);
      }
      if (url) {
        try {
          deleteHubCredential(normalizeUrl(url));
        } catch {
          /* an unparseable stored URL has no credential entry to drop */
        }
      }
      try {
        await ctx.syncControl?.restart(null);
      } catch {
        /* best-effort — the link is gone on disk either way */
      }
      ctx.onLinkChanged?.();
      return { status: 200, json: { ok: true, detached: !!linked } };
    },
  };

  /**
   * The workspace this folder already answers to, if any. Address only.
   *
   * `credentialed` is the half that can be trusted. `config.json` is COMMITTED
   * and travels with the repo, so a `linkedHub` in it is attacker-authorable:
   * publish a template pointing at your own cell and the connect dialog would
   * cheerfully print "this folder is already linked to <you>" — the strongest
   * reassurance it can give, produced entirely by content the person merely
   * opened (attacker pass 2026-08-04, B2). A stored hub credential for that
   * address is the corroboration, because only a real sign-in writes one.
   */
  function readLinkedHub(): { url: string; credentialed: boolean } | null {
    try {
      const cfg = JSON.parse(readFileSync(join(ctx.paths.designRoot, 'config.json'), 'utf8'));
      const url = cfg?.linkedHub?.url;
      if (typeof url !== 'string' || !url) return null;
      let credentialed = false;
      try {
        credentialed = !!getHubToken(normalizeUrl(url));
      } catch {
        /* unreadable credential store → treat as uncorroborated */
      }
      return { url, credentialed };
    } catch {
      return null; // absent/malformed → simply not linked
    }
  }

  /**
   * The linked hub AND its credential, or null.
   *
   * "Linked" alone is not enough to make a network call on: `config.json` is
   * COMMITTED and travels with the repo, so a `linkedHub` in it is
   * attacker-authorable (B2). A stored credential is the corroboration — and
   * it is also the thing we would be sending, so resolving both together is
   * what keeps a no-credential case from becoming an unauthenticated request
   * to an address a repo named.
   */
  function credentialedHub(): { url: string; token: string } | null {
    const linked = readLinkedHub();
    if (!linked?.credentialed) return null;
    try {
      const url = normalizeUrl(linked.url);
      const token = getHubToken(url);
      return token ? { url, token } : null;
    } catch {
      return null;
    }
  }

  /**
   * One authenticated GET against the linked cell.
   *
   * NEITHER THE TOKEN NOR THE HUB'S OWN ERROR BODY EVER LEAVES THIS FUNCTION.
   * Callers get `{ ok }` plus the parsed payload on success, so a hub message
   * cannot be relayed into the browser (or into a log) by accident.
   *
   * A 401 IS A PLAIN READ FAILURE HERE. `/_api/cloud/status`'s 401 path
   * DELETES the stored credential (confused-deputy F6, and correct there: the
   * control plane is the authority on whether this device is still trusted).
   * A History poll is not that authority — a cell restarting mid-token-renewal
   * would otherwise silently unlink a working project. Read fails; credential
   * stands.
   */
  async function hubFetch(
    hub: { url: string; token: string },
    path: string,
    { text = false, timeoutMs = 8_000, maxBytes = MAX_HUB_RESPONSE_BYTES } = {}
  ): Promise<{ ok: boolean; status: number; body?: unknown; text?: string }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${hub.url}${path}`, {
        headers: { authorization: `Bearer ${hub.token}` },
        signal: ctl.signal,
      });
      if (!res.ok) return { ok: false, status: res.status };
      // THE CELL IS NOT TRUSTED TO RESPECT ITS OWN LIMITS. The hub caps a blob
      // at 2 MiB and checks `cat-file -s` before reading — but a compromised
      // cell, or anything MITM-ing a self-hosted `http://` hub, simply does
      // not run that code. Without a cap here the desktop buffers an endless
      // stream into one JS string for the whole timeout, and the trigger is
      // reachable from the UNTRUSTED canvas origin (a canvas picks the `?sha=`
      // on the version-preview route). Read through a counted stream and abort
      // past the cap. (Security re-review of 8134ca8f, finding F2.)
      const body = await readCapped(res, ctl, maxBytes);
      if (body == null) return { ok: false, status: 0 };
      if (text) return { ok: true, status: res.status, text: body };
      try {
        return { ok: true, status: res.status, body: JSON.parse(body) };
      } catch {
        return { ok: true, status: res.status, body: {} };
      }
    } catch {
      return { ok: false, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Read a response body, aborting past `maxBytes`. Null = refused/failed. */
  async function readCapped(
    res: Response,
    ctl: AbortController,
    maxBytes: number
  ): Promise<string | null> {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      ctl.abort();
      return null;
    }
    if (!res.body) {
      const t = await res.text();
      return t.length > maxBytes ? null : t;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder('utf8');
    let out = '';
    let seen = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value?.byteLength ?? 0;
      if (seen > maxBytes) {
        // Content-Length is a claim; this is the measurement.
        try {
          await reader.cancel();
        } catch {
          /* already gone */
        }
        return null;
      }
      out += dec.decode(value, { stream: true });
    }
    return out + dec.decode();
  }

  /**
   * repo-relative (`.design/ui/Card.tsx`) → design-root-relative (`ui/Card.tsx`).
   *
   * The hub speaks design-root-relative on every file surface it has, and the
   * cell's design root need not share this machine's folder name — so the
   * translation belongs on this side, where both roots are known. A path
   * outside the design tree returns null rather than being passed through: the
   * cell would refuse it anyway, and sending it would make this a probe.
   */
  function designRelative(raw?: string | null): string | null {
    if (typeof raw !== 'string' || raw === '') return null;
    const p = raw.replace(/\\/g, '/');
    if (p.split('/').includes('..')) return null;
    const designRel = relative(ctx.paths.repoRoot, ctx.paths.designRoot).split(sep).join('/');
    if (!designRel || designRel.startsWith('..')) return null;
    if (p === designRel) return null;
    if (p.startsWith(`${designRel}/`)) return p.slice(designRel.length + 1) || null;
    // Already design-root-relative (the History scope the panel holds for a
    // canvas opened from the cell) — accept it as-is rather than refusing a
    // caller for using the hub's own vocabulary.
    return p.startsWith('/') ? null : p;
  }

  /** The cell's host, for a header that must name SOMETHING when the project
   *  name is unknown. Address only — already-public, and never the token. */
  function hubHost(url: string): string | null {
    try {
      return new URL(url).host;
    } catch {
      return null;
    }
  }

  /**
   * The cell exchange alone: project token → hub session → stored credential.
   * Writes nothing into any project folder (a managed open creates its own).
   */
  async function exchangeAtCell({
    workspaceUrl,
    projectToken,
    role,
    project,
  }: {
    workspaceUrl: string;
    projectToken: string;
    role?: string;
    project?: string;
  }): Promise<CloudEndpointResult> {
    const r = await exchangeCredential(workspaceUrl, projectToken);
    if (!r) {
      return {
        status: 502,
        json: {
          ok: false,
          error: 'The workspace did not accept the sign-in. Try again in a minute.',
        },
      };
    }
    return {
      status: 200,
      json: { ok: true, url: r.url, role: r.role ?? role ?? null, project: project ?? null },
    };
  }

  async function exchangeCredential(
    workspaceUrl: string,
    projectToken: string
  ): Promise<{ url: string; role?: string } | null> {
    let hubToken: string | null = null;
    let hubTokenExpiresAt: number | undefined;
    let vouchedRole: string | undefined;
    try {
      const res = await fetch(`${workspaceUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: projectToken }),
      });
      const body = (await res.json().catch(() => ({}))) as CloudBody & {
        expiresAt?: unknown;
        user?: { role?: unknown };
      };
      if (res.ok && body?.token) {
        hubToken = body.token;
        if (typeof body.expiresAt === 'number' && Number.isFinite(body.expiresAt))
          hubTokenExpiresAt = body.expiresAt;
        if (typeof body.user?.role === 'string' && body.user.role) vouchedRole = body.user.role;
      }
    } catch {
      /* handled by the caller */
    }
    if (!hubToken) return null;
    const norm = normalizeUrl(workspaceUrl);
    saveHubCredential(norm, hubToken, vouchedRole, hubTokenExpiresAt);
    return { url: norm, role: vouchedRole };
  }

  /** The shared tail of every attach: cell exchange → credential + linkedHub. */
  async function linkToWorkspace({
    workspaceUrl,
    projectToken,
    role,
    project,
  }: {
    workspaceUrl: string;
    projectToken: string;
    role?: string;
    project?: string;
  }): Promise<CloudEndpointResult> {
    // The cell is a different host than the control plane — one direct call.
    let hubToken: string | null = null;
    let hubTokenExpiresAt: number | undefined;
    let vouchedRole: string | undefined;
    try {
      const res = await fetch(`${workspaceUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: projectToken }),
      });
      const body = (await res.json().catch(() => ({}))) as CloudBody & {
        expiresAt?: unknown;
        user?: { role?: unknown };
      };
      if (res.ok && body?.token) {
        hubToken = body.token;
        // The cell reports when this session dies (≤ the 12 h project-token
        // cap). Persisted so the sync runtime can renew BEFORE the deadline —
        // discarding it here is what made every link silently expire.
        if (typeof body.expiresAt === 'number' && Number.isFinite(body.expiresAt))
          hubTokenExpiresAt = body.expiresAt;
        if (typeof body.user?.role === 'string' && body.user.role) vouchedRole = body.user.role;
      }
    } catch {
      /* handled below */
    }
    if (!hubToken) {
      return {
        status: 502,
        json: {
          ok: false,
          error: 'The workspace did not accept the sign-in. Try again in a minute.',
        },
      };
    }

    const norm = normalizeUrl(workspaceUrl);
    saveHubCredential(norm, hubToken, vouchedRole, hubTokenExpiresAt);

    // Project side — linkedHub in .design/config.json (committed; no token).
    const cfgPath = join(ctx.paths.designRoot, 'config.json');
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    } catch {
      /* absent/malformed → start minimal */
    }
    const linkedHub: { url: string; linkedAt: number; syncTsx?: boolean } = {
      url: norm,
      linkedAt: Date.now(),
    };
    // Carry a project-wide TSX opt-out across the re-link. Only the RESTRICTIVE
    // direction is carried (`false`, never `true`): somebody who turned canvas
    // BODIES off (DDR-072/DDR-079) did so deliberately, and silently re-enabling
    // them on the next Connect would start uploading source they opted out of.
    // It never mattered while nothing synced until a restart; it does now.
    const prior = (cfg as { linkedHub?: { syncTsx?: boolean } }).linkedHub;
    if (prior?.syncTsx === false) linkedHub.syncTsx = false;
    cfg.linkedHub = linkedHub;
    writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');

    // START SYNCING — do not hand the person a "restart the server" note and
    // call the job done. The runtime captures linkedHub once at boot, so this
    // cycles it in place, with the value we JUST wrote (never re-read from the
    // committed config file). Best-effort: a supervisor-less embedder, or a
    // runtime that declines, still leaves a correctly linked project behind.
    let sync: { syncing: boolean; canvases: number; reason?: string; detail?: string } = {
      syncing: false,
      canvases: 0,
      reason: 'no-supervisor',
      detail: 'Restart Maude to start syncing.',
    };
    try {
      sync = (await ctx.syncControl?.restart(linkedHub)) ?? sync;
    } catch (err) {
      sync = {
        syncing: false,
        canvases: 0,
        reason: 'error',
        detail: `Linked, but syncing could not start: ${(err as Error).message}`,
      };
    }

    ctx.onLinkChanged?.();

    return {
      status: 200,
      json: {
        ok: true,
        url: norm,
        role: role ?? null,
        project: project ?? null,
        sync,
        // Kept for older clients (and the CLI) that read `note` — now it
        // reports what actually happened instead of assigning homework.
        note: sync.syncing
          ? `Linked — syncing ${sync.canvases} canvas${sync.canvases === 1 ? '' : 'es'}.`
          : `Linked. ${sync.detail ?? 'Restart Maude to start syncing.'}`,
      },
    };
  }
}
