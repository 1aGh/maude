// client/v2/ds/library-host.jsx — S10.18c: the shell's side of a linked team library (13 · ds-many-library,
// ds-many-linked; V2-1.6 §5.14).
//
// Mounted once inside DsReviewHost. It
//   - reads which systems are linked (`GET /_api/ds/state`) and asks the library whether it moved: on project open
//     and every 30 minutes (`POST /_api/ds/library {action:'check'}` — the server bounds it to one hub request per
//     system per 30 minutes anyway, and a failure stays quiet until the card is looked at),
//   - keeps the open linked system's card in a tiny store (library-store.js → the inspector's empty place),
//   - answers the registry actions through library-bus.js: `ds.library-link`, `ds.library-update`, `ds.library-unlink`,
//   - runs "Update from <system>? N changes" and then the existing DsReviewSheet, whose Update posts the ONE
//     `update` action (the server re-reads the hub, verifies the revision and refuses when anything moved).
//
// Every write is the server's to refuse (Can edit on the whole project, rule 12): a refusal comes back as a code and
// becomes the person's words. A Mac that holds no grant for the library (a peer of whoever linked it) can look but
// not check or update: the server says `ds-library-no-grant` and the card says who can.

import { useCallback, useEffect, useRef, useState } from 'react';
import { isDisplayableUrl, openExternal } from '../../panels/CloudBar.jsx';
import {
  bannerModel,
  byWhen,
  cardModel,
  changeCount,
  changeLines,
  dialogTitle,
  isWaiting,
  LIBRARY_CHECK_MS,
  LIBRARY_WORDS,
  linkedRows,
  refusalWords,
  relinkLead,
  updateBody,
  updatedWords,
} from './library-model.js';
import {
  DsLibraryBanner,
  DsLibraryDialog,
  DsLibraryLink,
  DsLibraryUnlink,
} from './library-card.jsx';
import { onDsLibraryRequest } from './library-bus.js';
import { setLibrary, setLibraryActions } from './library-store.js';
import { DsReviewSheet } from './review-sheet.jsx';
import { ownSystemOf } from './truth-model.js';
import { agoWords } from './update-model.js';

/** how long after the shell mounts the project-open check waits (the shell's own reads go first) */
const OPEN_DELAY_MS = 1500;
const JSON_HEADERS = { 'content-type': 'application/json' };

async function call(fetchImpl, method, url, body) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      cache: 'no-store',
      ...(body ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}),
    });
  } catch {
    return { ok: false, code: 'unreachable', body: null };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* an unreadable answer is judged by its status */
  }
  const code = res.ok ? null : (json?.code ?? (res.status === 403 ? 'forbidden' : 'failed'));
  return { ok: res.ok, code, body: json };
}

const library = (fetchImpl, body) => call(fetchImpl, 'POST', '/_api/ds/library', body);

/** The linked systems of this project, or [] (the state read failing is not worth a word). */
export async function loadLinked(fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, 'GET', '/_api/ds/state');
  return r.ok ? linkedRows(r.body) : [];
}

/** Ask the library whether it moved. `{ ok, usedBy, noGrant, code }`. */
export async function checkLibrary(ds, fetchImpl = globalThis.fetch, force = false) {
  const r = await library(fetchImpl, { action: 'check', ds, ...(force ? { force: true } : {}) });
  if (r.ok)
    return { ok: true, usedBy: Number.isSafeInteger(r.body?.usedBy) ? r.body.usedBy : null };
  return {
    ok: false,
    code: r.code,
    noGrant: r.code === 'ds-library-no-grant',
    relink: r.code === 'ds-library-relink',
  };
}

/**
 * "Link again" (A3): with the library's link (or its key) pasted again, this Mac takes the system's current library
 * record as its own link (gate-b-sec2: never on one click). Nothing goes to the hub.
 */
export async function relinkLibrary(ds, fetchImpl = globalThis.fetch, paste = {}) {
  const url = typeof paste.url === 'string' ? paste.url.trim() : '';
  const grant = typeof paste.grant === 'string' ? paste.grant.trim() : '';
  const r = await library(fetchImpl, {
    action: 'relink',
    ds,
    ...(url ? { url } : {}),
    ...(grant ? { grant } : {}),
  });
  return r.ok ? { ok: true } : { ok: false, code: r.code, message: refusalWords(r.code) };
}

