import { Store } from './sqlite-store.mjs';

const store = new Store(process.argv[2]);
process.on('message', (message) => {
  try {
    message.payload = Buffer.from(message.payload);
    process.send({ result: store.append(message) });
  } catch (error) {
    process.send({ error: error.message, code: error.code });
  }
});
process.send({ ready: true });
