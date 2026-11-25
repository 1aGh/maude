// Team server admin — vanilla JS, no framework, strict CSP (no inline script
// or style: every look is a class, every handler is wired here). The markup and
// the stylesheet reproduce the design canvas "16 Team Server and Cloud Admin"
// (artboards ts-overview, ts-people, ts-person, ts-activity, ts-settings,
// un-member-ts); this file fills them with what the server really has.
//
// WHO IS LOOKING decides the page:
//   ?key=<bootstrap>          → "bootstrap" (one-time claim)
//   an admin                  → "dash" — signed in with an Admin account (the
//                               ordinary way), or holding the admin key
//   a signed-in member        → "member" — their own access, nothing else
//   nobody                    → "onboard" — Sign in, or (Advanced) the admin key
//
// TWO CREDENTIALS, never mixed up. The browser SESSION is a cookie the hub set
// at sign-in (this script never sees it). The admin KEY lives in localStorage
// and rides as a Bearer. The rules between them:
//   • a signed-in Admin session is PREFERRED over a stored key — the key is
//     then used only for what needs it (Settings › Advanced) — unless the
//     person chose the key in THIS tab (sessionStorage);
//   • a stored key the server rejects is forgotten AT ONCE, the page falls
//     back to the session (or to the sign-in card), and one quiet line says so;
//   • no page is ever left empty: a request that fails or does not answer says
//     what happened, with Retry.

const LS_KEY = 'maude-hub-secret';
/** "I chose the admin key in this tab" — per tab, so it does not outlive it. */
const SS_KEY_MODE = 'maude-hub-key-mode';
const KEY_REMOVED = 'The saved admin key no longer works — it was removed.';
/** A request that has not answered by now is a failure the person can retry, not a blank page. */
const REQUEST_TIMEOUT_MS = 20_000;

const $ = (id) => document.getElementById(id);
const all = (sel, root = document) => [...root.querySelectorAll(sel)];

// The API base follows where THIS page is served, so the admin works at the
// root (/admin) and behind a path-stripping reverse proxy.
const API_BASE = `${location.pathname.replace(/\/+$/, '')}/api`;

const store = (area) => {
  try {
    return window[area];
  } catch {
    return null;
  }
};

const state = {
  secret: store('localStorage')?.getItem(LS_KEY) || '',
  /** Send the key on EVERY request (key mode) — else only on the key-only ones. */
  useKey: false,
  bootstrapKey: new URLSearchParams(location.search).get('key') || '',
  hubIdentity: null,
  me: null,
  view: 'overview',
  people: null,
  overview: null,
  status: null,
  peopleFilter: 'all',
  act: { kind: '', q: '', more: null, rows: [], paged: false },
  platform: false,
  note: '',
};

// DDR-053 §7: strip ?key= at once so it never sits in history or the bar.
if (state.bootstrapKey) history.replaceState({}, '', location.pathname);

function showOnly(id) {
  for (const s of all('main > section')) s.hidden = s.id !== id;
}

function forgetKey() {
  state.secret = '';
  state.useKey = false;
  store('localStorage')?.removeItem(LS_KEY);
  store('sessionStorage')?.removeItem(SS_KEY_MODE);
}

/**
 * One request. `key`: 'never' (the session alone), 'always' (a key-only route),
 * or by default the key only in key mode. Throws an Error whose `.status` is
 * the HTTP status (0 = no answer).
 */
async function request(path, { key, ...opts } = {}) {
  const headers = new Headers(opts.headers || {});
  const withKey = Boolean(state.secret) && key !== 'never' && (key === 'always' || state.useKey);
  if (withKey) headers.set('Authorization', `Bearer ${state.secret}`);
  if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const e = new Error(
      err?.name === 'TimeoutError'
        ? 'The team server did not answer in time.'
        : 'The team server could not be reached.'
    );
    e.status = 0;
    throw e;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      message = JSON.parse(text)?.error ?? text;
    } catch {
      /* not JSON */
    }
    const e = new Error(message || `HTTP ${res.status}`);
    e.status = res.status;
    e.withKey = withKey;
    throw e;
  }
  return res;
}

async function api(path, opts = {}) {
  try {
    const res = await request(path, opts);
    if (opts.raw) return res;
    return res.status === 204 ? null : await res.json();
  } catch (err) {
    if (err.status === 401) {
      // A key the server rejects is forgotten at once; a session that ended
      // means signing in again. Either way: find out who is looking now.
      if (err.withKey) {
        forgetKey();
        state.note = KEY_REMOVED;
      }
      void boot();
      const e = new Error('Unauthorized');
      e.status = 401;
      throw e;
    }
    throw err;
  }
}
const post = (path, body = {}, opts = {}) =>
  api(path, { method: 'POST', body: JSON.stringify(body), ...opts });
const hasKey = () => Boolean(state.secret);

// ------------------------------------------------------------ formatters

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** A timestamp in the FUTURE — an expiry is time REMAINING, never an age. */
function formatUntil(ts) {
  if (!ts) return '—';
  const left = ts - Date.now();
  if (left <= 0) return 'expired';
  if (left < 3_600_000) return plural(Math.max(1, Math.floor(left / 60_000)), 'more minute');
  if (left < 86_400_000) return plural(Math.floor(left / 3_600_000), 'more hour');
  return plural(Math.floor(left / 86_400_000), 'more day');
}

const clock = (d) =>
  d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const dayMonth = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const sameDay = (a, b) => a.toDateString() === b.toDateString();

