import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Crash-safe snapshot/restore for VERSIONED fixture files a scenario writes
// through to disk (canvas .tsx sources, annotations SVG, .design/config.json).
//
// The naive shape — read in `before`, write back in `after` — restores only on a
// clean exit. A crashed or killed run skips `after` and leaves the tree dirty;
// worse, the NEXT run's `before` then snapshots the DIRTY state as its baseline
// and cascades (observed: one run reported 6 failures purely from this, and it
// broke a `git stash pop` mid-investigation).
//
// So the snapshot is also written to a gitignored sidecar under _e2e-evidence/.
// Its presence at `snapshot()` time means the previous run never reached
// `restore()` — we repair the tree from it BEFORE baselining, which is what
// stops the cascade. `restore()` deletes the sidecar, so a clean run leaves
// nothing behind.
//
// Sidecar keys are stored relative to the e2e root, not absolute: ~/git is a
// Syncthing tree (see the root CLAUDE.md), and an absolute path from another
// machine would not resolve here.

const E2E_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIDECAR_DIR = join(E2E_ROOT, '_e2e-evidence', 'fixture-guard');

// `null` = the file did not exist when we baselined; restoring means deleting
// it again (cloud-attach's config.json is optional in the fixture).
type Snapshot = Record<string, string | null>;

export type FixtureGuard = {
  /** Repair any leftover dirt from a killed run, then baseline the given files. */
  snapshot(): void;
  /** Byte-exact restore + drop the sidecar. Idempotent. */
  restore(): void;
  /**
   * The bytes baselined for `file`, for tests that assert "only the line I
   * edited changed". Throws if called before `snapshot()` or for a file the
   * guard was not given — a silent `undefined` there would turn into a
   * vacuously-passing integrity assertion.
   */
  baselineOf(file: string): string;
};

function sidecarPath(scenario: string): string {
  return join(SIDECAR_DIR, `${scenario}.json`);
}

/**
 * `allowed` is the guard's OWN file list — the sidecar is parsed from disk, so
 * its keys are not trusted input. Without this, a corrupt or hand-edited
 * sidecar carrying `../../../..`-style keys would make a "repair" write
 * anywhere the test user can reach. A guard may only ever put back the files it
 * was constructed with.
 */
function writeAll(snap: Snapshot, allowed: Set<string>): number {
  let written = 0;
  for (const [rel, content] of Object.entries(snap)) {
    if (!allowed.has(rel)) {
      console.warn(`[fixture-guard] ignoring unexpected sidecar entry: ${rel}`);
      continue;
    }
    const abs = join(E2E_ROOT, rel);
    if (content === null) rmSync(abs, { force: true });
    else writeFileSync(abs, content);
    written += 1;
  }
  return written;
}

function readOrNull(abs: string): string | null {
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/**
 * @param scenario slug used for the sidecar filename (one per scenario file)
 * @param files    absolute paths to the versioned fixtures the scenario mutates
 */
export function createFixtureGuard(scenario: string, files: string[]): FixtureGuard {
  const rels = files.map((f) => relative(E2E_ROOT, f));
  const allowed = new Set(rels);
  const sidecar = sidecarPath(scenario);
  let baseline: Snapshot | null = null;
  let detach: (() => void) | null = null;

  function restore(): void {
    if (baseline) {
      writeAll(baseline, allowed);
      baseline = null;
    }
    rmSync(sidecar, { force: true });
    detach?.();
    detach = null;
  }

  function snapshot(): void {
    // Idempotent while a baseline is held: the guard already snapshots when it is created (below).
    if (baseline) return;
    // A sidecar here is the fingerprint of a run that died before restoring.
    // Its contents are the last known-good bytes — put them back first, so the
    // baseline we take below is pristine rather than the previous run's damage.
    if (existsSync(sidecar)) {
      try {
        const stale = JSON.parse(readFileSync(sidecar, 'utf8')) as Snapshot;
        const repaired = writeAll(stale, allowed);
        console.warn(
          `[fixture-guard] previous "${scenario}" run did not restore; repaired ` +
            `${repaired} fixture file(s) from the sidecar.`
        );
      } catch (err) {
        // A truncated sidecar (killed mid-write) is not worth failing the run
        // over — but it MUST be loud, because the baseline below may be dirty.
        console.warn(`[fixture-guard] unreadable sidecar for "${scenario}": ${String(err)}`);
      }
      rmSync(sidecar, { force: true });
    }

    baseline = Object.fromEntries(rels.map((rel) => [rel, readOrNull(join(E2E_ROOT, rel))]));
    mkdirSync(SIDECAR_DIR, { recursive: true });
    writeFileSync(sidecar, JSON.stringify(baseline, null, 2));

    // Belt for the signals we CAN catch (Ctrl-C, a supervisor's TERM, a throw
    // that escapes mocha). SIGKILL stays uncatchable — that is what the sidecar
    // is for, and why it is written before a single test runs.
    const onSignal = (): void => {
      restore();
      process.exit(1);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    process.once('exit', restore);
    detach = () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      process.off('exit', restore);
    };
  }

  function baselineOf(file: string): string {
    if (!baseline) throw new Error(`[fixture-guard] baselineOf("${file}") before snapshot()`);
    const rel = relative(E2E_ROOT, file);
    const content = baseline[rel];
    if (content == null) {
      throw new Error(
        `[fixture-guard] "${rel}" is not a guarded file of "${scenario}" (or did not exist)`
      );
    }
    return content;
  }

  // Baseline at creation. A spec that writes the fixture in its `before()` and only calls
  // `restore()` in `after()` (nine wave-A edit-* specs did) otherwise restores nothing, leaves
  // Smoke.tsx rewritten, and every later spec in the lane fails on a canvas it does not know.
  snapshot();

  return { snapshot, restore, baselineOf };
}
