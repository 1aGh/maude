// client/v2/ds/library-model.js — S10.18c: the words and the arithmetic of a linked team library (13 · ds-many-library,
// ds-many-linked; V2-1.6 §5.14). Pure: no React, no fetch. The card, the dialog and the banner draw it; the host
// (library-host.jsx) fetches it.
//
// Everything that came from the hub or from the head.json (names, labels, the host, a summary) is display data:
// bounded, shown as text, never obeyed (DDR-172 D8). A name that looks like an e-mail address is never shown — the
// peer that linked a library may be named by an address, and the card is read by the whole team.

import { themeValue } from './review-model.js';

export const LIBRARY_CHECK_MS = 30 * 60 * 1000; // "on project open and every 30 min" — the server bounds it too

export const LIBRARY_WORDS = Object.freeze({
  cardKind: 'Team library',
  barViewOnly: 'Linked library — view only',
  bannerSub: 'View only here — every update arrives as a review.',
  upToDate: 'Up to date',
  cancel: 'Cancel',
  update: 'Update',
  unlink: 'Unlink',
  link: 'Link',
  linkTitle: 'Link a team library',
  linkLead: 'Paste the library link. This project gets its updates as a review — never silently.',
  linkUrl: 'Library link',
  linkGrant: 'Access key',
  linkGrantHint: 'Only if the link came with one',
  fine: 'The next step lists every canvas here with a tick. Updating keeps a version — Version history can restore it.',
  unlinkFine:
    'The system stays here as your own — you can edit it. It stops getting updates from the library.',
  reading: 'Reading the library…',
  offline: 'The library’s hub does not answer right now. It will be asked again.',
  denied: 'This library link no longer opens — ask its owner to share it again.',
  invalid: 'The library sent something that does not check out. Nothing was changed.',
  headMoved: 'The design system changed while this was open. Open it again to see the new list.',
  upToDateNow: 'Nothing new in the library.',
  forbidden: 'Not changed. You can look here; ask to edit.',
  failed: 'Not changed. Nothing was written; try again.',
  notFound: 'The library is not there any more.',
  unsupported: 'That hub does not share libraries yet.',
  badLink: 'That is not a library link.',
  needKey: 'The library link needs its access key.',
  // gate-b-sec1 (A3): head.json syncs, so its library record may be a peer's — this Mac sends nothing until the
  // person links it again, knowingly (the card names the hub's host)
  linkAgain: 'Link again',
  relink: 'This Mac hasn’t linked this library yet. Link it again from its card.',
  notOnMac: 'Team libraries are linked from the Maude app on a Mac.',
});

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "Used by 3 projects" — only when the hub said so (it tells members, not link holders). */
export const usedByLine = (n) =>
  Number.isSafeInteger(n) && n >= 1 ? `Used by ${plural(n, 'project', 'projects')}` : null;

/** "3 updates waiting" / "Up to date". */
export const waitingLine = (n) =>
  n > 0 ? `${plural(n, 'update', 'updates')} waiting` : LIBRARY_WORDS.upToDate;

/** The hub's host ("alligators.cloud.maude.sh") — what the library's home is called when the page knows no more. */
export function hostOf(hub) {
  try {
    const u = new URL(String(hub));
    return /^https?:$/.test(u.protocol) ? u.host.slice(0, 120) : '';
  } catch {
    return '';
  }
}

/** "Team library · alligators.cloud.maude.sh" */
export const cardKind = (lib) => {
  const host = hostOf(lib?.hub);
  return host ? `${LIBRARY_WORDS.cardKind} · ${host}` : LIBRARY_WORDS.cardKind;
};

const looksLikeAddress = (s) => /@|\bmailto:/i.test(s);

