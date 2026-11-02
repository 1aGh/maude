// video/link-groups.ts — S7.13: which video artboards share one cut. The pure core of video/linked-formats.ts, kept free of
// every import so the canvas bundle (the link lines between linked artboards, video-links-overlay.tsx) can use the same rule
// as the server's Formats list without dragging the JSX parser in.
//
// A link is DERIVED, never stored: artboards that mount one comp share a cut. On the server the key of a comp is its name
// (`<VideoComp component={Recap}>`); on the canvas it is the component function itself. "Make an unlinked copy" forks the
// declaration as `<Comp>Unlinked[N]`, so a copy is recognised by name.

const UNLINKED_RE = /^(.+?)Unlinked\d*$/;

/** `RecapUnlinked2` → `Recap`; any other name → null. */
export function unlinkedBase(name: string | null | undefined): string | null {
  const m = typeof name === 'string' ? UNLINKED_RE.exec(name) : null;
  return m ? (m[1] as string) : null;
}

export interface LinkItem<K = string> {
  id: string;
  /** the comp the artboard mounts: a name on the server, the component function on the canvas */
  comp: K | null | undefined;
}

export interface LinkGroup<K = string> {
  comp: K;
  ids: string[];
}

/** Artboards that share a comp, in the order first seen. A comp only one artboard mounts is not a group. */
export function linkGroups<K>(items: ReadonlyArray<LinkItem<K>>): LinkGroup<K>[] {
  const by = new Map<K, string[]>();
  for (const it of items) {
    if (it.comp === null || it.comp === undefined) continue;
    const ids = by.get(it.comp);
    if (ids) ids.push(it.id);
    else by.set(it.comp, [it.id]);
  }
  return [...by.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([comp, ids]) => ({ comp, ids }));
}
