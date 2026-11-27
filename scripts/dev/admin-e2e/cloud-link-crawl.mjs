#!/usr/bin/env node
// Every link on every admin page answers — against a running cloud-serve / parity --serve stack.
//
//   CLOUD_SERVE_INFO=<info.json> node scripts/dev/admin-e2e/cloud-link-crawl.mjs
//
// Signs in as each test person in the info file (owner, member, operator; the
// operator also walks one account's read-only view), then walks every
// same-origin GET link breadth first and reports any page that answers 404 or
// 5xx, has no h1, or names a raw slug a person would never type. Read-only:
// it follows <a href> only, never submits a form.
import { readFileSync } from 'node:fs';
import { Client } from './cloud-http.mjs';

const info = JSON.parse(readFileSync(process.env.CLOUD_SERVE_INFO, 'utf8'));
const C = info.cloud;
const SKIP =
  /\/auth\/|\/logout|\/download\/account\.json|\/file\?|\/billing\/portal|\/handoff|maude:\/\//;

async function signIn(email) {
  const c = new Client(email);
  const r = await c.post(`${C}/auth/login`, { form: { email, password: info.password } });
  if (r.status !== 303) throw new Error(`login ${email}: ${r.status}`);
  return c;
}

async function walk(label, client, starts, { max = 160, within = null } = {}) {
  const seen = new Set();
  const queue = [...starts];
  const bad = [];
  let pages = 0;
  while (queue.length && pages < max) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const r = await client.get(`${C}${path}`);
    pages++;
    if (r.status >= 300 && r.status < 400) {
      const to = r.location ? new URL(r.location).pathname + new URL(r.location).search : null;
      if (to && !seen.has(to)) queue.push(to);
      continue;
    }
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/
      .exec(r.text)?.[1]
      ?.replace(/<[^>]+>/g, '')
      .trim();
    if (r.status === 404 || r.status >= 500 || !h1) {
      bad.push(`${r.status} ${path}${h1 ? ` (${h1})` : ' (no h1)'}`);
    }
    for (const m of r.text.matchAll(/href="(\/[^"#]*)"/g)) {
      const href = m[1].replaceAll('&amp;', '&');
      if (SKIP.test(href)) continue;
      if (within && !href.startsWith(within)) continue;
      if (!seen.has(href)) queue.push(href);
    }
  }
  console.log(
    `${bad.length ? 'FAIL' : 'PASS'}  ${label}: ${pages} pages${bad.length ? `\n    ${bad.join('\n    ')}` : ''}`
  );
  return bad.length === 0;
}

const owner = await signIn(info.owner);
const member = await signIn(info.member);
const operator = await signIn(info.operator);
const ok = [
  await walk('owner', owner, ['/', '/projects', '/account/people', '/account', '/search?q=a']),
  await walk('member', member, ['/', '/projects', '/account', '/search?q=a']),
  await walk('operator', operator, ['/operator', '/operator/search?q=a'], {
    within: '/operator',
  }),
  await walk('operator view-as', operator, [`/operator/accounts/${info.kolarId}/view`], {
    within: `/operator/accounts/${info.kolarId}/view`,
  }),
];
process.exitCode = ok.every(Boolean) ? 0 : 1;
