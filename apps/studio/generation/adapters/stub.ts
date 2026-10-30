// generation/adapters/stub.ts — the test provider (S8.16). It makes no network call: each take is a
// small solid-colour PNG drawn here, in the asked aspect, whose colour comes from the prompt and the
// take number (so N takes are N different files and the same ask gives the same bytes again).
//
// Registered ONLY while `MAUDE_GENERATE_STUB=1` (generation/registry.ts) — the route tests and the
// desktop e2e (`generate-takes.e2e.ts`) run the whole Generate path against it, so no test ever calls
// a real provider or needs a key. It is local and billed to nobody (`auth: 'none'`, no `payer`).

import { deflateSync } from 'node:zlib';

import type {
  AdapterContext,
  GenRequest,
  GenResult,
  Job,
  ModelDescriptor,
  ProviderAdapter,
  ProviderDescriptor,
} from '../types.ts';

export const STUB_DESCRIPTOR: ProviderDescriptor = {
  id: 'stub',
  label: 'Test pictures',
  kind: 'local',
  auth: 'none',
  modalities: ['image'],
  notes: 'Draws solid test pictures on this Mac. Nothing is sent anywhere.',
  licence: 'Test pictures, free to use.',
};

export const STUB_MODELS: ModelDescriptor[] = [
  {
    id: 'stub-solid',
    label: 'Solid colour',
    modality: 'image',
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'],
    sync: true,
  },
];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A `w`×`h` PNG of one RGB colour. */
export function solidPng(w: number, h: number, rgb: [number, number, number]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = new Uint8Array(1 + w * 3);
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const raw = new Uint8Array(row.length * h);
  for (let y = 0; y < h; y++) raw.set(row, y * row.length);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The picture's size for an `W:H` aspect: the short side is 40 px. */
export function stubSize(aspect: string | undefined): { w: number; h: number } {
  const m = /^(\d{1,3}):(\d{1,3})$/.exec(aspect ?? '');
  const aw = m ? Number(m[1]) : 1;
  const ah = m ? Number(m[2]) : 1;
  if (!aw || !ah) return { w: 40, h: 40 };
  return aw <= ah
    ? { w: 40, h: Math.round((40 * ah) / aw) }
    : { w: Math.round((40 * aw) / ah), h: 40 };
}

function colourOf(seed: string): [number, number, number] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return [(h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff];
}

export function createStubAdapter(_ctx: AdapterContext): ProviderAdapter {
  return {
    descriptor: STUB_DESCRIPTOR,
    async submit(req: GenRequest): Promise<Job> {
      const take = Number((req.params as Record<string, unknown> | undefined)?.take ?? 0);
      const { w, h } = stubSize(req.aspectRatio);
      const bytes = solidPng(w, h, colourOf(`${req.prompt ?? ''}#${take}`));
      const result: GenResult = {
        assets: [{ kind: 'image', mime: 'image/png', bytes }],
        usage: { ms: 1 },
      };
      return {
        id: `stub_${take}`,
        status: () => 'done',
        async *events() {
          yield { status: 'done' as const };
        },
        result: async () => result,
        cancel: () => {},
      };
    },
  };
}
