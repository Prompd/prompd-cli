# Prompd - Structured Prompt Definitions for LLMs

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)

Prompd is a CLI tool and file format for managing structured AI prompts. Write once, run anywhere - execute the same prompt across OpenAI, Anthropic, Ollama, local models, or any OpenAI-compatible API.

## Installation

### Install from PyPI (Recommended)

```bash
# Install the latest release
pip install prompd
```

### Install from Source

If you have access to the source repository:

```bash
# Clone and install in development mode
git clone https://github.com/Logikbug/prompt-markdown.git
cd prompt-markdown
pip install -e .

# Or install with development dependencies
pip install -e ".[dev]"
```

### Requirements
- Python 3.8+
- Git (required for version management features)

## Quick Start

### 1. Create a Prompd file

Create a file `example.prompd`:

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
prompd execute example.prompd --provider openai --model gpt-4 -p name=Alice -p style=formal

# Execute with Anthropic
prompd execute example.prompd --provider anthropic --model claude-3-opus -p name=Bob

# Add custom provider (Ollama, Groq, LM Studio, etc.)
prompd provider add local-ollama http://localhost:11434/v1 llama3.2 qwen2.5

# Execute with custom provider
prompd execute example.prompd --provider local-ollama --model llama3.2 -p name=Charlie

# Validate the file
prompd validate example.prompd

# Bump version
prompd version bump example.prompd minor
```

## Core Commands

### `prompd execute`
Execute a prompt with an LLM provider.

```bash
prompd execute <file> --provider <provider> --model <model> [options]

Options:
  --provider        LLM provider (openai, anthropic, ollama, or custom)
  --model          Model name (gpt-4, claude-3, llama3.2, etc.)
  -p, --param      Set parameter (key=value)
  -f, --param-file Load parameters from JSON
  --version        Execute specific version (1.2.3, HEAD, commit hash)
  --api-key        Override API key
  -o, --output     Save response to file
```

### `prompd validate`
Validate syntax and structure.

```bash
prompd validate <file> [options]

Options:
  -v, --verbose    Show detailed validation
  --git           Check git consistency
  --version-only  Only validate version
```

### `prompd git`
Git operations for .prompd files.

```bash
prompd git add <files...>                        # Add to staging
prompd git remove <files...> [--cached]         # Remove from tracking
prompd git status                               # Show git status
prompd git commit -m "message" [--all]          # Commit changes
prompd git checkout <file> <version> [-o FILE]  # Checkout specific version
```

### `prompd version`
Manage semantic versions with git integration.

```bash
prompd version bump <file> <major|minor|patch>  # Bump version
prompd version history <file>                    # Show history
prompd version diff <file> <v1> [v2]            # Compare versions
prompd version suggest <file>                    # Get bump suggestions
```

### `prompd provider`
Manage LLM providers including custom ones.

```bash
prompd provider list                             # List all providers
prompd provider add <name> <url> <models...>    # Add custom provider
prompd provider show <name>                      # Show provider details
prompd provider remove <name>                    # Remove custom provider

# Examples
prompd provider add groq https://api.groq.com/openai/v1 llama-3.1-8b --api-key gsk_...
prompd provider add local-ollama http://localhost:11434/v1 llama3.2 qwen2.5
```

### Other Commands

```bash
prompd list [--path DIR]        # List .prompd files
prompd show <file>              # Display file structure
```

## Prompd File Format

A `.prompd` file combines YAML frontmatter with Markdown content:

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
prompd execute prompt.prompd --provider openai --model gpt-4 --version 1.2.3

# Execute last committed version
prompd execute prompt.prompd --provider openai --model gpt-4 --version HEAD

# Checkout version to working directory
prompd git checkout prompt.prompd 1.2.3

# Checkout to different file (preserve current)
prompd git checkout prompt.prompd 1.2.3 -o prompt-v1.2.3.prompd
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

Full documentation and examples are available in the GitHub repository:

- [**GitHub Repository**](https://github.com/Logikbug/prompt-markdown) - Source code and full documentation
- [**Format Specification**](https://github.com/Logikbug/prompt-markdown/blob/main/docs/FORMAT.md) - Complete .prompd file format
- [**CLI Reference**](https://github.com/Logikbug/prompt-markdown/blob/main/docs/CLI.md) - All commands and options
- [**Examples**](https://github.com/Logikbug/prompt-markdown/tree/main/examples) - Sample .prompd files
- [**VS Code Extension**](https://github.com/Logikbug/prompt-markdown/tree/main/vscode-extension) - IDE integration

> **Note**: If the repository is private, please request access or refer to the documentation included with your installation.

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

- **Phase 1** ✅: Core CLI and file format
- **Phase 2** 🚧: [Package Registry](REGISTRY_ROADMAP.md) (npm for prompts)
- **Phase 3** 📋: Web UI and collaboration features

## License

MIT License - see [LICENSE](LICENSE) file.

## Author

Created by [Logikbug](https://github.com/Logikbug)