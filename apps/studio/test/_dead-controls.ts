// test/_dead-controls.ts — the static half of the V2-8 dead-control sweep (p8-sweep-static).
//
// Two scans, both pure (read files, return findings), used by dead-controls.test.ts and by
// scripts that write the evidence table:
//
//   · scanRegistry() — every action of the registry resolves to something that runs it: a shell
//     handler (the menu runner's map or the shell key handlers), the canvas lane (an id the canvas
//     bundle names), a native command / native-menu arm, or a surface of its own (a control that
//     names the id). The native menu (menu.actions.json → menu.rs) is walked too.
//   · scanClient()   — every clickable element in apps/studio/client JSX (<button>, <a>, an ARIA
//     widget role, or anything with onClick / onMouseDown / onPointerDown / onKeyDown) is wired to
//     a real handler, is not disabled for good, and says why when it is disabled.
//
// The TypeScript compiler API is the parser (a regex would misread nested JSX and arrow bodies).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export const STUDIO = join(import.meta.dir, '..');
export const REPO = join(STUDIO, '..', '..');

export interface Finding {
  file: string; // studio-relative
  line: number;
  control: string; // text / aria-label / testid
  finding: string; // rule id
  detail?: string;
}

// ── shared: the tracked files ──────────────────────────────────────────────────────────────────

function gitFiles(): string[] {
  const out = Bun.spawnSync(['git', 'ls-files'], { cwd: STUDIO }).stdout.toString();
  return out.split('\n').filter(Boolean);
}

const CODE_RE = /\.(js|jsx|ts|tsx|mjs)$/;
/** Not app code: tests, fixtures, generated / vendored output, design-root canvases (specs). */
const NOT_APP_RE =
  /(^|\/)(test|tests|__tests__|fixtures?|dist|node_modules|vendor|e2e|bin|scripts|examples|contracts)\/|\.test\.|\.spec\.|\.gen\.|(^|\/)\.design\//;

// ── (a) the registry ───────────────────────────────────────────────────────────────────────────

