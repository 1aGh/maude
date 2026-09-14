import { createHash } from 'node:crypto';
export const sha = (value) => createHash('sha256').update(value).digest('hex');
