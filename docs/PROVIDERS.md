# Provider Management Guide

Prompd supports both built-in providers and custom providers, making it easy to work with any LLM service.

## Built-in Providers

Prompd comes with built-in support for major LLM providers:

### OpenAI
- **Models**: gpt-4, gpt-4-turbo, gpt-4o, gpt-3.5-turbo, gpt-4o-mini
- **Setup**: Set `OPENAI_API_KEY` environment variable
- **Example**: `prompd execute prompt.prompd --provider openai --model gpt-4`

### Anthropic
- **Models**: claude-3-5-sonnet-20241022, claude-3-opus-20240229, claude-3-sonnet-20240229, claude-3-haiku-20240307
- **Setup**: Set `ANTHROPIC_API_KEY` environment variable  
- **Example**: `prompd execute prompt.prompd --provider anthropic --model claude-3-opus-20240229`

### Ollama
- **Models**: llama2, llama2:13b, codellama, mistral, etc.
- **Setup**: Install and run Ollama locally
- **Example**: `prompd execute prompt.prompd --provider ollama --model llama2`

## Custom Providers

Add any OpenAI-compatible API as a custom provider for maximum flexibility.

### Adding a Custom Provider

```bash
prompd provider add <name> <base_url> <models...> [options]
```

**Arguments:**
- `name` - Unique provider name (alphanumeric, hyphens, underscores)
- `base_url` - API endpoint URL (must support `/chat/completions`)
- `models` - Space-separated list of model names

**Options:**
- `--api-key KEY` - API key for the provider (optional)
- `--type TYPE` - Provider type (currently only `openai-compatible`)

### Examples

#### Local Development with Ollama
```bash
# Add local Ollama instance
prompd provider add local-ollama http://localhost:11434/v1 \
  llama3.2 qwen2.5 mixtral phi3

# Use it
prompd execute prompt.prompd --provider local-ollama --model llama3.2
```

#### Groq Cloud API
```bash
# Add Groq with API key
prompd provider add groq https://api.groq.com/openai/v1 \
  llama-3.1-8b-instant mixtral-8x7b-32768 \
  --api-key gsk_your_api_key_here

# Use it  
prompd execute prompt.prompd --provider groq --model llama-3.1-8b-instant
```

#### LM Studio (Local)
```bash
# Add LM Studio local server
prompd provider add lmstudio http://localhost:1234/v1 \
  local-model

# Use it
prompd execute prompt.prompd --provider lmstudio --model local-model
```

#### Together AI
```bash
# Add Together AI
prompd provider add together https://api.together.xyz/v1 \
  mistralai/Mixtral-8x7B-Instruct-v0.1 \
  meta-llama/Llama-2-70b-chat-hf \
  --api-key your_together_api_key

# Use it
prompd execute prompt.prompd --provider together --model mistralai/Mixtral-8x7B-Instruct-v0.1
```

### Managing Custom Providers

#### List All Providers
```bash
prompd provider list
```

Shows all built-in and custom providers with their models.

#### Show Provider Details
```bash
prompd provider show <name>
```

Displays detailed information about a specific provider:
- Type (Built-in/Custom)
- Base URL (for custom providers)
- API key status
- Available models
- Configuration

#### Remove Custom Providers
```bash
# With confirmation
prompd provider remove <name>

# Without confirmation  
prompd provider remove <name> --yes
```

## OpenAI-Compatible APIs

Many LLM providers support the OpenAI Chat Completions API format. Here are popular options:

| Provider | Base URL | Notes |
|----------|----------|-------|
| **Ollama** | `http://localhost:11434/v1` | Local models, free |
| **LM Studio** | `http://localhost:1234/v1` | Local models, GUI |
| **Groq** | `https://api.groq.com/openai/v1` | Fast inference, requires API key |
| **Together AI** | `https://api.together.xyz/v1` | Many open models, requires API key |
| **Fireworks AI** | `https://api.fireworks.ai/inference/v1` | Fast inference, requires API key |
| **Perplexity** | `https://api.perplexity.ai` | Search-augmented LLMs |
| **OpenRouter** | `https://openrouter.ai/api/v1` | Access to many models via one API |
| **Anyscale** | `https://api.endpoints.anyscale.com/v1` | Open source models |

