// S11.18 — the scanner behind test/v2-words-lint.test.ts (Q15). It reads a source file with the TypeScript parser and
// looks only at what a person can read: string literals, template text and JSX text. Comments, identifiers and
// attribute NAMES are never looked at.
//
// Rules (CONTRACT §3 "Not" column + §4 voice rules, words the shell can still say by accident):
//   we · I (as a pronoun) · Oops · "!" at the end of a sentence · board · screen · sidebar · Pro · Debug ·
//   Delete (for a thing that goes to the trash — the trash verb is "Move to the trash")
// And one structural rule: a dialog's title verb is the primary button's verb (§4).

import ts from 'typescript';

export interface Hit {
  rule: string;
  line: number;
  text: string;
}

export const RULES: readonly { id: string; re: RegExp }[] = [
  { id: 'we', re: /\bwe\b/i },
  // "I am", "I'll ..." — not the I key ("Image I", "⇧I") and not "I/O"
  { id: 'i', re: /\bI(?:['’](?:m|ll|ve|d))?\s+[a-z]/ },
  { id: 'oops', re: /\boops\b/i },
  { id: 'bang', re: /[A-Za-z0-9)"”’'.…]!(?=\s|$|["”’'`])/ },
  { id: 'board', re: /\bboards?\b/i },
  { id: 'screen', re: /\bscreens?\b(?!\s*readers?)/i },
  { id: 'sidebar', re: /\bsidebars?\b/i },
  { id: 'pro', re: /\bPro\b/ },
  { id: 'debug', re: /\bDebug\b/ },
  { id: 'delete', re: /\bDelete\b/ },
];

/** Text that is a path, a selector, a CSS value or code — not copy. Cheap to recognise, costly to leave in. */
function isCopy(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  // one token with a code separator in it — a path, a selector, a CSS custom property, `key:` or `data-x` — is not copy
  if (!/\s/.test(t) && /[/._:=[\]?#@-]/.test(t)) return false;
  if (/^[[./#@]/.test(t) || /^[\w-]+:$/.test(t)) return false;
  return /[A-Za-z]/.test(t);
}

/** Every string a person can read in the source, with its 1-based line. */
export function readableStrings(text: string, file = 'x.jsx'): { line: number; text: string }[] {
  const kind = /\.tsx$/.test(file)
    ? ts.ScriptKind.TSX
    : /\.ts$/.test(file)
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JSX;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out: { line: number; text: string }[] = [];
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const push = (n: ts.Node, s: string) => {
    if (isCopy(s)) out.push({ line: at(n), text: s.replace(/\s+/g, ' ').trim() });
  };
  const visit = (n: ts.Node) => {
    // an import/export specifier or a JSX attribute that names a hook (className, data-testid, key, id…) is not copy
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isJsxAttribute(n)) {
      const name = n.name.getText(sf);
      if (
        !/^(?:aria-label|aria-description|title|placeholder|alt|label|hint|aria-roledescription)$/.test(
          name
        )
      )
        return;
    }
    // `x === 'board'`, `case 'board':` — a comparison against an internal tag, never shown
    if (ts.isCaseClause(n)) {
      ts.forEachChild(n.expression, () => {});
      n.statements.forEach(visit);
      return;
    }
    if (
      ts.isBinaryExpression(n) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(n.operatorToken.kind)
    ) {
      for (const side of [n.left, n.right]) if (!ts.isStringLiteralLike(side)) visit(side);
      return;
    }
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) {
      // an object key that is a hook, a selector, a role or a pure internal tag
      if (
        /^(?:id|key|kind|type|testid|testId|className|role|icon|group|section|actionId|selector|name|ids|when|href|src|query|scope|feature|row|file|home|was)$/.test(
          n.name.text
        )
      )
        return;
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) push(n, n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
      push(n, n.text);
    else if (ts.isJsxText(n)) push(n, n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export function scanWords(text: string, file = 'x.jsx'): Hit[] {
  const hits: Hit[] = [];
  for (const s of readableStrings(text, file)) {
    for (const r of RULES)
      if (r.re.test(s.text)) hits.push({ rule: r.id, line: s.line, text: s.text });
  }
  return hits;
}

/**
 * A dialog's title asks with the same verb as its primary button (CONTRACT §4): `{ title: 'Move "X" to the trash?',
 * confirm: 'Move to trash' }`. Read from object literals that carry a `title` and a `primary` / `confirm` string.
 */
export function dialogVerbMismatches(text: string, file = 'x.jsx'): Hit[] {
  const out: Hit[] = [];
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX
  );
  const textOf = (e: ts.Expression): string | null => {
    if (ts.isStringLiteralLike(e)) return e.text;
    if (ts.isTemplateExpression(e)) return e.head.text;
    return null;
  };
  const verb = (s: string) =>
    s
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, '') ?? '';
  const visit = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      const prop = (name: string) => {
        for (const p of n.properties) {
          if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name)
            return textOf(p.initializer);
        }
        return null;
      };
      const title = prop('title');
      const primary = prop('primary') ?? prop('confirm');
      if (title && primary) {
        if (verb(title) && verb(primary) && verb(title) !== verb(primary)) {
          out.push({
            rule: 'dialog-verb',
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            text: `${title} / ${primary}`,
          });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** A toast or callout carries one action at most (CONTRACT §4): an object with `action` and a second one beside it. */
export function secondActions(text: string, file = 'x.jsx'): Hit[] {
  const out: Hit[] = [];
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX
  );
  const visit = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      const names = new Set(
        n.properties.flatMap((p) => (p.name && ts.isIdentifier(p.name) ? [p.name.text] : []))
      );
      if (
        names.has('action') &&
        ['actions', 'secondary', 'action2', 'secondaryAction'].some((k) => names.has(k))
      )
        out.push({
          rule: 'one-action',
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          text: [...names].join(','),
        });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
