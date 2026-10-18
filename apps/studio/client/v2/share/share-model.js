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
    showLinkRow: access.links,
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
  };
}