/** The review: what the library changed, and this project's canvases (read-only). */
export async function loadLibraryReview(ds, fetchImpl = globalThis.fetch) {
  const r = await library(fetchImpl, { action: 'update', ds, dryRun: true });
  if (!r.ok) return { ok: false, code: r.code, message: refusalWords(r.code) };
  return { ok: true, review: r.body };
}

/** Update: exactly what the review showed, plus the ticks — one action, one ⌘Z. */
export async function takeLibraryUpdate({ ds, review }, rows, fetchImpl = globalThis.fetch) {
  const r = await library(fetchImpl, updateBody({ ds, review }, rows));
  if (!r.ok) return { ok: false, code: r.code, message: refusalWords(r.code) };
  const res = r.body?.result;
  return {
    ok: true,
    updated: Number.isFinite(res?.updated) ? res.updated : 0,
    leftOut: Number.isFinite(res?.leftOut) ? res.leftOut : 0,
  };
}

export async function unlinkLibrary(ds, fetchImpl = globalThis.fetch) {
  const r = await library(fetchImpl, { action: 'unlink', ds });
  return r.ok ? { ok: true } : { ok: false, code: r.code, message: refusalWords(r.code) };
}

export async function linkLibrary(url, grant, fetchImpl = globalThis.fetch) {
  const r = await library(fetchImpl, { action: 'link', url, ...(grant ? { grant } : {}) });
  return r.ok
    ? { ok: true, system: r.body?.system ?? null }
    : { ok: false, code: r.code, message: refusalWords(r.code) };
}

/**
 * @param {{ cfg: any, activePath: string | null, toast?: (m: string, ok?: boolean) => void, scope?: string,
 *           fetchImpl?: typeof fetch, pollMs?: number, delayMs?: number, open?: (url: string) => any, canOpen?: (url: string) => boolean }} props
 */
