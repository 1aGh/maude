// Byte-identity of the served client — Cloud Phase 27 E1 + D5, under DDR-209.
//
// The phase's promise is "the browser loads the byte-identical `client.bundle.js`
// the desktop loads". A promise nobody checks is a comment, so this checks it:
// the image records the sha256 of every client artifact it staged, and the cell
// refuses to boot when what is on disk is not what was recorded.
//
// WHY A HASH AND NOT A VERSION. From the last outage's own RCA: the monitor
// checked that something answered 200, and the rollback went to a TAG whose
// contents CI had since overwritten. A tag is not an identity. A hash is. The
// same reasoning is why `/health` reports the hash rather than the version — an
// operator comparing two cells wants to know whether they are running the same
// bytes, and two cells can carry the same tag and different bytes.
//
// WHY IT ALSO REPORTS A VERSION NOW, AND WHY THAT IS NOT A RETREAT.
//
// The argument above is against a version REPLACING the hash. It is not an
// argument against both, and v0.57.0 is the proof: a cell image tagged v0.57.0
// went to production whose hub layer had been built from v0.56.0, and every
// workflow was green. The hash could not catch it. The stale layer had staged
// its OWN bundles, so its manifest was perfectly self-consistent — a
// SELF-CONSISTENT WRONG IMAGE. Every artifact matched what the image recorded,
// because the image recorded the wrong artifacts.
//
// So the two answer different questions, and a gate wants both:
//
//   hash    — "are these the bytes this image was sealed with?"
//             catches substitution: same tag, different bytes.
//   version — "which RELEASE are these bytes from?"
//             catches derivation: the layer underneath is the previous release.
//
// Neither subsumes the other. the deploy repo's (1aGh/maude-deploy) post-deploy gate asserts
// both against the tag it just deployed, which is what makes "green" mean "the
// fleet answers on the released version" rather than "an upload returned 0".
//
// WHAT IT CATCHES THAT NOTHING ELSE DOES. `dist/client.bundle.js` is REBUILT at
// package time (see CLAUDE.md — the committed copy is NOT what ships), and
// v0.51.1 shipped a desktop app that opened to a blank window because of it: no
// crash, no log, React mounted nothing. A build-time hash plus a boot-time
// comparison turns "the artifact silently changed under us" from an outage into
// a refusal with a filename in it.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The artifacts whose identity is load-bearing for what a member sees. */
export const TRACKED_ARTIFACTS = Object.freeze(['dist/client.bundle.js', 'dist/styles.css']);

/** Where the image records what it staged. */
export const MANIFEST_NAME = 'bundle-manifest.json';

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Hash every tracked artifact under `studioRoot`.
 *
 * @returns {{ [rel: string]: string | null }} null for an artifact that is absent
 */
export function hashArtifacts(studioRoot, artifacts = TRACKED_ARTIFACTS) {
  const out = {};
  for (const rel of artifacts) {
    const abs = join(studioRoot, rel);
    out[rel] = existsSync(abs) ? sha256File(abs) : null;
  }
  return out;
}

/**
 * Compare what is on disk against what the image recorded.
 *
 * `missing` and `mismatched` are kept apart on purpose: an absent bundle is a
 * PACKAGING failure (the stage step did not run) and a differing one is a
 * SUBSTITUTION (something rebuilt or replaced it after the image was sealed).
 * They have different fixes and an operator should not have to guess which they
 * are looking at.
 */
export function compareArtifacts(actual, recorded) {
  const missing = [];
  const mismatched = [];
  for (const [rel, expected] of Object.entries(recorded ?? {})) {
    const got = actual[rel] ?? null;
    if (got === null) missing.push(rel);
    else if (got !== expected) mismatched.push({ rel, expected, got });
  }
  return { ok: missing.length === 0 && mismatched.length === 0, missing, mismatched };
}

/** Read the manifest the image wrote, or null when there is none. */
export function readManifest(dir) {
  const path = join(dir, MANIFEST_NAME);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed.artifacts ?? parsed) : null;
  } catch {
    return null;
  }
}

