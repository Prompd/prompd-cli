/**
 * Prompd Package Registry System (Multi-Registry Architecture)
 * Core registry infrastructure for publishing and installing packages with scope-based resolution
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as semver from 'semver';
import { EventEmitter } from 'events';
import { SecurityManager } from './security';
import { ConfigManager } from './config';
import { Config, RegistryConfig, PACKAGE_TYPE_DIRS, TOOL_DEPLOY_DIRS, resolveToolDeployDir } from '../types';
import { IFileSystem, MemoryFileSystem, NodeFileSystem } from './compiler/file-system';
import { findProjectRoot } from './compiler/package-resolver';
import {
  installPackage, uninstallPackage, createRegistryDownloader, openPdpkg, archiveDigest, PACKAGE_NAME_RE,
  type InstalledPackage, type RegistryDownloader, type RegistryFetch,
} from '@prompd/core';
import { NodePackageStore } from './node-package-store';
import { validateRegistryUrl } from './validation';

// Legacy interface for backward compatibility
export interface LegacyRegistryConfig {
  registryUrl: string;
  authToken?: string;
  cacheDir: string;
  timeout: number;
  maxPackageSize: number;
}

export interface PackageMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  keywords: string[];
  repository?: {
    type: string;
    url: string;
  };
  dependencies: Record<string, string>;
  prompdVersion: string;
  files: string[];
  main?: string;
  type: 'package' | 'workflow' | 'skill' | 'agent';
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PublishOptions {
  access: 'public' | 'private';
  tag: string;
  dryRun: boolean;
  force: boolean;
  fileSystem?: IFileSystem;  // Optional file system for in-memory publishing
  authToken?: string;        // Override auth token (used by IPC handler when token is passed directly)
  /** Upload to the staged endpoint instead of publishing live. Not combinable with `tag` or `force`. */
  stage?: boolean;
}

/** The registry's 201 answer to a staged upload. */
export interface StagedPublishResult {
  success: boolean;
  fullName: string;
  version: string;
  status: string;
  integrity: string;
  expiresAt: string;
}

/**
 * The registry answered 404 to a staged upload: it has no staged publishing, or the
 * namespace is not visible to the caller (the two look the same on purpose).
 * Staging never falls back to a live publish.
 */
export class StagedNotSupportedError extends Error {
  constructor() {
    super('this registry does not support staged publishing, or the namespace was not found');
    this.name = 'StagedNotSupportedError';
  }
}

/** One staged version as the registry lists it. */
export interface StagedVersionInfo {
  fullName: string;
  version: string;
  /** `promoting` means a promotion started and did not finish: promote again to complete it. */
  status: 'staged' | 'promoting';
  integrity: string;
  fileCount: number;
  stagedAt: string;
  expiresAt: string;
  pullCount: number;
  stagedBy: string;
}

/** The registry's answer to a promote. Only `success` is relied on. */
export interface PromoteOutcome {
  success: boolean;
  fullName?: string;
  version?: string;
  status?: string;
  integrity?: string;
}

/**
 * The registry answered 404 to a staged request. The package may not exist, the caller may
 * not be allowed to see it, or the registry may have no staged support: these look the same
 * on purpose, so the message does not claim which.
 */
export class StagedUnavailableError extends Error {
  constructor() {
    super('package not found, you do not have access to it, or this registry does not support staged versions');
    this.name = 'StagedUnavailableError';
  }
}

/** The staged list has no entry for the requested version. */
export class StagedVersionNotFoundError extends Error {
  constructor(name: string, version: string) {
    super(`No staged version ${version} found for ${name}`);
    this.name = 'StagedVersionNotFoundError';
  }
}

const STAGED_NAME_RE = /^@(?!\.+\/)[a-z0-9._-]+\/(?!\.+$)[a-z0-9._-]+$/;

/** Same rule as the registry: canonical semver without build metadata. */
function isStagedVersion(version: string): boolean {
  return semver.valid(version) === version && !version.includes('+');
}

/** Split `@scope/name@1.0.0`; null when the name or the version is missing or malformed. */
export function parseStagedRef(ref: string): { name: string; version: string } | null {
  const at = ref.lastIndexOf('@');
  if (at <= 0) return null;
  const name = ref.slice(0, at);
  const version = ref.slice(at + 1);
  if (!STAGED_NAME_RE.test(name) || !isStagedVersion(version)) return null;
  return { name, version };
}

function isStagedVersionInfo(value: unknown): value is StagedVersionInfo {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.fullName === 'string' && typeof v.version === 'string'
    && (v.status === 'staged' || v.status === 'promoting')
    && typeof v.integrity === 'string' && typeof v.fileCount === 'number'
    && typeof v.stagedAt === 'string' && typeof v.expiresAt === 'string'
    && typeof v.pullCount === 'number' && typeof v.stagedBy === 'string';
}

