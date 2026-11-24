// Team server admin — vanilla JS, no framework, strict CSP (no inline script
// or style: every look is a class, every handler is wired here).
//
// WHO IS LOOKING decides the page (`GET api/me`):
//   ?key=<bootstrap>          → "bootstrap" (one-time claim)
//   an admin                  → "dash" — signed in with an Admin account (the
//                               ordinary way), or holding the admin key
//   a signed-in member        → "member" — their own access, nothing else
//   nobody                    → "onboard" — Sign in, or (Advanced) the admin key
//
// Two credentials, never mixed up: the browser SESSION is a cookie the hub
// set at sign-in (this script never sees it); the admin KEY lives in
// localStorage and rides as a Bearer. Key-only things (tokens, connected
// sessions, the key itself) are asked for only when the key is present.

const LS_KEY = 'maude-hub-secret';
const $ = (id) => document.getElementById(id);
const all = (sel, root = document) => [...root.querySelectorAll(sel)];

// The API base follows where THIS page is served, so the admin works at the
// root (/admin) and behind a path-stripping reverse proxy.
const API_BASE = `${location.pathname.replace(/\/+$/, '')}/api`;

const state = {
  secret: localStorage.getItem(LS_KEY) || '',
  bootstrapKey: new URLSearchParams(location.search).get('key') || '',
  hubIdentity: null,
  me: null,
  view: 'overview',
  people: null,
  peopleFilter: 'all',
  act: { kind: '', q: '', more: null, rows: [] },
  platform: false,
};

// DDR-053 §7: strip ?key= at once so it never sits in history or the bar.
if (state.bootstrapKey) history.replaceState({}, '', location.pathname);

function showOnly(id) {
  for (const s of all('main > section')) s.hidden = s.id !== id;
}

async function api(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (state.secret) headers.set('Authorization', `Bearer ${state.secret}`);
  if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    // A dead key is dropped; the session (if any) decides what is shown next.
    const hadKey = Boolean(state.secret);
    state.secret = '';
    localStorage.removeItem(LS_KEY);
    if (hadKey || state.me?.signedIn) void boot();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let message = text;
    try {
      message = JSON.parse(text)?.error ?? text;
    } catch {
      /* not JSON */
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  if (opts.raw) return res;
  return res.status === 204 ? null : res.json();
}
const post = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });
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
  if (left < 3_600_000) return `in ${Math.max(1, Math.floor(left / 60_000))}m`;
  if (left < 86_400_000) return `in ${Math.floor(left / 3_600_000)}h`;
  return `in ${Math.floor(left / 86_400_000)}d`;
}

function formatTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return new Date(ts).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(n) {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
const esc = escapeHtml;

// Avatar colour by class, never an inline style (the CSP drops those).
function avatar(name) {
  const n = String(name || '?');
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return `<span class="avatar avatar--${h % 6}" aria-hidden="true">${esc(n[0] || '?')}</span>`;
}
const who = (title, sub) =>
  `<span class="ad-who">${avatar(title)}<span class="ad-who-t"><strong>${esc(title)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</span></span>`;
const statusWord = (state_, word) => `<span class="ad-st ad-st--${state_}">${esc(word)}</span>`;
const btn = (label, attrs, cls = '') =>
  `<button type="button" class="btn btn--sm ${cls}" ${attrs}>${esc(label)}</button>`;

async function copyText(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    if (el) {
      const was = el.textContent;
      el.textContent = 'Copied';
      setTimeout(() => (el.textContent = was), 1500);
    }
    return true;
  } catch {
    return false;
  }
}

// -------------------------------- who is looking ---------------------------

async function boot() {
  if (state.bootstrapKey && !state.secret) {
    showOnly('bootstrap');
    void loadIdentityForBootstrapView();
    return;
  }
  let me;
  try {
    me = await api('/me');
  } catch {
    // A dead key was dropped and api() boots again without it. With no key at
    // all this is a cloud cell, where `/me` answers only the admin key.
    if (!state.secret) {
      $('onboard-signin').hidden = true;
      $('onboard-lede').textContent =
        'This project takes its people from its dashboard. The admin key opens this page.';
      all('#onboard details')[0].open = true;
      showOnly('onboard');
    }
    return;
  }
  state.me = me;
  for (const el of all('[data-hub-name]')) el.textContent = me.hub?.name || 'Team server';
  document.title = `${me.hub?.name || 'Team server'} · Admin`;
  if (me.admin) return showDash();
  if (me.signedIn) return showMember(me);
  // Nobody. Under cloud identity people are the dashboard's: only the key works here.
  $('onboard-signin').hidden = !me.selfService;
  if (!me.selfService) {
    $('onboard-lede').textContent =
      'This project takes its people from Maude Cloud. The admin key opens this page.';
    all('#onboard details')[0].open = true;
  }
  showOnly('onboard');
}

