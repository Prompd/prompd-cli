# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

```bash
# Install Python CLI globally (recommended)
pip install prompd

# Development installation
cd cli/python && pip install -e ".[dev,mcp]"

# Quick test across all CLIs
python cli/python/run_tests.py && cd cli/go && go test ./... && cd ../npm && npm test

# Build cross-platform Go binaries
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
# Python
cd cli/python
pytest tests/test_parser.py::test_specific_function -v
black prompd/ && ruff check prompd/

# Go
cd cli/go
go test ./... -run TestValidateFile
go build -ldflags "-s -w" -o prompd.exe ./cmd/prompd

# Node.js
cd cli/npm
npm run build && npm test
npx jest parser --verbose

# VS Code Extension
cd vscode-extension
npm run compile  # Build
npm run watch    # Dev mode
```

### Core Operations

```bash
# Validation & Display
prompd validate example.prmd
prompd show example.prmd
prompd list [path]

# Compilation Pipeline (Python/Go)
prompd compile example.prmd --to-markdown
prompd compile example.prmd --to-provider-json openai
prompd compile @namespace/package@1.0.0 -p key=value

# Execution (Python/Node.js)
prompd run example.prmd --provider openai --model gpt-4o -p key=value
prompd run example.prmd --meta:context ./src/ --meta:debug true

# Package Management
prompd package create ./project -o mypackage.pdpkg
prompd package validate mypackage.pdpkg
prompd publish mypackage.pdpkg
prompd install @namespace/package@1.0.0

# Registry Operations
prompd login
prompd search "database helper"
prompd versions @namespace/package
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

Supports both standard providers (OpenAI, Anthropic) and custom endpoints:
```bash
prompd provider add groq https://api.groq.com/openai/v1 llama-3.1-8b
prompd provider add local-ollama http://localhost:11434/v1 llama3.2
```

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
- Authentication: JWT tokens stored in `~/.prmd/config.yaml`
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

### Config File (`~/.prmd/config.yaml`)
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

When releasing new versions, update:
- `cli/python/pyproject.toml` (version field)
- `cli/go/cmd/prompd/main.go` (version constant)
- `cli/npm/package.json` (version field)
- `vscode-extension/package.json` (version field)

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
# Test file that exercises core functionality
prompd validate examples/basic/example.prmd
prompd compile examples/basic/example.prmd --to-markdown
prompd package create examples/basic -o test.pdpkg
prompd package validate test.pdpkg
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