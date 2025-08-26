# Prompd CLI - NPM/Node.js Implementation

A TypeScript/Node.js implementation of the Prompd CLI, providing full compatibility with Python and Go versions.

## Installation

```bash
# From source
npm install
npm run build

# Global installation
npm install -g @logikbug/prompd-cli
```

## Features

✅ **Full feature parity with Python and Go CLIs:**
- `.prompd` file validation with comprehensive error reporting
- List and show prompt files with metadata
- Execute prompts with LLM providers (OpenAI, Anthropic, Ollama)
- Provider management (add/remove/list custom providers)
- Version management with git integration
- Git operations for .prompd files

## Commands

```bash
# Validate a .prompd file
prompd validate <file>

# List all .prompd files in a directory
prompd list <directory>

# Show details of a .prompd file
prompd show <file>

# Execute a prompt with an LLM provider
prompd execute <file> --provider openai --model gpt-4

# Manage providers
prompd provider list
prompd provider show <name>
prompd provider add <name> <url>
prompd provider remove <name>

# Version management
prompd version bump <file> <major|minor|patch>
prompd version history <file>
prompd version diff <file> <v1> <v2>

# Git operations
prompd git add <files...>
prompd git status
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