function showDash() {
  const me = state.me;
  showOnly('dash');
  $('auth-state').hidden = false;
  $('me-chip').textContent = me.via === 'key' ? 'Admin key' : `${me.email} · ${me.roleLabel}`;
  $('signout').hidden = me.via !== 'session';
  $('forget').hidden = !hasKey();
  renderLinkCards(me);
  setView(state.view);
  void refresh();
  void loadSettings();
}

/** "Link my sign-in" — offered when there is a provider and this account has none linked. */
function renderLinkCards(me) {
  for (const card of all('[data-link-card]')) {
    card.hidden = !me.canLink;
    if (!me.canLink) continue;
    card.querySelector('[data-link-text]').textContent =
      `Your account ${me.email} signs in with a password. Link it to ${me.provider} — use the same address. From then on you sign in there: the password stops working and your other sessions end.`;
    card.querySelector('[data-link-btn]').textContent = `Link my sign-in · ${me.provider}`;
  }
}

function showMember(me) {
  showOnly('member');
  const local = (me.email || '').split('@')[0].split(/[._+-]/)[0];
  const name = local.charAt(0).toUpperCase() + local.slice(1);
  $('member-me').textContent = `${me.email} · ${me.roleLabel}`;
  $('member-hello').textContent = `Hi ${name}.`;
  const hub = me.hub?.name || 'this team server';
  $('member-sub').textContent = me.access?.everything
    ? `You can edit everything on ${hub}.`
    : `You can edit some canvases on ${hub}.`;
  $('member-access').innerHTML = me.access?.everything
    ? `<div class="ad-row"><span>All projects — now and new ones</span>${statusWord('ok', 'Can edit')}</div>`
    : (me.access?.canvases ?? [])
        .map(
          (c) => `<div class="ad-row"><span>${esc(c)}</span>${statusWord('ok', 'Can edit')}</div>`
        )
        .join('') || '<p class="ad-quiet">Nothing yet.</p>';
  $('member-sessions').innerHTML =
    (me.sessions ?? [])
      .map(
        (s) =>
          `<div class="ad-row"><span>${s.kind === 'browser' ? 'A browser' : 'The Maude app'}${s.current ? ' · this one' : ''}</span><span class="ad-quiet">${esc(formatTime(s.lastUsedAt ?? s.createdAt))}</span></div>`
      )
      .join('') || '<p class="ad-quiet">Nowhere else.</p>';
  $('member-admins').innerHTML = me.runBy?.length
    ? `<p>${esc(me.runBy.join(', '))}</p><p class="ad-quiet">Ask them for access or to invite someone.</p>`
    : `<p class="ad-quiet">${me.admins} admin${me.admins === 1 ? '' : 's'} run it. Ask whoever invited you.</p>`;
  const dom = me.domains?.length ? `@${me.domains.join(', @')}` : '';
  $('member-join').innerHTML = `<p>${esc(
    me.whoCanJoin === 'domain' && dom
      ? `Anyone ${dom} can sign in and comes straight in.`
      : me.whoCanJoin === 'ask' && me.provider
        ? `Anyone ${dom || 'who can sign in'} can sign in and ask; an admin lets them in.`
        : 'An admin has to invite them.'
  )}</p><p class="ad-quiet">Only admins send invites.</p>`;
  renderLinkCards(me);
}

// DDR-053 §7: show the hub's identity on the claim screen (phishing defence).
async function loadIdentityForBootstrapView() {
  if (state.hubIdentity) return;
  try {
    const res = await fetch(`${API_BASE}/identity`);
    if (!res.ok) return;
    const id = await res.json();
    state.hubIdentity = id;
    const row = (k, v, cls = '') =>
      `<div class="fp-row"><span class="fp-k">${k}</span><span class="fp-v ${cls}">${esc(v)}</span></div>`;
    $('bootstrap-identity').innerHTML =
      row('Claiming', id.publicUrl) +
      row('Fingerprint', id.hostFingerprint, 'fp-hash') +
      (id.version ? row('Version', id.version) : '');
  } catch {
    /* informational */
  }
}

// -------------------------------- refresh ----------------------------------

async function refresh() {
  if (!state.me?.admin) return;
  try {
    const [status, overview, canvases] = await Promise.all([
      api('/status'),
      api('/overview'),
      api('/canvases'),
    ]);
    applyPlatformPosture(status);
    renderStatus(status);
    renderOverview(overview);
    renderCanvases(canvases);
    // People must not blank the rest of the page when it fails.
    await loadPeople().catch((e) => console.warn('[hub-admin] people:', e.message));
    if (state.view === 'activity' && !state.act.paged) await loadActivity();
    if (hasKey() && $('advanced').open) await loadAdvanced();
  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('[hub-admin] refresh failed:', err.message);
  }
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
  for (const b of all('[data-invite]')) b.hidden = platform;
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
  $('s-version').textContent = s.version;
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
    $('s-backups').textContent = '—';
    $('s-backup-prefix').textContent = '—';
    alert.hidden = true;
    return;
  }
  $('s-backup-prefix').textContent = d.prefix ?? '(bucket root)';
  const when = d.lastOkAt ? ` · last ${formatDuration(Date.now() - d.lastOkAt)} ago` : '';
  const label = {
    'not-configured': 'not set up',
    pending: 'set up, no backup yet',
    ok: `working${when}`,
    failed: 'FAILING',
    'identity-conflict': 'TURNED OFF — another server uses this place',
  };
  $('s-backups').textContent = label[d.state] ?? d.state;
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
 */
