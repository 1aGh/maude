// The team server's admin, by role — who may use it, and the People, Overview
// and Activity routes behind it.
//
// TWO WAYS IN (DDR-053 stays true for the first):
//
//   the admin key   `Authorization: Bearer <HUB_SECRET | admin.json>` — the
//                   operator credential. Everything, as before.
//   a signed-in     the ordinary browser session (`maude_studio` cookie) of an
//   admin ACCOUNT   account whose role is `admin`. People, invites, activity,
//                   who-can-join, name — the day-to-day. NOT the admin key,
//                   bootstrap, peer tokens or connected sessions: those stay
//                   key-only ("Advanced"), so a stolen browser session cannot
//                   mint a forever-credential or lock the operator out.
//
// A COOKIE RIDES ON EVERY REQUEST A BROWSER MAKES, so the session way in is
// only for this hub's own page: every method needs `Sec-Fetch-Site:
// same-origin` and, when an Origin is sent, this hub's own — the rule the
// cell's Share door already keeps (`sameOriginShareRequest`). JSON bodies are
// required by `readJsonBody`, which a cross-site form cannot send either.
//
// A CELL IS UNCHANGED. Under `MAUDE_CLOUD_IDENTITY` (1 or strict) people are
// managed by the control plane: the session way in does not exist there and
// the admin API is key-only exactly as it was. Workspace mode
// (`HUB_WORKSPACE_MODE`) is NOT that switch — a self-hosted team server runs in
// workspace mode and manages its own people.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { verifyAdminAuth } from './admin-auth.mjs';
import {
  auditCsv,
  CSV_MAX,
  countAuditSince,
  lastSignIns,
  listAudit,
  RETENTION_MS,
} from './audit-log.mjs';
import { cloudIdentityEnabled } from './cloud-identity.mjs';
import {
  createInvite,
  getInvite,
  inviteUrl,
  listInvites,
  reissueInvite,
  revokeInvite,
  revokeInvitesForEmail,
} from './invites.mjs';
import { oidcConfig } from './oidc-routes.mjs';
import { sameOriginShareRequest } from './routes-v2/share.mjs';
import { JOIN_POLICIES, readSettings } from './settings.mjs';
import { listTokensForOwner, removeToken, revokeTokensForOwner } from './tokens.mjs';
import {
  activeAdminCount,
  approveOidcSub,
  assertValidEmail,
  clearTurnedOut,
  getPendingOidc,
  getUser,
  getUserById,
  listPendingOidc,
  listUsers,
  markTurnedOut,
  normalizeEmail,
  oidcLinkedEmails,
  removePendingOidc,
  removeUserForGood,
  setUserDisabled,
  setUserRole,
} from './users.mjs';

// ------------------------------------------------------------------ who is asking

/** What a signed-in admin ACCOUNT may call. Anything else needs the admin key. */
const SESSION_GET = new Set([
  '/me',
  '/overview',
  '/people',
  '/activity',
  '/activity.csv',
  '/status',
  '/canvases',
  '/settings',
  '/users',
  '/invites',
  '/oidc/pending',
]);
const SESSION_POST = new Set([
  '/settings',
  '/people/invite',
  '/people/invite/reissue',
  '/people/invite/revoke',
  '/people/let-in',
  '/people/dismiss',
  '/people/role',
  '/people/turn-off',
  '/people/turn-on',
  '/people/remove',
  '/people/signout',
  '/users/disable',
  '/users/enable',
  '/users/delete',
  '/invites',
  '/invites/revoke',
  '/oidc/pending/dismiss',
]);
// DELIBERATELY ABSENT — key-only, because each one leaves behind a credential
// that outlives the session that made it. A stolen admin cookie, or a script
// running on this origin, must not be able to:
//   POST /users            create an account WITH a password it chose
//   POST /users/password   set or reset anyone's password (its own included)
//   POST /oidc/link        attach a provider identity to an EXISTING account
//   POST /oidc/approve     create an account for a TYPED address + link
//   POST /oidc/unlink      the first half of re-pointing an account
// What a session admin has instead: invitations, "Let in" (a NEW account for
// the address the provider verified), and "Link my sign-in" for themself.
// Making someone an Admin stays allowed — it hands the caller nothing.

export function sessionAdminAllowed(method, path) {
  if (method === 'GET') return SESSION_GET.has(path);
  if (method === 'POST') return SESSION_POST.has(path);
  return false;
}

