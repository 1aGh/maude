// Give the staged kgai `kg` binary an `@loader_path` rpath, so it finds the `libkuzu.dylib`
// that ships NEXT TO it (`Resources/kgai/`). Upstream builds it with only the kgai CI path and
// `@loader_path/../lib` — neither exists in the .app, and a hardened-runtime app strips the
// DYLD_* variables the launcher would otherwise rely on, so every `maude kg …` died in dyld
// (issue #128 §10).
//
// Runs from sync-kg.mjs right after the download, i.e. BEFORE the lipo + codesign in
// build-desktop.yml: editing load commands invalidates a signature, so it must never run on a
// signed file. install_name_tool re-applies a linker-signed ad-hoc signature by itself, so the
// staged binary still runs in a local (unsigned) build.
//
// `otool` + `install_name_tool` are looked up on PATH (Xcode command-line tools), which is also
// how the tests stub them.

import { execFileSync } from 'node:child_process';

/** True when `otool -l` output carries an LC_RPATH whose path is exactly `@loader_path`. */
export function hasLoaderPathRpath(otoolOutput) {
  const lines = String(otoolOutput).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== 'cmd LC_RPATH') continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const m = /^\s*path (.+?) \(offset \d+\)\s*$/.exec(lines[j]);
      if (m) {
        if (m[1] === '@loader_path') return true;
        break;
      }
    }
  }
  return false;
}

function runTool(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const detail = `${e.stderr || ''}${e.stdout || ''}`.trim() || e.message;
    throw new Error(`${cmd} ${args.join(' ')} failed: ${detail}`);
  }
}

/**
 * Add `@loader_path` to `file`'s rpaths unless it is already there. Throws (fail loud) when
 * either tool fails or the rpath is still absent afterwards. Returns 'added' | 'present'.
 */
export function ensureLoaderPathRpath(file) {
  if (hasLoaderPathRpath(runTool('otool', ['-l', file]))) return 'present';
  runTool('install_name_tool', ['-add_rpath', '@loader_path', file]);
  if (!hasLoaderPathRpath(runTool('otool', ['-l', file]))) {
    throw new Error(`install_name_tool reported success but ${file} has no @loader_path rpath`);
  }
  return 'added';
}
