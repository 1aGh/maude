#!/usr/bin/env node
// A TCP proxy that can take ONE participant offline (plan T31, surface row
// L20). The peer studio reaches the hub through it; the driver flips it:
//
//   POST /offline  — refuse new connections and cut every open one (a pulled
//                    cable, not a slow link: sockets die, reconnects fail)
//   POST /online   — accept again
//   GET  /state    — { offline, open }
//
//   node toggle-proxy.mjs <listenPort> <targetPort> <controlPort>

import { createServer as createHttpServer } from 'node:http';
import { connect, createServer } from 'node:net';

const [listenPort, targetPort, controlPort] = process.argv.slice(2).map(Number);
if (!listenPort || !targetPort || !controlPort) throw new Error('usage: toggle-proxy.mjs <listen> <target> <control>');

let offline = false;
const open = new Set();

createServer((client) => {
  if (offline) {
    client.destroy();
    return;
  }
  const upstream = connect(targetPort, '127.0.0.1');
  const pair = { client, upstream };
  open.add(pair);
  const close = () => {
    open.delete(pair);
    client.destroy();
    upstream.destroy();
  };
  client.on('error', close).on('close', close);
  upstream.on('error', close).on('close', close);
  client.pipe(upstream);
  upstream.pipe(client);
}).listen(listenPort, '127.0.0.1');

createHttpServer((req, res) => {
  if (req.method === 'POST' && req.url === '/offline') {
    offline = true;
    for (const { client, upstream } of open) {
      client.destroy();
      upstream.destroy();
    }
    open.clear();
  } else if (req.method === 'POST' && req.url === '/online') {
    offline = false;
  } else if (!(req.method === 'GET' && req.url === '/state')) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ offline, open: open.size }));
}).listen(controlPort, '127.0.0.1');
