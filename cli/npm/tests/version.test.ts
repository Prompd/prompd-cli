import { VersionManager } from '../src/lib/version';
import { PrompdParser } from '../src/lib/parser';
import * as fs from 'fs-extra';
import { execSync } from 'child_process';

// Replace fs-extra with mocks
(fs as any).readFile = jest.fn();
(fs as any).writeFile = jest.fn();

// Mock dependencies
jest.mock('fs-extra');
jest.mock('child_process');
jest.mock('../src/lib/parser');

const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn()
} as any;
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockParser = PrompdParser as jest.MockedClass<typeof PrompdParser>;

describe('VersionManager', () => {
  let versionManager: VersionManager;
  let mockParserInstance: jest.Mocked<PrompdParser>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockParserInstance = {
      parseFile: jest.fn(),
      parseContent: jest.fn(),
      validateFile: jest.fn()
    } as any;
    
    mockParser.mockImplementation(() => mockParserInstance);
    
    versionManager = new VersionManager();
  });

  describe('bumpVersion', () => {
    it('should bump patch version correctly', async () => {
      const originalContent = `---
name: test-prompt
version: 1.2.3
description: Test prompt
---

Content here`;

      const mockPrompdFile = {
        metadata: {
          name: 'test-prompt',
          version: '1.2.3',
          description: 'Test prompt'
        },
        content: 'Content here',
        sections: {}
      };

      mockFs.readFile.mockResolvedValue(originalContent);
      mockParserInstance.parseFile.mockResolvedValue(mockPrompdFile);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockExecSync.mockReturnValue(Buffer.from(''));

      const newVersion = await versionManager.bumpVersion('test.prmd', 'patch');

      expect(newVersion).toBe('1.2.4');
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(mockExecSync).toHaveBeenCalledWith('git tag v1.2.4-test-prompt', { stdio: 'pipe' });
    });

    it('should bump minor version correctly', async () => {
      const originalContent = `---
name: test-prompt
version: 1.2.3
---

Content`;

      const mockPrompdFile = {
        metadata: {
          name: 'test-prompt',
          version: '1.2.3'
        },
        content: 'Content',
        sections: {}
      };

      mockFs.readFile.mockResolvedValue(originalContent);
      mockParserInstance.parseFile.mockResolvedValue(mockPrompdFile);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockExecSync.mockReturnValue(Buffer.from(''));

      const newVersion = await versionManager.bumpVersion('test.prmd', 'minor');

      expect(newVersion).toBe('1.3.0');
    });

    it('should bump major version correctly', async () => {
      const originalContent = `---
name: test-prompt
version: 1.2.3
---

Content`;

      const mockPrompdFile = {
        metadata: {
          name: 'test-prompt',
          version: '1.2.3'
        },
        content: 'Content',
        sections: {}
      };

      mockFs.readFile.mockResolvedValue(originalContent);
      mockParserInstance.parseFile.mockResolvedValue(mockPrompdFile);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockExecSync.mockReturnValue(Buffer.from(''));

      const newVersion = await versionManager.bumpVersion('test.prmd', 'major');

      expect(newVersion).toBe('2.0.0');
    });

    it('should handle missing version field', async () => {
      const mockPrompdFile = {
        metadata: {
          name: 'test-prompt'
        },
        content: 'Content',
        sections: {}
      };

      mockParserInstance.parseFile.mockResolvedValue(mockPrompdFile);

      await expect(versionManager.bumpVersion('test.prmd', 'patch'))
        .rejects.toThrow('No version field found in file');
    });
  });

  describe('getVersionHistory', () => {
    it('should return version history from git tags', async () => {
      const mockGitOutput = `v1.2.0-test-prompt 2024-01-15 abc123 Initial version
v1.2.1-test-prompt 2024-01-20 def456 Bug fixes
v1.3.0-test-prompt 2024-01-25 ghi789 New features`;

      mockExecSync.mockReturnValue(Buffer.from(mockGitOutput));

      const history = await versionManager.getVersionHistory('test.prmd', 10);

      expect(history).toHaveLength(3);
      expect(history[0].tag).toBe('v1.3.0-test-prompt');
      expect(history[0].date).toBe('2024-01-25');
      expect(history[0].commit).toBe('ghi789');
      expect(history[0].message).toBe('New features');
    });

    it('should return empty array when no tags found', async () => {
      mockExecSync.mockReturnValue(Buffer.from(''));

      const history = await versionManager.getVersionHistory('test.prmd', 10);

      expect(history).toHaveLength(0);
    });
  });

  describe('diffVersions', () => {
    it('should return git diff between versions', async () => {
      const mockDiffOutput = `- version: 1.0.0
+ version: 1.1.0
- description: Old description
+ description: New description`;

      mockExecSync.mockReturnValue(Buffer.from(mockDiffOutput));

      const diff = await versionManager.diffVersions('test.prmd', 'v1.0.0', 'v1.1.0');

      expect(diff).toBe(mockDiffOutput);
      expect(mockExecSync).toHaveBeenCalledWith(
        'git diff v1.0.0..v1.1.0 -- "test.prmd"',
        { encoding: 'utf-8', stdio: 'pipe' }
      );
    });
  });

  describe('validateVersion', () => {
    it('should validate version format', async () => {
      const mockPrompdFile = {
        metadata: {
          name: 'test-prompt',
          version: '1.2.3'
        },
        content: 'Content',
        sections: {}
      };

      mockParserInstance.parseFile.mockResolvedValue(mockPrompdFile);

      const result = await versionManager.validateVersion('test.prmd', false);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect invalid version format', async () => {
      const mockPrompdFile = {
        metadata: {
          name: 'test-prompt',
          version: 'invalid-version'
        },
        content: 'Content',
        sections: {}
      };

      mockParserInstance.parseFile.mockResolvedValue(mockPrompdFile);

      const result = await versionManager.validateVersion('test.prmd', false);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Invalid semantic version format: invalid-version');
    });
  });

  describe('suggestVersionBump', () => {
    it('should suggest patch for bug fixes', async () => {
      const suggestion = await versionManager.suggestVersionBump('1.0.0', 'Fixed bug in parameter validation');

      expect(suggestion.current).toBe('1.0.0');
      expect(suggestion.recommended).toBe('patch');
      expect(suggestion.suggestions.patch).toBe('1.0.1');
      expect(suggestion.reason).toContain('bug fix');
    });

    it('should suggest minor for new features', async () => {
      const suggestion = await versionManager.suggestVersionBump('1.0.0', 'Added new parameter support');

      expect(suggestion.recommended).toBe('minor');
      expect(suggestion.suggestions.minor).toBe('1.1.0');
    });

    it('should suggest major for breaking changes', async () => {
      const suggestion = await versionManager.suggestVersionBump('1.0.0', 'Breaking change: removed old parameter format');

      expect(suggestion.recommended).toBe('major');
      expect(suggestion.suggestions.major).toBe('2.0.0');
    });

    it('should default to patch when no description provided', async () => {
      const suggestion = await versionManager.suggestVersionBump('1.0.0');

      expect(suggestion.recommended).toBe('patch');
    });
  });
});