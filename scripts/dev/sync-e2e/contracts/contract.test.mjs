import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
  accepted,
  eventFixtures,
  H,
  operationFixtures,
  proposal,
  resultFixtures,
} from './fixtures.mjs';
import { checkedLimits, REVIEW_LIMITS } from './limits.mjs';
import {
  createSchemas,
  NAMED_OPERATION_FAMILIES,
  SCHEMA_GAP_FAMILIES,
  TERMINAL_CODES,
  TIMELINE_VERBS,
} from './schemas.mjs';
import { createContractValidator } from './validate.mjs';

// No installation and no hardcoded deployment path; while staged outside the
// repo, point CONTRACT_REPO_ROOT to its package root to resolve installed Ajv.
const require = createRequire(`${process.env.CONTRACT_REPO_ROOT ?? process.cwd()}/package.json`);
const Ajv = require('ajv/dist/2020.js').default;
const validator = createContractValidator(Ajv);
const check = (kind, data) => validator.validate(kind, JSON.stringify(data));
const mutate = (value, fn) => {
  const copy = structuredClone(value);
  fn(copy);
  return copy;
};

for (const [index, op] of operationFixtures.entries()) {
  test(`valid operation+proposal ${index}: ${op.kind}/${op.verb ?? op.property ?? ''}`, () => {
    assert.equal(check('operation', op).ok, true);
    const result = check('proposal', proposal(op));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(
      check(
        'proposal',
        mutate(proposal(op), (p) => {
          p.action.operations[0].unexpected = 1;
        })
      ).ok,
      false
    );
  });
}
test('every named family and timeline verb has a representative fixture', () => {
  assert.deepEqual(
    new Set(operationFixtures.map((op) => op.kind)),
    new Set(NAMED_OPERATION_FAMILIES)
  );
  assert.deepEqual(
    new Set(operationFixtures.filter((x) => x.kind === 'timeline.edit').map((x) => x.verb)),
    new Set(TIMELINE_VERBS)
  );
  for (const kind of SCHEMA_GAP_FAMILIES)
    assert.equal(
      check('operation', { kind, documentId: 'doc-1', generation: 1, payload: {} }).ok,
      false
    );
});
test('wire identity retains exact bytes including whitespace and Unicode', () => {
  const p = proposal();
  p.action.operations[0].value = 'Žluťoučký 🐊';
  const wire = ` \n${JSON.stringify(p, null, 2)}\n`;
  const result = validator.validate('proposal', wire);
  assert.equal(result.ok, true);
  assert.equal(new TextDecoder().decode(result.bytes), wire);
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.notEqual(digest(result.bytes), digest(JSON.stringify(result.data)));
});
test('schema rejects unknown protocol, actor/role injection, unsafe integer and extra nested keys', () => {
  const mutations = [
    (p) => {
      p.protocol = 2;
    },
    (p) => {
      p.actorId = 'owner';
    },
    (p) => {
      p.origin.role = 'owner';
    },
    (p) => {
      p.epoch = 0;
    },
    (p) => {
      p.base.revision = Number.MAX_SAFE_INTEGER + 1;
    },
    (p) => {
      p.action.operations[0].generation = 0;
    },
    (p) => {
      p.base.manifestHash = 'invalid';
    },
    (p) => {
      p.projectId = '../tenant';
    },
    (p) => {
      p.action.operations = [];
    },
  ];
  for (const fn of mutations) assert.equal(check('proposal', mutate(proposal(), fn)).ok, false);
});
test('dependencies, footprint identity and immutable candidate references are checked', () => {
  assert.equal(
    check(
      'proposal',
      mutate(proposal(), (p) => p.dependsOn.push(p.transactionId))
    ).code,
    'self-dependency'
  );
  assert.equal(
    check(
      'proposal',
      mutate(proposal(), (p) => {
        p.writes[0].documentId = 'other';
      })
    ).code,
    'undeclared-document-write'
  );
  assert.equal(
    check(
      'proposal',
      mutate(proposal(operationFixtures.find((o) => o.kind === 'source.replace')), (p) => {
        p.blobs = [];
      })
    ).code,
    'undeclared-payload'
  );
  assert.equal(
    check(
      'proposal',
      mutate(proposal(), (p) => p.reads.push({ ...p.reads[0], expectedHash: 'c'.repeat(64) }))
    ).code,
    'duplicate-read-target'
  );
});
test('traversal and platform absolute path forms are rejected', () => {
  const template = operationFixtures.find(
    (o) => o.kind === 'manifest.create' && o.entryKind === 'directory'
  );
  for (const path of ['../foo', 'a/../b', '/absolute', 'a\\b', 'a//b', 'a/./b', 'a/', 'a\u0000b']) {
    assert.equal(check('operation', { ...template, path }).ok, false, path);
  }
  assert.equal(check('operation', { ...template, path: 'ui/Prázdná složka' }).ok, true);
});
test('explicit limits are finite, configurable and reject unknown knobs', () => {
  assert.throws(() => checkedLimits({ maxOperations: Infinity }));
  assert.throws(() => checkedLimits({ maxOperations: 0 }));
  assert.throws(() => checkedLimits({ mystery: 2 }));
  assert.equal(check('limitsSchema', REVIEW_LIMITS).ok, true);
  const small = createContractValidator(Ajv, { maxOperations: 1, maxProposalBytes: 500 });
  assert.equal(small.validate('proposal', ' '.repeat(501)).code, 'wire-byte-limit');
  assert.equal(
    check(
      'proposal',
      mutate(proposal(), (p) => {
        p.action.operations[0].value = 'x'.repeat(REVIEW_LIMITS.maxTextChars + 1);
      })
    ).ok,
    false
  );
});
test('UTF8, JSON syntax, duplicate keys including escaped aliases and reserved keys fail', () => {
  assert.equal(validator.validate('proposal', new Uint8Array([0xff])).code, 'invalid-json-utf8');
  assert.equal(validator.validate('proposal', '{').code, 'invalid-json-utf8');
  assert.equal(validator.validate('proposal', '{"a":1,"a":2}').code, 'duplicate-object-key');
  assert.equal(validator.validate('proposal', '{"a":1,"\\u0061":2}').code, 'duplicate-object-key');
  assert.equal(validator.validate('proposal', '{"__proto__":{}}').code, 'reserved-object-key');
  assert.equal(
    validator.validate('proposal', '['.repeat(25) + '0' + ']'.repeat(25)).code,
    'json-depth'
  );
  assert.equal(validator.validate('proposal', proposal()).code, 'wire-bytes-required');
});
for (const result of resultFixtures)
  test(`valid result ${result.status}`, () => assert.equal(check('result', result).ok, true));
