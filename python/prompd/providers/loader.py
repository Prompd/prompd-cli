"""Provider loader for auto-registration."""

from prompd.providers.anthropic import AnthropicProvider
from prompd.providers.ollama import OllamaProvider
from prompd.providers.openai import OpenAIProvider
from prompd.providers.registry import registry


def register_default_providers():
    """Register all default providers."""
    registry.register(OpenAIProvider)
    registry.register(AnthropicProvider)
    registry.register(OllamaProvider)


# Auto-register on import
register_default_providers()
