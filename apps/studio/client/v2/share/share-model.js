// client/v2/share/share-model.js — S9.19: the Share sheet's words and its one view model (10
// co-share-sheet · co-share-roles; V2-1.7 §5.1 / §5.9; S9-slices Q13).
//
// PURE (no DOM, no React). The sheet renders what the server REPORTS, never a guess:
//   · the role list, the scope segment, the link row and the request block come from the project
//     server's `/health.access` posture (`GET /_api/share/posture`). Until the lead flips `roles-v2`
//     (Q13) a cloud cell reports `roles: [viewer, member, owner], scopes: [project], links: false`, so
//     Can view, This canvas and the link row are simply not drawn on that hub;
//   · whether this person may invite comes from `GET /_api/share/me` (`caps.invite`), and only when
//     the hub cannot be asked from the claim this Mac holds (the posture's `you`). Hiding is a
//     courtesy: the hub refuses whatever a patched client sends (routes/share.ts asks first, too).
//   · the people list is the hub's answer, filtered there by the caller's role (V2-1.16 L17): a
//     non-owner gets no e-mail and no pending invitation, so there is nothing to hide here.

/** V2-1.7 §5.1 — the UI words for the wire ids (ids are never shown), strongest first. */
export const ROLE_WORDS = Object.freeze({
  owner: { word: 'Owner', line: 'Owners also invite people and clear out the trash' },
  member: { word: 'Can edit', line: 'Change artboards, draw, use AI, move to the trash' },
  viewer: { word: 'Can comment', line: 'Look, comment and download' },
  observer: { word: 'Can view', line: 'Look only' },
});

/** Strongest first — the order the role menu and the invite select list them. */
export const ROLE_ORDER = Object.freeze(['owner', 'member', 'viewer', 'observer']);

export const roleWord = (role) => ROLE_WORDS[role]?.word ?? '';

/** The roles an invite (or a role change) may give — never `owner` (making an owner is its own row). */
export const GRANTABLE = Object.freeze(['member', 'viewer', 'observer']);

/**
 * S9.20b (decision v2-lead-new-people-join-as-client-default) — "New people join as": the role the
 * Invite row pre-selects, remembered per project in THIS browser. A convenience only: the hub has no
 * default-role field, and every invite still sends its explicit role, which the server checks.
 * Storage may be missing or throw (private window, blocked site data) — then it is Can edit.
 */
const JOIN_AS_PREFIX = 'maude.share.join-as:';
export const JOIN_AS_FALLBACK = 'member';

/** The storage key for one project: its hub address when linked, else its name. */
export function joinAsKey({ hub, project } = {}) {
  const id = (typeof hub === 'string' && hub) || (typeof project === 'string' && project) || '';
  return id ? `${JOIN_AS_PREFIX}${id}` : null;
}

/** The remembered role, if it is one an invite may give; else Can edit. */
export function readJoinAs(key, storage = globalThis.localStorage) {
  if (!key) return JOIN_AS_FALLBACK;
  try {
    const v = storage?.getItem(key);
    return GRANTABLE.includes(v) ? v : JOIN_AS_FALLBACK;
  } catch {
    return JOIN_AS_FALLBACK;
  }
}

export function writeJoinAs(key, role, storage = globalThis.localStorage) {
  if (!key || !GRANTABLE.includes(role)) return;
  try {
    storage?.setItem(key, role);
  } catch {
    /* storage blocked: the choice lasts while the sheet is open */
  }
}

/** The newest sync the runtime knows (`/_sync-status` `lastSyncAt`), or null — never a guess. */
export function lastSyncedAt(status) {
  const t = status?.linked === false ? null : status?.lastSyncAt;
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null;
}

/**
 * The posture to draw when the hub cannot be asked: the narrowest one every hub supports (a
 * self-hosted hub's), so nothing is offered that a hub could not hold.
 */
export const FALLBACK_ACCESS = Object.freeze({
  authority: 'hub',
  roles: Object.freeze(['member', 'owner']),
  scopes: Object.freeze(['project']),
  links: false,
  requests: false,
});