/** The server's `error` (and `message`) from a refusal body, or the raw text when it is not JSON. */
function refusalText(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown> | null;
    const parts = [parsed?.error, parsed?.message].filter((p): p is string => typeof p === 'string' && p !== '');
    if (parts.length > 0) return parts.join(': ');
  } catch {
    // not JSON: fall through to the raw text
  }
  return body.trim();
}

/**
 * `X-Package-Integrity` value for an archive: core's `sha256:<hex>` digest as the
 * registry's `sha256-<base64>` form.
 */
export async function archiveIntegrityHeader(bytes: Uint8Array): Promise<string> {
  const digest = await archiveDigest(bytes);
  const match = /^sha256:([0-9a-f]{64})$/.exec(digest);
  if (!match) {
    throw new Error(`Unexpected archive digest format: ${digest}`);
  }
  return `sha256-${Buffer.from(match[1], 'hex').toString('base64')}`;
}

function parseStagedPublishResult(body: string): StagedPublishResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Staged publish succeeded but the registry response was not valid JSON');
  }
  const r = parsed as Record<string, unknown> | null;
  if (!r || typeof r !== 'object'
    || typeof r.fullName !== 'string' || typeof r.version !== 'string' || typeof r.status !== 'string'
    || typeof r.integrity !== 'string' || typeof r.expiresAt !== 'string') {
    throw new Error('Staged publish succeeded but the registry response was missing fields');
  }
  return {
    success: r.success === true,
    fullName: r.fullName,
    version: r.version,
    status: r.status,
    integrity: r.integrity,
    expiresAt: r.expiresAt,
  };
}

/** Message for a 409 on stage: the server's error, plus the integrity when the caller may read it. */
function stagedConflictMessage(body: string): string {
  let error = 'Version already exists';
  let integrity: string | undefined;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown> | null;
    if (parsed && typeof parsed.error === 'string') error = parsed.error;
    if (parsed && typeof parsed.integrity === 'string') integrity = parsed.integrity;
  } catch {
    if (body.trim()) error = body.trim();
  }
  return integrity ? `${error} (integrity: ${integrity})` : error;
}

export interface SearchQuery {
  query?: string;
  category?: string;
  type?: string | string[];
  tags?: string[];
  author?: string;
  limit?: number;
  offset?: number;
  sort?: 'relevance' | 'downloads' | 'updated' | 'created';
}

export interface SearchResult {
  packages: Array<{
    name: string;
    version: string;
    description: string;
    author: string;
    downloads: number;
    updatedAt: string;
    tags: string[];
    category: string;
  }>;
  total: number;
  hasMore: boolean;
}

export interface InstallOptions {
  version?: string;
  global?: boolean;
  skipCache?: boolean;
  workspaceRoot?: string;
  tools?: string[];
}

/**
 * Options for creating a RegistryClient.
 */
export interface RegistryClientOptions {
  /** Registry name from config (e.g., 'prompdhub') */
  registryName?: string;
  /** Direct registry URL - overrides config lookup */
  registryUrl?: string;
  /** Where downloaded archives are cached. Default `~/.prompd/cache`. */
  cacheDir?: string;
}

/**
 * Package Registry Client
 */
export class RegistryClient extends EventEmitter {
  private config: Config;
  private registryName: string;
  private registryConfig: RegistryConfig;
  private readonly cacheRoot: string;
  private downloaderInstance: RegistryDownloader | null = null;

  constructor(options?: string | RegistryClientOptions) {
    super();

    // Handle legacy string parameter (registry name)
    const opts: RegistryClientOptions = typeof options === 'string'
      ? { registryName: options }
      : options || {};

    const configManager = ConfigManager.getInstance();
    // Load config synchronously - this is critical!
    this.config = this.loadConfigSync(configManager);

    // Resolve registry name
    this.registryName = opts.registryName || this.config.registry.default || 'prompdhub';

    // Get registry config
    const registries = this.config.registry.registries;
    if (!registries[this.registryName]) {
      throw new Error(`Registry '${this.registryName}' not found in configuration`);
    }

    this.registryConfig = registries[this.registryName];

    // Override URL if provided directly (for server-side usage)
    if (opts.registryUrl) {
      this.registryConfig = { ...this.registryConfig, url: opts.registryUrl };
    }

    this.cacheRoot = opts.cacheDir ?? path.join(os.homedir(), '.prompd', 'cache');
    this.ensureCacheDir();
  }

  get registryUrl(): string {
    return this.registryConfig.url.replace(/\/+$/, '');
  }

  /**
   * Encode a package name for safe URL usage.
   * Preserves the @ prefix and / separator in scoped packages (e.g. @scope/name),
   * but encodes all other special characters in each segment.
   */
  private encodePackageName(packageName: string): string {
    // Handle scoped packages: @scope/name
    if (packageName.startsWith('@') && packageName.includes('/')) {
      const slashIndex = packageName.indexOf('/');
      const scope = packageName.substring(1, slashIndex);
      const name = packageName.substring(slashIndex + 1);
      return `@${encodeURIComponent(scope)}/${encodeURIComponent(name)}`;
    }
    return encodeURIComponent(packageName);
  }

