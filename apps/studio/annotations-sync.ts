/**
 * Write/action ids travel with annotation writes as echo metadata (DDR-242:
 * the replica's `~action`), never as authorization or a durable ACK.
 */
export function validAnnotationWriteId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
}
