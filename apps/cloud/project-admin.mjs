// Running your own project — Cloud Phase 20 (+ the Phase 19 settings half).
//
// Four surfaces, one rule: a customer runs their whole relationship — the
// full copy, deletion, the record of who did what, and where the work mirrors
// to — with no email to support and no terminal.
//
//   /projects/<id>/download   the take-your-work-home copy (DDR-202). Offered
//                             in EVERY state; the delete flow depends on it.
//   /projects/<id>/delete     the only path to `purged`, and it goes THROUGH
//                             a completed export (DDR-193 §3) — a delete
//                             button with no copy behind it is a promise the
//                             product cannot keep.
//   /projects/<id>/audit      the customer-visible record (DDR-193 §4 — "you
//                             can see that we looked" is the control).
//   /projects/<id>/mirror     where the history pushes to on GitHub (Phase 19
//                             T3). Config lives HERE; the cell asks for it on
//                             every tick, so saving needs no restart.

import { track } from './analytics.mjs';
import { appShell, DESKTOP_DOWNLOAD_URL } from './brand.mjs';
import { mintProjectToken } from './cell-token.mjs';
import { STATE_COPY } from './dashboard.mjs';
import { audit } from './db.mjs';
import {
  backupContents,
  DEFAULT_DESIGN_FOLDER,
  modeConsequence,
  validateDesignSync,
} from './design-sync.mjs';
import { validateTarget } from './mirror.mjs';
import { ACCESS_MESSAGES, can, decideAccess } from './project-access.mjs';
import { removeCellDomain } from './provision.mjs';
import { purgeTenantObjects } from './purge.mjs';

const CSS = `
  table { width: 100%; border-collapse: collapse; margin: var(--space-4) 0 var(--space-6); background: var(--bg-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
  table { border-spacing: 0; overflow: hidden; }
  th { text-align: left; font-family: var(--font-mono); font-size: var(--type-xs); text-transform: uppercase; letter-spacing: .06em; color: var(--fg-2); padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--border-subtle); }
  td { padding: var(--space-3) var(--space-5); border-top: 1px solid var(--border-subtle); vertical-align: baseline; font-size: var(--type-base); }
  tr:first-child td { border-top: 0; }
  td.right { text-align: right; white-space: nowrap; }
  .mono { font-family: var(--font-mono); font-size: var(--type-sm); }
  .card { margin-bottom: var(--space-5); }
  .danger { border-color: color-mix(in oklab, var(--status-error) 40%, transparent); }
  .danger h2 { color: var(--status-error); }
  time { color: var(--fg-2); font-size: var(--type-sm); }
`;

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/**
 * Wrap one project surface in the admin shell: project nav on the left, the
 * project's state pill next to the title — the person always knows where they
 * are and what state the thing they're managing is in.
 */
function page(title, body, { account, project, isOwner, active, lede = null } = {}) {
  const copy = project ? (STATE_COPY[project.state] ?? null) : null;
  return appShell({
    account,
    title,
    body,
    project,
    isOwner,
    active,
    lede,
    pill: copy ? { tone: copy.tone, label: copy.label } : null,
    extraCss: CSS,
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      'referrer-policy': 'no-referrer',
    },
  });
}

function redirect(to) {
  return new Response(null, { status: 303, headers: { location: to } });
}

