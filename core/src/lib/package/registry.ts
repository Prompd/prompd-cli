/* The one registry downloader: version resolution (latest, exact, range) and
 * the download, over an injected fetch. Browser, CLI and sidecar all use it, so
 * a range resolves the same way everywhere. Verification is not done here; the
 * bytes go to openPdpkg. */
import semver from 'semver';
import type { PackageDownloader } from '../compiler/package-ref';

export interface RegistryResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type RegistryFetch = (url: string, init: { headers: Record<string, string> }) => Promise<RegistryResponse>;

export interface RegistryDownloaderOptions {
  /** e.g. https://registry.prompdhub.ai (a trailing slash is ignored). */
  baseUrl: string;
  fetch: RegistryFetch;
  /** Called per request, so a token getter can refresh. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
}

export interface RegistryDownloader {
  download: PackageDownloader;
  resolveVersion(name: string, spec: string): Promise<string>;
}

export function encodePackageName(name: string): string {
  if (name.startsWith('@') && name.includes('/')) {
    const slash = name.indexOf('/');
    return `@${encodeURIComponent(name.slice(1, slash))}/${encodeURIComponent(name.slice(slash + 1))}`;
  }
  return encodeURIComponent(name);
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function createRegistryDownloader(opts: RegistryDownloaderOptions): RegistryDownloader {
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function get(path: string): Promise<RegistryResponse> {
    const headers = opts.headers ? await opts.headers() : {};
    return opts.fetch(`${base}${path}`, { headers });
  }

  async function getJson(path: string, what: string): Promise<unknown> {
    const res = await get(path);
    if (!res.ok) throw new Error(`registry ${what} failed (HTTP ${res.status})`);
    return res.json();
  }

  async function resolveVersion(name: string, spec: string): Promise<string> {
    const enc = encodePackageName(name);
    if (!spec || spec === 'latest') {
      const j = record(await getJson(`/packages/${enc}`, `lookup of ${name}`));
      const info = record(j.package ?? j);
      const v = info.version;
      if (typeof v !== 'string' || semver.valid(v) === null) throw new Error(`the registry returned no version for ${name}`);
      return v;
    }
    const exact = semver.valid(spec);
    if (exact !== null) return exact;
    if (semver.validRange(spec) === null) throw new Error(`"${spec}" is not a version or version range for ${name}`);
    const data = await getJson(`/packages/${enc}/versions`, `versions of ${name}`);
    const list = Array.isArray(data) ? data : record(data).versions;
    const versions = (Array.isArray(list) ? list : [])
      .map((v) => (typeof v === 'string' ? v : record(v).version))
      .filter((v): v is string => typeof v === 'string' && semver.valid(v) !== null);
    const best = semver.maxSatisfying(versions, spec);
    if (!best) throw new Error(`No version of ${name} matches ${spec}`);
    return best;
  }

  const download: PackageDownloader = async (name, spec) => {
    const version = await resolveVersion(name, spec);
    const res = await get(`/packages/${encodePackageName(name)}/download/${encodeURIComponent(version)}`);
    if (!res.ok) throw new Error(`package download failed (HTTP ${res.status}) for ${name}@${version}`);
    return new Uint8Array(await res.arrayBuffer());
  };

  return { download, resolveVersion };
}
