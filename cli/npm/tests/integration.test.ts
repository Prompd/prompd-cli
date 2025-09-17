import * as fs from 'fs-extra';
import * as path from 'path';
import { PrompdParser } from '../src/lib/parser';
import { ConfigManager } from '../src/lib/config';

describe('Integration Tests', () => {
  let tempDir: string;
  let parser: PrompdParser;
  let configManager: ConfigManager;

  beforeEach(async () => {
    // Create temporary directory
    tempDir = path.join(__dirname, 'temp-' + Date.now());
    await fs.ensureDir(tempDir);
    
    parser = new PrompdParser();
    configManager = ConfigManager.getInstance();
    
    // Reset singleton for clean tests
    (ConfigManager as any).instance = null;
    configManager = ConfigManager.getInstance();
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
  });

  describe('End-to-end .prmd file processing', () => {
    it('should parse, validate, and process a complete .prmd file', async () => {
      const prompdContent = `---
name: test-integration
description: Integration test prompt
version: 1.0.0
parameters:
  - name: topic
    type: string
    required: true
    description: The topic to discuss
  - name: detail_level
    type: string
    required: false
    default: medium
    description: Level of detail required
---

# Integration Test Prompt

Please provide a {detail_level} level analysis of the topic: **{topic}**.

Include the following aspects:
- Overview and context
- Key considerations
- Practical implications

Thank you for analyzing {topic}!`;

      const filePath = path.join(tempDir, 'test-integration.prmd');
      await fs.writeFile(filePath, prompdContent);

      // Test parsing
      const prompdFile = await parser.parseFile(filePath);
      
      expect(prompdFile.metadata.name).toBe('test-integration');
      expect(prompdFile.metadata.version).toBe('1.0.0');
      expect(prompdFile.metadata.parameters).toHaveLength(2);
      expect(prompdFile.metadata.parameters![0].name).toBe('topic');
      expect(prompdFile.metadata.parameters![1].default).toBe('medium');
      
      // Test content extraction
      expect(prompdFile.content).toContain('Please provide a {detail_level}');
      expect(prompdFile.content).toContain('analyzing {topic}!');

      // Test validation
      const issues = await parser.validateFile(filePath);
      expect(issues).toHaveLength(0);
    });

    it('should detect and report validation issues', async () => {
      const invalidPrompdContent = `---
name: invalid-test
parameters:
  - name: param1
    type: invalid-type
  - name: param2
    type: string
---

Content with {undefined_variable} and {param1}`;

      const filePath = path.join(tempDir, 'invalid-test.prmd');
      await fs.writeFile(filePath, invalidPrompdContent);

      const issues = await parser.validateFile(filePath);
      
      expect(issues.length).toBeGreaterThan(0);
      
      const errorMessages = issues.map(issue => issue.message);
      expect(errorMessages.some(msg => msg.includes('invalid parameter type'))).toBe(true);
      expect(errorMessages.some(msg => msg.includes('undefined variable'))).toBe(true);
    });
  });

  describe('Configuration management integration', () => {
    it('should load and save configuration files', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const configContent = `apiKeys:
  openai: test-openai-key
  anthropic: test-anthropic-key
defaultProvider: openai
defaultModel: gpt-4
customProviders:
  local:
    baseUrl: http://localhost:8080
    models: [local-model]
    enabled: true`;

      await fs.writeFile(configPath, configContent);

      // Mock ConfigManager to use our temp config file
      const originalLoadConfig = ConfigManager.prototype.loadConfig;
      ConfigManager.prototype.loadConfig = jest.fn(async () => {
        return {
          apiKeys: { openai: 'test-openai-key' },
          customProviders: {
            'local-test': {
              baseUrl: 'http://localhost:8080',
              models: ['model1', 'model2'],
              enabled: true,
              type: 'openai-compatible'
            }
          }
        };
      });

      const config = await configManager.loadConfig();

      expect(config.apiKeys.openai).toBe('test-openai-key');
      expect(config.customProviders['local-test']).toBeDefined();
      expect(config.customProviders['local-test'].baseUrl).toBe('http://localhost:8080');
    });

    it('should handle missing config gracefully', async () => {
      // Reset any previous config loading
      (ConfigManager as any).instance = null;
      const freshConfigManager = ConfigManager.getInstance();

      const config = await freshConfigManager.loadConfig();

      expect(config).toBeDefined();
      expect(config.apiKeys).toBeDefined();
      expect(config.customProviders).toBeDefined();
    });
  });

  describe('File system operations', () => {
    it('should handle file paths with spaces and special characters', async () => {
      const specialDir = path.join(tempDir, 'special dir with spaces');
      const specialFile = path.join(specialDir, 'test prompt-file.prmd');
      
      await fs.ensureDir(specialDir);
      
      const prompdContent = `---
name: special-test
description: Test with special file path
version: 1.0.0
---

This is a test with special file path.`;

      await fs.writeFile(specialFile, prompdContent);

      const prompdFile = await parser.parseFile(specialFile);
      
      expect(prompdFile.metadata.name).toBe('special-test');
      expect(prompdFile.metadata.description).toBe('Test with special file path');
    });

    it('should handle non-existent files gracefully', async () => {
      const nonExistentFile = path.join(tempDir, 'does-not-exist.prmd');

      await expect(parser.parseFile(nonExistentFile))
        .rejects.toThrow();
    });

    it('should handle files with BOM (Byte Order Mark)', async () => {
      const prompdContent = `---
name: bom-test
version: 1.0.0
---

Content with BOM`;

      // Add BOM to the content
      const contentWithBOM = '\ufeff' + prompdContent;
      const filePath = path.join(tempDir, 'bom-test.prmd');
      await fs.writeFile(filePath, contentWithBOM, 'utf8');

      const prompdFile = await parser.parseFile(filePath);
      
      expect(prompdFile.metadata.name).toBe('bom-test');
      expect(prompdFile.metadata.version).toBe('1.0.0');
    });
  });
});