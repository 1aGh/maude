/**
 * @file       annotations/validate-board.ts — `validateBoard(text, { strict })`
 * @scope      apps/studio/annotations/validate-board.ts
 * @purpose    Contract V2-1.11 §5.2 / V2-1.18 §5.3: the AiBatch rule applied to a
 *             FILE. `maude design annotate` goes through AiBatch (ai-write.ts),
 *             which refuses loudly; an AI that edits the `.annotations.json` file
 *             itself gets the same rules here, checked after the write:
 *
 *               - a lenient-loader drop is an error (parseBoard's report);
 *               - an unknown field, or a value the field can't hold without repair,
 *                 is an error (the generated schema, board-schema.ts);
 *               - creating or changing an element of an unknown type is an error;
 *               - `author` is immutable; a new element is `author.kind: "ai"`;
 *               - a locked element keeps every field but index/groups/locked, and
 *                 is not deleted (lock.ts — the #137 guard).
 *
 *             Diff rules compare against `against` (the bytes before the write);
 *             null / absent means a new file, so every element is new. An element
 *             the write left byte-for-byte unchanged is never re-judged, so a newer
 *             peer's unknown type or extension field (V2-1.12 R4/R5) can't block an
 *             AI edit elsewhere on the board.
 *
 *             Non-strict (`strict: false`) is exactly parseBoard: drops become
 *             warnings and nothing else is checked — the studio's own reads, older
 *             peers and `maude design check` without `--strict` behave as before.
 *             This module never writes and is not on any read/write path.
 */

import { compileSchema } from '../../../cli/lib/json-schema-lite.mjs';
import { annotationsJsonSchema, elementDefKey } from './board-schema.ts';
import { jsonEq, parseJsonSafe } from './fields.ts';
import { isValidOrderKey } from './fractional-index.ts';
import { isLocked, LOCK_EXEMPT_FIELDS } from './lock.ts';
import { defOf, REGISTRY } from './registry.ts';
import { BOARD_FORMAT, BOARD_VERSION, type BoardResult, parseBoard } from './schema.ts';
import type { AnnotationElement } from './types.ts';

export interface BoardIssue {
  code: string;
  /** element id, when the issue is about one element */
  id?: string;
  /** JSON pointer inside the element (or the document), e.g. `/label/text` */
  field?: string;
  what: string;
  fix: string;
}

export interface ValidateBoardResult extends BoardResult {
  errors: BoardIssue[];
  warnings: BoardIssue[];
}

export interface ValidateBoardOptions {
  strict?: boolean;
  /** the board's bytes before this write; null / absent = a new file */
  against?: string | null;
}

type LiteError = { path: string; keyword: string; message: string };
type Validate = (v: unknown) => LiteError[];

let compiled: { size: number; doc: Validate; byType: Map<string, Validate> } | null = null;
function validators() {
  // The registry can grow at run time (registerElementType) — recompile when it does.
  if (compiled && compiled.size === REGISTRY.size) return compiled;
  const schema = annotationsJsonSchema();
  const byType = new Map<string, Validate>();
  for (const t of REGISTRY.keys())
    byType.set(t, compileSchema(schema, { ref: `#/$defs/${elementDefKey(t)}` }) as Validate);
  const docSchema = {
    ...schema,
    properties: { ...(schema.properties as object), elements: { type: 'array' } },
  };
  compiled = { size: REGISTRY.size, doc: compileSchema(docSchema) as Validate, byType };
  return compiled;
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Raw element records of a board text, by id (first occurrence). Empty when it isn't one. */
function rawById(text: string | null | undefined): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (typeof text !== 'string') return out;
  const doc = parseJsonSafe(text);
  if (!isRec(doc) || !Array.isArray(doc.elements)) return out;
  for (const el of doc.elements)
    if (isRec(el) && typeof el.id === 'string' && !out.has(el.id)) out.set(el.id, el);
  return out;
}

const SKILL = 'skill design:whiteboard';

