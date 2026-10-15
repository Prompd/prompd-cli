/* @prompd/core's PackageStore over Node fs: the write sink for every CLI install.
 * Core never touches disk itself; it hands paths (posix joins of the root the
 * CLI chose) and bytes to this store. */
import * as fs from 'fs-extra';
import * as path from 'path';
import type { PackageStore } from '@prompd/core';

export class NodePackageStore implements PackageStore {
  async writeFile(p: string, content: string): Promise<void> {
    await fs.ensureDir(path.dirname(p));
    await fs.writeFile(p, content, 'utf8');
  }

  async writeBytes(p: string, bytes: Uint8Array): Promise<void> {
    await fs.ensureDir(path.dirname(p));
    await fs.writeFile(p, bytes);
  }

  async removeDir(p: string): Promise<void> {
    await fs.remove(p);
  }

  async removeFile(p: string): Promise<void> {
    await fs.remove(p);
  }

  async readFile(p: string): Promise<string | null> {
    return (await fs.pathExists(p)) ? fs.readFile(p, 'utf8') : null;
  }

  async readBytes(p: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(p));
  }

  async readdir(p: string): Promise<string[]> {
    return (await fs.pathExists(p)) ? fs.readdir(p) : [];
  }
}
