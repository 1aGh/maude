// Structured canvas errors — S11.6 (contract S11-slices §3 row S11.6, decision
// `v2-S11-canvas-source-route`). Feeds the broken-canvas card (S11.7 ad-edge-syntax, S6 C5) and
// `maude design canvas-errors`.
//
// ONE shape for "this canvas can't be drawn": `CanvasError {kind, message, file, line, column,
// lineText}`. `file` is design-root-relative (never an absolute server path: a cell must not hand a
// tenant its container layout); `line` and `column` are 1-based, the column counted in UTF-16
// units of the line as an editor shows it; `lineText` is that line of the ORIGINAL source.
//
// Where the positions come from:
//   - a syntax error: `Bun.Transpiler` (the same parser family as Bun.build — `BuildMessage
//     .position`), then oxc (canvas-pipeline's pass 1, which is what the live build runs first),
//     so a file either engine refuses is reported;
//   - a build error (an import that does not resolve, an import the allowlist refuses): the
//     `BuildMessage` / `ResolveMessage` logs of Bun.build — `canvas-build.ts` throws
//     `CanvasBuildError` carrying them.
//
// Every string here can hold tenant-authored text (the line, a specifier). It is DATA: the routes
// answer it as JSON, the verb prints it inside the untrusted block.
//
// Leaf module: `oxc-parser` and node built-ins only (canvas-build.ts imports it).

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';

import { hasMacroImport, macroImportRefusal } from '../macro-guard.ts';

export type CanvasErrorKind = 'syntax' | 'resolve' | 'build';

export interface CanvasError {
  kind: CanvasErrorKind;
  message: string;
  /** design-root-relative POSIX path (`ui/pricing.tsx`); a file outside the design root: its name. */
  file: string;
  /** 1-based; 0 when the engine gave no position. */
  line: number;
  /** 1-based, UTF-16 units; 0 when the engine gave no position. */
  column: number;
  /** The source line `line` names (capped), '' without a position. */
  lineText: string;
}

const MAX_LINE_TEXT = 400;
const MAX_MESSAGE = 2000;

/** What a conversion needs to know about the build it came from. */
export interface ErrorContext {
  designRoot: string;
  /** The canvas being built (absolute). Its own errors are re-read against `source`. */
  canvasAbs: string;
  /** The canvas's ORIGINAL source (before pass 1 injected `data-cd-id`s). */
  source: string;
}

/**
 * Bun.build failed. `message` stays what canvas-build always threw (http.ts's 500 body and the
 * format-gate line read it); the structured half is `errors` (first = the one to show).
 */
export class CanvasBuildError extends Error {
  readonly errors: CanvasError[];
  /** The allowlist's refusal count (Cloud Phase 26 Stage 4 cost lane) — no specifier in it. */
  readonly rejectedImports?: number;
  constructor(message: string, errors: CanvasError[], rejectedImports?: number) {
    super(message);
    this.name = 'CanvasBuildError';
    this.errors = errors;
    if (rejectedImports !== undefined) this.rejectedImports = rejectedImports;
  }
}

// ---------------------------------------------------------------------------
// Positions.

const lineAt = (source: string, line: number): string => {
  if (line < 1) return '';
  let at = 0;
  for (let i = 1; i < line; i++) {
    const nl = source.indexOf('\n', at);
    if (nl < 0) return '';
    at = nl + 1;
  }
  const end = source.indexOf('\n', at);
  return source.slice(at, end < 0 ? undefined : end).replace(/\r$/, '');
};

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** A UTF-16 index into `source` → 1-based line and column. */
export function lineColumnOf(source: string, index: number): { line: number; column: number } {
  const i = Math.max(0, Math.min(index, source.length));
  let line = 1;
  let lineStart = 0;
  for (let k = source.indexOf('\n'); k >= 0 && k < i; k = source.indexOf('\n', k + 1)) {
    line++;
    lineStart = k + 1;
  }
  return { line, column: i - lineStart + 1 };
}

/** A UTF-8 byte offset into `source` → its UTF-16 index (Bun reports byte offsets). */
function utf16IndexOf(source: string, byteOffset: number): number {
  const bytes = Buffer.from(source, 'utf8');
  return bytes.subarray(0, Math.max(0, Math.min(byteOffset, bytes.length))).toString('utf8').length;
}

