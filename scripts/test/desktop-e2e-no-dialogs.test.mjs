// 2.1.1 — a desktop e2e lane never raises a native dialog over the screen of the person whose Mac runs it.
// The 2026-11-09 incident: lanes run on Michal's own Mac left tabs whose sidecars crash-looped, and each gave up
// with a modal "Maude's server for “X” stopped 3 times in a row…" over his work. The debug build now logs what it
// would have asked when `MAUDE_E2E_NO_DIALOGS=1` (apps/desktop/src-tauri/src/sidecar.rs `e2e_no_dialogs`; its Rust
// tests pin that every message dialog is gated). This file pins the harness half: EVERY lane sets the env, none can
// drop it, and a lane deletes its fixture roots only after the app is stopped.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const E2E = join(ROOT, 'apps/desktop/e2e');
const BASE = join(E2E, 'wdio.conf.ts');
const ENV = 'MAUDE_E2E_NO_DIALOGS';
const SET_LINE = `process.env.${ENV} = '1';`;

function sources(dir, pick) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p, pick));
    else if (pick(name)) out.push(p);
  }
  return out;
}
const confs = () => sources(E2E, (n) => n.endsWith('.conf.ts'));
const code = () => sources(E2E, (n) => /\.(m?[jt]s|tsx)$/.test(n));

/** The other lane configs `file` imports (static `from '…'` and dynamic `import('…')`), resolved to paths. */
export function confImports(file, text) {
  const out = [];
  for (const m of text.matchAll(/(?:from\s+|import\(\s*)'(\.{1,2}\/[^']*\.conf(?:\.ts)?)'/g)) {
    const p = resolve(dirname(file), m[1]);
    out.push(p.endsWith('.ts') ? p : `${p}.ts`);
  }
  return out;
}

/** True when `file` reaches the base config through its chain of lane-config imports. */
export function reachesBase(file, read = (f) => readFileSync(f, 'utf8'), seen = new Set()) {
  if (file === BASE) return true;
  if (seen.has(file) || !existsSync(file)) return false;
  seen.add(file);
  return confImports(file, read(file)).some((f) => reachesBase(f, read, seen));
}

/** Every line (1-based) in `text` that sets, overrides or deletes the env — anything but reading it. */
export function writesOfEnv(text) {
  const writes = new RegExp(
    `(${ENV}\\s*(=(?!=)|\\?\\?=|\\|\\|=|:))|delete\\s+process\\.env(\\.${ENV}|\\[\\s*['"]${ENV})`
  );
  return text
    .split('\n')
    .map((t, i) => ({ line: i + 1, text: t }))
    .filter((l) => writes.test(l.text));
}

/** The body of the `onComplete` hook in a lane config (to the hook's closing at two-space indent), or null. */
export function onCompleteBody(text) {
  const at = text.search(/\n {2}(async )?onComplete\b/);
  if (at < 0) return null;
  const end = text.indexOf('\n  },', at + 1);
  return text.slice(at, end < 0 ? undefined : end);
}

test('the scans see what they look for', () => {
  assert.deepEqual(
    writesOfEnv(
      [
        `process.env.${ENV} = '1';`,
        `process.env.${ENV} ??= '0';`,
        `delete process.env.${ENV};`,
        `spawn(bin, [], { env: { ${ENV}: '' } });`,
        `if (process.env.${ENV} === '1') {}`,
      ].join('\n')
    ).map((l) => l.line),
    [1, 2, 3, 4]
  );
  const files = {
    '/e/wdio.a.conf.ts': `import { config as b } from './wdio.b.conf';`,
    '/e/wdio.b.conf.ts': `const { config } = await import('./wdio.conf.ts');`,
  };
  assert.deepEqual(confImports('/e/wdio.a.conf.ts', files['/e/wdio.a.conf.ts']), [
    '/e/wdio.b.conf.ts',
  ]);
  assert.deepEqual(confImports('/e/x/m.conf.ts', `import { config } from '../wdio.conf';`), [
    '/e/wdio.conf.ts',
  ]);
  const body = onCompleteBody(
    'x = {\n  async onComplete() {\n    await completeLane();\n    rmSync(s);\n  },\n};'
  );
  assert.ok(body.includes('completeLane') && body.includes('rmSync'));
});

test('the base config sets MAUDE_E2E_NO_DIALOGS=1 unconditionally, at top level', () => {
  const lines = readFileSync(BASE, 'utf8').split('\n');
  assert.ok(lines.includes(SET_LINE), `wdio.conf.ts must carry the column-0 line: ${SET_LINE}`);
});

test('no e2e source other than that one line sets, overrides or deletes it', () => {
  const hits = code().flatMap((f) =>
    writesOfEnv(readFileSync(f, 'utf8'))
      .filter((l) => !(f === BASE && l.text === SET_LINE))
      .map((l) => `${relative(ROOT, f)}:${l.line}: ${l.text.trim()}`)
  );
  assert.deepEqual(hits, [], 'a lane may not opt out of the no-dialogs switch');
});

test('every wdio lane config reaches the base config (so it gets the env)', () => {
  const all = confs();
  assert.ok(all.length > 40, `only ${all.length} lane configs found under ${E2E}`);
  const orphans = all.filter((f) => !reachesBase(f)).map((f) => relative(ROOT, f));
  assert.deepEqual(
    orphans,
    [],
    'import the base config (./wdio.conf) — directly or through another lane config'
  );
});

test('the shell reads the same env name the harness sets', () => {
  const rs = readFileSync(join(ROOT, 'apps/desktop/src-tauri/src/sidecar.rs'), 'utf8');
  assert.ok(
    rs.includes(`"${ENV}"`),
    'sidecar.rs NO_DIALOGS_ENV must name the env wdio.conf.ts sets'
  );
});

test('completeLane stops the e2e app before anything else', () => {
  const text = readFileSync(BASE, 'utf8');
  const start = text.indexOf('export async function completeLane()');
  assert.ok(start >= 0);
  const body = text.slice(start, text.indexOf('\n}\n', start));
  const stop = body.indexOf('stopE2eApp(');
  assert.ok(stop >= 0, 'completeLane stops the app');
  for (const later of ['reapOrphanE2eSidecars(', 'releaseFixtureTree(']) {
    assert.ok(stop < body.indexOf(later), `the app is stopped before ${later}`);
  }
});

test('a lane deletes its fixture roots only after completeLane stopped the app', () => {
  const bad = [];
  let checked = 0;
  for (const f of confs()) {
    const body = onCompleteBody(readFileSync(f, 'utf8'));
    if (!body?.includes('rmSync(')) continue;
    checked++;
    const lane = body.indexOf('completeLane()');
    if (lane < 0 || lane > body.indexOf('rmSync(')) bad.push(relative(ROOT, f));
  }
  assert.ok(checked >= 4, `only ${checked} lane onComplete hooks delete a scratch root`);
  assert.deepEqual(
    bad,
    [],
    'in onComplete: `await completeLane()` first, then rmSync the scratch roots'
  );
});