function renderRelease(s) {
  const el = $('nav-hub-version');
  const ver = s.releaseVersion || s.version;
  const client = s.studio?.client?.artifacts?.['dist/client.bundle.js'];
  el.textContent = ver ? (client ? `v${ver} · ${client}` : `v${ver}`) : '';
  el.title = client ? `release v${ver}, serving client.bundle.js ${client}` : '';
}

// -------------------------------- overview ---------------------------------

const EVENT_WORDS = {
  login: 'signed in from the Maude app',
  logout: 'signed out',
  'signin-browser': 'signed in',
  'oidc-signin': 'signed in',
  'oidc-pending': 'signed in and asks to join',
  'oidc-refused': 'was turned away at sign-in',
  'oidc-domain-join': 'joined — colleagues come straight in',
  'oidc-self-link': 'linked their sign-in',
  'invite-redeem': 'joined from an invite',
  'invite-create': 'invited',
  'invite-reissue': 'made a new invite link for',
  'invite-revoke': 'cancelled the invite for',
  'role-change': 'changed',
  'user-create': 'added',
  'user-disable': 'turned off',
  'user-enable': 'turned back on',
  'user-delete': 'removed',
  'user-password': 'reset the password of',
  'user-signout': 'signed out',
  'oidc-approve': 'let in',
  'oidc-link': 'linked a sign-in to',
  'oidc-dismiss': 'dismissed the request of',
  settings: 'changed settings',
  token: 'made the token',
  'token-rotate': 'replaced the token',
  'token-delete': 'deleted the token',
  'secret-rotate': 'changed the admin key',
  backup: '',
  kick: 'disconnected',
};
const AREA_WORDS = { people: 'People', signin: 'Sign-in', settings: 'Settings', server: 'Server' };

/** One kept event as a sentence. Every field is escaped; the log holds no secrets. */
function eventText(e) {
  const verb = EVENT_WORDS[e.kind] ?? e.kind;
  const self = !e.target || e.target === e.actor;
  const about = self ? '' : ` <strong>${esc(e.target)}</strong>`;
  // A server event (a backup) has no verb: its detail is the sentence.
  if (!verb) return esc(e.detail);
  const detail = e.detail ? ` <span class="ad-quiet">· ${esc(e.detail)}</span>` : '';
  return `${esc(verb)}${about}${detail}`;
}

function renderOverview(o) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const bad = o.health.filter((h) => h.state === 'bad').length;
  $('ov-hello').textContent =
    `${hello}. ${bad ? 'Something needs a look.' : 'Everything is running.'}`;
  $('ov-sub').textContent = o.health
    .map(
      (h) =>
        `${h.label}: ${h.at ? `${h.value.toLowerCase()} ${formatTime(h.at).toLowerCase()}` : h.value}`
    )
    .join(' · ');

  const n = state.platform ? 0 : o.needs.length;
  $('ov-needs-n').textContent = n;
  $('ov-needs-t').textContent =
    n === 1 ? 'thing needs you' : n ? 'things need you' : 'Nothing needs you';
  $('ov-needs-n').hidden = n === 0;
  $('ov-needs-rows').innerHTML = state.platform
    ? ''
    : o.needs
        .map((x) =>
          x.type === 'request'
            ? `<div class="ad-need" data-testid="need-request">${avatar(x.email)}<span class="ad-need-t"><strong>${esc(x.email ?? 'Someone')} asks to join</strong><span>Signed in ${esc(formatTime(x.since).toLowerCase())}${o.signIn?.provider ? ` with ${esc(o.signIn.provider)}` : ''} — nobody has invited them yet</span></span><span class="ad-acts">${btn('Dismiss', `data-dismiss="${esc(x.sub)}"`, 'btn--ghost')}${btn('Let in · Can edit', `data-letin="${esc(x.sub)}" data-testid="need-letin"`, 'btn--primary')}</span></div>`
            : `<div class="ad-need" data-testid="need-invite">${avatar(x.email ?? '?')}<span class="ad-need-t"><strong>${esc(x.email ?? 'A one-time link')} hasn't opened the invite</strong><span>Made ${esc(formatTime(x.since).toLowerCase())} · the link works ${esc(formatUntil(x.expiresAt).replace('in ', 'for '))} more</span></span><span class="ad-acts">${btn('Copy new link', `data-reissue="${esc(x.id)}"`)}</span></div>`
        )
        .join('');
  wirePeopleActions($('ov-needs-rows'));

  const c = o.counts;
  $('stat-people').textContent = c.people;
  $('stat-people-f').textContent = [
    c.invited ? `${c.invited} invited` : '',
    c.asks ? `${c.asks} ask${c.asks === 1 ? 's' : ''} to join` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  $('stat-here').textContent = c.hereNow;
  $('stat-here-f').textContent = o.hereNow.map((e) => e.split('@')[0]).join(', ');
  $('stat-canvases').textContent = c.canvases;
  $('stat-changes').textContent = c.changesThisWeek;

  $('ov-health').innerHTML = o.health
    .map(
      (h) =>
        `<div class="ad-hl" data-testid="health-${esc(h.key)}"><span>${esc(h.label)}</span><strong>${esc(h.value)}${h.at ? ` · ${esc(formatTime(h.at))}` : ''}</strong>${statusWord(h.state === 'off' ? 'off' : h.state, h.word)}</div>`
    )
    .join('');
  $('ov-activity-feed').innerHTML =
    o.recent
      .map(
        (e) =>
          `<div class="ad-row"><span><strong>${esc(e.actor || 'Server')}</strong> ${eventText(e)}</span><span class="ad-quiet td-num">${esc(formatTime(e.at))}</span></div>`
      )
      .join('') || '<p class="ad-quiet">Nothing yet.</p>';
  $('activity-sub').textContent =
    `Kept for ${o.retentionDays} days · ${c.changesThisWeek} this week`;
}

