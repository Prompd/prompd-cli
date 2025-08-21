# Prompd Documentation

Welcome to the Prompd documentation! Prompd is a CLI tool and file format for managing structured AI prompts.

## 📚 Documentation Index

### Core Documentation

1. **[Format Specification](FORMAT.md)**
   - Complete .prompd file format
   - YAML frontmatter structure
   - Markdown content sections
   - Variable substitution
   - Best practices

2. **[CLI Reference](CLI.md)**
   - All commands and options
   - Configuration setup
   - Usage examples
   - Troubleshooting guide

### Quick Links

- [Main README](../README.md) - Project overview and quick start
- [VS Code Extension](../vscode-extension/README.md) - IDE integration
- [Registry Roadmap](../REGISTRY_ROADMAP.md) - Future package registry plans
- [Examples](../examples/) - Sample .prompd files

## 🚀 Quick Start

### 1. Install Prompd

```bash
pip install -e .
```

### 2. Create Your First Prompt

```yaml
---
name: my-assistant
version: 1.0.0
parameters:
  - name: topic
    type: string
    required: true
---

# System
You are a helpful AI assistant.

# User
Please explain {topic} in simple terms.
```

### 3. Execute It

```bash
prompd execute my-assistant.prompd \
  --provider openai \
  --model gpt-4 \
  -p topic="quantum computing"
```

## 📖 Learning Path

1. **Start Here**: Read the [Format Specification](FORMAT.md) to understand .prompd files
2. **Learn Commands**: Review the [CLI Reference](CLI.md) for all available commands
3. **Try Examples**: Explore the [examples](../examples/) directory
4. **Set Up IDE**: Install the [VS Code Extension](../vscode-extension/)

## 🔑 Key Concepts

### File Structure
- **YAML Frontmatter**: Metadata and parameters
- **Markdown Content**: Prompt sections with full formatting
- **Variable Substitution**: Dynamic content with `{variables}`

### Execution Flow
1. Parse .prompd file
2. Validate structure and parameters
3. Substitute variables
4. Send to LLM provider
5. Return response

### Provider Abstraction
Write once, run anywhere:
- OpenAI (GPT-3.5, GPT-4)
- Anthropic (Claude)
- Ollama (Local models)
- More coming soon!

## 💡 Best Practices

### File Organization
```
project/
├── prompts/
│   ├── development/
│   │   ├── code-reviewer.prompd
│   │   └── bug-finder.prompd
│   ├── writing/
│   │   ├── blog-writer.prompd
│   │   └── editor.prompd
│   └── shared/
│       └── parameters.json
```

### Version Management
- Use semantic versioning (1.0.0)
- Commit .prompd files to git
- Tag releases with `prompd version bump`
- Track changes with `prompd version history`

### Parameter Design
- Provide sensible defaults
- Use validation for critical inputs
- Document parameters clearly
- Group related parameters

## 🛠️ Configuration

### API Keys

Set via environment:
```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or config file (`~/.prompd/config.json`):
```json
{
  "providers": {
    "openai": {
      "api_key": "sk-..."
    }
  }
}
```

## 🤝 Getting Help

- **Documentation**: You're here!
- **Examples**: Check `/examples` directory
- **Issues**: [GitHub Issues](https://github.com/Logikbug/prompt-markdown/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Logikbug/prompt-markdown/discussions)

## 🚧 Coming Soon

- **Package Registry**: npm-like registry for sharing prompts
- **Web UI**: Browser-based prompt management
- **Team Features**: Collaboration and sharing
- **More Providers**: Google, Cohere, local models

---

*Last updated: 2024*