/** Is the self-service admin (accounts, invites, session admins) this hub's to run? */
export function selfServicePeople(env = process.env) {
  return !cloudIdentityEnabled(env);
}

/**
 * Who is calling the admin API.
 *
 * @returns {{kind:'key', name:string}
 *   | {kind:'session', name:string, email:string, user:object, label:string|null}
 *   | {kind:'member', name:string, email:string, user:object, session:object}
 *   | {kind:'none', status:401|403, error:string, credential:boolean}}
 */
export function adminActorFor({
  request,
  dataDir,
  secret,
  publicUrl,
  sessionOf,
  env = process.env,
}) {
  const presented = request.headers?.authorization;
  // A presented Bearer is judged as a Bearer and nothing else — a wrong key
  // never falls back to the cookie (and still spends the 401 budget).
  if (typeof presented === 'string' && presented.trim()) {
    return verifyAdminAuth(request, { hubSecret: secret, dataDir })
      ? { kind: 'key', name: 'Admin key' }
      : { kind: 'none', status: 401, error: 'unauthorized', credential: true };
  }
  const none = { kind: 'none', status: 401, error: 'unauthorized', credential: false };
  if (!selfServicePeople(env)) return none;
  const session = sessionOf?.(request) ?? null;
  if (!session?.email) return none;
  if (!sameOriginShareRequest(request, publicUrl)) {
    return {
      kind: 'none',
      status: 403,
      error: 'Open the admin from this team server’s own page.',
      credential: true,
    };
  }
  const user = getUser(dataDir, session.email);
  if (!user || user.disabled) return none;
  // BOTH must say admin: the account (re-read now, so a demotion applies to
  // the very next request) and the session (minted as the project owner — a
  // canvas-only or member session of an admin's address is not one).
  if (user.role === 'admin' && session.role === 'owner' && !user.access) {
    return { kind: 'session', name: user.email, email: user.email, user, label: session.label };
  }
  return { kind: 'member', name: user.email, email: user.email, user, session };
}

// ------------------------------------------------------------------ words

/** A hub account's role in words. `member` is "Can edit": a hub has no lower account role. */
export function roleLabel(user) {
  if (user?.role === 'admin') return 'Admin';
  const n = user?.access?.grants?.length;
  return n ? `Can edit · ${n} canvas${n === 1 ? '' : 'es'}` : 'Can edit';
}