// ------------------------------------------------------------------- people
//
// ONE list. Accounts, people who signed in and ask to join, and open invites
// are rows of the same table; the status word says where each one is.

async function loadPeople() {
  if (state.platform) return;
  state.people = await api('/people');
  renderPeople();
}

function rowActions(p) {
  if (p.kind === 'request') {
    const sub = esc(p.sub);
    return (
      btn('Dismiss', `data-dismiss="${sub}" data-testid="person-dismiss"`, 'btn--ghost') +
      btn('Let in', `data-letin="${sub}" data-testid="person-letin"`, 'btn--primary')
    );
  }
  if (p.kind === 'invite') {
    const id = esc(p.id);
    const label = esc(p.email ?? 'a one-time link');
    return (
      btn('Copy new link', `data-reissue="${id}" data-testid="invite-reissue"`, 'btn--ghost') +
      `<button type="button" class="btn btn--sm btn--ghost" data-revoke="${id}" data-testid="invite-revoke" title="Cancel this invitation" aria-label="Revoke the invitation for ${label}"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>`
    );
  }
  return p.status === 'off'
    ? btn('Turn back on', `data-turnon="${esc(p.id)}" data-testid="person-turnon"`, 'btn--ghost')
    : btn('Open', `data-open="${esc(p.key)}" data-testid="person-open"`, 'btn--ghost');
}

function renderPeople() {
  const d = state.people;
  if (!d) return;
  const c = d.counts;
  $('pc-all').textContent = c.everyone;
  $('pc-asks').textContent = c.asks || '';
  $('pc-invited').textContent = c.invited || '';
  $('pc-off').textContent = c.off || '';
  $('nav-count-people').textContent = c.asks || '';
  $('people-sub').textContent =
    `${c.people} ${c.people === 1 ? 'person' : 'people'} · who can come in is set in Settings › Who can join`;
  const q = $('people-find').value.trim().toLowerCase();
  const f = state.peopleFilter;
  const rows = d.people.filter(
    (p) =>
      (f === 'all' || p.status === f) &&
      (!q || `${p.email ?? ''} ${p.roleLabel} ${p.statusLabel}`.toLowerCase().includes(q))
  );
  const tone = { online: 'ok', away: 'off', off: 'off', invited: 'warn' };
  $('people-rows').innerHTML = rows.length
    ? rows
        .map((p) => {
          const st =
            p.status === 'asks'
              ? `<span class="ad-chip">${esc(p.statusLabel)}</span>`
              : statusWord(tone[p.status] ?? 'off', p.statusLabel);
          const seen =
            p.kind === 'invite'
              ? 'Not yet'
              : p.status === 'online'
                ? 'Now'
                : formatTime(p.lastSeen);
          const n = p.sessions.length;
          return (
            `<tr class="is-row${p.status === 'asks' ? ' is-hl' : ''}${p.status === 'off' ? ' is-dim' : ''}" data-key="${esc(p.key)}" data-testid="person-row">` +
            `<td>${who(p.email ?? 'Anyone with the link', p.kind === 'account' && n ? `signed in on ${n} device${n === 1 ? '' : 's'}` : '')}</td>` +
            `<td>${esc(p.roleLabel)}</td><td data-testid="person-status">${st}</td>` +
            `<td class="td-num">${esc(seen)}</td>` +
            `<td><span class="ad-acts">${rowActions(p)}</span></td></tr>`
          );
        })
        .join('')
    : '<tr class="empty"><td colspan="5">Nobody here.</td></tr>';
  const tbody = $('people-rows');
  wirePeopleActions(tbody);
  for (const tr of all('tr[data-key]', tbody)) {
    tr.addEventListener('click', (e) => {
      if (!e.target.closest('button')) openPerson(tr.dataset.key);
    });
  }
}

