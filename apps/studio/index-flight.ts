// apps/studio/index-flight.ts — #204: one project-index build at a time per reader.
//
// `/_index-data` walks every canvas group, reads each canvas's sidecar and its import closure: on a
// ~311-canvas, 7612-file workspace on a small cell that took longer than the client's timeout. The
// client aborted and asked again, but an aborted fetch does not stop the build on the server, so
// every retry started ANOTHER full build next to the one still running — each slower than the last.
//
// A request that arrives while a build for the same reader is in flight joins it, as long as the
// tree has not changed since that build started (`bump()` on every file event). A change after it
// started means its answer would be stale, so the next caller starts a fresh one.

export interface SingleFlight<T> {
  run(key: string, build: () => Promise<T>): Promise<T>;
  /** The tree changed: builds started before now must not be shared with later callers. */
  bump(): void;
  /** In-flight builds (for tests). */
  size(): number;
}

export function createSingleFlight<T>(): SingleFlight<T> {
  let gen = 0;
  const flights = new Map<string, { gen: number; promise: Promise<T> }>();
  return {
    run(key, build) {
      const hit = flights.get(key);
      if (hit && hit.gen === gen) return hit.promise;
      const entry = { gen, promise: Promise.resolve().then(build) };
      flights.set(key, entry);
      const clear = () => {
        if (flights.get(key) === entry) flights.delete(key);
      };
      entry.promise.then(clear, clear);
      return entry.promise;
    },
    bump() {
      gen++;
    },
    size: () => flights.size,
  };
}
