// 2.1.1 — "Link your server" in a project tab connects THIS folder to the person's own team server
// (decision maude/v2-2.1.1-b5-link-folder-confirm-before-merge).
//
//   POST /_api/hub/link-folder { url }            → { ok, state: 'linked', url, sync }
//                                                  | { ok, state: 'needs-confirm', confirm, counts, host }
//   POST /_api/hub/link-folder { url, confirm }   → { ok, state: 'linked', … }   (the person said yes)
//
// The sign-in already happened on the server's own page (`/_api/hub-signin/*`), which stored this Mac's
// credential for it; this route only uses that credential. A self-hosted server holds ONE project:
//
//   • (2.1.1 T8) a server this Mac never linked any folder to → ALWAYS the confirm below first, with
//     what goes up (`empty: true` when the server holds nothing) — the server's survey is its word;
//   • it holds nothing yet → link now: the folder's format marker goes up first (raise-only, V2-1.12
//     §5.2, as Move to cloud), then the attach lane (`cloud/endpoints.ts` `attachStored` → `linkFolder`:
//     linkedHub in config.json, the link recorded on this Mac, the live sync runtime cycled — whose
//     seed-up uploads the folder);
//   • it already holds work → NOTHING is written: the answer counts what only this Mac has, what only
//     the server has and what differs (sync/link-survey.ts), with a one-time confirm code bound to that
//     server. A second POST with the code links, exactly as above. Never a silent two-way merge.
//
// linkedHub is written only by the attach lane, only on success. A folder already linked to another
// server, a worktree tab, a server this Mac holds no sign-in for and a server on a newer format than
// this build are refused before anything moves.
//
// MAIN ORIGIN, WINDOW ONLY: it spends the team-server credential and uploads the project, so it is the
// person's act in the Maude window — the same gate as Move to cloud (`Sec-Fetch-Site: same-origin`,
// which a page cannot forge and the loopback helper refuses to send), plus PERSON_ONLY (shell/api-key.ts)
// and `guardTableRoute`'s CSRF + DNS-rebind gates. Never canvas-safe; a cell never serves it
// (apps/hub/src/studio-manifest.mjs: REFUSED — a cell holds no team-server credential of its own).
// No answer ever carries a credential.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CloudEndpointResult } from '../cloud/endpoints.ts';
import { SUPPORTED_FORMAT } from '../format.ts';
import { hubAddress } from '../home/hub.ts';
import { createHubFormatClient } from '../migrate/hub.ts';
import { worktreeOf } from '../shell/worktree.ts';
import type { CanvasGroupLike } from '../sync/file-membership.ts';
import { getHubRecord, normalizeUrl } from '../sync/hubs-config.ts';
import { hubEverLinked, linksPath, normHub, projectLinkOf } from '../sync/link-consent.ts';
import {
  compareSurveys,
  holdsWork,
  type LinkComparison,
  surveyHub,
  surveyLocal,
} from '../sync/link-survey.ts';
import type { RouteSpec } from './table.ts';

export const HUB_LINK_FOLDER_PATH = '/_api/hub/link-folder';

export interface HubLinkFolderDeps {
  designRoot: string;
  /** config.json `canvasGroups` — the plane's walk classifies against them */
  canvasGroups?: () => readonly CanvasGroupLike[] | undefined;
  /** the folder's own format marker (config.json `formatVersion ?? 1`) */
  localFormat: () => number;
  /** the attach lane (cloud/endpoints.ts) — the one place linkedHub is written */
  attachStored(hubUrl: string): Promise<CloudEndpointResult>;
  /** this profile's hubs.json; absent = `hubsConfigPath()` */
  hubsConfigPath?: string;
  /** #206 §5 — the main project's name when this server serves a worktree tab */
  worktreeOf?: () => string | null;
  /** 2.1.1 T8 — the folder holding `.design/`: "already linked" is decided by THIS Mac's link record
   *  for it (sync/link-consent.ts), never by the committed config.json alone. Absent = the record is
   *  not consulted (the claim alone decides, as before). */
  repoRoot?: string;
  /** this Mac's link records (`project-links.json`); absent = `linksPath()` */
  linksFile?: string;
  /** seams for tests */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** CONTRACT §3–§4 voice. Every refusal says nothing was linked. */
export const LINK_FOLDER_WORDS = {
  windowOnly: 'Link your server from the Maude window.',
  badAddress: 'That doesn’t look like a server address. Nothing was linked.',
  signedOut: (host: string) => `Sign in to ${host} first. Nothing was linked.`,
  offline: (host: string) =>
    `${host} didn’t answer. Nothing was linked — try again when this Mac is online.`,
  linkedElsewhere: (host: string) =>
    `This project already syncs with ${host}. Unlink it there first. Nothing was linked.`,
  worktree: (main: string) => `This folder syncs from ${main}. Link ${main} instead.`,
  newer: (host: string) =>
    `${host} runs a newer Maude than this one. Update Maude, then link again. Nothing was linked.`,
  format: (host: string) =>
    `${host} needs an update before this project can sync with it. Nothing was linked.`,
  // 2.1.1 T14 — the server's software is current, but its project is still on the old format and only
  // the project's OWNER can raise it: a member can do nothing about "needs an update"
  formatOwner: (host: string) =>
    `${host} is on an older format. Its owner needs to open it in Maude 2.1 once before this folder can sync. Nothing was linked.`,
  expired: 'That confirmation expired. Press Link again to see what syncing would do.',
  failed: 'Linking didn’t finish. Your work is still on this Mac.',
};

const CONFIRM_TTL_MS = 10 * 60_000;
const MAX_PENDING = 16;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

class LinkRefusal extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string
  ) {
    super(message);
  }
}

