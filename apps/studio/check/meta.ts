// check/meta.ts — the strict `.meta.json` check for AI writes (contract V2-1.11 §5.2, V2-1.18 §5.3):
// the v2 schema (apps/studio/schema/canvas-meta.v2.schema.json, `additionalProperties:false`) plus
// the diff rules a schema can't say:
//   - a top-level key the write left unchanged is never re-judged (real sidecars carry keys older
//     writers added — `artboards`, `critic`, `envelope` … — and an AI edit elsewhere must not
//     have to delete a peer's data to pass);
//   - `dsRev` is set by the design-system verbs only (V2-1.6), so a write may not change it.
// `viewport` has its own, clearer finding in check/index.ts (DDR-115).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compileSchema } from '../../../cli/lib/json-schema-lite.mjs';
import { jsonEq } from '../annotations/fields.ts';
import { SCHEMA_DIR } from '../paths.ts';

export const CANVAS_META_SCHEMA_FILE = 'canvas-meta.v2.schema.json';

export interface MetaIssue {
  code: string;
  field: string;
  what: string;
  fix: string;
}

type LiteError = { path: string; keyword: string; message: string };
let validate: ((v: unknown) => LiteError[]) | null = null;

export function canvasMetaSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, CANVAS_META_SCHEMA_FILE), 'utf8'));
}

const topKey = (e: LiteError): string =>
  e.path
    ? (e.path.split('/')[1] ?? '').replaceAll('~1', '/').replaceAll('~0', '~')
    : (/"([^"]+)"/.exec(e.message)?.[1] ?? '');

/** Issues of a parsed `.meta.json` object written over `before` (null = a new file). */
export function validateMeta(
  doc: Record<string, unknown>,
  before: Record<string, unknown> | null
): MetaIssue[] {
  validate ??= compileSchema(canvasMetaSchema()) as (v: unknown) => LiteError[];
  const out: MetaIssue[] = [];
  for (const e of validate(doc)) {
    const key = topKey(e);
    if (key === 'viewport') continue;
    if (before) {
      if (e.keyword === 'required' && !e.path && !Object.hasOwn(before, key)) continue;
      if (e.path && Object.hasOwn(before, key) && jsonEq(before[key], doc[key])) continue;
    }
    const field = e.path || `/${key}`;
    out.push(
      e.keyword === 'additionalProperties' && e.path === `/${key}`
        ? {
            code: 'meta-unknown-field',
            field,
            what: `"${key}" is not a .meta.json field`,
            fix: 'remove it — the fields are in apps/studio/schema/canvas-meta.v2.schema.json (skill design:design _guide-17)',
          }
        : {
            code: 'meta-invalid',
            field,
            what: `${field.slice(1).replaceAll('/', '.') || 'the sidecar'} ${e.message}`,
            fix: 'write the value the schema allows (skill design:design _guide-17)',
          }
    );
  }
  if (!jsonEq(doc.dsRev, before?.dsRev))
    out.push({
      code: 'meta-dsrev',
      field: '/dsRev',
      what: '`dsRev` is set by the design-system verbs, never by an edit (V2-1.6)',
      fix: `restore it${before && Object.hasOwn(before, 'dsRev') ? ` to ${JSON.stringify(before.dsRev)}` : ' (remove it)'} — follow or leave a system with \`maude design ds …\``,
    });
  return out;
}
