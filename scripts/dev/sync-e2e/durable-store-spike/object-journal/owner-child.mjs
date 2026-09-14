import { writeFileSync } from 'node:fs';
import { ObjectJournal } from './journal.mjs';

let active = false;
let resume;
// Keep the isolated owner alive at checkpoints until the parent resumes/kills it.
process.on('message', async (message) => {
  if (message.resume) {
    resume?.();
    return;
  }
  if (active) return;
  active = true;
  const { cfg, prefix, project, ownerEpoch, actor, raw, stopAt, operation } = message;
  const journal = new ObjectJournal({
    cfg,
    prefix,
    project,
    ownerEpoch,
    checkpoint: async (stage) => {
      if (stage !== stopAt) return;
      process.send({ stage, pid: process.pid });
      await new Promise((resolve) => {
        resume = resolve;
      });
    },
  });
  try {
    const result =
      operation === 'snapshot' ? await journal.snapshot() : await journal.append(actor, raw);
    writeFileSync('ack.json', JSON.stringify(result));
    process.send({ result });
  } catch (error) {
    process.send({ error: String(error) });
  }
});
process.send({ ready: true, pid: process.pid });
