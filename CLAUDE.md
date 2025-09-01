# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Global Context

**FIRST:** Read the global coordination file at `C:\Users\sbake\.claude\CLAUDE.md` for current sprint priorities, team coordination, and strategic context before beginning any work.

## Project Overview

Prompd is a structured format and CLI ecosystem for AI prompts. It provides universal LLM provider support, version control integration, and package management. The project has multiple implementations (Python, Go, Node.js) and a VS Code extension.

## 🚨 CRITICAL: Architecture Rules

**BEFORE CREATING ANY FILES:**
1. **NEVER create files in repository root** - Always use established directory structures
2. **NEVER create standalone scripts** - Always extend existing CLI implementations  
3. **ALWAYS check existing patterns** - Look at cli/python/, cli/go/, cli/npm/ structure first
4. **EXTEND, DON'T REPLACE** - Add to existing validators, parsers, command handlers
5. **MAINTAIN CLI PARITY** - If adding to one CLI, plan for others (Python, Go, Node.js)

**File Location Rules:**
- CLI extensions: `cli/python/prompd/`, `cli/go/cmd/prompd/`, `cli/npm/src/`
- Tests: Follow existing test directories in each CLI
- Examples: `examples/` directory only
- Documentation: `docs/` directory only

## 🛠️ Development Commands

### Python CLI

```bash
# Install development environment
cd cli/python
pip install -e ".[dev]"

# Quick validation test
python run_tests.py

# Full test suite
pytest tests/

# Code quality
black prompd/
ruff check prompd/

# Build for PyPI
python -m build

# Upload to PyPI (after version bump)
python -m twine upload dist/prompd-0.3.0*
```

### Go CLI

```bash
# Build current platform
cd cli/go
go build -o prompd.exe ./cmd/prompd

# Run tests
go test ./...

# Build all platforms (from repo root)
./build.bat  # Windows
./build.sh   # Unix

# Test the build
./prompd.exe validate ../../examples/basic/example.prompd
```

### Node.js CLI

```bash
cd cli/npm
npm install
npm run build
npm test
npm run test:watch  # Development mode

# Run specific test file
npx jest tests/parser.test.ts
npx jest tests/integration.test.ts

# Run server for MCP integration
npm run dev  # Uses ts-node for development
```

### VS Code Extension

```bash
cd vscode-extension
npm install
npm run compile
npm run watch  # Development mode
```

## 📦 Package Management

### Package Commands (All CLIs)
```bash
# Package operations
prompd package create <directory> -o output.pdpkg
prompd package validate <package.pdpkg>

# Registry operations (npm-style top-level commands)
prompd login                        # Interactive or token-based authentication
prompd logout                       # Clear authentication
prompd publish <package.pdpkg>      # Publish package
prompd search <query>               # Search packages
prompd install <package>@<version>  # Install package
prompd versions <package>           # List package versions
prompd registry info <package>      # Get detailed package info (only nested command)

# Compilation system (composable architecture)
prompd compile <file> --to-markdown
prompd compile <file> --to-provider-json openai
prompd compile @namespace/package@2.0.0 -p key=value
prompd render <file> -p key=value   # Template rendering
```

### Package Format
- `.pdpkg` files are ZIP archives containing:
  - `manifest.json` - Package metadata
  - Multiple `.prompd` files
  - NO `.pdproj` files (excluded like .csproj from NuGet)

### Composable Architecture Features
- **Package References**: `@namespace/package@version` syntax for package composition
- **Inheritance**: `inherits: base-template.prompd` for template inheritance
- **Package Usage**: `using: [@security/audit@2.0.0, @utils/common]` with optional prefixes
- **6-Stage Compilation**: Lexical → Dependency Resolution → Semantic → Asset Extraction → Template Processing → Code Generation
- **Binary Asset Extraction**: Excel, Word, PDF, PowerPoint, Images, CSV, JSON, YAML files
- **/.well-known/registry.json**: Package registry discovery protocol

## 🔄 Version Management

When releasing, update ALL version files:
- `cli/python/pyproject.toml` (line 7)
- `cli/python/prompd/__init__.py`
- `cli/python/prompd/cli.py` 
- `cli/go/cmd/prompd/main.go` (const VERSION)
- `cli/npm/package.json` (line 3)
- `vscode-extension/package.json` (line 5)