export function createHubLinkFolderRoutes(deps: HubLinkFolderDeps): RouteSpec[] {
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  /** confirm code → the server it was shown for. One use; a restart forgets them (the safe way). */
  const pending = new Map<string, { url: string; expires: number }>();
  /** Serialises POSTs: two presses must not link twice or race the config write. */
  let gate: Promise<unknown> = Promise.resolve();

  const linksFile = () => deps.linksFile ?? linksPath();

  /** The server this folder is linked to ON THIS MAC, or null. The committed `linkedHub` is a claim
   *  (a clone, a peer's edit): it counts only when this Mac's link record for the folder names the
   *  same server (gate-b-sec4). An unconfirmed claim is "not linked" — never "already linked", never
   *  "unlink it there first" pointing at a host the repo names. */
  function linkedHub(): string | null {
    let url: string;
    try {
      const cfg = JSON.parse(readFileSync(join(deps.designRoot, 'config.json'), 'utf8'));
      const raw = cfg?.linkedHub?.url;
      if (typeof raw !== 'string' || !raw) return null;
      try {
        url = normalizeUrl(raw);
      } catch {
        url = raw;
      }
    } catch {
      return null;
    }
    if (deps.repoRoot === undefined) return url;
    const rec = projectLinkOf(deps.repoRoot, linksFile());
    return rec && rec.hub === normHub(url) ? url : null;
  }

  function mint(url: string): string {
    const t = now();
    for (const [k, v] of pending) if (v.expires <= t) pending.delete(k);
    while (pending.size >= MAX_PENDING) {
      const oldest = pending.keys().next().value;
      if (oldest === undefined) break;
      pending.delete(oldest);
    }
    const code = randomBytes(18).toString('base64url');
    pending.set(code, { url, expires: t + CONFIRM_TTL_MS });
    return code;
  }

  function redeem(code: string, url: string): boolean {
    const row = pending.get(code);
    if (!row) return false;
    pending.delete(code); // one use, whatever the outcome
    return row.url === url && row.expires > now();
  }

  /** V2-1.12 §5.2 — raise-only, before the first seed-up; a newer server is refused. */
  async function checkFormat(url: string, token: string): Promise<void> {
    const host = hostOf(url);
    const client = createHubFormatClient({ url, token }, doFetch);
    const health = await client.health();
    if (!health.ok) throw new LinkRefusal(503, 'offline', LINK_FOLDER_WORDS.offline(host));
    const hub = health.formatVersion ?? 1;
    if (hub > SUPPORTED_FORMAT)
      throw new LinkRefusal(409, 'format-newer', LINK_FOLDER_WORDS.newer(host));
    const local = deps.localFormat();
    if (!(local > 1) || hub >= local) return;
    if (!health.capabilities.includes('format-v2'))
      throw new LinkRefusal(409, 'format', LINK_FOLDER_WORDS.format(host));
    const set = await client.setFormat(local === 2 ? 2 : 1);
    if (!set.ok) {
      if (set.status === 0) throw new LinkRefusal(503, 'offline', LINK_FOLDER_WORDS.offline(host));
      // the owner's door: a member's bearer is refused there
      if (set.status === 401 || set.status === 403)
        throw new LinkRefusal(409, 'format-owner', LINK_FOLDER_WORDS.formatOwner(host));
      throw new LinkRefusal(409, 'format', LINK_FOLDER_WORDS.format(host));
    }
  }

  async function link(url: string, token: string): Promise<Response> {
    await checkFormat(url, token);
    const attached = await deps.attachStored(url);
    const j = (attached.json ?? {}) as {
      ok?: unknown;
      url?: unknown;
      sync?: unknown;
      note?: unknown;
    };
    if (attached.status === 401)
      throw new LinkRefusal(401, 'signed-out', LINK_FOLDER_WORDS.signedOut(hostOf(url)));
    if (attached.status !== 200 || j.ok !== true || typeof j.url !== 'string')
      throw new LinkRefusal(502, 'failed', LINK_FOLDER_WORDS.failed);
    // the attach answer, minus anything but what the dialog reads (it carries no credential today;
    // naming the fields keeps it that way if the lane's answer ever grows)
    return json(200, {
      ok: true,
      state: 'linked',
      url: j.url,
      sync: j.sync ?? null,
      ...(typeof j.note === 'string' ? { note: j.note } : {}),
    });
  }

  async function handle(req: Request): Promise<Response> {
    let body: { url?: unknown; confirm?: unknown } = {};
    try {
      const text = await req.text();
      if (text.length > 4096) throw new Error('too long');
      body = text.trim() ? JSON.parse(text) : {};
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new Error('not an object');
    } catch {
      return json(400, { ok: false, reason: 'bad-request', error: LINK_FOLDER_WORDS.badAddress });
    }
    // 2.1.1 T8 — the one address grammar every other door uses: https, or http only on loopback (the
    // credential and the whole folder never travel in clear to a remote host)
    const addr = hubAddress(body.url);
    if (!addr.ok)
      return json(400, { ok: false, reason: 'bad-address', error: LINK_FOLDER_WORDS.badAddress });
    const url = addr.url;
    const host = hostOf(url);

    const linked = linkedHub();
    if (linked && linked === url)
      return json(200, { ok: true, state: 'linked', url, already: true });
    if (linked)
      return json(409, {
        ok: false,
        reason: 'linked-elsewhere',
        error: LINK_FOLDER_WORDS.linkedElsewhere(hostOf(linked)),
      });

    const rec = getHubRecord(url, deps.hubsConfigPath);
    if (!rec?.token)
      return json(401, {
        ok: false,
        reason: 'signed-out',
        error: LINK_FOLDER_WORDS.signedOut(host),
      });

    try {
      if (body.confirm !== undefined) {
        if (typeof body.confirm !== 'string' || !redeem(body.confirm, url))
          return json(409, {
            ok: false,
            reason: 'confirm-expired',
            error: LINK_FOLDER_WORDS.expired,
          });
        return await link(url, rec.token);
      }

      const there = await surveyHub(url, rec.token, doFetch);
      if (!there.ok) {
        return there.reason === 'signed-out'
          ? json(401, { ok: false, reason: 'signed-out', error: LINK_FOLDER_WORDS.signedOut(host) })
          : json(503, { ok: false, reason: 'offline', error: LINK_FOLDER_WORDS.offline(host) });
      }
      // 2.1.1 T8 — the FIRST link to a server this Mac never linked always asks, with what goes up,
      // whatever the server says it holds (its survey is the server's word, not the person's).
      const first = !hubEverLinked(url, linksFile());
      if (!holdsWork(there.survey) && !first) return await link(url, rec.token);

      const counts: LinkComparison = compareSurveys(
        surveyLocal(deps.designRoot, deps.canvasGroups?.()),
        there.survey
      );
      return json(200, {
        ok: true,
        state: 'needs-confirm',
        host,
        counts,
        confirm: mint(url),
        // the server holds nothing: the dialog says what goes up, not what merges
        ...(holdsWork(there.survey) ? {} : { empty: true }),
      });
    } catch (err) {
      if (err instanceof LinkRefusal)
        return json(err.status, { ok: false, reason: err.reason, error: err.message });
      console.error(`[hub-link-folder] ${(err as Error)?.message}`);
      return json(500, { ok: false, reason: 'failed', error: LINK_FOLDER_WORDS.failed });
    }
  }

  return [
    {
      method: 'POST',
      path: '/_api/hub/link-folder',
      origin: 'main',
      // the `session` class, like Move to cloud: linking your own folder is the owner's act on their own
      // place; a folder already linked (the only one a hub role applies to) answers 409 first
      readOnly: 'allowed',
      handle(req) {
        // the person's act in the Maude window: only a browser's own same-origin fetch carries this
        if (req.headers.get('sec-fetch-site') !== 'same-origin')
          return json(403, {
            ok: false,
            reason: 'window-only',
            error: LINK_FOLDER_WORDS.windowOnly,
          });
        // #206 §5: a worktree tab syncs from its main project — linking it would make a second copy
        const main = (deps.worktreeOf ?? worktreeOf)();
        if (main)
          return json(409, {
            ok: false,
            reason: 'worktree',
            error: LINK_FOLDER_WORDS.worktree(main),
          });
        const next = gate.then(() => handle(req));
        gate = next.catch(() => null);
        return next;
      },
    },
  ];
}
