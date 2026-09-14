import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { RESIDUAL_VARIANTS, WRITER_VARIANT_BINDINGS } from './coverage.mjs';
import { eventFixtures, operationFixtures, proposal, resultFixtures } from './fixtures.mjs';
import { invalidFixtures } from './invalid-fixtures.mjs';
import { createSchemas, SCHEMA_GAP_FAMILIES } from './schemas.mjs';

const target = new URL('./exported/', import.meta.url);
await mkdir(target, { recursive: true });
const schemas = createSchemas();
for (const key of ['proposal', 'accepted', 'result', 'event', 'operation', 'limitsSchema']) {
  await writeFile(
    new URL(`${key}.schema.json`, target),
    `${JSON.stringify(schemas[key], null, 2)}\n`
  );
}
await writeFile(
  new URL('corpus.json', target),
  `${JSON.stringify(
    {
      reviewStatus: 'draft-not-production-approved',
      limits: schemas.limits,
      valid: [
        ...operationFixtures.map((value, index) => ({
          name: `operation-${index}-${value.kind}`,
          kind: 'operation',
          value,
        })),
        ...operationFixtures.map((value, index) => ({
          name: `proposal-${index}-${value.kind}`,
          kind: 'proposal',
          value: proposal(value),
        })),
        ...resultFixtures.map((value) => ({
          name: `result-${value.status}`,
          kind: 'result',
          value,
        })),
        ...eventFixtures.map((value) => ({ name: value.type, kind: 'event', value })),
      ],
      invalid: invalidFixtures,
      failClosedFamilies: SCHEMA_GAP_FAMILIES,
      writerBindings: WRITER_VARIANT_BINDINGS,
      residualVariants: RESIDUAL_VARIANTS,
    },
    null,
    2
  )}\n`
);
process.stdout.write(`Exported review schemas and corpus to ${fileURLToPath(target)}\n`);
