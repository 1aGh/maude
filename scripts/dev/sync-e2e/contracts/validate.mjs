import { checkedLimits } from './limits.mjs';
import { createSchemas } from './schemas.mjs';
import { sidecarSemantics } from './sidecar-schemas.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

// JSON.parse accepts duplicate keys; exact retry bytes must not admit an
// ambiguous object representation. Scan only after syntax parsing succeeds.
function inspectWire(text, maxDepth) {
  const stack = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      const start = i++;
      while (i < text.length) {
        if (text[i] === '\\') i += 2;
        else if (text[i] === '"') break;
        else i += 1;
      }
      let after = i + 1;
      while (/\s/.test(text[after] ?? '') && after < text.length) after += 1;
      if (text[after] === ':') {
        const key = JSON.parse(text.slice(start, i + 1));
        const keys = stack.at(-1);
        if (forbiddenKeys.has(key)) return 'reserved-object-key';
        if (keys?.has(key)) return 'duplicate-object-key';
        keys?.add(key);
      }
    } else if (c === '{' || c === '[') {
      stack.push(c === '{' ? new Set() : null);
      if (stack.length > maxDepth) return 'json-depth';
    } else if (c === '}' || c === ']') stack.pop();
  }
  return null;
}

function duplicateBy(items, key) {
  const seen = new Set();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}
function targetKey(item) {
  return JSON.stringify([
    item.documentId,
    item.generation,
    item.target.lane,
    item.target.recordId ?? null,
    item.target.property ?? null,
  ]);
}
function semantics(kind, data, limits) {
  for (const operation of kind === 'operation'
    ? [data]
    : kind === 'proposal'
      ? data.action.operations
      : []) {
    const issue = sidecarSemantics(operation, limits);
    if (issue) return issue;
  }
  if (kind === 'limitsSchema') {
    try {
      checkedLimits(data);
    } catch {
      return 'inconsistent-limits';
    }
  }
  if (kind === 'proposal') {
    if (data.dependsOn.includes(data.transactionId)) return 'self-dependency';
    const history = data.action.operations.filter((op) => op.kind.startsWith('history.'));
    if (
      history.length &&
      (data.action.operations.length !== 1 || data.action.kind !== history[0].kind.split('.')[1])
    )
      return 'history-action-kind';
    if (['undo', 'redo', 'restore'].includes(data.action.kind) && !history.length)
      return 'history-action-kind';
    if (duplicateBy(data.blobs, (b) => b.sha256)) return 'duplicate-blob-hash';
    let bytes = 0;
    for (const blob of data.blobs) {
      bytes += blob.size;
      if (!Number.isSafeInteger(bytes) || bytes > limits.maxActionBlobBytes)
        return 'action-blob-bytes';
    }
    if (duplicateBy(data.reads, targetKey)) return 'duplicate-read-target';
    if (duplicateBy(data.writes, targetKey)) return 'duplicate-write-target';
    for (const op of data.action.operations) {
      const candidate =
        op.kind === 'source.replace' || (op.kind === 'source.structure' && op.verb === 'insert')
          ? op.candidate
          : (op.kind === 'manifest.create' && op.entryKind === 'file') ||
              op.kind === 'manifest.replace'
            ? op.content
            : null;
      if (
        candidate &&
        !data.blobs.some(
          (b) =>
            b.sha256 === candidate.sha256 &&
            b.size === candidate.size &&
            b.mediaType === candidate.mediaType
        )
      )
        return 'undeclared-payload';
      if (
        op.documentId &&
        !data.writes.some((w) => w.documentId === op.documentId && w.generation === op.generation)
      )
        return 'undeclared-document-write';
      if (op.kind === 'manifest.move' && op.fromPath === op.toPath) return 'same-path-move';
    }
  }
  const accepted =
    kind === 'accepted'
      ? data
      : kind === 'result' && data.status === 'accepted'
        ? data
        : kind === 'event' && data.type === 'revision.accepted'
          ? data.accepted
          : null;
  if (accepted) {
    if (accepted.revision !== accepted.parentRevision + 1) return 'revision-not-successor';
    if (duplicateBy(accepted.effects, (e) => e.effectId)) return 'duplicate-effect-id';
  }
  if (kind === 'event' && data.type === 'epoch.changed' && data.epoch <= data.previousEpoch)
    return 'epoch-not-increased';
  if (kind === 'event' && data.type === 'replay.required' && data.afterRevision > data.headRevision)
    return 'replay-cursor-ahead';
  return null;
}

/** Ajv constructor is injected: canonical module has no Node/runtime imports. */
export function createContractValidator(Ajv2020, overrides = {}) {
  const schemas = createSchemas(overrides);
  const ajv = new Ajv2020({
    strict: true,
    allErrors: false,
    validateFormats: false,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  const validators = Object.fromEntries(
    ['proposal', 'accepted', 'result', 'event', 'operation', 'limitsSchema'].map((k) => [
      k,
      ajv.compile(schemas[k]),
    ])
  );
  return {
    limits: schemas.limits,
    validate(kind, input) {
      if (!Object.hasOwn(validators, kind)) throw new TypeError(`Unknown contract kind ${kind}`);
      if (!(typeof input === 'string' || input instanceof Uint8Array))
        return { ok: false, code: 'wire-bytes-required' };
      const maxBytes =
        kind === 'proposal' || kind === 'operation'
          ? schemas.limits.maxProposalBytes
          : schemas.limits.maxResponseBytes;
      if (input.length > maxBytes) return { ok: false, code: 'wire-byte-limit' };
      const bytes = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
      if (bytes.byteLength > maxBytes) return { ok: false, code: 'wire-byte-limit' };
      let text, data;
      try {
        text = decoder.decode(bytes);
        data = JSON.parse(text);
      } catch {
        return { ok: false, code: 'invalid-json-utf8' };
      }
      const wireIssue = inspectWire(text, schemas.limits.maxJsonDepth);
      if (wireIssue) return { ok: false, code: wireIssue };
      const validate = validators[kind];
      if (!validate(data))
        return { ok: false, code: 'schema-invalid', errors: structuredClone(validate.errors) };
      const issue = semantics(kind, data, schemas.limits);
      if (issue) return { ok: false, code: issue };
      // Hash and retain THESE bytes. Never JSON.stringify(data) as the retry identity.
      return { ok: true, data, bytes };
    },
  };
}
