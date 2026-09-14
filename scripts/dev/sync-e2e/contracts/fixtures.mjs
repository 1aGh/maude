import { sidecarFixtures } from './sidecar-fixtures.mjs';
export const H = 'a'.repeat(64);
export const H2 = 'b'.repeat(64);
const identity = { documentId: 'doc-1', generation: 1 };
const blob = { sha256: H, size: 10, mediaType: 'text/plain' };
const asset = { ...identity, sha256: H };
const base = (kind) => ({ kind, ...identity });
export const operationFixtures = [
  { ...base('source.text.assign'), elementId: 'el-1', value: 'Hello' },
  { ...base('source.css.assign'), elementId: 'el-1', property: 'background-color', value: '#fff' },
  { ...base('source.attribute.assign'), elementId: 'el-1', property: 'title', value: null },
  { ...base('source.replace'), baseHash: H2, candidate: blob },
  ...['insert', 'duplicate', 'delete', 'reorder', 'detach', 'convert-to-absolute'].map((verb) => ({
    ...base('source.structure'),
    verb,
    elementId: 'el-1',
    ...(['insert', 'duplicate', 'reorder'].includes(verb)
      ? { parentElementId: 'parent-1', beforeElementId: null }
      : {}),
    ...(verb === 'insert' ? { candidate: blob } : {}),
    ...(verb === 'duplicate' ? { newElementId: 'el-2' } : {}),
  })),
  { ...base('manifest.create'), entryKind: 'directory', parent: null, path: 'ui/Empty' },
  {
    ...base('manifest.create'),
    entryKind: 'file',
    parent: null,
    path: 'ui/Card.tsx',
    content: blob,
    dependencies: [],
  },
  {
    ...base('manifest.move'),
    fromPath: 'ui/Card.tsx',
    fromParent: null,
    toPath: 'ui/New/Card.tsx',
    toParent: { documentId: 'directory-1', generation: 1 },
  },
  { ...base('manifest.delete'), path: 'ui/Card.tsx', parent: null, recursive: false },
  ...['x', 'y', 'width', 'height', 'rotation', 'title'].map((property) => ({
    ...base('layout.assign'),
    artboardId: 'board-1',
    property,
    value: property === 'title' ? 'Board' : 20,
  })),
  {
    ...base('annotation.create'),
    annotationId: 'stroke-1',
    stroke: {
      type: 'path',
      x: 0,
      y: 0,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
      ],
    },
  },
  {
    ...base('annotation.update'),
    annotationId: 'stroke-1',
    stroke: { type: 'text', x: 0, y: 0, text: 'New text' },
  },
  { ...base('annotation.delete'), annotationId: 'stroke-1' },
  {
    ...base('comment.create'),
    threadId: 'thread-1',
    commentId: 'comment-1',
    body: 'Please adjust',
    anchor: { elementId: 'el-1', x: 1, y: 2 },
  },
  {
    ...base('comment.reply'),
    threadId: 'thread-1',
    commentId: 'comment-2',
    parentCommentId: 'comment-1',
    body: 'Done',
  },
  { ...base('comment.update'), threadId: 'thread-1', commentId: 'comment-1', body: 'Adjusted' },
  { ...base('comment.update'), threadId: 'thread-1', commentId: 'comment-1', resolved: true },
  { ...base('comment.delete'), threadId: 'thread-1', commentId: 'comment-1' },
  { ...base('photo.assign'), asset, property: 'adjustments', value: { brightness: 0.5 } },
  { ...base('photo.assign'), asset, property: 'mask', value: asset },
  {
    ...base('photo.assign'),
    asset,
    property: 'crop',
    value: { x: 0, y: 0, width: 100, height: 100 },
  },
  { ...base('photo.assign'), asset, property: 'reset', value: null },
  { kind: 'history.restore', revision: 1, documentIds: ['doc-1'] },
  { kind: 'history.undo', actionId: 'action-1', effectIds: ['effect-1'] },
  {
    kind: 'history.redo',
    actionId: 'action-1',
    undoActionId: 'undo-1',
    effectIds: ['effect-undo-1'],
  },
];
const timelineParams = {
  retime: { from: 0, durationInFrames: 30 },
  remove: { ripple: false },
  insert: { lane: 'storyline', at: 0, durationInFrames: 30, asset },
  reorder: { toIndex: 0 },
  'toggle-hide': { hidden: true },
  'replace-src': { asset },
  speed: { rate: 1.5 },
  'trim-in': { deltaFrames: -1 },
  audio: { muted: false, volume: 0.5 },
  'detach-audio': { newClipId: 'clip-2' },
  framing: { value: null },
  grade: { value: { exposure: 0.25 } },
  transition: { presentation: 'fade', durationInFrames: 10 },
  split: { atFrame: 15, newClipId: 'clip-2' },
  'insert-transition': { presentation: 'fade', durationInFrames: 10, transitionId: 'transition-1' },
  'remove-transition': { transitionId: 'transition-1' },
  'set-text': { value: 'Title' },
  'to-overlay': { from: 0 },
  'to-storyline': { index: 0 },
  'layer-order': { toIndex: 0 },
  'resolve-placeholder': { asset, mediaKind: 'video' },
};
for (const [verb, params] of Object.entries(timelineParams))
  operationFixtures.push({
    ...base('timeline.edit'),
    artboardId: 'board-1',
    clipId: 'clip-1',
    verb,
    ...params,
  });

