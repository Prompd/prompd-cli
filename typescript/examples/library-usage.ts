/**
 * Example: Using @prompd/cli as a library in TypeScript/React applications
 *
 * Install: npm install @prompd/cli
 */

import {
  PrompdParser,
  ConfigManager,
  validatePackageName,
  detectSecrets,
  VERSION,
  type PrompdFile,
  type ValidationIssue
} from '@prompd/cli';

async function main() {
  console.log(`Using @prompd/cli v${VERSION} as a library\n`);

  // 1. Parse a .prmd file
  const parser = new PrompdParser();

  try {
    const prompd: PrompdFile = await parser.parseFile('./example.prmd');
    console.log('Parsed .prmd file:');
    console.log('  ID:', prompd.metadata.id);
    console.log('  Name:', prompd.metadata.name);
    console.log('  Version:', prompd.metadata.version);
    console.log('  Parameters:', prompd.metadata.parameters?.length || 0);
  } catch (error) {
    console.error('Parse error:', error);
  }

  // 2. Validate a file
  const issues: ValidationIssue[] = await parser.validateFile('./example.prmd');
  console.log('\nValidation issues:', issues.length);
  issues.forEach(issue => {
    console.log(`  [${issue.level}] ${issue.message}`);
  });

  // 3. Work with configuration
  const config = new ConfigManager();
  const currentConfig = config.load();
  console.log('\nConfiguration:');
  console.log('  Default provider:', currentConfig.defaultProvider);
  console.log('  Registered providers:', Object.keys(currentConfig.apiKeys).join(', '));

  // 4. Validate package names
  const packageName = '@myorg/my-prompt';
  const isValid = validatePackageName(packageName);
  console.log(`\nPackage name "${packageName}" is valid:`, isValid);

  // 5. Detect secrets in content
  const testContent = `
    OPENAI_API_KEY=sk-1234567890abcdef
    DATABASE_URL=postgres://localhost
  `;
  const secrets = detectSecrets(testContent);
  console.log('\nSecrets detected:', secrets.length);
  secrets.forEach(secret => {
    console.log(`  [${secret.type}] at line ${secret.line}: ${secret.match}`);
  });
}

// Run the example
main().catch(console.error);
