# @prompd/cli

A TypeScript/Node.js implementation of the Prompd CLI, providing full compatibility with Python and Go versions. Can be used both as a **command-line tool** and as a **library** in TypeScript/React applications.

## Installation

```bash
# As a CLI tool (global)
npm install -g @prompd/cli

# As a library in your project
npm install @prompd/cli

# From source
npm install
npm run build
```

## Features

✅ **Dual-purpose package:**
- **CLI tool** with full feature parity with Python and Go CLIs
- **Library** for programmatic use in TypeScript/React/Node.js apps

✅ **Core capabilities:**
- `.prmd` file parsing and validation
- Package management (create, validate, publish)
- Registry operations (login, search, install)
- Provider configuration and management
- Security scanning (secrets detection)
- Input validation and sanitization

## Usage as a Library

```typescript
import { PrompdParser, ConfigManager, validatePackageName } from '@prompd/cli';

// Parse a .prmd file
const parser = new PrompdParser();
const prompd = await parser.parseFile('./example.prmd');
console.log('Prompt ID:', prompd.metadata.id);

// Validate a file
const issues = await parser.validateFile('./example.prmd');
issues.forEach(issue => console.log(`[${issue.level}] ${issue.message}`));

// Work with configuration
const config = new ConfigManager();
const currentConfig = config.load();
console.log('Provider:', currentConfig.defaultProvider);

// Validate package names
const isValid = validatePackageName('@myorg/my-prompt');
```

**See [examples/library-usage.ts](examples/library-usage.ts) and [examples/library-usage.js](examples/library-usage.js) for complete examples.**

## CLI Commands

```bash
# Validation & Display
prompd validate <file>            # Validate .prmd file
prompd list [directory]            # List all .prmd files
prompd show <file>                 # Show file details

# Package Management
prompd package create <dir> -o <output.pdpkg>  # Create package
prompd package validate <package.pdpkg>        # Validate package
prompd pack <dir>                              # Quick package create (alias)

# Registry Operations
prompd login                       # Interactive authentication
prompd logout                      # Clear credentials
prompd publish <package.pdpkg>     # Publish to registry
prompd search <query>              # Search packages
prompd install @namespace/package@version
prompd versions <package>          # List versions
prompd registry info <package>     # Package details

# Configuration
prompd config show                 # Show current config
prompd config provider list        # List providers
prompd config provider show <name> # Show provider details
prompd config provider add <name> <url> <models...>
prompd config provider remove <name>
prompd config provider setkey <provider> <key>
prompd config registry list
prompd config registry add <name> <url>
prompd config registry remove <name>
```

## Configuration

Configuration is stored in `~/.prompd/config.yaml` or via environment variables:

```yaml
apiKeys:
  openai: your-api-key
  anthropic: your-api-key
defaultProvider: openai
defaultModel: gpt-4
customProviders:
  local:
    baseUrl: http://localhost:8080
    models: [model1, model2]
```

Environment variables:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `PROMPD_DEFAULT_PROVIDER`
- `PROMPD_DEFAULT_MODEL`

## Development

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Run tests
npm test

# Development mode (uses ts-node)
npm run dev -- <command>

# Watch mode for tests
npm run test:watch
```

## Architecture

```
cli/npm/
├── bin/             # Executable wrapper
├── src/
│   ├── commands/    # CLI command implementations
│   ├── lib/         # Core libraries (parser, executor, config)
│   └── types/       # TypeScript type definitions
├── tests/           # Jest unit tests
└── dist/            # Compiled JavaScript output
```

## Testing

The implementation includes comprehensive unit tests using Jest:

- Parser validation tests
- Configuration management tests
- LLM executor tests (mocked)
- Version management tests
- Integration tests

Run tests with: `npm test`

## Compatibility

- Node.js >= 16.0.0
- Works on Windows, macOS, and Linux
- Full compatibility with Python and Go CLI versions