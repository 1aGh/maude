import { accepted, eventFixtures, operationFixtures, proposal } from './fixtures.mjs';

const edit = (value, fn) => {
  const out = structuredClone(value);
  fn(out);
  return out;
};
export const invalidFixtures = [
  {
    name: 'future-protocol',
    kind: 'proposal',
    value: edit(proposal(), (p) => {
      p.protocol = 2;
    }),
    code: 'schema-invalid',
  },
  {
    name: 'client-selected-actor',
    kind: 'proposal',
    value: { ...proposal(), actorId: 'admin' },
    code: 'schema-invalid',
  },
  {
    name: 'client-selected-role',
    kind: 'proposal',
    value: edit(proposal(), (p) => {
      p.origin.role = 'owner';
    }),
    code: 'schema-invalid',
  },
  {
    name: 'self-dependent-action',
    kind: 'proposal',
    value: edit(proposal(), (p) => {
      p.dependsOn = [p.transactionId];
    }),
    code: 'self-dependency',
  },
  {
    name: 'unsafe-base-revision',
    kind: 'proposal',
    value: edit(proposal(), (p) => {
      p.base.revision = 9007199254740992;
    }),
    code: 'schema-invalid',
  },
  {
    name: 'missing-declared-write',
    kind: 'proposal',
    value: edit(proposal(), (p) => {
      p.writes[0].documentId = 'different';
    }),
    code: 'undeclared-document-write',
  },
  {
    name: 'candidate-blob-not-declared',
    kind: 'proposal',
    value: edit(proposal(operationFixtures.find((o) => o.kind === 'source.replace')), (p) => {
      p.blobs = [];
    }),
    code: 'undeclared-payload',
  },
  {
    name: 'whole-file-without-proven-base',
    kind: 'proposal',
    value: edit(proposal(operationFixtures.find((o) => o.kind === 'source.replace')), (p) => {
      delete p.action.operations[0].baseHash;
    }),
    code: 'schema-invalid',
  },
  {
    name: 'unknown-operation',
    kind: 'proposal',
    value: edit(proposal(), (p) => {
      p.action.operations[0].kind = 'run.code';
    }),
    code: 'schema-invalid',
  },
  {
    name: 'unsupported-sensitive-config-property',
    kind: 'operation',
    value: {
      kind: 'config.assign',
      documentId: 'doc-1',
      generation: 1,
      property: 'trust',
      value: true,
    },
    code: 'schema-invalid',
  },
  {
    name: 'annotation-image-without-asset',
    kind: 'operation',
    value: {
      kind: 'annotation.create',
      documentId: 'doc-1',
      generation: 1,
      annotationId: 'stroke-1',
      stroke: { type: 'image', x: 0, y: 0, width: 10, height: 10 },
    },
    code: 'schema-invalid',
  },
  {
    name: 'nonconsecutive-accepted-revision',
    kind: 'accepted',
    value: { ...accepted(), revision: 9 },
    code: 'revision-not-successor',
  },
  {
    name: 'duplicate-accepted-effect',
    kind: 'result',
    value: edit(accepted(), (r) => r.effects.push(structuredClone(r.effects[0]))),
    code: 'duplicate-effect-id',
  },
  {
    name: 'epoch-did-not-advance',
    kind: 'event',
    value: { ...eventFixtures[1], epoch: 1 },
    code: 'epoch-not-increased',
  },
  {
    name: 'replay-cursor-ahead',
    kind: 'event',
    value: { ...eventFixtures[2], afterRevision: 99 },
    code: 'replay-cursor-ahead',
  },
  {
    name: 'acceptance-without-authenticated-actor',
    kind: 'accepted',
    value: edit(accepted(), (r) => {
      delete r.actorId;
    }),
    code: 'schema-invalid',
  },
];

const { sidecarFixtures } = await import('./sidecar-fixtures.mjs');
const footage = sidecarFixtures.find((o) => o.kind === 'footage.assign');
const edl = sidecarFixtures.find((o) => o.kind === 'edl.edit');
const replace = sidecarFixtures.find((o) => o.kind === 'manifest.replace');
invalidFixtures.push(
  {
    name: 'support-replace-without-base',
    kind: 'operation',
    value: edit(replace, (o) => {
      delete o.baseHash;
    }),
    code: 'schema-invalid',
  },
  {
    name: 'support-replace-undeclared-payload',
    kind: 'proposal',
    value: edit(proposal(replace), (o) => {
      o.blobs = [];
    }),
    code: 'undeclared-payload',
  },
  {
    name: 'config-credentials-injection',
    kind: 'operation',
    value: {
      kind: 'config.assign',
      documentId: 'doc-1',
      generation: 1,
      property: 'linkedHub',
      value: { token: 'secret' },
    },
    code: 'schema-invalid',
  },
  {
    name: 'footage-reversed-shot',
    kind: 'operation',
    value: edit(footage, (o) => {
      o.value.shots[0].end = 0;
    }),
    code: 'footage-shot-range',
  },
  {
    name: 'footage-wrong-source-path',
    kind: 'operation',
    value: edit(footage, (o) => {
      o.value.asset = 'assets/bbbbbbbb.mp4';
    }),
    code: 'footage-asset-mismatch',
  },
  {
    name: 'edl-unbound-media',
    kind: 'operation',
    value: edit(edl, (o) => {
      o.assets = [];
    }),
    code: 'unbound-edl-asset',
  },
  {
    name: 'edl-reversed-caption',
    kind: 'operation',
    value: edit(edl, (o) => {
      o.value.captions.cues[0].endSec = 0;
    }),
    code: 'edl-caption-range',
  },
  {
    name: 'edl-oversized-transition',
    kind: 'operation',
    value: edit(edl, (o) => {
      o.value.beats[1].transition.frames = 100;
    }),
    code: 'edl-transition-duration',
  }
);