/** "12 min ago" · "Today, 03:00" · "Yesterday, 17:40" · "28 Oct" — the canvas's wording. */
function formatTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  return formatWhen(ts);
}
function formatWhen(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  if (sameDay(d, now)) return `Today, ${clock(d)}`;
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return `Yesterday, ${clock(d)}`;
  return `${dayMonth(d)}, ${clock(d)}`;
}
/** The feed's short stamp: "2 min" · "1 h" · "03:00" · "Yesterday" · "12 Sep". */
function formatShort(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const d = new Date(ts);
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 6 * 3_600_000) return `${Math.floor(diff / 3_600_000)} h`;
  if (sameDay(d, new Date())) return clock(d);
  if (sameDay(d, new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return dayMonth(d);
}

function formatBytes(n) {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A count with its noun: `1 event`, `2 events`, `1 canvas`, `3 canvases`. Every count on the page goes through here. */
function plural(n, one, many = `${one}s`) {
  return `${n} ${Number(n) === 1 ? one : many}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
const esc = escapeHtml;

// ------------------------------------------------------------ pieces (the kit's)

const ic = (name, size = 14) =>
  `<svg class="k-ic k-ic--${size}" viewBox="0 0 16 16" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** The avatar's colour, from the name — a class, never an inline style (the CSP drops those). */
function tone(name) {
  const n = String(name || '?');
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return h % 5;
}
const avatar = (name, lg = false) =>
  `<span class="k-av k-av--${tone(name)}${lg ? ' k-av--lg' : ''}" aria-hidden="true">${esc(String(name || '?')[0])}</span>`;
const serverIcon = () => `<span class="ma-ev-ic">${ic('server', 13)}</span>`;
/** Who did it: a person's initial, or a glyph for the server and for the admin key (not a person). */
const actorMark = (actor) =>
  actor === 'Admin key' ? `<span class="ma-ev-ic">${ic('lock', 13)}</span>` : avatar(actor);
const who = (title, sub, lg = true) =>
  `<span class="ma-who">${avatar(title, lg)}<span class="ma-who-t"><strong>${esc(title)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</span></span>`;
/** Status is always a word with a dot. */
const sw = (kind, word) => `<span class="k-sw k-sw--${kind}"><i></i>${esc(word)}</span>`;
const btn = (label, attrs, cls = '') =>
  `<button type="button" class="btn btn--sm ${cls}" ${attrs}>${esc(label)}</button>`;
/** What to call a person when all there is is an address: the address. Its first name for a greeting. */
const firstName = (email) => {
  const local = String(email || '')
    .split('@')[0]
    .split(/[._+-]/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : '';
};

async function copyText(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    if (el) {
      const was = el.innerHTML;
      el.textContent = 'Copied';
      setTimeout(() => {
        el.innerHTML = was;
      }, 1500);
    }
    return true;
  } catch {
    return false;
  }
}

// ---- the quiet line: something changed, or a page could not be loaded (with Retry)

let retryAction = null;
function showNote(text, { bad = false, retry = null } = {}) {
  $('page-note-text').textContent = text;
  $('page-note').classList.toggle('ma-note--bad', bad);
  $('page-note-retry').hidden = !retry;
  retryAction = retry;
  $('page-note').hidden = false;
}
function clearNote() {
  $('page-note').hidden = true;
  retryAction = null;
}
/** A view never stays empty: what failed is said, and can be tried again. */
function pageFailed(what, err, retry) {
  if (err?.status === 401) return;
  showNote(`${what} could not be loaded. ${err?.message ?? ''}`.trim(), { bad: true, retry });
}

// -------------------------------- who is looking ---------------------------

async function me(key) {
  try {
    return await (await request('/me', { key })).json();
  } catch (err) {
    return { error: err };
  }
}

let booting = null;
function boot() {
  if (!booting) {
    booting = bootOnce().finally(() => {
      booting = null;
    });
  }
  return booting;
}

async function bootOnce() {
  if (state.bootstrapKey && !state.secret) {
    showOnly('bootstrap');
    void loadIdentityForBootstrapView();
    return;
  }
  const choseKey = store('sessionStorage')?.getItem(SS_KEY_MODE) === '1';
  // 1. The session first — it is what a person signed in with.
  const session = await me('never');
  // 2. The stored key, when there is one: is it still good?
  let keyed = null;
  if (state.secret) {
    keyed = await me('always');
    if (keyed.error?.status === 401) {
      forgetKey();
      state.note = KEY_REMOVED;
      keyed = null;
    }
  }
  // 3. Which of them is this page? A signed-in admin, unless the key was chosen in this tab.
  const sessionAdmin = session.admin === true;
  state.useKey = Boolean(keyed?.admin) && (choseKey || !sessionAdmin);
  const who_ = state.useKey ? keyed : session;

  if (who_.error) {
    // No answer at all (or a cell, which answers only the key): the sign-in card, saying why.
    showOnboard({ selfService: who_.error.status !== 401, hub: null }, who_.error);
    return;
  }
  state.me = who_;
  for (const el of all('[data-hub-name]')) el.textContent = who_.hub?.name || 'Team server';
  document.title = `${who_.hub?.name || 'Team server'} · Admin`;
  if (who_.admin) return showDash();
  if (who_.signedIn) return showMember(who_);
  showOnboard(who_, null);
}

function showOnboard(info, err) {
  const cell = info.selfService === false;
  $('onboard-signin').hidden = cell;
  $('onboard-lede').textContent = cell
    ? 'This project takes its people from its dashboard. The admin key opens this page.'
    : 'Sign in with your account on this team server. Admins manage people and settings here; everyone else sees their own access.';
  if (cell) all('#onboard details')[0].open = true;
  const note = $('onboard-note');
  const text =
    state.note || (err && err.status !== 401 ? `${err.message} Reload the page to try again.` : '');
  note.textContent = text;
  note.hidden = !text;
  state.note = '';
  showOnly('onboard');
}

function showDash() {
  const m = state.me;
  showOnly('dash');
  const name = m.via === 'key' ? 'Admin key' : `${firstName(m.email) || m.email} · ${m.roleLabel}`;
  $('me-chip').textContent = name;
  $('me-chip').title = m.email ?? '';
  $('me-chip').parentElement.setAttribute('aria-label', `${name} — menu`);
  $('me-av').textContent = (m.email || 'A')[0];
  $('me-av').className = `k-av k-av--${tone(m.email || 'admin')}`;
  $('signout').hidden = m.via !== 'session';
  $('forget').hidden = !hasKey();
  $('me-menu-note').textContent =
    m.via === 'key'
      ? 'You are using the admin key.'
      : hasKey()
        ? `${m.email} · the admin key is saved for Advanced.`
        : (m.email ?? '');
  for (const f of all('[data-link-menu]')) f.hidden = !m.canLink;
  renderLinkCards(m);
  if (state.note) {
    showNote(state.note);
    state.note = '';
  }
  setView(state.view);
  void refresh();
  void loadSettings();
}

/** "Link my sign-in" — offered when there is a provider and this account has none linked. */
function renderLinkCards(m) {
  for (const card of all('[data-link-card]')) {
    card.hidden = !m.canLink;
    if (!m.canLink) continue;
    card.querySelector('[data-link-text]').textContent =
      `Your account signs in with a password. Link it to ${m.provider} — use the same address. From then on you sign in there: the password stops working and your other sessions end.`;
    card.querySelector('[data-link-btn]').textContent = `Link my sign-in · ${m.provider}`;
  }
}

function showMember(m) {
  showOnly('member');
  const name = firstName(m.email);
  $('member-me').textContent = `${name || m.email} · ${m.roleLabel}`;
  $('member-av').textContent = (m.email || '?')[0];
  $('member-av').className = `k-av k-av--${tone(m.email)}`;
  $('member-hello').textContent = `Hi ${name}.`;
  const hub = m.hub?.name || 'this team server';
  const runs = m.runBy?.length
    ? ` · ${m.runBy.join(' and ')} ${m.runBy.length === 1 ? 'runs' : 'run'} it`
    : '';
  $('member-sub').textContent = m.access?.everything
    ? `You can edit everything on ${hub}${runs}`
    : `You can edit ${plural(m.access?.canvases?.length ?? 0, 'canvas', 'canvases')} on ${hub}${runs}`;
  const row = (icon, strong, sub, action = '') =>
    `<div class="ma-need ma-need--flat">${ic(icon, 16)}<span class="ma-need-t"><strong>${esc(strong)}</strong><span>${esc(sub)}</span></span>${action ? `<span class="ma-need-a">${action}</span>` : ''}</div>`;
  $('member-access').innerHTML = m.access?.everything
    ? `<div class="ma-ev"><span class="ma-ev-ic">${ic('folder', 13)}</span><span class="ma-ev-t"><strong>All projects</strong> <span>· now and new ones</span></span>${sw('ok', 'Can edit')}</div>`
    : (m.access?.canvases ?? [])
        .map(
          (c) =>
            `<div class="ma-ev"><span class="ma-ev-ic">${ic('folder', 13)}</span><span class="ma-ev-t"><strong>${esc(c)}</strong></span>${sw('ok', 'Can edit')}</div>`
        )
        .join('') || '<p class="ma-empty">Nothing yet.</p>';
  $('member-sessions').innerHTML =
    (m.sessions ?? [])
      .map((s) =>
        row(
          'laptop',
          s.kind === 'browser' ? 'A browser' : 'The Maude app',
          `${s.current ? 'This one · ' : ''}${formatTime(s.lastUsedAt ?? s.createdAt).toLowerCase()}`
        )
      )
      .join('') || '<p class="ma-empty">Nowhere else.</p>';
  $('member-admins').innerHTML = m.runBy?.length
    ? row('people', m.runBy.join(', '), 'Ask them for access or to invite someone.')
    : row(
        'people',
        `${plural(m.admins, 'admin runs', 'admins run')} it`,
        'Ask whoever invited you.'
      );
  const dom = m.domains?.length ? `@${m.domains.join(', @')}` : '';
  const rule =
    m.whoCanJoin === 'domain' && dom
      ? `Anyone ${dom} can sign in and comes straight in`
      : m.whoCanJoin === 'ask' && m.provider
        ? `Anyone ${dom || 'who can sign in'} can sign in and ask`
        : 'An admin has to invite them';
  $('member-join').innerHTML = row(
    'people',
    rule,
    'Only admins send invites.',
    btn('Copy the address', 'data-copy-address="1"')
  );
  $('member-join')
    .querySelector('[data-copy-address]')
    ?.addEventListener('click', (e) =>
      copyText(location.origin + location.pathname.replace(/\/admin\/?$/, '/'), e.currentTarget)
    );
  renderLinkCards(m);
}

// DDR-053 §7: show the hub's identity on the claim screen (phishing defence).
async function loadIdentityForBootstrapView() {
  if (state.hubIdentity) return;
  try {
    const res = await fetch(`${API_BASE}/identity`);
    if (!res.ok) return;
    const id = await res.json();
    state.hubIdentity = id;
    const row = (k, v) =>
      `<div class="fp-row"><span class="fp-k">${k}</span><span class="fp-v">${esc(v)}</span></div>`;
    $('bootstrap-identity').innerHTML =
      row('Claiming', id.publicUrl) +
      row('Fingerprint', id.hostFingerprint) +
      (id.version ? row('Version', id.version) : '');
  } catch {
    /* informational */
  }
}

// -------------------------------- refresh ----------------------------------

/**
 * Load everything the open page shows. Each part is loaded and drawn on its
 * own, so one that fails says so (with Retry) and does not blank the others —
 * and a part that throws while DRAWING is reported the same way, never left as
 * an empty page.
 */
async function refresh() {
  if (!state.me?.admin) return;
  const part = async (what, load, draw) => {
    try {
      draw(await load());
      return true;
    } catch (err) {
      console.warn(`[hub-admin] ${what}:`, err);
      pageFailed(what, err, () => {
        clearNote();
        void refresh();
      });
      return false;
    }
  };
  const ok = await Promise.all([
    part(
      'The overview',
      () => api('/overview'),
      (o) => {
        state.overview = o;
        renderOverview(o);
        renderSettingsCards();
      }
    ),
    part(
      'The server status',
      () => api('/status'),
      (s) => {
        state.status = s;
        applyPlatformPosture(s);
        renderStatus(s);
        renderSettingsCards();
      }
    ),
    part('The canvases', () => api('/canvases'), renderCanvases),
  ]);
  if (!state.platform) {
    ok.push(
      await part(
        'The people',
        () => api('/people'),
        (d) => {
          state.people = d;
          renderPeople();
        }
      )
    );
  }
  if (state.view === 'activity' && !state.act.paged) {
    ok.push(await part('The activity', () => fetchActivity(false), drawActivity));
  }
  if ($('advanced').open) await loadAdvanced();
  // A page that loads again after a failure takes its error line away.
  if (ok.every(Boolean) && retryAction) clearNote();
}

/**
 * Under CLOUD identity the dashboard owns people — hide People and Invite.
 *
 * TWO DIFFERENT FLAGS ARE SPELLED `strict` and mean opposite things here:
 *   identity.mode === 'strict'  → cloud identity; membership is the control
 *                                 plane's, so People is HIDDEN.
 *   HUB_OIDC_MODE=strict        → a self-hosted team server with password
 *                                 sign-in off; People is MORE necessary there.
 * Only the first is read. Workspace mode is neither: a team server runs in it.
 */
function applyPlatformPosture(s) {
  const platform = s?.identity?.mode === 'strict' || state.me?.selfService === false;
  state.platform = platform;
  const peopleNav = document.querySelector('.nav-item[data-view="people"]');
  if (peopleNav) peopleNav.hidden = platform;
  for (const b of all('[data-invite], [data-invite-hide]')) b.hidden = platform;
  const note = $('people-platform-note');
  note.hidden = !platform;
  if (platform) {
    note.textContent =
      'People are managed on your Maude dashboard — this project takes its members from your account.';
    if (state.view === 'people') setView('overview');
  }
}

function renderStatus(s) {
  renderRelease(s);
  $('s-uptime').textContent = formatDuration(s.uptimeMs);
  $('s-version').textContent =
    `Maude ${s.releaseVersion || s.version} · running for ${formatDuration(s.uptimeMs)}`;
  $('s-port').textContent = s.port;
  $('s-data').textContent = s.dataDir;
  $('s-tokens').textContent = `${s.tokenCount} (${s.authMode})`;
  $('s-peers').textContent = s.peersCount ?? 0;
  renderDurability(s.durability);
}

/** Backups, where an admin actually looks: a refused or failing backup is an alert, not a log line. */
function renderDurability(d) {
  const alert = $('s-backup-alert');
  if (!d) {
    alert.hidden = true;
    return;
  }
  $('s-backup-prefix').textContent = d.prefix ?? '(bucket root)';
  $('s-backups').textContent = d.state;
  if (d.state === 'identity-conflict') {
    alert.textContent = `Backups are turned off: this backup place already holds backups of another server (${d.conflictWith ?? 'unknown'}). Nothing of theirs is overwritten — and nothing of yours is saved. Give this team server its own MAUDE_BACKUP_PREFIX or its own bucket.`;
  } else if (d.state === 'failed') {
    alert.textContent = `Backups are failing: ${d.message ?? 'unknown error'}`;
  }
  alert.hidden = d.state !== 'identity-conflict' && d.state !== 'failed';
}

/**
 * The release stamp: which RELEASE and which BYTES (bundle-identity.mjs).
 * An absent answer renders as nothing — the element hides itself when empty.
 * It is the island's hover title, not a second line of chrome.
 */
function renderRelease(s) {
  const el = $('nav-hub-version');
  const ver = s.releaseVersion || s.version;
  const client = s.studio?.client?.artifacts?.['dist/client.bundle.js'];
  el.textContent = '';
  el.parentElement.title = ver
    ? client
      ? `release v${ver}, serving client.bundle.js ${client}`
      : `release v${ver}`
    : '';
}

// -------------------------------- overview ---------------------------------

/** One kept event as a sentence that starts with a verb ("Invited …"). Every field is escaped; the log holds no secrets. */
const EVENT_WORDS = {
  login: 'Signed in from the Maude app',
  logout: 'Signed out',
  'signin-browser': 'Signed in',
  'oidc-signin': 'Signed in',
  'oidc-pending': 'Signed in and asks to join',
  'oidc-refused': 'Was turned away at sign-in',
  'oidc-domain-join': 'Joined — colleagues come straight in',
  'oidc-self-link': 'Linked their sign-in',
  'invite-redeem': 'Joined from an invite',
  'invite-create': 'Invited',
  'invite-reissue': 'Made a new invite link for',
  'invite-revoke': 'Cancelled the invite for',
  'role-change': 'Changed',
  'user-create': 'Added',
  'user-disable': 'Turned off',
  'user-enable': 'Turned back on',
  'user-delete': 'Removed',
  'user-password': 'Reset the password of',
  'user-signout': 'Signed out',
  'oidc-approve': 'Let in',
  'oidc-link': 'Linked a sign-in to',
  'oidc-unlink': 'Unlinked the sign-in of',
  'oidc-dismiss': 'Dismissed the request of',
  settings: 'Changed settings',
  token: 'Made the token',
  'token-rotate': 'Replaced the token',
  'token-delete': 'Deleted the token',
  'secret-rotate': 'Changed the admin key',
  backup: '',
  kick: 'Disconnected',
};
const AREA_WORDS = { people: 'People', signin: 'Sign-in', settings: 'Settings', server: 'Server' };

function eventText(e, { lower = false } = {}) {
  let verb = EVENT_WORDS[e.kind] ?? e.kind;
  // A server event (a backup) has no verb: its detail is the sentence.
  if (!verb) {
    const d = String(e.detail ?? '');
    return esc(lower ? d.charAt(0).toLowerCase() + d.slice(1) : d);
  }
  if (lower) verb = verb.charAt(0).toLowerCase() + verb.slice(1);
  const self = !e.target || e.target === e.actor;
  const about = self ? '' : ` ${esc(e.target)}`;
  const detail = e.detail ? ` · ${esc(e.detail)}` : '';
  return `${esc(verb)}${about}${detail}`;
}

/** Bars for the last days — SVG attributes, not inline styles (the CSP drops those). Today is the last bar. */
function spark(days) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const w = 100 / days.length;
  const bars = days
    .map((d, i) => {
      const h = d.count ? Math.max(3, Math.round((d.count / max) * 28)) : 2;
      return `<rect x="${(i * w).toFixed(2)}" y="${28 - h}" width="${(w - 1.4).toFixed(2)}" height="${h}" rx="1.2"${i === days.length - 1 ? ' class="is-today"' : ''}><title>${esc(d.day)}: ${d.count}</title></rect>`;
    })
    .join('');
  return `<svg class="ma-spark" viewBox="0 0 100 28" preserveAspectRatio="none">${bars}</svg>`;
}

function renderOverview(o) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const bad = o.health.filter((h) => h.state === 'bad').length;
  const name = state.me.via === 'session' ? firstName(state.me.email) : '';
  $('ov-hello').textContent =
    `${hello}${name ? `, ${name}` : ''}. ${bad ? 'Something needs a look.' : 'Everything is running.'}`;
  const H = Object.fromEntries(o.health.map((h) => [h.key, h]));
  const sub = [`${o.hub.name} runs ${H.version?.value ?? 'Maude'}`];
  if (H.backups) {
    sub.push(
      H.backups.at && H.backups.state !== 'bad'
        ? `backed up ${formatTime(H.backups.at).toLowerCase()}`
        : `backups: ${H.backups.value.toLowerCase()}`
    );
  }
  if (H.git) {
    sub.push(
      H.git.at
        ? `saved to Git ${formatTime(H.git.at).toLowerCase()}`
        : `saving to Git: ${H.git.value.toLowerCase()}`
    );
  }
  $('ov-sub').textContent = sub.join(' · ');

  // ---- what needs you: the biggest thing on the page, acted on in place
  const needs = state.platform ? o.needs.filter((x) => x.type === 'backup') : o.needs;
  const n = needs.length;
  $('ov-hero').classList.toggle('ma-hero--quiet', n === 0);
  $('ov-needs-n').textContent = n;
  $('ov-needs-n').hidden = n === 0;
  $('ov-needs-t').textContent =
    n === 1 ? 'thing needs you' : n ? 'things need you' : 'Nothing needs you';
  $('ov-needs-rows').hidden = n === 0;
  const provider = o.signIn?.provider;
  $('ov-needs-rows').innerHTML = needs
    .map((x) => {
      if (x.type === 'backup') {
        return `<div class="ma-need" data-testid="need-backup"><span class="ma-ev-ic">${ic('server', 13)}</span><span class="ma-need-t"><strong>${x.since ? `The last backup is from ${esc(formatTime(x.since).toLowerCase())}` : 'There is no backup yet'}</strong><span>${x.failing ? 'The last attempt failed — see Health below' : 'Backups are set up, but none has been made for a while'}</span></span><span class="ma-need-a">${btn(x.running ? 'Backing up…' : 'Back up now', `data-backup="1" data-testid="need-backup-now"${x.running ? ' disabled' : ''}`, 'btn--primary')}</span></div>`;
      }
      if (x.type === 'request') {
        return `<div class="ma-need" data-testid="need-request">${avatar(x.email, true)}<span class="ma-need-t"><strong>${esc(x.email ?? 'Someone')} asks to join</strong><span>Signed in${provider ? ` with ${esc(provider)}` : ''} ${esc(formatTime(x.since).toLowerCase())} — nobody has invited them yet</span></span><span class="ma-need-a">${btn('Dismiss', `data-dismiss="${esc(x.sub)}"`)}${btn('Let in · Can edit', `data-letin="${esc(x.sub)}" data-testid="need-letin"`, 'btn--primary')}</span></div>`;
      }
      return `<div class="ma-need" data-testid="need-invite">${avatar(x.email ?? '?', true)}<span class="ma-need-t"><strong>${esc(x.email ?? 'A link for anyone')}'s invite hasn't been opened</strong><span>Made ${esc(formatTime(x.since).toLowerCase())} · the link works for ${esc(formatUntil(x.expiresAt))}</span></span><span class="ma-need-a">${btn('Copy a new link', `data-reissue="${esc(x.id)}"`)}</span></div>`;
    })
    .join('');
  wirePeopleActions($('ov-needs-rows'));

  const c = o.counts;
  $('stat-people').textContent = c.people;
  $('stat-people-f').textContent =
    [
      c.invited ? `${c.invited} invited` : '',
      c.asks ? `${c.asks} ${c.asks === 1 ? 'asks' : 'ask'} to join` : '',
    ]
      .filter(Boolean)
      .join(' · ') || 'everyone is in';
  $('stat-here').textContent = c.hereNow;
  $('stat-here-f').textContent =
    o.hereNow.map((e) => firstName(e) || e).join(', ') || 'nobody is in a canvas';
  $('stat-canvases').textContent = c.canvases;
  $('stat-canvases-u').textContent = c.canvases === 1 ? 'canvas' : 'canvases';
  // CHANGES = saves to canvases (the number the Cloud dashboard shows too).
  // A server that cannot tell shows a dash, never a 0.
  const tracked = Number.isInteger(c.changesThisWeek);
  $('stat-changes').textContent = tracked
    ? c.changesThisWeek.toLocaleString('en').replace(/,/g, ' ')
    : '—';
  $('stat-changes-f').textContent = tracked ? '' : 'not counted on this server';
  $('stat-changes-f').parentElement.hidden = tracked;
  $('stat-changes-spark').innerHTML = tracked ? spark(o.changesByDay.slice(-14)) : '';

  // ---- health: four cells, each a label, a fact and a status word
  const lines = [
    ...o.health,
    {
      key: 'signin',
      label: 'Sign-in',
      value: provider ?? 'Passwords',
      state: 'ok',
      word: o.signIn?.domains?.length
        ? `@${o.signIn.domains.join(', @')}`
        : 'Accounts on this server',
    },
  ];
  $('ov-health').innerHTML = lines
    .map((h) => {
      const fact = h.at ? formatTime(h.at) : h.value;
      const kind = h.state === 'bad' ? 'error' : h.state;
      const offer = h.canRunNow && !h.running && (h.stale || h.state !== 'ok');
      return `<span class="ma-hl" data-testid="health-${esc(h.key)}"><span>${esc(h.label)}</span><strong>${esc(fact)}</strong>${sw(kind, h.running ? 'Backing up…' : h.word)}${offer ? btn('Back up now', 'data-backup="1" data-testid="health-backup-now"') : ''}</span>`;
    })
    .join('');
  wirePeopleActions($('ov-health'));

  $('ov-activity-feed').innerHTML =
    o.recent
      .map((e) => {
        const server = !e.actor || e.actor === 'Server';
        return `<div class="ma-ev">${server ? serverIcon() : actorMark(e.actor)}<span class="ma-ev-t">${server ? '' : `<strong>${esc(firstName(e.actor) || e.actor)}</strong> `}<span>${eventText(e, { lower: !server })}</span></span><time>${esc(formatShort(e.at))}</time></div>`;
      })
      .join('') || '<p class="ma-empty">Nothing yet.</p>';
  $('activity-sub').textContent =
    `Kept for ${plural(o.retentionDays, 'day')} · ${plural(c.eventsThisWeek, 'event')} this week`;
}

// ------------------------------------------------------------------- people
//
// ONE list. Accounts, people who signed in and ask to join, and open invites
// are rows of the same table; the status word says where each one is.

function statusCell(p) {
  if (p.status === 'asks') {
    return `<span class="chip ma-chip ma-chip--warn">${ic('people', 12)}${esc(p.statusLabel)}</span>`;
  }
  const kind = { online: 'ok', away: 'off', off: 'off', invited: 'busy' }[p.status] ?? 'off';
  return sw(kind, p.statusLabel);
}

/** The role, in the row: a select where it can be changed here, the word where it cannot. */
function roleCell(p) {
  const opt = (v, label, cur) =>
    `<option value="${v}"${cur === v ? ' selected' : ''}>${label}</option>`;
  if (p.kind === 'invite' || p.status === 'off' || p.canvases) {
    return `<span class="ma-role ma-role--fixed">${esc(p.roleLabel)}</span>`;
  }
  const attr =
    p.kind === 'request'
      ? `data-role-for="${esc(p.sub)}" aria-label="Let in as"`
      : `data-role-of="${esc(p.id)}" aria-label="What ${esc(p.email)} can do"`;
  return `<span class="ma-role"><select ${attr} data-testid="person-role">${opt('member', 'Can edit', p.role)}${opt('admin', 'Admin', p.role)}</select>${ic('chevron', 12)}</span>`;
}

function rowActions(p) {
  if (p.kind === 'request') {
    const sub = esc(p.sub);
    return (
      btn('Dismiss', `data-dismiss="${sub}" data-testid="person-dismiss"`) +
      btn('Let in', `data-letin="${sub}" data-testid="person-letin"`, 'btn--primary')
    );
  }
  if (p.kind === 'invite') {
    return btn('Copy a new link', `data-reissue="${esc(p.id)}" data-testid="invite-reissue"`);
  }
  return p.status === 'off'
    ? btn('Turn back on', `data-turnon="${esc(p.id)}" data-testid="person-turnon"`, 'btn--ghost')
    : `<button type="button" class="btn btn--ghost btn--sm" data-open="${esc(p.key)}" data-testid="person-open" aria-label="Open ${esc(p.email)}">${ic('more')}</button>`;
}

function renderPeople() {
  const d = state.people;
  if (!d) return;
  const c = d.counts;
  $('pc-all').textContent = c.everyone;
  $('pc-asks').textContent = c.asks || '';
  $('pc-invited').textContent = c.invited || '';
  $('pc-off').textContent = c.off || '';
  $('nav-count-people').textContent = c.asks + c.invited || '';
  $('people-sub').textContent =
    `${plural(c.people, 'person', 'people')} · who can come in is set in Settings › Who can join`;
  const q = $('people-find').value.trim().toLowerCase();
  const f = state.peopleFilter;
  const rows = d.people.filter(
    (p) =>
      (f === 'all' || p.status === f) &&
      (!q || `${p.email ?? ''} ${p.roleLabel} ${p.statusLabel}`.toLowerCase().includes(q))
  );
  const open = $('person-sheet').open ? $('person-sheet').dataset.key : null;
  $('people-rows').innerHTML = rows.length
    ? rows
        .map((p) => {
          const seen =
            p.kind === 'invite'
              ? 'Not yet'
              : p.status === 'online'
                ? 'Now'
                : formatTime(p.lastSeen);
          // The name slot holds what there is: the address. Under it, where they are signed in.
          const under =
            p.kind === 'account'
              ? p.sessions.length
                ? `signed in on ${plural(p.sessions.length, 'device')}`
                : 'not signed in anywhere'
              : p.kind === 'invite'
                ? `the link works for ${formatUntil(p.expiresAt)}`
                : 'signed in, not invited';
          const cls = [
            'is-row',
            p.status === 'asks' ? 'is-hl' : '',
            p.status === 'off' ? 'is-dim' : '',
            open === p.key ? 'is-picked' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            `<tr class="${cls}" data-key="${esc(p.key)}" data-testid="person-row">` +
            `<td>${who(p.email ?? 'Anyone with the link', under)}</td>` +
            `<td>${roleCell(p)}</td><td data-testid="person-status">${statusCell(p)}</td>` +
            `<td class="ma-quiet">${esc(seen)}</td>` +
            `<td><span class="ma-row-a">${rowActions(p)}</span></td></tr>`
          );
        })
        .join('')
    : '<tr class="empty"><td colspan="5">Nobody here.</td></tr>';
  const tbody = $('people-rows');
  wirePeopleActions(tbody);
  for (const sel of all('select[data-role-of]', tbody)) {
    sel.addEventListener('change', () => {
      const p = d.people.find((x) => x.id === sel.dataset.roleOf);
      if (!p || sel.value === p.role) return;
      if (
        sel.value === 'admin' &&
        !confirm(`Make ${p.email} an Admin? Admins invite and remove people and change settings.`)
      ) {
        sel.value = p.role;
        return;
      }
      void act(() => post('/people/role', { id: p.id, role: sel.value }));
    });
  }
  for (const tr of all('tr[data-key]', tbody)) {
    tr.addEventListener('click', (e) => {
      if (!e.target.closest('button, select, .ma-role')) openPerson(tr.dataset.key);
    });
  }
}

/** Run one People change, then redraw. Errors are said in words, in place. */
async function act(fn) {
  try {
    await fn();
  } catch (err) {
    if (err.status !== 401) showNote(err.message, { bad: true });
  }
  await refresh();
}

function wirePeopleActions(root) {
  const on = (attr, fn) => {
    for (const b of all(`button[data-${attr}]`, root)) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn(b.dataset[attr], b);
      });
    }
  };
  on('letin', (sub) => {
    const sel = document.querySelector(`select[data-role-for="${CSS.escape(sub)}"]`);
    return act(() => post('/people/let-in', { sub, role: sel?.value ?? 'member' }));
  });
  on('dismiss', (sub) => act(() => post('/people/dismiss', { sub })));
  on('reissue', (id, b) =>
    act(async () => {
      const r = await post('/people/invite/reissue', { id });
      if (!(await copyText(r.url, b))) showSecret(r.url, r.email ?? 'a link for anyone');
    })
  );
  on('turnon', (id) => act(() => post('/people/turn-on', { id })));
  on('open', (key) => openPerson(key));
  // "Back up now": the hub answers at once; the row and the Overview line say how it ended.
  on('backup', (_v, b) => {
    b.disabled = true;
    b.textContent = 'Backing up…';
    return act(() => post('/backup/run'));
  });
}