/**
 * The boot gate.
 *
 * NO MANIFEST IS NOT A PASS — but it is also not a failure everywhere. A dev
 * checkout has no image and never staged anything, and refusing to boot there
 * would make the cloud path untestable locally, which is how a guard ends up
 * disabled. So the manifest's ABSENCE is fatal only when the caller says this is
 * a sealed image (`required`), and the cell entrypoint is what says so.
 *
 * @returns {{ ok: boolean, reason: string|null, detail: object }}
 */
export function checkBundleIdentity({ studioRoot, manifestDir, required = false } = {}) {
  const recorded = readManifest(manifestDir ?? studioRoot);
  if (!recorded) {
    if (!required) {
      return { ok: true, reason: 'no-manifest', detail: { note: 'unsealed build — not checked' } };
    }
    return {
      ok: false,
      reason: 'no-manifest',
      detail: { note: `${MANIFEST_NAME} is absent from a sealed image` },
    };
  }
  const actual = hashArtifacts(studioRoot, Object.keys(recorded));
  const cmp = compareArtifacts(actual, recorded);
  return {
    ok: cmp.ok,
    reason: cmp.ok ? null : cmp.missing.length > 0 ? 'missing' : 'mismatched',
    detail: cmp,
  };
}

/** The message an operator sees when a cell refuses to start over this. */
export function formatIdentityFailure(result) {
  const lines = [
    'REFUSING TO START: the client this cell would serve is not the client this',
    'image was built with (Cloud Phase 27 E1).',
    '',
  ];
  for (const rel of result.detail.missing ?? []) {
    lines.push(`  ${rel} — MISSING. The image did not stage it, or something removed it.`);
  }
  for (const { rel, expected, got } of result.detail.mismatched ?? []) {
    lines.push(`  ${rel} — REPLACED.`);
    lines.push(`      image recorded ${expected.slice(0, 16)}…`);
    lines.push(`      on disk         ${got.slice(0, 16)}…`);
  }
  if (result.reason === 'no-manifest') {
    lines.push(`  ${MANIFEST_NAME} is absent — this image was never sealed.`);
  }
  lines.push(
    '',
    'The whole point of this phase is that all three shells serve the SAME',
    'client. A cell serving a different one is the drift it exists to delete —',
    'and it fails the way v0.51.1 did: a blank window, no crash, no log.',
    '',
    'Rebuild the image rather than editing the artifact in place.'
  );
  return lines.join('\n');
}

/**
 * Which RELEASE the served client comes from.
 *
 * Read from the studio root's own `package.json` — the same root whose bytes
 * `hashArtifacts` seals, so the version and the hash describe one thing rather
 * than two that could drift apart. That manifest is staged into the image
 * beside the client it describes; a dev checkout has it too.
 *
 * Returns null when there is no readable manifest. The caller decides what to
 * fall back to — an absent version must stay distinguishable from a wrong one.
 */
export function readStudioReleaseVersion(studioRoot) {
  try {
    const parsed = JSON.parse(readFileSync(join(studioRoot, 'package.json'), 'utf8'));
    return typeof parsed?.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/** The identity `/health` reports (D5). A tag is not an identity; a hash is. */
export function identityForHealth({ studioRoot, manifestDir } = {}) {
  const recorded = readManifest(manifestDir ?? studioRoot) ?? {};
  const actual = hashArtifacts(
    studioRoot,
    Object.keys(recorded).length ? Object.keys(recorded) : TRACKED_ARTIFACTS
  );
  const cmp = compareArtifacts(actual, recorded);
  return {
    ok: Object.keys(recorded).length === 0 ? null : cmp.ok,
    // Short prefixes: an operator eyeballs these across two cells, and 64 hex
    // characters in a health payload is noise that hides the answer.
    artifacts: Object.fromEntries(
      Object.entries(actual).map(([rel, sha]) => [rel, sha ? sha.slice(0, 12) : null])
    ),
  };
}
