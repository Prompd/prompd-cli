# Prompd Examples

This directory contains example .prompd files demonstrating various features and use cases.

## 📁 Directory Structure

### `/basic` - Getting Started
- **`example.prompd`** - Simple prompt with basic parameters
- **`test-prompt.prompd`** - Minimal test case
- **`structured-example.prompd`** - Complete structured example
- **`params.json`** - Example parameter file

### `/features` - Format Features
- **`yaml-content.prompd`** - Content defined in YAML frontmatter
- **`yaml-only.prompd`** - Entire prompt in YAML (no markdown)
- **`markdown-features.prompd`** - Full Markdown formatting examples

### `/advanced` - Real-World Use Cases
- **`fetch-ai-literacy-articles.prompd`** - Complex research prompt

## 🚀 Quick Start

### Run a Basic Example

```bash
# Simple greeting
prompd execute basic/example.prompd \
  --provider openai --model gpt-4 \
  -p name="World"

# With parameter file
prompd execute basic/structured-example.prompd \
  --provider openai --model gpt-4 \
  -f basic/params.json
```

### Explore Features

```bash
# YAML-only content
prompd execute features/yaml-only.prompd \
  --provider anthropic --model claude-3-opus \
  -p function_name="calculateTotal" \
  -p code="def calculateTotal(items): return sum(items)"

# Markdown formatting
prompd execute features/markdown-features.prompd \
  --provider openai --model gpt-4 \
  -p language="Python" \
  -p topic="list comprehensions"
```

### Advanced Examples

```bash
# Research prompt
prompd execute advanced/fetch-ai-literacy-articles.prompd \
  --provider openai --model gpt-4 \
  -p search_query="AI safety" \
  -p num_articles="5"
```

## 📋 Example Categories

### Basic Prompts
Perfect for learning the .prompd format:
- Simple parameter usage
- Basic structure
- Parameter files

### Feature Demonstrations
Show specific capabilities:
- YAML vs Markdown content
- Variable substitution
- Formatting options
- Jinja2 templating

### Advanced Use Cases
Real-world applications:
- Research and analysis
- Code review and generation
- Content creation workflows
- Multi-step processes

## 🔧 Testing Examples

Validate all examples:
```bash
# Validate all files
find examples -name "*.prompd" -exec prompd validate {} \;

# Or use our test script
python run_tests.py
```

## 💡 Creating Your Own

Use examples as templates:

1. **Copy an example**: `cp examples/basic/example.prompd my-prompt.prompd`
2. **Modify metadata**: Update name, description, parameters
3. **Edit content**: Customize the prompt text
4. **Validate**: `prompd validate my-prompt.prompd`
5. **Test**: `prompd execute my-prompt.prompd --provider <provider> --model <model>`

## 📚 Learn More

- [Format Specification](../docs/FORMAT.md) - Complete .prompd format
- [CLI Reference](../docs/CLI.md) - All commands and options
- [Main Documentation](../docs/README.md) - Getting started guide