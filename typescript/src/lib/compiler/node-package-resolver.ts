/**
 * Node package resolver — the disk/registry-backed implementation of the
 * @prompd/core IPackageResolver seam. Injected into the compiler by the CLI's
 * PrompdCompiler so `using:`/`inherits:` package references resolve as before.
 */
import { IPackageResolver, ResolvePackageOptions } from '@prompd/core';
import { resolvePackage } from './package-resolver';

export class NodePackageResolver implements IPackageResolver {
  resolvePackage(packageRef: string, options: ResolvePackageOptions): Promise<string> {
    return resolvePackage(packageRef, options);
  }
}
