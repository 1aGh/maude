import { checkedLimits } from './limits.mjs';
import { sidecarSchemas, TRANSITION_PRESENTATIONS } from './sidecar-schemas.mjs';

export const PROTOCOL = 1;
export const CONTRACT_REVIEW_STATUS = 'draft-not-production-approved';
export const TERMINAL_CODES = [
  'base-conflict',
  'source-invalid',
  'dependency-missing',
  'forbidden',
  'epoch-stale',
  'generation-stale',
  'transaction-id-reused',
  'operation-unsupported',
];
export const TIMELINE_VERBS = [
  'retime',
  'remove',
  'insert',
  'reorder',
  'toggle-hide',
  'replace-src',
  'speed',
  'trim-in',
  'audio',
  'detach-audio',
  'framing',
  'grade',
  'transition',
  'split',
  'insert-transition',
  'remove-transition',
  'set-text',
  'to-overlay',
  'to-storyline',
  'layer-order',
  'resolve-placeholder',
];
// All 25 named families have strict representative schemas. Residual variants are in coverage.mjs.
export const SCHEMA_GAP_FAMILIES = [];
export const NAMED_OPERATION_FAMILIES = [
  'source.text.assign',
  'source.css.assign',
  'source.attribute.assign',
  'source.replace',
  'source.structure',
  'manifest.create',
  'manifest.move',
  'manifest.delete',
  'manifest.replace',
  'layout.assign',
  'annotation.create',
  'annotation.update',
  'annotation.delete',
  'comment.create',
  'comment.reply',
  'comment.update',
  'comment.delete',
  'photo.assign',
  'timeline.edit',
  'history.restore',
  'history.undo',
  'history.redo',
  'config.assign',
  'footage.assign',
  'edl.edit',
];

