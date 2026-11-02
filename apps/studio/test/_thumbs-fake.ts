// A scripted renderer for the thumbnail tests (V2-2.17): answers `render` ops with whatever bytes
// the test hands it, so the service's validation and storage can be tested without a browser.
import type { ShimHandle } from '../thumbs/service.ts';

/** A structurally valid baseline JPEG of w × h (SOI, SOF0, SOS, EOI) — enough for `checkJpeg`. */
export function fakeJpeg(w: number, h: number, pad = 0): Uint8Array {
  const head = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff];
  const comps = [0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  return Uint8Array.from([...head, ...comps, ...sos, ...new Array(pad + 2).fill(0), 0xff, 0xd9]);
}

export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

export type Answer = (msg: Record<string, unknown>) => Record<string, unknown>;

export function fakeShim(answer: Answer): {
  handle: () => ShimHandle;
  sent: Record<string, unknown>[];
} {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    handle: () => {
      const listeners: Array<(m: Record<string, unknown>) => void> = [];
      return {
        send(msg) {
          sent.push(msg);
          const reply = { id: msg.id, ...answer(msg) };
          queueMicrotask(() => {
            for (const cb of listeners) cb(reply);
          });
        },
        onMessage: (cb) => listeners.push(cb),
        exited: new Promise<number>(() => {}),
        kill() {},
      };
    },
  };
}

export const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
