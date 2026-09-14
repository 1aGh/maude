import { HocuspocusProvider } from '@hocuspocus/provider';
import * as e from 'lib0/encoding';
import * as Y from 'yjs';

const config = await (await fetch('/config')).json();
const params = new URLSearchParams(location.search);
const role = params.get('role') || 'writer';
const accepted = new Y.Doc();
let optimistic = new Y.Doc();
const provider = new HocuspocusProvider({
  url: config.ws,
  name: config.document,
  token: role,
  document: accepted,
});
const $ = (id) => document.getElementById(id);
const b64 = (bytes) => btoa(Array.from(bytes, (x) => String.fromCharCode(x)).join(''));
const bytes = (b64) => Uint8Array.from(atob(b64), (x) => x.charCodeAt(0));
const hash = async (value) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (v) => v.toString(16).padStart(2, '0')
  ).join('');
function text(doc) {
  return doc.getText('source').toString();
}
function replace(doc, value) {
  let update;
  doc.once('update', (u) => (update = u));
  doc.transact(() => {
    const t = doc.getText('source');
    t.delete(0, t.length);
    t.insert(0, value);
  });
  return update;
}
const db = await new Promise((resolve, reject) => {
  const r = indexedDB.open('maude-t7-browser', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('candidates', { keyPath: 'key' });
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const partition = `p:${role}:device-browser:`;
async function list() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('candidates', 'readonly');
    const r = tx.objectStore('candidates').getAll();
    r.onsuccess = () => resolve(r.result.filter((v) => v.key.startsWith(partition)));
    r.onerror = () => reject(r.error);
  });
}
async function retain(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('candidates', 'readwrite');
    let failure;
    tx.oncomplete = resolve;
    tx.onerror = () => {
      failure ||= tx.error;
    };
    tx.onabort = () =>
      reject(failure || tx.error || new DOMException('Candidate storage aborted', 'AbortError'));
    const store = tx.objectStore('candidates');
    const r = store.get(record.key);
    r.onsuccess = () => {
      if (r.result && JSON.stringify(r.result) !== JSON.stringify(record)) {
        failure = new Error('immutable-candidate');
        tx.abort();
        return;
      }
      store.put(record);
      // Fault injection occurs inside a REAL IndexedDB transaction after put was scheduled.
      // The quota name is injected; this does not claim real disk exhaustion.
      if (window.spike.storageFault) {
        failure = new DOMException(
          'Injected persistent-storage failure',
          window.spike.storageFault
        );
        tx.abort();
      }
    };
  });
}
const state = {
  ready: false,
  status: 'Loading',
  lastResult: null,
  submitted: 0,
  acceptedUpdates: 0,
  storageFault: null,
};
function render() {
  $('accepted').textContent = text(accepted);
  $('candidate').textContent = text(optimistic);
  $('status').textContent = state.status;
}
accepted.on('update', () => {
  state.acceptedUpdates++;
  render();
});
async function requestFor(id, source, dependsOn = []) {
  const base = text(accepted);
  const h = await hash(base);
  return JSON.stringify({
    protocol: 1,
    projectId: 'p',
    epoch: 1,
    transactionId: id,
    base: { revision: accepted.getMap('head').get('revision'), manifestHash: h },
    dependsOn,
    action: {
      kind: 'source.replace',
      operations: [
        { kind: 'source.replace', documentId: 'd', generation: 1, expectedHash: h, source },
      ],
    },
  });
}
async function submitRequest(request) {
  state.submitted++;
  const result = await (
    await fetch('/proposals', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + role },
      body: request,
    })
  ).json();
  state.lastResult = result;
  state.status =
    result.status === 'accepted'
      ? 'Accepted revision ' + result.revision
      : 'Saved locally; ' + result.code;
  render();
  return result;
}
async function create(id, source, dependsOn = []) {
  const update = replace(optimistic, source);
  state.status = 'Saving locally';
  render();
  const record = {
    key: partition + id,
    id,
    request: await requestFor(id, source, dependsOn),
    snapshot: b64(Y.encodeStateAsUpdate(optimistic)),
    update: b64(update),
    createdAt: Date.now(),
  };
  try {
    await retain(record);
  } catch (error) {
    state.status = 'Unsaved: ' + error.name;
    state.lastResult = null;
    render();
    return { unsaved: true, error: error.name };
  }
  state.status = 'Saved locally';
  render();
  return submitRequest(record.request);
}
window.spike = {
  get state() {
    return {
      ...state,
      accepted: text(accepted),
      candidate: text(optimistic),
      revision: accepted.getMap('head').get('revision'),
      clientId: accepted.clientID,
    };
  },
  get storageFault() {
    return state.storageFault;
  },
  set storageFault(v) {
    state.storageFault = v;
  },
  list,
  create,
  async retry(id) {
    const record = (await list()).find((v) => v.id === id);
    if (!record) throw new Error('candidate-missing');
    return submitRequest(record.request);
  },
  async restore(id) {
    const record = (await list()).find((v) => v.id === id);
    if (!record) throw new Error('candidate-missing');
    optimistic.destroy();
    optimistic = new Y.Doc();
    Y.applyUpdate(optimistic, bytes(record.snapshot));
    render();
    return text(optimistic);
  },
  raw(type, kind, value) {
    const malicious = new Y.Doc();
    replace(malicious, value);
    const encoder = e.createEncoder();
    e.writeVarString(encoder, config.document);
    e.writeVarUint(encoder, type);
    e.writeVarUint(encoder, kind);
    e.writeVarUint8Array(encoder, Y.encodeStateAsUpdate(malicious));
    provider.configuration.websocketProvider.webSocket.send(e.toUint8Array(encoder));
    malicious.destroy();
  },
  cursor(value) {
    provider.awareness.setLocalState({ cursor: [value, role.length] });
  },
  awareness() {
    return Array.from(provider.awareness.getStates().entries());
  },
  async poisonedHandshake() {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(accepted));
    replace(doc, 'REJECTED_BROWSER_HANDSHAKE');
    const p = new HocuspocusProvider({
      url: config.ws,
      name: config.document,
      token: role,
      document: doc,
    });
    window.spike.poison = { id: doc.clientID, p, doc };
    return doc.clientID;
  },
  poisonCursor(value) {
    window.spike.poison.p.awareness.setLocalState({ cursor: [value, 1] });
  },
  async destroyPoison() {
    window.spike.poison.p.destroy();
    window.spike.poison.doc.destroy();
  },
};
$('save').onclick = () =>
  create($('transaction').value, $('source').value, $('depends').value.split(',').filter(Boolean));
$('retry').onclick = () => window.spike.retry($('transaction').value);
$('restore').onclick = () => window.spike.restore($('transaction').value);
await new Promise((resolve) => {
  if (provider.isSynced) resolve();
  else provider.on('synced', resolve);
});
Y.applyUpdate(optimistic, Y.encodeStateAsUpdate(accepted));
const records = await list();
if (records.length) {
  const latest = records.sort((a, b) => a.createdAt - b.createdAt).at(-1);
  optimistic.destroy();
  optimistic = new Y.Doc();
  Y.applyUpdate(optimistic, bytes(latest.snapshot));
  $('transaction').value = latest.id;
  state.status = 'Saved locally; pending result';
} else state.status = 'Ready';
$('source').value = text(optimistic);
state.ready = true;
render();