## 🧪 Testing Requirements

### Before Any Commit
```bash
# Python quick test
python cli/python/run_tests.py

# Go build & test
cd cli/go && go build -o prompd.exe ./cmd/prompd
./prompd.exe validate ../../examples/basic/example.prompd

# Node.js tests
cd cli/npm && npm test
```

### Core Operations to Test
- `prompd validate <file>`
- `prompd list <directory>`
- `prompd show <file>`
- `prompd package create/validate`
- Registry operations (if backend running)

## 🏗️ CLI Architecture

### 🏆 **PRODUCTION READY: Complete "npm for AI prompts" ecosystem** 🏆

**Python CLI (Full-featured)** ✅ **100% COMPLETE**
- Complete LLM provider support with execute/run commands
- 6-stage composable compilation pipeline with binary asset extraction
- Complete registry integration with npm-style commands (login, publish, search, install, versions)
- Git integration & version management 
- Package creation & validation
- Provider management (custom endpoints)

**Go CLI (Lightweight - Zero Dependencies)** ✅ **Core Operations Complete**
- All core operations (validate, list, show, execute, render)
- Package operations (create, validate) 
- Registry operations (login, logout, publish, search, install, info, versions)
- Zero external dependencies (only yaml.v3)

**Node.js CLI (Developer-focused)** ✅ **~75% COMPLETE** 
- TypeScript implementation with execute command
- MCP (Model Context Protocol) support
- Package & registry operations
- Express server capabilities

### Registry Command Restructuring ✅ **COMPLETE**
Modern npm-style command structure implemented:
- `prompd login` / `prompd logout` - First-class authentication commands
- `prompd publish`, `prompd search`, `prompd install`, `prompd versions` - Top-level package operations
- `prompd registry info` - Only remaining nested command for detailed package information

### Interactive AI Shell ✅ **BREAKTHROUGH FEATURE**
Claude Code-style conversational interface for Prompd development:
- **Natural Language Processing**: "compile my security audit for Node.js app" → intelligent command extraction
- **Multi-Provider AI**: OpenAI → Anthropic fallback for conversational responses
- **Rich Shell Features**: Tab completion, file operations, directory navigation
- **Chat Mode**: `/exit`, `/clear`, conversation history, typing indicators
- **Provider Management**: Built-in AI provider switching and status checking

## 🔐 Security Standards

**2025-08-27: Production Security Achieved**
- ✅ Command injection protection (spawn with validation)
- ✅ ZIP slip protection (path traversal checks)
- ✅ Input sanitization across all CLIs
- Maintain these standards in all new code

## 📋 Command Patterns

### Interactive Shell (NEW!)
```bash
# Start the AI-powered shell
prompd shell

# Natural language commands in shell:
> compile my security audit for Node.js app
> show me what's in that API prompt  
> chat   # Enter conversational mode
> /exit  # Return to shell commands
> provider openai  # Switch AI provider
```

### Provider Management (Python/Node.js)
```bash
prompd provider add <name> <url> <models...> [--api-key KEY]
prompd provider list
prompd provider show <name>
prompd provider remove <name>
```

### Git Integration (Python/Node.js)
```bash
prompd git add <files...>
prompd git commit -m "message"
prompd git checkout <file> <version>
prompd version bump <file> <major|minor|patch>
prompd version history <file>
```

### Execution (Python/Node.js)
```bash
prompd execute <file> --provider <provider> --model <model> -p key=value
prompd execute <file> --version <version>  # Execute specific version
```

## 🎯 Common Development Tasks

### Adding New Commands
1. Implement in Python first (`cli/python/prompd/cli.py`)
2. Port core functionality to Go (`cli/go/cmd/prompd/main.go`)
3. Port to Node.js with TypeScript (`cli/npm/src/index.ts`)
4. Maintain consistent command syntax

### Extending Package Validation
- Python: `cli/python/prompd/package_validator.py`
- Go: `cli/go/cmd/prompd/package.go`
- Node.js: `cli/npm/src/commands/package.ts`

### Working with Registry
- Backend: `http://localhost:4000`
- Frontend: `http://localhost:5173`
- API tokens stored in `~/.prompd/config.json`

## 📐 File Format Standards

