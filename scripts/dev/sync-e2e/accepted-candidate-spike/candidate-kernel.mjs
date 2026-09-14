// Bounded T7 spike. Single-process local journal proves sequencing, NOT T8 durability.
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { sourceError, Y } from './deps.mjs';
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const BASE = 'export default function Canvas(){return <div>BASE</div>}';
export const DOC = 'projects/p/accepted/d';
export function atomicWrite(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + '.tmp';
  const fd = openSync(temp, 'w', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  const directory = openSync(dirname(path), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
export class Kernel {
  constructor(root, publish = () => {}) {
    this.root = root;
    this.publish = publish;
    this.file = join(root, 'canonical.json');
    this.state = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, 'utf8'))
      : { epoch: 1, revision: 0, source: BASE, results: {}, history: [] };
    if (!existsSync(this.file)) atomicWrite(this.file, JSON.stringify(this.state));
    this.project();
  }
  project() {
    atomicWrite(join(this.root, 'checkout/canvas.tsx'), this.state.source);
  }
  propose(actor, bytes) {
    if (bytes.length > 1024 * 1024) return { status: 'rejected', code: 'capacity' };
    let p;
    try {
      p = JSON.parse(bytes);
    } catch {
      return { status: 'rejected', code: 'malformed' };
    }
    if (
      p.protocol !== 1 ||
      p.projectId !== 'p' ||
      !/^[a-zA-Z0-9_-]{1,96}$/.test(p.transactionId || '') ||
      !Array.isArray(p.dependsOn) ||
      p.dependsOn.length > 16 ||
      p.dependsOn.some((id) => typeof id !== 'string')
    )
      return { status: 'rejected', code: 'malformed' };
    const key = JSON.stringify([actor.id, p.transactionId]),
      proposalHash = hash(bytes);
    // Membership is authoritative on every request, before returning old accepted data.
    if (actor.role !== 'designer') return { status: 'rejected', code: 'forbidden' };
    if (p.epoch !== this.state.epoch) return { status: 'rejected', code: 'epoch-stale' };
    const retained = this.state.results[key];
    if (retained)
      return retained.proposalHash === proposalHash
        ? retained
        : { status: 'rejected', code: 'transaction-id-reused' };
    let code = null;
    for (const parent of p.dependsOn) {
      const result = this.state.results[JSON.stringify([actor.id, parent])];
      if (!result || result.status !== 'accepted') {
        code = 'dependency-missing';
        break;
      }
    }
    const op = p.action?.operations?.[0];
    if (
      !code &&
      (p.action?.operations?.length !== 1 ||
        op?.kind !== 'source.replace' ||
        op.documentId !== 'd' ||
        op.generation !== 1 ||
        typeof op.source !== 'string')
    )
      code = 'unsupported-operation';
    if (
      !code &&
      (p.base?.revision !== this.state.revision ||
        p.base?.manifestHash !== hash(this.state.source) ||
        op.expectedHash !== hash(this.state.source))
    )
      code = 'base-conflict';
    if (!code && sourceError('canvas.tsx', op.source)) code = 'source-invalid';
    const result = code
      ? {
          status: 'rejected',
          code,
          transactionId: p.transactionId,
          proposalHash,
          currentRevision: this.state.revision,
        }
      : {
          status: 'accepted',
          transactionId: p.transactionId,
          proposalHash,
          revision: this.state.revision + 1,
          parentRevision: this.state.revision,
          manifestHash: hash(op.source),
        };
    // Copy -> persist -> publish. No optimistic Yjs bytes are ever applied here.
    const next = structuredClone(this.state);
    next.results[key] = result;
    if (!code) {
      next.source = op.source;
      next.revision = result.revision;
      next.history.push({ ...result, actorId: actor.id, source: op.source });
    }
    atomicWrite(this.file, JSON.stringify(next));
    this.state = next;
    if (!code) {
      this.project();
      this.publish(next.source, next.revision);
    }
    return result;
  }
}
export function proposal(id, source, state, dependsOn = []) {
  return Buffer.from(
    JSON.stringify({
      protocol: 1,
      projectId: 'p',
      epoch: state.epoch,
      transactionId: id,
      base: { revision: state.revision, manifestHash: hash(state.source) },
      dependsOn,
      action: {
        kind: 'source.replace',
        operations: [
          {
            kind: 'source.replace',
            documentId: 'd',
            generation: 1,
            expectedHash: hash(state.source),
            source,
          },
        ],
      },
    })
  );
}
// Concrete retained representation: exact request + full candidate snapshot + delta.
// Pending Yjs bytes are recovery evidence only, never an accepted replay format.
export class Outbox {
  constructor(root) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }
  retain(id, request, candidate, update) {
    const file = join(this.root, id + '.json');
    const item = {
      request: Buffer.from(request).toString('base64'),
      candidate: Buffer.from(Y.encodeStateAsUpdate(candidate)).toString('base64'),
      update: Buffer.from(update).toString('base64'),
    };
    if (existsSync(file) && readFileSync(file, 'utf8') !== JSON.stringify(item))
      throw new Error('immutable-candidate');
    atomicWrite(file, JSON.stringify(item));
    return item;
  }
  read(id) {
    return JSON.parse(readFileSync(join(this.root, id + '.json'), 'utf8'));
  }
  restore(id) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(this.read(id).candidate, 'base64'));
    return doc;
  }
}
