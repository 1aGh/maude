import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { own, repo } from './paths.mjs';
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const validatorFile = join(
  repo,
  'scripts/dev/sync-e2e/validation-runtime-spike/dist/source-validator.mjs'
);
export class ValidationPool {
  constructor({
    size = 2,
    timeoutMs = 2000,
    startupMs = 3000,
    workerScript = join(own, 'worker.mjs'),
    maxStartFailures = 3,
  } = {}) {
    if (!Number.isInteger(size) || size < 1 || size > 8) throw new Error('invalid-pool-size');
    this.validatorHash = hash(readFileSync(validatorFile));
    this.timeoutMs = timeoutMs;
    this.startupMs = startupMs;
    this.workerScript = workerScript;
    this.maxStartFailures = maxStartFailures;
    this.closed = false;
    this.events = [];
    this.cwd = mkdtempSync(join(tmpdir(), 't8-pool-empty-'));
    this.slots = Array.from({ length: size }, (_, index) => ({
      index,
      state: 'starting',
      child: null,
      job: null,
      generation: null,
      starts: 0,
      failures: 0,
    }));
    for (const slot of this.slots) this.spawn(slot);
  }
  spawn(slot) {
    if (this.closed) return;
    slot.generation = randomUUID();
    slot.state = 'starting';
    slot.starts++;
    const child = fork(this.workerScript, [validatorFile, slot.generation], {
      cwd: this.cwd,
      execArgv: ['--max-old-space-size=96'],
      env: {},
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    slot.child = child;
    let warmed = false;
    const startTimer = setTimeout(() => this.stop(slot, 'startup-timeout'), this.startupMs);
    slot.startTimer = startTimer;
    child.on('error', () => {
      if (slot.child === child) this.stop(slot, 'worker-error');
    });
    child.on('message', (message) => {
      if (this.closed || slot.child !== child || slot.state === 'stopping') return;
      if (slot.state === 'starting') {
        if (
          message?.type !== 'ready' ||
          message.generation !== slot.generation ||
          message.validatorHash !== this.validatorHash ||
          message.pid !== child.pid
        ) {
          this.stop(slot, 'invalid-ready');
          return;
        }
        warmed = true;
        clearTimeout(startTimer);
        slot.failures = 0;
        slot.state = 'idle';
        this.events.push({ type: 'ready', slot: slot.index, pid: child.pid });
        return;
      }
      const job = slot.job;
      if (!job) {
        this.stop(slot, 'unexpected-message');
        return;
      }
      if (
        message?.type !== 'result' ||
        message.id !== job.id ||
        message.hash !== job.hash ||
        message.validatorHash !== this.validatorHash ||
        message.generation !== slot.generation ||
        typeof message.valid !== 'boolean' ||
        message.executed !== false ||
        (message.valid ? message.error !== null : typeof message.error !== 'string')
      ) {
        this.stop(slot, 'invalid-worker-result');
        return;
      }
      clearTimeout(job.timer);
      slot.job = null;
      slot.state = 'idle';
      this.events.push({ type: 'result', slot: slot.index, pid: child.pid, id: job.id });
      job.resolve({ ...message, roundtripMs: performance.now() - job.started, pid: child.pid });
    });
    child.on('close', () => {
      clearTimeout(startTimer);
      if (slot.child !== child) return;
      if (slot.job) this.finishFailure(slot, 'worker-crashed');
      slot.child = null;
      if (this.closed) {
        slot.state = 'closed';
        return;
      }
      if (!warmed) slot.failures++;
      this.events.push({ type: 'closed', slot: slot.index, pid: child.pid });
      if (slot.failures >= this.maxStartFailures) {
        slot.state = 'failed';
        return;
      }
      slot.state = 'starting';
      slot.restartTimer = setTimeout(
        () => this.spawn(slot),
        Math.min(250, 25 * 2 ** slot.failures)
      );
    });
  }
  finishFailure(slot, code) {
    const job = slot.job;
    if (!job) return;
    clearTimeout(job.timer);
    slot.job = null;
    job.resolve({
      valid: false,
      code,
      retryable: true,
      id: job.id,
      hash: job.hash,
      validatorHash: this.validatorHash,
    });
  }
  stop(slot, code) {
    if (slot.state === 'stopping' || slot.state === 'closed') return;
    this.finishFailure(slot, code);
    slot.state = 'stopping';
    clearTimeout(slot.startTimer);
    if (slot.child && !slot.child.killed) slot.child.kill('SIGKILL');
  }
  health() {
    return {
      ready: !this.closed && this.slots.every((s) => s.state === 'idle' || s.state === 'busy'),
      draining: this.closed,
      warmed: this.slots.filter((s) => s.state === 'idle' || s.state === 'busy').length,
      size: this.slots.length,
      validatorHash: this.validatorHash,
      slots: this.slots.map((s) => ({
        index: s.index,
        pid: s.child?.pid || null,
        state: s.state,
        starts: s.starts,
        failures: s.failures,
      })),
    };
  }
  validate(body, expectedHash) {
    if (typeof body !== 'string' || Buffer.byteLength(body) > 4 * 1024 * 1024)
      return Promise.resolve({ valid: false, code: 'source-too-large' });
    expectedHash ??= hash(body);
    if (expectedHash !== hash(body))
      return Promise.resolve({ valid: false, code: 'hash-mismatch' });
    if (this.closed) return Promise.resolve({ valid: false, code: 'draining', retryable: true });
    const slot = this.slots.find((s) => s.state === 'idle');
    if (!slot) return Promise.resolve({ valid: false, code: 'capacity', retryable: true });
    return new Promise((resolve) => {
      const job = { id: randomUUID(), hash: expectedHash, started: performance.now(), resolve };
      slot.state = 'busy';
      slot.job = job;
      job.timer = setTimeout(() => this.stop(slot, 'validation-timeout'), this.timeoutMs);
      slot.child.send(
        {
          type: 'job',
          id: job.id,
          hash: job.hash,
          body,
          validatorHash: this.validatorHash,
          generation: slot.generation,
        },
        (error) => {
          if (error && slot.job === job) this.stop(slot, 'worker-unavailable');
        }
      );
    });
  }
  async waitReady(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (!this.health().ready) {
      if (this.closed || this.slots.some((s) => s.state === 'failed') || Date.now() > deadline)
        throw new Error('pool-not-ready');
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  async drain() {
    if (this.drainPromise) return this.drainPromise;
    this.closed = true;
    this.drainPromise = (async () => {
      const waits = [];
      for (const slot of this.slots) {
        clearTimeout(slot.restartTimer);
        clearTimeout(slot.startTimer);
        this.finishFailure(slot, 'draining');
        const child = slot.child;
        if (child) {
          waits.push(new Promise((resolve) => child.once('close', resolve)));
          slot.state = 'stopping';
          if (!child.killed) child.kill('SIGKILL');
        } else slot.state = 'closed';
      }
      await Promise.all(waits);
      rmSync(this.cwd, { recursive: true, force: true });
    })();
    return this.drainPromise;
  }
}
