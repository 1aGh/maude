// client/stamp-follow.js — p8-sweep-close (4): an edit-op sent with an id the previous write retired.
//
// An object with no authored id is addressed by its computed id (8 hex, `Component:index`). The first
// gesture on it STAMPS it (V2-1.4 rule 3, `ensureStamped`): the file now names it `frame`, and the
// computed id names nothing. The Layers panel (and the canvas DOM) keep the old id until the canvas
// reloads and posts its tree again, so a second click in that window — Hide, then Show again; Lock right
// after Hide — sent an id the file no longer has, and the server refused it: "One of the objects is not on
// this canvas." (the dynamic sweep's `POST /_api/edit-op` 400).
//
// The shell knows the answer: the first write's result carries the stamped refs. So it remembers
// `computed → stamped` per file and artboard, and rewrites a LATER request's target — but only a request
// built from the tree that was current when the rename happened. Each fresh tree (`layers-tree`, `loaded`)
// moves the generation on; a request made after it used the new ids and is never rewritten, so a computed
// id that a later insert hands to a DIFFERENT element is never redirected.

const CAP = 64;

export function createStampFollow() {
  let gen = 0;
  /** @type {Array<{ file: string, artboard: string, from: string, to: string, gen: number }>} */
  let renames = [];
  return {
    /** The generation a request is built against — read when its message arrives. */
    generation: () => gen,
    /** A fresh tree / a reload: requests made from now on carry the new ids. */
    bump() {
      gen += 1;
    },
    /** Remember what an ok edit-op renamed (`targets[i].element` → `refs[i].element`). */
    record(file, targets, refs) {
      if (!file || !Array.isArray(targets) || !Array.isArray(refs)) return;
      targets.forEach((t, i) => {
        const r = refs[i];
        if (!t?.element || !r?.element || t.element === r.element || t.occurrence) return;
        renames = renames.filter(
          (x) => !(x.file === file && x.artboard === t.artboard && x.from === t.element)
        );
        renames.push({ file, artboard: t.artboard, from: t.element, to: r.element, gen });
      });
      if (renames.length > CAP) renames = renames.slice(-CAP);
    },
    /** The request with every retired id it still names replaced; the same object when none. */
    rewrite(body, builtAt) {
      if (!body?.file || !Array.isArray(body.targets) || !renames.length) return body;
      let changed = false;
      const targets = body.targets.map((t) => {
        if (!t?.element || t.occurrence) return t;
        const hit = renames.find(
          (x) =>
            x.file === body.file &&
            x.artboard === t.artboard &&
            x.from === t.element &&
            builtAt <= x.gen
        );
        if (!hit) return t;
        changed = true;
        return { ...t, element: hit.to };
      });
      return changed ? { ...body, targets } : body;
    },
  };
}
