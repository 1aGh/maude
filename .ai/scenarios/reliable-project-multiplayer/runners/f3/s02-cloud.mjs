#!/usr/bin/env node
// S02 on the cloud cell — the cell half the 2026-09-22 control-plane subset did
// not cover, through real forms only:
//
//   • the owner invites a NEW designer (People page), who accepts on the real
//     /invite page (choose a password) and makes an accepted edit;
//   • the viewer reads but cannot write;
//   • the owner removes the new designer (People page): their cell session
//     can neither write nor read, the dashboard will not open the project for
//     them, and the work they made stays in history.
//
// The invitation link is read from the isolated test D1 (no mail delivery in
// the test control plane) — the analogue of opening the email.
//
//   F3_CLOUD_CREDS=<creds.json> node s02-cloud.mjs --out <dir>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasSource } from './backend.mjs';

const argv = process.argv.slice(2);
const out = argv[argv.indexOf('--out') + 1];
mkdirSync(out, { recursive: true });
const CONTROL = 'https://maude-multiplayer-control-test-20260922.maude1agh.workers.dev';
const ORIGIN = 'https://f3-cloud.multiplayer-test-20260922.maude.sh';
const PROJECT = 'f3-cloud';
const CLOUD_DIR = fileURLToPath(new URL('../../../../../apps/cloud/', import.meta.url));
const creds = JSON.parse(readFileSync(process.env.F3_CLOUD_CREDS, 'utf8'));
const tag = randomBytes(3).toString('hex');
const cEmail = `designer-c-${tag}@maude-f3.invalid`;
const cPassword = `F3-${randomBytes(15).toString('base64url')}`;

const ab = (session, ...a) =>
  execFileSync('agent-browser', ['--session', session, ...a], { encoding: 'utf8', timeout: 90000 });
const d1 = (sql) =>
  JSON.parse(
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'maude-multiplayer-test-20260922', '--remote', '--json', '--command', sql], {
      cwd: CLOUD_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    })
  )[0].results;

