# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚡ Quick Start

```bash
# Install Python CLI globally (recommended first step)
pip install prompd

# Or install from source for development
cd prompd-cli/cli/python
pip install -e ".[dev,mcp]"

# Validate installation with examples
prompd --version
prompd validate examples/basic/example.prmd

# Try compilation (6-stage composable compiler)
prompd compile examples/basic/example.prmd --to-markdown

# Quick validation across all systems
python cli/python/run_tests.py && cd cli/go && go test ./... && cd cli/npm && npm test
```

## Project Overview

Prompd is a revolutionary composable AI prompt ecosystem - the "npm for AI prompts". It provides:
- Universal package management system for AI workflows
- Multi-platform CLI implementations (Python, Go, Node.js)
- VS Code extension with syntax highlighting and execution
- Package registry with npm-compatible API
- Composable prompt architecture with inheritance and package references

## Repository Structure

```
prompd-cli/                         # Multi-platform CLI implementations
├── cli/
│   ├── python/                     # Full-featured CLI with 6-stage compiler
│   ├── go/                         # Lightweight zero-dependency CLI
│   └── npm/                        # TypeScript CLI with MCP support
├── vscode-extension/               # VS Code language support
├── examples/                       # Sample .prmd files demonstrating features
├── dist/                          # Go build outputs (cross-platform binaries)
└── build.bat / build.sh           # Cross-platform build scripts
```

## Build & Test Commands

### Python CLI
```bash
cd cli/python
pip install -e ".[dev,mcp]"         # Install with development extras
python run_tests.py                 # Quick validation test
pytest tests/                       # Full test suite
pytest tests/test_parser.py -v     # Single test file
black prompd/                       # Format code
ruff check prompd/                  # Lint code

# Build and publish to PyPI
python -m build
python -m twine upload dist/*
```

### Go CLI
```bash
cd cli/go
go build -o prompd.exe ./cmd/prompd
go test ./...
go test ./... -run TestValidateFile  # Specific test pattern
./prompd.exe validate ../../examples/basic/example.prmd

# Cross-platform build
../../build.bat                     # Windows - builds all platforms
../../build.sh                      # Unix - builds all platforms
```

### Node.js CLI
```bash
cd cli/npm
npm install
npm run build
npm test
npm run test:watch                  # Watch mode
npx jest parser --verbose           # Specific test suite
npm run dev                         # Development mode with ts-node
```

### VS Code Extension
```bash
cd vscode-extension
npm install
npm run compile                     # Full compilation
npm run watch                       # Watch mode for development
```

## Core CLI Commands

### Package Management (All CLIs)
```bash
# Package operations
prompd package create <dir> -o package.pdpkg
prompd package validate <package.pdpkg>

# Registry operations (npm-style)
prompd login                        # Interactive authentication
prompd publish <package.pdpkg>      # Publish package
prompd search <query>               # Search packages
prompd install @namespace/package@version
prompd versions <package>           # List versions
prompd registry info <package>      # Package details
```

### Compilation & Execution
```bash
# Compilation (composable architecture)
prompd compile <file> --to-markdown -o output.md
prompd compile <file> --to-provider-json openai
prompd compile @namespace/package@version -p key=value

# Execution
prompd run <file> --provider openai --model gpt-4o -p key=value
prompd run <file> --params-file params.json --meta:context ./src/
```

### Python-specific Features
```bash
# Interactive AI shell
prompd shell                        # AI-powered conversational interface
prompd chat                         # Direct chat mode

# MCP server
prompd mcp serve <file> --port 3333
prompd mcp dockerize                # Generate Docker setup

# Provider management
prompd provider add <name> <url> <models...>
prompd provider setkey <provider> <key>

# Custom provider examples
prompd provider add groq https://api.groq.com/openai/v1 llama-3.1-8b mixtral-8x7b
prompd provider add local-ollama http://localhost:11434/v1 llama3.2 qwen2.5
prompd provider add lm-studio http://localhost:1234/v1 local-model
```

## High-Level Architecture

### 6-Stage Composable Compilation Pipeline
1. **Lexical Analysis** - Parse .prmd files and extract metadata
2. **Dependency Resolution** - Resolve package references via `/.well-known/registry.json`
3. **Semantic Analysis** - Validate parameters and inheritance chains
4. **Asset Extraction** - Extract from Excel, Word, PDF, PowerPoint, Images
5. **Template Processing** - Process inheritance and composition
6. **Code Generation** - Output to markdown/JSON formats

### Package System
- `.prmd` - Individual prompt files (YAML frontmatter + Markdown)
- `.pdflow` - Workflow definitions
- `.pdproj` - Project files (IDE only, excluded from packages)
- `.pdpkg` - Distribution packages (ZIP archives with manifest.json)

### Package Naming & References
- **Package names**: `@namespace/package-name` (npm-style scoped packages)
- **Package references**: `"@namespace/package@version"` (MUST be quoted in YAML)
- **Inheritance syntax**:
  - Local files: `inherits: "./base-template.prmd"`
  - Packages: `inherits: "@prompd.io/core-patterns@2.0.0"` (quotes required)

### Registry Architecture
- **Discovery Protocol**: `/.well-known/registry.json` for package discovery
- **NPM-Compatible API**: Standard package management endpoints
- **Authentication**: JWT + API tokens
- **Storage**: Package metadata and artifacts

