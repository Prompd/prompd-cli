import { VersionManager } from '../src/lib/version';
import { PrompdParser } from '../src/lib/parser';
import * as fs from 'fs-extra';
import { execSync } from 'child_process';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('child_process');
jest.mock('../src/lib/parser');

const mockReadFile = fs.readFile as unknown as jest.Mock;
const mockWriteFile = fs.writeFile as unknown as jest.Mock;
const mockFs = { readFile: mockReadFile, writeFile: mockWriteFile };
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
          id: 'test-prompt',
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
      expect(mockExecSync).toHaveBeenCalledWith('git tag "test-v1.2.4"', { stdio: 'pipe' });
    });

    it('should bump minor version correctly', async () => {
      const originalContent = `---
name: test-prompt
version: 1.2.3
---

Content`;

      const mockPrompdFile = {
        metadata: {
          id: 'test-prompt',
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
          id: 'test-prompt',
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

    it('should default to 0.0.0 when version is missing', async () => {
      const originalContent = `---\nname: test-prompt\n---\n\nContent`;

      const mockPrompdFile = {
        metadata: {
          id: 'test-prompt',
          name: 'test-prompt'
        },
        content: 'Content',
        sections: {}
      };

      mockFs.readFile.mockResolvedValue(originalContent);
      mockParserInstance.parseFile.mockResolvedValue(mockPrompdFile);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockExecSync.mockReturnValue(Buffer.from(''));

      const newVersion = await versionManager.bumpVersion('test.prmd', 'patch');
      expect(newVersion).toBe('0.0.1');
    });
  });

  describe('getVersionHistory', () => {
    it('should return version history from git tags', async () => {
      // Mock output matches git log --pretty=format:"%d|%H|%ai|%s"
      const mockGitOutput = ` (tag: test-v1.2.0)|abc123|2024-01-15 12:00:00 +0000|Initial version
 (tag: test-v1.2.1)|def456|2024-01-20 12:00:00 +0000|Bug fixes
 (tag: test-v1.3.0)|ghi789|2024-01-25 12:00:00 +0000|New features`;

      mockExecSync.mockReturnValue(mockGitOutput as unknown as ReturnType<typeof execSync>);

      const history = await versionManager.getVersionHistory('test.prmd', 10);

      expect(history).toHaveLength(3);
      expect(history[0].tag).toBe('test-v1.2.0');
      expect(history[0].date).toBe('2024-01-15');
      expect(history[0].commit).toBe('abc123');
      expect(history[0].message).toBe('Initial version');
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

      mockExecSync.mockReturnValue(mockDiffOutput as unknown as ReturnType<typeof execSync>);

      const diff = await versionManager.diffVersions('test.prmd', '1.0.0', '1.1.0');

      expect(diff).toBe(mockDiffOutput);
      expect(mockExecSync).toHaveBeenCalledWith(
        'git diff "test-v1.0.0" "test-v1.1.0" -- "test.prmd"',
        { encoding: 'utf-8', stdio: 'pipe' }
      );
    });
  });

  describe('validateVersion', () => {
    it('should validate version format', async () => {
      const mockPrompdFile = {
        metadata: {
          id: 'test-prompt',
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
          id: 'test-prompt',
          name: 'test-prompt',
          version: 'invalid-version'
        },
        content: 'Content',
        sections: {}
      };

      mockParserInstance.parseFile.mockResolvedValue(mockPrompdFile);

      const result = await versionManager.validateVersion('test.prmd', false);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Invalid semantic version: invalid-version');
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