/** Run one People change, then redraw. Errors are said in words, in place. */
async function act(fn) {
  try {
    await fn();
  } catch (err) {
    if (err.message !== 'Unauthorized') alert(err.message);
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
  on('letin', (sub) => act(() => post('/people/let-in', { sub, role: 'member' })));
  on('dismiss', (sub) => act(() => post('/people/dismiss', { sub })));
  on('reissue', (id, b) =>
    act(async () => {
      const r = await post('/people/invite/reissue', { id });
      if (!(await copyText(r.url, b))) showSecret(r.url, r.email ?? 'a one-time link');
    })
  );
  on('revoke', (id) => act(() => post('/people/invite/revoke', { id })));
  on('turnon', (id) => act(() => post('/people/turn-on', { id })));
  on('open', (key) => openPerson(key));
}

// ---- the person sheet: everything about one person, changed in place ----

async function openPerson(key) {
  const p = state.people?.people.find((x) => x.key === key);
  if (!p) return;
  const sheet = $('person-sheet');
  $('person-error').hidden = true;
  const body = $('person-body');
  const actions = $('person-actions');
  const head = `<div class="stack stack--4">${who(p.email ?? 'Anyone with the link', p.statusLabel)}`;
  const done =
    '<span class="ad-sp"></span><button type="button" class="btn btn--primary" data-close>Done</button>';

  if (p.kind === 'request') {
    // The link action keys on the SUBJECT and the admin types the address:
    // offering "link to <claimed address>" would be the address→account
    // guess the sign-in path refuses to make.
    const sub = esc(p.sub);
    body.innerHTML = `${head}<p class="ad-quiet">Signed in ${esc(formatTime(p.createdAt).toLowerCase())} and has no account here. Nobody invited this address.</p>
      <div class="field"><label class="field-label" for="letin-role">Let in as</label><select id="letin-role" class="input"><option value="member">Can edit</option><option value="admin">Admin</option></select></div>
      <p class="field-help">Already has an account here? ${
        hasKey()
          ? `<button type="button" class="ad-link" data-link="${sub}">Link to an existing account</button> — its password stops working and its sessions end.`
          : 'They sign in with its password and choose Link my sign-in. (Linking for someone else needs the admin key.)'
      }</p></div>`;
    actions.innerHTML = `${btn('Dismiss', `data-x="dismiss"`, 'btn--ghost')}<span class="ad-sp"></span><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn btn--primary" data-approve="${sub}" data-testid="sheet-letin">Let in</button>`;
    actions
      .querySelector('[data-approve]')
      .addEventListener('click', () =>
        sheetAct(() => post('/people/let-in', { sub: p.sub, role: $('letin-role').value }))
      );
    actions
      .querySelector('[data-x="dismiss"]')
      .addEventListener('click', () => sheetAct(() => post('/people/dismiss', { sub: p.sub })));
    body.querySelector('[data-link]')?.addEventListener('click', () => linkPending(p.sub));
  } else if (p.kind === 'invite') {
    body.innerHTML = `${head}<div class="ad-row"><span>They can</span><strong>${esc(p.roleLabel)}</strong></div><div class="ad-row"><span>The link works</span><strong>${esc(formatUntil(p.expiresAt))}</strong></div><p class="field-help">The link was shown once when the invite was made. "Copy new link" makes a fresh one; the old one stops working.</p></div>`;
    actions.innerHTML = `${btn('Cancel invite', 'data-x="revoke"', 'btn--danger')}${btn('Copy new link', 'data-x="reissue"')}${done}`;
    actions
      .querySelector('[data-x="revoke"]')
      .addEventListener('click', () => sheetAct(() => post('/people/invite/revoke', { id: p.id })));
    actions.querySelector('[data-x="reissue"]').addEventListener('click', (e) =>
      sheetAct(async () => {
        const r = await post('/people/invite/reissue', { id: p.id });
        if (!(await copyText(r.url, e.target))) showSecret(r.url, p.email ?? 'a one-time link');
      }, false)
    );
  } else {
    const off = p.status === 'off';
    const seg = (role, label) =>
      `<button type="button" data-role="${role}" aria-pressed="${p.role === role}" data-testid="role-${role}">${label}</button>`;
    const kinds = { browser: 'A browser', app: 'The Maude app', token: 'A token' };
    body.innerHTML = `${head}
      <div class="field"><span class="field-label">Can</span><span class="ad-seg" id="person-role">${seg('member', 'Can edit')}${seg('admin', 'Admin')}</span>
      <span class="field-help">Changes at once: this person is signed out everywhere and signs in again with the new role.${p.canvases ? ` Has ${p.canvases} canvas${p.canvases === 1 ? '' : 'es'} only.` : ''}</span></div>
      <div><h4>Signed in on</h4>${
        p.sessions
          .map(
            (s) =>
              `<div class="ad-row"><span>${kinds[s.kind]} <span class="ad-quiet">· ${s.live ? 'now' : esc(formatTime(s.lastUsedAt ?? s.createdAt).toLowerCase())}</span></span>${btn('Sign out', `data-signout-label="${esc(s.label)}"`, 'btn--ghost')}</div>`
          )
          .join('') || '<p class="ad-quiet">Nowhere right now.</p>'
      }</div>
      <div><h4>Lately</h4><div id="person-lately" data-testid="person-lately"><p class="ad-quiet">…</p></div></div>
      <p class="field-help">${p.linked ? `Signs in with ${esc(state.people.signIn.provider ?? 'the provider')}.` : 'Signs in with a password.'}</p></div>`;
    actions.innerHTML =
      (off
        ? btn('Turn back on', 'data-x="turn-on" data-testid="sheet-turnon"')
        : btn('Turn off', 'data-x="turn-off" data-testid="sheet-turnoff"')) +
      btn('Remove', 'data-x="remove" data-testid="sheet-remove"', 'btn--danger') +
      // Setting a password is key-only: a session must not be able to leave one behind.
      (hasKey() && state.people.signIn.passwords
        ? btn('Reset password', 'data-pw="1"', 'btn--ghost')
        : '') +
      done;
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
    // The same kept log, narrowed to this person — by account id, so no address is in a URL.
    api(`/activity?who=${encodeURIComponent(p.id)}&limit=6`)
      .then((a) => {
        $('person-lately').innerHTML =
          a.events
            .map(
              (e) =>
                `<div class="ad-row"><span>${e.actor === p.email ? 'They ' : `<strong>${esc(e.actor || 'Server')}</strong> `}${eventText({ ...e, target: e.target === p.email ? '' : e.target })}</span><span class="ad-quiet td-num">${esc(formatTime(e.at))}</span></div>`
            )
            .join('') || '<p class="ad-quiet">Nothing yet.</p>';
      })
      .catch(() => {});
  }
  if (!sheet.open) sheet.showModal();
}

/** A change made from a sheet: errors stay in the sheet; success closes it (unless told not to). */
async function sheetAct(fn, close = true) {
  const err = $('person-error');
  err.hidden = true;
  try {
    await fn();
    if (close) $('person-sheet').close();
  } catch (e) {
    if (e.message === 'Unauthorized') return;
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
  await sheetAct(() => post('/oidc/link', { sub, email: email.trim() }));
}

async function resetPassword(email) {
  const password = prompt(`New password for ${email} (at least 12 characters)`);
  if (!password) return;
  await sheetAct(() => post('/users/password', { email, password }), false);
}

// ---- the invite sheet ----

function openInvite() {
  const s = state.people?.signIn;
  const hub = state.me?.hub?.name || 'this team server';
  $('invite-sheet-t').textContent = `Invite people to ${hub}`;
  $('invite-sheet-s').textContent = s?.provider
    ? `They sign in with ${s.provider} — the invite lets them straight in.`
    : 'They open the link, choose a password, and are in.';
  $('invite-promise').textContent = s?.provider
    ? `No approving afterwards. They open the link, continue with ${s.provider}${s.domains?.length ? ` (@${s.domains.join(', @')})` : ''}, and are in — in the browser and in the Maude app.`
    : 'No approving afterwards. Whoever opens the link is in.';
  $('invite-results').innerHTML = '';
  $('person-invite-error').hidden = true;
  $('invite-sheet').showModal();
  $('person-invite-email').focus();
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
          ? `<div class="ad-row" data-testid="invite-result"><span><strong>${esc(i.email ?? 'Anyone with the link')}</strong><br><span class="ad-url">${esc(i.url)}</span></span>${btn('Copy link', `data-copy="${n}"`)}</div>`
          : `<div class="ad-row" data-testid="invite-result-error"><span><strong>${esc(i.email)}</strong></span>${statusWord('bad', i.error)}</div>`
      )
      .join('');
    for (const b of all('[data-copy]', $('invite-results'))) {
      b.addEventListener('click', () => copyText(r.invites[Number(b.dataset.copy)].url, b));
    }
    if (r.invites.some((i) => i.ok)) $('person-invite-email').value = '';
  } catch (e) {
    if (e.message !== 'Unauthorized') {
      err.textContent = e.message;
      err.hidden = false;
    }
  }
  await refresh();
}

