// edit-ops/clip-carry.ts — #122 (122-A): the object clipboard carries what the copy reads.
// Contract: client/v2/contracts/122-cross-canvas-clipboard.md §5.1 (the clip) + §5.2 (paste rules).
//
// A copied object or artboard reads names from around it: a module-level `const W = 1440`, a same-file
// `function Pill`, an imported `<Card>`. Pasted on another canvas without them it renders an error card. So:
//
//   carryOf(source, ranges, from)   at COPY time: every import and module-level declaration the ranges read
//                                   (identifiers, JSX tag roots, type references — `freeRefsOf`), transitively,
//                                   declarations in dependency order. Function-scope names (props, hook state)
//                                   and what can not travel (`let` / `var`, an enum, a destructured const, the
//                                   default export, anything naming DesignCanvas) stay `needs` (refused elsewhere).
//   planCarry(target, at, …)        at PASTE time on another canvas: add what the target lacks, reuse what is
//                                   identical, rename what clashes (`W` → `W2`, `Card as Card2`), re-point
//                                   relative imports from the target's folder. Every import it ADDS passes the
//                                   C4 import rule (`importAllowed`, access/closure.ts) — never a canvas, never a
//                                   `_` runtime file, only importable extensions, resolving — or nothing is written.
//   renameRefs(text, renames)       the copied text's own references to a renamed name, and nothing else.
//
// The module behind a carried import is never copied (contract §4.2). Pure: text in, text out; files are read
// only through the reader the dispatcher hands the op (`req.readFile`), at clamped designRoot-relative paths.

import path from 'node:path';

import MagicString from 'magic-string';

import {
  importAllowed,
  perUsePhotoRefs,
  specCandidates,
  staticAssetRefs,
} from '../access/closure.ts';
import {
  type FreeRef,
  freeRefsIn,
  functionScopeAt,
  type ScopeModule,
  scopeModule,
} from './scope-names.ts';

export interface Carry {
  /** source order */
  imports: CarriedImport[];
  /** module-level, dependency order (a declaration after what it reads) */
  decls: CarriedDecl[];
  /** `assets/<sha8>.<ext>` (+ `.photo.json` sidecars) the items name */
  assets: string[];
}

export interface CarriedImport {
  /** the name the items use */
  local: string;
  /** what the module exports under it */
  imported: string;
  /** as written in the source */
  spec: string;
  /** designRoot-relative resolved file; null = bare / virtual (`react`, `@maude/canvas-lib`) */
  module: string | null;
  typeOnly?: boolean;
}

export interface CarriedDecl {
  name: string;
  /** the whole top-level statement, `export` dropped (one declarator of a `const a = 1, b = 2`) */
  text: string;
  kind: 'const' | 'function' | 'class' | 'type';
}

/** Imports + declarations one clip may carry (contract §5.1). */
export const MAX_CARRIED = 32;
export const NO_CARRY: Carry = Object.freeze({ imports: [], decls: [], assets: [] }) as Carry;
export const TOO_MUCH_TO_CARRY =
  'That copy reads too much from its canvas to paste on another one; copy the whole component instead.';

/** designRoot-relative text of a project file; null = no such file. */
export interface ModuleReader {
  text(rel: string): string | null;
}

type Node = { type: string; start: number; end: number; [k: string]: unknown };
const isNode = (v: unknown): v is Node =>
  v !== null && typeof v === 'object' && typeof (v as Node).type === 'string';

// ── the module's own bindings ───────────────────────────────────────────────────────────────────

interface ImportBinding {
  kind: 'import';
  local: string;
  imported: string;
  spec: string;
  typeOnly: boolean;
  decl: Node;
}
interface DeclBinding {
  kind: 'decl';
  name: string;
  /** null = can not travel (a `let`, the default export, …) */
  text: string | null;
  declKind: CarriedDecl['kind'];
  /** the range its own reads are asked over */
  start: number;
  end: number;
  /** the end of its whole top-level statement */
  stmtEnd: number;
}
interface Table {
  bindings: Map<string, ImportBinding | DeclBinding>;
  imports: ImportBinding[];
  lastImportEnd: number;
}

const nameOf = (n: unknown): string =>
  isNode(n) ? String(n.type === 'Literal' ? n.value : n.name) : '';

