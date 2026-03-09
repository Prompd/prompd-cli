# Prompd - Structured Prompt Definitions for LLMs

[![License: Elastic-2.0](https://img.shields.io/badge/License-Elastic--2.0-blue.svg)](LICENSE)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)

Prompd is a CLI tool and file format for managing structured AI prompts. Write once, run anywhere - execute the same prompt across OpenAI, Anthropic, Ollama, local models, or any OpenAI-compatible API.

## Installation

### Multiple CLI Options

```bash
# Option 1: Python CLI (Full Featured - Recommended)
pip install prompd

# Option 2: Go CLI (Zero Dependencies, Single Binary)
# Download from releases or build:
cd go && go build -o prompd ./cmd/prompd

# Option 3: Node.js/TypeScript CLI (Developer Focused)
cd typescript && npm install && npm run build
```

**Choose based on your deployment needs:**
- **Python CLI**: Full-featured with compilation pipeline, AI shell, MCP server, and all advanced features
- **Go CLI**: Lightweight, zero-dependency binary for containers, CI/CD, minimal environments
- **Node.js CLI**: Developer-focused with TypeScript and MCP integration

> **Note**: The Python CLI is the most feature-complete implementation. Go and Node.js CLIs are being updated to achieve feature parity.

### Install Python CLI from PyPI

```bash
# Install the latest release
pip install prompd
```

### Install from Source

```bash
# Clone and install in development mode
git clone https://github.com/Prompd/prompd-cli.git
cd prompd-cli

# Python CLI
pip install -e python/

# Or with development dependencies
pip install -e "python/[dev]"
```

### Requirements
- Python 3.8+
- Git (required for version management features)

## Quick Start

### 1. Create a Prompd file

Create a file `example.prmd`:

```yaml
---
name: greeting-generator
description: Generate personalized greetings
version: 1.0.0
parameters:
  - name: name
    type: string
    required: true
    description: Person's name
  - name: style
    type: string
    default: friendly
    description: Greeting style (friendly, formal, casual)
---

# System

You are a helpful AI assistant that creates personalized greetings.

# User

Generate a {style} greeting for {name}.

{%- if style == "formal" %}
Use formal language and titles.
{%- elif style == "casual" %}
Use casual, relaxed language.
{%- else %}
Use warm, friendly language.
{%- endif %}
```

### 2. Execute the Prompd file

```bash
# Execute with OpenAI
prompd run example.prmd --provider openai --model gpt-4 -p name=Alice -p style=formal

# Execute with Anthropic
prompd run example.prmd --provider anthropic --model claude-3-opus -p name=Bob

# Add custom provider (Ollama, Groq, LM Studio, etc.)
prompd config provider add local-ollama http://localhost:11434/v1 llama3.2 qwen2.5

# Execute with custom provider
prompd run example.prmd --provider local-ollama --model llama3.2 -p name=Charlie

# Validate the file
prompd validate example.prmd

# Compile to markdown
prompd compile example.prmd --to-markdown

# Bump version
prompd version bump example.prmd minor
```

## Core Commands

### `prompd run`
Run a .prmd file with an LLM provider.

```bash
prompd run FILE [options]

Options:
  --provider TEXT        LLM provider (openai, anthropic, ollama)
  --model TEXT           Model name
  -p, --param TEXT       Parameter in format key=value
  -f, --param-file PATH  JSON parameter file
  --api-key TEXT         API key override
  -o, --output PATH      Output file path
  --format [text|json]   Output format
  --version TEXT         Execute a specific version (e.g., '1.2.3', 'HEAD', commit hash)
  -v, --verbose          Verbose output
  --show-usage           Show token usage statistics
```

### `prompd compile`
Compile a .prmd file or package reference to a target format.

```bash
prompd compile SOURCE [options]

Options:
  --to TEXT                       Output format (markdown | provider-json [openai|anthropic])
  --to-markdown                   Shorthand for --to markdown
  --to-provider-json [openai|anthropic]  Shorthand for --to provider-json <provider>
  -p, --param TEXT                Parameter in format key=value
  -f, --params-file PATH          Load parameters from JSON file
  -o, --output PATH               Write compiled output to file
  -v, --verbose                   Verbose output
```

### `prompd validate`
Validate a .prmd file syntax and structure.

```bash
prompd validate FILE [options]

Options:
  -v, --verbose      Show detailed validation results
  --git              Include git history consistency checks
  --version-only     Only validate version-related aspects
  --check-overrides  Validate section overrides against parent template
```

### `prompd config`
Configuration management commands.

```bash
prompd config show                                    # Show all configuration
prompd config registries                              # List configured registries
prompd config providers                               # List configured providers

# Registry configuration
prompd config registry list                           # List all configured registries
prompd config registry add <name> <url> [options]    # Add a new registry
prompd config registry remove <name>                  # Remove a registry
prompd config registry set-default <name>             # Set default registry
prompd config registry show [name]                    # Show registry details

# Provider configuration
prompd config provider list                           # List all configured providers
prompd config provider add <name> <url> <models...>  # Add custom provider
prompd config provider remove <name>                  # Remove custom provider
prompd config provider setkey <name> <api_key>       # Set API key for provider

# Examples
prompd config provider add groq https://api.groq.com/openai/v1 llama-3.1-8b --api-key gsk_...
prompd config provider add local-ollama http://localhost:11434/v1 llama3.2 qwen2.5
```

### `prompd package`
Package management commands.

```bash
prompd package create <source> [output] [options]  # Create a .pdpkg package
prompd package validate <package.pdpkg>            # Validate a .pdpkg package

Options for create:
  -n, --name TEXT         Package name
  -V, --version TEXT      Package version
  -d, --description TEXT  Package description
  -a, --author TEXT       Package author
```

### `prompd git`
Git operations for .prmd files.

```bash
prompd git add <files...>                         # Add .prmd files to git staging
prompd git remove <files...> [--cached]          # Remove .prmd files from git tracking
prompd git status                                # Show git status for .prmd files
prompd git commit -m "message" [--all]           # Commit staged .prmd files
prompd git checkout <file> <version> [-o FILE]   # Checkout a specific version
```

### `prompd version`
Version management commands.

```bash
prompd version bump <file> <major|minor|patch>   # Bump version and create git tag
prompd version history <file>                     # Show version history
prompd version diff <file> <v1> [v2]             # Show differences between versions
prompd version suggest <file>                     # Suggest appropriate version bump
prompd version validate <file>                    # Validate version consistency
```

### Registry Commands

```bash
prompd login                        # Login to package registry
prompd logout                       # Logout from package registry
prompd search <query>               # Search packages in registry
prompd install <package>            # Install packages from registry
prompd uninstall <package>          # Uninstall packages
prompd publish <package.pdpkg>      # Publish package to registry
prompd versions <package>           # List available versions of a package
```

### Other Commands

```bash
prompd list [options]               # List available .prmd files
  -p, --path PATH                   # Directory to search
  -d, --detailed                    # Show detailed information
  -r, --recursive                   # Search recursively

prompd show FILE [options]          # Show file structure and parameters
  --sections                        # Show available section IDs
  --verbose                         # Show detailed section information

prompd create FILE [options]        # Create a new .prmd file
  -i, --interactive                 # Interactive mode with prompts
  -n, --name TEXT                   # Prompt name
  -d, --description TEXT            # Prompt description
  -a, --author TEXT                 # Author name
  -v, --version TEXT                # Version (default: 1.0.0)
  -t, --template [basic|analysis|security|code-review|creative]

prompd init [path]                  # Initialize a new Prompd project
prompd shell                        # Start interactive Prompd shell (REPL)
prompd chat                         # Start Prompd shell in chat mode
```

## Prompd File Format

A `.prmd` file combines YAML frontmatter with Markdown content:

### YAML Frontmatter
```yaml
---
name: my-prompt           # Required: kebab-case identifier
version: 1.0.0           # Semantic version (x.y.z)
description: Description  # Brief description
parameters:              # Parameter definitions
  - name: param_name
    type: string         # string|integer|float|boolean|array|object
    required: true       # Optional: default false
    default: value       # Optional: default value
    description: text    # Optional: description

# Optional: Define content in YAML
system: |
  You are an expert assistant.
  Full **Markdown** supported here.
  
user: "Inline content with **markdown**"
---
```

### Markdown Content
```markdown
# System
Define the AI's role and behavior

# Context
Provide background information

# User
The user's request with {parameters}

# Response
Expected response format
```

### Features

#### Full Markdown Support
- **Bold**, *italic*, `code`
- Lists, tables, blockquotes
- Code blocks with syntax highlighting
- Links and images

#### Variable Substitution
- Simple: `{variable_name}`
- Nested: `{inputs.field_name}`
- Jinja2: `{%- if condition %} ... {%- endif %}`

#### Parameter Validation
```yaml
parameters:
  - name: email
    type: string
    pattern: "^[\w.-]+@[\w.-]+\.\w+$"
    error_message: "Invalid email format"
    
  - name: count
    type: integer
    min_value: 1
    max_value: 100
    default: 10
```

## Working with Versions

Execute or checkout specific versions of your prompts:

```bash
# Execute version 1.2.3 without modifying files
prompd run prompt.prmd --provider openai --model gpt-4 --version 1.2.3

# Execute last committed version
prompd run prompt.prmd --provider openai --model gpt-4 --version HEAD

# Checkout version to working directory
prompd git checkout prompt.prmd 1.2.3

# Checkout to different file (preserve current)
prompd git checkout prompt.prmd 1.2.3 -o prompt-v1.2.3.prmd
```

## Features

- **Universal Execution**: Run prompts on any LLM (OpenAI, Anthropic, Ollama)
- **Parameter Management**: Type-safe parameters with validation
- **Version Control**: Git-integrated semantic versioning
- **Full Markdown Support**: Rich formatting in prompts
- **VS Code Extension**: Syntax highlighting, IntelliSense, and execution
- **Extensible**: Plugin architecture for new providers

## Configuration

Set API keys via environment variables:
```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or create `~/.prompd/config.json`:
```json
{
  "providers": {
    "openai": {
      "api_key": "sk-..."
    },
    "anthropic": {
      "api_key": "sk-ant-..."
    }
  },
  "default_provider": "openai",
  "default_model": "gpt-4"
}
```

## Documentation

- [Prompd Docs](https://github.com/Prompd/prompd-docs) — Format spec, guides, and reference documentation
- [Examples](https://github.com/Prompd/prompds) — Community prompt packages and templates
- [Desktop App](https://github.com/Prompd/prompd-app) — Visual IDE for building and deploying AI workflows
- [VS Code Extension](https://github.com/Prompd/prompd-vscode) — Syntax highlighting and IntelliSense for .prmd files

## Development

### Running Tests
```bash
# Quick test
python run_tests.py

# Full test suite
pip install pytest
pytest tests/
```

### Contributing
Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Submit a pull request

## Roadmap

- **Phase 1**: Core CLI and file format
- **Phase 2**: Package registry and composition pipeline
- **Phase 3**: Web UI and collaboration features

## License

Elastic License 2.0 (ELv2) - see [LICENSE](LICENSE) file.

## Related

- [Prompd Desktop App](https://github.com/Prompd/prompd-app) — Visual IDE for building and deploying AI workflows
- [Community Prompts](https://github.com/Prompd/prompds) — Open-source prompt packages and templates
- [PrompdHub](https://www.prompdhub.ai/registry) — Browse and install community packages