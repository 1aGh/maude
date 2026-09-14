import { INITIAL_HASH } from '../conformance/storage-policy.mjs';
export function proposal(
  project,
  id = 'tx-1',
  { revision = 0, manifest = INITIAL_HASH, epoch = 1, value = 'Hello' } = {}
) {
  return JSON.stringify({
    protocol: 1,
    projectId: project,
    epoch,
    transactionId: id,
    origin: { deviceId: 'device', sessionId: 'session' },
    base: { revision, manifestHash: manifest },
    dependsOn: [],
    action: {
      kind: 'edit',
      label: 'Edit heading',
      operations: [
        {
          kind: 'source.text.assign',
          documentId: 'doc-1',
          generation: 1,
          elementId: 'el-1',
          value,
        },
      ],
    },
    reads: [],
    writes: [{ documentId: 'doc-1', generation: 1, target: { lane: 'source' } }],
    blobs: [],
  });
}
