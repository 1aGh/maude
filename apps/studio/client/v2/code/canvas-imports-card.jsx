// client/v2/code/canvas-imports-card.jsx — gate-b-c4j: the card a canvas that imports another canvas
// shows instead of its render.
//
// A frame never inlines a canvas outside its own grant (access/closure.ts `walkImports`), whoever opens
// it: the server refuses the module (403). The shell knows which canvases do that from the index
// (`/_index-data` `canvasImportsCanvases`, canvas-url.js `canvasImportsOf`) and says so on the stage
// (shell/viewport.jsx), in place of the generic "can't be drawn" card. What happened · what to do; no
// action — the fix is in the code (move the shared part into a component file).

/** The card's two lines. `imports`: designRoot-relative names the viewer may see (may be empty). */
export function canvasImportsText(imports, componentDir) {
  const names = Array.isArray(imports) ? imports.filter((x) => typeof x === 'string' && x) : [];
  const dir =
    String(componentDir || 'ui/components').replace(/^\.?\/+|\/+$/g, '') || 'ui/components';
  return {
    title: names.length
      ? `This canvas imports another canvas (${names.join(', ')}).`
      : 'This canvas imports another canvas.',
    body: `Move the shared part into a component file (e.g. ${dir}/…) to render it here.`,
  };
}

export function CanvasImportsCard({ imports, componentDir }) {
  const { title, body } = canvasImportsText(imports, componentDir);
  return (
    <div className="st-canvas-error-card" data-testid="canvas-imports-card">
      <div className="st-canvas-error-title">{title}</div>
      <div className="st-canvas-error-body">{body}</div>
    </div>
  );
}