function cleanAccess(access) {
  if (!access || typeof access !== 'object') return FALLBACK_ACCESS;
  const roles = Array.isArray(access.roles) ? access.roles.filter((r) => r in ROLE_WORDS) : [];
  const scopes = Array.isArray(access.scopes)
    ? access.scopes.filter((s) => s === 'project' || s === 'canvas')
    : [];
  return {
    authority: access.authority === 'control-plane' ? 'control-plane' : 'hub',
    roles: roles.length ? roles : FALLBACK_ACCESS.roles,
    scopes: scopes.length ? scopes : FALLBACK_ACCESS.scopes,
    links: access.links === true,
    requests: access.requests === true,
  };
}

/**
 * Everything the sheet decides, in one place.
 *
 * @param {{ posture?: object|null, me?: object|null, target?: { rel?: string|null, label?: string },
 *           project?: string, scope?: 'canvas'|'project' }} input
 */
export function sheetView({ posture, me, target, project, scope } = {}) {
  const linked = posture?.linked === true;
  const reachable = linked && posture?.reachable !== false;
  const access = cleanAccess(reachable ? posture?.access : null);
  const canvasRel = target?.rel || null;
  const canvasScope = access.scopes.includes('canvas') && !!canvasRel;
  const current = canvasScope && scope !== 'project' ? 'canvas' : 'project';
  // The hub's caps win; the claim this Mac holds speaks only when the hub cannot be asked.
  const canInvite = linked && (me?.caps ? me.caps.invite === true : posture?.you?.invite === true);
  const grantable = GRANTABLE.filter((r) => access.roles.includes(r));
  return {
    linked,
    reachable,
    access,
    canInvite,
    /** The scope segment — only where the server holds canvas grants (Q13: hidden before the flip). */
    showScope: canvasScope,
    scope: current,
    /** The hub's `canvas` for this scope (designRoot-relative), or null for the whole project. */
    canvas: current === 'canvas' ? canvasRel : null,
    scopeName: current === 'canvas' ? target?.label || canvasRel : project || 'this project',
    title: `Share ${target?.label || project || 'this project'}`,
    inviteRoles: grantable,
    defaultInviteRole: grantable.includes('member') ? 'member' : (grantable[0] ?? 'member'),
    /** Role-menu rows for a person (never a pending row). */
    menuRoles: grantable,
    /**
     * Make owner is hidden until an ownership-transfer route exists (decision v2-lead-make-owner-hidden):
     * both authorities refuse it (owner-immutable; transfer is its own step), so the item would always
     * fail. The menu code, its testid and its words stay; turn this back on with the route.
     */
    makeOwner: false,
    // Link rules are for whoever can change who gets in; the hub's own answer (`me.caps.edit`) says a
    // read-only session cannot, and then the row is left out (S11.15, 06 · ad-edge-where).
    showLinkRow: access.links && !(me?.caps && me.caps.edit === false),
    showRequests: access.requests,
  };
}

const DAY = 86_400_000;

/** "expires in 5 days" — relative first (CONTRACT §4). */
export function expiresIn(expiresAt, now = Date.now()) {
  const at = typeof expiresAt === 'number' ? expiresAt : Date.parse(String(expiresAt ?? ''));
  if (!Number.isFinite(at)) return '';
  const days = Math.ceil((at - now) / DAY);
  if (days <= 0) return 'expires today';
  if (days === 1) return 'expires tomorrow';
  return `expires in ${days} days`;
}

const rank = (r) => {
  const i = ROLE_ORDER.indexOf(r?.role);
  return i === -1 ? ROLE_ORDER.length : i;
};

/**
 * The list the sheet draws: people first (strongest role first, then by name), invitations after.
 * Requests are S9.21's request block, not rows here. `youEmail` marks the signed-in person.
 */
export function peopleRows(people, { youEmail, now = Date.now() } = {}) {
  const you = typeof youEmail === 'string' ? youEmail.toLowerCase() : null;
  const rows = (Array.isArray(people) ? people : [])
    .filter((p) => p && typeof p.id === 'string' && p.state !== 'requested')
    .map((p) => {
      const invited = p.state === 'invited';
      const isYou =
        !invited && !!you && typeof p.email === 'string' && p.email.toLowerCase() === you;
      return {
        id: p.id,
        name: isYou ? 'You' : String(p.name || p.email || ''),
        role: p.role in ROLE_WORDS ? p.role : 'member',
        invited,
        you: isYou,
        sub: invited
          ? ['Invited', expiresIn(p.expiresAt, now)].filter(Boolean).join(' · ')
          : (p.email ?? ''),
        initial: String(p.name || p.email || '?')
          .trim()
          .charAt(0)
          .toUpperCase(),
      };
    });
  return rows.sort(
    (a, b) =>
      Number(a.invited) - Number(b.invited) ||
      Number(b.you) - Number(a.you) ||
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name)
  );
}

