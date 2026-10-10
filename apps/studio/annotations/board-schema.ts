/**
 * @file       annotations/board-schema.ts — the annotations-v2 JSON Schema, generated
 * @scope      apps/studio/annotations/board-schema.ts
 * @purpose    Contract V2-1.11 §5.2: the `annotations` format's schema is GENERATED
 *             from the element registry (registry.ts + the field specs' `schema`
 *             fragments in fields.ts), never written by hand. `scripts/gen-actions.mjs`
 *             writes it to apps/studio/schema/annotations.v2.schema.json and its
 *             `--check` fails on drift; `validate-board.ts` validates AI writes
 *             against the same object at run time.
 *
 *             The schema is the STRICT reading — what an AI write must look like.
 *             A reader stays lenient (V2-1.12 R4/R5): it keeps unknown types and
 *             extension fields from newer peers, and `validateBoard` exempts an
 *             element the write did not change.
 */

import { MAX_ELEMENTS } from './constants.ts';
import { type JsonSchema, specMapSchema } from './fields.ts';
import { HEAD_FIELDS, REGISTRY, TAIL_FIELDS, TYPE_RE } from './registry.ts';
import { BOARD_FORMAT, BOARD_VERSION } from './schema.ts';

export const ANNOTATIONS_SCHEMA_ID = `https://maude.sh/schema/annotations/v${BOARD_VERSION}`;

/** `$defs` key of a type's element schema. */
export const elementDefKey = (type: string): string => `el-${type}`;

/** The strict element schema of one registered type (head + type fields + tail, closed). */
export function elementSchema(type: string): JsonSchema | null {
  const def = REGISTRY.get(type);
  if (!def) return null;
  const s = specMapSchema({ ...HEAD_FIELDS, ...def.fields, ...TAIL_FIELDS }) as {
    properties: Record<string, unknown>;
  };
  return { ...s, properties: { ...s.properties, type: { const: type } } };
}

/** The whole board document's schema, from the registry as it is now. */
export function annotationsJsonSchema(): JsonSchema {
  const types = [...REGISTRY.keys()];
  const head = specMapSchema(HEAD_FIELDS) as { properties: Record<string, JsonSchema> };
  const $defs: Record<string, unknown> = {
    element: {
      description:
        'One element. Its `type` picks the shape; a type this Maude does not know is kept verbatim by readers (V2-1.12 R4) but an AI write may not create or change one.',
      oneOf: [
        ...types.map((t) => ({ $ref: `#/$defs/${elementDefKey(t)}` })),
        { $ref: '#/$defs/unknown' },
      ],
    },
    unknown: {
      description: 'An element of a type registered by a newer Maude (read-only for this one).',
      type: 'object',
      required: ['id', 'type', 'index'],
      properties: {
        ...head.properties,
        type: { type: 'string', pattern: TYPE_RE.source, not: { enum: types } },
      },
    },
  };
  for (const t of types) $defs[elementDefKey(t)] = elementSchema(t);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: ANNOTATIONS_SCHEMA_ID,
    title: `Maude whiteboard (<slug>.annotations.json), format ${BOARD_FORMAT} v${BOARD_VERSION}`,
    description:
      'GENERATED from apps/studio/annotations/registry.ts by scripts/gen-actions.mjs — do not edit. The strict reading for AI writes (`maude design check --strict`): unknown fields are errors, every value must load without repair. Coordinates are board-local and rounded to 2 decimals on load; a field equal to its default may be omitted. One element per line, parents before children (serializeBoard). Skill: design:whiteboard.',
    type: 'object',
    required: ['format', 'v', 'elements'],
    properties: {
      format: { const: BOARD_FORMAT },
      v: { const: BOARD_VERSION },
      elements: { type: 'array', maxItems: MAX_ELEMENTS, items: { $ref: '#/$defs/element' } },
    },
    additionalProperties: false,
    $defs,
  };
}
