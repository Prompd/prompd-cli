# Prompd Examples

This directory contains example .prmd files demonstrating various features and use cases.

## 📁 Directory Structure

### `/basic` - Getting Started
- **`example.prmd`** - Simple prompt with basic parameters
- **`test-prompt.prmd`** - Minimal test case
- **`structured-example.prmd`** - Complete structured example
- **`params.json`** - Example parameter file

### `/features` - Format Features
- **`yaml-content.prmd`** - Content defined in YAML frontmatter
- **`yaml-only.prmd`** - Entire prompt in YAML (no markdown)
- **`markdown-features.prmd`** - Full Markdown formatting examples

### `/advanced` - Real-World Use Cases
- **`simple-research.prmd`** - Research assistant for topic analysis
- **`research-assistant.prmd`** - Advanced research with comprehensive analysis
- **`test-prompt.prmd`** - Test prompt with multiple parameter types
- **`api-development-test.prmd`** - API development helper

### `/validation` - Test Cases
- **`jinja-blocks-test.prmd`** - Jinja2 template syntax validation
- **`nested-properties-test.prmd`** - Nested parameter validation

### Root Examples
- **`prompd-generator.prmd`** - Meta-prompt that generates custom .prmd templates

## 🚀 Quick Start

### Run a Basic Example

```bash
# Simple greeting
prompd run basic/example.prmd \
  --provider openai --model gpt-4 \
  -p name="World"

# With parameter file
prompd run basic/structured-example.prmd \
  --provider openai --model gpt-4 \
  -f basic/params.json
```

### Explore Features

```bash
# YAML-only content
prompd run features/yaml-only.prmd \
  --provider anthropic --model claude-3-opus \
  -p function_name="calculateTotal" \
  -p code="def calculateTotal(items): return sum(items)"

# Markdown formatting
prompd run features/markdown-features.prmd \
  --provider openai --model gpt-4 \
  -p language="Python" \
  -p topic="list comprehensions"
```

### Advanced Examples

```bash
# Simple research assistant
prompd run advanced/simple-research.prmd \
  --provider openai --model gpt-4 \
  -p topic="artificial intelligence ethics"

# Advanced research with comprehensive analysis
prompd run advanced/research-assistant.prmd \
  --provider openai --model gpt-4 \
  -p search_query="quantum computing" \
  -p research_depth="comprehensive" \
  -p num_sources=10

# Generate a new prompt template
prompd run prompd-generator.prmd \
  --provider openai --model gpt-4 \
  -p category="security audit" \
  -p specific_use_case="HIPAA compliance"
```

## 📋 Example Categories

### Basic Prompts
Perfect for learning the .prmd format:
- Simple parameter usage with Jinja2 templates
- Basic structure (YAML frontmatter + Markdown content)
- Parameter files for complex configurations
- Type-safe parameter definitions (string, integer, float, boolean, array, object)

### Feature Demonstrations
Show specific capabilities:
- YAML vs Markdown content organization
- Variable substitution with `{variable_name}` syntax
- Full Markdown formatting (tables, code blocks, lists)
- Jinja2 templating (`{%- if condition %}`, loops, filters)
- Default values and required parameters

### Advanced Use Cases
Real-world applications:
- Research and analysis workflows
- API development assistance
- Multi-parameter prompt generation
- Content creation with complex logic

### Validation Examples
Test cases for development:
- Jinja2 syntax edge cases
- Nested parameter structures
- Template inheritance validation

## 🔧 Testing Examples

Validate all examples:
```bash
# Validate a single file
prompd validate basic/example.prmd

# Validate all files (Windows PowerShell)
Get-ChildItem -Recurse -Filter "*.prmd" | ForEach-Object { prompd validate $_.FullName }

# Validate all files (Unix/Linux/macOS)
find . -name "*.prmd" -exec prompd validate {} \;

# Compile to markdown
prompd compile basic/example.prmd --to-markdown
```

## 💡 Creating Your Own

Use examples as templates:

1. **Copy an example**: `cp examples/basic/example.prmd my-prompt.prmd`
2. **Modify metadata**: Update name, description, version, parameters
3. **Define parameters**: Add type-safe parameters with validation
4. **Edit content**: Customize the prompt using Jinja2 syntax
5. **Validate**: `prompd validate my-prompt.prmd`
6. **Compile**: `prompd compile my-prompt.prmd --to-markdown`
7. **Test**: `prompd run my-prompt.prmd --provider openai --model gpt-4o -p key=value`

### Quick Create
```bash
# Create a new prompt interactively
prompd create my-new-prompt.prmd --interactive

# Create from template
prompd create my-prompt.prmd --template basic --name "My Prompt"
```

## 📚 Learn More

- [Prompd Documentation](https://github.com/Prompd/prompd-docs/blob/main/README.md) - Complete documentation
- [CLI Reference](https://github.com/Prompd/prompd-docs/blob/main/cli.md) - All commands and options
- [Format Specification](https://github.com/Prompd/prompd-docs/blob/main/FORMAT.md) - Complete .prmd format
- [Main README](https://github.com/Prompd/prompd-cli/blob/main/README.md) - Getting started with Prompd CLI