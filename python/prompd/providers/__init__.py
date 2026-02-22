"""LLM provider abstraction layer."""

from .base import BaseProvider, ProviderConfig
from .loader import register_default_providers
from .registry import ProviderRegistry, registry

# Auto-load default providers - removed duplicate call (loader.py already registers)
# register_default_providers() # Commented out to prevent double registration

__all__ = ["BaseProvider", "ProviderConfig", "ProviderRegistry", "registry", "register_default_providers"]
