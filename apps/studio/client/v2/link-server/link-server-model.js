// client/v2/link-server/link-server-model.js — 2.1.1 T5: the one "Link your server" dialog (canvas 17,
// artboards 12–13) as pure functions. It replaced Settings' "Add a team server" (TeamProjects serverOnly)
// and Home's "Sign in to your own hub" (HubSheet).
//
//   empty ─type→ checking ─answer→ answers · no-answer · not-maude · bad-address
//   answers ─Sign in in your browser→ starting → waiting (the server's own page) → done
//                                                        └→ confirm (the server already holds work) ─Sync this folder→ done
//
// The address is checked as it is typed, by THIS app's own server (a project tab's
// `/_api/hub-signin/check`, Home's `/_home/hub/test`) — one tokenless GET of the server's /health; the
// page never fetches the remote. The primary button wakes only once the server answered. An invite
// link fills an empty address and rides the sign-in once (the server checks it names the same server).
// Advanced: a sign-in key instead of the browser, and the folder on this Mac — each drawn only when the
// context's API can do it (`advancedParts`).
//
// In a project tab whose folder is the person's own (B5, `api.where` names it), the sign-in links THIS folder
// to the server (`POST /_api/hub/link-folder`): an empty server is seeded right away; a server that already
// holds work answers with counts, and the dialog asks before anything is linked (`confirmLines`, `runConfirm`).
//
// What a context CAN do is its injected API (link-server-api.js); `runLink` drives it. Nothing here
// keeps or logs a key or an invite: they are read once by `runLink` and never echoed into a line.

/** The words (canvas 17 F · Link your server; CONTRACT §3–§4). */
export const LINK_WORDS = {
  title: 'Link your server',
  addressLabel: 'Address',
  placeholder: 'design.example.com',
  hint: 'Ask whoever runs it for the address. It’s checked as you type.',
  checking: (host) => `Checking ${host}…`,
  answers: (host, version) => (version ? `${host} answers — Maude ${version}` : `${host} answers`),
  noAnswer: (host) =>
    `${host} didn’t answer. Check the address, or try again when this Mac is online.`,
  notMaude: (host) =>
    `${host} answers, but it isn’t a Maude server. Check the address with whoever runs it.`,
  badAddress: 'That doesn’t look like a server address. Type it like design.example.com.',
  signIn: 'Sign in in your browser',
  signInKey: 'Link with this key',
  inviteToggle: 'Use an invite link',
  inviteLabel: 'Invite link',
  invitePlaceholder: 'https://design.example.com/join/…',
  advanced: 'Advanced',
  keyLabel: 'Sign-in key',
  keyPlaceholder: 'Paste a key the server’s admin gave you',
  keyHint: 'Instead of the browser. It stays on this Mac.',
  folderLabel: 'Folder on this Mac',
  folderKept: 'Keep a copy for me',
  folderKeptNote: '— nothing to manage',
  folderMine: 'Use my folder…',
  folderThis: (path) => `This folder (${path})`,
  choose: 'Choose…',
  waitTitle: 'Finish signing in in your browser',
  waitBody: (host) =>
    `${host} opened in your browser. Sign in there — this closes by itself when you’re done.`,
  reopen: 'Open the page again',
  cancel: 'Cancel',
  refused: 'Maude won’t open that address. Check the server address.',
  noBrowser: 'The browser didn’t open. Try again.',
  failed: 'The sign-in didn’t finish. Nothing was linked. Try again.',
  leadOwnTab: 'Sign in to a Maude server your team runs. Its projects open in their own tab.',
  waitThis: (project) =>
    `${project} starts syncing right after. Nothing is sent before you sign in.`,
  waitOwnTab: 'Nothing is sent before you sign in. The project opens right after.',
  confirmTitle: (host) => `Sync this folder with ${host}?`,
  confirmLead: (host) =>
    `You’re signed in. ${host} already holds a project, so syncing puts its work and this folder’s together:`,
  confirmFine: 'Nothing is linked or sent until you press Sync this folder.',
  // 2.1.1 T8 — the first link to a server that holds nothing yet: what goes up, and where
  firstTitle: (host) => `Send this folder to ${host}?`,
  confirmButton: 'Sync this folder',
  linking: 'Linking…',
};

