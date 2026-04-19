import * as path from 'path';
import * as os from 'os';

export function aiRoot(): string {
  return path.join(os.homedir(), '.prompd', 'ai');
}

export function binDir(): string {
  return path.join(aiRoot(), 'bin');
}

export function modelsDir(): string {
  return path.join(aiRoot(), 'models');
}

export function adaptersDir(): string {
  return path.join(aiRoot(), 'adapters');
}

export function configPath(): string {
  return path.join(aiRoot(), 'config.json');
}

export function pidPath(): string {
  return path.join(aiRoot(), 'daemon.pid');
}

export function lockPath(): string {
  return path.join(aiRoot(), 'daemon.lock');
}

export function catalogPath(): string {
  return path.join(aiRoot(), 'catalog.json');
}