  get authToken(): string | undefined {
    return this.registryConfig.api_key || this.registryConfig.token;
  }

  get cacheDir(): string {
    return this.cacheRoot;
  }

  get maxPackageSize(): number {
    return 50 * 1024 * 1024; // 50MB
  }

  /**
   * Load config synchronously - required for constructor
   */
  private loadConfigSync(configManager: ConfigManager): Config {
    // If config is already loaded, use it
    if (configManager.config) {
      return configManager.config;
    }

    // Otherwise load it synchronously (this is a hack but necessary)
    const fs = require('fs');
    const yaml = require('yaml');
    const os = require('os');
    const path = require('path');
    
    const configPath = path.join(os.homedir(), '.prompd', 'config.yaml');
    
    // Use env var for registry URL if set (useful for local development)
    const defaultUrl = 'https://registry.prompdhub.ai';
    let registryUrl = defaultUrl;
    const envRegistryUrl = process.env.PROMPD_REGISTRY_URL;
    if (envRegistryUrl) {
      if (validateRegistryUrl(envRegistryUrl)) {
        registryUrl = envRegistryUrl;
      } else {
        console.warn(`Warning: PROMPD_REGISTRY_URL value is invalid, falling back to default: ${defaultUrl}`);
      }
    }

    const defaultConfig: Config = {
      apiKeys: {},
      customProviders: {},
      registry: {
        registries: {
          prompdhub: {
            url: registryUrl
          }
        },
        default: 'prompdhub'
      },
      scopes: {},
      maxRetries: 3,
      timeout: 30,
      verbose: false
    };

    try {
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const fileConfig = yaml.parse(configContent, { strict: true, maxAliasCount: 64 });

        // Validate parsed config is a plain object
        if (!fileConfig || typeof fileConfig !== 'object' || Array.isArray(fileConfig)) {
          return defaultConfig;
        }

        // Merge with default config
        const mergedConfig = { ...defaultConfig, ...fileConfig };
        
        // Ensure registry structure exists
        if (!mergedConfig.registry) {
          mergedConfig.registry = defaultConfig.registry;
        }
        if (!mergedConfig.registry.registries) {
          mergedConfig.registry.registries = defaultConfig.registry.registries;
        }
        if (!mergedConfig.scopes) {
          mergedConfig.scopes = {};
        }
        
        return mergedConfig;
      }
    } catch (error) {
      console.warn(`Warning: Error loading config: ${error}`);
    }