/** The names a binding pattern declares (`const { a, b: [c] } = …`). */
function bindingNames(p: unknown, out: string[]): void {
  if (!isNode(p)) return;
  if (p.type === 'Identifier') out.push(String(p.name));
  else if (p.type === 'ObjectPattern')
    for (const prop of (p.properties as unknown[]) ?? [])
      bindingNames(
        isNode(prop) && prop.type === 'RestElement' ? prop.argument : (prop as Node)?.value,
        out
      );
  else if (p.type === 'ArrayPattern')
    for (const e of (p.elements as unknown[]) ?? []) bindingNames(e, out);
  else if (p.type === 'RestElement') bindingNames(p.argument, out);
  else if (p.type === 'AssignmentPattern') bindingNames(p.left, out);
}

const NAMES_CANVAS = /\bDesignCanvas\b/;

function tableOf(mod: ScopeModule): Table {
  const program = mod.program as Node;
  const source = mod.source;
  const bindings = new Map<string, ImportBinding | DeclBinding>();
  const imports: ImportBinding[] = [];
  let lastImportEnd = 0;
  for (const st of (program.body as Node[]) ?? []) {
    if (st.type === 'ImportDeclaration') {
      lastImportEnd = st.end;
      const spec = String((st.source as Node).value);
      for (const s of (st.specifiers as Node[]) ?? []) {
        const b: ImportBinding = {
          kind: 'import',
          local: nameOf(s.local),
          imported:
            s.type === 'ImportDefaultSpecifier'
              ? 'default'
              : s.type === 'ImportNamespaceSpecifier'
                ? '*'
                : nameOf(s.imported),
          spec,
          typeOnly: st.importKind === 'type' || s.importKind === 'type',
          decl: st,
        };
        imports.push(b);
        bindings.set(b.local, b);
      }
      continue;
    }
    const isDefault = st.type === 'ExportDefaultDeclaration';
    const inner = st.type === 'ExportNamedDeclaration' || isDefault ? st.declaration : st;
    if (!isNode(inner)) continue;
    const add = (
      name: string,
      text: string | null,
      declKind: CarriedDecl['kind'],
      start: number,
      end: number
    ) => {
      if (!name || bindings.has(name)) return;
      const travels = text !== null && !isDefault && !NAMES_CANVAS.test(text);
      bindings.set(name, {
        kind: 'decl',
        name,
        text: travels ? text : null,
        declKind,
        start,
        end,
        stmtEnd: st.end,
      });
    };
    const whole = () => (inner.declare ? null : source.slice(inner.start, inner.end));
    switch (inner.type) {
      case 'VariableDeclaration': {
        const travels = inner.kind === 'const' && !inner.declare;
        for (const d of (inner.declarations as Node[]) ?? []) {
          const id = d.id as Node;
          if (travels && id.type === 'Identifier' && isNode(d.init))
            add(String(id.name), `const ${source.slice(d.start, d.end)};`, 'const', d.start, d.end);
          else {
            const names: string[] = [];
            bindingNames(id, names);
            for (const n of names) add(n, null, 'const', d.start, d.end);
          }
        }
        break;
      }
      case 'FunctionDeclaration':
        add(
          nameOf(inner.id),
          isNode(inner.body) ? whole() : null,
          'function',
          inner.start,
          inner.end
        );
        break;
      case 'ClassDeclaration':
        add(nameOf(inner.id), whole(), 'class', inner.start, inner.end);
        break;
      case 'TSTypeAliasDeclaration':
      case 'TSInterfaceDeclaration':
        add(nameOf(inner.id), source.slice(inner.start, inner.end), 'type', inner.start, inner.end);
        break;
      case 'TSEnumDeclaration':
        add(nameOf(inner.id), null, 'const', inner.start, inner.end);
        break;
      default:
    }
  }
  return { bindings, imports, lastImportEnd };
}

// ── specifiers ──────────────────────────────────────────────────────────────────────────────────

const VROOT = '/__maude_carry__';

/** A relative specifier written in `fromRel`, as a designRoot-relative path (unresolved: no extension probing). */
const baseOf = (spec: string, fromRel: string): string =>
  path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));