/** An absolute path as the error names it: design-root-relative, else just its name. */
export function displayFile(abs: string, designRoot: string): string {
  const roots = [path.resolve(designRoot)];
  try {
    const real = realpathSync(designRoot);
    if (real !== roots[0]) roots.push(real);
  } catch {
    /* the root itself is gone — only the logical form */
  }
  for (const r of roots) {
    const rel = path.relative(r, path.resolve(abs));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  }
  return path.basename(abs);
}

/** Every absolute path in a message → its display form (no server layout leaks). */
export function scrubPaths(message: string, designRoot: string): string {
  return message.replace(/(?:[A-Za-z]:)?(?:[\\/][^\s"'`:,()<>[\]{}]+){2,}/g, (p) =>
    path.isAbsolute(p) ? displayFile(p, designRoot) : p
  );
}

interface BunPosition {
  file?: string;
  line?: number;
  column?: number;
  lineText?: string;
  offset?: number;
}

interface BunLog {
  name?: string;
  message?: string;
  level?: string;
  position?: BunPosition | null;
}

/** An error with no position, on the canvas itself. */
export function errorAt(
  ctx: Pick<ErrorContext, 'designRoot' | 'canvasAbs'>,
  message = 'Build failed',
  kind: CanvasErrorKind = 'build'
): CanvasError {
  return {
    kind,
    message: cap(scrubPaths(message, ctx.designRoot), MAX_MESSAGE),
    file: displayFile(ctx.canvasAbs, ctx.designRoot),
    line: 0,
    column: 0,
    lineText: '',
  };
}

const kindOfLog = (log: BunLog): CanvasErrorKind =>
  log.name === 'ResolveMessage' ? 'resolve' : 'build';

/**
 * One Bun log (`BuildMessage` / `ResolveMessage`) → a `CanvasError`. An error IN the canvas is
 * re-read against its original source (pass 1 injected attributes, so Bun's own `lineText` and
 * byte offset describe the transformed text); an error in another file keeps Bun's line.
 */
export function fromBunLog(log: BunLog, ctx: ErrorContext, kind = kindOfLog(log)): CanvasError {
  const pos = log.position ?? null;
  const message = cap(
    scrubPaths(String(log.message ?? 'Build failed'), ctx.designRoot),
    MAX_MESSAGE
  );
  if (!pos?.line) return { ...errorAt(ctx, '', kind), message };
  const isCanvas =
    !pos.file || pos.file === 'input.tsx' || path.resolve(pos.file) === path.resolve(ctx.canvasAbs);
  const file = displayFile(isCanvas ? ctx.canvasAbs : String(pos.file), ctx.designRoot);
  const line = pos.line;
  let column = Math.max(0, Number(pos.column ?? 0));
  let lineText = String(pos.lineText ?? '');
  if (isCanvas) {
    lineText = lineAt(ctx.source, line);
    // The Transpiler parses the original source, so its byte offset is exact there.
    if (kind === 'syntax' && typeof pos.offset === 'number') {
      const at = lineColumnOf(ctx.source, utf16IndexOf(ctx.source, pos.offset));
      if (at.line === line) column = at.column;
    }
  }
  return { kind, message, file, line, column, lineText: cap(lineText, MAX_LINE_TEXT) };
}

/** Bun.build's failed logs → the errors to show (errors first; warnings are not failures). */
export function fromBuildLogs(logs: readonly BunLog[], ctx: ErrorContext): CanvasError[] {
  const errs = logs.filter((l) => (l.level ?? 'error') === 'error');
  return (errs.length ? errs : logs).map((l) => fromBunLog(l, ctx));
}

// ---------------------------------------------------------------------------
// The syntax check (no build: a parse of the file as it is on disk).

let transpiler: import('bun').Transpiler | null = null;

/**
 * The first syntax error in a canvas's source, or null when it parses. `Bun.Transpiler` first
 * (its message is Bun.build's), then oxc — the live build's pass 1 — so a file the live build
 * refuses at either step is reported.
 */
export function checkCanvasSyntax(
  source: string,
  ctx: Omit<ErrorContext, 'source'>
): CanvasError | null {
  const full: ErrorContext = { ...ctx, source };
  // gate-b-c4n — `transformSync` RUNS a Bun macro import; the listing calls this for every canvas
  // on every change, so a synced canvas would run its macro without anyone opening it.
  if (hasMacroImport(source)) {
    return errorAt(ctx, macroImportRefusal(displayFile(ctx.canvasAbs, ctx.designRoot)));
  }
  transpiler ??= new Bun.Transpiler({ loader: 'tsx' });
  try {
    transpiler.transformSync(source);
  } catch (err) {
    const e = err as BunLog & { errors?: BunLog[] };
    const first = Array.isArray(e.errors) && e.errors.length ? (e.errors[0] as BunLog) : e;
    if (first && (first.position || first.message)) return fromBunLog(first, full, 'syntax');
    return errorAt(ctx, String((err as Error)?.message ?? err), 'syntax');
  }
  let parsed: ReturnType<typeof parseSync>;
  try {
    parsed = parseSync(ctx.canvasAbs, source, { sourceType: 'module' });
  } catch (err) {
    return errorAt(ctx, String((err as Error)?.message ?? err), 'syntax');
  }
  const first = parsed.errors?.[0];
  if (!first) return null;
  return fromOxcError(first, full);
}

interface OxcError {
  message?: string;
  labels?: Array<{ start?: number }>;
}

/** An oxc diagnostic (UTF-16 `labels[0].start`) → a `CanvasError`. */
export function fromOxcError(e: OxcError, ctx: ErrorContext): CanvasError {
  const start = e.labels?.[0]?.start;
  const file = displayFile(ctx.canvasAbs, ctx.designRoot);
  const message = cap(String(e.message ?? 'Syntax error'), MAX_MESSAGE);
  if (typeof start !== 'number')
    return { kind: 'syntax', message, file, line: 0, column: 0, lineText: '' };
  const { line, column } = lineColumnOf(ctx.source, start);
  return {
    kind: 'syntax',
    message,
    file,
    line,
    column,
    lineText: cap(lineAt(ctx.source, line), MAX_LINE_TEXT),
  };
}

/**
 * Any error a canvas build threw → its structured form, or null when it carries no canvas error
 * (an internal failure). `CanvasBuildError` → its first; pass 1's `TranspileError` (`byte` is
 * oxc's UTF-16 start) → re-read from the source.
 */
export function canvasErrorOf(err: unknown, ctx: ErrorContext): CanvasError | null {
  if (err instanceof CanvasBuildError) return err.errors[0] ?? null;
  const t = err as { name?: string; byte?: unknown } | null;
  if (t && t.name === 'TranspileError') return checkCanvasSyntax(ctx.source, ctx);
  return null;
}

/** `ui/pricing.tsx:212:19 SyntaxError: Expected "}" but found ")"` — the verb's line. */
export function formatCanvasError(e: CanvasError): string {
  const name =
    e.kind === 'syntax' ? 'SyntaxError' : e.kind === 'resolve' ? 'ResolveError' : 'BuildError';
  const where = e.line > 0 ? `${e.file}:${e.line}:${e.column}` : e.file;
  return `${where} ${name}: ${e.message}`;
}

// ---------------------------------------------------------------------------
// The last live build's error, per canvas (http.ts serveCanvasTsx records it).

const MAX_RECORDED = 256;
const recorded = new Map<string, { sig: string; error: CanvasError }>();

/**
 * Record the outcome of the live build of `absPath` whose source had signature `sig`
 * (`canvasSourceSig`): an error to remember, or null (it built — forget any).
 */
export function recordCanvasBuild(absPath: string, sig: string, error: CanvasError | null): void {
  recorded.delete(absPath);
  if (!error) return;
  recorded.set(absPath, { sig, error });
  if (recorded.size > MAX_RECORDED) {
    const oldest = recorded.keys().next().value;
    if (oldest !== undefined) recorded.delete(oldest);
  }
}

/** The recorded build error of `absPath`, only while its source is still the one that failed. */
export function recalledCanvasError(absPath: string, sig: string): CanvasError | null {
  const hit = recorded.get(absPath);
  return hit && hit.sig === sig ? hit.error : null;
}

export function forgetCanvasErrors(): void {
  recorded.clear();
}

/** The signature a recorded error is keyed on: the source's own bytes. */
export function canvasSourceSig(source: string): string {
  return `${source.length}:${Bun.hash(source).toString(36)}`;
}
