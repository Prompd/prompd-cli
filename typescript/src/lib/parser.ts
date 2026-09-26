import * as fs from 'fs-extra';
import { PrompdParser as CorePrompdParser, isPrompdFile } from '@prompd/core';
import { PrompdFile, ValidationIssue } from '../types';

/**
 * Node CLI parser. The pure string->structure logic (parseContent,
 * validateContent) lives in @prompd/core; this subclass adds the fs-backed
 * parseFile()/validateFile() so existing CLI imports keep working unchanged.
 */
export class PrompdParser extends CorePrompdParser {
  async parseFile(filePath: string): Promise<PrompdFile> {
    if (!isPrompdFile(filePath)) {
      throw new Error('File must have a .prmd or .md extension');
    }

    if (!(await fs.pathExists(filePath))) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return this.parseContent(content, filePath);
  }

  async validateFile(filePath: string): Promise<ValidationIssue[]> {
    try {
      const prompd = await this.parseFile(filePath);
      return this.validatePrompdFile(prompd);
    } catch (error) {
      return [{
        level: 'error',
        message: error instanceof Error ? error.message : 'Unknown parsing error'
      }];
    }
  }
}