/** The file a relative specifier resolves to (the first candidate the reader has), else its base path. */
function moduleOf(spec: string, fromRel: string, reader?: ModuleReader): string | null {
  if (!spec.startsWith('.')) return null;
  if (reader)
    for (const abs of specCandidates(spec, `${VROOT}/${fromRel}`, VROOT)) {
      const rel = abs
        .slice(VROOT.length + 1)
        .split(path.sep)
        .join('/');
      if (reader.text(rel) !== null) return rel;
    }
  return baseOf(spec, fromRel);
}

/** `spec` (written in `fromRel`) as written from `toRel`'s folder: `./`-prefixed, the extension kept. */
export function respec(spec: string, fromRel: string, toRel: string): string {
  if (!spec.startsWith('.')) return spec;
  const target = path.posix.join(path.posix.dirname(fromRel), spec);
  let rel = path.posix.relative(path.posix.dirname(toRel), target);
  if (spec.endsWith('/') && !rel.endsWith('/')) rel += '/';
  return rel.startsWith('.') ? rel : `./${rel || '.'}`;
}

const importKey = (spec: string, module: string | null): string =>
  spec.startsWith('.') ? `file:${module ?? ''}` : `bare:${spec}`;

// ── the copy ────────────────────────────────────────────────────────────────────────────────────

export interface CarryRead {
  carry: Carry;
  /** names the copy reads that can not travel: a function's (props, state), a `let`, the default export */
  needs: string[];
  /** set when the carry is too big to keep: a paste on another canvas is refused with these words */
  refused: string | null;
}

/**
 * What the ranges `[from, to)` of `source` (a canvas at `fromRel`) read from around them. `texts` are the clip
 * items as kept (their asset references ride too). Null when the source does not parse.
 */
export function carryOf(
  source: string,
  ranges: ReadonlyArray<readonly [number, number]>,
  fromRel: string,
  texts: readonly string[],
  reader?: ModuleReader
): CarryRead | null {
  const mod = scopeModule(source);
  if (!mod) return null;
  const table = tableOf(mod);
  const needs = new Set<string>();
  const imports = new Map<string, CarriedImport>();
  const decls: CarriedDecl[] = [];
  const visited = new Set<string>();
  const want = (r: FreeRef): void => {
    if (r.scope === 'function') {
      needs.add(r.name);
      return;
    }
    if (r.scope === 'global') return;
    const b = table.bindings.get(r.name);
    if (!b) {
      needs.add(r.name);
      return;
    }
    if (b.kind === 'import') {
      if (!imports.has(b.local))
        imports.set(b.local, {
          local: b.local,
          imported: b.imported,
          spec: b.spec,
          module: moduleOf(b.spec, fromRel, reader),
          ...(b.typeOnly ? { typeOnly: true } : {}),
        });
      return;
    }
    if (b.text === null) {
      needs.add(b.name);
      return;
    }
    if (visited.has(b.name)) return;
    visited.add(b.name);
    for (const d of freeRefsIn(mod, b.start, b.end)) if (d.name !== b.name) want(d);
    decls.push({ name: b.name, text: b.text, kind: b.declKind });
  };
  for (const [from, to] of ranges) for (const r of freeRefsIn(mod, from, to)) want(r);
  const order = [...imports.values()].sort(
    (a, b) =>
      (table.bindings.get(a.local) as ImportBinding).decl.start -
      (table.bindings.get(b.local) as ImportBinding).decl.start
  );
  if (order.length + decls.length > MAX_CARRIED)
    return { carry: NO_CARRY, needs: [...needs].sort(), refused: TOO_MUCH_TO_CARRY };
  return {
    carry: {
      imports: order,
      decls,
      assets: assetsOf([...texts, ...decls.map((d) => d.text)], reader),
    },
    needs: [...needs].sort(),
    refused: null,
  };
}

/**
 * The `assets/…` files the texts name, and the `.photo.json` sidecars the reader has (small JSON). The pictures
 * themselves are named, not read here (a cross-project import verifies their bytes, contract §5.6).
 */
function assetsOf(texts: readonly string[], reader?: ModuleReader): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const ref of staticAssetRefs(t)) {
      const rel = ref.replace(/^(?:\.\.?\/|\.design\/|\/)+/, '');
      if (!rel.startsWith('assets/') || rel.split('/').includes('..')) continue;
      out.add(rel);
      const photo = rel.replace(/\.[^./]+$/, '.photo.json');
      if (reader && photo !== rel && reader.text(photo) !== null) out.add(photo);
    }
    for (const rel of perUsePhotoRefs(t)) if (!reader || reader.text(rel) !== null) out.add(rel);
  }
  return [...out].sort();
}

