/** sha256 through WebCrypto: present in browsers and in Node 20+, so core keeps
 * no Node import. */
export const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error('WebCrypto (crypto.subtle) is not available in this runtime; Node 20 or later is required.');
  return c.subtle;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await subtle().digest('SHA-256', bytes as BufferSource);
  const out = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < out.length; i++) hex += out[i].toString(16).padStart(2, '0');
  return hex;
}

export async function archiveDigest(bytes: Uint8Array): Promise<string> {
  return `sha256:${await sha256Hex(bytes)}`;
}