- `.prompd` - Prompt files (YAML frontmatter + Markdown)
- `.pdflow` - Workflow definitions
- `.pdproj` - Project files (IDE only, never in packages)
- `.pdpkg` - Distribution packages (ZIP archives)

## ⚡ Quick Reference

### Repository Structure
```
prompd-cli/
├── cli/
│   ├── python/     # Full-featured CLI
│   ├── go/         # Lightweight CLI  
│   └── npm/        # TypeScript CLI
├── vscode-extension/
├── examples/
├── docs/
└── dist/           # Go build outputs
```

### Key Files
- Format spec: `docs/FORMAT.md`
- CLI reference: `docs/CLI.md`
- Provider docs: `docs/PROVIDERS.md`
- Component system: `docs/COMPONENT-SYSTEM.md`

### Environment Variables
```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
PROMPD_REGISTRY_URL=http://localhost:4000
```

## 🔍 Single Test Execution

### Running Individual Tests
```bash
# Python - Run specific test file
cd cli/python && pytest tests/test_parser.py -v
cd cli/python && pytest tests/test_validator.py::test_specific_function -v

# Go - Run tests with specific pattern
cd cli/go && go test ./... -run TestValidateFile

# Node.js - Run specific test suites
cd cli/npm && npx jest parser --verbose
cd cli/npm && npx jest --testNamePattern="should validate parameters"

# Quick smoke test across all CLIs
python cli/python/run_tests.py && cd cli/go && go test ./... && cd cli/npm && npm test
```

## 🧬 Architecture Deep Dive

### Command Parsing Strategy
Each CLI uses different argument parsing approaches:
- **Python**: Click framework with decorators for command definition
- **Go**: Manual `os.Args` parsing with switch statements for performance
- **Node.js**: Commander.js with modular command files in `src/commands/`

### Composable Compilation Pipeline (6-Stage Architecture)
The Python CLI implements a complete composable compilation system:
1. **Lexical Analysis**: Parse .prompd files and extract metadata
2. **Dependency Resolution**: Resolve package references with /.well-known/registry.json discovery
3. **Semantic Analysis**: Validate parameters, dependencies, and inheritance chains
4. **Asset Extraction**: Extract content from binary files (Excel, Word, PDF, PowerPoint, Images)
5. **Template Processing**: Process inheritance, merge content, handle using: prefixes
6. **Code Generation**: Generate output in various formats (markdown, OpenAI JSON, Anthropic JSON)

Key files:
- **Python**: `cli/python/prompd/compiler.py` - Full 6-stage pipeline with binary extraction
- **Package Resolver**: `cli/python/prompd/package_resolver.py` - Registry discovery and caching

### Package Validation Architecture
The `.pdpkg` validation follows identical logic across all CLIs but with different implementations:
- **Python**: `package_validator.py` with comprehensive ZIP handling 
- **Go**: `package.go` with minimal dependencies (only `yaml.v3`)
- **Node.js**: `package.ts` using archiver/unzipper libraries

### Registry Integration Pattern
All CLIs share the same REST API contract but handle authentication differently:
- **Python**: Stores tokens in `~/.prompd/config.json` with `httpx` client
- **Go**: Minimal HTTP client with manual JSON marshaling  
- **Node.js**: Axios client with JWT token management

### Interactive Shell Architecture
The conversational AI shell (`cli/python/prompd/shell.py`) implements:
- **Natural Language Processing**: Intent recognition with regex patterns and parameter extraction
- **AI Provider Integration**: Multi-provider fallback system (OpenAI → Anthropic) with async execution
- **Rich Console Interface**: Rich library integration with autocompletion, syntax highlighting, and interactive prompts
- **File Operations**: Advanced file management with confirmation workflows and context awareness
- **Chat System**: Conversation history, typing indicators, and command suggestions

### Security Implementation Locations
Command injection and ZIP slip protections are implemented in:
- **Python**: `cli/python/prompd/package_validator.py:235-244`
- **Go**: `cli/go/cmd/prompd/package.go:383-390` 
- **Node.js**: `cli/npm/src/commands/package.ts:302-311`

## 📝 Important Notes

- **PyPI releases are permanent** - Test thoroughly before publishing
- **Maintain backward compatibility** - Don't break existing workflows
- **Follow established patterns** - Check existing code before implementing
- **Security first** - Validate all inputs, sanitize paths, protect secrets