function when(ms) {
  return `${new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/** `tenants/<id>/exports/<stamp>/<name>` → { stamp, name }, or null. */
export function parseExportKey(key, projectId) {
  const m = String(key).match(
    new RegExp(`^tenants/${projectId}/exports/(\\d{8}T\\d{6}Z)/([A-Za-z0-9._-]+)$`)
  );
  return m ? { stamp: m[1], name: m[2] } : null;
}

// ------------------------------------------------------------------ download

export function downloadPage({
  account,
  project,
  generations,
  isOwner,
  error = null,
  notice = null,
}) {
  const rows = generations
    .map(
      (g) => `<tr>
        <td class="mono">${esc(g.stamp)}</td>
        <td>${g.files
          .map(
            (f) =>
              `<a href="/projects/${esc(project.id)}/download/file?g=${encodeURIComponent(g.stamp)}&amp;f=${encodeURIComponent(f.name)}">${esc(f.name)}</a>`
          )
          .join(' · ')}</td>
        <td class="right">${(g.bytes / 1_000_000).toFixed(1)} MB</td>
      </tr>`
    )
    .join('\n');
  return page(
    'Download everything',
    `${error ? `<p class="error">${esc(error)}</p>` : ''}
     ${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
     ${
       isOwner
         ? `<form method="post" action="/projects/${esc(project.id)}/download">
              <button type="submit">Prepare a fresh copy</button>
              <span class="quiet" style="margin-left:var(--space-4)">takes a moment for large projects</span>
            </form>`
         : '<p class="quiet">Only the project’s owner can prepare and download the full copy.</p>'
}
     ${
       // The table is OWNER-ONLY, like the button above it and like the file
       // route below it (`/download/file` answers 404 to anyone else). It used
       // to render for every member: a list of live-looking links that the
       // server had already decided to refuse. Offering a door you know is
       // locked is worse than not drawing it — the member reads "broken", the
       // owner reads nothing at all.
       !isOwner
         ? ''
         : generations.length
           ? `<table><thead><tr><th>Taken</th><th>Files</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
           : '<p class="quiet" style="margin-top:var(--space-5)">No copy has been prepared yet.</p>'
}
     <div class="card" style="margin-top:var(--space-6)">
       <h2>What you are downloading</h2>
       <p class="quiet" style="margin:0">One file holding every design and every version of it,
         and a list of your media alongside it. It is a developer archive — a git bundle — not a
         folder you can double-click: anyone who writes software can unpack it in a minute, and so
         can the Maude app. It needs nothing from us, and it does not expire.</p>
     </div>`,
    {
      account,
      project,
      isOwner,
      active: 'download',
      // Cloud Phase 24 A6. This lede used to end "It opens without Maude" —
      // true for an engineer, false for the person the whole arc is staked on,
      // and said on the one page a LEAVING customer must use. The format did
      // not change (a bundle is what keeps the history rather than a snapshot),
      // so the sentence does, and the card below names who can open it.
      lede: `A complete copy of ${project.name}: every design and every version of it, plus a list of your media. Taking a copy changes nothing here — the project keeps running exactly as it is.`,
    }
  );
}

// ------------------------------------------------------------------- connect

/**
 * The last door (Cloud Phase 23 A1). "Open" used to be a bare link to the
 * workspace hostname — which greets a customer with an operator console. This
 * page is honest about how to get in TODAY.
 *
 * ONE DOOR, DELIBERATELY (Cloud Phase 24 A2). There used to be a second card
 * telling the customer to sign in at their project's own address with a
 * "workspace email and password" — a credential NO customer is ever issued
 * (only a derived `PILOT_ADMIN_EMAIL` exists, apps/cells/cell-do.mjs). A page
 * that instructs an impossible action is worse than a page with one door, so
 * the card is gone rather than reworded, and the same goes for the pointer at
 * the workspace's operator console: it is behind the same credential.
 *
 * The second door comes back in Cloud Phase 25 (B5) as Maude Studio in the
 * browser, behind THIS account — canvas board C2 draws the finished state.
 */
export function connectPage({ account, project, isOwner, cellZone }) {
  // Defaulted HERE rather than in the signature: a caller that passes an
  // explicit `undefined` (an unset Worker var) would otherwise sail past a
  // parameter default and render `https://<id>.undefined`.
  const zone = cellZone || 'cloud.maude.sh';
  return page(
    `Open ${project.name}`,
    `<div class="card">
       <h2>In the Maude app</h2>
       <p class="quiet">One click — the app opens this project signed in as you. Nothing to
         copy, nothing to paste. This is where you make things.</p>
       <form method="post" action="/projects/${esc(project.id)}/handoff" style="margin:0">
         <button type="submit">Open in Maude</button>
       </form>
       <p class="quiet" style="margin:var(--space-3) 0 0">Don’t have the app yet?
         <a href="${DESKTOP_DOWNLOAD_URL}">Get it at maude.sh/desktop</a>, then come back and
         press the button.</p>
     </div>
     <div class="card">
       <h2>In your browser</h2>
       <p class="quiet">The same Maude, in a tab — the canvases, the design system, comments
         and history. No install. The agent stays in the app, because it runs on your own
         machine.</p>
       <a class="button" href="https://${esc(project.id)}.${esc(zone)}">Open in the browser</a>
     </div>`,
    { account, project, isOwner, active: 'connect' }
  );
}

// -------------------------------------------------------------------- saving

/**
 * How the project saves (plan T33, DDR-241). The owner's switch from "every
 * app writes the shared copy" to accepted revisions — truthful saving, a
 * project history and personal undo — with the exact import previewed first.
 * The platform asks the cell on the owner's behalf with a short-lived owner
 * token, the same lane the export uses.
 */
export function savingPage({
  account,
  project,
  state = null,
  preview = null,
  notice = null,
  error = null,
}) {
  const mode = state?.mode ?? null;
  const on = mode === 'transactions';
  const skipped = preview?.imported?.skipped ?? [];
  const previewCard = preview
    ? `<div class="card">
         <h2>What switching would bring over</h2>
         <p class="quiet" style="margin:0">${esc(String(preview.imported?.created ?? 0))} canvases,
           ${esc(String(preview.imported?.dirs ?? 0))} folders. Nothing has changed yet.</p>
         ${
           skipped.length
             ? `<p style="margin-top:var(--space-3)">Not included (they stay in the project files):</p>
                <ul>${skipped
                  .slice(0, 20)
                  .map(
                    (s) =>
                      `<li><code>${esc(String(s.doc ?? ''))}</code> — ${esc(String(s.reason ?? ''))}</li>`
                  )
                  .join('')}</ul>`
             : ''
}
         <form method="post" action="/projects/${esc(project.id)}/saving" style="margin-top:var(--space-4)">
           <input type="hidden" name="do" value="switch">
           <input type="hidden" name="epoch" value="${esc(String(preview.epoch ?? state?.epoch ?? 0))}">
           <button type="submit">Switch to accepted revisions</button>
         </form>
       </div>`
    : '';
  return page(
    `How ${project.name} saves`,
    `${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
     ${error ? `<p class="error">${esc(error)}</p>` : ''}
     <div class="card">
       <h2>${on ? 'Accepted revisions — on' : mode ? 'Shared copy (classic)' : 'Unknown'}</h2>
       <p class="quiet" style="margin:0">${
         on
           ? 'Every change is saved to the project and confirmed before anyone is told it is saved. History lists each action with its author; Undo takes back only your own.'
           : mode
             ? 'Every app writes the shared copy directly. Switching keeps all the work and adds truthful saving, a project history and personal undo. Designers’ apps need the latest Maude.'
             : 'The workspace did not answer. Open it once so it wakes, then come back.'
}</p>
       ${
         mode && !on && !preview
           ? `<form method="post" action="/projects/${esc(project.id)}/saving" style="margin-top:var(--space-4)">
                <input type="hidden" name="do" value="preview">
                <button type="submit">Preview the switch</button>
              </form>`
           : ''
}
     </div>
     ${previewCard}`,
    { account, project, isOwner: true, active: 'saving' }
  );
}

// -------------------------------------------------------------------- delete

export function deletePage({ account, project, hasExport, error = null }) {
  const body = hasExport
    ? `<div class="card danger">
         <h2>This is permanent</h2>
         <ul style="margin:var(--space-2) 0 0;padding-left:var(--space-6)">
           <li>The workspace and its address stop existing.</li>
           <li>Billing stops — nothing further is charged.</li>
           <li><strong>Everything is erased from our computers, including the copies prepared
             on the download page.</strong> Make sure the one you want is already on your
             machine.</li>
           <li>The copy you downloaded stays yours, forever.</li>
         </ul>
       </div>
       <form method="post" action="/projects/${esc(project.id)}/delete">
         <label style="font-weight:400"><input type="checkbox" name="sure" value="yes" required>
           I have my copy, and I want ${esc(project.name)} deleted.</label>
         <p style="margin-top:var(--space-4)">
           <button type="submit">Delete this project</button>
           <a href="/" style="margin-left:var(--space-5)">Cancel</a>
         </p>
       </form>`
    : // Cloud Phase 24 A6. The gate used to demand a copy and then send the
      // customer off to go and find the page that makes one. A gate that sends
      // somebody hunting for the thing it just demanded is a gate that gets
      // abandoned, so the button that starts it lives HERE (canvas board E1).
      `<div class="card">
         <h2>Download your copy first</h2>
         <p class="quiet">Deleting is permanent, so it is only offered once a complete copy of your
           work exists. It takes a minute and it is yours to keep.</p>
         <form method="post" action="/projects/${esc(project.id)}/download" style="margin:0">
           <button type="submit">Prepare my copy now</button>
           <span class="quiet" style="margin-left:var(--space-4)">no need to go and find the
             download page</span>
         </form>
       </div>
       <p class="quiet"><a href="/projects/${esc(project.id)}/download">See copies you already
         prepared</a></p>`;
  return page(
    `Delete ${project.name}?`,
    `${error ? `<p class="error">${esc(error)}</p>` : ''}
     ${body}`,
    { account, project, isOwner: true, active: 'delete' }
  );
}

// --------------------------------------------------------------------- audit

/** Our internal action names, said in the customer's language. */
export const AUDIT_COPY = {
  signup: 'Account created',
  'signup-google': 'Account created with Google',
  login: 'Signed in',
  'member.remove': 'Removed someone from the project',
  'member.role': 'Changed what someone can do',
  'invite.redeem': 'Accepted an invitation',
  'checkout.authorized': 'Payment details confirmed',
  'checkout.settled': 'Project came up — billing began',
  'checkout.voided': 'Setup failed — the card was released',
  'grant-minted': 'Opened the project from a new device',
  reconcile: 'Routine platform check',
  'reconcile-failed': 'A platform check hit a problem',
  'export.prepared': 'A full copy was prepared',
  'project.deleted': 'The project was deleted',
  'mirror.configured': 'GitHub copy connected',
  'mirror.disconnected': 'GitHub copy disconnected',
  // Cloud Phase 26 — the platform's own operator, in the customer's words. A
  // raw action key on this page would tell somebody that we looked without
  // telling them what we did, which is the wrong half.
  'operator.board.viewed': 'Maude looked at the platform-wide project list',
  'operator.projects.viewed': 'Maude looked at the platform-wide project list',
  'operator.accounts.viewed': 'Maude looked at the platform-wide account list',
  'operator.events.viewed': 'Maude looked at platform-wide usage figures',
  'operator.project.viewed': 'Maude opened this project’s record',
  'operator.reconcile.nudged': 'Maude asked the platform to re-check this project',
};

export function auditPage({ account, project, isOwner, entries }) {
  const rows = entries
    .map(
      (e) => `<tr>
        <td>${esc(AUDIT_COPY[e.action] ?? e.action)}</td>
        <td class="quiet">${esc(String(e.actor).replace(/^customer:/, ''))}</td>
        <td>${e.reason ? esc(e.reason) : '<span class="quiet">—</span>'}</td>
        <td class="right"><time>${when(e.at)}</time></td>
      </tr>`
    )
    .join('\n');
  return page(
    'Activity',
    entries.length
      ? `<table><thead><tr><th>What</th><th>Who</th><th>Why</th><th>When</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="quiet">Nothing yet.</p>',
    {
      account,
      project,
      isOwner,
      active: 'audit',
      lede: 'Everything that happened to this project — by you, by people you invited, and by the platform itself. If we ever touch your project, it shows up here, with the reason we gave at the time.',
    }
  );
}

// -------------------------------------------------------------------- mirror

export function mirrorPage({
  account,
  project,
  repository,
  branch,
  mode = 'backup',
  folder = null,
  isOwner,
  error = null,
  notice = null,
}) {
  // D2 — THE MODE IS A VISIBLE CHOICE, and each option states its consequence
  // BEFORE Save. A person pointing this at the repository their website
  // deploys from has to be able to predict what lands next to it; "mirror"
  // alone does not tell them, and finding out afterwards is the wrong moment.
  const repoLabel = repository || 'your repository';
  const backup = modeConsequence('backup', { repo: repoLabel });
  const sync = modeConsequence('design-sync', { repo: repoLabel, folder: folder || 'design' });
  const contents = backupContents({ seededFrom: project.seed_repo ?? null });
  const form = isOwner
    ? `<form method="post" action="/projects/${esc(project.id)}/mirror">
         <label for="repository">GitHub repository</label>
         <input type="text" id="repository" name="repository" placeholder="owner/name"
                value="${esc(repository ?? '')}" pattern="[^/]+/[^/]+">
         <label for="branch">Branch</label>
         <input type="text" id="branch" name="branch" value="${esc(branch ?? 'main')}">

         <fieldset style="margin-top:var(--space-5);border:0;padding:0">
           <legend class="quiet">What gets copied</legend>
           <label style="display:block;margin-top:var(--space-3)">
             <input type="radio" name="mode" value="backup" ${mode !== 'design-sync' ? 'checked' : ''}>
             <strong>${esc(backup.label)}</strong>
           </label>
           <p class="quiet" style="margin-left:1.6rem">${esc(backup.what)} ${esc(backup.touches)}<br>
             <em>${esc(contents.summary)}</em> ${esc(contents.detail)}</p>
           <label style="display:block;margin-top:var(--space-4)">
             <input type="radio" name="mode" value="design-sync" ${mode === 'design-sync' ? 'checked' : ''}>
             <strong>${esc(sync.label)}</strong>
           </label>
           <p class="quiet" style="margin-left:1.6rem">${esc(sync.what)} ${esc(sync.touches)}</p>
           <label for="folder" style="margin-left:1.6rem">Folder</label>
           <input type="text" id="folder" name="folder" style="margin-left:1.6rem"
                  placeholder="${esc(DEFAULT_DESIGN_FOLDER)}" value="${esc(folder ?? '')}">
         </fieldset>

         <p style="margin-top:var(--space-4)">
           <button type="submit" name="do" value="save">Save</button>
           ${repository ? '<button type="submit" name="do" value="disconnect" class="ghost" style="margin-left:var(--space-4)">Disconnect</button>' : ''}
         </p>
       </form>
       <p class="quiet">Either way, this runs about once an hour. First
         <a href="https://github.com/apps/maude-mirror">give the Maude Mirror app access</a>
         to the repository on GitHub — that page opens on GitHub; come back here and save
         when it's done.</p>`
    : '<p class="quiet">Only the project’s owner can change where it copies to.</p>';
  return page(
    'Copy to GitHub',
    `${error ? `<p class="error">${esc(error)}</p>` : ''}
     ${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
     <div class="card">${form}</div>`,
    {
      account,
      project,
      isOwner,
      active: 'mirror',
      lede: repository
        ? mode === 'design-sync'
          ? `This project opens a pull request on ${repository} that keeps ${folder || 'design'}/ up to date.`
          : `This project keeps a copy of its history at ${repository} on the “${branch ?? 'main'}” branch.`
        : 'Keep an automatic copy of this project’s history in a GitHub repository you own.',
    }
  );
}

// -------------------------------------------------------------------- routes

async function loadAccess(env, projectId, accountId) {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId)
    .first();
  const rows = await env.DB.prepare(
    'SELECT account_id, role FROM project_members WHERE project_id = ?'
  )
    .bind(projectId)
    .all();
  const verdict = decideAccess({ accountId, project, members: rows?.results ?? [] });
  return { project, verdict };
}

/** Group a flat R2 listing into export generations, newest first. */
export function exportGenerations(keys, projectId) {
  const byStamp = new Map();
  for (const { key, size } of keys) {
    const parsed = parseExportKey(key, projectId);
    if (!parsed) continue;
    const g = byStamp.get(parsed.stamp) ?? { stamp: parsed.stamp, files: [], bytes: 0 };
    g.files.push({ name: parsed.name, key });
    g.bytes += size ?? 0;
    byStamp.set(parsed.stamp, g);
  }
  return [...byStamp.values()].sort((a, b) => b.stamp.localeCompare(a.stamp));
}

async function listExports(env, projectId) {
  if (!env.EXPORTS) return [];
  const listed = await env.EXPORTS.list({ prefix: `tenants/${projectId}/exports/`, limit: 500 });
  return exportGenerations(
    (listed?.objects ?? []).map((o) => ({ key: o.key, size: o.size })),
    projectId
  );
}

/**
 * Does the cell say this project has nothing to hand back?
 *
 * Only `code: 'no-history'` counts. A packaging failure is also a 409 and must
 * NOT be read as "nothing to export" — that confusion is how a project full of
 * work reaches `purged` with no copy, the one thing DDR-193 §3 forbids.
 */
async function cellHasNothingToExport(env, projectId, account) {
  if (!env.CELL_SECRET_MASTER) return false;
  try {
    const { token } = await mintProjectToken({
      master: env.CELL_SECRET_MASTER,
      project: projectId,
      email: account.email,
      role: 'owner',
      ttlMs: 5 * 60 * 1000,
    });
    const res = await fetch(
      `https://${projectId}.${env.CELL_ZONE ?? 'cloud.maude.sh'}/api/export`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(60_000),
      }
    );
    if (res.status !== 409) return false;
    const body = await res.json().catch(() => ({}));
    return body?.code === 'no-history';
  } catch {
    return false;
  }
}

