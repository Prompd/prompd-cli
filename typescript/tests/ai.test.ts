jest.mock('../src/lib/ai/paths', () => {
  const actualPath = jest.requireActual<typeof import('path')>('path');
  const actualOs = jest.requireActual<typeof import('os')>('os');
  const actualFs = jest.requireActual<typeof import('fs-extra')>('fs-extra');
  const tmpRoot: string = actualFs.mkdtempSync(actualPath.join(actualOs.tmpdir(), 'prompd-ai-test-'));
  return {
    aiRoot: () => tmpRoot,
    binDir: () => actualPath.join(tmpRoot, 'bin'),
    modelsDir: () => actualPath.join(tmpRoot, 'models'),
    adaptersDir: () => actualPath.join(tmpRoot, 'adapters'),
    configPath: () => actualPath.join(tmpRoot, 'config.json'),
    pidPath: () => actualPath.join(tmpRoot, 'daemon.pid'),
    lockPath: () => actualPath.join(tmpRoot, 'daemon.lock'),
    catalogPath: () => actualPath.join(tmpRoot, 'catalog.json'),
  };
});

import * as fs from 'fs-extra';
import { loadCatalog, saveCatalog, findModel, getDefaultModel } from '../src/lib/ai/catalog';
import { getStatus, clearLock } from '../src/lib/ai/daemon';
import { catalogPath, lockPath, aiRoot } from '../src/lib/ai/paths';

describe('prompd ai — catalog and daemon scaffolding', () => {
  afterAll(() => {
    fs.removeSync(aiRoot());
  });

  beforeEach(async () => {
    await clearLock();
    if (await fs.pathExists(catalogPath())) {
      await fs.remove(catalogPath());
    }
  });

  describe('catalog', () => {
    it('returns empty catalog when file does not exist', async () => {
      const catalog = await loadCatalog();
      expect(catalog).toEqual({ version: 1, models: [] });
    });

    it('round-trips a saved catalog', async () => {
      await saveCatalog({
        version: 1,
        models: [
          {
            name: 'gemma-4-e4b-q4',
            family: 'gemma-4',
            size: 'e4b',
            quantization: 'q4',
            weightsPath: '/tmp/weights.gguf',
            sizeBytes: 2_500_000_000,
            sha256: 'abc123',
            installedAt: '2026-04-19T00:00:00.000Z',
            isDefault: true,
          },
        ],
      });

      const loaded = await loadCatalog();
      expect(loaded.models).toHaveLength(1);
      expect(loaded.models[0].name).toBe('gemma-4-e4b-q4');
    });

    it('findModel returns the matching entry, undefined when missing', async () => {
      await saveCatalog({
        version: 1,
        models: [makeModel('model-a', false), makeModel('model-b', true)],
      });

      expect((await findModel('model-b'))?.isDefault).toBe(true);
      expect(await findModel('nope')).toBeUndefined();
    });

    it('getDefaultModel prefers explicit default, falls back to first', async () => {
      await saveCatalog({
        version: 1,
        models: [makeModel('a', false), makeModel('b', true)],
      });
      expect((await getDefaultModel())?.name).toBe('b');

      await saveCatalog({
        version: 1,
        models: [makeModel('a', false), makeModel('c', false)],
      });
      expect((await getDefaultModel())?.name).toBe('a');
    });

    it('gracefully handles a corrupt catalog file', async () => {
      await fs.ensureFile(catalogPath());
      await fs.writeFile(catalogPath(), '{ not valid json', 'utf-8');
      const catalog = await loadCatalog();
      expect(catalog).toEqual({ version: 1, models: [] });
    });
  });

  describe('daemon status', () => {
    it('reports not running when no lock file exists', async () => {
      const status = await getStatus();
      expect(status.running).toBe(false);
      expect(status.installedModels).toEqual([]);
    });

    it('reports not running and clears a stale lock (dead pid)', async () => {
      await fs.ensureFile(lockPath());
      await fs.writeJSON(lockPath(), {
        port: 11434,
        pid: 999999999,
        model: 'gemma-4-e4b-q4',
        startedAt: '2026-04-19T00:00:00.000Z',
        binaryPath: '/nonexistent/llama-server',
      });

      const status = await getStatus();
      expect(status.running).toBe(false);
      expect(await fs.pathExists(lockPath())).toBe(false);
    });

    it('includes installed-models list even when not running', async () => {
      await saveCatalog({ version: 1, models: [makeModel('x', true)] });
      const status = await getStatus();
      expect(status.running).toBe(false);
      expect(status.installedModels).toHaveLength(1);
      expect(status.installedModels[0].name).toBe('x');
    });
  });
});

function makeModel(name: string, isDefault: boolean) {
  return {
    name,
    family: 'test',
    size: 's',
    quantization: 'q4',
    weightsPath: '',
    sizeBytes: 0,
    sha256: '',
    installedAt: '',
    isDefault,
  };
}