/** "3 people · 1 invited" — a count that reads for 1 and many (CONTRACT §4). */
export function countLine(rows) {
  const people = rows.filter((r) => !r.invited).length;
  const invited = rows.length - people;
  const p = `${people} ${people === 1 ? 'person' : 'people'}`;
  return invited ? `${p} · ${invited} invited` : p;
}

/** The words of a refusal: the hub's own sentence, the local gate's message, or a plain fallback. */
export function errorWords(body, fallback = 'That did not work. Try again in a minute.') {
  if (body && typeof body === 'object') {
    if (typeof body.message === 'string' && body.message) return body.message;
    if (typeof body.error === 'string' && /\s/.test(body.error)) return body.error;
  }
  return fallback;
}

// ── S9.20: Share › Advanced (10 co-share-advanced) ──────────────────────────────────────────────

/** Who can open the link — `team` is a location (it grants nothing), `anyone` a signed-in holder. */
export const LINK_WHO = Object.freeze([
  ['team', 'Team only'],
  ['anyone', 'Anyone with the link'],
]);

/** The roles a link may give (V2-1.7 §5.6: never more than Can comment), weakest first. */
export const LINK_ROLES = Object.freeze(['observer', 'viewer']);

/** When the link ends: `[id, words, days | null]`. */
export const LINK_EXPIRES = Object.freeze([
  ['never', 'Never', null],
  ['7d', 'In 7 days', 7],
  ['30d', 'In 30 days', 30],
]);

export const DEFAULT_LINK_RULES = Object.freeze({
  who: 'team',
  role: 'observer',
  expires: 'never',
});

/** `expires` id → the ISO date the hub stores (null = never). */
export function expiresAtFor(expires, now = Date.now()) {
  const row = LINK_EXPIRES.find(([id]) => id === expires);
  return row?.[2] ? new Date(now + row[2] * DAY).toISOString() : null;
}

/** The link row's words: "Anyone with the link" / "Anyone in <project> with the link" + its role. */
export function linkRowWords({ who, role, project } = {}) {
  return {
    title:
      who === 'anyone'
        ? 'Anyone with the link'
        : `Anyone in ${project || 'this project'} with the link`,
    sub:
      who === 'anyone'
        ? roleWord(LINK_ROLES.includes(role) ? role : 'observer')
        : 'Opens it for people who already have access',
  };
}

/**
 * The roles side by side (co-share-advanced, middle column): `[what, roles that may]`. The columns
 * drawn are the roles the hub reports, so Can view is not shown before the Q13 flip.
 */
export const ROLE_MATRIX = Object.freeze([
  ['Look', ['owner', 'member', 'viewer', 'observer']],
  ['Comment', ['owner', 'member', 'viewer']],
  ['Download and export', ['owner', 'member', 'viewer']],
  ['Draw annotations', ['owner', 'member']],
  ['Change artboards', ['owner', 'member']],
  ['Use AI on it', ['owner', 'member']],
  ['Move to the trash', ['owner', 'member']],
  ['Invite people', ['owner']],
  ['Clear out the trash', ['owner']],
]);

/**
 * What Share › Advanced draws — from the server's posture, never a guess:
 *   · `rules`    This link (who / role / expires) — only where the hub has links, and only for
 *                the owner (the server refuses anyone else: routes/share.ts);
 *   · `github`   Invite by GitHub username — the desktop's (it needs this Mac's GitHub sign-in);
 *   · `syncs`    Where it syncs — the linked hub's address;
 *   · `matrix`   the roles side by side (cloud); `hubRoles` the roles THIS hub holds (self-hosted).
 */
export function advancedView({ view, shell, hubUrl } = {}) {
  const linked = !!view?.linked;
  const selfHosted = linked && view?.access?.authority === 'hub';
  const roles = view?.access?.roles ?? [];
  return {
    rules: linked && view.reachable && !!view.showLinkRow && !!view.canInvite,
    github: shell === 'native',
    syncs: linked && typeof hubUrl === 'string' && hubUrl ? hubUrl : null,
    matrix: linked && !selfHosted ? ROLE_ORDER.filter((r) => roles.includes(r)) : null,
    hubRoles: selfHosted
      ? {
          available: ROLE_ORDER.filter((r) => r !== 'owner' && roles.includes(r)).map(roleWord),
          missing: ['viewer', 'observer'].filter((r) => !roles.includes(r)).map(roleWord),
        }
      : null,
    hint: selfHosted ? 'Other ways in, sync, roles' : 'Link rules, other ways in, where it syncs',
  };
}

