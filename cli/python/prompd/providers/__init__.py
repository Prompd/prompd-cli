"""LLM provider abstraction layer."""

from .base import BaseProvider, ProviderConfig
from .registry import ProviderRegistry, registry
from .loader import register_default_providers

# Auto-load default providers - removed duplicate call (loader.py already registers)
# register_default_providers() # Commented out to prevent double registration

__all__ = ["BaseProvider", "ProviderConfig", "ProviderRegistry", "registry"]