// ---- sheets: a veil over the page, the sheet at the right (canvas `ma-sheet`)

function openSheet(dialog) {
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('has-sheet');
}
for (const d of all('dialog.ma-sheet')) {
  d.addEventListener('close', () => {
    document.body.classList.remove('has-sheet');
    delete d.dataset.key;
    if (state.people) renderPeople();
  });
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
}

// ---- the person sheet: everything about one person, changed in place ----

async function openPerson(key) {
  const p = state.people?.people.find((x) => x.key === key);
  if (!p) return;
  const sheet = $('person-sheet');
  sheet.dataset.key = key;
  sheet.setAttribute('aria-label', p.email ?? 'A link for anyone');
  $('person-error').hidden = true;
  const body = $('person-body');
  const actions = $('person-actions');
  const head = who(p.email ?? 'Anyone with the link', p.statusLabel);
  const close =
    '<span class="ma-sp"></span><button type="button" class="btn btn--ghost" data-close>Close</button>';
  const inAll = `<span class="field"><span class="field-label">In</span><span class="ma-sel">All projects — now and new ones${ic('chevron', 12)}</span></span>`;

  if (p.kind === 'request') {
    // The link action keys on the SUBJECT and the admin types the address:
    // offering "link to <claimed address>" would be the address→account
    // guess the sign-in path refuses to make.
    const sub = esc(p.sub);
    body.innerHTML = `${head}
      <span class="field"><span class="field-label">Let in as</span><span class="seg ma-seg" id="letin-role"><button type="button" class="ma-seg-b" data-role="member" aria-pressed="true">Can edit</button><button type="button" class="ma-seg-b" data-role="admin" aria-pressed="false">Admin</button></span>
      <span class="field-hint">Signed in ${esc(formatTime(p.createdAt).toLowerCase())} and has no account here. Nobody invited this address.</span></span>
      ${inAll}
      <p class="ma-sub ma-sub--flat">Already has an account here? ${
        hasKey()
          ? `<button type="button" class="ma-link" data-link="${sub}">Link to an existing account</button> — its password stops working and its sessions end.`
          : 'They sign in with its password and choose Link my sign-in. Linking for someone else needs the admin key.'
      }</p>`;
    actions.innerHTML = `${btn('Dismiss', 'data-x="dismiss"')}<span class="ma-sp"></span><button type="button" class="btn btn--ghost" data-close>Close</button><button type="button" class="btn btn--primary" data-approve="${sub}" data-testid="sheet-letin">Let in</button>`;
    for (const b of all('#letin-role .ma-seg-b', body)) {
      b.addEventListener('click', () => {
        for (const o of all('#letin-role .ma-seg-b', body))
          o.setAttribute('aria-pressed', String(o === b));
      });
    }
    actions.querySelector('[data-approve]').addEventListener('click', () =>
      sheetAct(() =>
        post('/people/let-in', {
          sub: p.sub,
          role: body.querySelector('#letin-role [aria-pressed="true"]').dataset.role,
        })
      )
    );
    actions
      .querySelector('[data-x="dismiss"]')
      .addEventListener('click', () => sheetAct(() => post('/people/dismiss', { sub: p.sub })));
    body.querySelector('[data-link]')?.addEventListener('click', () => linkPending(p.sub));
  } else if (p.kind === 'invite') {
    const id = esc(p.id);
    const label = esc(p.email ?? 'a link for anyone');
    body.innerHTML = `${head}
      <span class="field"><span class="field-label">They can</span><span class="seg ma-seg"><span class="ma-seg-b" aria-pressed="true">${esc(p.roleLabel)}</span></span></span>
      ${inAll}
      <div><div class="ma-adv-row"><span>The link works for</span><span class="ma-quiet">${esc(formatUntil(p.expiresAt))}</span></div><div class="ma-adv-row"><span>Made</span><span class="ma-quiet">${esc(formatTime(p.createdAt))}</span></div></div>
      <p class="ma-sub ma-sub--flat">The link was shown once, when the invite was made. Copy a new link makes a fresh one; the old one stops working.</p>`;
    actions.innerHTML = `<button type="button" class="btn btn--sm k-btn-danger" data-revoke="${id}" data-testid="invite-revoke" aria-label="Revoke the invitation for ${label}">Cancel invite</button>${btn('Copy a new link', 'data-x="reissue"')}${close}`;
    actions
      .querySelector('[data-revoke]')
      .addEventListener('click', () => sheetAct(() => post('/people/invite/revoke', { id: p.id })));
    actions.querySelector('[data-x="reissue"]').addEventListener('click', (e) =>
      sheetAct(async () => {
        const r = await post('/people/invite/reissue', { id: p.id });
        if (!(await copyText(r.url, e.target))) showSecret(r.url, p.email ?? 'a link for anyone');
      }, false)
    );
  } else {
    const off = p.status === 'off';
    const seg = (role, label) =>
      `<button type="button" class="ma-seg-b" data-role="${role}" aria-pressed="${p.role === role}" data-testid="role-${role}">${label}</button>`;
    const kinds = { browser: 'A browser', app: 'The Maude app', token: 'A token' };
    const short = firstName(p.email) || p.email;
    body.innerHTML = `${head}
      <span class="field"><span class="field-label">${esc(short)} can</span><span class="seg ma-seg" id="person-role">${seg('member', 'Can edit')}${seg('admin', 'Admin')}</span>
      <span class="field-hint">Changes at once: ${esc(short)} is signed out everywhere and signs in again with the new role.${p.canvases ? ` Has ${plural(p.canvases, 'canvas', 'canvases')} only.` : ''}</span></span>
      ${inAll}
      <div><h4 class="ma-sheet-h4">Signed in on</h4>${
        p.sessions
          .map(
            (s) =>
              `<div class="ma-adv-row"><span>${kinds[s.kind]} <span class="ma-quiet">· ${s.live ? 'now' : esc(formatTime(s.lastUsedAt ?? s.createdAt).toLowerCase())}</span></span>${btn('Sign out', `data-signout-label="${esc(s.label)}"`, 'btn--ghost')}</div>`
          )
          .join('') ||
        '<div class="ma-adv-row"><span class="ma-quiet">Nowhere right now</span></div>'
      }</div>
      <div><h4 class="ma-sheet-h4">Lately <button type="button" class="ma-link" data-see-all>See all in Activity</button></h4><div id="person-lately" data-testid="person-lately"><div class="ma-adv-row"><span class="ma-quiet">…</span></div></div></div>
      <p class="ma-sub ma-sub--flat">Turn off keeps ${esc(short)}'s work and ends every session; you can turn ${esc(short)} back on. Remove asks first. The last Admin can't be turned off or removed. ${p.linked ? `Signs in with ${esc(state.people.signIn.provider ?? 'the provider')}.` : 'Signs in with a password.'}</p>`;
    actions.innerHTML =
      (off
        ? btn('Turn back on', 'data-x="turn-on" data-testid="sheet-turnon"')
        : btn('Turn off', 'data-x="turn-off" data-testid="sheet-turnoff"')) +
      btn('Remove…', 'data-x="remove" data-testid="sheet-remove"', 'k-btn-danger') +
      // Setting a password is key-only: a session must not be able to leave one behind.
      (hasKey() && state.people.signIn.passwords
        ? btn('Reset password', 'data-pw="1"', 'btn--ghost')
        : '') +
      close;
    for (const b of all('#person-role button', body)) {
      b.addEventListener('click', () => {
        if (b.dataset.role === p.role) return;
        if (
          b.dataset.role === 'admin' &&
          !confirm(`Make ${p.email} an Admin? Admins invite and remove people and change settings.`)
        )
          return;
        sheetAct(() => post('/people/role', { id: p.id, role: b.dataset.role }));
      });
    }
    for (const b of all('[data-signout-label]', body)) {
      b.addEventListener('click', () =>
        sheetAct(() => post('/people/signout', { id: p.id, label: b.dataset.signoutLabel }))
      );
    }
    for (const b of all('[data-x]', actions)) {
      b.addEventListener('click', () => {
        const x = b.dataset.x;
        if (
          x === 'remove' &&
          !confirm(
            `Remove ${p.email}? Their account is deleted and every session ends. Their work stays.`
          )
        )
          return;
        sheetAct(() => post(`/people/${x}`, { id: p.id }));
      });
    }
    actions.querySelector('[data-pw]')?.addEventListener('click', () => resetPassword(p.email));
    body.querySelector('[data-see-all]').addEventListener('click', () => {
      sheet.close();
      $('activity-find').value = p.email;
      state.act.q = p.email;
      setView('activity');
    });
    // The same kept log, narrowed to this person — by account id, so no address is in a URL.
    api(`/activity?who=${encodeURIComponent(p.id)}&limit=4`)
      .then((a) => {
        $('person-lately').innerHTML =
          a.events
            .map(
              (e) =>
                `<div class="ma-adv-row"><span>${e.actor === p.email ? '' : `${esc(firstName(e.actor) || e.actor || 'Server')}: `}${eventText({ ...e, target: e.target === p.email ? '' : e.target }, { lower: e.actor !== p.email })}</span><span class="ma-quiet">${esc(formatShort(e.at))}</span></div>`
            )
            .join('') || '<div class="ma-adv-row"><span class="ma-quiet">Nothing yet</span></div>';
      })
      .catch((err) => {
        $('person-lately').innerHTML =
          `<div class="ma-adv-row"><span class="ma-quiet">Could not be loaded. ${esc(err.message)}</span></div>`;
      });
  }
  openSheet(sheet);
  // The sheet itself takes focus: no ring drawn on its first control (canvas ts-person).
  sheet.focus();
  renderPeople();
}

