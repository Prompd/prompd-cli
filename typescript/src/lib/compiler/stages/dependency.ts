/**
 * Dependency Resolution Stage
 *
 * Resolves 'using:' imports and 'inherits:' chains, handling both local file
 * paths and package references with alias resolution.
 *
 * This is a direct port of the Python CLI's DependencyResolutionStage.
 */

import { CompilerStage, CompilationContext, ResolvedPackage } from '../types';
import { resolvePackage, resolvePackageFile } from '../package-resolver';

export class DependencyResolutionStage implements CompilerStage {
  async process(context: CompilationContext): Promise<void> {
    if (!context.metadata) {
      return;
    }

    // Initialize resolved packages
    const resolvedPackages: Record<string, ResolvedPackage> = {};

    // Process 'using' field (package imports with optional prefixes)
    if (context.metadata.using) {
      await this.processUsingField(context, context.metadata.using, resolvedPackages);
    }

    // Store resolved imports
    context.dependencies.imports = resolvedPackages;

    // Process 'inherits' field (can be package reference or direct file path)
    if (context.metadata.inherits) {
      await this.processInheritsField(context, context.metadata.inherits, resolvedPackages);
    }

    // Process content reference fields for alias resolution
    await this.processContentFieldAliases(context, resolvedPackages);
  }

  /**
   * Process the 'using' field for package imports.
   */
  private async processUsingField(
    context: CompilationContext,
    usingImports: any,
    resolvedPackages: Record<string, ResolvedPackage>
  ): Promise<void> {
    if (typeof usingImports === 'string') {
      // Simple string: using: "@package@version"
      await this.resolvePackageImport(context, usingImports, null, resolvedPackages);
    } else if (Array.isArray(usingImports)) {
      // List of packages (can be strings, dicts, or objects)
      for (const item of usingImports) {
        if (typeof item === 'string') {
          // Simple string in list
          await this.resolvePackageImport(context, item, null, resolvedPackages);
        } else if (typeof item === 'object' && item !== null) {
          // Object with name and REQUIRED prefix
          const packageRef = item.name || item.package || '';
          const prefix = item.prefix;

          if (packageRef) {
            // Prefix is required for 'using' - the whole point is to create a shorthand
            if (!prefix) {
              context.addError(
                `Package '${packageRef}' in 'using' field must have a prefix for shorthand access`
              );
              continue;
            }

            await this.resolvePackageImport(context, packageRef, prefix, resolvedPackages);
          }
        }
      }
    } else if (typeof usingImports === 'object' && usingImports !== null) {
      // Dict format: {package: prefix} or structured format
      for (const [key, value] of Object.entries(usingImports)) {
        if (typeof value === 'string') {
          // Format: {"@package@version": "prefix"}
          await this.resolvePackageImport(context, key, value, resolvedPackages);
        } else if (typeof value === 'object' && value !== null && 'prefix' in value) {
          // Format: {"@package@version": {"prefix": "alias"}}
          const prefix = (value as any).prefix;
          await this.resolvePackageImport(context, key, prefix, resolvedPackages);
        }
      }
    }
  }