/** Every string literal and template-literal head in a source file (ids are named this way). */
function literalsOf(text: string, file: string): { lits: Set<string>; heads: Set<string> } {
  const lits = new Set<string>();
  const heads = new Set<string>();
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kindOf(file));
  const walk = (n: ts.Node): void => {
    if (ts.isStringLiteralLike(n)) lits.add(n.text);
    else if (ts.isTemplateExpression(n)) heads.add(n.head.text);
    else if (ts.isJsxText(n)) {
      /* not a name */
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return { lits, heads };
}

function kindOf(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JSX; // .js / .mjs may carry JSX in this tree
}

export interface RegistryReport {
  checked: number;
  byExec: Record<string, number>;
  /** How each action is run: 'shell' | 'key' | 'canvas' | 'native' | 'surface'. */
  how: Map<string, string>;
  findings: Finding[];
  nativeRows: number;
}

/**
 * @param handlers the shell's menu-runner map (createMenuHandlers with stub closures)
 * @param keyHandlers SHELL_KEY_HANDLERS
 * @param nativeCommands the menu runner's NATIVE_COMMANDS
 */
export function scanRegistry(opts: {
  actions: readonly {
    id: string;
    exec: string;
    label: string;
    keys?: unknown[];
    enabled?: unknown;
    aliases?: string[];
  }[];
  handlers: Record<string, unknown>;
  keyHandlers: Record<string, unknown>;
  nativeCommands: Record<string, string>;
}): RegistryReport {
  const files = gitFiles().filter((f) => CODE_RE.test(f) && !NOT_APP_RE.test(f));
  // The registry's own files name every id; they are not an implementation of any of them.
  const impl = files.filter((f) => !f.startsWith('actions/'));
  const shellSide = { lits: new Set<string>(), heads: new Set<string>() };
  const canvasSide = { lits: new Set<string>(), heads: new Set<string>() };
  for (const f of impl) {
    const text = readFileSync(join(STUDIO, f), 'utf8');
    const { lits, heads } = literalsOf(text, f);
    const side = f.startsWith('client/') ? shellSide : canvasSide;
    for (const l of lits) side.lits.add(l);
    for (const h of heads) side.heads.add(h);
  }
  // The shell posts `tool-set {tool}` for `tool.<x>` (V2-1.3 §5.6) and the canvas arms it.
  const named = (side: typeof shellSide, id: string): boolean =>
    side.lits.has(id) ||
    [...side.heads].some((h) => h.length > 3 && h.endsWith('.') && id.startsWith(h));

  const how = new Map<string, string>();
  const findings: Finding[] = [];
  const byExec: Record<string, number> = {};
  for (const a of opts.actions) {
    byExec[a.exec] = (byExec[a.exec] ?? 0) + 1;
    let ran: string | null = null;
    if (a.exec === 'shell') {
      if (typeof opts.handlers[a.id] === 'function') ran = 'shell';
      else if (typeof opts.keyHandlers[a.id] === 'function') ran = 'key';
      else if (named(shellSide, a.id) || named(canvasSide, a.id)) ran = 'surface';
    } else if (a.exec === 'canvas') {
      if (named(canvasSide, a.id)) ran = 'canvas';
      else if (a.id.startsWith('tool.')) ran = 'canvas';
      else if (named(shellSide, a.id) && typeof opts.handlers[a.id] === 'function') ran = 'shell';
    } else if (a.exec === 'native') {
      if (opts.nativeCommands[a.id]) ran = 'native';
      else if (NATIVE_MENU_ACTIONS().has(a.id)) ran = 'native-menu';
      else if (named(shellSide, a.id) || named(canvasSide, a.id)) ran = 'surface';
    } else if (a.exec === 'server') {
      ran = named(shellSide, a.id) ? 'surface' : null;
    }
    if (ran) how.set(a.id, ran);
    else
      findings.push({
        file: `actions/defs (${a.exec})`,
        line: 0,
        control: `${a.id} — “${a.label}”`,
        finding: 'no-handler',
        detail: `exec '${a.exec}': no shell handler, no canvas/native runner, no surface names it`,
      });
  }

  // Shell handlers whose body is a noop (a row that runs and does nothing).
  for (const [id, fn] of Object.entries(opts.handlers)) {
    if (typeof fn !== 'function') continue;
    const src = String(fn);
    if (isNoopSource(src))
      findings.push({
        file: 'client/v2/shell/menu-runner.js',
        line: 0,
        control: id,
        finding: 'noop-handler',
        detail: src.slice(0, 80),
      });
  }

  // The native menu: every row maps to a registry action that something runs.
  const native = nativeMenuRows();
  const handled = handledMenuIds();
  for (const row of native) {
    const def = opts.actions.find((a) => a.id === row.action);
    if (!def) {
      findings.push({
        file: 'apps/desktop/src-tauri/menu.actions.json',
        line: 0,
        control: `${row.id} → ${row.action}`,
        finding: 'native-row-unknown-action',
      });
      continue;
    }
    if (row.exec === 'native' && !handled.has(row.id))
      findings.push({
        file: 'apps/desktop/src-tauri/menu.actions.json',
        line: 0,
        control: `${row.id} → ${row.action}`,
        finding: 'native-row-no-arm',
        detail: 'not in menu.rs HANDLED_MENU_IDS',
      });
    if (row.exec === 'shell' && typeof opts.handlers[row.action] !== 'function')
      findings.push({
        file: 'apps/desktop/src-tauri/menu.actions.json',
        line: 0,
        control: `${row.id} → ${row.action}`,
        finding: 'native-row-no-shell-handler',
      });
  }
  return { checked: opts.actions.length, byExec, how, findings, nativeRows: native.length };
}

interface NativeRow {
  id: string;
  action: string;
  exec: string;
}
function nativeMenuRows(): NativeRow[] {
  const j = JSON.parse(
    readFileSync(join(REPO, 'apps/desktop/src-tauri/menu.actions.json'), 'utf8')
  ) as { menus: { items: (NativeRow & { kind: string })[] }[] };
  return j.menus.flatMap((m) => m.items.filter((i) => i.kind === 'item'));
}
let nativeActionsMemo: Set<string> | null = null;
function NATIVE_MENU_ACTIONS(): Set<string> {
  nativeActionsMemo ??= new Set(nativeMenuRows().map((r) => r.action));
  return nativeActionsMemo;
}
/** menu.rs `HANDLED_MENU_IDS`, with its `MENU_*` constants resolved. */
export function handledMenuIds(): Set<string> {
  const rs = readFileSync(join(REPO, 'apps/desktop/src-tauri/src/menu.rs'), 'utf8');
  const consts = new Map<string, string>();
  for (const m of rs.matchAll(/pub const (MENU_[A-Z0-9_]+): &str = "([^"]+)";/g))
    consts.set(m[1] as string, m[2] as string);
  const block = /pub const HANDLED_MENU_IDS: \[&str; \d+\] = \[([\s\S]*?)\];/.exec(rs)?.[1] ?? '';
  const out = new Set<string>();
  for (const raw of block.split(',')) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith('"')) out.add(t.slice(1, -1));
    else if (consts.has(t)) out.add(consts.get(t) as string);
  }
  return out;
}