/** A change made from a sheet: errors stay in the sheet; success closes it (unless told not to). */
async function sheetAct(fn, close = true) {
  const err = $('person-error');
  err.hidden = true;
  try {
    await fn();
    if (close) $('person-sheet').close();
  } catch (e) {
    if (e.status === 401) return;
    err.textContent = e.message;
    err.hidden = false;
  }
  await refresh();
}

async function linkPending(sub) {
  const email = prompt(
    `Link this sign-in to which existing account? Type the account's email address.`
  );
  if (!email) return;
  await sheetAct(() => post('/oidc/link', { sub, email: email.trim() }, { key: 'always' }));
}

async function resetPassword(email) {
  const password = prompt(`New password for ${email} (at least 12 characters)`);
  if (!password) return;
  await sheetAct(() => post('/users/password', { email, password }, { key: 'always' }), false);
}

// ---- the invite sheet ----

const typedEmails = () =>
  $('person-invite-email')
    .value.split(/[\s,;]+/)
    .filter(Boolean);

function openInvite() {
  const s = state.people?.signIn ?? state.overview?.signIn;
  const hub = state.me?.hub?.name || 'this team server';
  $('invite-sheet-t').textContent = `Invite people to ${hub}`;
  $('invite-sheet-s').textContent = s?.provider
    ? `They sign in with ${s.provider} — the invite lets them straight in.`
    : 'They open the link, choose a password, and are in.';
  $('invite-promise').textContent =
    `No approving and no token afterwards. They open the link, ${s?.provider ? 'sign in' : 'choose a password'}, and the Maude app connects from the browser. The team server does not send email: you pass the links on.`;
  $('invite-results').innerHTML = '';
  $('person-invite-error').hidden = true;
  countInvites();
  openSheet($('invite-sheet'));
  $('person-invite-email').focus();
}
function countInvites() {
  const n = new Set(typedEmails().map((e) => e.toLowerCase())).size;
  $('invite-submit').textContent = n ? `Make ${plural(n, 'invite link')}` : 'Make invite links';
}

