// client/v2/code/canvas-imports-card.jsx — gate-b-c4j: the card a canvas that imports another canvas
// shows instead of its render.
//
// A frame never inlines a canvas outside its own grant (access/closure.ts `walkImports`), whoever opens
// it: the server refuses the module (403). The shell knows which canvases do that from the index
// (`/_index-data` `canvasImportsCanvases`, canvas-url.js `canvasImportsOf`) and says so on the stage
// (shell/viewport.jsx), in place of the generic "can't be drawn" card. What happened · what to do; no
// action — the fix is in the code (move the shared part into a component file).
//
// 2.0.5 (#205): a walk the closure did not block can still be refused AFTER the build, when the module inlined
// a design-root file the frame does not admit (http.ts `canvasInputsGate`). The server keeps those files per
// canvas and the index reports them (`canvasRefusedInputs`, canvas-url.js `canvasRefusedOf`): the card names
// them too — "This canvas uses <file>, which belongs to another canvas."

import { canvasImportsText } from './canvas-imports-words.js';

export { canvasImportsText };

export function CanvasImportsCard({ imports, refused, componentDir }) {
  const { title, also, body } = canvasImportsText(imports, componentDir, refused);
  return (
    <div className="sh-canvas-error-card" data-testid="canvas-imports-card">
      <div className="sh-canvas-error-title">{title}</div>
      {also.map((line) => (
        <div key={line} className="sh-canvas-error-body">
          {line}
        </div>
      ))}
      <div className="sh-canvas-error-body">{body}</div>
    </div>
  );
}