export function validateBoard(text: string, opts: ValidateBoardOptions = {}): ValidateBoardResult {
  const board = parseBoard(text);
  const errors: BoardIssue[] = [];
  const warnings: BoardIssue[] = [];
  const drops = board.dropped.map((d) => ({
    code: 'board-drop',
    ...(d.id ? { id: d.id } : {}),
    what: `the board loader drops this: ${d.reason}`,
    fix: `write the element in the documented shape (${SKILL})`,
  }));
  if (!opts.strict) return { ...board, errors, warnings: drops };
  errors.push(...drops);

  const doc = parseJsonSafe(text);
  // parseBoard already refused a non-board / a wrong format / a newer `v` (one drop, no elements).
  if (
    !isRec(doc) ||
    doc.format !== BOARD_FORMAT ||
    typeof doc.v !== 'number' ||
    doc.v > BOARD_VERSION
  )
    return { ...board, errors, warnings };
  const v = validators();
  for (const e of v.doc(doc)) {
    errors.push({
      code: e.keyword === 'additionalProperties' ? 'unknown-field' : 'board-shape',
      field: e.path || '/',
      what: `the board document ${e.message}`,
      fix:
        e.path === '/v'
          ? `write "v": ${BOARD_VERSION}`
          : 'a board is {"format":"maude.annotations","v":2,"elements":[…]} and nothing else',
    });
  }
  const raw = Array.isArray(doc.elements) ? doc.elements : [];
  const before = rawById(opts.against);
  const after = new Map<string, Record<string, unknown>>();

  for (const el of raw) {
    if (!isRec(el) || typeof el.id !== 'string' || after.has(el.id)) continue; // parseBoard reported it
    const id = el.id;
    after.set(id, el);
    const prev = before.get(id);
    const changed = !prev || !jsonEq(el, prev);
    const type = typeof el.type === 'string' ? el.type : '';

    if (changed) {
      const check = v.byType.get(type);
      if (!check) {
        errors.push({
          code: 'unknown-type',
          id,
          field: '/type',
          what: prev
            ? `"${id}" is a "${type}", a type this Maude doesn't know — it is read-only here`
            : `"${type}" is not an element type`,
          fix: prev
            ? 'leave this element exactly as it was'
            : `use one of: ${[...REGISTRY.keys()].join(', ')} (${SKILL})`,
        });
      } else {
        for (const e of check(el)) {
          const key = e.path.split('/')[1] ?? '';
          // A newer peer's extension field the write did not touch stays (V2-1.12 R5).
          if (
            e.keyword === 'additionalProperties' &&
            prev &&
            e.path === `/${key}` &&
            Object.hasOwn(prev, key) &&
            jsonEq(prev[key], el[key])
          )
            continue;
          const fields = Object.keys(defOf(type)?.fields ?? {}).join(', ');
          errors.push(
            e.keyword === 'additionalProperties'
              ? {
                  code: 'unknown-field',
                  id,
                  field: e.path,
                  what: `${type} has no field "${e.path.slice(1).replaceAll('/', '.')}"`,
                  fix: `remove it — ${type} fields: ${fields}`,
                }
              : {
                  code: 'invalid-value',
                  id,
                  field: e.path || '/',
                  what: `${type}${e.path.replaceAll('/', '.')} ${e.message}`,
                  fix: `write a value the field accepts (${SKILL})`,
                }
          );
        }
        if (typeof el.index === 'string' && !isValidOrderKey(el.index))
          errors.push({
            code: 'index-invalid',
            id,
            field: '/index',
            what: `"${el.index}" is not a valid order key (the loader would re-index it)`,
            fix: 'use a key like the neighbours\' — "a1" after "a0", "a0V" between "a0" and "a1"',
          });
      }
    }

    // author: immutable on an existing element; a new one is the AI's.
    if (prev) {
      if (!jsonEq(el.author, prev.author))
        errors.push({
          code: 'author-changed',
          id,
          field: '/author',
          what: `the author of "${id}" changed`,
          fix: `restore "author" to ${JSON.stringify(prev.author ?? null)}${prev.author === undefined ? ' (absent)' : ''}`,
        });
    } else if (!isRec(el.author) || el.author.kind !== 'ai') {
      errors.push({
        code: 'author-missing',
        id,
        field: '/author',
        what: `"${id}" is new, so it is authored by AI`,
        fix: 'write "author": {"kind": "ai"}',
      });
    }

    // locked (#137): the user's "don't touch".
    if (prev && isLocked(prev as AnnotationElement)) {
      if (el.locked === true) {
        const keys = new Set([...Object.keys(el), ...Object.keys(prev)]);
        const moved = [...keys].filter(
          (k) => !LOCK_EXEMPT_FIELDS.has(k) && !jsonEq(el[k], prev[k])
        );
        if (moved.length)
          errors.push({
            code: 'locked-changed',
            id,
            field: `/${moved[0]}`,
            what: `"${id}" is locked — the person pinned it (changed: ${moved.join(', ')})`,
            fix: 'leave a locked element as it was; unlock it ("locked": false) only if the person asked',
          });
      } else {
        warnings.push({
          code: 'unlocked',
          id,
          field: '/locked',
          what: `"${id}" was locked and this write unlocks it`,
          fix: 'unlock only when the person asked for it',
        });
      }
    }
  }

  for (const [id, prev] of before) {
    if (after.has(id) || !isLocked(prev as AnnotationElement)) continue;
    errors.push({
      code: 'locked-deleted',
      id,
      what: `"${id}" is locked and this write removes it`,
      fix: "put the element back; a locked element is the person's to remove",
    });
  }
  return { ...board, errors, warnings };
}
