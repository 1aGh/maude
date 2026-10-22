// gate-b-c4 — the per-frame capability (security C4, decision `v2-michal-c4-fix-in-wave-b`).
//
// THE ATTACK. Canvas code runs in the untrusted canvas iframe (DDR-054) with the rights of the
// person who OPENS the canvas, not of the person who wrote it. An editor whose grant covers one
// canvas A writes code into A; when the owner opens A, that code read B's board, comments and
// source through the canvas-safe routes with the owner's rights — and could write them into A's
// board, where its author reads them.
//
// THE FIX. Every request on the canvas and capture listeners is scoped to the canvas its frame
// was opened for. The trusted shell (main origin) opens a frame for A with `fc=<cap>` — a MAC over
// A's path under a key only the main origin hands out (`/_config` `frameKey`, per subject). The
// canvas listener verifies it and answers as the opener's access NARROWED to A: a canvas-only
// session holding A at the opener's role on A (an owner is `member` there — a grant never carries
// `owner`), so every existing canvas-only gate (canvasScopeRefusal, the closure-checked static
// lane, the seer filters, seesSlug, the socket frame classes) applies unchanged.
//
//   - Canvas code reads its own `fc` — it gains only A, which it already runs in.
//   - It cannot mint one for B: the key never reaches the canvas origin, and a key is per
//     subject, so a capability baked into canvas code by its author never verifies for anybody
//     else's request.
//   - Narrowing is an INTERSECTION with the request's own access: a capability can never widen.
//   - A request with no valid capability ("frame-less") gets nothing per canvas (fail closed):
//     only the vendor runtime, the shell document itself, the shell chrome and `/_health`.
//
// The capability rides as `?fc=` on what the shell builds (module, CSS, fetches, sockets) and in
// the Referer of everything else the frame loads (a nested import, an `<img>`, a CSS `url()`):
// a forged Referer can only name a capability the frame already has.
//
// KNOWN GAP (named, not fixed — needs per-canvas origins): two frames open side by side (split
// view, any second canvas iframe the shell keeps open) share ONE canvas origin, so
// canvas code in A can reach a sibling frame's document (`parent.frames[i]`, same-origin) and read
// ITS `fc` from its URL — and then ask as that sibling's canvas, B, with the opener's rights on B.
// The capability narrows a frame to its canvas only while no other canvas is open beside it.
// The gap is wider than split view: the design-system "reach" view (client/v2/ds/reach-view.jsx,
// the `ds-reach-iframe` grid) opens EVERY canvas that uses a design system as live sibling frames
// in one click, so any one of them can read every other's `fc` and act as each of those canvases.
// Closing that needs a distinct origin per canvas (or per open frame), so a sibling's document
// is cross-origin to A's code.
//
// Pure apart from the AsyncLocalStorage and node:crypto. No heavy imports (the hub imports
// access/*.ts under Node's strip-only TypeScript).

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { DEV_SERVER_ROOT } from '../paths.ts';
import type { ProjectRole } from './roles.ts';
import { type Access, type GrantRole, resolveAccess } from './scope.ts';

/** The query parameter the capability rides in. */
export const FRAME_PARAM = 'fc';
/** At most this many canvases in one capability (a multi-canvas export job). */
export const MAX_FRAME_CANVASES = 64;
const MAC_BYTES = 16;
const KEY_LABEL = 'maude-frame-key-v1\n';
const MSG_LABEL = 'maude-frame-v1\n';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** A canvas path a capability may name: designRoot-relative, POSIX, no traversal, no newline. */
export function validFrameCanvas(rel: unknown): rel is string {
  if (typeof rel !== 'string' || rel === '' || rel.length > 1024) return false;
  if (/[\n\r\0\\]/.test(rel) || rel.startsWith('/')) return false;
  return !rel.split('/').some((s) => s === '' || s === '.' || s === '..');
}

