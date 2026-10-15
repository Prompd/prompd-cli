export interface ModelEntry {
  name: string;
  family: string;
  size: string;
  quantization: string;
  variant?: string;
  version?: string;
  weightsPath: string;
  sizeBytes: number;
  sha256: string;
  installedAt: string;
  isDefault: boolean;
}

export interface Catalog {
  version: 1;
  models: ModelEntry[];
}

export interface DaemonLock {
  port: number;
  pid: number;
  model: string;
  startedAt: string;
  binaryPath: string;
}

export interface DaemonStatus {
  running: boolean;
  model?: string;
  port?: number;
  pid?: number;
  startedAt?: string;
  binaryPath?: string;
  installedModels: ModelEntry[];
}
