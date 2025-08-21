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

3. **[Provider Management](PROVIDERS.md)**
   - Built-in providers (OpenAI, Anthropic, Ollama)
   - Custom provider setup
   - OpenAI-compatible APIs
   - Local LLM integration

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
3. **Set Up Providers**: Configure LLM providers with the [Provider Management](PROVIDERS.md) guide
4. **Try Examples**: Explore the [examples](../examples/) directory
5. **Set Up IDE**: Install the [VS Code Extension](../vscode-extension/)

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
- **Built-in Providers**: OpenAI (GPT-3.5, GPT-4), Anthropic (Claude), Ollama (Local models)
- **Custom Providers**: Add any OpenAI-compatible API (Groq, Together AI, LM Studio, etc.)
- **Local Models**: Full support for self-hosted LLMs via Ollama or custom endpoints

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

Or config file (`~/.prompd/config.yaml`):
```yaml
api_keys:
  openai: "sk-..."
  anthropic: "sk-ant-..."
```

### Custom Providers

Add custom LLM providers with OpenAI-compatible APIs:

```bash
# Add local Ollama
prompd provider add local-ollama http://localhost:11434/v1 llama3.2 qwen2.5

# Add Groq
prompd provider add groq https://api.groq.com/openai/v1 \
  llama-3.1-8b-instant --api-key gsk_...

# List all providers
prompd provider list

# Remove provider
prompd provider remove local-ollama
```

### Configuration File

Full config at `~/.prompd/config.yaml`:
```yaml
default_provider: openai
default_model: gpt-4
timeout: 30
max_retries: 3

api_keys:
  openai: "sk-..."
  
custom_providers:
  local-ollama:
    base_url: http://localhost:11434/v1
    models: [llama3.2, qwen2.5]
    type: openai-compatible
    enabled: true
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
- **More Provider Types**: Native support for Google, Cohere, and other APIs

---

*Last updated: 2024*