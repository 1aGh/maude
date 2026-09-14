import { start } from './server.mjs';

const server = await start(process.argv[2]);
process.send({ ws: server.ws, http: server.http });
