// client/v2/inspector/sections/row.jsx — S2.3: a labelled row inside a section body (14 Editing, `Row`).
// `name` is the testid suffix: insp-row-<name>.

export function Row({ k, name, dim = false, children }) {
  return (
    <div className="insp-row" data-testid={`insp-row-${name}`} data-dim={dim ? 'true' : undefined}>
      <span className="insp-row-k">{k}</span>
      <span className="insp-row-v">{children}</span>
    </div>
  );
}

/** A quiet line under a row: what is true, in one sentence. */
export function Quiet({ children, testid }) {
  return (
    <p className="insp-quiet" data-testid={testid}>
      {children}
    </p>
  );
}

/** The measured size of the object in world px — what a Fixed value starts from. */
export const worldSize = (el) => ({
  width: Math.round(el?.worldW ?? el?.bounds?.w ?? 0),
  height: Math.round(el?.worldH ?? el?.bounds?.h ?? 0),
});

/** What an element's CSS says: what the file authored, over what the browser resolved for the layout keys. */
const LAYOUT_COMPUTED = ['display', 'flex-direction', 'justify-content', 'align-items', 'position'];
export function effectiveCss(el, authored) {
  const out = {};
  for (const k of LAYOUT_COMPUTED) {
    const v = el?.computed?.[k];
    if (v && v !== 'normal') out[k] = v;
  }
  return { ...out, ...authored };
}
