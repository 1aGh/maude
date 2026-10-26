#!/usr/bin/env node
import { createRequire } from 'node:module';
// scripts/v2-perf-peers.mjs — simulated co-presence for V2-8.14 ("12-person presence").
//
//   node scripts/v2-perf-peers.mjs --port 4831 --slug ui-c12 [--peers 11] [--hz 15] [--secs 120]
//
// Joins the canvas's collab room (`/_ws/collab/<slug>`, the y-websocket protocol the studio itself
// speaks, DDR-054 same-origin handshake) with N extra clients. Each one publishes the awareness
// state a real person's tab does — name, colour, a moving cursor, a viewport, a selection and an
// annotation gesture now and then — at --hz updates a second, so the person measuring sees twelve
// people (11 here + them). Pure wire traffic: no document edits, nothing is stored. Stops after
// --secs or on SIGTERM; prints `PEERS <n>` once every peer is connected.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(join(HERE, '..', 'apps', 'studio', 'package.json'));
const WebSocket = req('ws');
const Y = req('yjs');
const encoding = req('lib0/encoding');
const { Awareness, encodeAwarenessUpdate } = req('y-protocols/awareness');

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const port = Number(opt('--port', '4399'));
const slug = opt('--slug', '');
const N = Number(opt('--peers', '11'));
const HZ = Number(opt('--hz', '15'));
const SECS = Number(opt('--secs', '120'));
if (!slug) {
  console.error('usage: v2-perf-peers.mjs --port <n> --slug <canvas-slug> [--peers 11] [--hz 15]');
  process.exit(2);
}
const NAMES = [
  'Jonas',
  'Vojta',
  'Eli',
  'Tereza',
  'Matej',
  'Anna',
  'Petr',
  'Klara',
  'Ondra',
  'Sam',
  'Lucie',
];
const COLORS = [
  '#e5484d',
  '#3e63dd',
  '#30a46c',
  '#f5a524',
  '#8e4ec6',
  '#12a594',
  '#e93d82',
  '#0090ff',
];

const peers = [];
let connected = 0;
for (let i = 0; i < N; i++) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/_ws/collab/${slug}`, {
    headers: { Origin: `http://127.0.0.1:${port}` },
  });
  ws.binaryType = 'arraybuffer';
  const peer = { doc, awareness, ws, t: Math.random() * 1000, i };
  const state = () => {
    const t = peer.t;
    return {
      name: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''}`,
      color: COLORS[i % COLORS.length],
      cursor: { x: 800 + 700 * Math.sin(t / 700 + i), y: 500 + 400 * Math.cos(t / 900 + i * 2) },
      selection: null,
      annotationSelection: [],
      annotationGesture: null,
      viewport: { x: 100 * i, y: 40 * i, zoom: 0.5 + 0.05 * (i % 6) },
    };
  };
  peer.publish = () => {
    peer.t += 1000 / HZ;
    awareness.setLocalState(state());
    if (ws.readyState !== 1) return;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, 1 /* MESSAGE_AWARENESS */);
    encoding.writeVarUint8Array(e, encodeAwarenessUpdate(awareness, [doc.clientID]));
    ws.send(encoding.toUint8Array(e));
  };
  ws.on('open', () => {
    connected++;
    if (connected === N) console.log(`PEERS ${N}`);
  });
  ws.on('error', (err) => console.error(`peer ${i}: ${err.message}`));
  peers.push(peer);
}
const timer = setInterval(() => {
  for (const p of peers) p.publish();
}, 1000 / HZ);
const stop = () => {
  clearInterval(timer);
  for (const p of peers) {
    p.awareness.setLocalState(null);
    try {
      p.ws.close();
    } catch {}
  }
  setTimeout(() => process.exit(0), 300);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
setTimeout(stop, SECS * 1000);