/** "1 canvas" · "3 files" · "1 canvas and 2 files" — a count with a noun that reads for one and many. */
function countOf(c, f) {
  const parts = [];
  if (c) parts.push(`${c} ${c === 1 ? 'canvas' : 'canvases'}`);
  if (f) parts.push(`${f} ${f === 1 ? 'file' : 'files'}`);
  return parts.join(' and ');
}

/**
 * The confirm step's lines (CONTRACT §4: what happens, in counts), from the server's answer
 * `{ canvases: {onlyHere, onlyThere, differ, same}, files: {…} }`. A zero line is left out.
 */
export function confirmLines(counts, host) {
  const c = counts?.canvases ?? {};
  const f = counts?.files ?? {};
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const lines = [];
  const up = countOf(n(c.onlyHere), n(f.onlyHere));
  if (up) lines.push({ id: 'here', text: `${up} only on this Mac — sent up to ${host}` });
  const down = countOf(n(c.onlyThere), n(f.onlyThere));
  if (down) lines.push({ id: 'there', text: `${down} only on ${host} — copied to this folder` });
  // S1 (2.1.1, measured against a real server): a canvas on both sides keeps this Mac's source
  // until the person picks a version (a held conflict), and the comments and sticky notes of both
  // sides are kept; a file on both sides takes the server's bytes and keeps this Mac's beside it.
  const both = countOf(n(c.differ), n(f.differ));
  if (both)
    lines.push({
      id: 'differ',
      text: `${both} on both, but different — ${differOutcome(n(c.differ), n(f.differ), host)}`,
    });
  const same = countOf(n(c.same), n(f.same));
  if (same) lines.push({ id: 'same', text: `${same} already the same on both — nothing changes` });
  return lines;
}

function differOutcome(canvases, files, host) {
  const canvasWords = 'this Mac keeps its version until you choose which to keep';
  const fileWords = `${host}’s version is used, and this Mac’s is kept beside it as a copy`;
  if (canvases && files) return `for a canvas, ${canvasWords}; for a file, ${fileWords}`;
  return canvases ? canvasWords : fileWords;
}

/**
 * 2.1.1 T8 — the first link to a server that holds nothing: one line saying what goes up and where
 * ("3 canvases and 12 files will go to design.example.com."), from the same counts.
 */
export function firstLead(counts, host) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const up = countOf(n(counts?.canvases?.onlyHere), n(counts?.files?.onlyHere));
  return up
    ? `${up} will go to ${host}.`
    : `This folder is empty. What you add here will go to ${host}.`;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** What the person typed → the address the server is asked about (a bare host is https). */
export function addressOf(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return SCHEME_RE.test(s) ? s : `https://${s}`;
}

/** `https://design.example.com` → `design.example.com` (display only). */
export function hostOf(url) {
  try {
    return new URL(String(url)).host || String(url ?? '');
  } catch {
    return String(url ?? '');
  }
}

