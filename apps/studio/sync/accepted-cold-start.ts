// Cold start under accepted revisions — DDR-241 §3, plan T13/T14.
//
// The legacy cold start (`migrate-seed.ts`) had to CHOOSE a source and write it
// into the shared document, because the document was writable and whatever a
// peer put there was the project. Here the document is a read-only replica of
// the accepted state, so cold start only ever DECIDES, per lane:
//
//   agreed       — disk already holds the accepted value;
//   materialize  — disk is older than the project (or absent): the projection
//                  writes the accepted value, keeping local bytes in recovery;
//   propose      — disk carries a change made on top of a known base: it is
//                  proposed, and the hub merges it three-way from that base;
//   hold         — disk differs and nothing proves what it was derived from:
//                  both are kept, the lane stays blocked with a visible
//                  conflict, and the next save resolves it (T2's rule — never a
//                  silent overwrite of either side).
//
// A canvas the project does not know yet is proposed as `doc.create` with all
// of its lanes, so it arrives on every peer as ONE action.
//
// Comments and annotations are never re-proposed from disk here: every change
// the studio made to them went through the durable outbox (drained before any
// cold start), so a difference on disk is an older accepted state the room had
// not re-projected — the accepted value wins, and the local file is kept in a
// recovery slot in case a raw edit made while the studio was down lived there.

import { existsSync, readFileSync } from 'node:fs';
import type * as Y from 'yjs';

import { cssFromDoc, htmlFromDoc, laneValueFromFile, readLaneFromDoc } from './codec.ts';
import { hashBytes } from './echo-guard.ts';
import type { SyncJournal } from './journal.ts';
import type { DocProjection, ProjectionPaths, ProposalLane } from './projection.ts';
import { readRecoveryBody, saveRecoveryBody } from './source-recovery.ts';
import { sourceError } from './source-validation.ts';

export type LaneDecision = 'agreed' | 'materialize' | 'propose' | 'hold';

export interface LaneVerdict {
  lane: ProposalLane;
  decision: LaneDecision;
  /** For `propose`: the value the local edit was derived from. For `hold`: the accepted value adopted as the base. */
  base?: string;
  local?: string;
}

