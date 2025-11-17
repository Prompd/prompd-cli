# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

```bash
# Install Python CLI globally (recommended)
pip install prompd

# Development installation from source
cd cli/python && pip install -e ".[dev,mcp]"

# Quick validation of installation
prompd --version
prompd validate examples/basic/example.prmd

# Quick test across all CLIs
python cli/python/run_tests.py && cd cli/go && go test ./... && cd ../npm && npm test

# Build cross-platform Go binaries (creates 6 platform binaries in dist/)
./build.bat  # Windows
./build.sh   # Unix/macOS
```

## Project Overview

Prompd is a composable AI prompt ecosystem - the "npm for AI prompts". It provides structured prompt management with universal LLM provider support across three CLI implementations and a VS Code extension.

## Repository Architecture

```
prompd-cli/
├── cli/
│   ├── python/          # Full-featured CLI with 6-stage compiler
│   ├── go/             # Zero-dependency lightweight CLI
│   └── npm/            # TypeScript CLI with MCP support
├── examples/           # Sample .prmd files
├── vscode-extension/   # Language support & execution
└── dist/              # Cross-platform Go binaries
```

### Multi-CLI Design Philosophy

Each CLI serves a specific purpose while maintaining core feature parity:

- **Python CLI**: Complete ecosystem with AI shell, MCP server, compilation pipeline, and binary asset extraction
- **Go CLI**: Minimal footprint for CI/CD, containers, and environments where dependencies are problematic
- **Node.js CLI**: Developer-focused with TypeScript and Model Context Protocol (MCP) integration

All CLIs share identical validation logic and package format specifications.

## Development Commands

### Build & Test

```bash
# Python CLI
cd cli/python
pip install -e ".[dev,mcp]"          # Install with dev dependencies
python run_tests.py                  # Quick test (models, validator, parser)
pytest tests/                        # Full test suite
pytest tests/test_parser.py -v       # Single test file
pytest tests/test_parser.py::test_specific_function -v  # Specific test
black prompd/                        # Format code
ruff check prompd/                   # Lint code
python -m build                      # Build distribution packages
python -m twine upload dist/*        # Publish to PyPI

# Go CLI
cd cli/go
go build -o prompd.exe ./cmd/prompd               # Quick build
go build -ldflags "-s -w" -o prompd.exe ./cmd/prompd  # Optimized build
go test ./...                        # Run all tests
go test ./... -run TestValidateFile  # Specific test pattern
go test -v ./cmd/prompd              # Verbose tests for main package

# Node.js CLI
cd cli/npm
npm install                          # Install dependencies
npm run build                        # TypeScript compilation
npm test                             # Run all tests
npm run test:watch                   # Watch mode
npx jest parser --verbose            # Single test suite
npm run dev                          # Development mode with ts-node

# VS Code Extension
cd vscode-extension
npm install                          # Install dependencies
npm run compile                      # Build extension
npm run watch                        # Dev mode with auto-rebuild
```

### Core Operations

```bash
# Validation & Display
prompd validate example.prmd
prompd show example.prmd
prompd list [path]
prompd explain example.prmd              # Detailed file/package info

# Compilation Pipeline (Python/Go)
prompd compile example.prmd --to-markdown
prompd compile example.prmd --to-provider-json openai
prompd compile @namespace/package@1.0.0 -p key=value

# Execution (Python/Node.js)
prompd run example.prmd --provider openai --model gpt-4o -p key=value
prompd run example.prmd --meta:context ./src/ --meta:debug true

# Interactive Shell (Python only)
prompd shell                         # AI-powered REPL with prompt execution
prompd chat                          # Direct chat mode

# Package Management
prompd package create ./project -o mypackage.pdpkg
prompd package validate mypackage.pdpkg
prompd publish mypackage.pdpkg
prompd install @namespace/package@1.0.0

# Cache Management (Python)
prompd cache clear                   # Clear compilation cache
prompd cache show                    # Display cache statistics

# Provider Configuration
prompd config provider list
prompd config provider add <name> <url> <models...>
prompd config provider setkey <provider> <key>

# Registry Operations
prompd login
prompd logout
prompd search "database helper"
prompd versions @namespace/package
prompd registry info @namespace/package
```

## High-Level Architecture

### 6-Stage Compilation Pipeline

The Python and Go CLIs implement a sophisticated compilation system:

