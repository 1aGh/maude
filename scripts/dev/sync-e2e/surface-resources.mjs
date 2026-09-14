import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export function ownedProcesses(text, ownerPid) {
  const processes = text.split('\n').flatMap((line) => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    return m
      ? [
          {
            pid: Number(m[1]),
            parentPid: Number(m[2]),
            cpuPercent: Number(m[3]),
            rssKiB: Number(m[4]),
            executable: basename(m[5]),
          },
        ]
      : [];
  });
  const owned = new Set([ownerPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of processes)
      if (owned.has(p.parentPid) && !owned.has(p.pid)) {
        owned.add(p.pid);
        changed = true;
      }
  }
  return processes.filter((p) => owned.has(p.pid));
}
export async function sampleResources(ownerPid) {
  const start = performance.now();
  const { stdout } = await exec('ps', ['-axo', 'pid,ppid,pcpu,rss,comm'], { timeout: 3000 });
  return {
    capturedAt: new Date().toISOString(),
    captureMs: performance.now() - start,
    ownerPid,
    processes: ownedProcesses(stdout, ownerPid),
    host: {
      cores: cpus().length,
      loadAverage: loadavg(),
      freeBytes: freemem(),
      totalBytes: totalmem(),
    },
    limitations:
      'Process CPU is ps lifetime average; RSS is not unique memory. OS-owned WKWebView services outside this ancestry and application queues are not measured. Host free memory is not memory pressure.',
  };
}
export function startResourceSampler(out, ownerPid = process.pid) {
  let running = null;
  let stopped = false;
  const capture = () => {
    if (stopped || running) return;
    running = sampleResources(ownerPid)
      .then((sample) =>
        appendFileSync(join(out, 'resource-samples.jsonl'), `${JSON.stringify(sample)}\n`)
      )
      .catch((error) =>
        appendFileSync(
          join(out, 'resource-samples.jsonl'),
          `${JSON.stringify({ capturedAt: new Date().toISOString(), error: String(error) })}\n`
        )
      )
      .finally(() => {
        running = null;
      });
  };
  capture();
  const timer = setInterval(capture, 5000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