/** A name to show a fellow member for an admin — never the address (V2-1.16 L17). */
function nameFromEmail(email) {
  const local =
    String(email)
      .split('@')[0]
      .split(/[._+-]/)[0] || 'Admin';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

const sessionKind = (label) =>
  String(label).startsWith('studio-')
    ? 'browser'
    : String(label).startsWith('u-')
      ? 'app'
      : 'token';

// ------------------------------------------------------------------ guards

/**
 * May this change be made? Returns a sentence when it may NOT.
 *
 *   • the last admin who can sign in is never demoted, turned off or removed —
 *     the team server would have nobody to run it but the key holder;
 *   • nobody does any of the three to THEMSELF from a session (a lock-out one
 *     click wide). The admin key is not a person and is not held to this.
 */
export function personChangeRefusal(dataDir, actor, target, change) {
  if (!target) return null;
  const lowering = change === 'remove' || change === 'turn-off' || change === 'demote';
  if (!lowering) return null;
  if (actor?.kind === 'session' && normalizeEmail(actor.email) === target.email) {
    return change === 'demote'
      ? 'You cannot take Admin away from yourself. Ask another admin.'
      : 'You cannot turn off or remove yourself. Ask another admin.';
  }
  if (target.role === 'admin' && !target.disabled && activeAdminCount(dataDir) <= 1) {
    return 'This is the only admin. Make someone else an admin first.';
  }
  return null;
}

// ------------------------------------------------------------------ people

function liveByLabel(peers) {
  const m = new Map();
  for (const p of peers?.values?.() ?? []) m.set(p.user, (m.get(p.user) ?? 0) + 1);
  return m;
}

function sessionsOf(dataDir, email, live, now) {
  return listTokensForOwner(dataDir, email)
    .filter((t) => !t.expiresAt || t.expiresAt > now)
    .map((t) => ({
      label: t.label,
      kind: sessionKind(t.label),
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt ?? null,
      expiresAt: t.expiresAt ?? null,
      live: live.get(t.label) ?? 0,
    }));
}

/** Accounts + "Asks to join" + open invites, one list. */
export function listPeople(dataDir, { peers, now = Date.now(), env = process.env } = {}) {
  const live = liveByLabel(peers);
  const signIns = lastSignIns(dataDir);
  const linked = oidcLinkedEmails(dataDir);
  const people = [];

  for (const p of listPendingOidc(dataDir)) {
    people.push({
      kind: 'request',
      key: `r:${p.sub}`,
      sub: p.sub,
      email: p.email ?? null,
      role: 'member',
      roleLabel: 'Can edit',
      status: 'asks',
      statusLabel: 'Asks to join',
      lastSeen: p.lastAttempt,
      createdAt: p.firstSeen,
      sessions: [],
    });
  }
  for (const i of listInvites(dataDir, { now })) {
    if (i.status !== 'open') continue;
    const days = Math.max(0, Math.ceil((i.expiresAt - now) / 86_400_000));
    people.push({
      kind: 'invite',
      key: `i:${i.id}`,
      id: i.id,
      email: i.email ?? null,
      role: i.role,
      roleLabel: roleLabel({ role: i.role, access: i.access }),
      status: 'invited',
      statusLabel: `Invited · ${days} day${days === 1 ? '' : 's'} left`,
      lastSeen: null,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      sessions: [],
    });
  }
  for (const u of listUsers(dataDir)) {
    const sessions = sessionsOf(dataDir, u.email, live, now);
    const online = sessions.some((s) => s.live > 0);
    const lastSeen =
      Math.max(0, signIns.get(u.email) ?? 0, ...sessions.map((s) => s.lastUsedAt ?? 0)) || null;
    people.push({
      kind: 'account',
      key: `u:${u.id}`,
      id: u.id,
      email: u.email,
      role: u.role,
      roleLabel: roleLabel(u),
      ...(u.access ? { canvases: u.access.grants.length } : {}),
      status: u.disabled ? 'off' : online ? 'online' : 'away',
      statusLabel: u.disabled ? 'Turned off' : online ? 'Online' : 'Away',
      lastSeen: online ? now : lastSeen,
      createdAt: u.createdAt,
      linked: linked.has(u.email),
      sessions,
    });
  }
  const count = (s) => people.filter((p) => p.status === s).length;
  const accounts = people.filter((p) => p.kind === 'account');
  const cfg = oidcConfig(env);
  return {
    people,
    counts: {
      everyone: people.length,
      people: accounts.length,
      asks: count('asks'),
      invited: count('invited'),
      off: count('off'),
      online: count('online'),
    },
    whoCanJoin: readSettings(dataDir).whoCanJoin,
    signIn: cfg.enabled
      ? { provider: cfg.label, domains: cfg.allowedDomains, passwords: cfg.mode !== 'strict' }
      : { provider: null, domains: [], passwords: true },
  };
}

/** The account a body names — by its id (`u_…`) or its address. */
function accountOf(dataDir, body) {
  if (typeof body?.id === 'string' && body.id) return getUserById(dataDir, body.id);
  return getUser(dataDir, body?.email);
}

/** Addresses out of whatever the Invite sheet sent: an array, or text split on commas, spaces, lines. */
export function parseEmails(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[\s,;]+/);
  const out = [];
  for (const item of raw) {
    const s = typeof item === 'string' ? item.trim() : '';
    if (s && !out.includes(s.toLowerCase())) out.push(s.toLowerCase());
  }
  return out;
}

export const MAX_INVITES_PER_CALL = 50;

// ------------------------------------------------------------------ overview

const DAY = 86_400_000;

