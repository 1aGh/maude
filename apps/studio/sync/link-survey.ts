// 2.1.1 — what linking THIS folder to a team server would do, counted before anything moves
// (routes/hub-link-folder.ts, decision maude/v2-2.1.1-b5-link-folder-confirm-before-merge).
//
// A self-hosted server holds ONE project. When it is empty, linking seeds it from this folder (the
// sync runtime's ordinary seed-up). When it already holds work, the two sides would be merged, so the
// person is told first, in counts:
//
//   onlyHere   canvases + files on this Mac the server does not have (they go up)
//   onlyThere  canvases + files on the server this Mac does not have (they come down)
//   differ     on both sides with different content (they are merged)
//   same       on both sides, identical
//
// Both sides are read the way the sync runtime reads them: the server through its own manifests
// (`GET /api/projects/current/v1/bootstrap` — canvas paths + the `html` lane's sha256 — and
// `GET /api/files`, the file plane's sha256 manifest), this Mac through the file plane's walk and
// classifier (`walkClassifiedAll`). Nothing here writes, and the credential only rides requests to
// the server it belongs to: a redirect is refused, never followed.
//
// An older server without the accepted-revisions bootstrap answers its document listing instead
// (`GET /api/documents`: names and byte counts). Content cannot be compared from that, so a canvas
// on both sides counts as `differ` — the safe direction: it can only ask for a confirm, never skip one.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CanvasGroupLike } from './file-membership.ts';
import { walkClassifiedAll } from './file-plane.ts';
import { slugFromDocName } from './remote-docs.ts';

export interface SideSurvey {
  /** design-root-relative canvas body path (`ui/home.tsx`) → sha256 of its source, null = unknown */
  canvases: Map<string, string | null>;
  /** design-root-relative file path → sha256 */
  files: Map<string, string>;
  /** canvases are compared by slug only (an older server's listing) */
  bySlug?: boolean;
  /** This Mac's side only: the files that are pictures, video and the like (the inert-media class). */
  media?: Set<string>;
  /**
   * The server's side only (2.1.1 T14): whether it has a place to store media. `false` only when it
   * said so (no file journal and no checkout); a server that did not answer is assumed to store it.
   */
  storesMedia?: boolean;
}

export interface LinkCounts {
  onlyHere: number;
  onlyThere: number;
  differ: number;
  same: number;
}

export type HubSurvey =
  | { ok: true; survey: SideSurvey }
  | { ok: false; reason: 'signed-out' | 'offline' };

const TIMEOUT_MS = 15_000;
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;

/** A canvas body path's slug, the way a flat document name spells it. */
export function slugOfRel(rel: string): string {
  return path.posix
    .basename(rel)
    .replace(/\.tsx$/i, '')
    .toLowerCase();
}

/** This Mac's side: canvas bodies + file-plane files, through the plane's own walk. */
export function surveyLocal(
  designRoot: string,
  canvasGroups?: readonly CanvasGroupLike[]
): SideSurvey {
  const canvases = new Map<string, string | null>();
  const files = new Map<string, string>();
  const media = new Set<string>();
  for (const f of walkClassifiedAll(designRoot, canvasGroups)) {
    if (f.cls === 'never') continue;
    let hash: string | null = null;
    try {
      hash = sha256(readFileSync(f.abs));
    } catch {
      hash = null;
    }
    if (f.cls === 'canvas-owned') {
      if (/\.tsx$/i.test(f.rel)) canvases.set(f.rel, hash);
      continue;
    }
    if (hash) {
      files.set(f.rel, hash);
      if (f.cls === 'inert-media') media.add(f.rel);
    }
  }
  return { canvases, files, media };
}

type Got = { status: number; body: Record<string, unknown> | null };

async function getJson(url: string, token: string, doFetch: typeof fetch): Promise<Got> {
  try {
    const res = await doFetch(url, {
      headers: { authorization: `Bearer ${token}` },
      // the credential belongs to this server: a redirect would carry it elsewhere
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) return { status: res.status, body: null };
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: 200, body: body && typeof body === 'object' ? body : null };
  } catch {
    return { status: 0, body: null };
  }
}

const refused = (s: number) => s === 401 || s === 403;

/**
 * Does the server have a place for pictures and videos? A server that carries the file journal
 * (`ledger`) stores them in it; an older one stores them in its project checkout. With neither, its
 * media door answers 405 and they stay on this Mac (sync/media-gate.ts). Unknown is "yes": the line
 * this feeds is only said when the server told us it can't.
 */
export function serverStoresMedia(health: Record<string, unknown> | null): boolean {
  if (!health) return true;
  const caps = health.capabilities;
  if (!Array.isArray(caps)) return true; // a server that predates capabilities: say nothing
  if (caps.includes('ledger')) return true;
  const checkout = (health.workspace as { checkout?: unknown } | undefined)?.checkout;
  return checkout === 'present';
}

