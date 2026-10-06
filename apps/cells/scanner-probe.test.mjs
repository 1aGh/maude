// Scanner paths must not wake a sleeping cell (feature-cells-no-wake-for-scanners).
//
// The refused table is the 2026-10-03 Workers Logs night verbatim, plus the
// usual siblings. The allowed table is the half that matters more: a false
// positive here is a member's canvas that will not load on a cold cell.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { hasOwnerSignal, isScannerProbe, OWNER_COOKIES } from './cell-config.mjs';

const at = (path) => new URL(path, 'https://alligators.cloud.maude.sh');

const REFUSED = [
  '/wp-login.php',
  '/xmlrpc.php',
  '/wp-admin/',
  '/wp-admin/setup-config.php',
  '/wp-includes/wlwmanifest.xml',
  '/blog/wp-includes/wlwmanifest.xml',
  '/web/wp-includes/wlwmanifest.xml',
  '/wordpress/wp-includes/wlwmanifest.xml',
  '/site/wp-includes/wlwmanifest.xml',
  '/cms/wp-includes/wlwmanifest.xml',
  '/wp/wp-includes/wlwmanifest.xml',
  '/2019/wp-includes/wlwmanifest.xml',
  '/shop/wp-content/plugins/x/readme.txt',
  '/xmlrpc',
  '/index.php',
  '/admin/config.php',
  '/x.php7',
  '/.env',
  '/.env.prod',
  '/.env.local.bak',
  '/backend/.env',
  '/.git/config',
  '/.git/HEAD',
  '/.git',
  '/.git-credentials',
  '/.aws/credentials',
  '/.config/gcloud/credentials.db',
  '/.ssh/id_rsa',
  '/.DS_Store',
  '/cgi-bin/luci',
  '/phpmyadmin/',
  '/phpMyAdmin/index.php',
  '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php',
  '/lib/vendor/phpunit/x',
  '/actuator/health',
  '/server-status',
  '/boaform/admin/formLogin',
  '/HNAP1/',
  '/%2Eenv',
  '/WP-LOGIN.PHP',
];

const ALLOWED = [
  '/',
  '/health',
  '/join/abc',
  '/auth/callback',
  '/oidc/callback?code=x',
  '/studio/',
  '/.well-known/security.txt',
  '/favicon.ico',
  '/robots.txt',
  '/canvases/hero.tsx',
  // Tenant content: any filename is legitimate under these prefixes.
  '/_project-file/system/x/assets/index.php.svg',
  '/_project-file/.env.example',
  '/_project-file/.git-notes.md',
  '/_asset-file/wp-content/logo.png',
  '/_canvas-runtime/react.js',
  '/_canvas-shell.html',
  '/_api/files?path=wp-admin.php',
  '/_ws',
  '/_media/.DS_Store',
  '/.design/notes/.env-example.md',
  '/.design/system/ds/assets/wp-logo.png',
  '/.design/system/ds/assets/xmlrpc.svg',
  '/assets/wp-logo.png',
  '/assets/index.php.png',
  '/api/v1/.env',
  // Bare extensions other than .php are tenant content, never a signal.
  '/hero.mp4',
  '/poster.png',
  '/notes.sql',
  // Near misses.
  '/philosophy',
  '/php-tips',
  '/environment',
  '/gitlab',
  '/my-wp-notes',
];

test('every scanner path from the 2026-10-03 logs is a scanner probe', () => {
  for (const p of REFUSED) assert.equal(isScannerProbe(at(p)), true, p);
});

test('legitimate and tenant-content paths are never scanner probes', () => {
  for (const p of ALLOWED) assert.equal(isScannerProbe(at(p)), false, p);
});

test('accepts a string URL and survives malformed percent-encoding', () => {
  assert.equal(isScannerProbe('https://x.cloud.maude.sh/wp-login.php'), true);
  assert.equal(isScannerProbe(at('/%E0%A4%A.php')), true);
  assert.equal(isScannerProbe(at('/%E0%A4%A')), false);
  assert.equal(isScannerProbe(undefined), false);
});

test('owner signal: an authorization header or a hub session/capability cookie', () => {
  const h = (o) => new Headers(o);
  assert.equal(hasOwnerSignal(h({ authorization: 'Bearer x' })), true);
  assert.equal(hasOwnerSignal(h({ cookie: 'maude_studio=abc' })), true);
  assert.equal(hasOwnerSignal(h({ cookie: 'a=1; maude_canvas=abc' })), true);
  assert.equal(hasOwnerSignal(h({ cookie: 'maude_studio_x=1; foo=maude_studio' })), false);
  assert.equal(hasOwnerSignal(h({ cookie: 'maude_studio=' })), false);
  assert.equal(hasOwnerSignal(h({ authorization: '' })), false);
  assert.equal(hasOwnerSignal(h({})), false);
  assert.equal(hasOwnerSignal(undefined), false);
});

test('the owner cookie names match the hub (tripwire against a rename)', () => {
  const src = (f) => readFileSync(new URL(`../hub/src/${f}`, import.meta.url), 'utf8');
  const session = src('browser-auth.mjs').match(/BROWSER_SESSION_COOKIE = '([^']+)'/)?.[1];
  const capability = src('studio-proxy.mjs').match(/CANVAS_CAPABILITY_COOKIE = '([^']+)'/)?.[1];
  assert.deepEqual([...OWNER_COOKIES].sort(), [session, capability].sort());
});