/** A function's source that does nothing: `() => {}`, `function () {}`, only preventDefault/log. */
export function isNoopSource(src: string): boolean {
  const sf = ts.createSourceFile(
    'h.js',
    `(${src})`,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS
  );
  const stmt = sf.statements[0];
  if (!stmt || !ts.isExpressionStatement(stmt)) return false;
  let e: ts.Expression = stmt.expression;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return isNoopFn(e);
}

// ── (b) clickable elements in client JSX ───────────────────────────────────────────────────────

const WIDGET_ROLES = new Set([
  'button',
  'menuitem',
  'menuitemradio',
  'menuitemcheckbox',
  'tab',
  'option',
  'link',
]);
const HANDLER_PROPS = ['onClick', 'onMouseDown', 'onPointerDown', 'onKeyDown'];
/** Props that wire an element to an action at all (the four above plus their siblings). */
const WIRING_PROPS = new Set([
  ...HANDLER_PROPS,
  'onMouseUp',
  'onPointerUp',
  'onKeyUp',
  'onDoubleClick',
  'onContextMenu',
  'onChange',
  'onSelect',
  'onFocus',
  'onTouchStart',
  'onDragStart',
]);
/** Ancestors that take a descendant's click (event delegation / a form's submit / a label). A keydown alone
 *  on an ancestor is not one: the mouse click on the descendant would still do nothing. */
const DELEGATE_PROPS = new Set([
  'onClick',
  'onMouseDown',
  'onPointerDown',
  'onMouseUp',
  'onPointerUp',
  'onSubmit',
  'onClickCapture',
  'onPointerDownCapture',
  'onMouseDownCapture',
  'onPointerUpCapture',
]);
/** Ways a disabled control says why (the v2 pattern: a tooltip `title`, or an aria description). */
const REASON_PROPS = new Set([
  'title',
  'aria-description',
  'aria-describedby',
  'data-tooltip',
  'tooltip',
  'reason',
  'data-reason',
  'hint',
  'note',
  'why',
  'whyDisabled',
  'disabledReason',
]);

type Attrs = Map<string, ts.JsxAttribute>;

function attrsOf(open: ts.JsxOpeningLikeElement): { attrs: Attrs; spread: boolean } {
  const attrs: Attrs = new Map();
  let spread = false;
  for (const p of open.attributes.properties) {
    if (ts.isJsxSpreadAttribute(p)) spread = true;
    else attrs.set(p.name.getText(), p);
  }
  return { attrs, spread };
}

function strAttr(a: ts.JsxAttribute | undefined): string | null {
  if (!a?.initializer) return null;
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
  if (ts.isJsxExpression(a.initializer) && a.initializer.expression) {
    const e = a.initializer.expression;
    if (ts.isStringLiteralLike(e)) return e.text;
  }
  return null;
}

function exprAttr(a: ts.JsxAttribute | undefined): ts.Expression | null | 'bare' {
  if (!a) return null;
  if (!a.initializer) return 'bare';
  if (ts.isJsxExpression(a.initializer)) return a.initializer.expression ?? null;
  return null;
}

