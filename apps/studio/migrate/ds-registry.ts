// The design-system registry seam the migrator's `ds.tokens` step needs
// (V2-1.12 §5.10, V2-1.13 §5.7 `ds-check --emit`).
//
// V2-2.15 owns the registry (`apps/studio/schema/ds-schema-v1.json`), the
// loader (`apps/studio/ds/registry.ts`) and the deterministic `tokens.json`
// emitter (V2-1.6 §5.3 shape). It has NOT landed on this branch, so the step
// runs against this interface and the default is `null` = "no emitter": the
// step reports `skip` with that reason, exactly as V2-1.12 §5.10 prescribes
// ("`skip` until V2-2.15 lands"). When V2-2.15 lands, it exports an object of
// this shape and `defaultDsEmitter()` returns it — no migrator change.

export interface DsSystemEntry {
  name: string;
  /** design-root-relative folder (`system/<ds>`) */
  path: string;
  /** design-root-relative tokens stylesheet */
  tokensCssRel: string;
}

export interface DsTokensEmitter {
  /** Registry version the emitted manifest declares (`$extensions["sh.maude"]`). */
  readonly registryVersion: number;
  /**
   * `ds-check --emit` in-process: the deterministic `tokens.json` bytes for a
   * system (same CSS → same bytes), or why it cannot be emitted (a converted
   * system — the app owns its manifest — or unreadable CSS).
   */
  emitTokens(input: {
    designRoot: string;
    system: DsSystemEntry;
    read: (rel: string) => Uint8Array | null;
  }): { bytes: Uint8Array } | { refused: string };
}

export const DS_EMITTER_PENDING =
  'the design-system registry (V2-2.15, `maude design ds-check --emit`) has not landed yet';

/** The emitter this build ships — none until V2-2.15. */
export function defaultDsEmitter(): DsTokensEmitter | null {
  return null;
}