function healthLines({ version, durability, repoDir, gitLock, now }) {
  const lines = [
    { key: 'version', label: 'Version', value: `Maude ${version}`, state: 'ok', word: 'Running' },
  ];
  const d = durability;
  const kept = Number.isInteger(d?.kept) ? d.kept : null;
  const keptWord = kept === null ? 'Working' : `${kept} kept`;
  const backups = (line) =>
    lines.push({ key: 'backups', label: 'Backups', ...(kept === null ? {} : { kept }), ...line });
  if (!d || d.state === 'not-configured') {
    backups({ value: 'Not set up', state: 'off', word: 'Not set up' });
  } else if (d.state === 'failed' || d.state === 'identity-conflict') {
    // The reason, and the last good one still named: "failing since" needs both.
    backups({
      value: d.state === 'identity-conflict' ? 'Turned off' : 'Failing',
      ...(d.lastOkAt ? { at: d.lastOkAt } : {}),
      state: 'bad',
      word:
        d.state === 'identity-conflict'
          ? 'Another server already backs up to this place'
          : String(d.message ?? 'The last backup failed').slice(0, 160),
    });
  } else if (d.lastOkAt) {
    backups({ value: 'Last backup', at: d.lastOkAt, state: 'ok', word: keptWord });
  } else if (d.listError) {
    // Neither a record nor a listing: say that, never "no backup yet".
    backups({
      value: 'Cannot read the backup place',
      state: 'warn',
      word: String(d.listError).slice(0, 160),
    });
  } else {
    backups({ value: 'No backup yet', state: 'warn', word: 'Waiting for the first one' });
  }
  let git = {
    key: 'git',
    label: 'Saving to Git',
    value: 'Not set up',
    state: 'off',
    word: 'Not set up',
  };
  if (repoDir && existsSync(join(repoDir, '.git'))) {
    let at = null;
    try {
      at = Math.round(statSync(join(repoDir, '.git', 'logs', 'HEAD')).mtimeMs);
    } catch {
      /* no commit yet */
    }
    git = gitLock?.stale
      ? {
          key: 'git',
          label: 'Saving to Git',
          value: 'Stuck',
          ...(at ? { at } : {}),
          state: 'bad',
          word: 'A save did not finish',
        }
      : {
          key: 'git',
          label: 'Saving to Git',
          value: at ? 'Last save' : 'No save yet',
          ...(at ? { at } : {}),
          state: at ? 'ok' : 'warn',
          word: at ? 'Working' : 'Waiting for the first change',
        };
  }
  lines.push(git);
  for (const l of lines) if (l.at && now - l.at > 2 * DAY && l.state === 'ok') l.state = 'warn';
  return lines;
}

export function buildOverview(dataDir, ctx) {
  const now = ctx.now ?? Date.now();
  const listing = listPeople(dataDir, { peers: ctx.peers, now, env: ctx.env });
  const needs = [];
  for (const p of listing.people) {
    if (p.kind === 'request') {
      needs.push({ type: 'request', sub: p.sub, email: p.email, since: p.createdAt });
    }
  }
  for (const p of listing.people) {
    // Not opened after a day: worth a nudge. Younger than that is just mail latency.
    if (p.kind === 'invite' && now - p.createdAt > DAY) {
      needs.push({
        type: 'invite',
        id: p.id,
        email: p.email,
        since: p.createdAt,
        expiresAt: p.expiresAt,
      });
    }
  }
  const here = listing.people.filter((p) => p.status === 'online').map((p) => p.email);
  const settings = readSettings(dataDir);
  return {
    hub: { name: settings.name, description: settings.description },
    needs,
    health: healthLines({
      version: ctx.version,
      durability: ctx.durability,
      repoDir: ctx.repoDir,
      gitLock: ctx.gitLock,
      now,
    }),
    counts: {
      people: listing.counts.people,
      invited: listing.counts.invited,
      asks: listing.counts.asks,
      hereNow: here.length,
      connections: ctx.peers?.size ?? 0,
      canvases: ctx.canvasCount?.() ?? 0,
      // CHANGES are what people did to canvases, from the file journal
      // (change-stats.mjs) — the same number the Cloud dashboard shows.
      // Omitted, never zero, on a hub with no journal.
      ...(ctx.changes ? { changesThisWeek: ctx.changes.changesWeek } : {}),
      // EVENTS are the kept activity log: sign-ins, invites, people, settings.
      eventsThisWeek: countAuditSince(dataDir, now - 7 * DAY),
    },
    ...(ctx.changes ? { changesByDay: ctx.changes.changesByDay } : {}),
    hereNow: here.slice(0, 8),
    recent: listAudit(dataDir, { limit: 8 }),
    whoCanJoin: listing.whoCanJoin,
    signIn: listing.signIn,
    retentionDays: Math.round(RETENTION_MS / DAY),
  };
}

