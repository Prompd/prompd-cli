# Prompd - Structured Prompt Definitions for LLMs

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)

Prompd is a CLI tool and file format for managing structured AI prompts. Write once, run anywhere - execute the same prompt across OpenAI, Anthropic, Ollama, or any LLM provider.

## Installation

```bash
# Install from source
git clone https://github.com/Logikbug/prompt-markdown.git
cd prompt-markdown
pip install -e .

# Or install with development dependencies
pip install -e ".[dev]"
```

### Requirements
- Python 3.8+
- Git (for version management features)

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
  --provider        LLM provider (openai, anthropic, ollama)
  --model          Model name (gpt-4, claude-3, etc.)
  -p, --param      Set parameter (key=value)
  -f, --param-file Load parameters from JSON
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

### `prompd version`
Manage semantic versions with git integration.

```bash
prompd version bump <file> <major|minor|patch>  # Bump version
prompd version history <file>                    # Show history
prompd version diff <file> <v1> [v2]            # Compare versions
prompd version suggest <file>                    # Get bump suggestions
```

### Other Commands

```bash
prompd list [--path DIR]        # List .prompd files
prompd show <file>              # Display file structure
prompd providers                # List available providers
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

- [**Format Specification**](docs/FORMAT.md) - Complete .prompd file format
- [**CLI Reference**](docs/CLI.md) - All commands and options
- [**Parameter System**](docs/PARAMETERS.md) - Variables and substitution
- [**VS Code Extension**](vscode-extension/README.md) - IDE integration
- [**Examples**](examples/README.md) - Sample .prompd files
- [**Registry Roadmap**](docs/roadmap/REGISTRY_ROADMAP.md) - Future package registry

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