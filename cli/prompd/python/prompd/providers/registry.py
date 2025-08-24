"""Provider registry for managing LLM providers."""

from typing import Dict, Type, List, Optional
from prompd.providers.base import BaseProvider
from prompd.exceptions import ProviderError


class ProviderRegistry:
    """Registry for managing LLM providers."""
    
    def __init__(self):
        self._providers: Dict[str, Type[BaseProvider]] = {}
    
    def register(self, provider_class: Type[BaseProvider]) -> None:
        """
        Register a provider class.
        
        Args:
            provider_class: Provider class to register
        """
        # Get provider name from class using a temporary config
        from prompd.providers.base import ProviderConfig
        temp_instance = provider_class(config=ProviderConfig())
        provider_name = temp_instance.name
        self._providers[provider_name] = provider_class
    
    def get_provider_class(self, name: str) -> Type[BaseProvider]:
        """
        Get provider class by name.
        
        Args:
            name: Provider name
            
        Returns:
            Provider class
            
        Raises:
            ProviderError: If provider not found
        """
        if name not in self._providers:
            raise ProviderError(f"Provider '{name}' not found. Available: {list(self._providers.keys())}")
        return self._providers[name]
    
    def get_available_providers(self) -> List[str]:
        """Get list of available provider names."""
        return list(self._providers.keys())
    
    def is_registered(self, name: str) -> bool:
        """Check if provider is registered."""
        return name in self._providers


# Global registry instance
registry = ProviderRegistry()