// ── the paste ───────────────────────────────────────────────────────────────────────────────────

/** `detail.carried` (contract §5.2). */
export interface CarriedSummary {
  imports: number;
  decls: number;
  renamed: Array<{ from: string; to: string }>;
}

export interface CarryPlan {
  /** the copied text's names → the names they have here */
  renames: ReadonlyMap<string, string>;
  /** writes the added imports and declarations into the target's MagicString */
  apply(s: MagicString): void;
  carried: CarriedSummary;
}

const normal = (t: string) => t.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/**
 * The plan for pasting a clip read from `fromRel` at `at` in `target` (another canvas, `targetRel`). `what`
 * names the copy in a refusal ("object" / "artboard"); `fail` throws it (nothing is written).
 */
export function planCarry(
  target: string,
  at: number,
  carry: Carry,
  fromRel: string,
  targetRel: string,
  what: string,
  reader: ModuleReader | undefined,
  fail: (message: string) => never
): CarryPlan {
  const mod = scopeModule(target);
  if (!mod) return fail('This canvas does not parse; fix it before editing.');
  const table = tableOf(mod);
  const shadow = functionScopeAt(target, at) ?? new Set<string>();
  const taken = new Set<string>([...table.bindings.keys(), ...shadow]);
  const reserved = new Set<string>([
    ...carry.imports.map((i) => i.local),
    ...carry.decls.map((d) => d.name),
  ]);
  const fresh = (base: string): string => {
    let n = 2;
    while (taken.has(`${base}${n}`) || reserved.has(`${base}${n}`)) n++;
    return `${base}${n}`;
  };
  const renames = new Map<string, string>();
  const renamed: Array<{ from: string; to: string }> = [];
  const read: ModuleReader = reader ?? { text: () => null };

  // imports: reuse, alias, join an import of the same module, or a new line
  const targetImports = table.imports.map((b) => ({
    b,
    key: importKey(b.spec, moduleOf(b.spec, targetRel, reader)),
  }));
  const joins: Array<{ at: number; text: string }> = [];
  const lines = new Map<
    string,
    { spec: string; def?: string; ns?: string; named: string[]; type: boolean }
  >();
  let added = 0;
  for (const ci of carry.imports) {
    const key = importKey(
      ci.spec,
      ci.module ?? (ci.spec.startsWith('.') ? baseOf(ci.spec, fromRel) : null)
    );
    const same = targetImports.find(
      (t) => t.key === key && t.b.imported === ci.imported && (!t.b.typeOnly || ci.typeOnly)
    );
    if (same && !shadow.has(same.b.local)) {
      if (same.b.local !== ci.local) renames.set(ci.local, same.b.local);
      continue;
    }
    let local = ci.local;
    if (taken.has(local)) {
      local = fresh(local);
      renames.set(ci.local, local);
      renamed.push({ from: ci.local, to: local });
    }
    taken.add(local);
    const spec = respec(ci.spec, fromRel, targetRel);
    // ONE refusal for a canvas, a runtime file and a missing one (as the C4 walk's own: a planted import is
    // no probe of what exists), naming the import as written, never what it resolved to
    if (spec.startsWith('.') && !importAllowed(spec, targetRel, read).ok)
      return fail(
        `That ${what} uses ${ci.local} from ${baseOf(ci.spec, fromRel)}, which a canvas can’t import (another canvas, a runtime file, or one that isn’t there); it can’t be pasted here. Move the shared part into a component.`
      );
    added++;
    const named =
      ci.imported === local
        ? local
        : `${IDENT_RE.test(ci.imported) ? ci.imported : JSON.stringify(ci.imported)} as ${local}`;
    // another name from a module the target already imports joins that import
    const host =
      ci.imported !== 'default' && ci.imported !== '*' && !ci.typeOnly
        ? targetImports.find(
            (t) =>
              t.key === key &&
              !t.b.typeOnly &&
              t.b.decl.importKind !== 'type' &&
              !(t.b.decl.specifiers as Node[]).some((s) => s.type === 'ImportNamespaceSpecifier')
          )
        : undefined;
    if (host) {
      const specs = host.b.decl.specifiers as Node[];
      const last = [...specs].reverse().find((s) => s.type === 'ImportSpecifier');
      joins.push(
        last
          ? { at: last.end, text: `, ${named}` }
          : { at: (specs[0] as Node).end, text: `, { ${named} }` }
      );
      continue;
    }
    const lineKey = `${ci.typeOnly ? 'type:' : ''}${spec}`;
    const line = lines.get(lineKey) ?? { spec, named: [], type: !!ci.typeOnly };
    if (ci.imported === 'default' && !line.def && !line.ns) line.def = local;
    else if (ci.imported === '*' && !line.def && !line.ns && line.named.length === 0)
      line.ns = local;
    else if (ci.imported !== 'default' && ci.imported !== '*' && !line.ns) line.named.push(named);
    else {
      // a second default / namespace from one module: its own line
      lines.set(`${lineKey}#${local}`, {
        spec,
        named: [],
        type: !!ci.typeOnly,
        ...(ci.imported === '*' ? { ns: local } : { def: local }),
      });
      continue;
    }
    lines.set(lineKey, line);
  }

  // declarations, in dependency order: reuse an identical one, rename on a clash, else insert
  const decls: string[] = [];
  let declAt = table.lastImportEnd;
  for (const d of carry.decls) {
    let text = renameRefs(d.text, renames, false);
    const tb = table.bindings.get(d.name);
    if (
      tb?.kind === 'decl' &&
      tb.text !== null &&
      normal(tb.text) === normal(text) &&
      !shadow.has(d.name)
    ) {
      declAt = Math.max(declAt, tb.stmtEnd); // after what it reuses: a const read before it is declared throws
      continue;
    }
    if (taken.has(d.name)) {
      const to = fresh(d.name);
      renames.set(d.name, to);
      renamed.push({ from: d.name, to });
      text = renameRefs(text, new Map([[d.name, to]]), false);
      taken.add(to);
    } else taken.add(d.name);
    decls.push(text);
  }

  const importAt = table.lastImportEnd;
  const importLines = [...lines.values()].map((l) => {
    const parts = [
      ...(l.def ? [l.def] : []),
      ...(l.ns ? [`* as ${l.ns}`] : []),
      ...(l.named.length ? [`{ ${l.named.join(', ')} }`] : []),
    ];
    return `import ${l.type ? 'type ' : ''}${parts.join(', ')} from '${l.spec}';`;
  });
  return {
    renames,
    carried: { imports: added, decls: decls.length, renamed },
    apply(s) {
      for (const j of joins) s.appendLeft(j.at, j.text);
      if (importLines.length)
        s.appendLeft(
          importAt,
          importAt === 0 ? `${importLines.join('\n')}\n` : `\n${importLines.join('\n')}`
        );
      if (decls.length)
        s.appendLeft(
          declAt,
          declAt === 0 ? `${decls.join('\n\n')}\n\n` : `\n\n${decls.join('\n\n')}`
        );
    },
  };
}

const ITEM_HEAD = 'const __maudeClip = (\n';
const ITEM_TAIL = '\n);\n';

/**
 * `text` with its references to the names in `renames` rewritten — a reference that something inside the text
 * declares (a callback's parameter) is left alone, a shorthand `{ W }` becomes `{ W: W2 }`. `asItem`: the text is
 * one clip item (a JSX element), else a top-level statement (its own declared name is renamed too).
 */
export function renameRefs(
  text: string,
  renames: ReadonlyMap<string, string>,
  asItem: boolean
): string {
  if (renames.size === 0) return text;
  const head = asItem ? ITEM_HEAD : '';
  const tail = asItem ? ITEM_TAIL : '';
  const synth = `${head}${text}${tail}`;
  const mod = scopeModule(synth);
  if (!mod) return text;
  const ms = new MagicString(synth);
  for (const r of freeRefsIn(mod, head.length, head.length + text.length)) {
    if (r.scope === 'function') continue;
    const to = renames.get(r.name);
    if (to) ms.overwrite(r.start, r.end, r.shorthand ? `${r.name}: ${to}` : to);
  }
  const out = ms.toString();
  return out.slice(head.length, out.length - tail.length);
}
