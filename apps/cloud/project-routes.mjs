// Per-project control surfaces — Cloud Phase 22 Task 5 (DDR-204).
//
// The effects layer. Every decision it makes is imported: who may open a
// project (`project-access.mjs`), whether a membership change is allowed
// (`membership.mjs`), and what any of it looks like (`people-page.mjs`). What
// is left here is reading rows, writing rows, and turning a verdict into a
// response — which is the whole point of the split (DDR-196 §1).

import { track } from './analytics.mjs';
import { emailConfigured, inviteEmail, sendEmail } from './email.mjs';
import { decideMembershipChange } from './membership.mjs';
import { peoplePage, removeConfirmPage } from './people-page.mjs';
import { ACCESS_MESSAGES, can, decideAccess } from './project-access.mjs';
import { nudgeCellRevocations } from './provision.mjs';

/** Must match the cell's ACCESS_TOKEN_TTL_MS — the page quotes it in hours. */
const ACCESS_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // No script anywhere on these pages, and the header says so — a CSP that
      // matches the markup is a claim a reviewer can check without reading it.
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      'referrer-policy': 'no-referrer',
    },
  });
}

function redirect(to) {
  return new Response(null, { status: 303, headers: { location: to } });
}

/** Load the project, the caller's standing in it, and everyone on it. */
async function load(env, projectId, accountId) {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId)
    .first();
  const rows = await env.DB.prepare(
    `SELECT m.account_id, m.role, a.email
       FROM project_members m
       JOIN accounts a ON a.id = m.account_id
      WHERE m.project_id = ?
      ORDER BY a.email`
  )
    .bind(projectId)
    .all();
  const members = rows?.results ?? [];
  const verdict = decideAccess({ accountId, project, members });
  return { project, members, verdict };
}

/**
 * Everyone on the project, owner first.
 *
 * The owner is not in `project_members` — ownership is a column on the project
 * — so it is joined in here rather than duplicated as a row. One fact, one
 * place; a membership row for the owner would eventually disagree with the
 * column.
 */
async function peopleList(env, project, members) {
  const owner = await env.DB.prepare('SELECT id, email FROM accounts WHERE id = ?')
    .bind(project.account_id)
    .first();
  return [
    ...(owner ? [{ account_id: owner.id, email: owner.email, role: 'owner' }] : []),
    ...members.filter((m) => m.account_id !== project.account_id),
  ];
}

/**
 * Route the per-project surfaces. Returns a Response, or null when the path is
 * not ours.
 */