/** What `/admin/api/me` says — the page decides what to draw from this alone. */
export function describeMe(dataDir, actor, { env = process.env, peers } = {}) {
  const settings = readSettings(dataDir);
  const cfg = oidcConfig(env);
  const base = {
    hub: { name: settings.name },
    selfService: selfServicePeople(env),
    provider: cfg.enabled ? cfg.label : null,
  };
  if (actor.kind === 'none') return { ...base, signedIn: false, admin: false };
  if (actor.kind === 'key') return { ...base, signedIn: true, admin: true, via: 'key' };
  const linked = oidcLinkedEmails(dataDir).has(actor.email);
  const mine = {
    ...base,
    signedIn: true,
    via: 'session',
    email: actor.email,
    roleLabel: roleLabel(actor.user),
    linked,
    // "Link my sign-in" only makes sense when there is a provider and this account has none.
    canLink: cfg.enabled && !linked,
  };
  if (actor.kind === 'session') return { ...mine, admin: true };
  // A member's page: their own access, who runs the server, their own sessions.
  const admins = listUsers(dataDir).filter((u) => u.role === 'admin' && !u.disabled);
  const live = liveByLabel(peers);
  return {
    ...mine,
    admin: false,
    access: actor.user.access
      ? { everything: false, canvases: actor.user.access.grants.map((g) => g.c) }
      : { everything: true },
    // Names only, never addresses, and only for someone on the whole project.
    runBy: actor.user.access ? [] : admins.map((u) => nameFromEmail(u.email)),
    admins: admins.length,
    whoCanJoin: settings.whoCanJoin,
    domains: cfg.enabled ? cfg.allowedDomains : [],
    sessions: sessionsOf(dataDir, actor.email, live, Date.now()).map((s) => ({
      kind: s.kind,
      lastUsedAt: s.lastUsedAt,
      createdAt: s.createdAt,
      current: s.label === actor.session?.label,
    })),
  };
}

// ------------------------------------------------------------------ routes

/**
 * `/overview`, `/people*`, `/activity*`. The caller (server.mjs handleAdminApi)
 * has ALREADY established `ctx.actor` as the admin key or a session admin.
 * Returns true when handled.
 */
