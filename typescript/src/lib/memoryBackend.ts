/**
 * Memory Backend Interface
 *
 * Abstract interface that CLI uses for memory operations.
 * Implementations are provided by the calling environment (frontend, tray, service).
 */

/**
 * Memory backend interface - implemented by calling environment
 */
export interface MemoryBackend {
  get(scope: string, namespace: string, key: string): Promise<unknown>
  set(scope: string, namespace: string, key: string, value: unknown, ttl?: number): Promise<void>
  delete(scope: string, namespace: string, key: string): Promise<void>
  list(scope: string, namespace: string): Promise<string[]>
  clear(scope: string, namespace: string): Promise<void>
}

/**
 * In-memory backend for execution scope (fast, temporary)
 * This is the default for execution-scoped memory
 */
export class InMemoryBackend implements MemoryBackend {
  private store: Map<string, { value: unknown; expiresAt?: number }> = new Map()

  private makeKey(scope: string, namespace: string, key: string): string {
    return `${scope}:${namespace}:${key}`
  }

  private cleanupExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.store.delete(key)
      }
    }
  }

  async get(scope: string, namespace: string, key: string): Promise<unknown> {
    this.cleanupExpired()
    const entry = this.store.get(this.makeKey(scope, namespace, key))
    if (!entry) return null
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(this.makeKey(scope, namespace, key))
      return null
    }
    return entry.value
  }

  async set(scope: string, namespace: string, key: string, value: unknown, ttl?: number): Promise<void> {
    const expiresAt = ttl ? Date.now() + (ttl * 1000) : undefined
    this.store.set(this.makeKey(scope, namespace, key), { value, expiresAt })
  }

  async delete(scope: string, namespace: string, key: string): Promise<void> {
    this.store.delete(this.makeKey(scope, namespace, key))
  }

  async list(scope: string, namespace: string): Promise<string[]> {
    this.cleanupExpired()
    const prefix = `${scope}:${namespace}:`
    const keys: string[] = []
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key.substring(prefix.length))
      }
    }
    return keys
  }

  async clear(scope: string, namespace: string): Promise<void> {
    const prefix = `${scope}:${namespace}:`
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key)
      }
    }
  }
}

/**
 * No-op backend for when memory is disabled
 */
export class NoOpBackend implements MemoryBackend {
  async get(): Promise<unknown> { return null }
  async set(): Promise<void> { }
  async delete(): Promise<void> { }
  async list(): Promise<string[]> { return [] }
  async clear(): Promise<void> { }
}