/** `https://hub.example/join/inv_…` → `https://hub.example` (the server's own invite link); else null. */
export function hubOfInviteLink(raw) {
  try {
    const u = new URL(String(raw ?? '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const m = /^(.*)\/join\/[^/]+$/.exec(u.pathname);
    return m ? `${u.origin}${m[1]}` : null;
  } catch {
    return null;
  }
}

/** @param {string} [initialUrl] a known server's address (Sign in again) */
export function initialLink(initialUrl = '') {
  const url = String(initialUrl ?? '');
  return {
    url,
    check: {
      phase: url.trim() ? 'checking' : 'empty',
      seq: url.trim() ? 1 : 0,
      version: null,
      error: null,
    },
    invite: { open: false, value: '' },
    advanced: false,
    key: '',
    folder: { mode: 'kept', path: '' },
    phase: 'form', // form · starting · waiting · confirm · linking · done
    wait: null, // { id, signInUrl, host }
    confirm: null, // { url, host, counts, code } — the server already holds work (B5)
    error: null,
  };
}

const typed = (s, url) => {
  const seq = s.check.seq + 1;
  return {
    ...s,
    url,
    error: null,
    check: { phase: url.trim() ? 'checking' : 'empty', seq, version: null, error: null },
  };
};

const PHASE_OF_REASON = {
  unreachable: 'no-answer',
  'not-a-maude-workspace': 'not-maude',
  'bad-address': 'bad-address',
};

export function linkReducer(s, a) {
  switch (a?.type) {
    case 'type':
      return typed(s, String(a.url ?? ''));
    case 'check-done': {
      if (a.seq !== s.check.seq || s.check.phase !== 'checking') return s; // an older address's answer
      const r = a.answer || {};
      if (r.ok)
        return {
          ...s,
          check: { ...s.check, phase: 'answers', version: r.version ?? null, error: null },
        };
      const phase = PHASE_OF_REASON[r.reason] || 'no-answer';
      return {
        ...s,
        check: {
          ...s.check,
          phase,
          version: null,
          error: phase === 'bad-address' ? r.error || LINK_WORDS.badAddress : null,
        },
      };
    }
    case 'invite-open':
      return { ...s, invite: { ...s.invite, open: true } };
    case 'invite': {
      const value = String(a.value ?? '');
      const next = { ...s, invite: { open: true, value } };
      // the server's own link names its server: fill an EMPTY address (the address is not secret)
      const at = s.url.trim() ? null : hubOfInviteLink(value);
      return at ? typed(next, at) : next;
    }
    case 'advanced':
      return { ...s, advanced: !s.advanced };
    case 'key':
      return { ...s, key: String(a.value ?? '') };
    case 'folder':
      if (s.folder.mode === 'this') return s; // this project's own folder is not a choice
      return { ...s, folder: { ...s.folder, mode: a.mode === 'mine' ? 'mine' : 'kept' } };
    case 'here':
      // B5 — the project tab's own folder (`api.where`): linking means THIS folder; null = a copy Maude
      // keeps, or a project already linked — the dialog keeps its other behaviour
      return typeof a.folder === 'string' && a.folder
        ? { ...s, folder: { mode: 'this', path: a.folder } }
        : s;
    case 'folder-path':
      if (s.folder.mode === 'this') return s;
      return { ...s, folder: { mode: 'mine', path: String(a.path ?? '') } };
    case 'submit':
      // the invite and the key are read once (by `runLink`, from the state before this) and emptied now —
      // a secret never outlives the press in the page
      return { ...s, phase: 'starting', error: null, key: '', invite: { ...s.invite, value: '' } };
    case 'waiting':
      return {
        ...s,
        phase: 'waiting',
        wait: { id: a.id, signInUrl: a.signInUrl, host: a.host },
      };
    case 'needs-confirm': {
      const c = a.confirm || {};
      if (typeof c.code !== 'string' || !c.code)
        return { ...s, phase: 'form', wait: null, error: LINK_WORDS.failed };
      return {
        ...s,
        phase: 'confirm',
        wait: null,
        confirm: {
          url: c.url,
          host: c.host,
          counts: c.counts ?? null,
          code: c.code,
          empty: c.empty === true,
        },
      };
    }
    case 'confirming':
      return s.phase === 'confirm' ? { ...s, phase: 'linking' } : s;
    case 'failed':
      return {
        ...s,
        phase: 'form',
        wait: null,
        confirm: null,
        error: a.error || LINK_WORDS.failed,
      };
    case 'cancelled':
      return { ...s, phase: 'form', wait: null, confirm: null, error: null };
    case 'done':
      return { ...s, phase: 'done', wait: null, confirm: null };
    default:
      return s;
  }
}

/** The line under the address: a hint, the check, or why not. */
export function checkLine(s) {
  const host = hostOf(addressOf(s.url) ?? '');
  switch (s.check.phase) {
    case 'checking':
      return { tone: 'busy', text: LINK_WORDS.checking(host) };
    case 'answers':
      return { tone: 'ok', text: LINK_WORDS.answers(host, s.check.version) };
    case 'no-answer':
      return { tone: 'bad', text: LINK_WORDS.noAnswer(host) };
    case 'not-maude':
      return { tone: 'bad', text: LINK_WORDS.notMaude(host) };
    case 'bad-address':
      return { tone: 'bad', text: s.check.error || LINK_WORDS.badAddress };
    default:
      return { tone: 'hint', text: LINK_WORDS.hint };
  }
}

/** The primary button wakes only once the server answered (and a chosen folder is named). */
export function canSubmit(s) {
  if (s.phase !== 'form' || s.check.phase !== 'answers') return false;
  return s.folder.mode !== 'mine' || !!s.folder.path.trim();
}

/** Why the primary button sleeps, in words (a disabled control says why — p8-lock-reasons). */
export function whyNotSubmit(s) {
  if (s.phase !== 'form') return 'Finish or cancel this sign-in first.';
  switch (s.check.phase) {
    case 'empty':
      return 'Type the server’s address first.';
    case 'checking':
      return 'Waiting for the server to answer.';
    case 'answers':
      return s.folder.mode === 'mine' && !s.folder.path.trim() ? 'Choose a folder first.' : null;
    default:
      return 'Check the address first.';
  }
}

export function primaryLabel(s) {
  return s.key.trim() ? LINK_WORDS.signInKey : LINK_WORDS.signIn;
}

/** What Advanced holds in this context (its hint line); none = the fold is not drawn. */
export function advancedParts(api, s) {
  const out = [];
  if (typeof api?.linkKey === 'function') out.push('Sign-in key');
  if (api?.folders === true || s?.folder?.mode === 'this') out.push('folder');
  return out;
}

/** A `{ok, status, json}` answer → the shape `runLink` reads (`ok` only when both say so). */
export const answerOf = (r) =>
  r?.json && typeof r.json === 'object' ? { ...r.json, ok: !!(r.ok && r.json.ok) } : { ok: false };

/** The check's answer: ok + version, or the reason the dialog words. */
export const checkAnswerOf = (r) =>
  r?.ok && r.json?.ok
    ? { ok: true, version: typeof r.json.version === 'string' ? r.json.version : null }
    : {
        ok: false,
        reason: typeof r?.json?.reason === 'string' ? r.json.reason : 'unreachable',
        ...(typeof r?.json?.error === 'string' ? { error: r.json.error } : {}),
      };

export const LINK_POLL_MS = 1500;

/**
 * Run the link the dialog's state describes, through the context's API:
 *   key   → api.linkKey(url, key) → api.finish(url, folder)
 *   else  → api.signInStart(url, invite?) → api.openSignIn(page) → onWaiting → poll → api.finish(url, folder)
 * Resolves `{ ok: true }` · `{ ok: false, error }` · `{ ok: false, cancelled: true }`.
 */
export async function runLink(
  s,
  api,
  { onWaiting = () => {}, isCancelled = () => false, sleep, pollMs = LINK_POLL_MS } = {}
) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const url = addressOf(s.url);
  if (!url) return { ok: false, error: LINK_WORDS.badAddress };
  const folder = { mode: s.folder.mode, path: s.folder.mode === 'mine' ? s.folder.path : '' };
  const key = s.key.trim();
  const finish = async (at) => {
    const f = await api.finish(at, folder);
    if (f?.ok) return { ok: true };
    // B5 — the server already holds work: nothing was linked; the dialog asks first
    if (f?.needsConfirm) return { ok: false, needsConfirm: { url: at, ...f.needsConfirm } };
    return { ok: false, error: f?.error || LINK_WORDS.failed };
  };
  if (key && typeof api.linkKey === 'function') {
    const k = await api.linkKey(url, key);
    if (!k?.ok) return { ok: false, error: k?.error || LINK_WORDS.failed };
    return finish(url);
  }
  const invite = s.invite.value.trim();
  const st = await api.signInStart(url, invite || undefined);
  if (!st?.ok || !st.id || !st.signInUrl)
    return { ok: false, error: st?.error || LINK_WORDS.failed };
  const opened = await api.openSignIn(st.signInUrl);
  if (opened !== 'ok') {
    await api.signInCancel(st.id);
    return { ok: false, error: opened === 'refused' ? LINK_WORDS.refused : LINK_WORDS.noBrowser };
  }
  onWaiting({ id: st.id, signInUrl: st.signInUrl, host: hostOf(url) });
  for (;;) {
    if (isCancelled()) return { ok: false, cancelled: true };
    const p = await api.signInPoll(st.id);
    if (isCancelled()) return { ok: false, cancelled: true };
    if (p?.ok && p.pending) {
      await wait(pollMs);
      continue;
    }
    if (p?.ok && p.url) return finish(p.url);
    return { ok: false, error: p?.error || LINK_WORDS.failed };
  }
}

/**
 * B5 — the person said yes to syncing this folder with a server that already holds work: the one-time
 * code the server's answer carried goes back once. Resolves `{ ok: true }` · `{ ok: false, error }`.
 */
export async function runConfirm(s, api) {
  const c = s.confirm;
  if (!c?.code || typeof api?.confirmLink !== 'function')
    return { ok: false, error: LINK_WORDS.failed };
  const r = await api.confirmLink(c.url, c.code);
  return r?.ok ? { ok: true } : { ok: false, error: r?.error || LINK_WORDS.failed };
}