const isNoopCall = (s: ts.Statement): boolean => {
  if (!ts.isExpressionStatement(s)) return false;
  let e = s.expression;
  if (ts.isVoidExpression(e)) e = e.expression;
  if (!ts.isCallExpression(e)) return false;
  const callee = e.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const name = callee.name.text;
  if (
    name === 'preventDefault' ||
    name === 'stopPropagation' ||
    name === 'stopImmediatePropagation'
  )
    return true;
  return ts.isIdentifier(callee.expression) && callee.expression.text === 'console';
};

/** A handler expression that does nothing. */
function isNoopFn(e: ts.Expression): boolean {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isIdentifier(e)) return e.text === 'noop' || e.text === 'undefined';
  if (e.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isConditionalExpression(e)) return isNoopFn(e.whenTrue) && isNoopFn(e.whenFalse);
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
    const body = e.body;
    if (!ts.isBlock(body)) {
      // `() => undefined`, `(e) => e.preventDefault()`, `() => console.log(x)`
      let b: ts.Expression = body;
      while (ts.isParenthesizedExpression(b)) b = b.expression;
      if (ts.isIdentifier(b) && b.text === 'undefined') return true;
      if (b.kind === ts.SyntaxKind.NullKeyword) return true;
      if (ts.isVoidExpression(b) && ts.isNumericLiteral(b.expression)) return true;
      return isNoopCall(ts.factory.createExpressionStatement(b));
    }
    return body.statements.every(isNoopCall);
  }
  return false;
}

function textOf(el: ts.JsxElement | ts.JsxSelfClosingElement, attrs: Attrs): string {
  const tid = strAttr(attrs.get('data-testid'));
  const aria = strAttr(attrs.get('aria-label'));
  let text = '';
  if (ts.isJsxElement(el))
    text = el.children
      .filter(ts.isJsxText)
      .map((c) => c.text.trim())
      .filter(Boolean)
      .join(' ');
  const parts = [text && `“${text.slice(0, 40)}”`, aria && `aria “${aria}”`, tid && `#${tid}`];
  const s = parts.filter(Boolean).join(' ');
  if (s) return s;
  const tidExpr = attrs.get('data-testid');
  return tidExpr ? `#${tidExpr.initializer?.getText().slice(0, 50)}` : '(unnamed)';
}

/** Local `const x = () => {}` / `function x() {}` whose body is a noop. */
function noopLocals(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      isNoopFn(n.initializer)
    )
      out.add(n.name.text);
    else if (ts.isFunctionDeclaration(n) && n.name && n.body?.statements.every(isNoopCall))
      out.add(n.name.text);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

export interface ClientReport {
  files: number;
  checked: number;
  findings: Finding[];
}

export function scanClient(only?: string[]): ClientReport {
  const files = (only ?? gitFiles()).filter(
    (f) => f.startsWith('client/') && /\.(jsx|tsx|js)$/.test(f) && !NOT_APP_RE.test(f)
  );
  const out: ClientReport = { files: 0, checked: 0, findings: [] };
  for (const f of files) {
    const r = scanSource(f, readFileSync(join(STUDIO, f), 'utf8'));
    if (!r) continue;
    out.files++;
    out.checked += r.checked;
    out.findings.push(...r.findings);
  }
  return out;
}