// -------------------------------- projects ---------------------------------

function renderCanvases(c) {
  const rows = c.canvases || [];
  $('canvases-context').textContent =
    `${rows.length} canvas${rows.length === 1 ? '' : 'es'} saved on this team server.`;
  $('canvases-rows').innerHTML = rows.length
    ? rows
        .map(
          (r) =>
            `<tr><td>${esc(r.name)}</td><td class="td-num">${esc(formatBytes(r.bytes))}</td><td>${statusWord(r.peers ? 'ok' : 'off', r.peers ? `${r.peers} open` : 'Nobody')}</td></tr>`
        )
        .join('')
    : '<tr class="empty"><td colspan="3">No canvases yet.</td></tr>';
}

// -------------------------------- activity ---------------------------------

const activityQuery = (extra = '') => {
  const a = state.act;
  return `?kind=${encodeURIComponent(a.kind)}&q=${encodeURIComponent(a.q)}${extra}`;
};

async function loadActivity(older = false) {
  const a = state.act;
  const data = await api(`/activity${activityQuery(older && a.more ? `&before=${a.more}` : '')}`);
  a.rows = older ? a.rows.concat(data.events) : data.events;
  // Once older rows are shown the 5 s refresh leaves the list alone.
  a.paged = older;
  a.more = data.events.length >= 100 ? data.more : null;
  $('activity-more').hidden = !a.more;
  $('activity-rows').innerHTML = a.rows.length
    ? a.rows
        .map(
          (e) =>
            `<tr data-testid="activity-row"><td class="td-num">${esc(formatTime(e.at))}</td><td>${who(e.actor || 'Server')}</td><td>${eventText(e)}</td><td class="ad-quiet">${esc(AREA_WORDS[e.area] ?? e.area)}</td></tr>`
        )
        .join('')
    : '<tr class="empty"><td colspan="4">Nothing here.</td></tr>';
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
    $('join-provider').textContent = p.provider
      ? `${p.provider}${dom ? ` · ${dom}` : ''}`
      : 'Passwords only';
    $('join-provider').className = `ad-st ad-st--${p.provider ? 'ok' : 'off'}`;
    // Without a provider nobody can arrive uninvited: the rule has nothing to decide.
    for (const r of all('input[name="whoCanJoin"]')) r.disabled = !p.provider || state.platform;
    $('join-ask-sub').textContent =
      `Anyone ${dom || 'who signs in'} can ask; you see it under "needs you".`;
    $('join-domain-sub').textContent = `Anyone ${dom || 'who signs in'} joins as Can edit.`;
    if (!p.provider) {
      $('join-status').textContent =
        'People sign in with a password here, so only an invitation or an account you add lets someone in.';
    }
  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('[hub-admin] settings:', err.message);
  }
}

