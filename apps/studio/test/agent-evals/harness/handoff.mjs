// agent-evals/harness/handoff.mjs — validate a maude.agent-handoff/1 document (prototype schema).
//
// Validates against the ONE branch the document's `role` names. (The pilot's first validator reported
// the errors of both `oneOf` branches — Ajv's schemaPath is relative inside a $ref, so the filter never
// matched — and helpers were told an "out" file lacked `task`/`owns`/`output`. Fixed here.)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const HANDOFF_SCHEMA = JSON.parse(readFileSync(join(HERE, 'handoff.schema.json'), 'utf8'));
const MAX_RESULT_BYTES = 64 * 1024;

let v = null;
function validators() {
  if (!v) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    ajv.addSchema(HANDOFF_SCHEMA, 'handoff');
    v = {
      in: ajv.compile({ $ref: 'handoff#/$defs/in' }),
      out: ajv.compile({ $ref: 'handoff#/$defs/out' }),
    };
  }
  return v;
}

/** → string[] of errors ([] = valid). */
export function validateHandoff(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['not a JSON object'];
  if (doc.contract !== 'maude.agent-handoff/1')
    return ['"contract" must be "maude.agent-handoff/1"'];
  if (doc.role !== 'in' && doc.role !== 'out') return ['"role" must be "in" or "out"'];
  const fn = validators()[doc.role];
  const errs = [];
  if (!fn(doc)) {
    for (const e of fn.errors ?? []) {
      const extra = e.params?.additionalProperty
        ? ` (${e.params.additionalProperty})`
        : e.params?.allowedValues
          ? ` ${JSON.stringify(e.params.allowedValues)}`
          : '';
      errs.push(`${e.instancePath || '/'} ${e.message}${extra}`);
    }
  }
  if (doc.result && JSON.stringify(doc.result).length > MAX_RESULT_BYTES)
    errs.push('/result exceeds 64 KB');
  return [...new Set(errs)].slice(0, 20);
}