async function makeInvites(emails) {
  const err = $('person-invite-error');
  err.hidden = true;
  try {
    const r = await post('/people/invite', {
      emails,
      role: document.querySelector('input[name="invite-role"]:checked')?.value ?? 'member',
    });
    // Each link is shown ONCE, here. The hub never stores or lists it again.
    $('invite-results').innerHTML = r.invites
      .map((i, n) =>
        i.ok
          ? `<div class="ma-adv-row" data-testid="invite-result"><span><strong>${esc(i.email ?? 'Anyone with the link')}</strong><span class="ma-url">${esc(i.url)}</span></span>${btn('Copy link', `data-copy="${n}"`)}</div>`
          : `<div class="ma-adv-row" data-testid="invite-result-error"><span><strong>${esc(i.email)}</strong></span>${sw('error', i.error)}</div>`
      )
      .join('');
    for (const b of all('[data-copy]', $('invite-results'))) {
      b.addEventListener('click', () => copyText(r.invites[Number(b.dataset.copy)].url, b));
    }
    if (r.invites.some((i) => i.ok)) $('person-invite-email').value = '';
    countInvites();
    return r;
  } catch (e) {
    if (e.status !== 401) {
      err.textContent = e.message;
      err.hidden = false;
    }
    return null;
  } finally {
    await refresh();
  }
}