export function createSchemas(overrides = {}) {
  const l = checkedLimits(overrides);
  const obj = (properties, required = Object.keys(properties)) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });
  const str = (maxLength, extra = {}) => ({ type: 'string', maxLength, ...extra });
  const id = str(l.maxIdentifierChars, { minLength: 1, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' });
  const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
  const int = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
  const positive = { ...int, minimum: 1 };
  const num = { type: 'number', minimum: -1000000000, maximum: 1000000000 };
  const arr = (items, maxItems, minItems = 0, uniqueItems = false) => ({
    type: 'array',
    items,
    minItems,
    maxItems,
    uniqueItems,
  });
  const nullable = (s) => ({ anyOf: [s, { type: 'null' }] });
  const en = (...values) => ({ type: 'string', enum: values });
  const constant = (value) => ({ const: value });
  const text = str(l.maxTextChars);
  const propertyValue = nullable(str(l.maxPropertyChars));
  const logicalPath = str(l.maxPathChars, {
    minLength: 1,
    pattern:
      '^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//)(?!.*/$)[^:\\u0000-\\u001f\\u007f]+$',
  });
  const mediaType = str(127, { pattern: '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' });
  const origin = obj({ deviceId: id, sessionId: id });
  const identity = { documentId: id, generation: positive };
  const target = obj(
    {
      lane: en(
        'source',
        'layout',
        'annotation',
        'comment',
        'photo',
        'timeline',
        'manifest',
        'config',
        'footage',
        'edl'
      ),
      recordId: id,
      property: str(96, { minLength: 1, pattern: '^[A-Za-z][A-Za-z0-9_.-]*$' }),
    },
    ['lane']
  );
  const writeTarget = obj({ ...identity, target });
  const read = obj({ ...identity, target, expectedEffectId: id, expectedHash: hash }, [
    ...Object.keys(identity),
    'target',
  ]);
  const blob = obj({ sha256: hash, size: { ...int, maximum: l.maxBlobBytes }, mediaType });
  const asset = obj({ documentId: id, generation: positive, sha256: hash });
  const parent = nullable(obj(identity)); // null means the project root, never a physical path.
  const point = obj({ x: num, y: num });
  const op = (kind, properties = {}, required = Object.keys(properties)) =>
    obj({ kind: constant(kind), ...identity, ...properties }, [
      'kind',
      ...Object.keys(identity),
      ...required,
    ]);
  const operations = [];
  const add = (kind, properties, required) => operations.push(op(kind, properties, required));
  add('source.text.assign', { elementId: id, value: text });
  add('source.css.assign', {
    elementId: id,
    property: str(96, { pattern: '^--?[a-z][a-z0-9-]*$|^[a-z][a-z0-9-]*$' }),
    value: propertyValue,
  });
  add('source.attribute.assign', {
    elementId: id,
    property: str(96, { pattern: '^[A-Za-z][A-Za-z0-9:_-]*$' }),
    value: propertyValue,
  });
  add('source.replace', { baseHash: hash, candidate: blob });
  for (const verb of [
    'insert',
    'duplicate',
    'delete',
    'reorder',
    'detach',
    'convert-to-absolute',
  ]) {
    const common = { verb: constant(verb), elementId: id };
    if (verb === 'insert')
      add('source.structure', {
        ...common,
        parentElementId: id,
        beforeElementId: nullable(id),
        candidate: blob,
      });
    else if (verb === 'duplicate')
      add('source.structure', {
        ...common,
        newElementId: id,
        parentElementId: id,
        beforeElementId: nullable(id),
      });
    else if (verb === 'reorder')
      add('source.structure', { ...common, parentElementId: id, beforeElementId: nullable(id) });
    else add('source.structure', common);
  }
  add('manifest.create', { entryKind: constant('directory'), parent, path: logicalPath });
  add('manifest.create', {
    entryKind: constant('file'),
    parent,
    path: logicalPath,
    content: blob,
    dependencies: arr(asset, l.maxBlobs, 0, true),
  });
  add('manifest.move', {
    fromPath: logicalPath,
    fromParent: parent,
    toPath: logicalPath,
    toParent: parent,
  });
  add('manifest.delete', { path: logicalPath, parent, recursive: { type: 'boolean' } });
  const sidecars = sidecarSchemas({
    l,
    obj,
    str,
    int,
    positive,
    arr,
    nullable,
    en,
    constant,
    logicalPath,
    asset,
    blob,
    hash,
  });
  add('manifest.replace', sidecars.manifestReplace);
  add('footage.assign', sidecars.footageAssign);
  add('edl.edit', sidecars.edlEdit);
  for (const fields of sidecars.configVariants) add('config.assign', fields);
  for (const p of ['x', 'y', 'width', 'height', 'rotation']) {
    add('layout.assign', {
      artboardId: id,
      property: constant(p),
      value: ['width', 'height'].includes(p) ? { ...num, exclusiveMinimum: 0 } : num,
    });
  }
  add('layout.assign', {
    artboardId: id,
    property: constant('title'),
    value: str(l.maxLabelChars),
  });
  const position = { x: num, y: num };
  const color = str(64, { minLength: 1 });
  const dimensions = { width: { ...num, minimum: 0 }, height: { ...num, minimum: 0 } };
  const stroke = {
    oneOf: [
      obj(
        {
          type: constant('path'),
          ...position,
          points: arr(point, l.maxAnnotationPoints, 1),
          color,
        },
        ['type', 'x', 'y', 'points']
      ),
      ...['rectangle', 'ellipse'].map((type) =>
        obj({ type: constant(type), ...position, ...dimensions, color }, [
          'type',
          'x',
          'y',
          'width',
          'height',
        ])
      ),
      obj({ type: constant('line'), ...position, end: point, color }, ['type', 'x', 'y', 'end']),
      obj({ type: constant('text'), ...position, text, color }, ['type', 'x', 'y', 'text']),
      obj({ type: constant('image'), ...position, ...dimensions, asset }),
    ],
  };
  add('annotation.create', { annotationId: id, stroke });
  add('annotation.update', { annotationId: id, stroke });
  add('annotation.delete', { annotationId: id });
  const anchor = obj({ elementId: id, x: num, y: num, frame: int }, []);
  add('comment.create', {
    threadId: id,
    commentId: id,
    body: str(l.maxCommentChars, { minLength: 1 }),
    anchor,
  });
  add('comment.reply', {
    threadId: id,
    commentId: id,
    parentCommentId: id,
    body: str(l.maxCommentChars, { minLength: 1 }),
  });
  add('comment.update', {
    threadId: id,
    commentId: id,
    body: str(l.maxCommentChars, { minLength: 1 }),
  });
  add('comment.update', { threadId: id, commentId: id, resolved: { type: 'boolean' } });
  add('comment.delete', { threadId: id, commentId: id });
  const adjustment = obj(
    { brightness: num, contrast: num, saturation: num, exposure: num, temperature: num },
    []
  );
  add('photo.assign', { asset, property: constant('adjustments'), value: adjustment });
  add('photo.assign', { asset, property: constant('mask'), value: nullable(asset) });
  add('photo.assign', {
    asset,
    property: constant('crop'),
    value: nullable(
      obj({
        x: num,
        y: num,
        width: { ...num, exclusiveMinimum: 0 },
        height: { ...num, exclusiveMinimum: 0 },
      })
    ),
  });
  add('photo.assign', { asset, property: constant('reset'), value: constant(null) });
  const tv = (verb, props = {}) =>
    add('timeline.edit', { verb: constant(verb), artboardId: id, clipId: id, ...props });
  tv('retime', { from: int, durationInFrames: positive });
  tv('remove', { ripple: { type: 'boolean' } });
  tv('insert', {
    lane: en('storyline', 'overlay', 'audio'),
    at: int,
    durationInFrames: positive,
    asset,
  });
  tv('reorder', { toIndex: int });
  tv('toggle-hide', { hidden: { type: 'boolean' } });
  tv('replace-src', { asset });
  tv('speed', { rate: { type: 'number', exclusiveMinimum: 0, maximum: 100 } });
  tv('trim-in', { deltaFrames: { ...int, minimum: -Number.MAX_SAFE_INTEGER } });
  tv('audio', { muted: { type: 'boolean' }, volume: { type: 'number', minimum: 0, maximum: 10 } });
  tv('detach-audio', { newClipId: id });
  tv('framing', {
    value: nullable(
      obj({ scale: { type: 'number', exclusiveMinimum: 0, maximum: 1000 }, x: num, y: num })
    ),
  });
  tv('grade', { value: nullable(adjustment) });
  tv('transition', { presentation: en(...TRANSITION_PRESENTATIONS), durationInFrames: positive });
  tv('split', { atFrame: int, newClipId: id });
  tv('insert-transition', {
    presentation: en(...TRANSITION_PRESENTATIONS),
    durationInFrames: positive,
    transitionId: id,
  });
  tv('remove-transition', { transitionId: id });
  tv('set-text', { value: text });
  tv('to-overlay', { from: int });
  tv('to-storyline', { index: int });
  tv('layer-order', { toIndex: int });
  tv('resolve-placeholder', { asset, mediaKind: en('image', 'video') });
  const historyOp = (kind, props) => operations.push(obj({ kind: constant(kind), ...props }));
  historyOp('history.restore', { revision: int, documentIds: arr(id, l.maxWriteTargets, 1, true) });
  historyOp('history.undo', { actionId: id, effectIds: arr(id, l.maxEffectIds, 1, true) });
  historyOp('history.redo', {
    actionId: id,
    undoActionId: id,
    effectIds: arr(id, l.maxEffectIds, 1, true),
  });
  // Every family is explicit; no permissive payload fallback.
  const operation = { oneOf: operations };
  const proposal = obj({
    protocol: constant(PROTOCOL),
    projectId: id,
    epoch: positive,
    transactionId: id,
    origin,
    base: obj({ revision: int, manifestHash: hash }),
    dependsOn: arr(id, l.maxDependencies, 0, true),
    action: obj({
      kind: en('edit', 'create', 'move', 'delete', 'import', 'ai', 'restore', 'undo', 'redo'),
      label: str(l.maxLabelChars, { minLength: 1 }),
      operations: arr(operation, l.maxOperations, 1),
    }),
    reads: arr(read, l.maxReadConditions, 0, true),
    writes: arr(writeTarget, l.maxWriteTargets, 1, true),
    blobs: arr(blob, l.maxBlobs, 0, true),
  });
  const common = {
    protocol: constant(PROTOCOL),
    projectId: id,
    epoch: positive,
    transactionId: id,
    proposalHash: hash,
  };
  const effect = obj({
    effectId: id,
    operationIndex: { ...int, maximum: l.maxOperations - 1 },
    ...identity,
    target,
    previousEffectId: nullable(id),
    beforeHash: nullable(hash),
    afterHash: nullable(hash),
    undoable: { type: 'boolean' },
  });
  const accepted = obj({
    ...common,
    status: constant('accepted'),
    revision: positive,
    parentRevision: int,
    manifestHash: hash,
    actorId: id,
    origin,
    actionId: id,
    effects: arr(effect, l.maxEffects, 1),
    committedAt: int,
  });
  const rejected = obj(
    {
      ...common,
      status: constant('rejected'),
      code: en(...TERMINAL_CODES),
      currentRevision: int,
      targets: arr(writeTarget, l.maxWriteTargets, 0, true),
    },
    [...Object.keys(common), 'status', 'code', 'currentRevision']
  );
  const retryable = obj({
    ...common,
    status: constant('retryable'),
    code: en('capacity', 'retryable'),
    retryAfterMs: { ...int, maximum: l.maxRetryAfterMs },
  });
  const pending = obj({
    ...common,
    status: constant('pending'),
    retryAfterMs: { ...int, maximum: l.maxRetryAfterMs },
  });
  const unavailable = obj({
    protocol: constant(PROTOCOL),
    projectId: id,
    epoch: positive,
    transactionId: id,
    status: constant('unavailable'),
    reason: en('absent', 'result-expired'),
  });
  const result = { oneOf: [accepted, rejected, retryable, pending, unavailable] };
  const event = {
    oneOf: [
      obj({ protocol: constant(PROTOCOL), type: constant('revision.accepted'), accepted }),
      obj({
        protocol: constant(PROTOCOL),
        type: constant('epoch.changed'),
        projectId: id,
        previousEpoch: positive,
        epoch: positive,
        revision: int,
        manifestHash: hash,
      }),
      obj({
        protocol: constant(PROTOCOL),
        type: constant('replay.required'),
        projectId: id,
        epoch: positive,
        afterRevision: int,
        headRevision: int,
        reason: en('gap', 'snapshot-required', 'hash-mismatch'),
      }),
    ],
  };
  const limits = obj(Object.fromEntries(Object.keys(l).map((k) => [k, positive])));
  const schema = (name, body) => ({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://maude.sh/contracts/review/project-v1/${name}`,
    ...body,
  });
  return {
    limits: l,
    proposal: schema('proposal', proposal),
    accepted: schema('accepted', accepted),
    result: schema('result', result),
    event: schema('event', event),
    operation: schema('operation', operation),
    limitsSchema: schema('limits', limits),
  };
}