/** A fresh process secret (32 bytes). */
export function newFrameSecret(): Buffer {
  return randomBytes(32);
}

/**
 * The secret, kept in this machine's per-project state OUTSIDE the design root (gate-b-c4e: the
 * caller passes `<index dir>/projects/<pid>/frame-cap.key`), so a restarted server still accepts
 * the capabilities of the frames already open. Never under the design root: the canvas build
 * reaches everything there (an `import … with { type: 'text' }` inlines a file's bytes into the
 * module served to the canvas's own frame), so a key kept in `_state/` was a key handed to every
 * canvas author. `legacy` — the old in-tree file — is deleted, never migrated: it may already
 * have been read. Unreadable or unwritable: a fresh one for this process.
 */
export function loadFrameSecret(
  file: string,
  legacy?: string,
  forbiddenRoots: readonly string[] = []
): Buffer {
  // gate-b-c4g (L2) — asserted, not assumed: a key file that resolves (logically or through a
  // symlinked ancestor) inside the design root or the repo is a key the canvas build can reach or
  // a commit can carry. Then this process keeps an in-memory key (frames already open re-mint
  // after a restart) and says why.
  const fileForms = bothForms(file);
  const inside = forbiddenRoots.find((r) =>
    bothForms(r).some((root) => fileForms.some((f) => isUnderOrEqualPath(f, root)))
  );
  if (inside !== undefined) {
    console.warn(
      `[frame] the frame-capability key path ${file} is inside ${inside}; using an in-memory key for this session`
    );
    return newFrameSecret();
  }
  if (legacy) {
    try {
      rmSync(legacy, { force: true });
    } catch {
      /* read-only tree — the build refuses `_state/` imports regardless */
    }
  }
  try {
    const hex = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  } catch {
    /* none yet */
  }
  const fresh = newFrameSecret();
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${fresh.toString('hex')}\n`, { mode: 0o600 });
  } catch {
    /* read-only home — this process's own secret */
  }
  return fresh;
}

/**
 * The key one SUBJECT mints with (the shell receives it on `/_config`). A desktop's subject is
 * `''` (its secret is its own); a cell's is the proxy's vouched member, so one member's key never
 * mints a capability another member's request accepts.
 */
export function frameKeyFor(secret: Buffer, subject: string): Buffer {
  return createHmac('sha256', secret).update(`${KEY_LABEL}${subject}`).digest();
}

/**
 * gate-b-c4b — the subject a cell's frame key is minted for: the proxy's vouched member
 * (`x-maude-user`), else the session it vouches (`x-maude-session`, lead: Option A) — still one
 * key per session, never shared; neither (a request no proxy vouched) = no key (fail closed).
 * The NUL-framed session form cannot collide with a member name (a header holds no NUL).
 */
export function frameSubjectOf(headers: Headers): string | null {
  const user = (headers.get('x-maude-user') ?? '').trim();
  if (user) return user;
  const session = (headers.get('x-maude-session') ?? '').trim();
  return session ? `\0session\0${session}` : null;
}

function macOf(key: Buffer, canvases: readonly string[]): Buffer {
  return createHmac('sha256', key)
    .update(`${MSG_LABEL}${canvases.join('\n')}`)
    .digest()
    .subarray(0, MAC_BYTES);
}

/** `<b64url(canvases joined by \n)>.<b64url(mac)>` — what the client mints too (client/frame-cap.js). */
export function mintFrameCap(key: Buffer, canvases: readonly string[]): string | null {
  if (canvases.length === 0 || canvases.length > MAX_FRAME_CANVASES) return null;
  if (!canvases.every(validFrameCanvas)) return null;
  return `${b64u(canvases.join('\n'))}.${b64u(macOf(key, canvases))}`;
}

/** The canvases a capability names, or null when it is malformed or was minted under another key. */
export function verifyFrameCap(key: Buffer, token: string | null | undefined): string[] | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 128 * 1024) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  const canvases = Buffer.from(body, 'base64url').toString('utf8').split('\n');
  if (canvases.length > MAX_FRAME_CANVASES || !canvases.every(validFrameCanvas)) return null;
  const got = Buffer.from(sig, 'base64url');
  const want = macOf(key, canvases);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return canvases;
}

/** The capability a request carries: `?fc=` first, else its Referer's `fc` (subresources). */
export function frameTokenOf(req: Request): string | null {
  try {
    const own = new URL(req.url).searchParams.get(FRAME_PARAM);
    if (own) return own;
  } catch {
    return null;
  }
  const ref = req.headers.get('referer');
  if (!ref) return null;
  try {
    return new URL(ref).searchParams.get(FRAME_PARAM);
  } catch {
    return null;
  }
}

/** The role a narrowed frame holds on its canvas: the opener's, capped below `owner`. */
function frameRole(role: ProjectRole | null): GrantRole | null {
  if (role === null) return null;
  return role === 'owner' ? 'member' : role;
}

/**
 * `base` NARROWED to the frame's canvases: a canvas-only session holding each canvas `base` sees,
 * at `base`'s role there. Nothing `base` does not hold survives (an intersection, never a raise).
 * No canvas left = no access at all.
 */
export function narrowToFrame(base: Access, canvases: readonly string[] | null): Access {
  const grants: Array<{ c: string; r: GrantRole }> = [];
  for (const c of canvases ?? []) {
    if (!base.seesCanvas(c)) continue;
    const r = frameRole(base.roleFor(c));
    if (r) grants.push({ c, r });
  }
  const narrowed = resolveAccess(
    { v: 1, role: null, grants },
    { declaredAccess: base.minted.declaredAccess }
  );
  // gate-b-c4e — the opener's own access rides along. Grants nothing: gate-b-c4j's closure never
  // asks it (a frame inlines no canvas outside its own grant); it marks the access as a frame's.
  return Object.freeze({ ...narrowed, unnarrowed: base.unnarrowed ?? base });
}

// ---------------------------------------------------------------------------
// The request's frame (set by the canvas / capture listener, read by `accessOf`).

export interface FrameScope {
  /** The verified canvases, or null = frame-less (no valid capability). */
  canvases: string[] | null;
  /** gate-b-c4k — the subject the capability was minted for (`''` on a desktop; a cell's vouched
   *  member, `frameSubjectOf`). With `canvases` it keys the frame's own upload budget (api.ts). */
  subject?: string;
}

/** gate-b-c4k — the per-frame key (subject + sorted canvas set) of THIS request, or null. */
export function currentFrameKey(): string | null {
  const f = frameAls.getStore();
  if (!f?.canvases?.length) return null;
  return `${f.subject ?? ''}\u0000${[...f.canvases].sort().join('\n')}`;
}

const frameAls = new AsyncLocalStorage<FrameScope>();

/** Run `fn` as a canvas-listener request with this frame. */
export function runInFrame<T>(scope: FrameScope, fn: () => T): T {
  return frameAls.run(scope, fn);
}

/** THIS request's frame, or undefined on the main origin (no narrowing). */
export function currentFrame(): FrameScope | undefined {
  return frameAls.getStore();
}

/**
 * What a frame-less canvas-listener request may still reach: bytes that name nobody's project —
 * the vendor runtime, the shell document (its data comes through capability-carrying requests),
 * the shell's own chrome scripts and styles, and the health probe. Everything else is
 * `not-in-scope`, the missing-file answer (U1).
 */
export function framelessAllowed(rawPathname: string): boolean {
  let pathname: string;
  try {
    pathname = posix.normalize(decodeURIComponent(rawPathname));
  } catch {
    return false;
  }
  if (pathname === '/_health') return true;
  if (pathname === '/_canvas-shell.html' || pathname === '/_canvas-shell') return true;
  if (pathname.startsWith('/_canvas-runtime/')) return true;
  if (pathname.startsWith('/_client/')) return true;
  return false;
}

/** `p` and, when it differs, its real path (the nearest existing ancestor resolved). */
export function bothForms(p: string): string[] {
  const abs = resolve(p);
  let dir = abs;
  let rest = '';
  for (;;) {
    try {
      const real = realpathSync(dir);
      const full = rest ? join(real, rest) : real;
      return full === abs ? [abs] : [abs, full];
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return [abs];
      rest = rest ? join(basename(dir), rest) : basename(dir);
      dir = parent;
    }
  }
}

/** `p` is `root` or below it — `..` read as a path SEGMENT, never as a name prefix (`..notes/`). */
export function isUnderOrEqualPath(p: string, root: string): boolean {
  const rel = relative(root, p);
  return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/**
 * gate-b-c4g — Maude's own module roots: the studio tree (canvas-lib, the runtime bundles under
 * `dist/runtime`) and the dependencies it ships (`node_modules` beside it, or hoisted one level
 * up in the npm layout), in their logical and real spellings. The only files a built canvas may
 * inline from outside its design root.
 */
export const MAUDE_MODULE_ROOTS: readonly string[] = [
  ...bothForms(DEV_SERVER_ROOT),
  ...bothForms(join(DEV_SERVER_ROOT, 'node_modules')),
  ...bothForms(join(DEV_SERVER_ROOT, '..', '..', 'node_modules')),
];

function notInScope(): Response {
  return Response.json(
    { error: 'not-in-scope', reason: 'not-in-scope' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * gate-b-c4e — defence in depth behind the build's import allowlist: a built canvas module goes
 * to a canvas-only session (every frame is one) only when EVERY design-root file the build
 * inlined is one the session sees. `inputs` are absolute (the bundler reports real paths, so
 * `roots` carries the design root's logical and real spellings). Anything not seen → the
 * missing-file answer (U1), fail closed: the module is never cut down to what is visible.
 *
 * gate-b-c4g — every OTHER input must be one of Maude's own modules (`ours`, default
 * `MAUDE_MODULE_ROOTS`): a `package.json` `main` / `browser` field inside the design root sent a
 * directory import to any file on disk, and this gate used to wave every out-of-root input
 * through. With `entry`, the list must also name the entry canvas (logical or real): an empty or
 * partial metafile is no evidence that the module inlined nothing.
 */
export function inputsRefusal(
  inputs: readonly string[],
  roots: readonly string[],
  sees: (rel: string) => boolean,
  opts: { entry?: string; ours?: readonly string[] } = {}
): Response | null {
  const ours = opts.ours ?? MAUDE_MODULE_ROOTS;
  if (opts.entry !== undefined) {
    const entryForms = bothForms(opts.entry);
    if (!inputs.some((abs) => isAbsolute(abs) && entryForms.includes(resolve(abs))))
      return notInScope();
  }
  for (const abs of inputs) {
    if (!isAbsolute(abs)) return notInScope();
    let inDesign = false;
    for (const root of roots) {
      if (!isUnderOrEqualPath(abs, root)) continue;
      inDesign = true;
      const rel = relative(root, abs);
      if (rel === '' || !sees(rel.split(sep).join('/'))) return notInScope();
      break;
    }
    if (!inDesign && !ours.some((r) => isUnderOrEqualPath(abs, r))) return notInScope();
  }
  return null;
}

/**
 * The canvas / capture listener's frame gate, run INSIDE `runInFrame` with the request's
 * (narrowed) access: a request whose frame holds no canvas — no capability, a forged one, or
 * one for a canvas the opener cannot see — reaches only `framelessAllowed`.
 */
export function frameRefusal(rawPathname: string, narrowed: Access): Response | null {
  if (framelessAllowed(rawPathname) || narrowed.grants.length > 0) return null;
  return Response.json(
    { error: 'not-in-scope', reason: 'not-in-scope' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } }
  );
}
