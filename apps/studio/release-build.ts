// The build-time "this is a shipped build" constant, and the one gate every `MAUDE_E2E_*` switch goes through.
//
// The desktop e2e lanes drive the sidecar with `MAUDE_E2E_*` environment variables (a forced claude status, a fake
// installer, an install-path redirect, a fixed port ladder). Those are test harness hooks: a shipped build must not
// honour them, whatever its environment holds. The Rust side gates its twins on `debug_assertions`; the TypeScript
// side cannot (one compiled sidecar serves the debug e2e app and the release app), so `build.ts` bakes
// `__MAUDE_RELEASE_BUILD__` into the compiled binary: true for every `--release` build (the cloud variant always),
// absent for a run from source and for the e2e sidecar (`--release --e2e`, never passed by CI).
//
// Fail closed: only an explicit `true` means release, and the release build path sets it unless the caller asked
// for `--e2e`.

declare const __MAUDE_RELEASE_BUILD__: boolean | undefined;

/** True only inside a binary built as a release. Reading an undefined global through `typeof` never throws. */
export const IS_RELEASE_BUILD: boolean =
  typeof __MAUDE_RELEASE_BUILD__ !== 'undefined' && __MAUDE_RELEASE_BUILD__ === true;

/**
 * The value of an e2e switch, or `undefined` when this is a release build (the switch is ignored, not refused:
 * a shipped app behaves exactly as if the variable were not set). `release` is a parameter so a test can pin both
 * halves without a second compiled binary.
 */
export function e2eSwitch(
  env: Record<string, string | undefined>,
  name: string,
  release: boolean = IS_RELEASE_BUILD
): string | undefined {
  if (release) return undefined;
  return env[name];
}

/** The `--define` entries `build.ts` hands the compiler. `{}` for a build that keeps the e2e switches. */
export function releaseDefines(opts: {
  release: boolean;
  e2e: boolean;
  cloud: boolean;
}): Record<string, string> {
  // The cloud cell is always a shipped build, whatever else was asked.
  const shipped = opts.cloud || (opts.release && !opts.e2e);
  return shipped ? { __MAUDE_RELEASE_BUILD__: 'true' } : {};
}

/**
 * The defines a CANVAS build (canvas-build.ts, run by this server) carries: a release server tells the canvas it is a
 * shipped build, so canvas-lib code that reads `IS_RELEASE_BUILD` gets the server's answer (#212 §5: no still
 * globals on a shipped canvas). `{}` from source and in the e2e sidecar.
 */
export function canvasDefines(release: boolean = IS_RELEASE_BUILD): Record<string, string> {
  return release ? { __MAUDE_RELEASE_BUILD__: 'true' } : {};
}