## Environment Configuration

### CLI Configuration (`~/.prmd/config.yaml`)
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
```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
PROMPD_REGISTRY_URL=http://localhost:4000
PROMPD_DISABLE_REGISTRY_DISCOVERY=false
```

## Testing Requirements

### Quick Validation Across All CLIs
```bash
# Python
python cli/python/run_tests.py

# Go
cd cli/go && go test ./...

# Node.js
cd cli/npm && npm test

# Core operations to verify
prompd validate <file>
prompd package create/validate
prompd compile <file> --to-markdown
```

### Single Test Execution
```bash
# Python - Run specific test files
cd cli/python && pytest tests/test_parser.py -v
cd cli/python && pytest tests/test_validator.py::test_specific_function -v

# Go - Run tests with specific patterns
cd cli/go && go test ./... -run TestValidateFile

# Node.js - Run specific test suites
cd cli/npm && npx jest parser --verbose
cd cli/npm && npx jest --testNamePattern="should validate parameters"
```

## Security Standards
- Command injection protection (validated spawn)
- ZIP slip protection (path traversal checks)
- Input sanitization across all CLIs
- Secrets excluded from packages (.env*, keys)

## Version Management

When releasing, update versions in:
- `cli/python/pyproject.toml`
- `cli/go/cmd/prompd/main.go`
- `cli/npm/package.json`
- `vscode-extension/package.json`

## Multi-CLI Strategy

### Architecture Overview
- **Python CLI**: Full-featured with AI shell, MCP server, complete compilation pipeline
- **Go CLI**: Zero-dependency lightweight version for containers/CI/CD
- **Node.js CLI**: Developer-focused with MCP integration and TypeScript support
- All CLIs maintain feature parity for core operations (validate, package, registry)

### Command Parsing Strategy
Each CLI uses different argument parsing approaches:
- **Python**: Click framework with decorators for command definition
- **Go**: Manual `os.Args` parsing with switch statements for performance
- **Node.js**: Commander.js with modular command files in `src/commands/`

### Package Validation Architecture
The `.pdpkg` validation follows identical logic across all CLIs but with different implementations:
- **Python**: `package_validator.py` with comprehensive ZIP handling
- **Go**: `package.go` with minimal dependencies (only `yaml.v3`)
- **Node.js**: `package.ts` using archiver/unzipper libraries

### Registry Integration Pattern
All CLIs share the same REST API contract but handle authentication differently:
- **Python**: Stores tokens in `~/.prmd/config.json` with `httpx` client
- **Go**: Minimal HTTP client with manual JSON marshaling
- **Node.js**: Axios client with JWT token management

## Key Implementation Files

**Python CLI**
- `cli/python/prompd/compiler.py` - 6-stage compilation pipeline
- `cli/python/prompd/package_resolver.py` - Registry discovery
- `cli/python/prompd/shell.py` - Interactive AI shell

**Go CLI**
- `cli/go/cmd/prompd/main.go` - Main entry point
- `cli/go/cmd/prompd/package.go` - Package operations

**Node.js CLI**
- `cli/npm/src/index.ts` - Command dispatcher
- `cli/npm/src/commands/package.ts` - Package management
- `cli/npm/src/mcp/server.ts` - MCP integration

**VS Code Extension**
- `vscode-extension/src/extension.ts` - Main extension entry
- `vscode-extension/package.json` - Language and command definitions

## Composable Package Architecture

### Revolutionary Features
- **World's first composable AI prompt system** with package inheritance
- **Package References**: Use `"@namespace/package@version"` syntax (quotes required in YAML)
- **Binary Asset Extraction**: Direct support for Excel, Word, PDF, PowerPoint, Images, CSV, JSON, YAML
- **6-Stage Compilation Pipeline**: Full transformation from source to provider-specific JSON/markdown
- **Registry Discovery**: Uses `/.well-known/registry.json` standard for package resolution

### Package Development Workflow
- Test with examples in `examples/` directory
- Validate package structure before publishing
- Use `prompd package validate` across all CLIs
- Check manifest.json format and content integrity

## Common Issues & Solutions

### Build Issues
- **Go build fails**: Ensure Go 1.20+ is installed and `go.mod` is valid
- **Python import errors**: Ensure development install with `pip install -e ".[dev,mcp]"`
- **Node.js TypeScript errors**: Run `npm run build` for full rebuild
- **Extension not loading**: Check VS Code extension development mode

### Package Validation
- Ensure manifest.json present in .pdpkg
- Verify semantic versioning (x.y.z)
- Check for path traversal attempts
- Exclude .pdproj files from packages

## Quick Reference

### File Formats
- `.prmd` - Prompt files (YAML frontmatter + Markdown) - **NEW FORMAT**
- `.prompd` - Legacy prompt files (deprecated, use .prmd)
- `.pdflow` - Workflow definitions
- `.pdproj` - Project files (IDE only, never in packages)
- `.pdpkg` - Distribution packages (ZIP archives)

### Environment Variables
```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
PROMPD_REGISTRY_URL=http://localhost:4000
```

### Cross-Platform Builds
- Windows: `build.bat` - Creates binaries for all platforms
- Unix: `build.sh` - Creates binaries for all platforms
- Output: `dist/prompd-{platform}-{arch}[.exe]`
- Zero dependencies - standalone binaries can run anywhere