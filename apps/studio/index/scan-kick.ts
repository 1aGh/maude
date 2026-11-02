// index/scan-kick.ts — start the history scan once a home can be read (S8.12).
//
// "Not used" reads retained versions through the sync runtime (history-source.ts). The index is built in http.ts,
// before server.ts attaches `ctx.syncControl`, so the service's own start at construction finds no home and the scan
// stays 'idle' (then "Not used" is 'checking' for the whole session — safe, but never useful). This asks every
// `everyMs` whether a home answers, kicks once when it does, and stops after `tries` asks.

export interface ScanKickOptions {
  /** a home answers (`ctx.syncControl.current()` is non-null) */
  ready: () => boolean;
  /** `index.startHistoryScan()` */
  kick: () => void;
  everyMs?: number;
  tries?: number;
}

/** @returns stop — cancels a pending ask */
export function kickWhenReady(o: ScanKickOptions): () => void {
  const everyMs = o.everyMs ?? 500;
  let left = o.tries ?? 60;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const ask = () => {
    timer = null;
    left--;
    let up = false;
    try {
      up = o.ready();
    } catch {
      /* not ready */
    }
    if (up) {
      o.kick();
      return;
    }
    if (left > 0) {
      timer = setTimeout(ask, everyMs);
      timer.unref?.();
    }
  };
  timer = setTimeout(ask, 0);
  timer.unref?.();
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    left = 0;
  };
}