/** The server's side, with the credential this Mac holds for it. */
export async function surveyHub(
  hubUrl: string,
  token: string,
  doFetch: typeof fetch = fetch
): Promise<HubSurvey> {
  const base = hubUrl.replace(/\/+$/, '');
  const canvases = new Map<string, string | null>();
  const files = new Map<string, string>();
  let bySlug = false;

  const boot = await getJson(`${base}/api/projects/current/v1/bootstrap`, token, doFetch);
  if (refused(boot.status)) return { ok: false, reason: 'signed-out' };
  if (boot.status === 200 && Array.isArray(boot.body?.docs)) {
    for (const d of boot.body.docs as unknown[]) {
      const row = d as { path?: unknown; retired?: unknown; lanes?: unknown };
      if (!row || row.retired || typeof row.path !== 'string' || !row.path) continue;
      const html = (row.lanes as { html?: { hash?: unknown } } | undefined)?.html?.hash;
      canvases.set(row.path, typeof html === 'string' && HEX64.test(html) ? html : null);
    }
  } else {
    // an older server: its listing (names + byte counts) — a name that holds nothing is not work
    const list = await getJson(`${base}/api/documents`, token, doFetch);
    if (refused(list.status)) return { ok: false, reason: 'signed-out' };
    if (list.status !== 200 || !Array.isArray(list.body?.documents))
      return { ok: false, reason: 'offline' };
    bySlug = true;
    for (const d of list.body.documents as unknown[]) {
      const row = d as { name?: unknown; bytes?: unknown };
      const slug = typeof row?.name === 'string' ? slugFromDocName(row.name) : null;
      if (slug && Number(row.bytes) > 0) canvases.set(slug, null);
    }
  }

  const manifest = await getJson(`${base}/api/files`, token, doFetch);
  if (refused(manifest.status)) return { ok: false, reason: 'signed-out' };
  if (manifest.status === 200 && Array.isArray(manifest.body?.files)) {
    for (const f of manifest.body.files as unknown[]) {
      const row = f as { path?: unknown; sha256?: unknown };
      if (typeof row?.path === 'string' && typeof row.sha256 === 'string' && HEX64.test(row.sha256))
        files.set(row.path, row.sha256);
    }
  } else if (manifest.status === 0) {
    return { ok: false, reason: 'offline' };
  }
  // any other answer (an older server without the file plane) = no files there

  // 2.1.1 T14 — can this server store media at all? (`/health` needs no credential)
  const health = await getJson(`${base}/health`, token, doFetch);
  const storesMedia = serverStoresMedia(health.status === 200 ? health.body : null);

  return {
    ok: true,
    survey: {
      canvases,
      files,
      ...(bySlug ? { bySlug } : {}),
      ...(storesMedia ? {} : { storesMedia }),
    },
  };
}

/** Does the server hold any work at all? */
export function holdsWork(s: SideSurvey): boolean {
  return s.canvases.size > 0 || s.files.size > 0;
}

function countMaps(
  here: ReadonlyMap<string, string | null>,
  there: ReadonlyMap<string, string | null>,
  out: LinkCounts
): void {
  for (const [k, h] of here) {
    if (!there.has(k)) out.onlyHere++;
    else {
      const t = there.get(k) ?? null;
      if (h && t && h === t) out.same++;
      else out.differ++;
    }
  }
  for (const k of there.keys()) if (!here.has(k)) out.onlyThere++;
}

export interface LinkComparison extends LinkCounts {
  /** the same four counts, canvases only and files only (the dialog names each) */
  canvases: LinkCounts;
  files: LinkCounts;
  /**
   * 2.1.1 T14 — pictures and videos only this Mac has that the server has no place for: they stay
   * here, so they are NOT in `onlyHere` ("sent up"). Absent when there are none.
   */
  stayHere?: number;
}

const zero = (): LinkCounts => ({ onlyHere: 0, onlyThere: 0, differ: 0, same: 0 });

/** Here vs there: the four counts the dialog words, in total and per kind. */
export function compareSurveys(here: SideSurvey, there: SideSurvey): LinkComparison {
  const canvases = zero();
  const files = zero();
  const localCanvases = there.bySlug
    ? new Map([...here.canvases.keys()].map((rel) => [slugOfRel(rel), null as string | null]))
    : here.canvases;
  countMaps(localCanvases, there.canvases, canvases);
  countMaps(here.files, there.files, files);
  // media only this Mac has, on a server that can't store it: counted apart, never "sent up"
  let stay = 0;
  if (there.storesMedia === false && here.media) {
    for (const rel of here.media) if (here.files.has(rel) && !there.files.has(rel)) stay++;
    files.onlyHere -= stay;
  }
  return {
    ...(stay ? { stayHere: stay } : {}),
    onlyHere: canvases.onlyHere + files.onlyHere,
    onlyThere: canvases.onlyThere + files.onlyThere,
    differ: canvases.differ + files.differ,
    same: canvases.same + files.same,
    canvases,
    files,
  };
}
