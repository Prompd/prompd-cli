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
- `.pdflow` workflow execution with LLM support
- Package management (create, validate, publish)
- Registry operations (login, search, install)
- Provider configuration and management with custom endpoints
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

## What's New in v0.4.5

✨ **Provider Configuration Enhancements** - Full parity with Python CLI
- Custom base URLs for proxies and private deployments
- Per-provider timeout overrides
- Custom HTTP headers for authentication and tracing
- Provider-specific request parameters
- `--api-key` CLI option for all execution commands

🚀 **Workflow Execution**
- Execute `.pdflow` workflow files with `prompd run` or `prompd workflow run`
- Support for agent nodes, chat agents, and tool calling
- Command execution with whitelisted security controls
- Real-time checkpoint tracking with `--trace` and `--verbose` flags

## CLI Commands

```bash
# Execution
prompd run <file>                  # Run .prmd or .pdflow file
prompd run <file> --provider openai --model gpt-4o-mini
prompd run <file> --api-key <key> # Override API key
prompd run <file> --param key=value -p key2=value2
prompd workflow run <file>         # Execute .pdflow workflow

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

### Execution Examples

```bash
# Execute a .prmd file with default config
prompd run ./prompts/my-prompt.prmd

# Override provider and model
prompd run ./prompts/my-prompt.prmd --provider anthropic --model claude-3-5-haiku-20241022

# Pass parameters
prompd run ./prompts/my-prompt.prmd --param topic="AI ethics" --param format="report"

# Override API key
prompd run ./prompts/my-prompt.prmd --api-key sk-...

# Execute a workflow
prompd run ./workflows/chat-agent.pdflow

# Execute with trace and verbose output
prompd workflow run ./workflows/chat-agent.pdflow --trace --verbose
```

## Configuration

Configuration is stored in `~/.prompd/config.yaml` or via environment variables.

### API Key Priority Order
1. **CLI parameters**: `--api-key <key>` (highest priority)
2. **Environment variables**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.
3. **Config file**: `~/.prompd/config.yaml` (lowest priority)

### Configuration File

```yaml
# API Keys
apiKeys:
  openai: your-api-key
  anthropic: your-api-key
  groq: your-api-key

# Default Provider & Model
defaultProvider: openai
defaultModel: gpt-4o-mini

# Custom Providers
customProviders:
  local:
    baseUrl: http://localhost:8080
    models: [model1, model2]
    apiKey: optional-api-key

# Provider-Specific Configurations (v0.4.4+)
providerConfigs:
  openai:
    baseUrl: https://custom-openai-proxy.com/v1  # Custom endpoint
    timeout: 90000                                 # 90 seconds
    extraHeaders:
      X-Custom-Header: value
    extraParams:
      temperature: 0.7
  anthropic:
    timeout: 120000                                # 120 seconds
  ollama:
    baseUrl: http://192.168.1.100:11434/api/chat  # Remote Ollama
```

### Provider Config Options

- **`baseUrl`**: Custom API endpoint (e.g., proxy, different region, or private deployment)
- **`timeout`**: Provider-specific timeout override (milliseconds)
- **`extraHeaders`**: Custom HTTP headers (authentication, tracing, etc.)
- **`extraParams`**: Provider-specific request parameters

### Environment Variables
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GROQ_API_KEY`
- `PROMPD_DEFAULT_PROVIDER`
- `PROMPD_DEFAULT_MODEL`
- `PROMPD_VERBOSE`

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