/**
 * Route the per-project admin surfaces. Returns a Response, or null.
 */
export async function handleProjectAdminRoutes(request, env, { account, ctx = null } = {}) {
  const url = new URL(request.url);
  const m = url.pathname.match(
    /^\/projects\/([a-z0-9-]+)\/(connect|download|delete|audit|mirror|saving)(\/file)?$/
  );
  if (!m) return null;
  const [, projectId, surface, isFile] = m;
  if (!account) return redirect('/login');

  const { project, verdict } = await loadAccess(env, projectId, account.id);
  if (!verdict.ok) {
    return html(
      `<p>${ACCESS_MESSAGES[verdict.reason]}</p>`,
      verdict.reason === 'not-signed-in' ? 401 : 404
    );
  }
  const isOwner = can(verdict.role, 'delete');

  // ----------------------------------------------------------------- connect
  if (surface === 'connect' && request.method === 'GET') {
    return html(connectPage({ account, project, isOwner, cellZone: env.CELL_ZONE }));
  }

  // ---------------------------------------------------------------- download
  if (surface === 'download' && isFile && request.method === 'GET') {
    if (!isOwner) return html(`<p>${ACCESS_MESSAGES['no-access']}</p>`, 404);
    // The page links by generation + filename; the storage key — which
    // carries OUR namespace vocabulary — is composed here and never leaves.
    const stamp = String(url.searchParams.get('g') ?? '');
    const name = String(url.searchParams.get('f') ?? '');
    const key = `tenants/${projectId}/exports/${stamp}/${name}`;
    if (!parseExportKey(key, projectId) || !env.EXPORTS) {
      return html(`<p>${ACCESS_MESSAGES['no-access']}</p>`, 404);
    }
    const object = await env.EXPORTS.get(key);
    if (!object) return html(`<p>${ACCESS_MESSAGES['no-access']}</p>`, 404);
    // The one moment that proves the portability promise is being used. The
    // FILENAME is deliberately not recorded — it is the customer's own
    // namespace, and the operational fact is that a copy left, not which one.
    track(env, ctx, {
      name: 'export_downloaded',
      accountId: account.id,
      projectId,
      props: { kind: 'file' },
    });
    return new Response(object.body, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
      },
    });
  }

  if (surface === 'download' && request.method === 'GET') {
    return html(
      downloadPage({ account, project, generations: await listExports(env, projectId), isOwner })
    );
  }

  if (surface === 'download' && request.method === 'POST') {
    if (!isOwner) return html(`<p>${ACCESS_MESSAGES['no-access']}</p>`, 404);
    // The platform asks the CELL on the owner's behalf, with a token the cell
    // verifies offline — same lane a future in-workspace button would use.
    const { token } = await mintProjectToken({
      master: env.CELL_SECRET_MASTER ?? '',
      project: projectId,
      email: account.email,
      role: 'owner',
      ttlMs: 10 * 60 * 1000,
    });
    let outcome = null;
    try {
      const res = await fetch(
        `https://${projectId}.${env.CELL_ZONE ?? 'cloud.maude.sh'}/api/export`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(120_000),
        }
      );
      outcome = { status: res.status, body: await res.json().catch(() => ({})) };
    } catch (err) {
      outcome = { status: 0, body: { error: err.message } };
    }
    const generations = await listExports(env, projectId);

    // A BRAND-NEW PROJECT HAS NOTHING TO HAND BACK, and that is not a failure.
    // The 409 is reported honestly instead of as a 502 "could not be prepared".
    //
    // NOTHING IS STAMPED HERE. An earlier cut recorded `export_sent_at` so the
    // delete gate would open — and that flag never re-arms, so a project that
    // was empty on day one and full of work by month three would have walked
    // through a gate that promised "only offered once a complete copy exists".
    // Emptiness is a fact about NOW; it is re-established at the gate itself.
    if (outcome.status === 409 && outcome.body?.code === 'no-history') {
      return html(
        downloadPage({
          account,
          project,
          generations,
          isOwner,
          notice:
            'There is nothing to download yet — no work has been saved in this project. ' +
            'You can delete it whenever you like.',
        })
      );
    }

    if (outcome.status !== 200) {
      console.error(`[export] ${projectId}: ${outcome.status} ${outcome.body?.error ?? ''}`);
      return html(
        downloadPage({
          account,
          project,
          generations,
          isOwner,
          error:
            'The copy could not be prepared right now' +
            (outcome.body?.error ? ` — ${outcome.body.error}` : '') +
            '. Try again in a minute.',
        }),
        502
      );
    }
    await env.DB.prepare('UPDATE projects SET export_sent_at = ? WHERE id = ?')
      .bind(Date.now(), projectId)
      .run();
    await audit(env.DB, {
      accountId: account.id,
      projectId,
      actor: `customer:${account.email}`,
      action: 'export.prepared',
      detail: outcome.body.prefix,
    });
    track(env, ctx, {
      name: 'export_downloaded',
      accountId: account.id,
      projectId,
      props: { kind: 'generation' },
    });
    return html(
      downloadPage({
        account,
        project,
        generations: await listExports(env, projectId),
        isOwner,
        notice: 'Your copy is ready below.',
      })
    );
  }

  // ------------------------------------------------------------------ delete
  if (surface === 'delete') {
    if (!isOwner) return html(`<p>${ACCESS_MESSAGES['no-access']}</p>`, 404);
    const generations = await listExports(env, projectId);
    // A prepared copy, OR the project having nothing to copy — established
    // LIVE, at the gate, not from a flag set at some point in the past.
    //
    // A stored `export_sent_at` cannot carry this: it never re-arms, so a
    // project that was empty in January would still open the gate in June with
    // six months of work behind it and no copy anywhere. Emptiness is a fact
    // about the project right now, so it is asked right now — and the answer
    // must be the cell's structured `no-history`, never a 409 on its own,
    // because the cell also answers 409 when packaging real work FAILS.
    //
    // Fails CLOSED: an unreachable cell, a missing code (a cell image older
    // than the field), or any other refusal leaves the gate shut. That costs
    // an empty project's owner a retry; the alternative costs somebody their
    // work.
    const hasExport =
      generations.length > 0 || (await cellHasNothingToExport(env, projectId, account));

    if (request.method === 'GET') return html(deletePage({ account, project, hasExport }));
    if (request.method !== 'POST') return html('<p>Not allowed.</p>', 405);

    if (!hasExport) return html(deletePage({ account, project, hasExport }), 409);
    const form = await request.formData();
    if (form.get('sure') !== 'yes') {
      return html(
        deletePage({ account, project, hasExport, error: 'Tick the box to confirm.' }),
        400
      );
    }

    // Billing stops FIRST — a deletion that keeps charging is the worst order.
    if (project.subscription_id && env.STRIPE_SECRET_KEY) {
      const res = await fetch(
        `https://api.stripe.com/v1/subscriptions/${project.subscription_id}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
        }
      );
      if (!res.ok && res.status !== 404) {
        return html(
          deletePage({
            account,
            project,
            hasExport,
            error: 'Billing could not be stopped, so nothing was deleted. Try again in a minute.',
          }),
          502
        );
      }
    }
    await env.DB.prepare(
      `UPDATE projects SET state = 'purged', state_since = ?, cell_running = 0 WHERE id = ?`
    )
      .bind(Date.now(), projectId)
      .run();
    await audit(env.DB, {
      accountId: account.id,
      projectId,
      actor: `customer:${account.email}`,
      action: 'project.deleted',
    });
    track(env, ctx, { name: 'delete_requested', accountId: account.id, projectId });
    // The bytes, not just the row (Cloud Phase 24 B4). Until this line, delete
    // stopped billing and left `tenants/<id>/` in storage forever — the one
    // thing that must not be true for a product whose pitch is "you can
    // leave". Failure is recorded and re-runnable rather than thrown: a purge
    // that half-completed must be visible, not a 500 over a row that already
    // says deleted.
    const purged = await purgeTenantObjects(env.EXPORTS, projectId);
    await audit(env.DB, {
      accountId: account.id,
      projectId,
      actor: 'system',
      action: purged.ok ? 'project.purged' : 'project.purge-failed',
      detail: purged.ok ? `${purged.deleted} objects` : purged.reason,
    });
    // The address stops answering. Best-effort — a leftover route serves 404s
    // from the cell worker, not somebody's data.
    await removeCellDomain(env, projectId);
    return redirect('/');
  }

  // ------------------------------------------------------------------ saving
  if (surface === 'saving') {
    if (!isOwner) return html(`<p>${ACCESS_MESSAGES['no-access']}</p>`, 404);
    const cell = `https://${projectId}.${env.CELL_ZONE ?? 'cloud.maude.sh'}/api/projects/current/v1/mode`;
    const ask = async (method, body) => {
      const { token } = await mintProjectToken({
        master: env.CELL_SECRET_MASTER ?? '',
        project: projectId,
        email: account.email,
        role: 'owner',
        ttlMs: 5 * 60 * 1000,
      });
      const res = await fetch(cell, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(120_000),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const current = await ask('GET').catch(() => null);
    const state = current?.status === 200 ? current.body : null;
    if (request.method === 'GET') return html(savingPage({ account, project, state }));
    if (request.method !== 'POST') return html('<p>Not allowed.</p>', 405);
    const form = await request.formData();
    if (form.get('do') === 'preview') {
      const r = await ask('POST', { mode: 'transactions', dryRun: true }).catch(() => null);
      if (r?.status !== 200)
        return html(
          savingPage({
            account,
            project,
            state,
            error: r?.body?.error || 'The workspace did not answer.',
          }),
          502
        );
      return html(savingPage({ account, project, state, preview: r.body }));
    }
    if (form.get('do') === 'switch') {
      const expectEpoch = Number(form.get('epoch'));
      const r = await ask('POST', {
        mode: 'transactions',
        ...(Number.isSafeInteger(expectEpoch) ? { expectEpoch } : {}),
      }).catch(() => null);
      await audit(env.DB, {
        accountId: account.id,
        projectId,
        actor: `customer:${account.email}`,
        action: r?.status === 200 ? 'project.saving-switched' : 'project.saving-switch-failed',
        detail:
          r?.status === 200
            ? `epoch ${r.body?.epoch}`
            : String(r?.body?.code ?? r?.status ?? 'unreachable'),
      });
      if (r?.status !== 200)
        return html(
          savingPage({
            account,
            project,
            state,
            error: r?.body?.error || 'The switch did not happen — nothing changed.',
          }),
          502
        );
      return html(
        savingPage({
          account,
          project,
          state: { mode: r.body?.mode, epoch: r.body?.epoch },
          notice: `Switched. ${r.body?.imported?.created ?? 0} canvases are now saved as accepted revisions.`,
        })
      );
    }
    return html('<p>Unknown action.</p>', 400);
  }

  // ------------------------------------------------------------------- audit
  if (surface === 'audit' && request.method === 'GET') {
    // Cloud Phase 26 — `reason` joins the select. The column has existed since
    // Phase 7 ("an access with no stated reason is the one worth noticing")
    // and was never displayed, which made it a field nobody had a reason to
    // fill in honestly. Now that an operator surface writes to it, the page
    // that promises "you can see that we looked" has to show WHY we looked.
    //
    // AND THE FLEET-WIDE READS TOO. The operator board's list views span every
    // tenant, so they are recorded with no project_id — which meant the reads
    // that touch EVERYONE were exactly the ones no customer could ever see,
    // inverting the promise (attacker review, 2026-08-04). They are unioned in
    // here: a cross-tenant read is a read of this project, whatever column it
    // happened to be filed under.
    const rows = await env.DB.prepare(
      `SELECT at, actor, action, reason FROM audit_log WHERE project_id = ?
       UNION ALL
       SELECT at, actor, action, reason FROM audit_log
        WHERE project_id IS NULL AND actor LIKE 'operator:%'
       ORDER BY at DESC LIMIT 200`
    )
      .bind(projectId)
      .all();
    return html(auditPage({ account, project, isOwner, entries: rows?.results ?? [] }));
  }

  // ------------------------------------------------------------------ mirror
  if (surface === 'mirror') {
    const view = {
      account,
      project,
      repository: project.mirror_repo,
      branch: project.mirror_branch ?? 'main',
      mode: project.mirror_mode === 'design-sync' ? 'design-sync' : 'backup',
      folder: project.mirror_folder ?? null,
      isOwner: can(verdict.role, 'mirror'),
    };
    if (request.method === 'GET') return html(mirrorPage(view));
    if (request.method !== 'POST') return html('<p>Not allowed.</p>', 405);
    if (!view.isOwner) return html(`<p>${ACCESS_MESSAGES['no-access']}</p>`, 404);

    const form = await request.formData();
    if (form.get('do') === 'disconnect') {
      await env.DB.prepare(
        'UPDATE projects SET mirror_repo = NULL, mirror_branch = NULL, mirror_mode = NULL, mirror_folder = NULL WHERE id = ?'
      )
        .bind(projectId)
        .run();
      await audit(env.DB, {
        accountId: account.id,
        projectId,
        actor: `customer:${account.email}`,
        action: 'mirror.disconnected',
      });
      return html(
        mirrorPage({
          ...view,
          repository: null,
          branch: 'main',
          notice: 'Disconnected. Nothing already pushed was touched.',
        })
      );
    }

    const checked = validateTarget({
      repo: String(form.get('repository') ?? ''),
      branch: String(form.get('branch') ?? 'main'),
    });
    if (!checked.ok) {
      return html(mirrorPage({ ...view, error: checked.errors.join(' ') }), 400);
    }
    // D1/D2 — the MODE is saved with the target, and design-sync's folder is
    // validated by the same module the cell performs it with: a folder the
    // dashboard accepts and the cell then refuses would be a promise broken
    // an hour later, out of sight.
    const mode = String(form.get('mode') ?? 'backup') === 'design-sync' ? 'design-sync' : 'backup';
    let folder = null;
    if (mode === 'design-sync') {
      const syncCheck = validateDesignSync({
        folder: String(form.get('folder') ?? '') || undefined,
        baseBranch: checked.target.branch,
      });
      if (!syncCheck.ok) {
        return html(mirrorPage({ ...view, mode, error: syncCheck.errors.join(' ') }), 400);
      }
      folder = syncCheck.target.folder;
    }
    await env.DB.prepare(
      'UPDATE projects SET mirror_repo = ?, mirror_branch = ?, mirror_mode = ?, mirror_folder = ? WHERE id = ?'
    )
      .bind(checked.target.full, checked.target.branch, mode, folder, projectId)
      .run();
    await audit(env.DB, {
      accountId: account.id,
      projectId,
      actor: `customer:${account.email}`,
      action: 'mirror.configured',
      detail: `${checked.target.full}#${checked.target.branch} (${mode}${folder ? `:${folder}` : ''})`,
    });
    return html(
      mirrorPage({
        ...view,
        repository: checked.target.full,
        branch: checked.target.branch,
        mode,
        folder,
        // The confirmation names the CONSEQUENCE, not just the fact — the
        // person just chose between two shapes and should see which one took.
        notice:
          mode === 'design-sync'
            ? `Saved. Within the hour Maude opens a pull request putting your designs in ${folder}/.`
            : 'Saved. The first push happens within the hour.',
      })
    );
  }

  return html('<p>Not allowed.</p>', 405);
}

/** Every customer-facing string here, for the vocabulary lint. */
export function allProjectAdminHtml() {
  const project = { id: 'alligators', name: 'Brno Alligators' };
  const generations = [
    {
      stamp: '20260730T120000Z',
      bytes: 12_345_678,
      files: [
        { name: 'repo.bundle', key: 'tenants/alligators/exports/20260730T120000Z/repo.bundle' },
        { name: 'MANIFEST.md', key: 'tenants/alligators/exports/20260730T120000Z/MANIFEST.md' },
      ],
    },
  ];
  const account = { email: 'a@example.com' };
  return [
    connectPage({ account, project, isOwner: true }),
    downloadPage({ account, project, generations, isOwner: true }),
    downloadPage({ account, project, generations: [], isOwner: false }),
    downloadPage({
      account,
      project,
      generations,
      isOwner: true,
      error: 'The copy could not be prepared right now. Try again in a minute.',
    }),
    downloadPage({
      account,
      project,
      generations,
      isOwner: true,
      notice: 'Your copy is ready below.',
    }),
    deletePage({ account, project, hasExport: true }),
    deletePage({ account, project, hasExport: false }),
    deletePage({ account, project, hasExport: true, error: 'Tick the box to confirm.' }),
    auditPage({
      account,
      project,
      isOwner: true,
      entries: [
        { at: 1753872000000, actor: 'customer:a@b.c', action: 'checkout.settled' },
        { at: 1753872000000, actor: 'system', action: 'reconcile' },
      ],
    }),
    auditPage({ account, project, isOwner: true, entries: [] }),
    mirrorPage({ account, project, repository: '1aGh/alligators', branch: 'main', isOwner: true }),
    mirrorPage({ account, project, repository: null, branch: 'main', isOwner: false }),
    mirrorPage({
      account,
      project,
      repository: null,
      branch: 'main',
      isOwner: true,
      error: 'repository must be "owner/name" (not a URL)',
    }),
  ].join('\n');
}
