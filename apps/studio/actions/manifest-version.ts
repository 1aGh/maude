// manifest-version.ts — the app side of the app↔plugin↔CLI handshake (contract V2-1.11 §5.6).
//
// `manifestVersion` is what scripts/gen-actions.mjs stamps into the generated
// apps/studio/actions.manifest.json: sha256 of the manifest's ids + verbs + schemas, first 12 hex.
// /_health serves it so the design plugin's `hook session-start` can tell when its bundled copy
// (plugins/design/actions.manifest.json — scripts/check-version-parity.sh pins the two equal in
// this repo) is older than the running app.
//
// The JSON is IMPORTED, not read from disk, so a `bun --compile` sidecar carries it inside the
// binary (DDR-045: no path resolution for it). The value is public: action ids and verb tiers.

import manifest from '../actions.manifest.json' with { type: 'json' };

/** The generated manifest's `manifestVersion` (12 hex), or null when it has none. */
export function actionsManifestVersion(): string | null {
  const v = (manifest as { manifestVersion?: unknown }).manifestVersion;
  return typeof v === 'string' && /^[0-9a-f]{12}$/.test(v) ? v : null;
}
