// Shared helpers for the `maude migrate v2` tests (V2-1.12 §5.12, §7).

import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyMigration,
  type MigrateOptions,
  type MigrateReport,
  planMigration,
} from '../migrate/engine.ts';
import type { HubFormatClient } from '../migrate/hub.ts';
import { generateFormatFixture } from './fixtures/gen-format-fixture.mjs';

/**
 * Hash of EVERY file under `.design/` (bytes + relative path), excluding only
 * the migrator's own snapshots (`_history/_migrate/**`) — the I5 measure. Runtime
 * noise (`_history/`, `_trash/`, `_canvas-state/`, `_state/`) is INCLUDED, so
 * "untouched" is proven, not assumed.
 */
export function fullTreeHash(
  designRoot: string,
  exclude: (rel: string) => boolean = () => false
): string {
  const h = createHash('sha256');
  const visit = (abs: string, rel: string) => {
    for (const n of readdirSync(abs).sort()) {
      const a = path.join(abs, n);
      const r = rel ? `${rel}/${n}` : n;
      if (r === '_history/_migrate' || exclude(r)) continue;
      const st = statSync(a);
      if (st.isDirectory()) visit(a, r);
      else h.update(`${r}\0${createHash('sha256').update(readFileSync(a)).digest('hex')}\n`);
    }
  };
  visit(designRoot, '');
  return h.digest('hex');
}

/** Every file path under `.design/` (for diff messages). */
export function listTree(designRoot: string): string[] {
  const out: string[] = [];
  const visit = (abs: string, rel: string) => {
    for (const n of readdirSync(abs).sort()) {
      const a = path.join(abs, n);
      const r = rel ? `${rel}/${n}` : n;
      if (r === '_history/_migrate') continue;
      if (statSync(a).isDirectory()) visit(a, r);
      else out.push(r);
    }
  };
  visit(designRoot, '');
  return out;
}

export interface Project {
  repo: string;
  design: string;
  dispose(): void;
}

export function fixtureProject(opts: { legacy?: boolean } = {}): Project {
  const repo = mkdtempSync(path.join(tmpdir(), 'migrate-v2-'));
  generateFormatFixture(repo, opts);
  return {
    repo,
    design: path.join(repo, '.design'),
    dispose: () => rmSync(repo, { recursive: true, force: true }),
  };
}

/**
 * The real-tree lane (§5.12): `MAUDE_MIGRATE_REAL_TREE=<alligators repo>` copies
 * the tree to a temp dir and UNLINKS it — strips `linkedHub` from config.json,
 * deletes `_sync.json` and `_state/` — so the copy can never talk to the live
 * hub (memory: unlink cloned projects before boot). Never touches the original.
 *
 * The real tree is ~10 GB (DS photography, video, chat transcripts), and the
 * migrator never reads media and only reads a transcript's HEAD, so the copy
 * leaves out the runtime folders no step reads (`_history/`, `_trash/`,
 * `_export-jobs/`, `_smoke/`, `_reports/`, `_cache/`, `_untrusted/`, `_state/`)
 * and keeps only the first 256 KB of any file over 2 MB.
 */
export function realTreeProject(src: string): Project {
  const repo = mkdtempSync(path.join(tmpdir(), 'migrate-v2-real-'));
  const SKIP = new Set([
    '_history',
    '_trash',
    '_export-jobs',
    '_smoke',
    '_reports',
    '_cache',
    '_untrusted',
    '_state',
    'node_modules',
    '.git',
  ]);
  const copy = (from: string, to: string, depth: number) => {
    mkdirSync(to, { recursive: true });
    for (const n of readdirSync(from)) {
      if (depth === 0 && SKIP.has(n)) continue;
      if (n === 'node_modules' || n === '.git') continue;
      const a = path.join(from, n);
      const st = statSync(a);
      if (st.isDirectory()) copy(a, path.join(to, n), depth + 1);
      else if (st.isFile()) {
        // bytes, not cpSync: a clone keeps the original's flags, and the real
        // tree has Finder-locked (uchg) photos the temp copy could never delete
        if (st.size <= 2 * 1024 * 1024) writeFileSync(path.join(to, n), readFileSync(a));
        else {
          const fd = openSync(a, 'r');
          const buf = Buffer.alloc(256 * 1024);
          const got = readSync(fd, buf, 0, buf.length, 0);
          closeSync(fd);
          writeFileSync(path.join(to, n), buf.subarray(0, got));
        }
      }
    }
  };
  copy(path.join(src, '.design'), path.join(repo, '.design'), 0);
  const design = path.join(repo, '.design');
  const cfgPath = path.join(design, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  delete cfg.linkedHub;
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  rmSync(path.join(design, '_sync.json'), { force: true });
  rmSync(path.join(design, '_state'), { recursive: true, force: true });
  for (const f of ['_server.json', '_server.lock']) rmSync(path.join(design, f), { force: true });
  return { repo, design, dispose: () => rmSync(repo, { recursive: true, force: true }) };
}

export function opts(p: Project, over: Partial<MigrateOptions> = {}): MigrateOptions {
  return {
    repoRoot: p.repo,
    designRel: '.design',
    direction: 'forward',
    now: () => new Date('2026-10-09T12:00:00.000Z'),
    liveStudio: () => false,
    dsEmitter: null,
    ...over,
  };
}

/** Dry-run, then apply that plan (the CLI's `--apply`). */
export async function run(o: MigrateOptions): Promise<MigrateReport> {
  const dry = await planMigration(o);
  return dry.exitCode === 0 ? applyMigration(o, dry) : dry;
}

/** A scripted hub for the linked-project cases. */
export function fakeHub(
  init: { formatVersion: number | null; capabilities?: string[]; reachable?: boolean } = {
    formatVersion: 1,
  }
) {
  const calls: Array<{ op: 'health' | 'setFormat'; formatVersion?: number; at: number }> = [];
  const state = {
    formatVersion: init.formatVersion,
    epoch: 4,
    reachable: init.reachable ?? true,
    refuse: null as null | { status: number; code: string },
    onSet: null as null | ((v: number) => void),
  };
  let tick = 0;
  const client: HubFormatClient = {
    async health() {
      calls.push({ op: 'health', at: ++tick });
      if (!state.reachable) return { ok: false };
      return {
        ok: true,
        formatVersion: state.formatVersion,
        capabilities: init.capabilities ?? ['ledger', 'annotations-v2', 'format-v2'],
        epoch: state.epoch,
      };
    },
    async setFormat(v) {
      calls.push({ op: 'setFormat', formatVersion: v, at: ++tick });
      state.onSet?.(v);
      if (state.refuse) return { ok: false, ...state.refuse };
      if (state.formatVersion !== v) state.epoch += 1;
      state.formatVersion = v;
      return { ok: true, epoch: state.epoch };
    },
  };
  return { client, calls, state };
}

export const exists = (p: string) => existsSync(p);
