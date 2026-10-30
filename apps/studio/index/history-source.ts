// index/history-source.ts — the history scan's window onto a home's versions (S8.11).
//
// `HistorySource` (history-refs.ts) is what "Not used" reads older versions through. This adapts the
// sync runtime the Version-history panel already reads (history/versions.ts `VersionsRuntime`:
// `acceptedHistory` + `acceptedVersion`) so there is one reader of a canvas's versions, not two.
// A version's ref is `r<revision>` (immutable); a home with no history answers `null`; a home that
// cannot be reached REJECTS, so the scan stays "checking" instead of concluding anything.
//
// Wired by the host (http.ts), not by the CLI: the static `maude design assets` has no runtime.

import { historyVersions, type VersionsRuntime } from '../history/versions.ts';
import type { HistorySource } from './history-refs.ts';

/** A scan reads every retained version of a canvas, so the look-back cap is effectively off. */
const ALL = 1_000_000;

export function historySourceFromRuntime(
  runtime: VersionsRuntime | null | undefined,
  designRel: string
): HistorySource | null {
  if (!runtime?.acceptedHistory || !runtime.acceptedVersion) return null;
  const repoRel = (canvas: string) => `${designRel}/${canvas}`;
  return {
    async versions(canvas) {
      const walk = await historyVersions(runtime, {
        repoRel: repoRel(canvas),
        canvas,
        lookBack: ALL,
        enough: () => false,
      });
      return walk ? walk.versions.map((v) => `r${v.rev}`) : null;
    },
    async text(canvas, ref, lane) {
      const rev = /^r(\d+)$/.exec(ref)?.[1];
      if (!rev) return null;
      return (await runtime.acceptedVersion?.(repoRel(canvas), Number(rev), lane)) ?? null;
    },
  };
}
