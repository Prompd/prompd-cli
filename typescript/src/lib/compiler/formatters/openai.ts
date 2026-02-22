/**
 * OpenAI API JSON Formatter
 *
 * Formats compiled prompts for OpenAI API consumption with proper message structure.
 */

import { OutputFormatter, CompiledPrompt } from '../types';

export class OpenAIFormatter implements OutputFormatter {
  name = 'provider-json:openai';
  fileExtension = '.json';
  mimeType = 'application/json';

  async format(compiled: CompiledPrompt): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];

    if (!compiled.content) {
      return JSON.stringify({
        model: 'gpt-4',
        messages: [],
        temperature: 0.1
      }, null, 2);
    }

    // Parse all sections
    const sections = this.parseSections(compiled.content);

    // Build system message from System and Context sections
    let systemMessage = '';
    const systemParts: string[] = [];
    if (sections.System) {
      systemParts.push(sections.System);
    }
    if (sections.Context) {
      systemParts.push(sections.Context);
    }
    systemMessage = systemParts.join('\n\n');

    if (systemMessage) {
      messages.push({
        role: 'system',
        content: systemMessage
      });
    }

    // Build messages from other sections in order
    let examplesContent = '';
    if (sections.Examples) {
      examplesContent = sections.Examples;
    }

    for (const [sectionName, content] of Object.entries(sections)) {
      if (sectionName === 'System' || sectionName === 'Context' || sectionName === 'Examples') continue;

      const role = this.sectionToRole(sectionName);
      if (role) {
        let messageContent = content.trim();
        // Add examples to first user message
        if (role === 'user' && examplesContent && messages.filter(m => m.role === 'user').length === 0) {
          messageContent = `${messageContent}\n\n${examplesContent}`;
          examplesContent = ''; // Only add once
        }
        messages.push({ role, content: messageContent });
      }
    }

    // Add extracted contexts to first user message
    if (compiled.contexts && compiled.contexts.length > 0 && messages.length > 0) {
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg) {
        const contextContent = compiled.contexts.join('\n\n');
        firstUserMsg.content = `${contextContent}\n\n${firstUserMsg.content}`;
      }
    }

    const apiRequest = {
      model: 'gpt-4',
      messages: messages,
      temperature: 0.1
    };

    return JSON.stringify(apiRequest, null, 2);
  }

  /**
   * Parse all sections from markdown content.
   */
  private parseSections(content: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const lines = content.split('\n');
    let currentSection: string | null = null;
    let currentContent: string[] = [];
    let sectionOrder: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Check if this is a section header
      const match = trimmed.match(/^# (.+)$/);
      if (match) {
        // Save previous section
        if (currentSection) {
          const key = sectionOrder.filter(s => s === currentSection).length > 0
            ? `${currentSection}_${sectionOrder.filter(s => s === currentSection).length}`
            : currentSection;
          sections[key] = currentContent.join('\n').trim();
          sectionOrder.push(currentSection);
        }

        // Start new section
        currentSection = match[1];
        currentContent = [];
      } else if (currentSection) {
        // Add line to current section
        currentContent.push(line);
      }
    }

    // Save last section
    if (currentSection) {
      const key = sectionOrder.filter(s => s === currentSection).length > 0
        ? `${currentSection}_${sectionOrder.filter(s => s === currentSection).length}`
        : currentSection;
      sections[key] = currentContent.join('\n').trim();
    }

    return sections;
  }

  /**
   * Convert section name to message role.
   */
  private sectionToRole(sectionName: string): string | null {
    const normalized = sectionName.replace(/_\d+$/, '').toLowerCase();
    if (normalized === 'user') return 'user';
    if (normalized === 'assistant') return 'assistant';
    return null;
  }

}