export function DsLibraryHost({
  cfg,
  activePath,
  toast,
  scope = '',
  fetchImpl,
  pollMs = LIBRARY_CHECK_MS,
  delayMs = OPEN_DELAY_MS,
  open = openExternal,
  canOpen = (url) => isDisplayableUrl(url),
}) {
  const [rows, setRows] = useState([]);
  const [access, setAccess] = useState({}); // ds → 'yes' | 'no'
  const [used, setUsed] = useState({}); // ds → N (members only)
  const [errors, setErrors] = useState({}); // ds → words
  const [counts, setCounts] = useState({}); // ds → { head, review } the review last read, for "N updates waiting"
  const [dialog, setDialog] = useState(null); // { ds, review }
  const [sheet, setSheet] = useState(null); // { ds, review }
  const [unlinking, setUnlinking] = useState(null); // { ds, label, error }
  const [linking, setLinking] = useState(false);
  const [relinking, setRelinking] = useState(null); // { ds, library }
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const live = useRef({ cfg, activePath, toast, fetchImpl, rows });
  live.current = { cfg, activePath, toast, fetchImpl, rows };
  const f = useCallback(() => live.current.fetchImpl ?? globalThis.fetch, []);
  const say = useCallback((m, ok = true) => live.current.toast?.(m, ok), []);

  const openDs = ownSystemOf(activePath, cfg);
  const openRow = rows.find((r) => r.ds === openDs) ?? null;

  /** The state, then a check of each linked system, then the state again (a check can move `upstreamHead`). */
  const refresh = useCallback(async () => {
    const first = await loadLinked(f());
    setRows(first);
    for (const r of first) {
      const c = await checkLibrary(r.ds, f());
      if (c.ok) {
        setAccess((a) => ({ ...a, [r.ds]: 'yes' }));
        setErrors((e) => ({ ...e, [r.ds]: null }));
        setUsed((u) => ({ ...u, [r.ds]: c.usedBy }));
      } else if (c.noGrant || c.relink) {
        setAccess((a) => ({ ...a, [r.ds]: c.relink ? 'relink' : 'no' }));
        setErrors((e) => ({ ...e, [r.ds]: null }));
      } else if (c.code === 'ds-library-unreachable' || c.code === 'unreachable') {
        setErrors((e) => ({ ...e, [r.ds]: LIBRARY_WORDS.offline }));
      } else if (c.code === 'ds-library-denied') {
        setErrors((e) => ({ ...e, [r.ds]: LIBRARY_WORDS.denied }));
      }
    }
    setRows(await loadLinked(f()));
  }, [f]);

  // project open, then every 30 min while the window is looked at
  // biome-ignore lint/correctness/useExhaustiveDependencies: `refresh` reads the live ref; the poll rate is the trigger
  useEffect(() => {
    let dead = false;
    const go = () => {
      if (dead) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      // a project with no converted system has no linked library: nothing to read, nothing to ask
      if (!Object.values(live.current.cfg?.dsConverted ?? {}).some((v) => v === true)) return;
      refresh();
    };
    // "on project open" waits for the first paint: the shell's own reads go first
    const first = setTimeout(go, delayMs);
    const timer = setInterval(go, pollMs);
    return () => {
      dead = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [pollMs, delayMs]);

  // the open linked system: how many updates wait (one read of the review per moved head; never for a Mac without a grant)
  const openHead = openRow?.library?.upstreamHead ?? null;
  const openAccess = openDs ? access[openDs] : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the open system, its moved head and its grant are the triggers
  useEffect(() => {
    if (
      !openDs ||
      !openRow ||
      !isWaiting(openRow) ||
      openAccess === 'no' ||
      openAccess === 'relink'
    )
      return undefined;
    if (counts[openDs]?.head === openHead) return undefined;
    let dead = false;
    (async () => {
      const r = await loadLibraryReview(openDs, f());
      if (dead) return;
      if (r.ok) {
        setCounts((c) => ({ ...c, [openDs]: { head: openHead, review: r.review } }));
        if (Number.isSafeInteger(r.review?.usedBy))
          setUsed((u) => ({ ...u, [openDs]: r.review.usedBy }));
      } else if (r.code === 'ds-library-no-grant' || r.code === 'ds-library-relink') {
        setAccess((a) => ({
          ...a,
          [openDs]: r.code === 'ds-library-relink' ? 'relink' : 'no',
        }));
      }
    })();
    return () => {
      dead = true;
    };
  }, [openDs, openHead, openRow?.head, openAccess]);

  const pickDs = useCallback((want) => {
    const all = live.current.rows;
    const own = ownSystemOf(live.current.activePath, live.current.cfg);
    const name =
      typeof want === 'string' && want ? want : all.some((r) => r.ds === own) ? own : null;
    if (name) return all.find((r) => r.ds === name) ?? null;
    return all.length === 1 ? all[0] : null;
  }, []);

  const startUpdate = useCallback(
    async (want) => {
      const row = pickDs(want);
      if (!row) return say('Open the linked design system to update it.');
      setBusy(true);
      const r = await loadLibraryReview(row.ds, f());
      setBusy(false);
      if (!r.ok) {
        if (r.code === 'ds-library-no-grant' || r.code === 'ds-library-relink')
          setAccess((a) => ({
            ...a,
            [row.ds]: r.code === 'ds-library-relink' ? 'relink' : 'no',
          }));
        return say(r.message, false);
      }
      setDialogError('');
      setDialog({ ds: row.ds, review: r.review });
    },
    [pickDs, f, say]
  );

  useEffect(
    () =>
      onDsLibraryRequest((req) => {
        if (req.kind === 'link') return setLinking(true);
        if (req.kind === 'update') return startUpdate(req.ds);
        if (req.kind === 'unlink') {
          const row = pickDs(req.ds);
          if (!row) return say('Open the linked design system to unlink it.');
          setUnlinking({ ds: row.ds, label: row.label, error: '' });
        }
      }),
    [startUpdate, pickDs, say]
  );

  // the card, in the inspector's empty place
  useEffect(() => {
    if (!openRow) {
      setLibrary(null);
      setLibraryActions(null);
      return;
    }
    const model = cardModel({
      row: openRow,
      check: { usedBy: used[openRow.ds] ?? null },
      review: counts[openRow.ds]?.head === openHead ? counts[openRow.ds].review : null,
      access: access[openRow.ds] ?? 'unknown',
      error: errors[openRow.ds] ?? null,
    });
    setLibrary({ model, busy, note: null });
    setLibraryActions({
      update: () => startUpdate(openRow.ds),
      unlink: () => setUnlinking({ ds: openRow.ds, label: openRow.label, error: '' }),
      // gate-b-sec2: the person pastes the library's link again; the dialog names what it points at
      relink: () => setRelinking({ ds: openRow.ds, library: openRow.library ?? null }),
    });
  }, [openRow, used, counts, access, errors, busy, openHead, startUpdate, f, say, refresh]);
  useEffect(
    () => () => {
      setLibrary(null);
      setLibraryActions(null);
    },
    []
  );

  const banner = openRow ? bannerModel(openRow) : null;
  const hub = openRow?.library?.hub ?? '';
  const refreshSoon = () => refresh();

  return (
    <>
      <DsLibraryBanner
        banner={banner}
        canOpen={!!hub && canOpen(hub)}
        onOpen={async () => {
          const r = await open(hub);
          if (r && r !== 'ok') say(LIBRARY_WORDS.failed, false);
        }}
      />
      {dialog && !sheet ? (
        <DsLibraryDialog
          title={dialogTitle(
            rows.find((r) => r.ds === dialog.ds)?.label ?? dialog.ds,
            changeCount(dialog.review)
          )}
          lines={changeLines(dialog.review)}
          fine={`${byWhen(dialog.review.by, dialog.review.at ? agoWords(dialog.review.at) : null)} ${LIBRARY_WORDS.fine}`.trim()}
          error={dialogError}
          onClose={() => setDialog(null)}
          onUpdate={() => {
            setSheet(dialog);
            setDialog(null);
          }}
        />
      ) : null}
      {sheet ? (
        <DsReviewSheet
          key={`${sheet.ds}:${sheet.review.upstream}`}
          review={{
            system: sheet.ds,
            expectHead: sheet.review.expectHead ?? null,
            changes: Array.isArray(sheet.review.changes) ? sheet.review.changes : [],
            canvases: Array.isArray(sheet.review.canvases) ? sheet.review.canvases : [],
          }}
          components={sheet.review.components ? ['Components'] : []}
          places={{}}
          scope={scope}
          onClose={() => setSheet(null)}
          onUpdate={async (rowsTicked) => {
            const r = await takeLibraryUpdate(
              { ds: sheet.ds, review: sheet.review },
              rowsTicked,
              f()
            );
            if (!r.ok) {
              // the library or this system moved while the review was open: say so, and read it again
              if (r.code === 'ds-head-moved' || r.code === 'ds-library-moved') refreshSoon();
              return r;
            }
            const label = rows.find((x) => x.ds === sheet.ds)?.label ?? sheet.ds;
            say(updatedWords(label, r.updated, r.leftOut));
            setSheet(null);
            setCounts((c) => ({ ...c, [sheet.ds]: undefined }));
            refreshSoon();
            return { ok: true };
          }}
          onCancel={async () => {
            setSheet(null);
            return { ok: true };
          }}
        />
      ) : null}
      {unlinking ? (
        <DsLibraryUnlink
          label={unlinking.label}
          error={unlinking.error}
          onClose={() => setUnlinking(null)}
          onUnlink={async () => {
            const r = await unlinkLibrary(unlinking.ds, f());
            if (!r.ok) return setUnlinking((u) => (u ? { ...u, error: r.message } : u));
            say(`${unlinking.label} is your own system now.`);
            setUnlinking(null);
            refreshSoon();
          }}
        />
      ) : null}
      {relinking ? (
        <DsLibraryLink
          relink={{ title: LIBRARY_WORDS.relinkTitle, lead: relinkLead(relinking.library) }}
          onClose={() => setRelinking(null)}
          onLink={async (url, grant) => {
            const r = await relinkLibrary(relinking.ds, f(), { url, grant });
            if (!r.ok) return r;
            setAccess((a) => ({ ...a, [relinking.ds]: 'unknown' }));
            setRelinking(null);
            refreshSoon();
            return { ok: true };
          }}
        />
      ) : null}
      {linking ? (
        <DsLibraryLink
          onClose={() => setLinking(false)}
          onLink={async (url, grant) => {
            const r = await linkLibrary(url, grant, f());
            if (!r.ok) return r;
            say('Linked. Its updates arrive here as a review.');
            setLinking(false);
            refreshSoon();
            return { ok: true };
          }}
        />
      ) : null}
    </>
  );
}
