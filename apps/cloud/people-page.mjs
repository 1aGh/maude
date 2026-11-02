// Who is on a project — Cloud Phase 22 Task 5 (DDR-204).
//
// The panel where somebody adds a teammate and, more consequentially, removes
// one. Removal is the reason this page needs care: it looks instantaneous and
// is not, because a project token is verified offline so that a control-plane
// outage cannot lock anyone out of their own work (DDR-204). An admin who
// believes "removed" means "out right now" makes a decision they would not
// otherwise make, so the page says how long it actually takes, in hours.
//
// Server-rendered, no script — same reason as the dashboard. This is a page
// people open when something is wrong, including "the wrong person has
// access".

import { appShell } from './brand.mjs';
import { STATE_COPY } from './dashboard.mjs';
import { ROLES, removalEffect } from './membership.mjs';

// Styling comes from the design system shell (brand.mjs); only what this page
// adds lives here. The table wears the same one-material card the admin
// surfaces use.
const CSS = `
  table { width: 100%; border-collapse: collapse; margin-bottom: var(--space-6); background: var(--bg-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow: hidden; }
  th { text-align: left; font-family: var(--font-mono); font-size: var(--type-xs); text-transform: uppercase; letter-spacing: .06em; color: var(--fg-2); padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--border-subtle); }
  td { padding: var(--space-4) var(--space-5); border-top: 1px solid var(--border-subtle); vertical-align: baseline; font-size: var(--type-base); }
  tr:first-child td { border-top: 0; }
  td.right { text-align: right; white-space: nowrap; }
  form.inline { display: inline; }
  select, input[type=email] { width: auto; }
  td .inline button {
    background: var(--bg-2); color: var(--fg-1); border-color: var(--border-default);
  }
  td .inline button:hover { background: var(--bg-3); color: var(--fg-0); }
  .card h2 { margin: 0 0 var(--space-3); }
  .card { margin-bottom: var(--space-6); }
  .warn { border-color: color-mix(in oklab, var(--status-warn) 45%, transparent); }
  ul { margin: var(--space-2) 0 0; padding-left: var(--space-6); font-size: var(--type-base); line-height: var(--lh-base); }
`;

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function page(title, body, { account, project, isOwner, lede = null } = {}) {
  const copy = project ? (STATE_COPY[project.state] ?? null) : null;
  return appShell({
    account,
    title,
    body,
    project,
    isOwner,
    active: 'people',
    lede,
    pill: copy ? { tone: copy.tone, label: copy.label } : null,
    extraCss: CSS,
  });
}

/** Roles a person can be given here. `owner` is a transfer, not a role change. */
const ASSIGNABLE = ROLES.filter((r) => r !== 'owner');

/**
 * The four v2 role words (V2-1.7 §5.1, CONTRACT §6). Wire ids never reach the
 * page: `member` reads Can edit, `viewer` Can comment, `observer` Can view.
 */
export const ROLE_WORD = Object.freeze({
  owner: 'Owner',
  member: 'Can edit',
  viewer: 'Can comment',
  observer: 'Can view',
});

/** What each role can actually do, in one line. */
export const ROLE_MEANING = Object.freeze({
  owner: 'Everything, plus billing, people and deleting the project.',
  member: 'Change the designs, comment and download.',
  viewer: 'Look, comment and download.',
  observer: 'Look only.',
});

/** A role id → its word, never the id itself. */
export const roleWord = (role) => ROLE_WORD[role] ?? 'Can view';

/**
 * What each option says WHILE it is being chosen (Cloud Phase 24 A12a, canvas
 * board D1). With no script on this page, the option text is the only place
 * the meaning can appear at the moment of the decision.
 *
 * `owner` is deliberately absent: it is a transfer, not a role change, and
 * handing a project over is its own deliberate step that this page does not
 * offer (lead decision v2-lead-make-owner-hidden).
 */
const ROLE_OPTION = Object.freeze({
  member: 'Can edit — change the designs',
  viewer: 'Can comment — look, comment and download',
  observer: 'Can view — look only',
});

function roleSelect(name, current, { label = 'What they can do' } = {}) {
  return `<select name="${name}" aria-label="${esc(label)}">${ASSIGNABLE.map(
    (r) =>
      `<option value="${r}"${r === current ? ' selected' : ''}>${esc(ROLE_OPTION[r] ?? roleWord(r))}</option>`
  ).join('')}</select>`;
}