// One-shot focus for the sheet that is about to open: ⌘K "Link settings…" opens it on This link,
// File › Share on GitHub… on the GitHub row (it takes over project.share-github). Read once.
let pendingFocus = null;
export function requestShareFocus(what) {
  pendingFocus = what === 'link' || what === 'github' ? what : null;
}
export function takeShareFocus() {
  const f = pendingFocus;
  pendingFocus = null;
  return f;
}

/** The words a Move to cloud answer is shown with (S6-S9 §5.5), or null for "it is moving". */
export function moveWords(status, body) {
  if (status === 200 && body?.ok) return null;
  if (status === 401)
    return 'Sign in to Maude Cloud first (Settings › Connections), then Move to cloud again.';
  if (status === 409) return 'This project already syncs to another hub.';
  if (status === 404)
    return 'Moving to the cloud is not available on this Mac. It stays on this Mac.';
  if (status === 0 || status === 503)
    return 'Maude Cloud could not be reached. Your work is still on this Mac.';
  return errorWords(body, 'Moving to the cloud did not start. Your work is still on this Mac.');
}

/** A plausible e-mail — the hub decides; this only keeps Invite off for an empty or half-typed one. */
export const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s ?? '').trim());

/**
 * The sheet's calls — the studio's `/_api/share/*` (routes/share.ts), which carries this Mac's
 * credential to the linked hub. Every call answers `{ ok, status, body }` and never throws.
 */
export function shareApi(fetchImpl = (...a) => fetch(...a)) {
  const go = async (method, path, body) => {
    try {
      const res = await fetchImpl(path, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = res.status === 204 ? '' : await res.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return { ok: res.ok, status: res.status, body: parsed };
    } catch {
      return { ok: false, status: 0, body: null };
    }
  };
  const id = (v) => encodeURIComponent(String(v));
  const withCanvas = (canvas) => (canvas ? { canvas } : {});
  return {
    posture: () => go('GET', '/_api/share/posture'),
    me: () => go('GET', '/_api/share/me'),
    people: (canvas) =>
      go('GET', `/_api/share/people${canvas ? `?canvas=${encodeURIComponent(canvas)}` : ''}`),
    invite: ({ email, role, canvas }) =>
      go('POST', '/_api/share/invites', {
        email: String(email).trim(),
        role,
        ...withCanvas(canvas),
      }),
    resend: (inviteId) => go('POST', `/_api/share/invites/${id(inviteId)}/resend`, {}),
    revoke: (inviteId) => go('POST', `/_api/share/invites/${id(inviteId)}/revoke`, {}),
    setRole: (personId, role, canvas) =>
      go('PATCH', `/_api/share/people/${id(personId)}`, { role, ...withCanvas(canvas) }),
    remove: (personId, canvas) =>
      go('POST', `/_api/share/people/${id(personId)}/remove`, withCanvas(canvas)),
    // S9.20 — the link (owner-only on the server) and the two desktop doors of Share › Advanced
    createLink: ({ role, who, expiresAt, canvas }) =>
      go('POST', '/_api/share/links', { role, who, expiresAt, ...withCanvas(canvas) }),
    patchLink: (linkId, patch) => go('PATCH', `/_api/share/links/${id(linkId)}`, patch),
    // The window's own same-origin fetch: the browser adds `Sec-Fetch-Site`, the route needs it.
    moveToCloud: (name) => go('POST', '/_api/cloud/move', name ? { name } : {}),
    moveState: () => go('GET', '/_api/cloud/move'),
    githubInvite: (username) => go('POST', '/_api/github/invite', { username }),
    // S9.20b — "Last synced": the sync runtime's own status (project class; absent = no line)
    syncStatus: () => go('GET', '/_sync-status'),
    // gate-b-sec4 — the folder names a hub this Mac never linked: its host, and Connect
    pendingLink: () => go('GET', '/_api/sync/link'),
    confirmLink: () => go('POST', '/_api/sync/link/confirm', {}),
  };
}