// -------------------------------- projects ---------------------------------

function renderCanvases(c) {
  const rows = c.canvases || [];
  $('canvases-context').textContent =
    `${plural(rows.length, 'canvas', 'canvases')} saved on this team server.`;
  $('git-canvases').textContent = rows.length;
  $('canvases-rows').innerHTML = rows.length
    ? rows
        .map(
          (r) =>
            `<tr><td><span class="ma-who"><span class="ma-ev-ic">${ic('folder', 13)}</span><span class="ma-who-t"><strong>${esc(r.name)}</strong></span></span></td><td class="ma-quiet">${esc(formatBytes(r.bytes))}</td><td>${sw(r.peers ? 'ok' : 'off', r.peers ? `${r.peers} open` : 'Nobody')}</td></tr>`
        )
        .join('')
    : '<tr class="empty"><td colspan="3">No canvases yet.</td></tr>';
}

// -------------------------------- activity ---------------------------------

const activityQuery = (extra = '') => {
  const a = state.act;
  return `?kind=${encodeURIComponent(a.kind)}&q=${encodeURIComponent(a.q)}${extra}`;
};

async function fetchActivity(older) {
  const a = state.act;
  const data = await api(`/activity${activityQuery(older && a.more ? `&before=${a.more}` : '')}`);
  return { data, older };
}
function drawActivity({ data, older }) {
  const a = state.act;
  a.rows = older ? a.rows.concat(data.events) : data.events;
  // Once older rows are shown the 5 s refresh leaves the list alone.
  a.paged = older;
  a.more = data.events.length >= 100 ? data.more : null;
  $('activity-more-row').hidden = !a.more;
  $('activity-rows').innerHTML = a.rows.length
    ? a.rows
        .map((e) => {
          const server = !e.actor || e.actor === 'Server';
          return `<tr data-testid="activity-row"><td class="ma-quiet">${esc(formatWhen(e.at))}</td><td><span class="ma-who">${server ? serverIcon() : actorMark(e.actor)}<span class="ma-who-t"><strong>${esc(server ? 'Server' : e.actor)}</strong></span></span></td><td class="ma-wrap">${eventText(e)}</td><td class="ma-quiet">${esc(AREA_WORDS[e.area] ?? e.area)}</td></tr>`;
        })
        .join('')
    : '<tr class="empty"><td colspan="4">Nothing here.</td></tr>';
}
async function loadActivity(older = false) {
  try {
    drawActivity(await fetchActivity(older));
  } catch (err) {
    pageFailed('The activity', err, () => {
      clearNote();
      void loadActivity(older);
    });
  }
}

