// codex-adapter.mjs — stage and check the bundled Codex ACP adapter (DDR-252 D3, plan Task B5 / F7).
//
// `@agentclientprotocol/codex-acp` is ONE pre-bundled JS file (`dist/index.js`) that imports node
// builtins only, so the packaged app ships exactly that file + its LICENSE + a trimmed package.json
// (resolveAdapterEntry in acp/probe.ts reads its `bin` map) and NO node_modules. Its one heavy
// dependency, `@openai/codex` (~350 MB of native code per platform), is never installed (the
// `overrides` in apps/studio/package.json + pnpm-workspace.yaml), never staged, and never run: the
// spawn always sets CODEX_PATH to the person's own codex (acp/agents/spawn.ts).
//
// Shared by stage-resources.mjs (stage) and check-bundle-completeness.mjs (check); pinned by
// scripts/test/codex-adapter-stage.test.mjs.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join } from 'node:path';

export const CODEX_ADAPTER_PKG = '@agentclientprotocol/codex-acp';
export const CODEX_ADAPTER_BIN = 'codex-acp';
/** Never in the bundle, at any depth. */
export const FORBIDDEN_CODEX_PKG = '@openai/codex';

const SPECIFIER_RES = [
  /\bfrom\s*["']([^"'./][^"']*)["']/g,
  /\brequire\(\s*["']([^"'./][^"']*)["']\s*\)/g,
  /\bimport\(\s*["']([^"'./][^"']*)["']\s*\)/g,
  /^\s*import\s*["']([^"'./][^"']*)["']/gm,
];

/** Bare specifiers in a bundled entry that are NOT node builtins (an empty list = self-contained). */
export function nonBuiltinImports(source) {
  const out = new Set();
  for (const re of SPECIFIER_RES) {
    for (const m of source.matchAll(re)) if (!isBuiltin(m[1])) out.add(m[1]);
  }
  return [...out].sort();
}

function readPkg(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

function binRel(pkg) {
  return typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[CODEX_ADAPTER_BIN];
}

/**
 * Copy the adapter's entry + LICENSE + a trimmed package.json from `<studioDir>/node_modules` into
 * `<outStudioDir>/node_modules`. Throws (the build must fail loud) when the package is missing, the
 * entry is missing, or the entry imports anything but node builtins.
 */
export function stageCodexAdapter(studioDir, outStudioDir) {
  const src = join(studioDir, 'node_modules', CODEX_ADAPTER_PKG);
  if (!existsSync(join(src, 'package.json'))) {
    throw new Error(`codex adapter not installed: ${src} (install apps/studio deps first)`);
  }
  const pkg = readPkg(src);
  const rel = binRel(pkg);
  if (!rel || !existsSync(join(src, rel))) {
    throw new Error(`codex adapter entry missing: ${join(src, String(rel))}`);
  }
  const extra = nonBuiltinImports(readFileSync(join(src, rel), 'utf8'));
  if (extra.length) {
    throw new Error(
      `codex adapter ${pkg.version} is no longer self-contained (imports ${extra.join(', ')}); ` +
        'stage its closure deliberately or pin a self-contained release'
    );
  }
  const dst = join(outStudioDir, 'node_modules', CODEX_ADAPTER_PKG);
  mkdirSync(dirname(join(dst, rel)), { recursive: true });
  cpSync(join(src, rel), join(dst, rel), { dereference: true });
  const license = readdirSync(src).find((f) => /^licen[cs]e/i.test(f));
  if (!license) throw new Error(`codex adapter ${pkg.version}: no LICENSE file to ship`);
  cpSync(join(src, license), join(dst, license), { dereference: true });
  const trimmed = {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    type: pkg.type,
    bin: { [CODEX_ADAPTER_BIN]: rel },
    maudeStaged: 'entry-only: dist is pre-bundled; @openai/codex is never shipped (DDR-252 D3)',
  };
  writeFileSync(join(dst, 'package.json'), `${JSON.stringify(trimmed, null, 2)}\n`);
  return { version: pkg.version, entry: join(dst, rel) };
}

/** Every directory named `@openai/codex*` under a node_modules tree (any depth). */
function findForbidden(nodeModules, depth = 0, out = []) {
  if (depth > 8 || !existsSync(nodeModules)) return out;
  for (const ent of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const p = join(nodeModules, ent.name);
    if (ent.name === '@openai') {
      for (const sub of readdirSync(p)) if (sub.startsWith('codex')) out.push(join(p, sub));
      continue;
    }
    if (ent.name.startsWith('@')) {
      for (const sub of readdirSync(p, { withFileTypes: true })) {
        if (sub.isDirectory()) findForbidden(join(p, sub.name, 'node_modules'), depth + 1, out);
      }
    } else {
      findForbidden(join(p, 'node_modules'), depth + 1, out);
    }
  }
  return out;
}

/**
 * Check a STAGED tree (`<Resources>/apps/studio/node_modules`): the adapter entry, LICENSE and bin
 * map are there, it carries no node_modules of its own, its entry imports builtins only, and no
 * `@openai/codex*` package is anywhere in the tree. Returns a list of problems (empty = ok).
 */
export function checkStagedCodexAdapter(stagedNodeModules) {
  const problems = [];
  const dir = join(stagedNodeModules, CODEX_ADAPTER_PKG);
  if (!existsSync(join(dir, 'package.json'))) {
    problems.push(`${CODEX_ADAPTER_PKG} not staged (${dir})`);
  } else {
    const pkg = readPkg(dir);
    const rel = binRel(pkg);
    if (!rel || !existsSync(join(dir, rel)))
      problems.push(`entry missing: ${join(dir, String(rel))}`);
    else {
      const extra = nonBuiltinImports(readFileSync(join(dir, rel), 'utf8'));
      if (extra.length) problems.push(`entry imports non-builtins: ${extra.join(', ')}`);
    }
    if (!readdirSync(dir).some((f) => /^licen[cs]e/i.test(f))) problems.push('LICENSE missing');
    if (existsSync(join(dir, 'node_modules')))
      problems.push('adapter carries its own node_modules');
  }
  for (const p of findForbidden(stagedNodeModules))
    problems.push(`${FORBIDDEN_CODEX_PKG} staged: ${p}`);
  return problems;
}