/** One file's clickable elements (null when it has no JSX). Exported for the scanner's own fixtures. */
export function scanSource(
  f: string,
  text: string
): { checked: number; findings: Finding[] } | null {
  const findings: Finding[] = [];
  let checked = 0;
  {
    if (!/<[a-zA-Z]/.test(text)) return null;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, kindOf(f));
    const locals = noopLocals(sf);
    // An element wired imperatively (its `ref` + an addEventListener in the same file) is wired.
    const imperative =
      /addEventListener\(\s*['"](click|pointerdown|mousedown|keydown|pointerup)/.test(text);
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const noop = (e: ts.Expression) => isNoopFn(e) || (ts.isIdentifier(e) && locals.has(e.text));

    const visit = (n: ts.Node, delegated: boolean): void => {
      let nextDelegated = delegated;
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
        const open = ts.isJsxElement(n) ? n.openingElement : n;
        const tag = open.tagName.getText(sf);
        const { attrs, spread } = attrsOf(open);
        const role = strAttr(attrs.get('role'));
        const intrinsic = /^[a-z]/.test(tag);
        const isControl =
          (intrinsic && (tag === 'button' || tag === 'a')) ||
          (role !== null && WIDGET_ROLES.has(role));
        const hasHandlerProp = HANDLER_PROPS.some((p) => attrs.has(p));
        if (isControl || hasHandlerProp) {
          checked++;
          const control = textOf(n, attrs);
          const at = { file: f, line: lineOf(open), control };
          const wiring = [...attrs.keys()].filter((k) => WIRING_PROPS.has(k));
          const real = wiring.filter((k) => {
            const e = exprAttr(attrs.get(k));
            return !(e && e !== 'bare' && noop(e));
          });
          const href = strAttr(attrs.get('href'));
          const hasHref = attrs.has('href') && href !== '#' && href !== '';
          const disabled = exprAttr(attrs.get('disabled'));
          const ariaDisabled = exprAttr(attrs.get('aria-disabled'));
          const isSubmit = strAttr(attrs.get('type')) === 'submit' || attrs.has('form');
          const forGood = (x: ts.Expression | null | 'bare') =>
            x === 'bare' || (x !== null && x.kind === ts.SyntaxKind.TrueKeyword);
          // A component forwards wiring we cannot see (its own onClick, a render prop), so only an
          // intrinsic control can be "missing" one; a component's handler PROP is still checked.
          const elsewhere =
            spread ||
            delegated ||
            (attrs.has('ref') && imperative) ||
            isSubmit ||
            (tag === 'a' && (hasHref || attrs.has('download')));
          if (isControl && intrinsic && real.length === 0 && !elsewhere && !forGood(disabled))
            findings.push({
              ...at,
              finding: wiring.length
                ? 'noop-handler'
                : tag === 'a' && href === '#'
                  ? 'href-hash'
                  : 'missing-handler',
              detail: wiring
                .map(
                  (k) =>
                    `${k}={${(exprAttr(attrs.get(k)) as ts.Expression).getText(sf).slice(0, 50)}}`
                )
                .join(' '),
            });
          // A component control (<Btn onClick={() => {}}>) whose click is a noop.
          if (!intrinsic && real.length === 0 && !spread)
            for (const p of HANDLER_PROPS) {
              const e = exprAttr(attrs.get(p));
              if (e && e !== 'bare' && noop(e))
                findings.push({
                  ...at,
                  finding: 'noop-handler',
                  detail: `${p}={${e.getText(sf).slice(0, 60)}}`,
                });
            }
          if (isControl && (forGood(disabled) || forGood(ariaDisabled))) {
            findings.push({ ...at, finding: 'disabled-for-good' });
          } else if (
            isControl &&
            ((disabled !== null &&
              disabled !== 'bare' &&
              disabled.kind !== ts.SyntaxKind.FalseKeyword) ||
              (ariaDisabled !== null &&
                ariaDisabled !== 'bare' &&
                ariaDisabled.kind !== ts.SyntaxKind.FalseKeyword))
          ) {
            const why = [...attrs.keys()].some((k) => REASON_PROPS.has(k));
            const cond = (
              disabled && disabled !== 'bare' ? disabled : ariaDisabled
            ) as ts.Expression | null;
            if (!why && !spread && !(cond && selfEvidentDisable(cond)))
              findings.push({
                ...at,
                finding: 'disabled-no-reason',
                detail: cond?.getText(sf).slice(0, 60),
              });
          }
        }
        if ([...attrs.keys()].some((k) => DELEGATE_PROPS.has(k)) || (intrinsic && tag === 'label'))
          nextDelegated = true;
        if (spread && !intrinsic) nextDelegated = nextDelegated || false;
      }
      ts.forEachChild(n, (c) => visit(c, nextDelegated));
    };
    visit(sf, false);
  }
  return { checked, findings };
}

/**
 * A disable whose reason is on screen already, so a tooltip would only repeat it:
 *   · in flight — every name in the condition is a busy flag (`busy`, `saving`, `pending`…): the label
 *     says "Saving…" while it lasts;
 *   · an empty field — `!name.trim()`, `!draft`, `value.length === 0`: the empty field is beside it.
 * Anything else (a role, a missing account, a state elsewhere) must say why.
 */