/** CSV: fetched with whichever credential this page holds, then saved — a link could not carry the key. */
async function downloadCsv() {
  const res = await api(`/activity.csv${activityQuery()}`, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: 'activity.csv' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// -------------------------------- settings ---------------------------------

const setSw = (id, kind, word) => {
  $(id).className = `k-sw k-sw--${kind}`;
  $(`${id}-t`).textContent = word;
};

/** Backups and Git, from what the Overview and the status already hold. */
function renderSettingsCards() {
  const H = Object.fromEntries((state.overview?.health ?? []).map((h) => [h.key, h]));
  const d = state.status?.durability;
  const b = H.backups;
  if (b) {
    const kind = b.state === 'bad' ? 'error' : b.state;
    setSw('bk-state', kind, b.at && b.state !== 'bad' ? formatTime(b.at) : b.value);
    $('bk-kept').textContent = Number.isInteger(b.kept)
      ? `${plural(b.kept, 'backup')}${b.state === 'bad' ? ` · ${b.word}` : ''}`
      : b.word;
    $('bk-where').textContent = d?.target
      ? `${d.target}${d.prefix ? ` · ${d.prefix}` : ''}`
      : 'Not set up';
    $('bk-every').textContent = d?.intervalMs ? `Every ${formatDuration(d.intervalMs)}` : '—';
    $('bk-now').hidden = !b.canRunNow;
    $('bk-now').disabled = Boolean(b.running);
    $('bk-now').textContent = b.running ? 'Backing up…' : 'Back up now';
  }
  const g = H.git;
  if (g) {
    setSw('git-state', g.state === 'bad' ? 'error' : g.state, g.at ? formatTime(g.at) : g.word);
    $('git-last').textContent = g.at ? formatWhen(g.at) : g.value;
  }
  const s = state.status;
  if (s) {
    $('adv-facts').textContent =
      `${$('set-transport').textContent || 'http'} · port ${s.port} · ${s.dataDir}`;
  }
}

async function loadSettings() {
  try {
    const s = await api('/settings');
    $('set-name').value = s.name || '';
    $('set-desc').value = s.description || '';
    $('set-url').textContent = s.publicUrl || '—';
    $('set-transport').textContent = s.transport || '—';
    for (const el of all('[data-hub-name]')) el.textContent = s.name || 'Team server';
    let host = '';
    try {
      host = new URL(s.publicUrl).host;
    } catch {
      /* keep empty */
    }
    $('set-sub').textContent = [s.name, host].filter(Boolean).join(' · ');
    const radio = document.querySelector(`input[name="whoCanJoin"][value="${s.whoCanJoin}"]`);
    if (radio) radio.checked = true;
    const p = s.signIn ?? {};
    const dom = p.domains?.length ? `@${p.domains.join(', @')}` : '';
    setSw(
      'join-provider',
      p.provider ? 'ok' : 'off',
      p.provider ? `${p.provider}${dom ? ` · ${dom.replace(/^@/, '')}` : ''}` : 'Passwords only'
    );
    setSw('adv-signin', p.provider ? 'ok' : 'off', p.provider ? 'Connected' : 'Passwords only');
    $('adv-signin-l').textContent = p.provider ? `${p.provider} sign-in` : 'Sign-in';
    // Without a provider nobody can arrive uninvited: the rule has nothing to decide.
    for (const r of all('input[name="whoCanJoin"]')) r.disabled = !p.provider || state.platform;
    $('join-ask-sub').textContent =
      `Anyone ${dom || 'who signs in'} can ask; you see it under Needs you`;
    $('join-domain-sub').textContent = `Anyone ${dom || 'who signs in'} joins as Can edit`;
    $('join-status').textContent = p.provider
      ? ''
      : 'People sign in with a password here, so only an invitation lets someone in.';
    renderSettingsCards();
  } catch (err) {
    pageFailed('The settings', err, () => {
      clearNote();
      void loadSettings();
    });
  }
}

async function saveSettings(body, statusEl, errorEl) {
  errorEl.hidden = true;
  try {
    const saved = await post('/settings', { name: $('set-name').value, ...body });
    statusEl.textContent = 'Saved.';
    setTimeout(() => {
      statusEl.textContent = '';
    }, 2000);
    for (const el of all('[data-hub-name]')) el.textContent = saved.name;
  } catch (err) {
    if (err.status === 401) return;
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    void loadSettings();
  }
}

// ---- Advanced: tokens, connected sessions, the admin key — key-only ----

async function loadAdvanced() {
  const key = hasKey();
  $('adv-key-form').hidden = key;
  $('rotate-admin').hidden = !key;
  if (!key) {
    const need =
      '<div class="ma-adv-row"><span class="ma-quiet">Needs the admin key — enter it on the right</span></div>';
    $('tokens-rows').innerHTML = need;
    $('peers-rows').innerHTML = need;
    $('invite-form').hidden = true;
    return;
  }
  try {
    const [tokens, peers] = await Promise.all([
      api('/tokens', { key: 'always' }),
      api('/peers', { key: 'always' }),
    ]);
    renderTokens(tokens, peers.peers);
    renderPeers(peers);
  } catch (err) {
    if (err.status === 401) return;
    const failed = `<div class="ma-adv-row"><span class="ma-quiet">Could not be loaded. ${esc(err.message)}</span>${btn('Retry', 'data-adv-retry="1"')}</div>`;
    $('tokens-rows').innerHTML = failed;
    $('peers-rows').innerHTML = '';
    $('tokens-rows')
      .querySelector('[data-adv-retry]')
      .addEventListener('click', () => void loadAdvanced());
  }
}

function renderTokens(t, peers) {
  const box = $('tokens-rows');
  const live = new Map();
  for (const p of peers) live.set(p.user, (live.get(p.user) ?? 0) + 1);
  // A person's sign-in is a token too (`studio-…` in a browser, `u-…` in the
  // Maude app). Those are People's to show and end, not this list's.
  const rows = t.tokens.filter((r) => !/^(studio-|u-[0-9a-f]{12}$)/.test(r.label));
  box.innerHTML =
    rows
      .map((r) => {
        const lbl = esc(r.label);
        const n = live.get(r.label) ?? 0;
        const used = n
          ? `${n} connected`
          : r.lastUsedAt
            ? `used ${formatTime(r.lastUsedAt).toLowerCase()}`
            : 'not used yet';
        return (
          `<div class="ma-adv-row"><span>${lbl} <span class="ma-quiet">· ${!r.scope || r.scope === '*' ? 'every canvas' : esc(r.scope)} · ${esc(used)}</span></span>` +
          `<span class="ma-row-a"><button type="button" class="btn btn--ghost btn--sm" data-rotate="${lbl}">Replace</button>` +
          `<button type="button" class="btn btn--ghost btn--sm" data-delete="${lbl}" aria-label="Delete token ${lbl}">${ic('trash', 13)}</button></span></div>`
        );
      })
      .join('') +
    `<div class="ma-adv-row"><button type="button" class="ma-link" data-new-token>+ New token</button><span class="ma-quiet">shown once</span></div>`;
  for (const b of all('button[data-rotate]', box))
    b.addEventListener('click', () => rotate(b.dataset.rotate));
  for (const b of all('button[data-delete]', box))
    b.addEventListener('click', () => deleteToken(b.dataset.delete));
  box.querySelector('[data-new-token]').addEventListener('click', () => {
    $('invite-form').hidden = !$('invite-form').hidden;
    if (!$('invite-form').hidden) $('invite-label').focus();
  });
}

function renderPeers(p) {
  const box = $('peers-rows');
  box.innerHTML = p.peers.length
    ? p.peers
        .map(
          (peer) =>
            `<div class="ma-adv-row"><span>${esc(peer.user || 'anon')} · ${esc(peer.documentName)}</span>` +
            `<button type="button" class="btn btn--ghost btn--sm" data-kick="${esc(peer.socketId)}">Disconnect</button></div>`
        )
        .join('')
    : '<div class="ma-adv-row"><span class="ma-quiet">Nobody is connected</span></div>';
  for (const b of all('button[data-kick]', box))
    b.addEventListener('click', () => kickPeer(b.dataset.kick));
}

async function advAct(question, fn) {
  if (question && !confirm(question)) return;
  try {
    await fn();
  } catch (err) {
    if (err.status !== 401) showNote(err.message, { bad: true });
  }
  await loadAdvanced();
}
const rotate = (label) =>
  advAct(`Replace token "${label}"? The old value stops working at once.`, async () =>
    showInvite(await post('/token/rotate', { label }, { key: 'always' }), label)
  );
const deleteToken = (label) =>
  advAct(`Delete token "${label}"? Anything using it is disconnected. This can't be undone.`, () =>
    post('/token/delete', { label }, { key: 'always' })
  );
const kickPeer = (socketId) =>
  advAct('Disconnect this session? It can reconnect with a valid token.', () =>
    post('/peers/kick', { socketId }, { key: 'always' })
  );

/** The one "shown once" surface — a peer token's command, or a link. */
function showInvite({ token, command, scope }, label) {
  $('token-command').textContent = command;
  $('token-raw').textContent = token;
  $('token-modal-title').textContent = label ? `Ready — for ${label}` : 'Ready';
  const sc = scope ?? '*';
  $('token-scope').textContent = sc === '*' ? 'Reaches every canvas.' : `Reaches: ${sc}.`;
  $('token-modal-stamp').textContent = new Date().toISOString();
  $('token-modal').showModal();
  $('token-copy').focus();
}
const showSecret = (url, label) =>
  showInvite({ token: url, command: url, scope: 'invite link' }, label);

// -------------------------------- nav --------------------------------------

// EVERY nav item needs an entry here: `setView` sends an unknown view to
// Overview, so a tab without a title is a tab that bounces you back.
// `admin-people.test.mjs` checks every nav item against this map.
const VIEW_TITLES = {
  overview: 'Overview',
  people: 'People',
  projects: 'Projects',
  activity: 'Activity',
  settings: 'Settings',
};

function setView(name) {
  if (!VIEW_TITLES[name] || (name === 'people' && state.platform)) name = 'overview';
  state.view = name;
  for (const v of all('#dash .view')) v.hidden = v.id !== `view-${name}`;
  for (const item of all('.nav-item')) {
    if (item.dataset.view === name) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  if (name === 'settings') void loadSettings();
  if (name === 'activity') void loadActivity();
}

function pressTab(group, button) {
  for (const b of all('.ma-tab', group)) b.setAttribute('aria-pressed', String(b === button));
}

// -------------------------------- wire -------------------------------------

/** The person chose the admin key, here, in this tab. */
async function useKey(input, errorEl) {
  const secret = input.value.trim();
  if (!secret) return;
  errorEl.hidden = true;
  try {
    const res = await fetch(`${API_BASE}/status`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok)
      throw new Error(res.status === 401 ? 'That is not the admin key.' : `HTTP ${res.status}`);
    state.secret = secret;
    store('localStorage')?.setItem(LS_KEY, secret);
    // From the sign-in card this IS choosing key mode; from Settings › Advanced
    // a signed-in admin stays themself and the key just unlocks Advanced.
    if (input.id === 'onboard-secret') store('sessionStorage')?.setItem(SS_KEY_MODE, '1');
    input.value = '';
    await boot();
    if ($('advanced').open) void loadAdvanced();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}

$('onboard-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void useKey($('onboard-secret'), $('onboard-error'));
});
$('adv-key-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void useKey($('adv-key'), $('adv-key-error'));
});

$('bootstrap-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('bootstrap-error').hidden = true;
  try {
    const res = await fetch(`${API_BASE}/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.bootstrapKey }),
    });
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    const { secret } = await res.json();
    state.secret = secret;
    state.bootstrapKey = '';
    store('localStorage')?.setItem(LS_KEY, secret);
    store('sessionStorage')?.setItem(SS_KEY_MODE, '1');
    await boot();
  } catch (err) {
    $('bootstrap-error').textContent = err.message;
    $('bootstrap-error').hidden = false;
  }
});

// A peer token (Advanced) — a terminal credential, not a person's account.
$('invite-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const label = $('invite-label').value.trim();
  if (!label) return;
  $('invite-error').hidden = true;
  try {
    // Checked → scope '*' (every canvas, needed for sync); else the hub scopes it to the label.
    const body = $('invite-wildcard').checked ? { label, scope: '*' } : { label };
    showInvite(await post('/token', body, { key: 'always' }), label);
    $('invite-label').value = '';
    $('invite-form').hidden = true;
    await loadAdvanced();
  } catch (err) {
    $('invite-error').textContent = err.message;
    $('invite-error').hidden = false;
  }
});

$('person-invite-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const emails = $('person-invite-email').value.trim();
  if (emails) void makeInvites(emails);
});
$('person-invite-email').addEventListener('input', countInvites);
$('invite-open-link').addEventListener('click', () => void makeInvites([]));
for (const b of all('[data-invite]')) b.addEventListener('click', openInvite);
// "Copy invite link" on the Overview: one link for anyone, made and copied in one step.
$('ov-copy-link').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  try {
    const r = await post('/people/invite', { emails: [], role: 'member' });
    const url = r.invites[0]?.url;
    if (url && !(await copyText(url, b))) showSecret(url, 'a link for anyone');
  } catch (err) {
    if (err.status !== 401) showNote(err.message, { bad: true });
  }
  await refresh();
});

$('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void saveSettings(
    { description: $('set-desc').value },
    $('settings-status'),
    $('settings-error')
  );
});
$('join-form').addEventListener('change', (e) => {
  if (e.target.name !== 'whoCanJoin') return;
  void saveSettings({ whoCanJoin: e.target.value }, $('join-status'), $('join-error'));
});
wirePeopleActions($('backups-card'));

$('rotate-admin').addEventListener('click', async () => {
  if (
    !confirm(
      'Change the admin key? Every browser using the current key is signed out of it, and the key has to be set up again (a new bootstrap link, or HUB_SECRET). This cannot be undone.'
    )
  )
    return;
  $('danger-error').hidden = true;
  try {
    await post('/admin-secret/rotate', {}, { key: 'always' });
    forgetKey();
    await boot();
  } catch (err) {
    if (err.status === 401) return;
    $('danger-error').textContent = err.message;
    $('danger-error').hidden = false;
  }
});

$('forget').addEventListener('click', () => {
  forgetKey();
  void boot();
});

// Sign out ends the SESSION at the hub (a POST — it revokes the credential).
for (const b of all('[data-signout]')) {
  b.addEventListener('click', async () => {
    await fetch('auth/browser/signout', { method: 'POST', redirect: 'manual' }).catch(() => {});
    state.me = null;
    void boot();
  });
}

$('token-copy').addEventListener('click', async () => {
  if (await copyText($('token-command').textContent, $('token-copy'))) {
    $('copy-status').textContent = 'Copied to the clipboard';
  }
});

$('page-note-retry').addEventListener('click', () => retryAction?.());
$('page-note-close').addEventListener('click', clearNote);

for (const item of all('.nav-item'))
  item.addEventListener('click', () => setView(item.dataset.view));
for (const link of all('[data-nav]'))
  link.addEventListener('click', () => setView(link.dataset.nav));

// The avatar menu: Open the studio, the sign-in, sign out.
for (const b of all('[data-menu]')) {
  const menu = $(b.dataset.menu);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    b.setAttribute('aria-expanded', String(!menu.hidden));
  });
}
const closeMenus = () => {
  for (const b of all('[data-menu]')) {
    $(b.dataset.menu).hidden = true;
    b.setAttribute('aria-expanded', 'false');
  }
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ma-menu')) closeMenus();
});

for (const b of all('#people-tabs .ma-tab')) {
  b.addEventListener('click', () => {
    state.peopleFilter = b.dataset.filter;
    pressTab($('people-tabs'), b);
    renderPeople();
  });
}
$('people-find').addEventListener('input', renderPeople);

for (const b of all('#activity-tabs .ma-tab')) {
  b.addEventListener('click', () => {
    state.act.kind = b.dataset.kind;
    pressTab($('activity-tabs'), b);
    void loadActivity();
  });
}
let findTimer = 0;
$('activity-find').addEventListener('input', () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => {
    state.act.q = $('activity-find').value.trim();
    void loadActivity();
  }, 250);
});
$('activity-more').addEventListener('click', () => void loadActivity(true));
$('activity-csv').addEventListener('click', () =>
  downloadCsv().catch((err) => {
    if (err.status !== 401)
      showNote(`The CSV could not be downloaded. ${err.message}`, { bad: true });
  })
);
$('advanced').addEventListener('toggle', () => void loadAdvanced());

// Search (⌘K): people where you are looking at people, the kept log on Activity.
$('search').addEventListener('input', () => {
  const q = $('search').value;
  if (state.view === 'activity') {
    $('activity-find').value = q;
    $('activity-find').dispatchEvent(new Event('input'));
    return;
  }
  if (state.view !== 'people' && !state.platform) setView('people');
  $('people-find').value = q;
  renderPeople();
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !$('dash').hidden) {
    e.preventDefault();
    $('search').focus();
  }
  if (e.key === 'Escape') closeMenus();
});

void boot();
setInterval(() => {
  if (state.me?.admin && !document.hidden && !document.querySelector('dialog[open]'))
    void refresh();
}, 5000);
