/**
 * Example: Using @prompd/cli as a library in JavaScript/Node.js applications
 *
 * Install: npm install @prompd/cli
 * Run: node library-usage.js
 */

const {
  PrompdParser,
  ConfigManager,
  validatePackageName,
  detectSecrets,
  VERSION
} = require('@prompd/cli');

async function main() {
  console.log(`Using @prompd/cli v${VERSION} as a library\n`);

  // 1. Parse a .prmd file
  const parser = new PrompdParser();

  try {
    const prompd = await parser.parseFile('./example.prmd');
    console.log('Parsed .prmd file:');
    console.log('  ID:', prompd.metadata.id);
    console.log('  Name:', prompd.metadata.name);
    console.log('  Version:', prompd.metadata.version);
    console.log('  Parameters:', prompd.metadata.parameters?.length || 0);
  } catch (error) {
    console.error('Parse error:', error.message);
  }

  // 2. Validate a file
  try {
    const issues = await parser.validateFile('./example.prmd');
    console.log('\nValidation issues:', issues.length);
    issues.forEach(issue => {
      console.log(`  [${issue.level}] ${issue.message}`);
    });
  } catch (error) {
    console.error('Validation error:', error.message);
  }

  // 3. Work with configuration
  const config = new ConfigManager();
  const currentConfig = config.load();
  console.log('\nConfiguration:');
  console.log('  Default provider:', currentConfig.defaultProvider);
  console.log('  Registered providers:', Object.keys(currentConfig.apiKeys).join(', '));

  // 4. Validate package names
  const validName = '@myorg/my-prompt';
  const invalidName = 'MyPrompt';
  console.log(`\nPackage name "${validName}" is valid:`, validatePackageName(validName));
  console.log(`Package name "${invalidName}" is valid:`, validatePackageName(invalidName));

  // 5. Detect secrets in content
  const testContent = `
    OPENAI_API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyzABCDEF
    DATABASE_URL=postgres://localhost
    ANTHROPIC_API_KEY=sk-ant-api03-1234567890
  `;
  const secrets = detectSecrets(testContent);
  console.log('\nSecrets detected:', secrets.length);
  secrets.forEach(secret => {
    console.log(`  [${secret.type}] at line ${secret.line}: ${secret.match}`);
  });

  // 6. Parse content directly (not from file)
  const directContent = `---
id: example-prompt
name: Example Prompt
version: 1.0.0
description: A simple example
parameters:
  - name: username
    type: string
    required: true
---

## System
You are a helpful assistant.

## User
Hello {username}!
`;

  try {
    const prompd = parser.parseContent(directContent);
    console.log('\nParsed content directly:');
    console.log('  ID:', prompd.metadata.id);
    console.log('  Parameters:', prompd.metadata.parameters.map(p => p.name).join(', '));
  } catch (error) {
    console.error('Parse error:', error.message);
  }
}

// Run the example
main().catch(console.error);
