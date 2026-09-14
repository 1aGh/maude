import { createServer } from 'node:http';
import { DOC, Kernel } from './candidate-kernel.mjs';
import { decoding as d, encoding as e, Server, Y } from './deps.mjs';
export function packet(name, type, payload, syncKind) {
  const encoder = e.createEncoder();
  e.writeVarString(encoder, name);
  e.writeVarUint(encoder, type);
  if (syncKind !== undefined) e.writeVarUint(encoder, syncKind);
  e.writeVarUint8Array(encoder, payload);
  return e.toUint8Array(encoder);
}
export async function start(root) {
  const actors = new Map([
    ['writer', { id: 'alice', role: 'designer' }],
    ['reader', { id: 'bob', role: 'reader' }],
    ['loopback', { id: 'service', role: 'designer' }],
  ]);
  const seen = [];
  let accepted;
  const kernel = new Kernel(root, (source, revision) => {
    if (!accepted) return;
    accepted.transact(() => {
      const text = accepted.getText('source');
      text.delete(0, text.length);
      text.insert(0, source);
      accepted.getMap('head').set('revision', revision);
    }, 'accepted-replayer');
  });
  const server = new Server({
    port: 0,
    address: '127.0.0.1',
    quiet: true,
    stopOnSignals: false,
    debounce: 1,
    maxDebounce: 1,
    async onAuthenticate({ token, documentName, connectionConfig }) {
      if (documentName !== DOC || !actors.has(token)) throw new Error('forbidden');
      connectionConfig.readOnly = true;
      return { token, epoch: kernel.state.epoch };
    },
    async onLoadDocument({ document, documentName }) {
      if (documentName !== DOC) throw new Error('forbidden');
      document.getText('source').insert(0, kernel.state.source);
      document.getMap('head').set('revision', kernel.state.revision);
      accepted = document;
    },
    async beforeHandleMessage({ connection, context, update }) {
      // Defense for every existing socket; no loopback exception.
      connection.readOnly = true;
      if (!actors.has(context.token) || context.epoch !== kernel.state.epoch)
        throw new Error('membership-or-epoch-stale');
      const decoder = d.createDecoder(update);
      d.readVarString(decoder);
      const type = d.readVarUint(decoder);
      if (type === 0 || type === 4) {
        const subtype = d.readVarUint(decoder);
        seen.push({ token: context.token, type, subtype });
      }
      if (type === 1) {
        const bytes = d.readVarUint8Array(decoder);
        if (bytes.length > 2048) throw new Error('awareness-capacity');
        const payload = d.createDecoder(bytes);
        const count = d.readVarUint(payload);
        if (count > 8) throw new Error('awareness-capacity');
        for (let i = 0; i < count; i++) {
          d.readVarUint(payload);
          d.readVarUint(payload);
          const state = JSON.parse(d.readVarString(payload));
          if (
            state !== null &&
            (Object.keys(state).some((k) => k !== 'cursor') ||
              (state.cursor !== undefined &&
                (!Array.isArray(state.cursor) ||
                  state.cursor.length !== 2 ||
                  state.cursor.some((v) => !Number.isFinite(v)))))
          )
            throw new Error('awareness-schema');
        }
      }
    },
  });
  await server.listen();
  const http = createServer(async (req, res) => {
    const actor = actors.get(req.headers.authorization?.replace(/^Bearer /, ''));
    if (!actor || req.method !== 'POST' || req.url !== '/proposals') {
      res.writeHead(403);
      res.end();
      return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024 * 1024) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const result = kernel.propose(actor, Buffer.concat(chunks));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  return {
    kernel,
    actors,
    seen,
    server,
    get accepted() {
      return accepted;
    },
    ws: `ws://127.0.0.1:${server.httpServer.address().port}`,
    http: `http://127.0.0.1:${http.address().port}`,
    async close() {
      await new Promise((resolve) => http.close(resolve));
      await server.destroy();
    },
  };
}
