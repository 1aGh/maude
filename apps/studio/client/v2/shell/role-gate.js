// client/v2/shell/role-gate.js — V2-4 gate (roles): what the shell does with an action the person's
// ROLE refuses, on the two paths that do not go through a drawn row (a drawn row is already
// absent or greyed by the registry's `visible` / `enabled` minRole — project-menu-model.js,
// search-model.js).
//
//   1. a shell key whose winner is disabled (resolve.ts: "a disabled winner still wins — the caller
//      swallows the key without running it"), and
//   2. a native menu item (`menu://action {id}`, e.g. File ▸ New Canvas ⌘N) — AppKit draws the
//      native menu without knowing the hub role.
//
// Either way the press is answered with the shell's one denial line (ROLE_DENIAL) when the role is
// what refuses it, and silently swallowed when something else does (no canvas open, wrong shell).
// PURE: no DOM, no React.

import { isEnabled, isVisible } from '../../../actions/resolve.ts';

/** Would an owner in the same context be allowed to run it, while this role is not? */
export function roleRefuses(def, ctx) {
  if (!def || !ctx) return false;
  if (isVisible(def, ctx) && isEnabled(def, ctx)) return false;
  const owner = { ...ctx, role: 'owner' };
  return isVisible(def, owner) && isEnabled(def, owner);
}

/** A shell key's resolved winner → 'run' | 'deny' (swallow + the denial line) | 'swallow'. */
export function keyOutcome(def, ctx) {
  if (isEnabled(def, ctx)) return 'run';
  return roleRefuses(def, ctx) ? 'deny' : 'swallow';
}
