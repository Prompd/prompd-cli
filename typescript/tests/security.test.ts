import { SecurityManager } from '../src/lib/security';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

describe('SecurityManager', () => {

  describe('validateFilePath', () => {
    it('should validate safe file paths', () => {
      const safePath = 'test/file.txt';
      expect(() => SecurityManager.validateFilePath(safePath)).not.toThrow();
    });

    it('should reject paths with blocked directories', () => {
      expect(() => SecurityManager.validateFilePath('../etc/passwd')).toThrow();
      expect(() => SecurityManager.validateFilePath('C:\\Windows\\System32\\file.txt')).toThrow();
    });

    it('should validate file extensions when specified', () => {
      expect(() => SecurityManager.validateFilePath('file.txt', ['.txt'])).not.toThrow();
      expect(() => SecurityManager.validateFilePath('file.exe', ['.txt'])).toThrow();
    });
  });

  describe('sanitizeToolName', () => {
    it('should allow alphanumeric and safe characters', () => {
      expect(SecurityManager.sanitizeToolName('my-tool_name')).toBe('my-tool_name');
      expect(SecurityManager.sanitizeToolName('tool123')).toBe('tool123');
    });

    it('should remove unsafe characters', () => {
      expect(SecurityManager.sanitizeToolName('tool name')).toBe('toolname');
      expect(SecurityManager.sanitizeToolName('tool@#$name')).toBe('toolname');
    });

    it('should enforce length limits', () => {
      const longName = 'a'.repeat(100);
      expect(() => SecurityManager.sanitizeToolName(longName)).toThrow();
    });

    it('should reject empty names', () => {
      expect(() => SecurityManager.sanitizeToolName('')).toThrow();
      expect(() => SecurityManager.sanitizeToolName('   ')).toThrow();
    });
  });

  describe('createSecureTempPath', () => {
    it('should create unique temp paths', () => {
      const path1 = SecurityManager.createSecureTempPath('test');
      const path2 = SecurityManager.createSecureTempPath('test');
      expect(path1).not.toBe(path2);
    });

    it('should include prefix and extension', () => {
      const tempPath = SecurityManager.createSecureTempPath('myprefix', '.json');
      expect(tempPath).toContain('myprefix');
      expect(tempPath).toContain('.json');
    });
  });

  describe('validateFileSize', () => {
    const testDir = path.join(os.tmpdir(), 'prompd-test-security');
    const testFile = path.join(testDir, 'test-file.txt');

    beforeAll(async () => {
      await fs.ensureDir(testDir);
    });

    afterAll(async () => {
      await fs.remove(testDir);
    });

    it('should accept files within size limit', async () => {
      // Create a small file (1KB)
      await fs.writeFile(testFile, 'a'.repeat(1024));
      await expect(SecurityManager.validateFileSize(testFile)).resolves.not.toThrow();
    });

    it('should reject files exceeding size limit', async () => {
      // Create a large file (11MB) - exceeds 10MB limit
      const largeContent = Buffer.alloc(11 * 1024 * 1024);
      await fs.writeFile(testFile, largeContent);
      await expect(SecurityManager.validateFileSize(testFile)).rejects.toThrow('File too large');
    });

    it('should handle non-existent files', async () => {
      await expect(SecurityManager.validateFileSize('nonexistent.txt')).rejects.toThrow();
    });
  });

  describe('sanitizeParameters', () => {
    it('should sanitize string parameters', () => {
      const params = { name: 'test value' };
      const sanitized = SecurityManager.sanitizeParameters(params);
      expect(sanitized.name).toBe('test value');
    });

    it('should sanitize number parameters', () => {
      const params = { count: 42 };
      const sanitized = SecurityManager.sanitizeParameters(params);
      expect(sanitized.count).toBe(42);
    });

    it('should sanitize boolean parameters', () => {
      const params = { enabled: true };
      const sanitized = SecurityManager.sanitizeParameters(params);
      expect(sanitized.enabled).toBe(true);
    });

    it('should sanitize array parameters', () => {
      const params = { items: ['a', 'b', 'c'] };
      const sanitized = SecurityManager.sanitizeParameters(params);
      expect(sanitized.items).toEqual(['a', 'b', 'c']);
    });

    it('should sanitize nested objects', () => {
      const params = {
        user: {
          name: 'John',
          age: 30
        }
      };
      const sanitized = SecurityManager.sanitizeParameters(params);
      expect(sanitized.user.name).toBe('John');
      expect(sanitized.user.age).toBe(30);
    });

    it('should remove unsafe characters from keys', () => {
      const params = { 'unsafe key!': 'value' };
      const sanitized = SecurityManager.sanitizeParameters(params);
      expect(Object.keys(sanitized)[0]).not.toContain('!');
    });

    it('should reject strings that are too long', () => {
      const params = { text: 'a'.repeat(20000) };
      expect(() => SecurityManager.sanitizeParameters(params)).toThrow();
    });

    it('should reject arrays that are too large', () => {
      const params = { items: new Array(2000).fill('item') };
      expect(() => SecurityManager.sanitizeParameters(params)).toThrow();
    });

    it('should limit nesting depth', () => {
      const deepObj: any = {};
      let current = deepObj;
      for (let i = 0; i < 10; i++) {
        current.nested = {};
        current = current.nested;
      }
      const params = { data: deepObj };
      const sanitized = SecurityManager.sanitizeParameters(params, 3);
      // Should stop at depth 3
      expect(sanitized.data).toBeDefined();
    });

    it('should drop functions and undefined values', () => {
      const params = {
        func: () => {},
        undef: undefined,
        value: 'keep'
      };
      const sanitized = SecurityManager.sanitizeParameters(params);
      expect(sanitized.func).toBeUndefined();
      expect(sanitized.undef).toBeUndefined();
      expect(sanitized.value).toBe('keep');
    });
  });

  describe('validateRegistryUrl', () => {
    it('should validate HTTPS URLs', () => {
      expect(SecurityManager.validateRegistryUrl('https://registry.prompdhub.ai')).toBe(true);
      expect(SecurityManager.validateRegistryUrl('https://example.com')).toBe(true);
    });

    it('should allow HTTP for localhost', () => {
      expect(SecurityManager.validateRegistryUrl('http://localhost:4000')).toBe(true);
      expect(SecurityManager.validateRegistryUrl('http://127.0.0.1:4000')).toBe(true);
    });

    it('should reject HTTP for non-localhost', () => {
      expect(SecurityManager.validateRegistryUrl('http://example.com')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(SecurityManager.validateRegistryUrl('not-a-url')).toBe(false);
      expect(SecurityManager.validateRegistryUrl('ftp://example.com')).toBe(false);
    });
  });

  describe('scanForSecrets', () => {
    it('should detect secrets in content', async () => {
      const content = 'API_KEY=sk-1234567890abcdefghijklmnopqrstuv';
      const result = await SecurityManager.scanForSecrets(content);
      expect(result.hasSecrets).toBe(true);
      expect(result.secrets.length).toBeGreaterThan(0);
    });

    it('should not detect secrets in clean content', async () => {
      const content = 'This is just normal text.';
      const result = await SecurityManager.scanForSecrets(content);
      expect(result.hasSecrets).toBe(false);
      expect(result.secrets).toHaveLength(0);
    });
  });

  describe('scanFileForSecrets', () => {
    const testDir = path.join(os.tmpdir(), 'prompd-test-secrets');
    const secretFile = path.join(testDir, 'secret.txt');
    const cleanFile = path.join(testDir, 'clean.txt');

    beforeAll(async () => {
      await fs.ensureDir(testDir);
    });

    afterAll(async () => {
      await fs.remove(testDir);
    });

    it('should detect secrets in files', async () => {
      await fs.writeFile(secretFile, 'OPENAI_API_KEY=sk-1234567890abcdefghijklmnopqrstuv');
      const result = await SecurityManager.scanFileForSecrets(secretFile);
      expect(result.hasSecrets).toBe(true);
    });

    it('should not detect secrets in clean files', async () => {
      await fs.writeFile(cleanFile, 'This is clean content');
      const result = await SecurityManager.scanFileForSecrets(cleanFile);
      expect(result.hasSecrets).toBe(false);
    });

    it('should handle non-existent files gracefully', async () => {
      const result = await SecurityManager.scanFileForSecrets('nonexistent.txt');
      expect(result.hasSecrets).toBe(false);
    });
  });

  describe('createSecureExecutionContext', () => {
    it('should create temp directory and cleanup function', async () => {
      const { tempDir, cleanup } = await SecurityManager.createSecureExecutionContext();

      // Check that temp directory exists
      expect(await fs.pathExists(tempDir)).toBe(true);

      // Cleanup should remove the directory
      await cleanup();
      expect(await fs.pathExists(tempDir)).toBe(false);
    });

    it('should create unique directories', async () => {
      const ctx1 = await SecurityManager.createSecureExecutionContext();
      const ctx2 = await SecurityManager.createSecureExecutionContext();

      expect(ctx1.tempDir).not.toBe(ctx2.tempDir);

      await ctx1.cleanup();
      await ctx2.cleanup();
    });
  });

  describe('sanitizeEnvironment', () => {
    it('should clear sensitive environment variables', () => {
      process.env.TEMP_API_KEY = 'secret';
      process.env.TEMP_TOKEN = 'token';

      SecurityManager.sanitizeEnvironment();

      expect(process.env.TEMP_API_KEY).toBeUndefined();
      expect(process.env.TEMP_TOKEN).toBeUndefined();
    });

    it('should not affect non-sensitive variables', () => {
      process.env.SAFE_VAR = 'value';

      SecurityManager.sanitizeEnvironment();

      expect(process.env.SAFE_VAR).toBe('value');
    });
  });
});