1. **Lexical Analysis**: Parse YAML frontmatter + Markdown content
2. **Dependency Resolution**: Resolve package references via `/.well-known/registry.json`
3. **Semantic Analysis**: Validate parameters, types, and inheritance chains
4. **Asset Extraction**: Extract content from Excel, Word, PDF, PowerPoint, Images
5. **Template Processing**: Process Jinja2 templates and parameter substitution
6. **Code Generation**: Output to markdown or provider-specific JSON formats

### Package System Architecture

- **`.prmd`**: Individual prompt files (YAML frontmatter + Markdown)
- **`.pdpkg`**: ZIP archives containing multiple .prmd files + manifest.json
- **`.pdproj`**: Project metadata (excluded from packages like .csproj from NuGet)
- **`manifest.json`**: Package metadata including dependencies and version

Package references use npm-style scoping: `@namespace/package@version`

### Section Override System

Dynamic section injection via command-line flags:
```bash
prompd run file.prmd --meta:context ./src/ --meta:examples "./tests/*.json"
```

Processes any `--meta:{section}` flag and injects content into the prompt dynamically.

### Provider Architecture

Supports both standard providers (OpenAI, Anthropic) and custom endpoints (Ollama, Groq, LM Studio, etc.):

```bash
# Add custom providers via config command
prompd config provider add groq https://api.groq.com/openai/v1 llama-3.1-8b mixtral-8x7b
prompd config provider add local-ollama http://localhost:11434/v1 llama3.2 qwen2.5
prompd config provider add lm-studio http://localhost:1234/v1 local-model

# Set API keys for providers
prompd config provider setkey groq gsk_...
prompd config provider setkey openai sk-...

# List all configured providers
prompd config provider list
```

**Note:** Custom providers must expose OpenAI-compatible API endpoints (`/v1/chat/completions`).

## Key Implementation Details

### Parser Strategy
- **Python**: Uses YAML + Jinja2 with comprehensive validation
- **Go**: Minimal YAML parser focusing on speed
- **Node.js**: js-yaml with TypeScript type safety

### Package Validation
All CLIs enforce identical validation rules:
- Semantic versioning (x.y.z format)
- ZIP slip protection (path traversal prevention)
- Manifest.json requirement
- Parameter type checking
- Circular dependency detection

### Registry Integration
- Discovery protocol: `/.well-known/registry.json`
- NPM-compatible REST API
- Authentication: JWT tokens stored in `~/.prompd/config.yaml`
- Package signing with SHA256 hashes

### Security Measures
- Command injection protection via validated spawn
- Input sanitization for all user inputs
- Secrets excluded from packages (`.env*`, `*key*`, `*secret*`)
- Path traversal protection in ZIP operations

## File Format Specification

### YAML Frontmatter
```yaml
---
name: component-name       # kebab-case identifier
version: 1.0.0            # semantic version
description: Brief desc    # one-line description
inherits: "@ns/base@1.0.0" # optional inheritance (quoted)
parameters:
  - name: param_name
    type: string|integer|float|boolean|array|object
    required: true
    default: value
    pattern: "regex"      # optional validation
---
```

### Content Sections
Sections can be defined in YAML or Markdown:
```markdown
# System
AI role and behavior definition

# Context
Background information and data

# User
User request with {parameter} substitution

# Examples
Input/output examples
```

## Environment Configuration

### Config File (`~/.prompd/config.yaml`)
```yaml
default_provider: openai
default_model: gpt-4o
api_keys:
  openai: sk-...
  anthropic: sk-ant-...
registry:
  default: prompdhub
  registries:
    prompdhub:
      url: https://registry.prompdhub.ai
      token: prompd_...
```