    return defaultConfig;
  }

  /**
   * Authenticate with registry using token
   */
  async loginWithToken(token: string): Promise<{ username: string }> {
    // Verify token by getting user profile
    const response = await fetch(`${this.registryUrl}/v1/user/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      throw new Error('Invalid token. Please check your API token.');
    } else if (response.status === 404) {
      throw new Error(`User endpoint not found. Registry URL: ${this.registryUrl}`);
    } else if (response.status >= 500) {
      throw new Error(`Registry server error (${response.status}). Please try again later.`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Authentication failed: ${errorText}`);
    }

    const userData = await response.json() as { username?: string };

    if (!userData.username) {
      throw new Error('Invalid response from registry: missing username');
    }

    // Update registry config
    const configManager = ConfigManager.getInstance();
    await configManager.setRegistryToken(this.registryName, token, userData.username);

    return { username: userData.username };
  }

  /**
   * Clear authentication credentials
   */
  async logout(): Promise<void> {
    const configManager = ConfigManager.getInstance();
    await configManager.setRegistryToken(this.registryName, '', '');
  }

  /**
   * Publish a package to the registry
   */
  async publish(packagePath: string, options: PublishOptions = {
    access: 'public',
    tag: 'latest',
    dryRun: false,
    force: false
  }): Promise<StagedPublishResult | undefined> {
    this.emit('publishStart', { packagePath, options });

    try {
      // Refuse before anything is read or sent: staged versions are never tagged and cannot be overwritten.
      if (options.stage && options.force) {
        throw new Error('--stage cannot be combined with --force');
      }
      if (options.stage && options.tag !== 'latest') {
        throw new Error('--stage cannot be combined with --tag');
      }

      // Resolve file system (same pattern as compile)
      const fileSystem = options.fileSystem || new NodeFileSystem();

      // Load and validate package metadata from manifest.json
      const metadata = await this.loadManifestFromFS(packagePath, fileSystem);

      // Security validation using file system abstraction
      await this.validatePackageForPublishFS(packagePath, metadata, fileSystem);

      // Check version conflicts. Staging skips this: the server's 409 is the check.
      if (!options.force && !options.stage) {
        const existingVersions = await this.getPackageVersions(metadata.name);
        if (existingVersions.includes(metadata.version)) {
          throw new Error(`Version ${metadata.version} already exists. Use --force to overwrite.`);
        }
      }

      if (options.dryRun) {
        console.log('Dry run - package would be published:');
        console.log(JSON.stringify(metadata, null, 2));
        return undefined;
      }

      // Create package tarball Buffer (memory or disk)
      const tarballBuffer = await this.createPackageTarballBuffer(packagePath, metadata, fileSystem);

      // Upload to registry
      const staged = await this.uploadPackageBuffer(tarballBuffer, metadata, options);

      if (staged) {
        this.emit('publishStaged', { name: metadata.name, ...staged });
        return staged;
      }

      this.emit('publishComplete', {
        name: metadata.name,
        version: metadata.version,
        access: options.access
      });
      return undefined;

    } catch (error) {
      this.emit('publishError', { packagePath, error });
      throw error;
    }
  }

  /** Core's downloader over this client's URL and auth. One version-resolution path for every host. */
  private get downloader(): RegistryDownloader {
    if (!this.downloaderInstance) {
      const fetchImpl: RegistryFetch = (url, init) => fetch(url, init);
      this.downloaderInstance = createRegistryDownloader({
        baseUrl: this.registryUrl,
        fetch: fetchImpl,
        headers: () => this.getAuthHeaders(),
      });
    }
    return this.downloaderInstance;
  }

  /** Cache path for an exact name@version: <cacheDir>/packages/@scope/name@version (+ .meta). */
  private cachePathFor(name: string, version: string): string {
    return path.join(this.cacheDir, 'packages', `${name}@${version}`);
  }

  /**
   * The PackageDownloader handed to core. Resolves the spec, then serves the
   * cached archive only when its digest still equals the one recorded at
   * download; a changed or unreadable cache entry is dropped and fetched again.
   * A download is cached only after openPdpkg accepts it, so a bad response is
   * never replayed. The digest proves the bytes are unchanged since a VERIFIED
   * download; it does not prove registry provenance (anyone who can write the
   * cache can rewrite .meta too). Core re-verifies whatever this returns.
   */
  private async cachedDownload(name: string, spec: string, skipCache: boolean): Promise<Uint8Array> {
    const version = await this.downloader.resolveVersion(name, spec);
    const file = this.cachePathFor(name, version);
    if (!skipCache && await fs.pathExists(file)) {
      try {
        const bytes = new Uint8Array(await fs.readFile(file));
        const meta = await fs.readJson(`${file}.meta`) as { digest?: unknown };
        if (typeof meta.digest === 'string' && meta.digest === await archiveDigest(bytes)) {
          this.emit('installingFromCache', { name, version });
          return bytes;
        }
      } catch { /* unreadable entry: refetch below */ }
      this.emit('cacheEntryInvalid', { name, version });
      await fs.remove(file);
      await fs.remove(`${file}.meta`);
    }
    const bytes = await this.downloader.download(name, version);
    await openPdpkg(bytes, { name, range: version });
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(file, bytes);
    await fs.writeJson(`${file}.meta`, { name, version, digest: await archiveDigest(bytes) }, { spaces: 2 });
    return bytes;
  }

  /**
   * Install a package (and its dependencies) through @prompd/core: every
   * archive is verified before anything is written. Accepts
   * "@scope/name", "@scope/name@1.2.3" or "@scope/name@^1.2.0"; options.version
   * applies when the ref has no version.
   */
  async install(packageName: string, options: InstallOptions = {}): Promise<InstalledPackage> {
    this.emit('installStart', { packageName, options });
    try {
      const hasVersion = packageName.lastIndexOf('@') > 0;
      const ref = hasVersion || !options.version ? packageName : `${packageName}@${options.version}`;
      const root = (options.global ? os.homedir() : (options.workspaceRoot || findProjectRoot())).split(path.sep).join('/');
      const installed = await installPackage({
        ref,
        root,
        installDir: '.prompd',
        store: new NodePackageStore(),
        download: (name, spec) => this.cachedDownload(name, spec, options.skipCache === true),
        ...(options.global ? { global: true } : {}),
        ...(options.tools && options.tools.length > 0 ? {
          tools: options.tools,
          deployTool: async ({ installedPath, name, tool }) => { await this.deploySkillToTool(installedPath, name, tool); },
        } : {}),
      });
      this.emit('installComplete', { name: installed.name, version: installed.version });
      return installed;
    } catch (error) {
      this.emit('installError', { packageName, error });
      throw error;
    }
  }
  /**
   * Search packages in the registry
   */
  async search(query: SearchQuery): Promise<SearchResult> {
    try {
      const searchParams = new URLSearchParams();
      
      if (query.query) searchParams.set('search', query.query);
      if (query.category) searchParams.set('category', query.category);
      if (query.type) {
        const typeValue = Array.isArray(query.type) ? query.type.join(',') : query.type;
        searchParams.set('type', typeValue);
      }
      if (query.tags) searchParams.set('tags', query.tags.join(','));
      if (query.author) searchParams.set('author', query.author);
      if (query.limit) searchParams.set('limit', query.limit.toString());
      if (query.offset) searchParams.set('offset', query.offset.toString());
      if (query.sort) searchParams.set('sort', query.sort);

      const response = await fetch(`${this.registryUrl}/packages?${searchParams.toString()}`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as SearchResult;
      
      this.emit('searchComplete', { query, results: result.packages.length });
      
      return result;

    } catch (error) {
      this.emit('searchError', { query, error });
      throw error;
    }
  }

  /**
   * Get package information
   */
  async getPackageInfo(packageName: string, version?: string): Promise<PackageMetadata> {
    try {
      const encodedName = this.encodePackageName(packageName);
      const url = version
        ? `${this.registryUrl}/packages/${encodedName}/${encodeURIComponent(version)}`
        : `${this.registryUrl}/packages/${encodedName}`;

      const response = await fetch(url, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Package not found: ${packageName}`);
        }
        throw new Error(`Failed to get package info: ${response.status} ${response.statusText}`);
      }

      return await response.json() as PackageMetadata;

    } catch (error) {
      this.emit('packageInfoError', { packageName, version, error });
      throw error;
    }
  }

  /**
   * List the staged versions of a package the caller may read.
   * Throws StagedUnavailableError on 404.
   */
  async listStaged(packageName: string): Promise<StagedVersionInfo[]> {
    const response = await fetch(`${this.registryUrl}/packages/${this.encodePackageName(packageName)}/staged`, {
      headers: this.getAuthHeaders()
    });
    if (response.status === 404) {
      throw new StagedUnavailableError();
    }
    if (!response.ok) {
      throw new Error(`Failed to list staged versions: ${response.status} ${refusalText(await response.text()) || response.statusText}`);
    }

    const data = await response.json() as { versions?: unknown } | null;
    if (!data || !Array.isArray(data.versions) || !data.versions.every(isStagedVersionInfo)) {
      throw new Error('Failed to list staged versions: unexpected response from the registry');
    }
    return data.versions;
  }

  /**
   * Promote a staged version to a live one. The registry refuses when `integrity` does not
   * match what it holds, so without one the staged list is read first and its value is sent.
   * Emits `promoteStart` with the integrity that is about to be sent.
   */
  async promoteStaged(packageName: string, version: string, integrity?: string): Promise<PromoteOutcome> {
    let expected = integrity;
    if (expected === undefined) {
      const staged = (await this.listStaged(packageName)).find((v) => v.version === version);
      if (!staged) {
        throw new StagedVersionNotFoundError(packageName, version);
      }
      expected = staged.integrity;
    }
    this.emit('promoteStart', { name: packageName, version, integrity: expected });

    const response = await fetch(`${this.registryUrl}/packages/${this.encodePackageName(packageName)}/staged/${encodeURIComponent(version)}/promote`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ integrity: expected })
    });
    if (response.status === 404) {
      throw new StagedUnavailableError();
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Promote failed: ${response.status} ${refusalText(text) || response.statusText}`);
    }

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown> | null;
    } catch {
      // a 2xx with no readable body still counts as success
    }
    const field = (key: string): string | undefined => (typeof parsed?.[key] === 'string' ? parsed[key] as string : undefined);
    return {
      success: parsed?.success !== false,
      fullName: field('fullName'),
      version: field('version'),
      status: field('status'),
      integrity: field('integrity')
    };
  }

  /**
   * Discard a staged version. Its version number cannot be staged or published again.
   * Throws StagedUnavailableError on 404.
   */
  async discardStaged(packageName: string, version: string): Promise<void> {
    const response = await fetch(`${this.registryUrl}/packages/${this.encodePackageName(packageName)}/staged/${encodeURIComponent(version)}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (response.status === 404) {
      throw new StagedUnavailableError();
    }
    if (!response.ok) {
      throw new Error(`Discard failed: ${response.status} ${refusalText(await response.text()) || response.statusText}`);
    }
  }

  /**
   * Get available versions for a package
   */
  async getPackageVersions(packageName: string): Promise<string[]> {
    try {
      const response = await fetch(`${this.registryUrl}/packages/${this.encodePackageName(packageName)}/versions`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`Failed to get package versions: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as
        | Array<string | { version: string }>
        | { versions: Array<string | { version: string }> };

      // Handle both response formats (like Python CLI does):
      // 1. Direct array: [{version: "1.0.0", ...}, ...]
      // 2. Wrapped object: {versions: [...]}
      let versionsList: Array<string | { version: string }>;
      if (Array.isArray(data)) {
        versionsList = data;
      } else if (data.versions && Array.isArray(data.versions)) {
        versionsList = data.versions;
      } else {
        throw new Error('Invalid versions response format');
      }

      // Extract version strings from version objects
      return versionsList.map(v => typeof v === 'string' ? v : v.version);

    } catch (error) {
      this.emit('packageVersionsError', { packageName, error });
      throw error;
    }
  }

  private async loadPackageMetadata(packageDir: string): Promise<PackageMetadata> {
    const projectFile = path.join(packageDir, 'project.prmdproj');
    
    if (!await fs.pathExists(projectFile)) {
      throw new Error('No project.prmdproj file found');
    }

    const content = await fs.readFile(projectFile, 'utf8');
    const yaml = require('yaml');
    
    // Parse YAML frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      throw new Error('Invalid project.prmdproj file format');
    }

    const metadata = yaml.parse(match[1]);
    
    // Validate required fields
    const required = ['name', 'version', 'description', 'author'];
    for (const field of required) {
      if (!metadata[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate version format
    if (!semver.valid(metadata.version)) {
      throw new Error(`Invalid version format: ${metadata.version}`);
    }

    // Set defaults
    metadata.license = metadata.license || 'MIT';
    metadata.keywords = metadata.keywords || [];
    metadata.dependencies = metadata.dependencies || {};
    metadata.files = metadata.files || ['**/*'];
    metadata.type = metadata.type || 'package';
    metadata.category = metadata.category || 'general';
    metadata.tags = metadata.tags || [];
    metadata.prmdVersion = '0.2.3';
    metadata.createdAt = new Date().toISOString();
    metadata.updatedAt = new Date().toISOString();

    return metadata;
  }

  private async validatePackageForPublish(packageDir: string, metadata: PackageMetadata): Promise<void> {
    // Check package size
    const stats = await this.getDirectorySize(packageDir);
    if (stats.size > this.maxPackageSize) {
      throw new Error(`Package size (${stats.size}) exceeds maximum allowed (${this.maxPackageSize})`);
    }

    // Validate package name
    const sanitizedName = SecurityManager.sanitizeToolName(metadata.name);
    if (sanitizedName !== metadata.name) {
      throw new Error(`Invalid package name: ${metadata.name}`);
    }

    // Check for required files
    const requiredFiles = [];
    if (metadata.type === 'package' && metadata.main) {
      requiredFiles.push(metadata.main);
    }

    for (const file of requiredFiles) {
      const filePath = path.join(packageDir, file);
      if (!await fs.pathExists(filePath)) {
        throw new Error(`Required file not found: ${file}`);
      }
    }

    // Validate dependencies
    for (const [depName, depVersion] of Object.entries(metadata.dependencies)) {
      if (!semver.validRange(depVersion)) {
        throw new Error(`Invalid dependency version range: ${depName}@${depVersion}`);
      }
    }
  }

  /**
   * Download a package without installing it to disk, verified through core.
   * Useful for in-memory package loading.
   *
   * @param packageName - Package name (e.g., "@namespace/package-name")
   * @param version - Package version (e.g., "1.0.0")
   * @returns Object with archive Buffer and package metadata
   */
  async downloadPackageBuffer(packageName: string, version: string): Promise<{ tarball: Buffer; metadata: PackageMetadata }> {
    const bytes = await this.cachedDownload(packageName, version, false);
    // An unversioned ref resolves as 'latest', which is not a range; only a real range constrains the manifest.
    const pkg = await openPdpkg(bytes, {
      name: packageName,
      ...(semver.validRange(version) !== null ? { range: version } : {}),
    });
    return { tarball: Buffer.from(bytes), metadata: pkg.manifest as unknown as PackageMetadata };
  }

  /**
   * Deploy skill files to a tool-native directory (e.g., ~/.claude/skills/).
   * Copies skill files and writes a reference marker back to the prompd source location.
   * Returns the deployed directory path for rollback support.
   */
  private async deploySkillToTool(skillDir: string, packageName: string, toolName: string): Promise<string> {
    const deployDir = resolveToolDeployDir(toolName);
    if (!deployDir) {
      throw new Error(`Unknown tool '${toolName}'. Supported tools: ${Object.keys(TOOL_DEPLOY_DIRS).join(', ')}`);
    }

    // Verify skill source directory exists before copying
    if (!await fs.pathExists(skillDir)) {
      throw new Error(`Skill source directory not found: ${skillDir}`);
    }

    // Create a subdirectory for this skill within the tool's skills directory
    const skillDeployDir = path.join(deployDir, packageName);
    await fs.ensureDir(skillDeployDir);

    // Pre-copy check: reject if source tree contains symlinks (prevent symlink-based attacks)
    await this.rejectSymlinks(skillDir);

    // Copy all files from the install dir to the tool deploy dir (dereference: false to not follow symlinks)
    await fs.copy(skillDir, skillDeployDir, { overwrite: true, dereference: false });

    // Write a reference marker so we know this was deployed by prompd
    const markerPath = path.join(skillDeployDir, '.prompd-source');
    await fs.writeJson(markerPath, {
      source: skillDir,
      deployedAt: new Date().toISOString(),
      tool: toolName,
    }, { spaces: 2 });

    return skillDeployDir;
  }

  /**
   * Recursively walk a directory and reject if any symlinks are found.
   * Prevents symlink-based path traversal attacks during skill deployment.
   */
  private async rejectSymlinks(dir: string): Promise<void> {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const lstat = await fs.lstat(fullPath);
      if (lstat.isSymbolicLink()) {
        throw new Error(`Security violation: symlink detected in package: ${fullPath}`);
      }
      if (lstat.isDirectory()) {
        await this.rejectSymlinks(fullPath);
      }
    }
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'prompd-cli/0.2.4',
      'Content-Type': 'application/json'
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  private async ensureCacheDir(): Promise<void> {
    await fs.ensureDir(this.cacheDir);
    await fs.ensureDir(path.join(this.cacheDir, 'temp'));
  }

  private async getDirectorySize(dir: string): Promise<{ size: number; files: number }> {
    let totalSize = 0;
    let totalFiles = 0;

    const items = await fs.readdir(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stats = await fs.stat(fullPath);
      
      if (stats.isDirectory()) {
        const subStats = await this.getDirectorySize(fullPath);
        totalSize += subStats.size;
        totalFiles += subStats.files;
      } else {
        totalSize += stats.size;
        totalFiles++;
      }
    }

    return { size: totalSize, files: totalFiles };
  }

  private matchesFilePatterns(filePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (pattern === '**/*' || pattern === '*') {
        return true;
      }

      if (pattern.includes('*')) {
        // Safely convert glob pattern to regex:
        // 1. Escape all regex metacharacters EXCEPT *
        // 2. Replace ** with a full-path wildcard, and * with single-segment wildcard
        const escaped = pattern.replace(/([.+?^${}()|[\]\\])/g, '\\$1');
        const regexStr = escaped
          .replace(/\*\*/g, '\u0000')  // Temporary placeholder for **
          .replace(/\*/g, '[^/]*')      // * matches within a single path segment
          .replace(/\u0000/g, '.*');    // ** matches across path segments
        try {
          const regex = new RegExp(`^${regexStr}$`);
          if (regex.test(filePath)) {
            return true;
          }
        } catch {
          // If regex construction fails, fall back to exact match
          if (filePath === pattern) {
            return true;
          }
        }
      } else if (filePath === pattern || filePath.endsWith('/' + pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Uninstall a package by name through @prompd/core, removing installed files
   * and the prompd.json dependency entry.
   */
  async uninstall(packageName: string, options: InstallOptions = {}): Promise<void> {
    const root = (options.global ? os.homedir() : (options.workspaceRoot || findProjectRoot())).split(path.sep).join('/');
    const at = packageName.lastIndexOf('@');
    const name = at > 0 ? packageName.slice(0, at) : packageName;
    const present = await Promise.all(
      Object.values(PACKAGE_TYPE_DIRS).map((dir) => fs.pathExists(path.join(root, '.prompd', dir, name))),
    );
    if (!present.some(Boolean)) throw new Error(`Package '${name}' is not installed`);
    await uninstallPackage({ ref: name, root, installDir: '.prompd', store: new NodePackageStore(), ...(options.global ? { global: true } : {}) });
    this.emit('uninstallComplete', { name });
  }

  /**
   * Load manifest.json from file system abstraction.
   * Supports both disk-based and in-memory file systems.
   */
  private async loadManifestFromFS(
    packagePath: string,
    fileSystem: IFileSystem
  ): Promise<PackageMetadata> {
    // Try prompd.json first (current format), fall back to manifest.json (legacy)
    const prompdJsonPath = fileSystem.join(packagePath, 'prompd.json');
    const manifestPath = fileSystem.join(packagePath, 'manifest.json');

    let resolvedPath: string;
    if (await Promise.resolve(fileSystem.exists(prompdJsonPath))) {
      resolvedPath = prompdJsonPath;
    } else if (await Promise.resolve(fileSystem.exists(manifestPath))) {
      resolvedPath = manifestPath;
    } else {
      throw new Error('No prompd.json (or legacy manifest.json) file found');
    }

    const content = await Promise.resolve(fileSystem.readFile(resolvedPath));
    const manifest = JSON.parse(content);

    // Prevent prototype pollution from untrusted manifests
    const manifestObj = manifest as Record<string, unknown>;
    delete manifestObj['__proto__'];
    delete manifestObj['constructor'];
    delete manifestObj['prototype'];

    // Validate required fields
    const required = ['name', 'version', 'description', 'author'];
    for (const field of required) {
      if (!manifest[field]) {
        throw new Error(`Missing required field in ${path.basename(resolvedPath)}: ${field}`);
      }
    }

    // Validate version format
    if (!semver.valid(manifest.version)) {
      throw new Error(`Invalid version format: ${manifest.version}`);
    }

    // Set defaults
    manifest.license = manifest.license || 'MIT';
    manifest.keywords = manifest.keywords || [];
    manifest.dependencies = manifest.dependencies || {};
    manifest.files = manifest.files || ['**/*.prmd'];
    manifest.type = manifest.type || 'package';
    manifest.category = manifest.category || 'general';
    manifest.tags = manifest.tags || [];
    manifest.prompdVersion = manifest.prompdVersion || '0.3.3';
    manifest.createdAt = manifest.createdAt || new Date().toISOString();
    manifest.updatedAt = new Date().toISOString();

    return manifest;
  }

  /**
   * Validate package for publish using file system abstraction.
   */
  private async validatePackageForPublishFS(
    packagePath: string,
    metadata: PackageMetadata,
    fileSystem: IFileSystem
  ): Promise<void> {
    // Calculate package size
    const stats = fileSystem instanceof MemoryFileSystem
      ? fileSystem.getTotalSize(packagePath)
      : await this.getDirectorySize(packagePath);

    if (stats.size > this.maxPackageSize) {
      throw new Error(
        `Package size (${stats.size}) exceeds maximum allowed (${this.maxPackageSize})`
      );
    }

    // Registry package names are always scoped (@scope/name); the tool-name sanitizer rejects the '@' and '/'.
    if (!PACKAGE_NAME_RE.test(metadata.name)) {
      throw new Error(`Invalid package name: ${metadata.name}`);
    }

    // Validate dependencies
    for (const [depName, depVersion] of Object.entries(metadata.dependencies)) {
      if (!semver.validRange(depVersion)) {
        throw new Error(`Invalid dependency version range: ${depName}@${depVersion}`);
      }
    }
  }

  /**
   * Build the upload: the same verified zip `prompd package create` writes.
   * Supports both in-memory and disk-based package creation.
   */
  private async createPackageTarballBuffer(
    packagePath: string,
    metadata: PackageMetadata,
    fileSystem: IFileSystem
  ): Promise<Buffer> {
    if (fileSystem instanceof MemoryFileSystem) {
      return await fileSystem.createPackageBuffer(packagePath, { ...metadata }, {
        filter: (filePath: string) => this.matchesFilePatterns(filePath, metadata.files)
      });
    }

    const { buildPackageBytes, DEFAULT_EXCLUSIONS } = await import('../commands/package');
    const bytes = await buildPackageBytes(packagePath, {
      name: metadata.name,
      version: metadata.version,
      description: metadata.description,
      ...(metadata.author ? { author: metadata.author } : {}),
      type: metadata.type ?? 'package'
    }, DEFAULT_EXCLUSIONS, (relPath) => this.matchesFilePatterns(relPath, metadata.files));
    return Buffer.from(bytes);
  }

  /**
   * Upload package Buffer to registry.
   * Uses form-data's submit() which handles Content-Length, transport, and piping.
   * Sends X-Package-Integrity computed from the exact bytes uploaded. With
   * `options.stage` it PUTs to the staged endpoint and returns the registry's answer.
   */
  async uploadPackageBuffer(
    tarballBuffer: Buffer,
    metadata: PackageMetadata,
    options: PublishOptions
  ): Promise<StagedPublishResult | undefined> {
    const FormData = require('form-data');
    const formData = new FormData();

    formData.append(
      'package',
      tarballBuffer,
      {
        filename: `${metadata.name}-${metadata.version}.pdpkg`,
        contentType: 'application/zip'
      }
    );
    formData.append('metadata', JSON.stringify(metadata));
    formData.append('access', options.access);
    formData.append('tag', options.tag);

    const token = options.authToken || this.authToken;
    const stagedSuffix = options.stage ? '/staged' : '';
    const url = new URL(`${this.registryUrl}/packages/${this.encodePackageName(metadata.name)}${stagedSuffix}`);
    const integrity = await archiveIntegrityHeader(tarballBuffer);

    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      formData.submit(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: url.pathname,
          method: 'PUT',
          headers: {
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            'X-Package-Integrity': integrity,
            'User-Agent': 'prompd-cli/0.5.0'
          }
        },
        (err: Error | null, res: import('http').IncomingMessage) => {
          if (err) return reject(err);
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('error', reject);
          res.on('end', () => {
            resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') });
          });
        }
      );
    });

    if (options.stage) {
      if (response.statusCode === 404) {
        throw new StagedNotSupportedError();
      }
      if (response.statusCode === 409) {
        throw new Error(`Staged publish failed: ${stagedConflictMessage(response.body)}`);
      }
      if (response.statusCode !== 201) {
        throw new Error(`Staged publish failed: ${response.statusCode} - ${response.body}`);
      }
      return parseStagedPublishResult(response.body);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Publish failed: ${response.statusCode} - ${response.body}`);
    }
    return undefined;
  }
}

/**
 * Default registry configuration
 */
export const createDefaultRegistryConfig = (): LegacyRegistryConfig => {
  const defaultUrl = 'https://registry.prompdhub.ai';
  const envUrl = process.env.PROMPD_REGISTRY_URL;
  let registryUrl = defaultUrl;
  if (envUrl) {
    if (validateRegistryUrl(envUrl)) {
      registryUrl = envUrl;
    } else {
      console.warn(`Warning: PROMPD_REGISTRY_URL value is invalid, falling back to default: ${defaultUrl}`);
    }
  }
  return {
    registryUrl,
    authToken: process.env.PROMPD_AUTH_TOKEN,
    cacheDir: path.join(require('os').homedir(), '.prmd', 'cache'),
    timeout: 30000,
    maxPackageSize: 50 * 1024 * 1024 // 50MB
  };
};