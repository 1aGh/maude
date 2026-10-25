// client/v2/portal-scope.jsx — a portal into document.body that keeps the app's `.maude` scope.
//
// The body sits outside the app root (`.maude`, app.jsx), and every kit rule is scoped under it
// (`.maude .btn--primary`, 3-kit-maude-v2.css): a sheet or popover portalled straight into the body
// renders bare browser buttons and the v1 body face (D5 02 ob-ai-connect, 13 ds-edge-trash).
// `test/portal-scope.test.ts` holds every `createPortal(…, document.body)` in the client to this.

import { createPortal } from 'react-dom';

/** createPortal(node, document.body), wrapped in the `.maude` scope. Null where there is no document. */
export function portalToBody(node) {
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="maude">{node}</div>, document.body);
}
