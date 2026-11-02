#!/usr/bin/env node
// Developer-ID-sign every Mach-O file the bundle carries as a RESOURCE — tauri's `beforeBundleCommand`.
//
// Notarization rejects a bundle with ANY unsigned (or untimestamped) Mach-O inside it. Tauri signs the main binary
// and the `externalBin` sidecars only; the kgai engine is signed by build-desktop.yml before `tauri build`
// (it is staged from `.kg-staging/`). Everything `stage-resources.mjs` copies in from node_modules is not: v2.0.0-rc.1
// shipped the helpers' `oxc-parser` native bindings (`@oxc-parser/binding-darwin-*/*.node`), and notarization
// refused the archive ("The binary is not signed with a valid Developer ID certificate", "no secure timestamp").
//
// This runs AFTER the Rust build and `beforeBuildCommand` (so `src-tauri/resources` is staged) and BEFORE tauri
// bundles, signs and notarizes. Tauri imports APPLE_CERTIFICATE into a keychain only inside its own bundle step, so
// like the kg step this stands up a short-lived keychain of its own, signs, and removes it again — leaving no second
// copy of the identity on the search list when tauri imports its own. With no certificate (a local or dev build)
// it does nothing: tauri ad-hoc-signs the whole .app.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESOURCES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'resources');
const { APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD = '', APPLE_SIGNING_IDENTITY } = process.env;

if (process.platform !== 'darwin' || !APPLE_CERTIFICATE || !APPLE_SIGNING_IDENTITY) {
  console.log(
    '[sign-staged-macho] no Apple signing identity — leaving resources to the ad-hoc signature'
  );
  process.exit(0);
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts });

/** Every Mach-O file under `dir` (by `file`, not by extension: a `.node` addon is a Mach-O bundle). */
function machO(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && /Mach-O/.test(run('file', ['-b', p]))) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Already Developer-ID signed with a timestamp (the kg engine, signed before `tauri build`) — leave it. */
function signedForNotary(p) {
  try {
    const info = run('codesign', ['-dvv', p], { stdio: ['ignore', 'pipe', 'pipe'] });
    return /Authority=Developer ID Application/.test(info) && /Timestamp=/.test(info);
  } catch (e) {
    const info = String(e.stderr ?? '');
    return /Authority=Developer ID Application/.test(info) && /Timestamp=/.test(info);
  }
}

const todo = machO(RESOURCES).filter((p) => !signedForNotary(p));
if (!todo.length) {
  console.log('[sign-staged-macho] every Mach-O resource is already signed');
  process.exit(0);
}

const keychain = join(tmpdir(), `maude-res-signing-${process.pid}.keychain-db`);
const password = randomBytes(18).toString('base64');
const p12 = join(tmpdir(), `maude-res-cert-${process.pid}.p12`);
const original = run('security', ['list-keychains', '-d', 'user'])
  .split('\n')
  .map((l) => l.trim().replace(/^"|"$/g, ''))
  .filter(Boolean);
try {
  run('security', ['create-keychain', '-p', password, keychain]);
  run('security', ['set-keychain-settings', '-lut', '21600', keychain]);
  run('security', ['unlock-keychain', '-p', password, keychain]);
  writeFileSync(p12, Buffer.from(APPLE_CERTIFICATE, 'base64'), { mode: 0o600 });
  run('security', [
    'import',
    p12,
    '-k',
    keychain,
    '-P',
    APPLE_CERTIFICATE_PASSWORD,
    '-T',
    '/usr/bin/codesign',
    '-T',
    '/usr/bin/security',
  ]);
  rmSync(p12, { force: true });
  // without a partition list every codesign call waits on a GUI "allow access" prompt — a hang on a runner
  run(
    'security',
    [
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      password,
      keychain,
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...original]);
  for (const p of todo) {
    run('codesign', [
      '--force',
      '--timestamp',
      '--options',
      'runtime',
      '--keychain',
      keychain,
      '--sign',
      APPLE_SIGNING_IDENTITY,
      p,
    ]);
    run('codesign', ['--verify', '--strict', p]);
    console.log(`[sign-staged-macho] signed ${p.slice(RESOURCES.length + 1)}`);
  }
} finally {
  rmSync(p12, { force: true });
  try {
    run('security', ['list-keychains', '-d', 'user', '-s', ...original]);
  } catch {}
  try {
    run('security', ['delete-keychain', keychain], { stdio: 'ignore' });
  } catch {}
}
