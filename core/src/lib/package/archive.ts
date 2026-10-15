/* The ONE way core reads a .pdpkg's bytes. Walks the zip's central directory
 * itself before JSZip sees it, because JSZip silently tolerates things a
 * verifier must not: bytes prepended to the archive (it adjusts offsets),
 * central records past the declared count, a second record of one name (it
 * keeps the last), and `..` in a name (it rewrites it). Every refusal here is a
 * PackageVerificationError. Ported from prompd-web's sidecar workflow intake
 * (packages/sidecar/src/workflows/packageIntake.ts), which stays as is. */
import JSZip from 'jszip';
import { PackageVerificationError } from './errors';

export const ARCHIVE_LIMITS = {
  maxEntries: 2000,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
  maxRatio: 100,
  maxNameLength: 512,
  maxSegments: 24,
} as const;

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_LEN = 22;
const CENTRAL_LEN = 46;
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/i;
const NOT_A_ZIP = 'the package is not a readable zip';

interface CentralRecord { name: string; compressed: number; uncompressed: number; folder: boolean }

/** JSZip's typings omit the streaming reader its objects have at runtime. */
type StreamableEntry = JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> };

function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

/** A name safe to echo in a message. */
function shown(name: string): string {
  if (hasControl(name)) return 'a file name in the package';
  return name.length > ARCHIVE_LIMITS.maxNameLength ? `${name.slice(0, ARCHIVE_LIMITS.maxNameLength)}...` : name;
}

/** Why one entry name may not be written, or null. Judged on the name alone. */
export function entryNameProblem(name: string): string | null {
  if (hasControl(name)) return 'a file name in the package holds a control character';
  if (!name) return 'a file in the package has no name';
  if (name.length > ARCHIVE_LIMITS.maxNameLength) return `a file name in the package is too long (over ${ARCHIVE_LIMITS.maxNameLength} characters)`;
  if (name.includes('\\')) return `${name} uses a backslash; package paths use forward slashes`;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return `${name} is an absolute path`;
  const segs = name.split('/');
  if (segs.some((s) => s === '..' || s === '.' || s === '')) return `${name} has an empty, "." or ".." segment`;
  if (name.includes(':')) return `${name} holds a colon`;
  if (segs.length > ARCHIVE_LIMITS.maxSegments) return `${name} is nested too deeply`;
  for (const s of segs) {
    if (s.endsWith('.') || s.endsWith(' ')) return `${name} has a part that ends with a dot or a space`;
    const stem = s.split('.')[0]?.replace(/ +$/, '') ?? '';
    if (WINDOWS_DEVICE_RE.test(stem)) return `${name} uses a device name Windows has reserved`;
  }
  if (name !== name.normalize('NFC')) return `${name} is not in normalized (NFC) form`;
  return null;
}

function u16(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
}
function u32(b: Uint8Array, at: number): number {
  return u16(b, at) + u16(b, at + 2) * 0x10000;
}

const nameDecoder = new TextDecoder('utf-8', { fatal: true });

