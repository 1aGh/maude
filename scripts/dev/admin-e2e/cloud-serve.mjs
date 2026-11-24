#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
// Keep the local Maude Cloud stack up for poking by hand:
//
//   FARM_LOCAL=1 scripts/v2-test-lane.sh -- node scripts/dev/admin-e2e/cloud-serve.mjs
//
// It prints the dashboard URL and a loopback control port:
//   GET  /mail                 captured e-mail
//   POST /d1   {sql, binds}    run SQL on the local D1
//   POST /cron                 run the hourly sweep
//   POST /operators {ids}      set OPERATOR_ACCOUNT_IDS (restarts the Worker)
//   GET  /state                domains, running cells, Stripe events, unrouted fetches
import { createServer } from 'node:http';
import { killAll, startStack } from './cloud-stack.mjs';

const stack = await startStack({
  log: (s) => console.log(`[stack] ${s}`),
  verbose: process.argv.includes('--verbose'),
});
const control = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') : {};
  const send = (v, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(v, null, 2));
  };
  try {
    if (req.url === '/mail') return send(stack.mail);
    if (req.url === '/d1') return send(await stack.d1(body.sql, ...(body.binds ?? [])));
    if (req.url === '/cron') return send({ ok: true, result: await stack.cron() });
    if (req.url === '/operators')
      return send({ ok: true, done: await stack.setOperators(body.ids ?? []) });
    if (req.url === '/state')
      return send({
        domains: [...stack.cf.domains.keys()],
        cells: [...stack.cells.keys()],
        cellStarts: Object.fromEntries(stack.cellStarts),
        stripeEvents: stack.stripe.events.map((e) => ({
          id: e.id,
          type: e.type,
          status: e.status,
        })),
        unrouted: stack.unrouted,
      });
    if (req.url === '/edgelog') return send(stack.edgeLog.slice(-40));
    if (req.url?.startsWith('/celllog/'))
      return send((stack.cellLogs.get(req.url.slice(9)) ?? []).join(''));
    send({ error: 'unknown' }, 404);
  } catch (err) {
    send({ error: String(err?.stack ?? err) }, 500);
  }
});
await new Promise((ok) => control.listen(0, '127.0.0.1', ok));
const info = {
  cloud: stack.cloudUrl,
  edgePort: stack.edgePort,
  control: `http://127.0.0.1:${control.address().port}`,
  root: stack.root,
  secrets: stack.secrets,
};
if (process.env.CLOUD_SERVE_INFO)
  writeFileSync(process.env.CLOUD_SERVE_INFO, JSON.stringify(info, null, 2), { mode: 0o600 });
console.log(
  `[stack] dashboard  ${info.cloud}   (self-signed; start a browser with --ignore-https-errors)`
);
console.log(`[stack] control    ${info.control}`);
console.log(`[stack] scratch    ${info.root}`);
const bye = async () => {
  control.close();
  await stack.stop().catch(() => {});
  killAll();
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
