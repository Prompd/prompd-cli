import * as fs from 'fs-extra';
import { aiRoot, catalogPath } from './paths';
import { Catalog, ModelEntry } from './types';

const EMPTY_CATALOG: Catalog = { version: 1, models: [] };

export async function loadCatalog(): Promise<Catalog> {
  const p = catalogPath();
  if (!(await fs.pathExists(p))) {
    return { version: 1, models: [] };
  }
  try {
    const raw = await fs.readJSON(p);
    if (!raw || raw.version !== 1 || !Array.isArray(raw.models)) {
      return { version: 1, models: [] };
    }
    return raw as Catalog;
  } catch {
    return { version: 1, models: [] };
  }
}

export async function saveCatalog(catalog: Catalog): Promise<void> {
  await fs.ensureDir(aiRoot());
  await fs.writeJSON(catalogPath(), catalog, { spaces: 2 });
}

export async function findModel(name: string): Promise<ModelEntry | undefined> {
  const catalog = await loadCatalog();
  return catalog.models.find(m => m.name === name);
}

export async function getDefaultModel(): Promise<ModelEntry | undefined> {
  const catalog = await loadCatalog();
  return catalog.models.find(m => m.isDefault) ?? catalog.models[0];
}