async function saveSettings(body, statusEl, errorEl) {
  errorEl.hidden = true;
  try {
    const saved = await post('/settings', { name: $('set-name').value, ...body });
    statusEl.textContent = 'Saved.';
    setTimeout(() => (statusEl.textContent = ''), 2000);
    for (const el of all('[data-hub-name]')) el.textContent = saved.name;
  } catch (err) {
    if (err.message === 'Unauthorized') return;
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    void loadSettings();
  }
}

// ---- Advanced: tokens, connected sessions, the admin key — key-only ----

async function loadAdvanced() {
  $('adv-key-form').hidden = hasKey();
  $('adv-body').hidden = !hasKey();
  if (!hasKey()) return;
  try {
    const [tokens, peers] = await Promise.all([api('/tokens'), api('/peers')]);
    renderTokens(tokens, peers.peers);
    renderPeers(peers);
  } catch (err) {
    if (err.message !== 'Unauthorized') console.warn('[hub-admin] advanced:', err.message);
  }
}

function renderTokens(t, peers) {
  const tbody = $('tokens-rows');
  const live = new Map();
  for (const p of peers) live.set(p.user, (live.get(p.user) ?? 0) + 1);
  // A person's sign-in is a token too (`studio-…` in a browser, `u-…` in the
  // Maude app). Those are People's to show and end, not this list's.
  const rows = t.tokens.filter((r) => !/^(studio-|u-[0-9a-f]{12}$)/.test(r.label));
  tbody.innerHTML = rows.length
    ? rows
        .map((r) => {
          const lbl = esc(r.label);
          const n = live.get(r.label) ?? 0;
          return (
            `<tr><td>${lbl}${r.dev ? ' <code>dev</code>' : ''}</td>` +
            `<td>${!r.scope || r.scope === '*' ? 'every canvas' : esc(r.scope)}</td>` +
            `<td class="td-num">${n ? `${n} connected` : esc(formatTime(r.lastUsedAt))}</td>` +
            `<td><span class="ad-acts"><button type="button" class="btn btn--ghost btn--sm" data-rotate="${lbl}">Replace</button>` +
            `<button type="button" class="btn btn--danger btn--sm" data-delete="${lbl}" aria-label="Delete token ${lbl}"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg></button></span></td></tr>`
          );
        })
        .join('')
    : '<tr class="empty"><td colspan="4">No tokens.</td></tr>';
  for (const b of all('button[data-rotate]', tbody))
    b.addEventListener('click', () => rotate(b.dataset.rotate));
  for (const b of all('button[data-delete]', tbody))
    b.addEventListener('click', () => deleteToken(b.dataset.delete));
}