export async function handleTeamAdminRoutes(ctx) {
  const { path, method, dataDir, respondJson, readJsonBody, actor } = ctx;
  const env = ctx.env ?? process.env;
  const by = actor?.name ?? 'Admin key';
  const audit = (event) => ctx.audit?.({ actor: by, ...event });
  const kick = (labels) => {
    let n = 0;
    for (const label of labels) n += ctx.kickLabel?.(label) ?? 0;
    return n;
  };
  const endSessions = (email) => {
    const revoked = revokeTokensForOwner(dataDir, email);
    return { revoked: revoked.length, kicked: kick(revoked) };
  };

  if (method === 'GET' && path === '/overview') {
    respondJson(200, buildOverview(dataDir, { ...ctx, env }));
    return true;
  }
  if (method === 'GET' && path === '/people') {
    respondJson(200, listPeople(dataDir, { peers: ctx.peers, env }));
    return true;
  }

  if (method === 'GET' && (path === '/activity' || path === '/activity.csv')) {
    const q = ctx.query ?? new URLSearchParams();
    // `who` may be an account id (`u_…`) so the page never puts an address in a URL.
    let who = q.get('who') ?? '';
    if (/^u_[0-9a-f]{16}$/.test(who)) who = getUserById(dataDir, who)?.email ?? '\u0000';
    const filter = {
      kind: q.get('kind') ?? '',
      who,
      q: q.get('q') ?? '',
      before: q.get('before') ?? '',
    };
    if (path === '/activity.csv') {
      const rows = listAudit(dataDir, { ...filter, limit: CSV_MAX, max: CSV_MAX });
      ctx.respondCsv(auditCsv(rows), 'activity.csv');
      return true;
    }
    const kept = listAudit(dataDir, { ...filter, limit: q.get('limit') ?? 100 });
    respondJson(200, {
      // `activity` keeps the shape the in-memory feed always had (type/user/doc/at),
      // newest first, so an older console and the Overview widget keep working;
      // `events` is the kept log.
      activity: (ctx.activity ?? []).slice().reverse(),
      events: kept,
      retentionDays: Math.round(RETENTION_MS / DAY),
      more: kept.length ? kept[kept.length - 1].id : null,
    });
    return true;
  }

  if (method !== 'POST' || !path.startsWith('/people/')) return false;

  if (!selfServicePeople(env)) {
    respondJson(409, {
      error:
        'This project takes its people from Maude Cloud. Add and change people on the project’s People page there.',
    });
    return true;
  }
  let body;
  try {
    body = await readJsonBody(ctx.request);
  } catch (err) {
    respondJson(400, { error: err.message });
    return true;
  }

  if (path === '/people/invite') {
    const role = body?.role ?? 'member';
    const emails = parseEmails(body?.emails ?? body?.email);
    // An Admin invitation always names who it is for. A link for "anyone who
    // opens it" that makes an admin is a credential to the whole server.
    if (role === 'admin' && emails.length === 0) {
      respondJson(400, { error: 'An Admin invitation needs an email address.' });
      return true;
    }
    if (emails.length > MAX_INVITES_PER_CALL) {
      respondJson(400, { error: `At most ${MAX_INVITES_PER_CALL} people at once.` });
      return true;
    }
    const link = (invite) => ({
      id: invite.id,
      expiresAt: invite.expiresAt,
      // Shown ONCE, to the admin who made it. Never stored, never logged.
      url: ctx.publicUrl ? inviteUrl(ctx.publicUrl, invite.value) : null,
    });
    const results = [];
    try {
      if (emails.length === 0) {
        // "Copy a one-time link" — an invite for whoever opens it.
        const invite = createInvite(dataDir, { role, ttlHours: body?.ttlHours, createdBy: by });
        audit({
          kind: 'invite-create',
          target: '(anyone with the link)',
          detail: roleLabel({ role }),
        });
        results.push({ email: null, ok: true, ...link(invite) });
      }
      for (const raw of emails) {
        let email;
        try {
          email = assertValidEmail(raw);
        } catch {
          results.push({ email: raw, ok: false, error: 'This is not an email address.' });
          continue;
        }
        if (getUser(dataDir, email)) {
          results.push({ email, ok: false, error: 'Already here.' });
          continue;
        }
        // One open invite per address: the older link stops working.
        revokeInvitesForEmail(dataDir, email);
        // Naming the address is the admin saying yes — also to someone once removed.
        clearTurnedOut(dataDir, { email });
        const invite = createInvite(dataDir, {
          email,
          role,
          ttlHours: body?.ttlHours,
          createdBy: by,
        });
        audit({ kind: 'invite-create', target: email, detail: roleLabel({ role }) });
        results.push({ email, ok: true, ...link(invite) });
      }
    } catch (err) {
      respondJson(400, { error: err.message });
      return true;
    }
    respondJson(results.some((r) => r.ok) ? 201 : 400, { invites: results });
    return true;
  }

  if (path === '/people/invite/reissue') {
    // "Send again" / "Copy link": the value is never stored, so the link an
    // admin copies later is a NEW one, and the old one stops working.
    const before = getInvite(dataDir, String(body?.id ?? ''));
    const fresh =
      before?.status === 'open'
        ? reissueInvite(dataDir, before.id, { ttlHours: body?.ttlHours })
        : null;
    if (!fresh) {
      respondJson(404, { error: 'No open invitation with that id.' });
      return true;
    }
    audit({
      kind: 'invite-reissue',
      target: before.email ?? '(anyone with the link)',
      detail: 'a new link; the old one stopped working',
    });
    respondJson(200, {
      id: fresh.id,
      email: before.email ?? null,
      expiresAt: fresh.expiresAt,
      url: ctx.publicUrl ? inviteUrl(ctx.publicUrl, fresh.value) : null,
    });
    return true;
  }

  if (path === '/people/invite/revoke') {
    const before = getInvite(dataDir, String(body?.id ?? ''));
    if (!before || !revokeInvite(dataDir, before.id)) {
      respondJson(404, { error: 'No open invitation with that id.' });
      return true;
    }
    audit({ kind: 'invite-revoke', target: before.email ?? '(anyone with the link)' });
    respondJson(200, { ok: true });
    return true;
  }

  if (path === '/people/let-in') {
    // The address is the one the provider VERIFIED when the person asked
    // (only verified, allow-listed addresses are queued — oidc-routes.mjs).
    // `approveOidcSub` creates a NEW account and throws when the address
    // already has one: letting someone in never reaches an existing account.
    const pending = getPendingOidc(dataDir, body?.sub);
    if (!pending) {
      respondJson(404, { error: 'Nobody with that sign-in is waiting.' });
      return true;
    }
    const role = body?.role ?? 'member';
    try {
      const user = approveOidcSub(dataDir, { sub: pending.sub, email: pending.email, role });
      const revokedInvites = revokeInvitesForEmail(dataDir, user.email);
      audit({ kind: 'oidc-approve', target: user.email, detail: `let in · ${roleLabel(user)}` });
      respondJson(201, { user, revokedInvites });
    } catch (err) {
      const taken = /already exists/.test(err.message);
      respondJson(taken ? 409 : 400, {
        error: taken
          ? 'An account with this address is already here. Its owner can sign in with their password and choose Link my sign-in.'
          : err.message,
      });
    }
    return true;
  }

  if (path === '/people/dismiss') {
    const pending = getPendingOidc(dataDir, body?.sub);
    const removed = pending ? removePendingOidc(dataDir, pending.sub) : false;
    if (removed) {
      // Dismissed stays dismissed: under "colleagues come straight in" the
      // same subject would otherwise be an account on its next sign-in.
      markTurnedOut(dataDir, { sub: pending.sub, email: pending.email ?? '' });
      audit({ kind: 'oidc-dismiss', target: pending.email ?? '' });
    }
    respondJson(200, { ok: true, removed });
    return true;
  }

  // ---- everything below changes one ACCOUNT ----
  const target = accountOf(dataDir, body);
  if (!target) {
    respondJson(404, { error: 'No such person.' });
    return true;
  }
  const refuse = (change) => {
    const why = personChangeRefusal(dataDir, actor, target, change);
    if (why) respondJson(409, { error: why });
    return Boolean(why);
  };

  if (path === '/people/role') {
    const role = body?.role;
    if (role !== 'admin' && role !== 'member') {
      respondJson(400, { error: 'A person on a team server is an Admin or Can edit.' });
      return true;
    }
    if (role === target.role) {
      respondJson(200, { user: target, changed: false });
      return true;
    }
    if (role === 'member' && refuse('demote')) return true;
    let user;
    try {
      user = setUserRole(dataDir, target.email, role);
    } catch (err) {
      respondJson(400, { error: err.message });
      return true;
    }
    // A session carries the role it was minted with. Ending them is what
    // makes the change real AT ONCE — a demoted admin must not keep an owner
    // session for another twelve hours. The person signs in again.
    const ended = endSessions(target.email);
    audit({
      kind: 'role-change',
      target: target.email,
      detail: `${roleLabel(target)} → ${roleLabel(user)}`,
    });
    respondJson(200, { user, changed: true, ...ended });
    return true;
  }

  if (path === '/people/turn-off' || path === '/people/turn-on') {
    const off = path === '/people/turn-off';
    if (off && refuse('turn-off')) return true;
    const user = setUserDisabled(dataDir, target.email, off);
    const ended = off ? endSessions(target.email) : { revoked: 0, kicked: 0 };
    audit({ kind: off ? 'user-disable' : 'user-enable', target: target.email });
    respondJson(200, { user, ...ended });
    return true;
  }

  if (path === '/people/remove') {
    if (refuse('remove')) return true;
    const ended = endSessions(target.email);
    removeUserForGood(dataDir, target.email);
    audit({ kind: 'user-delete', target: target.email });
    respondJson(200, { ok: true, ...ended });
    return true;
  }

  if (path === '/people/signout') {
    // One session (by its label) or all of them. A label that is not THIS
    // person's is refused — the route signs out a person, not a token.
    const mine = listTokensForOwner(dataDir, target.email).map((t) => t.label);
    let labels = mine;
    if (body?.label !== undefined) {
      if (!mine.includes(body.label)) {
        respondJson(404, { error: 'That session is not this person’s.' });
        return true;
      }
      labels = [body.label];
    }
    for (const label of labels) {
      try {
        removeToken(dataDir, label);
      } catch {
        /* already gone */
      }
    }
    const kicked = kick(labels);
    audit({
      kind: 'user-signout',
      target: target.email,
      detail: `${labels.length} session${labels.length === 1 ? '' : 's'}`,
    });
    respondJson(200, { ok: true, revoked: labels.length, kicked });
    return true;
  }

  respondJson(404, { error: 'not found' });
  return true;
}

export { JOIN_POLICIES };