operationFixtures.push(...sidecarFixtures);

export function proposal(operation = operationFixtures[0]) {
  const lane = operation.kind.startsWith('source.') ? 'source' : operation.kind.split('.')[0];
  return {
    protocol: 1,
    projectId: 'project-1',
    epoch: 1,
    transactionId: 'tx-1',
    origin: { deviceId: 'device-1', sessionId: 'session-1' },
    base: { revision: 1, manifestHash: H2 },
    dependsOn: [],
    action: {
      kind: operation.kind.startsWith('history.') ? operation.kind.split('.')[1] : 'edit',
      label: 'Example edit',
      operations: [structuredClone(operation)],
    },
    reads: [
      { ...identity, target: { lane: lane === 'history' ? 'source' : lane }, expectedHash: H2 },
    ],
    writes: [{ ...identity, target: { lane: lane === 'history' ? 'source' : lane } }],
    blobs: [operation.content ?? operation.candidate ?? blob],
  };
}
const common = {
  protocol: 1,
  projectId: 'project-1',
  epoch: 1,
  transactionId: 'tx-1',
  proposalHash: H,
};
export function accepted() {
  return {
    ...common,
    status: 'accepted',
    revision: 2,
    parentRevision: 1,
    manifestHash: H2,
    actorId: 'actor-1',
    origin: { deviceId: 'device-1', sessionId: 'session-1' },
    actionId: 'action-1',
    effects: [
      {
        effectId: 'effect-1',
        operationIndex: 0,
        ...identity,
        target: { lane: 'source', recordId: 'el-1', property: 'text' },
        previousEffectId: null,
        beforeHash: H,
        afterHash: H2,
        undoable: true,
      },
    ],
    committedAt: 1789380000000,
  };
}
export const resultFixtures = [
  accepted(),
  { ...common, status: 'rejected', code: 'base-conflict', currentRevision: 4 },
  { ...common, status: 'retryable', code: 'capacity', retryAfterMs: 1000 },
  { ...common, status: 'pending', retryAfterMs: 500 },
  {
    protocol: 1,
    projectId: 'project-1',
    epoch: 1,
    transactionId: 'tx-1',
    status: 'unavailable',
    reason: 'result-expired',
  },
];
export const eventFixtures = [
  { protocol: 1, type: 'revision.accepted', accepted: accepted() },
  {
    protocol: 1,
    type: 'epoch.changed',
    projectId: 'project-1',
    previousEpoch: 1,
    epoch: 2,
    revision: 4,
    manifestHash: H,
  },
  {
    protocol: 1,
    type: 'replay.required',
    projectId: 'project-1',
    epoch: 1,
    afterRevision: 1,
    headRevision: 4,
    reason: 'gap',
  },
];
