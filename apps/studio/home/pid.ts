// home/pid.ts — the project id (V2-1.1 §5.2), one derivation for the studio and the shell.
//
// `pid = 'l' + first 16 hex of sha256(realpath(root))`. The index (V2-2.17) already derives it in
// index/snapshot.ts; this module is the name the Home server and Rust's parity fixture point at, so
// there is exactly one implementation. test/home-pid.test.ts pins the vector Rust pins too.

export { pidOf } from '../index/snapshot.ts';

/** The shape every pid has — anything else is refused before it reaches a path join. */
export const PID_RE = /^l[0-9a-f]{16}$/;

export const isPid = (v: unknown): v is string => typeof v === 'string' && PID_RE.test(v);