/** `ui/Poster.tsx` → `Poster` — the name a person sees for a canvas. */
export function canvasName(path) {
  const base =
    String(path ?? '')
      .split('/')
      .pop() ?? '';
  return base.replace(/\.[^.]+$/, '') || base;
}

/** `20 Oct` — the day an invitation stops working. */
function day(ms) {
  return new Date(Number(ms)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * Who a row is, for THIS viewer.
 *
 * E-mail addresses go to the owner only — the one who invites (V2-1.7 §5.6:
 * `email`, invited and requested rows go only to `invite` holders). Everyone
 * else sees a name and the role word; a person with no name yet reads "No name
 * yet", never a piece of their address. The signed-in person is "You".
 */
export function personLabel(person, { isOwner, selfId = null }) {
  if (selfId && person.account_id === selfId) return 'You';
  const name = String(person.name ?? '').trim();
  if (isOwner) {
    return name
      ? `${esc(name)} <span class="quiet">${esc(person.email ?? '')}</span>`
      : esc(person.email ?? '');
  }
  return name ? esc(name) : '<span class="quiet">No name yet</span>';
}

function personRow(person, { projectId, isOwner, selfId, withControls = true }) {
  const label = personLabel(person, { isOwner, selfId });
  const word = `<strong>${esc(roleWord(person.role))}</strong>`;
  if (person.role === 'owner') {
    // No controls at all, rather than disabled ones. A disabled button invites
    // somebody to hunt for the way to enable it. Make owner stays hidden.
    return `<tr><td>${label}</td><td>${word} <span class="quiet">${esc(ROLE_MEANING.owner)}</span></td><td></td></tr>`;
  }
  const controls =
    isOwner && withControls
      ? `<form class="inline" method="post" action="/projects/${esc(projectId)}/people">
         <input type="hidden" name="account" value="${esc(person.account_id)}">
         ${roleSelect('role', person.role)}
         <button type="submit" name="do" value="role">Save</button>
       </form>
       <form class="inline" method="get" action="/projects/${esc(projectId)}/people/remove">
         <input type="hidden" name="account" value="${esc(person.account_id)}">
         <button type="submit">Remove…</button>
       </form>`
      : '';
  return `<tr><td>${label}</td><td>${word} <span class="quiet">${esc(ROLE_MEANING[person.role] ?? '')}</span></td><td class="right">${controls}</td></tr>`;
}

/** A canvas grant: somebody with access to ONE canvas, not the project. */
function grantRow(grant, { isOwner, selfId }) {
  return `<tr><td>${personLabel(grant, { isOwner, selfId })}</td><td><strong>${esc(roleWord(grant.role))}</strong> <span class="quiet">on ${esc(canvasName(grant.canvas_path))} only</span></td><td></td></tr>`;
}

/** An invitation nobody has followed yet. Owner-only: it carries an address. */
function inviteRow(invite) {
  const where = invite.canvas_path ? ` on ${esc(canvasName(invite.canvas_path))}` : '';
  return `<tr><td>${esc(invite.email)}</td><td><strong>${esc(roleWord(invite.role))}</strong>${where} <span class="quiet">· not joined yet · the link works until ${esc(day(invite.expires_at))}</span></td><td></td></tr>`;
}

/**
 * The table of who is on a project, plus (owner only) who was invited — the
 * one renderer the project's People page and the account's People and
 * invites page share, so the two can never disagree about who sees an address.
 */
export function peopleRowsTable({
  people = [],
  grants = [],
  invites = [],
  isOwner,
  selfId = null,
  projectId = null,
  withControls = false,
}) {
  const rows = [
    ...people.map((p) => personRow(p, { projectId, isOwner, selfId, withControls })),
    ...grants.map((g) => grantRow(g, { isOwner, selfId })),
  ];
  const pending =
    isOwner && invites.length
      ? `<h3>Invited</h3>
         <table>
           <thead><tr><th>Address</th><th>What they can do</th><th></th></tr></thead>
           <tbody>${invites.map(inviteRow).join('\n')}</tbody>
         </table>`
      : '';
  return `<table>
       <thead><tr><th>Person</th><th>What they can do</th><th></th></tr></thead>
       <tbody>${rows.join('\n')}</tbody>
     </table>
     ${pending}`;
}

/**
 * The people panel.
 *
 * @param {object} args
 * @param {{id: string, name: string}} args.project
 * @param {{account_id: string, email: string, name?: string|null, role: string}[]} args.people
 * @param {{account_id: string, email: string, name?: string|null, role: string, canvas_path: string}[]} [args.grants]
 *   people with access to one canvas (V2-1.7 canvas grants)
 * @param {{email: string, role: string, canvas_path?: string|null, expires_at: number}[]} [args.invites]
 *   pending invitations — rendered for the owner only
 * @param {boolean} args.isOwner
 */
export function peoplePage({
  account,
  project,
  people = [],
  grants = [],
  invites = [],
  isOwner,
  error = null,
  notice = null,
}) {
  const selfId = account?.id ?? null;
  const invite = isOwner
    ? `<div class="card">
         <h2>Add someone</h2>
         <form method="post" action="/projects/${esc(project.id)}/people">
           <input type="email" name="email" placeholder="their email" aria-label="Their email"
                  required>
           ${roleSelect('role', 'member')}
           <button type="submit" name="do" value="invite">Send invitation</button>
         </form>
         <p class="quiet" style="font-size:.87rem;margin:.6rem 0 0">
           They get an email with a link. If they do not have a Maude account yet,
           the link makes one — they never have to find this project themselves.
         </p>
       </div>`
    : '';
  return page(
    'People',
    `${error ? `<p class="error">${esc(error)}</p>` : ''}
     ${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
     ${invite}
     ${peopleRowsTable({ people, grants, invites, isOwner, selfId, projectId: project.id, withControls: true })}
     ${isOwner ? '' : '<p class="quiet">Only the project’s owner can add or remove people.</p>'}`,
    {
      account,
      project,
      isOwner,
      lede: `Who is on ${project.name}, and what each person can do.`,
    }
  );
}

/**
 * The confirmation before a removal.
 *
 * Its whole job is to be honest about timing. "Remove" reads as instantaneous;
 * it is not, and the person clicking needs to know that BEFORE they decide,
 * not afterwards from a support reply.
 */
export function removeConfirmPage({ account, project, person, tokenTtlMs, csrf }) {
  const effect = removalEffect({ tokenTtlMs });
  return page(
    `Remove ${person.email}?`,
    `<p class="quiet" style="margin:0 0 var(--space-5)"><a href="/projects/${esc(project.id)}/people">← Back to People</a></p>
     <div class="card warn">
       <ul>
         <li>${esc(effect.immediate[0])}</li>
         <li>${esc(effect.delayed)}</li>
       </ul>
       <p class="quiet" style="font-size:.9rem;margin:.8rem 0 0">${esc(effect.ifUrgent)}</p>
     </div>
     <form method="post" action="/projects/${esc(project.id)}/people">
       <input type="hidden" name="account" value="${esc(person.account_id)}">
       ${csrf ? `<input type="hidden" name="csrf" value="${esc(csrf)}">` : ''}
       <button type="submit" name="do" value="remove">Remove them</button>
       <a href="/projects/${esc(project.id)}/people" style="margin-left:1rem">Cancel</a>
     </form>`,
    // The shell options were destructured but never passed, so the confirm
    // step dropped the nav and the account chip — the one page in the flow
    // where somebody most needs to see which project they are acting on.
    // Only an owner reaches removal, hence isOwner.
    { account, project, isOwner: true }
  );
}

/** Every customer-facing string here, for the vocabulary lint. */
export function allPeopleHtml() {
  const project = { id: 'alligators', name: 'Brno Alligators' };
  const people = [
    { account_id: 'a1', email: 'owner@example.com', role: 'owner' },
    { account_id: 'a2', email: 'member@example.com', role: 'member' },
    { account_id: 'a3', email: 'viewer@example.com', role: 'viewer' },
  ];
  const account = { id: 'a1', email: 'owner@example.com' };
  const grants = [
    {
      account_id: 'a4',
      email: 'grant@example.com',
      name: 'Jonas',
      role: 'viewer',
      canvas_path: 'ui/Homepage.tsx',
    },
  ];
  const invites = [
    { email: 'new@example.com', role: 'observer', canvas_path: null, expires_at: 1760000000000 },
  ];
  return [
    peoplePage({ account, project, people, grants, invites, isOwner: true }),
    peoplePage({ account: { id: 'a3' }, project, people, grants, invites, isOwner: false }),
    peoplePage({ account, project, people, isOwner: true, error: 'That is not an email address.' }),
    peoplePage({ account, project, people, isOwner: true, notice: 'Invitation sent.' }),
    removeConfirmPage({ account, project, person: people[1], tokenTtlMs: 12 * 3_600_000 }),
  ].join('\n');
}