const BUSY_RE =
  /^(busy|saving|pending|loading|working|sending|running|submitting|inFlight|isPending|isBusy|isSaving|isLoading|creating|deleting|removing|renaming|joining|leaving|connecting|installing|checking|copying|moving|restoring|uploading|signingIn|starting|stopping|opening|exporting|importing|generating|applying|fetching|publishing|merging|switching|undoing|making|quitting|restarting|signing|settingUp|pulling|converting|linking|unlinking)$/;
const isBusyName = (x: ts.Expression): boolean => {
  const n = ts.isIdentifier(x) ? x.text : ts.isPropertyAccessExpression(x) ? x.name.text : '';
  return (
    BUSY_RE.test(n) ||
    /^(busy|pending|saving|working|making)/i.test(n) ||
    /(Busy|Loading|Pending|Saving|loadingMore|refreshing|waiting|finding)$/.test(n)
  );
};
export function selfEvidentDisable(e: ts.Expression): boolean {
  // every disjunct must be self-evident
  const disj = (x: ts.Expression): boolean => {
    while (ts.isParenthesizedExpression(x)) x = x.expression;
    if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      return disj(x.left) && (disj(x.right) || x.right.getText() === 'undefined');
    // `busy && verb === 'Undo'` — only while busy
    if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
      return disj(x.left) || disj(x.right);
    // `!!busy`
    if (
      ts.isPrefixUnaryExpression(x) &&
      x.operator === ts.SyntaxKind.ExclamationToken &&
      ts.isPrefixUnaryExpression(x.operand) &&
      x.operand.operator === ts.SyntaxKind.ExclamationToken
    )
      return disj(x.operand.operand);
    // `making > 0` — something is being made
    if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.GreaterThanToken)
      return isBusyName(x.left) && ts.isNumericLiteral(x.right);
    // `x.disabled ? true : undefined` / `x.disabled || undefined` — the pass-through below, spelled longer
    if (ts.isConditionalExpression(x) && x.whenFalse.getText() === 'undefined')
      return disj(x.condition);
    // a pass-through `disabled` prop / `item.disabled`: the wrapper's caller (or the item) owns the reason
    if (
      (ts.isIdentifier(x) && x.text === 'disabled') ||
      (ts.isPropertyAccessExpression(x) && x.name.text === 'disabled')
    )
      return true;
    // busy flag
    if (ts.isIdentifier(x) || ts.isPropertyAccessExpression(x)) return isBusyName(x);
    if (
      ts.isBinaryExpression(x) &&
      x.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    ) {
      // `state === 'saving'` / `busy === 'disconnect'` / `x.length === 0` / a pager at its first or last page
      const r = x.right;
      if (ts.isStringLiteral(r) && (BUSY_RE.test(r.text) || isBusyName(x.left))) return true;
      if (
        /^(at|page|index|i|idx|step|current)$/.test(x.left.getText()) &&
        (r.getText() === '0' || /- 1$/.test(r.getText()))
      )
        return true;
      // nothing picked yet: `x.length === 0`, `n === 0`, `pickedCount === 0`
      if (ts.isNumericLiteral(r) && r.text === '0') return true;
      return false;
    }
    // `!draft`, `!name.trim()`, `!value?.trim?.()`
    if (ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.ExclamationToken) {
      let o: ts.Expression = x.operand;
      while (ts.isParenthesizedExpression(o)) o = o.expression;
      if (
        ts.isCallExpression(o) &&
        ts.isPropertyAccessExpression(o.expression) &&
        o.expression.name.text === 'trim'
      )
        return true;
      if (ts.isIdentifier(o))
        return /^(draft|text|value|name|query|title|note|input|prompt|label|message|url|link|email|code|word|words|answer|reason|comment|body|q|val|newName|branchName|branch|slug|file|picked|selection)$/i.test(
          o.text
        );
    }
    return false;
  };
  return disj(e);
}

/** A stable key for an allowlist entry: file + rule + control (line numbers drift). */
export const findingKey = (f: Finding): string => `${f.file} · ${f.finding} · ${f.control}`;