function readText(p: string | undefined): string | null {
  if (!p || !existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Pure decision for the source lanes. `knownBase` is the last value disk and
 * the accepted replica agreed on (recovery slot), `baseHash` the journal's
 * hash of it when the bytes are gone.
 */
export function decideSourceLane(input: {
  local: string | null;
  accepted: string;
  knownBase: string | null;
  baseHash?: string | null;
}): { decision: LaneDecision; base?: string } {
  const { local, accepted } = input;
  if (local === null) return { decision: 'materialize' };
  if (local === accepted) return { decision: 'agreed' };
  let base = input.knownBase;
  if (base === null && input.baseHash) {
    if (hashBytes(accepted) === input.baseHash) base = accepted;
    else if (hashBytes(local) === input.baseHash) base = local;
  }
  if (base === null) {
    // The project never had this lane: nothing of anybody's can be lost.
    if (accepted === '') return { decision: 'propose', base: '' };
    return { decision: 'hold', base: accepted };
  }
  if (base === local) return { decision: 'materialize' }; // an older accepted state
  return { decision: 'propose', base };
}

export interface AcceptedColdStartInput {
  slug: string;
  doc: Y.Doc;
  paths: ProjectionPaths;
  /** Design-root-relative body path (`ui/home.tsx`). */
  rel: string;
  /** Is this canvas a live document of the project's accepted state? */
  inProject: boolean;
  projection: DocProjection;
  historyDir?: string;
  journal?: SyncJournal;
  createDoc: (lanes: Partial<Record<ProposalLane, string>>) => Promise<{
    status: 'accepted' | 'rejected';
    code?: string;
  }>;
  log?: Pick<Console, 'log' | 'warn'>;
}

export type AcceptedColdStartResult =
  | { kind: 'created' }
  | { kind: 'create-refused'; code?: string }
  | { kind: 'reconciled'; verdicts: LaneVerdict[] };

export async function acceptedColdStart(
  i: AcceptedColdStartInput
): Promise<AcceptedColdStartResult> {
  const log = i.log ?? console;
  const localHtml = readText(i.paths.html);

  if (!i.inProject) {
    if (localHtml === null) return { kind: 'reconciled', verdicts: [] };
    const lanes: Partial<Record<ProposalLane, string>> = { html: localHtml };
    const css = readText(i.paths.css);
    if (css) lanes.css = css;
    const metaText = readText(i.paths.meta);
    const meta = metaText === null ? null : laneValueFromFile('meta', metaText);
    if (meta && meta !== '{}') lanes.meta = meta;
    const ann = readText(i.paths.annotations);
    if (ann) lanes.annotations = ann;
    const commentsText = readText(i.paths.comments);
    const comments = commentsText === null ? null : laneValueFromFile('comments', commentsText);
    if (comments) lanes.comments = comments;
    const r = await i.createDoc(lanes);
    if (r.status === 'accepted') {
      // What the project now holds IS the local file: the next save is based
      // on it, even if it lands before the publication reaches this replica.
      i.projection.adoptBase(localHtml);
      log.log(`[sync/${i.slug}] added to the project (accepted).`);
      return { kind: 'created' };
    }
    log.warn(
      `[sync/${i.slug}] the project did not accept this canvas (${r.code ?? 'rejected'}) — it stays local.`
    );
    return { kind: 'create-refused', code: r.code };
  }

  const verdicts: LaneVerdict[] = [];

  // ---- html — the canvas source
  const acceptedHtml = htmlFromDoc(i.doc);
  if (localHtml !== null && localHtml !== acceptedHtml && sourceError(i.paths.html, localHtml)) {
    // An invalid local body cannot be proposed; the projection keeps its bytes
    // in recovery and reports it when it materializes the accepted source.
    verdicts.push({ lane: 'html', decision: 'materialize', local: localHtml });
  } else {
    const d = decideSourceLane({
      local: localHtml,
      accepted: acceptedHtml,
      knownBase: i.historyDir ? readRecoveryBody(i.historyDir, i.paths.html, 'base') : null,
      baseHash: i.journal?.get(i.slug)?.bodyHash ?? null,
    });
    verdicts.push({ lane: 'html', ...d, ...(localHtml !== null ? { local: localHtml } : {}) });
  }

  // ---- css — opaque text, journal-checkpointed
  if (i.paths.css) {
    const localCss = readText(i.paths.css);
    const d = decideSourceLane({
      local: localCss,
      accepted: cssFromDoc(i.doc) ?? '',
      knownBase: i.historyDir ? readRecoveryBody(i.historyDir, i.paths.css, 'base') : null,
      baseHash: i.journal?.get(i.slug)?.cssHash ?? null,
    });
    verdicts.push({ lane: 'css', ...d, ...(localCss !== null ? { local: localCss } : {}) });
  }

  // ---- meta — the shared layout keys (viewport never travels)
  if (i.paths.meta) {
    const metaText = readText(i.paths.meta);
    const local = metaText === null ? null : laneValueFromFile('meta', metaText);
    const accepted = readLaneFromDoc(i.doc, 'meta');
    if (local === null || local === accepted || (local === '{}' && accepted === '')) {
      verdicts.push({ lane: 'meta', decision: local === null ? 'materialize' : 'agreed' });
    } else if (accepted === '') {
      verdicts.push({ lane: 'meta', decision: 'propose', base: '', local });
    } else {
      // No base is recorded for layout: the project's arrangement wins and the
      // projection merges it into the local file's private keys.
      verdicts.push({ lane: 'meta', decision: 'materialize', local });
    }
  }

  // ---- comments / annotations — the accepted value wins (see header)
  for (const lane of ['comments', 'annotations'] as const) {
    const p = lane === 'comments' ? i.paths.comments : i.paths.annotations;
    const text = readText(p);
    const local = text === null ? null : laneValueFromFile(lane, text);
    const accepted = readLaneFromDoc(i.doc, lane);
    if (local === null || local === accepted) {
      verdicts.push({ lane, decision: local === null ? 'materialize' : 'agreed' });
      continue;
    }
    if (i.historyDir && text) {
      try {
        saveRecoveryBody(i.historyDir, p, 'local', text);
      } catch {
        /* recovery is best-effort for these lanes */
      }
    }
    verdicts.push({ lane, decision: 'materialize', local: text ?? undefined });
  }

  // ---- act
  for (const v of verdicts) {
    if (v.decision === 'propose' && v.local !== undefined) {
      const value = v.lane === 'meta' ? v.local : (laneValueFromFile(v.lane, v.local) ?? v.local);
      if (v.lane === 'html') i.projection.adoptBase(v.base ?? '');
      // Stageable: a restored unfinished AI action (T16) keeps its canvases'
      // differences for the person's decision instead of publishing them.
      void i.projection.proposeLane(v.lane, value, { baseContent: v.base ?? '', stageable: true });
    } else if (v.decision === 'hold' && v.local !== undefined) {
      i.projection.hold(v.lane, v.base ?? '', v.local);
    }
  }
  const moved = verdicts.filter((v) => v.decision === 'propose' || v.decision === 'hold');
  if (moved.length) {
    log.log(
      `[sync/${i.slug}] cold start: ${moved.map((v) => `${v.lane}=${v.decision}`).join(', ')}`
    );
  }
  return { kind: 'reconciled', verdicts };
}
