// Creates a reviewable local artifact only. Does not create any remote resources.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [account, target] = process.argv.slice(2);
assert.match(account || '', /^[a-f0-9]{32}$/);
assert.ok(target);
const root = resolve(target),
  nonce = randomUUID();
mkdirSync(root, { recursive: false });
const name = `maude-sync-probe-${nonce.replaceAll('-', '').slice(0, 12)}`;
copyFileSync(new URL('./dist/worker.mjs', import.meta.url), join(root, 'worker.mjs'));
const bytes = readFileSync(join(root, 'worker.mjs'));
const config = {
  name,
  main: 'worker.mjs',
  no_bundle: true,
  account_id: account,
  compatibility_date: '2026-07-01',
  workers_dev: true,
  preview_urls: false,
  limits: { cpu_ms: 100 },
  durable_objects: { bindings: [{ name: 'PROJECTS', class_name: 'R2ProjectProbe' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['R2ProjectProbe'] }],
  r2_buckets: [{ binding: 'PAYLOADS', bucket_name: name }],
  vars: {
    PROBE_PREFIX: `maude-sync-conformance/${nonce}`,
    PROBE_DISPOSABLE_ONLY: 'true',
    PROBE_EXPIRES_AT: String(Date.now() + 3600000),
  },
};
writeFileSync(join(root, 'wrangler.json'), JSON.stringify(config, null, 2));
writeFileSync(
  join(root, 'manifest.json'),
  JSON.stringify(
    {
      name,
      account,
      prefix: config.vars.PROBE_PREFIX,
      expiresAt: config.vars.PROBE_EXPIRES_AT,
      bytes: bytes.length,
      bundleHash: createHash('sha256').update(bytes).digest('hex'),
      productionRoutes: [],
      productionBindings: [],
      token: 'secret supplied only after deployment',
    },
    null,
    2
  )
);
console.log(JSON.stringify({ name, config: join(root, 'wrangler.json') }));
