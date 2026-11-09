// client/v2/link-server/link-server-model.js — 2.1.1 T5: the one "Link your server" dialog (canvas 17,
// artboards 12–13) as pure functions. It replaced Settings' "Add a team server" (TeamProjects serverOnly)
// and Home's "Sign in to your own hub" (HubSheet).
//
//   empty ─type→ checking ─answer→ answers · no-answer · not-maude · bad-address
//   answers ─Sign in in your browser→ starting → waiting (the server's own page) → done
//
// The address is checked as it is typed, by THIS app's own server (a project tab's
// `/_api/hub-signin/check`, Home's `/_home/hub/test`) — one tokenless GET of the server's /health; the
// page never fetches the remote. The primary button wakes only once the server answered. An invite
// link fills an empty address and rides the sign-in once (the server checks it names the same server).
// Advanced: a sign-in key instead of the browser, and the folder on this Mac — each drawn only when the
// context's API can do it (`advancedParts`).
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
  inviteToggle: 'I have an invite link',
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
  choose: 'Choose…',
  waitTitle: 'Finish signing in in your browser',
  waitBody: (host) =>
    `${host} opened in your browser. Sign in there — this closes by itself when you’re done.`,
  reopen: 'Open the page again',
  cancel: 'Cancel',
  refused: 'Maude won’t open that address. Check the server address.',
  noBrowser: 'The browser didn’t open. Try again.',
  failed: 'The sign-in didn’t finish. Nothing was linked. Try again.',
};

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
    phase: 'form', // form · starting · waiting · done
    wait: null, // { id, signInUrl, host }
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
      return { ...s, folder: { ...s.folder, mode: a.mode === 'mine' ? 'mine' : 'kept' } };
    case 'folder-path':
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
    case 'failed':
      return { ...s, phase: 'form', wait: null, error: a.error || LINK_WORDS.failed };
    case 'cancelled':
      return { ...s, phase: 'form', wait: null, error: null };
    case 'done':
      return { ...s, phase: 'done', wait: null };
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
export function advancedParts(api) {
  const out = [];
  if (typeof api?.linkKey === 'function') out.push('Sign-in key');
  if (api?.folders) out.push('folder');
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
    return f?.ok ? { ok: true } : { ok: false, error: f?.error || LINK_WORDS.failed };
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
