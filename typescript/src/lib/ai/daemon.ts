import * as fs from 'fs-extra';
import { lockPath } from './paths';
import { DaemonLock, DaemonStatus } from './types';
import { loadCatalog } from './catalog';

export async function readLock(): Promise<DaemonLock | null> {
  const p = lockPath();
  if (!(await fs.pathExists(p))) return null;
  try {
    const raw = await fs.readJSON(p);
    if (
      typeof raw?.port !== 'number' ||
      typeof raw?.pid !== 'number' ||
      typeof raw?.model !== 'string' ||
      typeof raw?.startedAt !== 'string' ||
      typeof raw?.binaryPath !== 'string'
    ) {
      return null;
    }
    return raw as DaemonLock;
  } catch {
    return null;
  }
}

export async function clearLock(): Promise<void> {
  const p = lockPath();
  if (await fs.pathExists(p)) {
    await fs.remove(p);
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    // signal 0 performs an existence check without sending a real signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getStatus(): Promise<DaemonStatus> {
  const catalog = await loadCatalog();
  const lock = await readLock();

  if (!lock) {
    return { running: false, installedModels: catalog.models };
  }

  if (!isPidAlive(lock.pid)) {
    await clearLock();
    return { running: false, installedModels: catalog.models };
  }

  return {
    running: true,
    model: lock.model,
    port: lock.port,
    pid: lock.pid,
    startedAt: lock.startedAt,
    binaryPath: lock.binaryPath,
    installedModels: catalog.models,
  };
}
