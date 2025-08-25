"""Base provider interface for LLM APIs."""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
from pydantic import BaseModel

from prompd.models import LLMRequest, LLMResponse, ExecutionContext


class ProviderConfig(BaseModel):
    """Configuration for an LLM provider."""
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    timeout: int = 30
    max_retries: int = 3
    extra_headers: Dict[str, str] = {}
    extra_params: Dict[str, Any] = {}


class BaseProvider(ABC):
    """Abstract base class for LLM providers."""
    
    def __init__(self, config: ProviderConfig):
        self.config = config
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name (e.g., 'openai', 'anthropic')."""
        pass
    
    @property
    @abstractmethod
    def supported_models(self) -> List[str]:
        """List of supported model names."""
        pass
    
    @abstractmethod
    async def execute(self, request: LLMRequest) -> LLMResponse:
        """
        Execute LLM request and return response.
        
        Args:
            request: LLM request with messages and parameters
            
        Returns:
            LLM response with content and metadata
            
        Raises:
            ProviderError: If request fails
        """
        pass
    
    @abstractmethod
    def build_request(self, context: ExecutionContext, content: Dict[str, Optional[str]]) -> LLMRequest:
        """
        Build provider-specific request from execution context.
        
        Args:
            context: Execution context with prompd and parameters
            content: Resolved content (system, context, user, response)
            
        Returns:
            Provider-specific LLM request
        """
        pass
    
    def validate_model(self, model: str) -> bool:
        """
        Validate if model is supported by this provider.
        
        Args:
            model: Model name to validate
            
        Returns:
            True if model is supported
        """
        return model in self.supported_models
    
    def get_api_key(self) -> Optional[str]:
        """Get API key from config or environment."""
        return self.config.api_key
    
    def get_default_model(self) -> Optional[str]:
        """Get default model for this provider."""
        return self.supported_models[0] if self.supported_models else None