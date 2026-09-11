// #121: parser success alone does not rule out duplicate source declarations.
import { parseSync } from 'oxc-parser';
import { MAX_HTML_BYTES } from './limits.ts';

/** Null means safe source syntax; never resolves imports or executes code. */
export function sourceError(file: string, body: string): string | null {
  if (!/\.[jt]sx?$/i.test(file)) return null;
  if (Buffer.byteLength(body, 'utf8') > MAX_HTML_BYTES) return 'Source exceeds the size limit';
  try {
    const parsed = parseSync(file, body, { sourceType: 'module', showSemanticErrors: true });
    if (parsed.errors.length) return 'Source has syntax errors or duplicate bindings';
    const functions = new Set<string>();
    for (const statement of parsed.program.body) {
      const node =
        statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
          ? statement.declaration
          : statement;
      // TS overload signatures and interface merging are valid. Only multiple
      // implementations collide; OXC currently accepts those even in modules.
      if (node?.type === 'FunctionDeclaration' && node.body && node.id) {
        if (functions.has(node.id.name)) return 'Source has duplicate function implementations';
        functions.add(node.id.name);
      }
    }
    // Overload/type-only declarations may share an exported name. Exclude
    // their own entries, not every later export with that name (#121).
    const typeOnlyExports = new Set(
      parsed.program.body
        .filter(
          (statement) =>
            statement.type === 'ExportNamedDeclaration' &&
            statement.declaration &&
            ['TSDeclareFunction', 'TSInterfaceDeclaration', 'TSTypeAliasDeclaration'].includes(
              statement.declaration.type
            )
        )
        .map((statement) => statement.start)
    );
    const exports = new Set<string>();
    for (const statement of parsed.module.staticExports) {
      if (typeOnlyExports.has(statement.start)) continue;
      for (const entry of statement.entries) {
        if (entry.isType) continue;
        const name = entry.exportName.kind === 'Default' ? 'default' : entry.exportName.name;
        if (name === null) continue;
        if (exports.has(name)) {
          return 'Source has duplicate exports';
        }
        exports.add(name);
      }
    }
    return null;
  } catch {
    return 'Source could not be validated';
  }
}
