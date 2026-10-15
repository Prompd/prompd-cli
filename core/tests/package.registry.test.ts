import { createRegistryDownloader, encodePackageName, type RegistryFetch } from '../src/lib/package/registry';

function fakeFetch(routes: Record<string, unknown>, calls: string[] = []): RegistryFetch {
  return async (url) => {
    calls.push(url);
    const body = routes[url];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer as ArrayBuffer,
    };
  };
}

const BASE = 'https://reg.test';

describe('createRegistryDownloader', () => {
  it('encodes scoped names segment by segment', () => {
    expect(encodePackageName('@acme/pr-review')).toBe('@acme/pr-review');
    expect(encodePackageName('@a.b/c-d')).toBe('@a.b/c-d');
  });

  it('refuses a name that is not a scoped package name', () => {
    expect(() => encodePackageName('@a/..')).toThrow('@a/..');
    expect(() => encodePackageName('plain')).toThrow('plain');
    expect(() => encodePackageName('@a b/c d')).toThrow('@a b/c d');
  });

  it('returns the normalized version for latest and downloads that one', async () => {
    const calls: string[] = [];
    const d = createRegistryDownloader({ baseUrl: BASE, fetch: fakeFetch({ [`${BASE}/packages/@a/x`]: { version: 'v1.4.0' }, [`${BASE}/packages/@a/x/download/1.4.0`]: 'zip' }, calls) });
    expect(await d.resolveVersion('@a/x', 'latest')).toBe('1.4.0');
    await d.download('@a/x', 'latest');
    expect(calls).toContain(`${BASE}/packages/@a/x/download/1.4.0`);
  });

  it('normalizes list entries and ignores junk ones', async () => {
    const d = createRegistryDownloader({ baseUrl: BASE, fetch: fakeFetch({ [`${BASE}/packages/@a/x/versions`]: ['junk', 'v1.2.0', { version: 'nope' }, 7, null, '1.1.0'] }) });
    expect(await d.resolveVersion('@a/x', '^1.0.0')).toBe('1.2.0');
  });

  it('throws No version when the list holds only junk', async () => {
    const d = createRegistryDownloader({ baseUrl: BASE, fetch: fakeFetch({ [`${BASE}/packages/@a/x/versions`]: ['junk', 'latest', 3] }) });
    await expect(d.resolveVersion('@a/x', '^1.0.0')).rejects.toThrow('No version');
  });

  it('resolves latest through package info (either response shape)', async () => {
    const d1 = createRegistryDownloader({ baseUrl: BASE, fetch: fakeFetch({ [`${BASE}/packages/@a/x`]: { version: '1.4.0' } }) });
    expect(await d1.resolveVersion('@a/x', 'latest')).toBe('1.4.0');
    const d2 = createRegistryDownloader({ baseUrl: BASE, fetch: fakeFetch({ [`${BASE}/packages/@a/x`]: { package: { version: '2.0.0' } } }) });
    expect(await d2.resolveVersion('@a/x', '')).toBe('2.0.0');
  });

  it('keeps an exact version without asking the registry', async () => {
    const calls: string[] = [];
    const d = createRegistryDownloader({ baseUrl: BASE, fetch: fakeFetch({}, calls) });
    expect(await d.resolveVersion('@a/x', '1.2.3')).toBe('1.2.3');
    expect(calls).toEqual([]);
  });

  it('resolves a range to the highest satisfying version (array and wrapped, string and object items)', async () => {
    const versions = [{ version: '1.2.0' }, '1.4.1', { version: '2.0.0' }];
    const d1 = createRegistryDownloader({ baseUrl: BASE, fetch: fakeFetch({ [`${BASE}/packages/@a/x/versions`]: versions }) });
    expect(await d1.resolveVersion('@a/x', '^1.2.0')).toBe('1.4.1');
    const d2 = createRegistryDownloader({ baseUrl: BASE, fetch: fakeFetch({ [`${BASE}/packages/@a/x/versions`]: { versions } }) });
    expect(await d2.resolveVersion('@a/x', '~1.2.0')).toBe('1.2.0');
    await expect(d2.resolveVersion('@a/x', '^3.0.0')).rejects.toThrow(/No version of @a\/x matches \^3\.0\.0/);
  });

  it('downloads the resolved version with the auth headers', async () => {
    const seen: Array<Record<string, string>> = [];
    const fetch: RegistryFetch = async (url, init) => {
      seen.push(init.headers);
      if (url === `${BASE}/packages/@a/x/versions`) return { ok: true, status: 200, json: async () => ['1.0.0', '1.1.0'], arrayBuffer: async () => new ArrayBuffer(0) };
      if (url === `${BASE}/packages/@a/x/download/1.1.0`) return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new Uint8Array([7, 8]).buffer as ArrayBuffer };
      return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const d = createRegistryDownloader({ baseUrl: `${BASE}/`, fetch, headers: () => ({ Authorization: 'Bearer t' }) });
    expect(await d.download('@a/x', '^1.0.0')).toEqual(new Uint8Array([7, 8]));
    expect(seen.every((h) => h.Authorization === 'Bearer t')).toBe(true);
  });

  it('reports a failed download with the status and the resolved version', async () => {
    const d = createRegistryDownloader({ baseUrl: BASE, fetch: fakeFetch({}) });
    await expect(d.download('@a/x', '1.0.0')).rejects.toThrow('package download failed (HTTP 404) for @a/x@1.0.0');
  });
});