export async function handleProjectRoutes(request, env, { account, ctx = null } = {}) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/projects\/([^/]+)\/people(\/remove)?$/);
  if (!m) return null;

  const projectId = decodeURIComponent(m[1]);
  const isRemoveConfirm = Boolean(m[2]);
  if (!PROJECT_ID.test(projectId)) return html(`<p>${ACCESS_MESSAGES['no-access']}</p>`, 404);
  if (!account) return redirect('/login');

  const { project, members, verdict } = await load(env, projectId, account.id);
  if (!verdict.ok) {
    const status = verdict.reason === 'not-signed-in' ? 401 : 404;
    return html(`<p>${ACCESS_MESSAGES[verdict.reason]}</p>`, status);
  }
  const people = await peopleList(env, project, members);
  const isOwner = can(verdict.role, 'invite');

  if (request.method === 'GET' && isRemoveConfirm) {
    const target = people.find((p) => p.account_id === url.searchParams.get('account'));
    if (!target || !isOwner) return redirect(`/projects/${projectId}/people`);
    return html(
      removeConfirmPage({ account, project, person: target, tokenTtlMs: ACCESS_TOKEN_TTL_MS })
    );
  }

  if (request.method === 'GET') {
    return html(peoplePage({ account, project, people, isOwner }));
  }

  if (request.method !== 'POST') return html('<p>Not allowed.</p>', 405);

  const form = await request.formData();
  const action = String(form.get('do') ?? '');
  const targetId = String(form.get('account') ?? '');
  const target = members.find((p) => p.account_id === targetId);

  if (action === 'invite') {
    if (!isOwner)
      return html(
        peoplePage({ account, project, people, isOwner, error: ACCESS_MESSAGES['no-access'] }),
        403
      );
    const email = String(form.get('email') ?? '')
      .trim()
      .toLowerCase();
    // Deliberately shallow: an address is valid if it can be sent to, and the
    // only way to know that is to send to it. A stricter regex rejects real
    // addresses, which is a worse failure than accepting a typo.
    if (!email.includes('@') || email.length > 254) {
      return html(
        peoplePage({
          account,
          project,
          people,
          isOwner,
          error: 'That does not look like an email address.',
        }),
        400
      );
    }
    const role = String(form.get('role') ?? 'member');
    const decision = decideMembershipChange({
      actorId: account.id,
      actorRole: verdict.role,
      targetAccountId: 'new',
      targetRole: null,
      newRole: role,
      ownerId: project.account_id,
    });
    if (!decision.ok)
      return html(peoplePage({ account, project, people, isOwner, error: decision.message }), 400);

    const existing = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?')
      .bind(email)
      .first();
    if (existing) {
      await env.DB.prepare(
        `INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (project_id, account_id) DO UPDATE SET role = excluded.role`
      )
        .bind(projectId, existing.id, role, Date.now())
        .run();
      return redirect(`/projects/${projectId}/people`);
    }
    // No account yet. The invite is the account: they follow one link and land
    // in the project, rather than signing up and then having to find it.
    const inviteId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(inviteId, projectId, email, role, Date.now(), Date.now() + 14 * 86_400_000)
      .run();

    const inviteUrl = `${url.origin}/invite/${inviteId}`;
    // The counterpart to `invite_redeemed`: how many invitations go out
    // against how many are followed. The invitee's ADDRESS is not recorded —
    // it is somebody else's personal data and the operational fact is the
    // count.
    track(env, ctx, { name: 'invite_created', accountId: account.id, projectId });
    const sent = emailConfigured(env)
      ? await sendEmail(env, {
          to: email,
          ...inviteEmail({
            projectName: project.name || project.id,
            role,
            inviteUrl,
            invitedBy: account.email,
          }),
        })
      : { ok: false };
    // A failed (or unconfigured) send still created a real invitation — the
    // owner gets the link to pass along themselves, which also happens to be
    // exactly what "invite them over chat instead" needs. The link goes to the
    // OWNER, who controls the invite either way; it leaks nothing.
    const notice = sent.ok
      ? `Invitation sent to ${email}.`
      : `The invitation is ready, but the email could not be sent. Share this link with them yourself: ${inviteUrl}`;
    return html(peoplePage({ account, project, people, isOwner, notice }));
  }

  const decision = decideMembershipChange({
    actorId: account.id,
    actorRole: verdict.role,
    targetAccountId: targetId,
    targetRole: target?.role ?? null,
    newRole: action === 'remove' ? null : String(form.get('role') ?? ''),
    ownerId: project.account_id,
  });
  if (!decision.ok) {
    return html(peoplePage({ account, project, people, isOwner, error: decision.message }), 400);
  }

  if (decision.action === 'remove') {
    await env.DB.prepare('DELETE FROM project_members WHERE project_id = ? AND account_id = ?')
      .bind(projectId, targetId)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id, account_id) DO UPDATE SET role = excluded.role`
    )
      .bind(projectId, targetId, String(form.get('role')), Date.now())
      .run();
  }

  // Removals and demotions must reach LIVE sessions, not only future tokens
  // (Phase 23 B2). The row is what the cell's revocation sweep consumes; a
  // failed write must not fail the change itself — the 12h TTL still bounds it.
  if (decision.revokeSessions) {
    try {
      const who = await env.DB.prepare('SELECT email FROM accounts WHERE id = ?')
        .bind(targetId)
        .first();
      if (who?.email) {
        await env.DB.prepare(
          'INSERT INTO member_revocations (project_id, email, revoked_at) VALUES (?, ?, ?)'
        )
          .bind(projectId, who.email, Date.now())
          .run();
        // …and the cell hears about it now, not at its next sweep (G5).
        const nudge = nudgeCellRevocations(env, projectId);
        if (ctx?.waitUntil) ctx.waitUntil(nudge);
        else await nudge;
      }
    } catch {
      /* bounded by the token TTL either way */
    }
  }

  // The audit entry is written for every change, not only removals. "Who let
  // them in" is asked as often as "who took them out", and a log that only
  // records the alarming half cannot answer it.
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (id, account_id, project_id, at, actor, action, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        account.id,
        projectId,
        Date.now(),
        `customer:${account.email}`,
        decision.action === 'remove' ? 'member.remove' : 'member.role',
        JSON.stringify({ target: targetId, role: form.get('role') ?? null })
      )
      .run();
  } catch {
    // A failed audit write must not swallow a completed change — the change is
    // the thing the person asked for, and a missing log line is visible in the
    // log itself.
  }

  return redirect(`/projects/${projectId}/people`);
}
