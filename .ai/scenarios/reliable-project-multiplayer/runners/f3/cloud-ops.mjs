#!/usr/bin/env node
// F3 cloud backend operations on the ISOLATED test cell (application
// maude-multiplayer-cell-test-20260922): `instances`, `kill` (delete the running
// container instance — the process dies with whatever was in flight) and
// `start` (wait until the cell serves again; the Durable Object restarts the
// container on the next request). Uses the operator's wrangler OAuth login.
//
//   node cloud-ops.mjs instances | kill | start
import { readFileSync } from 'node:fs';

const ACCOUNT = 'b5b596efe65abb732777c7171dc18145';
const APP = 'a03073b4-13ac-42ee-8b75-b58b598e3240';
const ORIGIN = 'https://f3-cloud.multiplayer-test-20260922.maude.sh';
const token = /oauth_token\s*=\s*"([^"]+)"/.exec(
  readFileSync(`${process.env.HOME}/.config/.wrangler/config/default.toml`, 'utf8')
)?.[1];
if (!token) throw new Error('not logged in to wrangler');
const api = async (method, path) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/containers/applications/${APP}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
  return r.json();
};
const health = async () => {
  try {
    const r = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};
const cmd = process.argv[2];
if (cmd === 'instances') {
  const r = await api('GET', '/instances');
  console.log(JSON.stringify(r.result ?? r.errors, null, 1).slice(0, 2000));
} else if (cmd === 'kill') {
  // The cell's own restart route: `container.destroy()` — the process dies
  // with whatever it had in flight (the platform API refuses instance delete
  // on this account: NOT_ENABLED). Authorized by THIS tenant's derived secret.
  const { deriveSecret, RESTART_PATH } = await import(
    new URL('../../../../../apps/cells/cell-config.mjs', import.meta.url).href
  );
  const { cellSecret } = JSON.parse(readFileSync('/tmp/maude-followup-staging-u6SNrA/credentials.json', 'utf8'));
  const secret = await deriveSecret(cellSecret, 'f3-cloud');
  const r = await fetch(`${ORIGIN}${RESTART_PATH}`, { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
  console.log(JSON.stringify({ status: r.status, body: await r.text().then((t) => t.slice(0, 120)) }));
} else if (cmd === 'start') {
  const end = Date.now() + 300000;
  for (;;) {
    const h = await health();
    if (h?.coordinator?.ready) {
      console.log(JSON.stringify({ uptimeMs: h.uptimeMs, coordinator: h.coordinator }));
      break;
    }
    if (Date.now() > end) throw new Error('cell did not come back');
    await new Promise((r) => setTimeout(r, 1000));
  }
} else throw new Error('instances | kill | start');
