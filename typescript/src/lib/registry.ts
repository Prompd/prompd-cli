/**
 * Prompd Package Registry System (Multi-Registry Architecture)
 * Core registry infrastructure for publishing and installing packages with scope-based resolution
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import * as semver from 'semver';
import * as tar from 'tar';
import { EventEmitter } from 'events';
import { SecurityManager } from './security';
import { ConfigManager } from './config';
import { Config, RegistryConfig, PackageType, PACKAGE_TYPE_DIRS, TOOL_DEPLOY_DIRS, getInstallDirForType, resolveToolDeployDir, isValidPackageType } from '../types';
import { IFileSystem, MemoryFileSystem, NodeFileSystem } from './compiler/file-system';

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
  type: 'package' | 'node-template' | 'workflow' | 'skill';
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
  saveDev?: boolean;
  global?: boolean;
  force?: boolean;
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
}

/**
 * Package Registry Client
 */
export class RegistryClient extends EventEmitter {
  private config: Config;
  private registryName: string;
  private registryConfig: RegistryConfig;
  private cache: Map<string, { tarball: Buffer; metadata: PackageMetadata }> = new Map();

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

    this.ensureCacheDir();
  }

  get registryUrl(): string {
    return this.registryConfig.url;
  }

  get authToken(): string | undefined {
    return this.registryConfig.api_key || this.registryConfig.token;
  }

  get cacheDir(): string {
    return path.join(require('os').homedir(), '.prompd', 'cache');
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
    const registryUrl = process.env.PROMPD_REGISTRY_URL || 'https://registry.prompdhub.ai';

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
        const fileConfig = yaml.parse(configContent);
        
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
  }): Promise<void> {
    this.emit('publishStart', { packagePath, options });

    try {
      // Resolve file system (same pattern as compile)
      const fileSystem = options.fileSystem || new NodeFileSystem();

      // Load and validate package metadata from manifest.json
      const metadata = await this.loadManifestFromFS(packagePath, fileSystem);

      // Security validation using file system abstraction
      await this.validatePackageForPublishFS(packagePath, metadata, fileSystem);

      // Check version conflicts
      if (!options.force) {
        const existingVersions = await this.getPackageVersions(metadata.name);
        if (existingVersions.includes(metadata.version)) {
          throw new Error(`Version ${metadata.version} already exists. Use --force to overwrite.`);
        }
      }

      if (options.dryRun) {
        console.log('Dry run - package would be published:');
        console.log(JSON.stringify(metadata, null, 2));
        return;
      }

      // Create package tarball Buffer (memory or disk)
      const tarballBuffer = await this.createPackageTarballBuffer(packagePath, metadata, fileSystem);

      // Upload to registry
      await this.uploadPackageBuffer(tarballBuffer, metadata, options);

      this.emit('publishComplete', {
        name: metadata.name,
        version: metadata.version,
        access: options.access
      });

    } catch (error) {
      this.emit('publishError', { packagePath, error });
      throw error;
    }
  }

  /**
   * Install a package from the registry
   * Accepts both formats:
   * - @namespace/package (with options.version)
   * - @namespace/package@version (embedded version)
   */
  async install(packageName: string, options: InstallOptions = {}): Promise<void> {
    this.emit('installStart', { packageName, options });

    try {
      // Parse package reference if it includes @version
      // Format: @namespace/package@version
      // Find last @ to split name from version (scoped packages start with @)
      let name = packageName;
      let versionSpec = options.version || 'latest';

      const lastAtIndex = packageName.lastIndexOf('@');
      if (lastAtIndex > 0) {
        // Has embedded version: @namespace/package@0.1.5
        name = packageName.substring(0, lastAtIndex);
        versionSpec = packageName.substring(lastAtIndex + 1);
      }

      // Resolve version
      const resolvedVersion = await this.resolveVersion(name, versionSpec);

      // Check cache first
      const cacheKey = `${name}@${resolvedVersion}`;
      if (!options.skipCache && !options.force) {
        const cachedPath = await this.getCachedPackage(cacheKey);
        if (cachedPath) {
          await this.installFromCache(cachedPath, name, resolvedVersion, options);
          return;
        }
      }

      // Download package
      const packageData = await this.downloadPackage(name, resolvedVersion);

      // Install dependencies (skip self-referential dependencies)
      const metadata = packageData.metadata;
      if (metadata.dependencies && Object.keys(metadata.dependencies).length > 0) {
        // Filter out self-referential dependencies to avoid circular resolution
        const filteredDeps: Record<string, string> = {};
        for (const [depName, depVersion] of Object.entries(metadata.dependencies as Record<string, string>)) {
          if (depName === name) {
            // Skip self-referential dependency (package depends on itself)
            continue;
          }
          filteredDeps[depName] = depVersion;
        }
        if (Object.keys(filteredDeps).length > 0) {
          await this.installDependencies(filteredDeps, options);
        }
      }

      // Extract and install package
      await this.extractAndInstallPackage(packageData, name, resolvedVersion, options);

      // Cache package
      await this.cachePackage(cacheKey, packageData);

      this.emit('installComplete', {
        name: name,
        version: resolvedVersion
      });

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
      const url = version 
        ? `${this.registryUrl}/packages/${packageName}/${version}`
        : `${this.registryUrl}/packages/${packageName}`;

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
   * Get available versions for a package
   */
  async getPackageVersions(packageName: string): Promise<string[]> {
    try {
      const response = await fetch(`${this.registryUrl}/packages/${packageName}/versions`, {
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

  private async createPackageTarball(packageDir: string, metadata: PackageMetadata): Promise<string> {
    const tarballName = `${metadata.name}-${metadata.version}.tgz`;
    const tarballPath = path.join(this.cacheDir, 'temp', tarballName);
    
    await fs.ensureDir(path.dirname(tarballPath));

    // Create tarball with only specified files
    await tar.create({
      gzip: true,
      file: tarballPath,
      cwd: packageDir,
      prefix: 'package/',
      filter: (path: string) => {
        // Include files matching patterns in metadata.files
        return this.matchesFilePatterns(path, metadata.files);
      }
    }, ['.']);

    return tarballPath;
  }

  private async uploadPackage(tarballPath: string, metadata: PackageMetadata, options: PublishOptions): Promise<void> {
    const formData = new FormData();
    const tarballBuffer = await fs.readFile(tarballPath);
    
    formData.append('package', new Blob([tarballBuffer]), `${metadata.name}-${metadata.version}.tgz`);
    formData.append('metadata', JSON.stringify(metadata));
    formData.append('access', options.access);
    formData.append('tag', options.tag);

    const response = await fetch(`${this.registryUrl}/packages/${metadata.name}`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Publish failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
  }

  private async resolveVersion(packageName: string, versionSpec: string): Promise<string> {
    if (versionSpec === 'latest') {
      const packageInfo = await this.getPackageInfo(packageName);
      return packageInfo.version;
    }

    if (semver.valid(versionSpec)) {
      return versionSpec;
    }

    // Resolve version range
    const versions = await this.getPackageVersions(packageName);
    const resolved = semver.maxSatisfying(versions, versionSpec);
    
    if (!resolved) {
      throw new Error(`No version found matching: ${versionSpec}`);
    }

    return resolved;
  }

  /**
   * Download a package without installing it to disk.
   * Useful for in-memory package loading.
   *
   * @param packageName - Package name (e.g., "@namespace/package-name")
   * @param version - Package version (e.g., "1.0.0")
   * @returns Object with tarball Buffer and package metadata
   */
  async downloadPackageBuffer(packageName: string, version: string): Promise<{ tarball: Buffer; metadata: PackageMetadata }> {
    return this.downloadPackage(packageName, version);
  }

  private async downloadPackage(packageName: string, version: string): Promise<{ tarball: Buffer; metadata: PackageMetadata }> {
    // Registry endpoint format: /packages/@scope/name/download/version
    const response = await fetch(`${this.registryUrl}/packages/${packageName}/download/${version}`, {
      headers: this.getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const tarballBuffer = Buffer.from(arrayBuffer);

    // Extract metadata from the .pdpkg (ZIP) file instead of calling getPackageInfo
    // Try prompd.json first, fall back to manifest.json for older packages
    let AdmZip: { new(buffer: Buffer): InstanceType<typeof import('adm-zip')> };
    try {
      AdmZip = (await import('adm-zip')).default;
    } catch {
      throw new Error('adm-zip package is required for package installation. Run: npm install adm-zip');
    }
    const zip = new AdmZip(tarballBuffer);

    // Check for prompd.json first (newer format), then manifest.json (legacy)
    let manifestEntry = zip.getEntry('prompd.json');
    if (!manifestEntry) {
      manifestEntry = zip.getEntry('manifest.json');
    }

    if (!manifestEntry) {
      throw new Error(`Invalid package: neither prompd.json nor manifest.json found in ${packageName}@${version}`);
    }

    const manifestContent = manifestEntry.getData().toString('utf8');
    const metadata = JSON.parse(manifestContent) as PackageMetadata;

    return {
      tarball: tarballBuffer,
      metadata
    };
  }

  private async installDependencies(dependencies: Record<string, string>, options: InstallOptions): Promise<void> {
    for (const [name, versionSpec] of Object.entries(dependencies)) {
      this.emit('installingDependency', { name, version: versionSpec });
      await this.install(name, { ...options, version: versionSpec });
    }
  }

  private static readonly MAX_FILE_SIZE_IN_ZIP = 10 * 1024 * 1024; // 10MB per file

  private async extractAndInstallPackage(
    packageData: { tarball: Buffer; metadata: Partial<PackageMetadata> },
    packageName: string,
    version: string,
    options: InstallOptions
  ): Promise<void> {
    const workspaceRoot = options.workspaceRoot || process.cwd();

    // Determine and validate package type from metadata (defaults to 'package')
    const rawType = packageData.metadata?.type || 'package';
    if (!isValidPackageType(rawType)) {
      throw new Error(`Invalid package type '${rawType}' in ${packageName}@${version}. Valid types: package, workflow, skill, node-template`);
    }
    const packageType: PackageType = rawType;
    const typeDir = getInstallDirForType(packageType);

    const os = require('os');
    const installDir = options.global
      ? path.join(os.homedir(), '.prompd', typeDir, packageName, version)
      : path.join(workspaceRoot, '.prompd', typeDir, packageName, version);

    await fs.ensureDir(installDir);

    // Extract .pdpkg (ZIP archive) using adm-zip
    let AdmZip: { new(buffer: Buffer): InstanceType<typeof import('adm-zip')> };
    try {
      AdmZip = (await import('adm-zip')).default;
    } catch {
      throw new Error('adm-zip package is required for package installation. Run: npm install adm-zip');
    }
    const zip = new AdmZip(packageData.tarball);

    // Validate individual file sizes before extraction
    const zipEntries = zip.getEntries();
    for (const entry of zipEntries) {
      if (entry.header.size > RegistryClient.MAX_FILE_SIZE_IN_ZIP) {
        throw new Error(
          `File too large in package: ${entry.entryName} (${entry.header.size} bytes, max: ${RegistryClient.MAX_FILE_SIZE_IN_ZIP})`
        );
      }
      // ZIP slip protection: reject path traversal
      const normalized = path.normalize(entry.entryName);
      if (normalized.includes('..') || path.isAbsolute(entry.entryName)) {
        throw new Error(`Security violation: path traversal detected in ${entry.entryName}`);
      }
    }

    zip.extractAllTo(installDir, true);

    // Write package metadata for cache tracking
    const metadataPath = path.join(installDir, '.prmdmeta');
    await fs.writeJson(metadataPath, packageData.metadata, { spaces: 2 });

    // Deploy to tool-native directories if --tools was specified
    if (options.tools && options.tools.length > 0) {
      if (packageType !== 'skill') {
        throw new Error(`--tools flag is only valid for skills, but package type is '${packageType}'`);
      }

      // Track successful deployments for rollback on failure
      const deployedDirs: string[] = [];
      try {
        for (const toolName of options.tools) {
          const deployedDir = await this.deploySkillToTool(installDir, packageName, toolName);
          deployedDirs.push(deployedDir);
        }
      } catch (deployError) {
        // Rollback successful deployments
        for (const dir of deployedDirs) {
          await fs.remove(dir).catch(() => {});
        }
        throw deployError;
      }
    }
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

    // Copy all files from the install dir to the tool deploy dir
    await fs.copy(skillDir, skillDeployDir, { overwrite: true });

    // Write a reference marker so we know this was deployed by prompd
    const markerPath = path.join(skillDeployDir, '.prompd-source');
    await fs.writeJson(markerPath, {
      source: skillDir,
      deployedAt: new Date().toISOString(),
      tool: toolName,
    }, { spaces: 2 });

    return skillDeployDir;
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
    // Simple glob matching - in production would use proper glob library
    for (const pattern of patterns) {
      if (pattern === '**/*' || pattern === '*') {
        return true;
      }
      
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        if (regex.test(filePath)) {
          return true;
        }
      } else if (filePath === pattern) {
        return true;
      }
    }
    return false;
  }

  private async getCachedPackage(cacheKey: string): Promise<string | null> {
    const cachePath = path.join(this.cacheDir, 'packages', cacheKey);
    return await fs.pathExists(cachePath) ? cachePath : null;
  }

  private async installFromCache(cachePath: string, packageName: string, version: string, options: InstallOptions): Promise<void> {
    this.emit('installingFromCache', { name: packageName, version });

    const tarballBuffer = await fs.readFile(cachePath);

    // Try to read full metadata from the cached .prmdmeta file alongside the tarball
    const metadataPath = cachePath + '.meta';
    let metadata: Partial<PackageMetadata> = { name: packageName, version };
    if (await fs.pathExists(metadataPath)) {
      try {
        metadata = await fs.readJson(metadataPath);
      } catch {
        // Fall back to minimal metadata if .meta file is corrupt
      }
    }

    const packageData = { tarball: tarballBuffer, metadata };
    await this.extractAndInstallPackage(packageData, packageName, version, options);
  }

  private async cachePackage(cacheKey: string, packageData: { tarball: Buffer; metadata: Partial<PackageMetadata> }): Promise<void> {
    const cachePath = path.join(this.cacheDir, 'packages', cacheKey);
    await fs.ensureDir(path.dirname(cachePath));
    await fs.writeFile(cachePath, packageData.tarball);
    // Save full metadata alongside the tarball so cache installs preserve package type
    await fs.writeJson(cachePath + '.meta', packageData.metadata, { spaces: 2 });
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

    // Validate package name (use existing security manager)
    const sanitizedName = SecurityManager.sanitizeToolName(metadata.name);
    if (sanitizedName !== metadata.name) {
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
   * Create package tarball Buffer using file system abstraction.
   * Supports both in-memory and disk-based package creation.
   */
  private async createPackageTarballBuffer(
    packagePath: string,
    metadata: PackageMetadata,
    fileSystem: IFileSystem
  ): Promise<Buffer> {
    // Memory-based path
    if (fileSystem instanceof MemoryFileSystem) {
      return await fileSystem.createPackageBuffer(packagePath, metadata, {
        filter: (filePath: string) => this.matchesFilePatterns(filePath, metadata.files)
      });
    }

    // Disk-based path (existing logic)
    const tarballName = `${metadata.name}-${metadata.version}.tgz`;
    const tarballPath = path.join(this.cacheDir, 'temp', tarballName);

    await fs.ensureDir(path.dirname(tarballPath));

    await tar.create({
      gzip: true,
      file: tarballPath,
      cwd: packagePath,
      prefix: 'package/',
      filter: (filePath: string) => this.matchesFilePatterns(filePath, metadata.files)
    }, ['.']);

    const buffer = await fs.readFile(tarballPath);
    await fs.remove(tarballPath); // Cleanup

    return buffer;
  }

  /**
   * Upload package Buffer to registry.
   * Uses form-data's submit() which handles Content-Length, transport, and piping.
   */
  async uploadPackageBuffer(
    tarballBuffer: Buffer,
    metadata: PackageMetadata,
    options: PublishOptions
  ): Promise<void> {
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
    const url = new URL(`${this.registryUrl}/packages/${metadata.name}`);

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

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Publish failed: ${response.statusCode} - ${response.body}`);
    }
  }
}

/**
 * Default registry configuration
 */
export const createDefaultRegistryConfig = (): LegacyRegistryConfig => ({
  registryUrl: process.env.PROMPD_REGISTRY_URL || 'https://registry.prompdhub.ai',
  authToken: process.env.PROMPD_AUTH_TOKEN,
  cacheDir: path.join(require('os').homedir(), '.prmd', 'cache'),
  timeout: 30000,
  maxPackageSize: 50 * 1024 * 1024 // 50MB
});