  /**
   * Resolve a single package import.
   */
  private async resolvePackageImport(
    context: CompilationContext,
    packageRef: string,
    prefix: string | null,
    resolvedPackages: Record<string, ResolvedPackage>
  ): Promise<void> {
    try {
      // Pass fileSystem, registryUrl, and workspaceRoot to enable proper package resolution
      const packagePath = await resolvePackage(packageRef, {
        fileSystem: context.fileSystem,
        registryUrl: context.registryUrl,
        workspaceRoot: context.workspaceRoot
      });
      resolvedPackages[packageRef] = {
        path: packagePath,
        prefix: prefix || undefined
      };

      if (context.verbose) {
        if (prefix) {
          console.log(`✓ Resolved package: ${packageRef} -> ${packagePath} (prefix: ${prefix})`);
        } else {
          console.log(`✓ Resolved package: ${packageRef} -> ${packagePath}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Find location of 'using:' in source
      const location = context.findLocation(/using:/);
      context.addDiagnostic({
        message: `Failed to resolve package ${packageRef}: ${errorMessage}`,
        severity: 'warning',
        source: 'dependency',
        code: 'PACKAGE_NOT_FOUND',
        ...location
      });
    }
  }

  /**
   * Process the 'inherits' field.
   */
  private async processInheritsField(
    context: CompilationContext,
    inheritsRef: string,
    resolvedPackages: Record<string, ResolvedPackage>
  ): Promise<void> {
    // Resolve aliases in inherits field
    const resolvedInheritsRef = this.resolveAliasInPath(inheritsRef, resolvedPackages);

    if (resolvedInheritsRef !== inheritsRef) {
      // Update the metadata with the resolved reference
      if (context.metadata) {
        context.metadata.inherits = resolvedInheritsRef;
      }
      if (context.verbose) {
        console.log(`✓ Resolved alias in inherits: ${resolvedInheritsRef}`);
      }
    }

    // Check if it's a local file path (starts with . or / or doesn't start with @)
    if (
      resolvedInheritsRef.startsWith('./') ||
      resolvedInheritsRef.startsWith('../') ||
      resolvedInheritsRef.startsWith('/') ||
      (!resolvedInheritsRef.startsWith('@') && resolvedInheritsRef.includes('.prmd'))
    ) {
      // Direct file path - resolve relative to source file
      const sourceDir = context.fileSystem.dirname(context.sourceFile);
      const parentPath = context.fileSystem.resolve(sourceDir, resolvedInheritsRef);

      // Verify the inherited file exists
      const fileExists = await context.fileSystem.exists(parentPath);
      if (!fileExists) {
        const location = context.findLocation(/inherits:/);
        context.addDiagnostic({
          message: `Inherited file not found: "${resolvedInheritsRef}" (resolved to: ${parentPath})`,
          severity: 'error',
          source: 'dependency',
          code: 'INHERITS_FILE_NOT_FOUND',
          ...location
        });
        return; // Don't set dependencies.inherits if file doesn't exist
      }

      context.dependencies.inherits = parentPath;

      if (context.verbose) {
        console.log(`✓ Resolved inheritance file: ${resolvedInheritsRef} -> ${parentPath}`);
      }
    } else {
      // Package reference with file path - resolve through package system
      try {
        // Parse package reference and file path
        // Format: @namespace/package@version/path/to/file.prmd
        const pattern = /^(@[\w.-]+\/[\w.-]+@[\w.-]+)\/(.+)$/;
        const match = resolvedInheritsRef.match(pattern);

        if (match) {
          const packageRef = match[1]; // @namespace/package@version
          const filePathInPackage = match[2]; // path/to/file.prmd

          if (context.verbose) {
            console.log(`Parsing package inheritance: ${packageRef} / ${filePathInPackage}`);
          }

          // Resolve the package to its local path (pass fileSystem, registryUrl, and workspaceRoot)
          const packagePath = await resolvePackage(packageRef, {
            fileSystem: context.fileSystem,
            registryUrl: context.registryUrl,
            workspaceRoot: context.workspaceRoot
          });

          // Construct full path to the inherited file
          const fullFilePath = resolvePackageFile(packagePath, filePathInPackage);

          // Verify the file exists within the package
          const fileExists = await context.fileSystem.exists(fullFilePath);
          if (!fileExists) {
            const location = context.findLocation(/inherits:/);
            context.addDiagnostic({
              message: `Inherited file not found in package: "${filePathInPackage}" (package: ${packageRef})`,
              severity: 'error',
              source: 'dependency',
              code: 'INHERITS_FILE_NOT_FOUND',
              ...location
            });
            return;
          }

          context.dependencies.inherits = fullFilePath;

          if (context.verbose) {
            console.log(`✓ Resolved inheritance package: ${resolvedInheritsRef} -> ${fullFilePath}`);
          }
        } else {
          // Fallback: try as direct package reference (pass fileSystem, registryUrl, and workspaceRoot)
          const parentPath = await resolvePackage(resolvedInheritsRef, {
            fileSystem: context.fileSystem,
            registryUrl: context.registryUrl,
            workspaceRoot: context.workspaceRoot
          });

          // Verify the package directory exists
          const dirExists = await context.fileSystem.exists(parentPath);
          if (!dirExists) {
            const location = context.findLocation(/inherits:/);
            context.addDiagnostic({
              message: `Inherited package not found: "${resolvedInheritsRef}"`,
              severity: 'error',
              source: 'dependency',
              code: 'INHERITS_PACKAGE_NOT_FOUND',
              ...location
            });
            return;
          }

          context.dependencies.inherits = parentPath;

          if (context.verbose) {
            console.log(`✓ Resolved inheritance package (direct): ${resolvedInheritsRef} -> ${parentPath}`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Find location of 'inherits:' in source
        const location = context.findLocation(/inherits:/);
        context.addDiagnostic({
          message: `Failed to resolve inheritance "${resolvedInheritsRef}": ${errorMessage}`,
          severity: 'error',
          source: 'dependency',
          code: 'INHERITS_NOT_FOUND',
          ...location
        });
      }
    }
  }

  /**
   * Process content reference fields (system, context, user, assistant, response) for alias resolution.
   */
  private async processContentFieldAliases(
    context: CompilationContext,
    resolvedPackages: Record<string, ResolvedPackage>
  ): Promise<void> {
    if (!context.metadata) {
      return;
    }

    const contentFields = ['system', 'assistant', 'context', 'user', 'response'];

    for (const fieldName of contentFields) {
      const fieldValue = (context.metadata as any)[fieldName];

      if (fieldValue) {
        // Handle both single strings and lists of strings
        if (typeof fieldValue === 'string') {
          const resolvedValue = this.resolveAliasInPath(fieldValue, resolvedPackages);
          if (resolvedValue !== fieldValue) {
            (context.metadata as any)[fieldName] = resolvedValue;
            if (context.verbose) {
              console.log(`✓ Resolved alias in ${fieldName}: ${fieldValue} -> ${resolvedValue}`);
            }
          }
        } else if (Array.isArray(fieldValue)) {
          const resolvedList: any[] = [];
          for (const item of fieldValue) {
            if (typeof item === 'string') {
              const resolvedItem = this.resolveAliasInPath(item, resolvedPackages);
              resolvedList.push(resolvedItem);
              if (resolvedItem !== item && context.verbose) {
                console.log(`✓ Resolved alias in ${fieldName}: ${item} -> ${resolvedItem}`);
              }
            } else {
              resolvedList.push(item);
            }
          }
          (context.metadata as any)[fieldName] = resolvedList;
        }
      }
    }
  }

  /**
   * Resolve alias prefixes in file paths.
   *
   * Examples:
   * - "@pkg/templates/file.prmd" with "@pkg" aliased to "@scope/package@version"
   *   becomes "@scope/package@version/templates/file.prmd"
   */
  private resolveAliasInPath(
    pathStr: string,
    resolvedPackages: Record<string, ResolvedPackage>
  ): string {
    if (!pathStr.startsWith('@') || !pathStr.includes('/')) {
      return pathStr;
    }

    // Extract the potential alias (everything before the first '/')
    // Use indexOf to preserve the full remaining path (split with limit truncates)
    const firstSlashIndex = pathStr.indexOf('/');
    const potentialAlias = pathStr.substring(0, firstSlashIndex); // e.g., "@pkg"
    const remainingPath = pathStr.substring(firstSlashIndex + 1); // e.g., "templates/file.prmd"

    // Look for this alias in resolved packages
    for (const [packageName, packageInfo] of Object.entries(resolvedPackages)) {
      if (packageInfo.prefix === potentialAlias) {
        // Found the alias! Replace it with the full package name
        const resolvedPath = `${packageName}/${remainingPath}`;
        return resolvedPath;
      }
    }

    // No alias found, return original path
    return pathStr;
  }

  getName(): string {
    return 'Dependency Resolution';
  }
}