for (const event of eventFixtures)
  test(`valid event ${event.type}`, () => assert.equal(check('event', event).ok, true));
test('all terminal codes have the same strict rejection shape', () => {
  for (const code of TERMINAL_CODES)
    assert.equal(check('result', { ...resultFixtures[1], code }).ok, true);
});
test('retryable/pending cannot masquerade as accepted or terminal rejection', () => {
  assert.equal(check('result', { ...resultFixtures[1], code: 'retryable' }).ok, false);
  assert.equal(check('result', { ...resultFixtures[2], revision: 3 }).ok, false);
  assert.equal(check('result', { ...accepted(), status: 'pending' }).ok, false);
  assert.equal(
    check('event', { protocol: 1, type: 'revision.accepted', accepted: resultFixtures[2] }).ok,
    false
  );
});
test('accepted successor revision, unique effects and monotonic event epochs', () => {
  assert.equal(
    check(
      'result',
      mutate(accepted(), (p) => {
        p.revision = 10;
      })
    ).code,
    'revision-not-successor'
  );
  assert.equal(
    check(
      'accepted',
      mutate(accepted(), (p) => p.effects.push({ ...p.effects[0] }))
    ).code,
    'duplicate-effect-id'
  );
  assert.equal(check('event', { ...eventFixtures[1], epoch: 1 }).code, 'epoch-not-increased');
  assert.equal(
    check('event', { ...eventFixtures[2], afterRevision: 5 }).code,
    'replay-cursor-ahead'
  );
});
test('operation variant rejects arbitrary scripts, viewport and unrelated media params', () => {
  assert.equal(
    check('operation', {
      kind: 'source.structure',
      documentId: 'doc-1',
      generation: 1,
      verb: 'run',
      code: 'evil()',
    }).ok,
    false
  );
  assert.equal(
    check('operation', {
      kind: 'layout.assign',
      documentId: 'doc-1',
      generation: 1,
      artboardId: 'board-1',
      property: 'viewport',
      value: 1,
    }).ok,
    false
  );
  const speed = operationFixtures.find((o) => o.kind === 'timeline.edit' && o.verb === 'speed');
  assert.equal(check('operation', { ...speed, muted: true }).ok, false);
});
test('exported schema metadata remains explicitly draft and schemas are serializable', () => {
  const schemas = createSchemas();
  assert.equal(
    JSON.parse(JSON.stringify(schemas.proposal)).$schema,
    'https://json-schema.org/draft/2020-12/schema'
  );
});

const { invalidFixtures } = await import('./invalid-fixtures.mjs');
for (const fixture of invalidFixtures)
  test(`invalid corpus: ${fixture.name}`, () =>
    assert.equal(check(fixture.kind, fixture.value).code, fixture.code));
test('platform path and limits consistency edge cases are rejected', () => {
  const folder = operationFixtures.find(
    (o) => o.kind === 'manifest.create' && o.entryKind === 'directory'
  );
  assert.equal(check('operation', { ...folder, path: 'C:/folder' }).ok, false);
  assert.equal(check('operation', { ...folder, path: 'file:folder' }).ok, false);
  assert.equal(
    check('limitsSchema', { ...REVIEW_LIMITS, maxBlobBytes: REVIEW_LIMITS.maxActionBlobBytes + 1 })
      .code,
    'inconsistent-limits'
  );
  assert.throws(() => checkedLimits(JSON.parse('{"__proto__":2}')));
  assert.throws(() => validator.validate('toString', '{}'));
});
test('history action kind cannot carry unrelated edits or be mixed with them', () => {
  assert.equal(
    check(
      'proposal',
      mutate(proposal(), (p) => {
        p.action.kind = 'undo';
      })
    ).code,
    'history-action-kind'
  );
  const undo = proposal(operationFixtures.find((o) => o.kind === 'history.undo'));
  assert.equal(
    check(
      'proposal',
      mutate(undo, (p) => p.action.operations.push(operationFixtures[0]))
    ).code,
    'history-action-kind'
  );
});