### Testing Compatibility

Most providers that claim OpenAI compatibility should work. Test with:

```bash
# Add the provider
prompd provider add test-provider https://api.example.com/v1 test-model --api-key your-key

# Test with a simple prompt
prompd execute examples/basic/test-prompt.prompd \
  --provider test-provider \
  --model test-model \
  --param topic="hello world"

# Remove if it doesn't work
prompd provider remove test-provider --yes
```

## Configuration

### Config File Location

Custom providers are stored in `~/.prompd/config.yaml`:

```yaml
api_keys:
  openai: "sk-..."
  groq: "gsk-..."

custom_providers:
  local-ollama:
    base_url: http://localhost:11434/v1
    models:
      - llama3.2
      - qwen2.5
    api_key: null
    type: openai-compatible
    enabled: true
  
  groq:
    base_url: https://api.groq.com/openai/v1
    models:
      - llama-3.1-8b-instant
      - mixtral-8x7b-32768
    api_key: "gsk-..."
    type: openai-compatible
    enabled: true
```

### Environment Variables

API keys can also be set via environment variables:

```bash
# Built-in providers
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."

# Custom providers (provider name in uppercase)
export LOCAL_OLLAMA_API_KEY="optional-key"
export GROQ_API_KEY="gsk-..."
```

### Provider Priority

When resolving API keys, Prompd checks in this order:
1. `--api-key` command line option
2. Provider-specific API key in config file
3. Environment variable (e.g., `PROVIDER_NAME_API_KEY`)
4. Built-in environment variables (for built-in providers)

## Troubleshooting

### Connection Issues

If you get connection errors:

1. **Check the URL**: Ensure the base URL is correct and accessible
2. **Verify the endpoint**: Most APIs expect `/chat/completions` to be appended
3. **Test manually**: Try a curl request to verify the API works

```bash
curl -X POST https://your-api-url/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "your-model",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### API Key Issues

- Ensure API keys are correctly set in config or environment
- Check that the API key has the right permissions
- Verify the API key format matches the provider's expectations

### Model Not Found

- Check that the model name exactly matches what the provider expects
- Some providers use different model names than advertised
- Use `prompd provider show <name>` to see registered models

### Compatibility Issues

If a provider claims OpenAI compatibility but doesn't work:

1. Check their API documentation for differences
2. Look for non-standard request/response formats
3. File an issue with details about the provider and error

## Best Practices

### Security

- Store API keys in environment variables for production
- Use config files for development/testing only
- Never commit API keys to version control
- Use separate API keys for different environments

### Organization

- Use descriptive provider names (e.g., `local-ollama`, `groq-fast`)
- Document your custom providers in team documentation
- Keep model lists up to date as providers add new models

### Performance

- Use local providers (Ollama, LM Studio) for development/testing
- Use cloud providers for production workloads
- Consider provider-specific optimizations (e.g., Groq for speed)

## Migration

### From Other Tools

If migrating from other tools:

- **LangChain**: Map provider configurations to Prompd custom providers
- **OpenAI CLI**: Replace direct API calls with `prompd execute`
- **Custom scripts**: Convert to .prompd files with provider abstraction

### Updating Providers

To update a custom provider:

1. Remove the old provider: `prompd provider remove old-name`
2. Add the updated provider: `prompd provider add new-name ...`
3. Update any scripts/workflows to use the new name

Or manually edit `~/.prompd/config.yaml` and restart Prompd.

---

*Need help? Check the [CLI Reference](CLI.md) or [open an issue](https://github.com/Logikbug/prompt-markdown/issues).*