/** A person's name from a `by`, or null — never an e-mail address, never control characters. */
export function whoName(by) {
  if (!by || typeof by !== 'object') return null;
  if (by.kind === 'ai' || by.kind === 'agent') return by.name ? plainName(by.name) : 'AI';
  return plainName(by.name);
}
function plainName(v) {
  if (typeof v !== 'string') return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim();
  return s && !looksLikeAddress(s) ? s.slice(0, 64) : null;
}

/** The lead's default: a peer without this Mac's grant can look but not check or update. */
export function noGrantLine(linkedBy) {
  const who = whoName(linkedBy);
  return who
    ? `Only ${who} can update this library from their Mac.`
    : 'Only the person who linked it can update this library from their Mac.';
}

/**
 * "Link again" (A3): this Mac holds a credential for the record's hub but did not make this link — the record may
 * be a peer's edit. The line names the hub's host, so the choice is made knowingly.
 */
export function relinkLine(hub) {
  const host = hostOf(hub);
  return host
    ? `This Mac hasn’t linked this library from ${host}. Link it again only if you trust ${host}.`
    : LIBRARY_WORDS.relink;
}

/** A library error code → the person's words. */
export function refusalWords(code, fallback = LIBRARY_WORDS.failed) {
  switch (code) {
    case 'forbidden':
      return LIBRARY_WORDS.forbidden;
    case 'ds-library-unreachable':
    case 'unreachable':
      return LIBRARY_WORDS.offline;
    case 'ds-library-denied':
      return LIBRARY_WORDS.denied;
    case 'ds-library-invalid':
    case 'ds-library-too-large':
      return LIBRARY_WORDS.invalid;
    case 'ds-head-moved':
    case 'ds-library-moved':
      return LIBRARY_WORDS.headMoved;
    case 'ds-library-up-to-date':
      return LIBRARY_WORDS.upToDateNow;
    case 'ds-library-not-found':
      return LIBRARY_WORDS.notFound;
    case 'ds-library-unsupported':
      return LIBRARY_WORDS.unsupported;
    case 'ds-library-url':
      return LIBRARY_WORDS.badLink;
    case 'ds-library-no-grant':
      return LIBRARY_WORDS.needKey;
    case 'ds-library-relink':
      return LIBRARY_WORDS.relink;
    case 'not-on-mac':
      return LIBRARY_WORDS.notOnMac;
    case 'ds-outside-unreviewed':
      return 'Changes made outside the app wait for a review first. Keep or Undo them, then update.';
    case 'ds-exists':
      return 'A design system with that name is already here.';
    default:
      return fallback;
  }
}

/** The linked systems of a `GET /_api/ds/state` answer: `[{ ds, label, head, library }]`. */
export function linkedRows(state) {
  const out = [];
  for (const r of Array.isArray(state?.systems) ? state.systems : []) {
    const lib = r?.library;
    if (!lib || typeof lib !== 'object' || typeof r.name !== 'string') continue;
    out.push({
      ds: r.name,
      label: typeof r.label === 'string' && r.label ? r.label.slice(0, 120) : r.name,
      head: typeof r.head === 'string' ? r.head : null,
      library: {
        hub: typeof lib.hub === 'string' ? lib.hub : '',
        project: typeof lib.project === 'string' ? lib.project : '',
        label: typeof lib.label === 'string' && lib.label ? lib.label.slice(0, 120) : r.name,
        linkedBy: lib.linkedBy && typeof lib.linkedBy === 'object' ? lib.linkedBy : null,
        upstreamHead: typeof lib.upstreamHead === 'string' ? lib.upstreamHead : null,
        checkedAt: typeof lib.checkedAt === 'string' ? lib.checkedAt : null,
      },
    });
  }
  return out;
}

/** Updates waiting = the hub's head is not the one here. */
export const isWaiting = (row) =>
  !!row?.library?.upstreamHead && row.library.upstreamHead !== row.head;

/** How many changes a review lists: tokens, and the components as one more when they moved. */
export const changeCount = (review) =>
  (Array.isArray(review?.changes) ? review.changes.length : 0) + (review?.components ? 1 : 0);

