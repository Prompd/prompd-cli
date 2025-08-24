# Prompd Python CLI

This is the Python implementation of the Prompd CLI with rich features and LLM provider integrations.

## Features

- Full LLM provider support (OpenAI, Anthropic, Ollama, etc.)
- Rich terminal output with colors and formatting
- Advanced validation and error reporting
- Git integration for version control
- Template engine with Jinja2
- Configuration management

## Installation

```bash
cd cli/prompd/python
pip install -e .
```

## Usage

```bash
# Validate a .prompd file
prompd validate example.prompd

# List available files
prompd list prompts/

# Show file structure
prompd show example.prompd

# Execute with LLM
prompd execute example.prompd --provider openai --model gpt-4 -p name=Alice

# Provider management
prompd provider list
prompd provider add custom-llm http://localhost:8080/v1 model1 model2

# Git operations
prompd git status
prompd git commit -m "Update prompts"

# Version management
prompd version bump example.prompd minor
prompd version history example.prompd
```

## Dependencies

See `pyproject.toml` for full dependency list. Requires Python 3.8+.