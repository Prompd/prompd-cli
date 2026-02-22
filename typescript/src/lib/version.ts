import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'yaml';
import * as semver from 'semver';
import { execSync } from 'child_process';
import { PrompdParser } from './parser';

export class VersionManager {
  private parser = new PrompdParser();

  async bumpVersion(filePath: string, bumpType: 'major' | 'minor' | 'patch'): Promise<string> {
    const prompd = await this.parser.parseFile(filePath);
    const currentVersion = prompd.metadata.version || '0.0.0';
    
    const newVersion = semver.inc(currentVersion, bumpType);
    if (!newVersion) {
      throw new Error(`Failed to bump version from ${currentVersion}`);
    }

    // Update version in file
    await this.updateVersionInFile(filePath, newVersion);

    // Create git commit and tag
    const commitMessage = `Bump ${path.basename(filePath)} to ${newVersion}`;
    try {
      await this.gitCommitAndTag(filePath, newVersion, commitMessage);
    } catch (error) {
      console.warn('File updated but git operations failed:', error);
    }

    return newVersion;
  }

  private async updateVersionInFile(filePath: string, newVersion: string): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');
    
    if (!content.startsWith('---\n')) {
      throw new Error('File must start with YAML frontmatter (---)');
    }

    const parts = content.slice(4).split('\n---\n', 2);
    if (parts.length !== 2) {
      throw new Error('Invalid frontmatter format');
    }

    const [yamlContent, markdownContent] = parts;
    
    // Parse and update YAML
    let metadata = yaml.parse(yamlContent) || {};
    metadata.version = newVersion;
    
    // Write back to file
    const updatedYaml = yaml.stringify(metadata);
    const updatedContent = `---\n${updatedYaml}---\n${markdownContent}`;
    await fs.writeFile(filePath, updatedContent, 'utf-8');
  }

  private async gitCommitAndTag(filePath: string, version: string, message: string): Promise<void> {
    try {
      // Add file to git
      execSync(`git add "${filePath}"`, { stdio: 'pipe' });
      
      // Commit
      execSync(`git commit -m "${message}"`, { stdio: 'pipe' });
      
      // Create tag
      const tagName = `${path.basename(filePath, '.prmd')}-v${version}`;
      execSync(`git tag "${tagName}"`, { stdio: 'pipe' });
      
      console.log(`✓ Created commit and tag: ${tagName}`);
    } catch (error) {
      throw new Error(`Git operation failed: ${error}`);
    }
  }

  async getVersionHistory(filePath: string, limit = 10): Promise<Array<{ tag: string; date: string; commit: string; message: string }>> {
    try {
      const basename = path.basename(filePath, '.prmd');
      const command = `git log --tags --simplify-by-decoration --pretty=format:"%d|%H|%ai|%s" -n ${limit} -- "${filePath}"`;
      const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
      
      const tags: Array<{ tag: string; date: string; commit: string; message: string }> = [];
      const lines = output.trim().split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        const parts = line.split('|', 4);
        if (parts.length === 4 && parts[0].includes('tag:')) {
          const tagMatch = parts[0].match(/tag: ([^,)]+)/);
          if (tagMatch) {
            tags.push({
              tag: tagMatch[1].trim(),
              commit: parts[1],
              date: parts[2].substring(0, 10), // Just the date part
              message: parts[3]
            });
          }
        }
      }
      
      return tags;
    } catch (error) {
      return [];
    }
  }

  async validateVersion(filePath: string, checkGit = false): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];
    
    try {
      const prompd = await this.parser.parseFile(filePath);
      const currentVersion = prompd.metadata.version;
      
      if (!currentVersion) {
        issues.push('No version specified in file');
        return { valid: false, issues };
      }
      
      // Validate semantic version format
      if (!semver.valid(currentVersion)) {
        issues.push(`Invalid semantic version: ${currentVersion}`);
        return { valid: false, issues };
      }
      
      if (checkGit) {
        // Check if version matches latest git tag
        const latestTag = await this.getLatestGitTag(filePath);
        if (latestTag && latestTag !== currentVersion) {
          issues.push(`Version mismatch: file version (${currentVersion}) vs latest git tag (${latestTag})`);
        }
      }
      
      return { valid: issues.length === 0, issues };
    } catch (error) {
      issues.push(error instanceof Error ? error.message : 'Unknown error');
      return { valid: false, issues };
    }
  }

  private async getLatestGitTag(filePath: string): Promise<string | null> {
    try {
      const history = await this.getVersionHistory(filePath, 1);
      return history.length > 0 ? history[0].tag : null;
    } catch (error) {
      return null;
    }
  }

  async suggestVersionBump(currentVersion: string, changes?: string): Promise<{
    current: string;
    recommended: 'patch' | 'minor' | 'major';
    suggestions: {
      patch: string;
      minor: string;
      major: string;
    };
    reason: string;
  }> {
    const suggestions = {
      patch: semver.inc(currentVersion, 'patch') || '0.0.1',
      minor: semver.inc(currentVersion, 'minor') || '0.1.0',
      major: semver.inc(currentVersion, 'major') || '1.0.0'
    };

    // Simple heuristic based on change description
    let recommended: 'patch' | 'minor' | 'major' = 'patch';
    let reason = 'Default patch version for bug fixes and small changes';

    if (changes) {
      const lowerChanges = changes.toLowerCase();
      if (lowerChanges.includes('breaking') || lowerChanges.includes('major')) {
        recommended = 'major';
        reason = 'Major version recommended due to breaking changes';
      } else if (lowerChanges.includes('feature') || lowerChanges.includes('add') || lowerChanges.includes('new')) {
        recommended = 'minor';
        reason = 'Minor version recommended for new features';
      }
    }

    return {
      current: currentVersion,
      recommended,
      suggestions,
      reason
    };
  }

  async diffVersions(filePath: string, version1: string, version2: string): Promise<string> {
    try {
      const basename = path.basename(filePath, '.prmd');
      const command = `git diff "${basename}-v${version1}" "${basename}-v${version2}" -- "${filePath}"`;
      return execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    } catch (error) {
      throw new Error(`Git diff failed: ${error}`);
    }
  }
}