/**
 * Browser shim for Node.js crypto module.
 * Re-exports the Web Crypto API's randomUUID which is available in modern browsers.
 */

export function randomUUID(): string {
  return crypto.randomUUID();
}

export default { randomUUID };
