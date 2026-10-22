// gate-b-c4n — Bun runs a macro import (`import … from 'x' with { type: "macro" }`, or the
// `assert` spelling) AT BUILD TIME, inside the process that builds or transpiles: Bun.build,
// Bun.Transpiler `transform` / `transformSync` / `scan` all evaluate it (only `scanImports` does
// not). A canvas is tenant content — it syncs in from peers and the cloud — so a macro in one is a
// file read or a `node:child_process` call in the studio (desktop) or the build sandbox (cell),
// and the bytes it returns are inlined into the module. The import allowlist never sees a macro
// import (no onResolve), and what a macro reads is not a metafile input.
//
// Bun 1.4 has no API switch for this: `--no-macros` is honoured by the `bun build` CLI only, not
// by `Bun.build()` / `new Bun.Transpiler()` (probed, and neither `BuildConfig` nor
// `TranspilerOptions` has a field for it). So every place the studio hands project text to Bun
// first asks `hasMacroImport` — a RAW-TEXT check that fails closed: it matches inside comments and
// strings too, after undoing the escapes Bun would undo (`a`, `\x61`, `\u{61}`, line
// continuations, identity escapes) and across comments between the tokens. A false positive costs
// a refused build with a clear message; a false negative costs code execution.
//
// Leaf module: no imports, so the build sandbox and every caller can use it without a cycle.

/** What the person who wrote the canvas reads. Names no path outside the design. */
export function macroImportRefusal(file: string): string {
  return (
    `macro imports are not allowed in canvases (${file}): a Bun macro runs code on this computer ` +
    'while the canvas builds. Remove the "macro" import attribute.'
  );
}

// Whitespace and comments a parser would skip between two tokens.
const SEP = String.raw`(?:\s|\/\/[^\n\r\u2028\u2029]*|\/\*[\s\S]*?\*\/)*`;
// `type: 'macro'` — the key bare or quoted, any quote on the value, any case (fail closed: Bun
// itself compares case-sensitively). Not anchored to `with` / `assert`: a dynamic
// `import(…, { with: { type: 'macro' } })` and any future spelling carry the same pair.
const TYPE_MACRO = new RegExp(
  String.raw`(?<![\w$])['"\x60]?type['"\x60]?${SEP}:${SEP}['"\x60]macro['"\x60]`,
  'i'
);

/** Undo every escape JS would undo inside a string literal or an identifier, then drop `\`. */
function unescapeLoosely(text: string): string {
  return text
    .replace(/\\(?:\r\n|[\n\r\u2028\u2029])/g, '')
    .replace(
      /\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g,
      (_m, braced: string | undefined, u4: string | undefined, x2: string | undefined) => {
        const cp = Number.parseInt(braced ?? u4 ?? x2 ?? '', 16);
        return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
      }
    )
    .replace(/\\/g, '');
}

/** Does this text carry (or look like it carries) a Bun macro import attribute? */
export function hasMacroImport(text: string): boolean {
  if (TYPE_MACRO.test(text)) return true;
  return text.includes('\\') && TYPE_MACRO.test(unescapeLoosely(text));
}

export class MacroImportError extends Error {
  constructor(file: string) {
    super(macroImportRefusal(file));
    this.name = 'MacroImportError';
  }
}

/** Throws `MacroImportError` when `text` carries a macro import. `file` is a display name. */
export function assertNoMacroImports(text: string, file: string): void {
  if (hasMacroImport(text)) throw new MacroImportError(file);
}
