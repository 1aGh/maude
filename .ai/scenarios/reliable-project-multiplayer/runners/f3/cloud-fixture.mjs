#!/usr/bin/env node
// A fixture.json in the self-host shape for the ISOLATED cloud test cell, so the
// same F3 runners drive either backend: the cell origin, fresh cell sessions
// minted through the real control-plane open + /auth/login (backend.mjs), and
// the accounts' addresses. `port` is only the base for LOCAL ports (proxies,
// desktop sidecars). Written 0600; holds tokens, no passwords.
//
//   node cloud-fixture.mjs --work <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBackend } from './backend.mjs';

const argv = process.argv.slice(2);
const work = argv[argv.indexOf('--work') + 1];
mkdirSync(work, { recursive: true, mode: 0o700 });
const B = await loadBackend('cloud');
const fx = {
  backend: 'cloud',
  url: B.origin,
  port: 1800,
  projectId: 'f3-cloud',
  sessions: B.tokens,
  users: {
    owner: { email: 'owner@maude-f3.invalid' },
    a: { email: 'designer-a@maude-f3.invalid' },
    b: { email: 'designer-b@maude-f3.invalid' },
  },
};
writeFileSync(join(work, 'fixture.json'), JSON.stringify(fx, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ url: fx.url, roles: Object.fromEntries(Object.entries(fx.sessions).map(([k, v]) => [k, v.role])) }));