function scanCentralDirectory(raw: Uint8Array): CentralRecord[] {
  const lowest = Math.max(0, raw.length - EOCD_LEN - 0xffff);
  let eocd = -1;
  for (let i = raw.length - EOCD_LEN; i >= lowest; i--) {
    if (u32(raw, i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new PackageVerificationError('ARCHIVE_INVALID', NOT_A_ZIP);
  const count = u16(raw, eocd + 10);
  const size = u32(raw, eocd + 12);
  const offset = u32(raw, eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new PackageVerificationError('ARCHIVE_INVALID', 'the package is a zip64 archive, which a package never needs');
  }
  if (u16(raw, eocd + 4) !== 0 || u16(raw, eocd + 6) !== 0 || u16(raw, eocd + 8) !== count) {
    throw new PackageVerificationError('ARCHIVE_INVALID', NOT_A_ZIP);
  }
  if (count > ARCHIVE_LIMITS.maxEntries) {
    throw new PackageVerificationError('TOO_LARGE', `the package holds too many files (over ${ARCHIVE_LIMITS.maxEntries})`);
  }
  if (offset + size !== eocd) throw new PackageVerificationError('ARCHIVE_INVALID', NOT_A_ZIP);
  const out: CentralRecord[] = [];
  let total = 0;
  let at = offset;
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_LEN > eocd || u32(raw, at) !== CENTRAL_SIG) throw new PackageVerificationError('ARCHIVE_INVALID', NOT_A_ZIP);
    const compressed = u32(raw, at + 20);
    const uncompressed = u32(raw, at + 24);
    const nameLen = u16(raw, at + 28);
    const next = at + CENTRAL_LEN + nameLen + u16(raw, at + 30) + u16(raw, at + 32);
    if (next > eocd) throw new PackageVerificationError('ARCHIVE_INVALID', NOT_A_ZIP);
    let name: string;
    try { name = nameDecoder.decode(raw.subarray(at + CENTRAL_LEN, at + CENTRAL_LEN + nameLen)); }
    catch { throw new PackageVerificationError('ARCHIVE_INVALID', 'a file name in the package is not UTF-8'); }
    const external = u32(raw, at + 38);
    if (((Math.floor(external / 0x10000)) & 0xf000) === 0xa000) {
      throw new PackageVerificationError('UNSAFE_PATH', `${shown(name)} is a link`, name);
    }
    const folder = (external & 0x10) !== 0 || name.endsWith('/');
    if (folder && uncompressed !== 0) throw new PackageVerificationError('ARCHIVE_INVALID', `${shown(name)} is marked as a folder but holds data`, name);
    if (!folder) {
      if (uncompressed > ARCHIVE_LIMITS.maxFileBytes) throw new PackageVerificationError('TOO_LARGE', `${shown(name)} is over ${ARCHIVE_LIMITS.maxFileBytes} bytes`, name);
      if (uncompressed > 0 && compressed === 0) throw new PackageVerificationError('ARCHIVE_INVALID', NOT_A_ZIP, name);
      if (compressed > 0 && uncompressed / compressed > ARCHIVE_LIMITS.maxRatio) {
        throw new PackageVerificationError('TOO_LARGE', `${shown(name)} compresses more than ${ARCHIVE_LIMITS.maxRatio}:1`, name);
      }
      total += uncompressed;
      if (total > ARCHIVE_LIMITS.maxTotalBytes) throw new PackageVerificationError('TOO_LARGE', `the package is over ${ARCHIVE_LIMITS.maxTotalBytes} bytes unpacked`);
    }
    out.push({ name, compressed, uncompressed, folder });
    at = next;
  }
  if (at !== offset + size) throw new PackageVerificationError('ARCHIVE_INVALID', NOT_A_ZIP);
  return out;
}

function checkNames(records: readonly CentralRecord[]): void {
  const keys = new Set<string>();
  const files = records.filter((r) => !r.folder);
  for (const r of files) {
    const problem = entryNameProblem(r.name);
    if (problem) throw new PackageVerificationError('UNSAFE_PATH', problem, r.name);
    const key = r.name.toLowerCase();
    if (keys.has(key)) throw new PackageVerificationError('UNSAFE_PATH', `the package holds two entries with the same name (${r.name})`, r.name);
    keys.add(key);
  }
  for (const r of files) {
    const segs = r.name.toLowerCase().split('/');
    for (let i = 1; i < segs.length; i++) {
      const parent = segs.slice(0, i).join('/');
      if (keys.has(parent)) throw new PackageVerificationError('UNSAFE_PATH', `${r.name} uses ${parent} as a folder, but it is a file`, r.name);
    }
  }
}

/** Inflate one entry; refuse the moment the declared size is exceeded (a lying header). */
function inflateOne(entry: StreamableEntry, limit: number, state: { total: number }): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolveBytes, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let settled = false;
    const stream = entry.internalStream('uint8array');
    const fail = (e: Error) => { if (!settled) { settled = true; stream.pause(); reject(e); } };
    stream.on('data', (chunk: Uint8Array) => {
      if (settled) return;
      size += chunk.length;
      state.total += chunk.length;
      if (size > limit || size > ARCHIVE_LIMITS.maxFileBytes) { fail(new PackageVerificationError('TOO_LARGE', `${shown(entry.name)} is larger than its header says`, entry.name)); return; }
      if (state.total > ARCHIVE_LIMITS.maxTotalBytes) { fail(new PackageVerificationError('TOO_LARGE', `the package is over ${ARCHIVE_LIMITS.maxTotalBytes} bytes unpacked`)); return; }
      chunks.push(chunk);
    });
    stream.on('error', (e: Error) => fail(new PackageVerificationError('ARCHIVE_INVALID', `${shown(entry.name)} could not be unpacked: ${e.message}`, entry.name)));
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      const out = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.length; }
      resolveBytes(out);
    });
    stream.resume();
  });
}

export async function readArchive(raw: Uint8Array): Promise<Map<string, Uint8Array>> {
  const records = scanCentralDirectory(raw);
  checkNames(records);
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(raw, { createFolders: false }); }
  catch { throw new PackageVerificationError('ARCHIVE_INVALID', NOT_A_ZIP); }
  const all = Object.values(zip.files);
  if (all.length !== records.length) throw new PackageVerificationError('ARCHIVE_INVALID', 'the package holds two entries with the same name');
  const declared = new Map(records.map((r) => [r.name, r.uncompressed]));
  const out = new Map<string, Uint8Array>();
  const state = { total: 0 };
  for (const entry of all) {
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    if (original !== entry.name || !declared.has(original)) {
      throw new PackageVerificationError('UNSAFE_PATH', `${shown(original)} is not a plain path inside the package`, original);
    }
    if (entry.dir) continue;
    out.set(entry.name, await inflateOne(entry as StreamableEntry, declared.get(entry.name) ?? 0, state));
  }
  return out;
}