### Environment Variables
- `OPENAI_API_KEY`: OpenAI API key
- `ANTHROPIC_API_KEY`: Anthropic API key
- `PROMPD_REGISTRY_URL`: Registry endpoint (default: https://registry.prompdhub.ai)
- `PROMPD_DISABLE_REGISTRY_DISCOVERY`: Skip discovery protocol

## Version Management

When releasing new versions, update version strings in:
- `cli/python/pyproject.toml` (version field, line 7)
- `cli/go/cmd/prompd/main.go` (version constant)
- `cli/npm/package.json` (version field, line 3)
- `vscode-extension/package.json` (version field)

Current version: **0.3.4** (Python CLI leads versioning)

## Feature Parity Status

**100% FEATURE PARITY ACHIEVED** (as of 2025-10-13)

All three CLI implementations now have complete feature parity for core operations:
- **Python CLI:** 100% ✅ (Reference implementation with advanced features)
- **Go CLI:** 100% ✅ (Complete core feature set, zero-dependency)
- **Node.js CLI:** 100% ✅ (Complete core feature set, TypeScript/MCP integration)

See [CLI-FEATURE-PARITY.md](CLI-FEATURE-PARITY.md) and [SESSION-SUMMARY.md](SESSION-SUMMARY.md) for detailed feature matrix.

## What's New in v0.3.4

### Python CLI Updates (v0.3.4)
- Latest improvements to compilation pipeline
- Enhanced package resolution
- Bug fixes and stability improvements

### Go CLI Enhancements (v0.3.3)

**Command Structure Improvements:**
- Added `prompd pack` with dual mode (packaging + installation)
  - Package mode: `prompd pack ./src --name "@org/pkg" --version "1.0.0"`
  - Install mode: `prompd pack @namespace/package@1.0.0`
- Added `prompd config` parent command hierarchy
  - `prompd config show` - Display all configuration
  - `prompd config providers` - List providers (alias)
  - `prompd config registries` - List registries (alias)
  - `prompd config provider <subcommand>` - Provider management
  - `prompd config registry <subcommand>` - Registry management
- Backwards compatible: `prompd provider` and `prompd registry` still work

**Security Features:**
- Secrets detection system (8+ secret types)
  - OpenAI, Anthropic, AWS, GitHub, Prompd registry tokens
  - Private keys, generic API keys, Bearer tokens, JWT tokens
  - Two-pass scanning before package creation
  - Blocks packaging if secrets detected
- Comprehensive input validation
  - Package name validation (npm-style scoping)
  - Semantic version validation
  - Registry URL validation (HTTPS-only except localhost)
  - File path sanitization (directory traversal prevention)
  - Malicious content detection
- Enhanced ZIP slip protection
  - Absolute path detection
  - Symlink validation
  - Null byte checks

**Files Added:**
- `security.go` (~250 lines) - Secrets detection system
- `validation.go` (~200 lines) - Input validation functions
- `security_test.go` (~200 lines) - Security unit tests
- `validation_test.go` (~230 lines) - Validation unit tests

**Test Coverage:**
- 90%+ tests passing
- 70+ new test cases added
- Security features validated
- Cross-platform compatibility verified

### npm CLI Enhancements (completed in previous work)

- Security hardening with secrets detection
- Input validation system
- `prompd pack` dual mode
- `prompd config` command structure
- 106 new security/validation tests

## Testing Strategy

### Unit Tests
- Python: pytest with coverage reporting
- Go: Standard testing package
- Node.js: Jest with ts-jest

### Integration Tests
- Package creation/validation across all CLIs
- Registry operations with mock server
- Cross-CLI compatibility for .pdpkg files

### Quick Validation
```bash
# Test files that exercise core functionality
prompd validate examples/basic/example.prmd
prompd show examples/basic/example.prmd
prompd compile examples/basic/example.prmd --to-markdown
prompd package create examples/basic -o test.pdpkg
prompd package validate test.pdpkg

# Test examples with different features
prompd validate examples/features/yaml-content.prmd      # YAML-defined sections
prompd validate examples/features/markdown-features.prmd # Markdown formatting
prompd validate examples/advanced/research-assistant.prmd # Complex prompt
```

## Common Development Tasks

### Adding a New Command
1. **Python**: Add Click command in `cli/python/prompd/commands/`
2. **Go**: Add handler in `cli/go/cmd/prompd/` and update switch in main.go
3. **Node.js**: Create command module in `cli/npm/src/commands/`

### Debugging Compilation
```bash
# Verbose output shows all compilation stages
prompd compile file.prmd --to-markdown --verbose

# Check intermediate representations
prompd compile file.prmd --debug-ast  # Python only
```

### Testing Registry Integration
```bash
# Start local registry (requires separate registry repo)
cd ../registry.prompdhub.ai/backend && npm run dev

# Set environment
export PROMPD_REGISTRY_URL=http://localhost:4000

# Test operations
prompd login
prompd publish test.pdpkg
```

## Performance Considerations

- **Go CLI**: Fastest startup, best for CI/CD pipelines
- **Python CLI**: Best for interactive use with rich output
- **Node.js CLI**: Optimized for MCP server mode

Memory usage for large packages:
- Streaming ZIP operations for files >10MB
- Lazy loading of package dependencies
- Efficient YAML parsing with minimal allocations

## Key Implementation Files

### Python CLI (`cli/python/prompd/`)
- `compiler.py` - 6-stage compilation pipeline with binary asset extraction
- `package_resolver.py` - Registry discovery and package resolution
- `parser.py` - YAML frontmatter + Markdown parsing with Jinja2
- `validator.py` - Validation rules and schema enforcement
- `shell.py` - Interactive AI shell and chat mode
- `config.py` - Configuration management for providers and registries
- `registry.py` - Registry operations (login, publish, search, install)
- `commands/` - Click command implementations

### Go CLI (`cli/go/cmd/prompd/`)
- `main.go` - Entry point and command dispatcher (v0.3.3)
- `commands.go` - Config, pack, provider, git, version, cache commands
- `package.go` - Package creation, validation, and secrets scanning
- `package_resolver.go` - Registry discovery (/.well-known/registry.json)
- `validator.go` - Core validation logic (matches Python implementation)
- `validation.go` - **NEW v0.3.3** - Input validation (package names, versions, URLs)
- `security.go` - **NEW v0.3.3** - Secrets detection system (8+ secret types)
- `compiler.go` - 6-stage compilation pipeline
- `registry.go` - Registry operations (login, logout, publish, search, install, versions)
- `config.go` - Configuration management

### Node.js CLI (`cli/npm/src/`)
- `index.ts` - Main CLI entry point and command routing
- `commands/` - Command implementations (package, registry, etc.)
- `mcp/server.ts` - Model Context Protocol integration
- `parser/` - YAML and Markdown parsing logic
- `validators/` - Validation rules
- `security.ts` - Secrets detection (matching Go CLI implementation)
- `validation.ts` - Input validation functions

### VS Code Extension (`vscode-extension/`)
- `src/extension.ts` - Main extension entry point
- `package.json` - Extension manifest with command definitions
- `syntaxes/prompd.tmLanguage.json` - Syntax highlighting rules

## Critical Architecture Notes

### CLI Implementation Priority
When adding features, implement in this order:
1. **Python CLI first** - Most feature-complete, canonical implementation
2. **Go CLI** - Core features only (zero-dependency constraint)
3. **Node.js CLI** - Developer-focused features (TypeScript, MCP)

### Multi-CLI Consistency Rules
- All CLIs must share identical validation logic
- Package format (.pdpkg) must be cross-compatible
- Registry API calls must use same endpoints/authentication
- File format parsing (.prmd) must produce identical results

### Build Artifacts
- Python: PyPI package (`pip install prompd`)
- Go: 6 cross-platform binaries (Windows/Linux/macOS × amd64/arm64) in `dist/`
- Node.js: npm package (not yet published)

### Testing Before Release
```bash
# Validation checklist across all implementations
python cli/python/run_tests.py           # Python quick tests
cd cli/go && go test ./...                # Go tests
cd cli/npm && npm test                    # Node.js tests
prompd validate examples/basic/example.prmd  # Cross-CLI validation test
```

## Additional Commands

### Dependency Management
```bash
prompd deps                              # Analyze project dependencies
prompd deps @namespace/package@1.0.0    # Analyze specific package
prompd deps --tree                       # Show dependency tree
prompd deps --conflicts                  # Check for version conflicts
```

### Namespace Management
```bash
prompd namespace list                    # List your namespaces
prompd namespace current                 # Show current namespace context
prompd namespace use @mycompany          # Switch to different namespace
prompd namespace create @mycompany       # Create namespace
```

### Command Aliases
- `prompd pack` - Alias for `prompd package create`

## Exit Codes

Understanding exit codes for automation and error handling:

- `0` - Success
- `1` - General error
- `2` - Validation error
- `3` - Network/registry error
- `4` - Authentication error
- `5` - File not found
- `6` - Permission denied

## Additional Documentation

For comprehensive command documentation, see:
- [PROMPD-COMMANDS-REFERENCE.md](PROMPD-COMMANDS-REFERENCE.md) - Complete command reference with all options
- [DISTRIBUTION.md](DISTRIBUTION.md) - Distribution and release strategy
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines