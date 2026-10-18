// The role matrix — Cloud Phase 25 C4, now ONE table for the whole product (V2-1.7 §5.2, S9.1).
//
// ONE TABLE, ONE AUTHORITY. What a role means is stated once, in
// `apps/studio/access/roles.ts`, and the cell, the control plane and the studio
// are all clients of it. This file re-exports it so every hub module keeps its
// import path — the hub never holds a matrix of its own again. Two enforcement
// points would drift, and the weaker one would become the way in.
//
// Node runs the `.ts` through its built-in type stripping (as with
// `../../studio/canvas-slug.ts`); the hub image bundles it (`build.ts`).
//
// The rows worth re-reading before any change live beside the table:
//   - COMMENT is the one write a `viewer` (Can comment) holds;
//   - ANNOTATE sits with EDIT (an annotation is versioned with the design);
//   - `observer` (Can view) holds only read, session and request;
//   - an unknown role gets NOTHING, and account roles (`admin`) are translated
//     by `projectRoleForAccount`, never passed to `can` raw.

export {
  ACCOUNT_ROLES,
  CAPABILITIES,
  can,
  capabilitiesFor,
  FLOOR_ROLE,
  isReadOnlyRole,
  levelOf,
  matrixRows,
  maxRole,
  PROJECT_ONLY,
  projectRoleForAccount,
  ROLES,
  rankOf,
  V1_ROLES,
} from '../../studio/access/roles.ts';