/** "Update from Alligators? 3 changes" */
export const dialogTitle = (label, n) => `Update from ${label}? ${plural(n, 'change', 'changes')}`;

const valueText = (theme) => {
  const v = themeValue(theme);
  return typeof v === 'string' && v.length <= 60 ? v : null;
};

/** One line per change: `{ key, name, text, colour }` — names and values are text, never markup. */
export function changeLines(review) {
  const lines = [];
  for (const c of Array.isArray(review?.changes) ? review.changes : []) {
    if (!c || typeof c.css !== 'string') continue;
    const name = typeof c.label === 'string' && c.label ? c.label.slice(0, 80) : c.css.slice(0, 80);
    const before = valueText(c.before);
    const after = valueText(c.after);
    const text = c.trashed
      ? 'moved to the trash'
      : before === null && after !== null
        ? `added · ${after}`
        : after === null
          ? 'removed'
          : `${before ?? '—'} → ${after}`;
    lines.push({ key: c.css, name, text });
  }
  if (review?.components)
    lines.push({ key: '__components__', name: 'Components', text: 'changed' });
  return lines;
}

/** "By Tereza, yesterday." — the fine print's first half; nothing when neither is known. */
export function byWhen(by, atWords) {
  const who = whoName(by);
  const parts = [who ? `By ${who}` : null, atWords].filter(Boolean);
  return parts.length ? `${parts.join(', ')}.` : '';
}

/**
 * What the card draws for one linked system.
 * `access`: 'unknown' (not asked yet) | 'yes' | 'no' (this Mac holds no grant for the library) | 'relink' (it
 * holds one for that hub, but this Mac did not make this link — A3: nothing is asked until "Link again").
 * @returns {{ ds, title, kind, label, usedBy, waiting, waitingN, line, noGrant, relink, relinkLine, error, canUpdate }}
 */
export function cardModel({ row, check = null, review = null, access = 'unknown', error = null }) {
  const waiting = isWaiting(row);
  const n = review ? changeCount(review) : null;
  const relink = access === 'relink';
  // a record this Mac did not link is not trusted for a count or an Update either
  const noGrant = access === 'no' || relink;
  return {
    ds: row.ds,
    label: row.label,
    kind: cardKind(row.library),
    usedBy: usedByLine(check?.usedBy ?? review?.usedBy ?? null),
    waiting,
    waitingN: n,
    line: waiting ? (n === null ? '1 update waiting' : waitingLine(n)) : waitingLine(0),
    noGrant,
    noGrantLine: access === 'no' ? noGrantLine(row.library?.linkedBy) : null,
    relink,
    relinkLine: relink ? relinkLine(row.library?.hub) : null,
    error: noGrant ? null : error,
    canUpdate: waiting && !noGrant,
  };
}

/** The banner on a linked system's canvas. */
export function bannerModel(row) {
  const host = hostOf(row?.library?.hub);
  const home = host || 'its library';
  return {
    ds: row?.ds,
    home,
    title: `Linked from ${home}.`,
    sub: LIBRARY_WORDS.bannerSub,
    action: `Open in ${home}`,
    host,
  };
}

/** The body for `POST /_api/ds/library` {action:'update'} — exactly what the review showed, plus the ticks. */
export function updateBody({ ds, review }, rows) {
  return {
    action: 'update',
    ds,
    expectHead: review.expectHead ?? null,
    upstream: review.upstream,
    canvases: rows.filter((r) => !r.locked).map((r) => ({ path: r.path, ticked: r.ticked })),
  };
}

/** The toast after an update. */
export const updatedWords = (label, updated, leftOut) =>
  `Updated from ${label}. ${plural(updated, 'canvas', 'canvases')} ${updated === 1 ? 'follows' : 'follow'} it${
    leftOut > 0 ? `; ${leftOut} left out keep${leftOut === 1 ? 's' : ''} the old look` : ''
  }.`;