function renderPeers(p) {
  const tbody = $('peers-rows');
  tbody.innerHTML = p.peers.length
    ? p.peers
        .map(
          (peer) =>
            `<tr><td>${esc(peer.documentName)}</td><td>${esc(peer.user || 'anon')}</td>` +
            `<td><span class="ad-acts"><button type="button" class="btn btn--ghost btn--sm" data-kick="${esc(peer.socketId)}">Disconnect</button></span></td></tr>`
        )
        .join('')
    : '<tr class="empty"><td colspan="3">Nobody is connected.</td></tr>';
  for (const b of all('button[data-kick]', tbody))
    b.addEventListener('click', () => kickPeer(b.dataset.kick));
}

async function advAct(question, fn) {
  if (question && !confirm(question)) return;
  try {
    await fn();
  } catch (err) {
    if (err.message !== 'Unauthorized') alert(err.message);
  }
  await loadAdvanced();
}
const rotate = (label) =>
  advAct(`Replace token "${label}"? The old value stops working at once.`, async () =>
    showInvite(await post('/token/rotate', { label }), label)
  );
const deleteToken = (label) =>
  advAct(`Delete token "${label}"? Anything using it is disconnected. This can't be undone.`, () =>
    post('/token/delete', { label })
  );
const kickPeer = (socketId) =>
  advAct('Disconnect this session? It can reconnect with a valid token.', () =>
    post('/peers/kick', { socketId })
  );

/** The one "shown once" surface — a peer token's command, or a link. */
function showInvite({ token, command, scope }, label) {
  $('token-command').textContent = command;
  $('token-raw').textContent = token;
  $('token-modal-title').textContent = label ? `Ready — for "${label}"` : 'Ready';
  const sc = scope ?? '*';
  $('token-scope').textContent = sc === '*' ? 'REACH · every canvas' : `REACH · ${sc}`;
  $('token-modal-stamp').textContent =
    `${new Date().toISOString().replace('T', ' ').slice(0, 16)}Z`;
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
  if (name === 'activity') void loadActivity().catch(() => {});
}

function pressTab(group, button) {
  for (const b of all('.ad-tab', group)) b.setAttribute('aria-pressed', String(b === button));
}

// -------------------------------- wire -------------------------------------

async function useKey(input, errorEl) {
  const secret = input.value.trim();
  if (!secret) return;
  errorEl.hidden = true;
  const before = state.secret;
  state.secret = secret;
  try {
    const res = await fetch(`${API_BASE}/status`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok)
      throw new Error(res.status === 401 ? 'That is not the admin key.' : `HTTP ${res.status}`);
    localStorage.setItem(LS_KEY, secret);
    input.value = '';
    await boot();
    if ($('advanced').open) void loadAdvanced();
  } catch (err) {
    state.secret = before;
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
    localStorage.setItem(LS_KEY, secret);
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
    showInvite(await post('/token', body), label);
    $('invite-label').value = '';
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
$('invite-open-link').addEventListener('click', () => void makeInvites([]));
for (const b of all('[data-invite]')) b.addEventListener('click', openInvite);
for (const d of all('dialog.ad-sheet')) {
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
}

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

$('rotate-admin').addEventListener('click', async () => {
  if (
    !confirm(
      'Change the admin key? Every browser using the current key is signed out of it, and the key has to be set up again (a new bootstrap link, or HUB_SECRET). This cannot be undone.'
    )
  )
    return;
  $('danger-error').hidden = true;
  try {
    await post('/admin-secret/rotate');
    state.secret = '';
    localStorage.removeItem(LS_KEY);
    await boot();
  } catch (err) {
    if (err.message === 'Unauthorized') return;
    $('danger-error').textContent = err.message;
    $('danger-error').hidden = false;
  }
});

$('forget').addEventListener('click', () => {
  localStorage.removeItem(LS_KEY);
  state.secret = '';
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

for (const item of all('.nav-item'))
  item.addEventListener('click', () => setView(item.dataset.view));
for (const link of all('[data-nav]'))
  link.addEventListener('click', () => setView(link.dataset.nav));

for (const b of all('#people-tabs .ad-tab')) {
  b.addEventListener('click', () => {
    state.peopleFilter = b.dataset.filter;
    pressTab($('people-tabs'), b);
    renderPeople();
  });
}
$('people-find').addEventListener('input', renderPeople);

for (const b of all('#activity-tabs .ad-tab')) {
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
$('activity-csv').addEventListener(
  'click',
  () => void downloadCsv().catch((e) => alert(e.message))
);
$('advanced').addEventListener('toggle', () => void loadAdvanced());

void boot();
setInterval(() => {
  if (state.me?.admin && !document.hidden && !document.querySelector('dialog[open]'))
    void refresh();
}, 5000);
