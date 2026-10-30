// index/version-feed.ts — a recorded version joins the asset index's history cache (S8.11, A6c-2).
//
// "Not used" must count the assets an older version of a canvas still names (history-refs.ts). The
// background scan reads the history that exists at boot; a version recorded AFTER the scan has to be
// told to the index, or a picture only the newest-but-one version names would read "not used" until
// the next scan. Every accepted action reaches the studio as `project:action` (S5.15 — the hub
// link's, the local home's, a run's publish, an undo), carrying its `revision` and the canvases it
// touched; this reads those canvases' three lanes at that revision and calls `noteVersion`.
//
// v2.0 prunes no version anywhere (contract V2-1.9 §5.15, decision v2-V2-1.9-no-pruning-in-v2), so
// there is no `forgetVersion` call site yet: the pruning DDR's retention pass calls
// `index.forgetVersion(canvas, { rev })` where it deletes a body.
//
// A read that fails notes nothing — a false "used" is the safe error, and the next scan finds it.

import type { HistoryLanes } from './history-refs.ts';

export interface VersionFeedRuntime {
  acceptedVersion?(
    repoRel: string,
    revision: number,
    lane?: 'html' | 'css' | 'meta'
  ): Promise<string | null>;
}

export interface VersionFeedOptions {
  /** `ctx.syncControl.current()` — the hub link or the local home; null while none answers. */
  control: () => VersionFeedRuntime | null | undefined;
  /** `.design` — the action names canvases design-root-relative; versions are read repo-relative. */
  designRel: string;
  index: { noteVersion(canvas: string, ref: string, lanes: HistoryLanes): void };
  /** ctx.bus.on */
  on: (event: string, fn: (payload: unknown) => void) => unknown;
}

/** Subscribe the index to recorded versions. `settled` lets tests wait for the reads. */
export function feedVersionsToIndex(o: VersionFeedOptions): { settled(): Promise<void> } {
  const prefix = o.designRel.replace(/^\/+|\/+$/g, '');
  const inflight = new Set<Promise<void>>();

  async function note(canvases: string[], revision: number): Promise<void> {
    const rt = o.control();
    if (!rt?.acceptedVersion) return;
    for (const canvas of canvases) {
      const repoRel = prefix ? `${prefix}/${canvas}` : canvas;
      const read = (lane: 'html' | 'css' | 'meta') =>
        rt.acceptedVersion?.(repoRel, revision, lane) ?? Promise.resolve(null);
      try {
        const [html, css, meta] = await Promise.all([read('html'), read('css'), read('meta')]);
        o.index.noteVersion(canvas, `r${revision}`, { html, css, meta });
      } catch {
        /* unreachable now: the scan reads it later */
      }
    }
  }

  o.on('project:action', (p) => {
    const a = p as { revision?: unknown; canvases?: unknown } | null;
    if (!a || !Number.isSafeInteger(a.revision) || !Array.isArray(a.canvases)) return;
    const canvases = a.canvases.filter(
      (c): c is string => typeof c === 'string' && /\.tsx$/i.test(c)
    );
    if (!canvases.length) return;
    const run: Promise<void> = note(canvases, a.revision as number).finally(() =>
      inflight.delete(run)
    );
    inflight.add(run);
  });

  return { settled: async () => void (await Promise.allSettled([...inflight])) };
}
