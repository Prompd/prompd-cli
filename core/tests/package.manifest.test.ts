import { parseManifest, unscopedName, PACKAGE_NAME_RE } from '../src/lib/package/manifest';
import { PackageVerificationError } from '../src/lib/package/errors';

const enc = (o: unknown) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));
function codeOf(f: () => unknown): string {
  try { f(); return 'ok'; } catch (e) { return e instanceof PackageVerificationError ? e.code : `other: ${String(e)}`; }
}

describe('parseManifest', () => {
  it('parses a valid manifest and defaults type to package', () => {
    const m = parseManifest(enc({ name: '@a/x', version: '1.2.0' }));
    expect(m.name).toBe('@a/x');
    expect(m.version).toBe('1.2.0');
    expect(m.type).toBe('package');
  });

  it('keeps agent and skill types', () => {
    expect(parseManifest(enc({ name: '@a/x', version: '1.0.0', type: 'agent' })).type).toBe('agent');
    expect(parseManifest(enc({ name: '@a/x', version: '1.0.0', type: 'skill' })).type).toBe('skill');
  });

  it.each([
    ['not json', '{', 'MANIFEST_INVALID'],
    ['not an object', [], 'MANIFEST_INVALID'],
    ['unscoped name', { name: 'x', version: '1.0.0' }, 'MANIFEST_INVALID'],
    ['dot-only name', { name: '@a/..', version: '1.0.0' }, 'MANIFEST_INVALID'],
    ['dot-only scope', { name: '@./x', version: '1.0.0' }, 'MANIFEST_INVALID'],
    ['range as version', { name: '@a/x', version: '^1.0.0' }, 'MANIFEST_INVALID'],
    ['removed type', { name: '@a/x', version: '1.0.0', type: 'node-template' }, 'TYPE_INVALID'],
    ['unknown type', { name: '@a/x', version: '1.0.0', type: 'plugin' }, 'TYPE_INVALID'],
    ['bad dependency name', { name: '@a/x', version: '1.0.0', dependencies: { 'y': '1.0.0' } }, 'MANIFEST_INVALID'],
    ['bad dependency range', { name: '@a/x', version: '1.0.0', dependencies: { '@a/y': 'nope nope' } }, 'MANIFEST_INVALID'],
    ['requires.mcp not strings', { name: '@a/x', version: '1.0.0', requires: { mcp: [1] } }, 'MANIFEST_INVALID'],
  ])('refuses %s', (_label, input, code) => {
    expect(codeOf(() => parseManifest(enc(input)))).toBe(code);
  });

  it('refuses invalid UTF-8', () => {
    expect(codeOf(() => parseManifest(new Uint8Array([0x7b, 0xff, 0x7d])))).toBe('MANIFEST_INVALID');
  });

  it('drops prototype keys', () => {
    const m = parseManifest(enc('{"name":"@a/x","version":"1.0.0","__proto__":{"polluted":true},"constructor":1}'));
    expect(Object.prototype.hasOwnProperty.call(m, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(m, 'constructor')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('unscopedName', () => {
  it('drops the scope', () => {
    expect(unscopedName('@acme/pr-review-skill')).toBe('pr-review-skill');
    expect(PACKAGE_NAME_RE.test('@acme/pr-review-skill')).toBe(true);
  });
});