async function formSession(email, password) {
  const r = await fetch(`${CONTROL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password }),
    redirect: 'manual',
  });
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith('maude_session='));
  return cookie ?? null;
}
async function cellSession(email, password) {
  const cookie = await formSession(email, password);
  if (!cookie) return { signIn: 'refused' };
  const opened = await fetch(`${CONTROL}/projects/open`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ project: PROJECT }),
  });
  if (opened.status !== 200) return { open: opened.status };
  const { token } = await opened.json();
  for (let i = 0; i < 12; i++) {
    const login = await fetch(`${ORIGIN}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (login.status === 429) {
      await new Promise((r) => setTimeout(r, 15000));
      continue;
    }
    if (login.status !== 200) return { cellLogin: login.status };
    const b = await login.json();
    return { token: b.token, role: b.user?.role ?? null };
  }
  return { cellLogin: 429 };
}
const api = async (token, route, body) => {
  const r = await fetch(`${ORIGIN}/api/projects/current/v1/${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const propose = async (token, operations) => {
  const boot = await api(token, 'bootstrap');
  if (boot.status !== 200) return { status: boot.status, stage: 'bootstrap' };
  return api(token, 'proposals', {
    protocol: 1,
    projectId: boot.body.projectId,
    epoch: boot.body.epoch,
    transactionId: `tx_s02c_${randomUUID()}`,
    origin: { deviceId: 'f3-s02-cloud', sessionId: tag },
    action: { kind: 'edit', label: 'S02 cloud', operations },
  });
};
const signInBrowser = (session, who) => {
  ab(session, 'open', `${CONTROL}/login`);
  ab(session, 'fill', '#email', creds[who].email);
  ab(session, 'fill', '#password', creds[who].password);
  ab(session, 'click', 'form[action^="/auth/login"] button[type=submit]');
  ab(session, 'wait', '2500');
};

const result = { tag };
// ── the owner invites designer C (People page) ──
signInBrowser('maude-f3-owner', 'owner');
ab('maude-f3-owner', 'open', `${CONTROL}/projects/${PROJECT}/people`);
// requestSubmit: agent-browser's synthetic click does not submit this form.
ab(
  'maude-f3-owner',
  'eval',
  `(() => { const f = [...document.forms].find((x) => x.querySelector('button[value=invite]')); f.querySelector('input[name=email]').value = ${JSON.stringify(cEmail)}; f.requestSubmit(f.querySelector('button[value=invite]')); return 'ok'; })()`
);
ab('maude-f3-owner', 'wait', '3500');
// The test control plane cannot send mail, so the page shows the link itself.
const shown = /\/invite\/([0-9a-f-]{36})/.exec(ab('maude-f3-owner', 'get', 'text', 'main'))?.[1] ?? null;
const invite = d1(`SELECT id, role FROM project_invites WHERE email = '${cEmail}' ORDER BY created_at DESC LIMIT 1`)[0];
assert.ok(invite?.id, 'invitation row');
result.invite = { role: invite.role, linkShownOnPage: shown === invite.id };
// ── C accepts on the real invite page ──
ab('maude-f3-designer-c', 'open', `${CONTROL}/invite/${invite.id}`);
ab('maude-f3-designer-c', 'wait', '2000');
ab('maude-f3-designer-c', 'fill', '#password', cPassword);
ab('maude-f3-designer-c', 'check', 'input[name=disclosure]');
ab('maude-f3-designer-c', 'click', `form[action="/invite/${invite.id}"] button[type=submit]`);
ab('maude-f3-designer-c', 'wait', '3000');
const member = d1(
  `SELECT pm.role FROM project_members pm JOIN accounts a ON a.id = pm.account_id WHERE a.email = '${cEmail}' AND pm.project_id = '${PROJECT}'`
)[0];
result.joined = { membership: member?.role ?? null, dashboardTitle: ab('maude-f3-designer-c', 'get', 'title').trim() };
// ── C makes an accepted edit ──
const c = await cellSession(cEmail, cPassword);
const name = `F3S02Cloud${tag}`;
const doc = `ui-${name.toLowerCase()}`;
const made = await propose(c.token, [{ op: 'doc.create', doc, path: `ui/${name}.tsx`, lanes: { html: canvasSource(name, 'By designer C') } }]);
result.cEdit = { role: c.role, status: made.status, revision: made.body?.revision ?? null, actor: made.body?.actorId ?? null };
// ── the viewer reads but cannot write ──
const v = await cellSession(creds.viewer.email, creds.viewer.password);
const vRead = await api(v.token, 'bootstrap');
const vWrite = await propose(v.token, [{ op: 'dir.create', path: `ui/F3ViewerWrite${tag}` }]);
result.viewer = { role: v.role, read: vRead.status, write: vWrite.status, code: vWrite.body?.code ?? vWrite.body?.error ?? null };
// ── the owner removes C (People page) ──
ab('maude-f3-owner', 'open', `${CONTROL}/projects/${PROJECT}/people`);
ab('maude-f3-owner', 'wait', '1500');
// "Remove…" (a GET form in C's row) opens the confirmation page, whose POST
// form removes them. Both submitted with requestSubmit.
const clicked = [];
clicked.push(
  ab(
    'maude-f3-owner',
    'eval',
    `(() => { const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes(${JSON.stringify(cEmail)})); const f = row?.querySelector('form[action$="/people/remove"]'); if (!f) return 'no-row'; f.requestSubmit(); return 'confirm-page'; })()`
  ).trim()
);
ab('maude-f3-owner', 'wait', '3000');
clicked.push(
  ab(
    'maude-f3-owner',
    'eval',
    `(() => { if (!document.body.textContent.includes(${JSON.stringify(cEmail)})) return 'wrong-page'; const b = document.querySelector('button[name=do][value=remove]'); if (!b) return 'no-button'; b.form.requestSubmit(b); return 'removed'; })()`
  ).trim()
);
ab('maude-f3-owner', 'wait', '3000');
const after = d1(
  `SELECT count(*) AS n FROM project_members pm JOIN accounts a ON a.id = pm.account_id WHERE a.email = '${cEmail}' AND pm.project_id = '${PROJECT}'`
)[0];
const cWriteAfter = await propose(c.token, [{ op: 'dir.create', path: `ui/F3RemovedWrite${tag}` }]);
const cReadAfter = await api(c.token, 'bootstrap');
const cReopen = await cellSession(cEmail, cPassword);
const ownerSession = await cellSession(creds.owner.email, creds.owner.password);
const history = (await api(ownerSession.token, 'history?limit=50')).body?.history ?? [];
// The product's promise for a session that was already open: it "stops working
// within the hour" — the cell's revocation sweep (every 10 min) ends it.
const removedAt = Date.now();
let revokedAfterMs = null;
while (Date.now() - removedAt < 20 * 60 * 1000) {
  const probe = await api(c.token, 'bootstrap');
  if (probe.status === 401) {
    revokedAfterMs = Date.now() - removedAt;
    break;
  }
  await new Promise((r) => setTimeout(r, 30000));
}
const cWriteLate = revokedAfterMs === null ? null : (await propose(c.token, [{ op: 'dir.create', path: `ui/F3RemovedLate${tag}` }])).status;
result.removal = {
  clicked,
  membershipsLeft: after?.n ?? null,
  writeRightAfter: cWriteAfter.status,
  readRightAfter: cReadAfter.status,
  liveSessionRevokedAfterMs: revokedAfterMs,
  writeAfterRevocation: cWriteLate,
  reopen: cReopen.token ? 'opened' : cReopen,
  workKept: history.some((h) => h.revision === result.cEdit.revision && h.actor === cEmail),
};
result.status =
  result.joined.membership === 'member' &&
  result.cEdit.status === 200 &&
  result.cEdit.actor === cEmail &&
  result.viewer.role === 'viewer' &&
  result.viewer.read === 200 &&
  result.viewer.write >= 400 &&
  result.removal.membershipsLeft === 0 &&
  result.removal.liveSessionRevokedAfterMs !== null &&
  result.removal.liveSessionRevokedAfterMs <= 60 * 60 * 1000 &&
  result.removal.writeAfterRevocation === 401 &&
  result.removal.reopen !== 'opened' &&
  result.removal.workKept
    ? 'pass'
    : 'fail';
writeFileSync(join(out, 's02-cloud.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = result.status === 'pass' ? 0 : 1;
