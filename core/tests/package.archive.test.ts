import JSZip from 'jszip';
import { readArchive, entryNameProblem, ARCHIVE_LIMITS } from '../src/lib/package/archive';
import { PackageVerificationError } from '../src/lib/package/errors';

async function zipOf(entries: Record<string, string | Uint8Array>, opts: { unixPermissions?: Record<string, number> } = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    const perm = opts.unixPermissions?.[name];
    zip.file(name, content, perm !== undefined ? { unixPermissions: perm } : {});
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', platform: opts.unixPermissions ? 'UNIX' : 'DOS' });
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'ok'; } catch (e) { return e instanceof PackageVerificationError ? e.code : `other: ${String(e)}`; }
}

describe('entryNameProblem', () => {
  it.each([
    ['a/../b.md'], ['./a.md'], ['a//b.md'], ['/abs.md'], ['C:/x.md'], ['a\\b.md'], ['a:b.md'],
    ['con.md'], ['dir/LPT1.txt'], ['trailing.'], ['space '], [''], ['bad\u0001name'],
  ])('refuses %j', (name) => {
    expect(entryNameProblem(name)).not.toBeNull();
  });

  it('accepts ordinary nested posix names', () => {
    expect(entryNameProblem('skills/foo/SKILL.md')).toBeNull();
    expect(entryNameProblem('prompd.json')).toBeNull();
  });

  it('refuses names past the depth and length limits', () => {
    expect(entryNameProblem(Array.from({ length: ARCHIVE_LIMITS.maxSegments + 1 }, () => 'a').join('/'))).not.toBeNull();
    expect(entryNameProblem('a'.repeat(ARCHIVE_LIMITS.maxNameLength + 1))).not.toBeNull();
  });
});

describe('readArchive', () => {
  it('returns every file entry as raw bytes, binary included', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
    const files = await readArchive(await zipOf({ 'a.md': 'hello', 'img/x.png': png }));
    expect([...files.keys()].sort()).toEqual(['a.md', 'img/x.png']);
    expect(new TextDecoder().decode(files.get('a.md'))).toBe('hello');
    expect(files.get('img/x.png')).toEqual(png);
  });

  it('refuses bytes that are not a zip', async () => {
    expect(await codeOf(readArchive(new TextEncoder().encode('not a zip')))).toBe('ARCHIVE_INVALID');
  });

  it('refuses bytes prepended to a zip (central directory offset no longer matches)', async () => {
    const z = await zipOf({ 'a.md': 'x' });
    const shifted = new Uint8Array(z.length + 4);
    shifted.set([1, 2, 3, 4], 0);
    shifted.set(z, 4);
    expect(await codeOf(readArchive(shifted))).toBe('ARCHIVE_INVALID');
  });

  it('refuses a symlink entry', async () => {
    const z = await zipOf({ 'link': 'target' }, { unixPermissions: { link: 0o120777 } });
    expect(await codeOf(readArchive(z))).toBe('UNSAFE_PATH');
  });

  it('refuses two names that land on one file (case)', async () => {
    expect(await codeOf(readArchive(await zipOf({ 'A.md': '1', 'a.md': '2' })))).toBe('UNSAFE_PATH');
  });

  it('refuses a file used as a folder', async () => {
    expect(await codeOf(readArchive(await zipOf({ 'a': '1', 'a/b.md': '2' })))).toBe('UNSAFE_PATH');
  });

  it('refuses a name with a dot-dot segment', async () => {
    const zip = new JSZip();
    zip.file('ok.md', 'x');
    const raw = await zip.generateAsync({ type: 'uint8array' });
    // Rewrite "ok.md" to "../.m" in both the local and central headers (same length).
    const bad = raw.slice();
    const needle = new TextEncoder().encode('ok.md');
    const repl = new TextEncoder().encode('../.m');
    for (let i = 0; i + needle.length <= bad.length; i++) {
      if (needle.every((b, j) => bad[i + j] === b)) bad.set(repl, i);
    }
    expect(await codeOf(readArchive(bad))).toBe('UNSAFE_PATH');
  });

  it('refuses an entry past the per-file size cap', async () => {
    const big = new Uint8Array(ARCHIVE_LIMITS.maxFileBytes + 1);
    expect(await codeOf(readArchive(await zipOf({ 'big.bin': big })))).toBe('TOO_LARGE');
  });

  it('refuses a compression ratio over the cap', async () => {
    // 1 MB of zeros deflates to about 1 KB: ratio well over 100.
    const zeros = new Uint8Array(1024 * 1024);
    expect(await codeOf(readArchive(await zipOf({ 'zeros.bin': zeros })))).toBe('TOO_LARGE');
  });
});

describe('readArchive local header binding', () => {
  function le16(n: number): number[] { return [n & 0xff, (n >> 8) & 0xff]; }
  function le32(n: number): number[] { return [...le16(n & 0xffff), ...le16(Math.floor(n / 0x10000))]; }

  /* Hand-built one-entry stored zip ("a.md" holding "x"), so the local and central
   * extra fields can be set independently. The CRC is left zero: the checks under
   * test run before any inflate, and JSZip does not verify CRCs by default. */
  function handZip(localExtra: number[], centralExtra: number[]): Uint8Array {
    const name = [...new TextEncoder().encode('a.md')];
    const local = [...le32(0x04034b50), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(1), ...le32(1), ...le16(name.length), ...le16(localExtra.length), ...name, ...localExtra, 0x78];
    const central = [...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(1), ...le32(1), ...le16(name.length), ...le16(centralExtra.length), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(0), ...name, ...centralExtra];
    const eocd = [...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(1), ...le16(1), ...le32(central.length), ...le32(local.length), ...le16(0)];
    return new Uint8Array([...local, ...central, ...eocd]);
  }
  const UNICODE_PATH = [0x75, 0x70, 0x05, 0x00, 0x01, 0, 0, 0, 0];
  const OTHER_FIELD = [0x99, 0x99, 0x01, 0x00, 0x00];

  it('accepts the hand-built archive with an unrelated extra field (control)', async () => {
    const files = await readArchive(handZip(OTHER_FIELD, OTHER_FIELD));
    expect(new TextDecoder().decode(files.get('a.md'))).toBe('x');
  });

  it('refuses a Unicode Path extra field in the local header', async () => {
    expect(await codeOf(readArchive(handZip(UNICODE_PATH, [])))).toBe('UNSAFE_PATH');
  });

  it('refuses a Unicode Path extra field in the central record', async () => {
    expect(await codeOf(readArchive(handZip([], UNICODE_PATH)))).toBe('UNSAFE_PATH');
  });

  it('refuses local headers whose names were swapped (central directory intact)', async () => {
    const raw = (await zipOf({ 'a.md': 'safe', 'b.md': 'EVIL' })).slice();
    const locals: number[] = [];
    for (let i = 0; i + 4 <= raw.length; i++) {
      if (raw[i] === 0x50 && raw[i + 1] === 0x4b && raw[i + 2] === 3 && raw[i + 3] === 4) locals.push(i);
    }
    expect(locals).toHaveLength(2);
    const [first, second] = locals as [number, number];
    const nameAt = (l: number) => l + 30;
    const a = raw.slice(nameAt(first), nameAt(first) + 4);
    const b = raw.slice(nameAt(second), nameAt(second) + 4);
    raw.set(b, nameAt(first));
    raw.set(a, nameAt(second));
    expect(await codeOf(readArchive(raw))).toBe('ARCHIVE_INVALID');
  });
});
