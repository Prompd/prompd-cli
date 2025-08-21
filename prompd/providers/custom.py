"""Custom provider implementation for OpenAI-compatible endpoints."""

import json
from typing import Dict, Any, Optional, List
import httpx
from pydantic import BaseModel

from prompd.providers.base import BaseProvider, ProviderConfig
from prompd.models import LLMRequest, LLMResponse, LLMMessage, MessageRole, ExecutionContext
from prompd.exceptions import ProviderError


class CustomProvider(BaseProvider):
    """Custom OpenAI-compatible provider."""
    
    def __init__(self, config: ProviderConfig, name: str, models: List[str], base_url: str):
        super().__init__(config)
        self._name = name
        self._models = models
        self._base_url = base_url
    
    @property
    def name(self) -> str:
        return self._name
    
    @property
    def supported_models(self) -> List[str]:
        return self._models
    
    async def execute(self, request: LLMRequest) -> LLMResponse:
        """Execute request against custom API endpoint."""
        api_key = self.get_api_key()
        
        url = f"{self._base_url.rstrip('/')}/chat/completions"
        
        # Build request payload
        payload = {
            "model": request.model or self.get_default_model(),
            "messages": [
                {"role": msg.role.value, "content": msg.content}
                for msg in request.messages
            ]
        }
        
        # Add optional parameters
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.max_tokens is not None:
            payload["max_tokens"] = request.max_tokens
        
        headers = {
            "Content-Type": "application/json"
        }
        
        # Add auth header if API key is provided
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
                
                # Parse response
                if "choices" not in data or not data["choices"]:
                    raise ProviderError("No response from custom provider")
                
                choice = data["choices"][0]
                content = choice["message"]["content"]
                
                # Extract usage info if available
                usage_info = None
                if "usage" in data:
                    usage = data["usage"]
                    usage_info = f"Tokens: {usage.get('total_tokens', 'unknown')}"
                
                return LLMResponse(
                    content=content,
                    usage=usage_info,
                    model=request.model,
                    provider=self.name
                )
                
        except httpx.HTTPStatusError as e:
            error_content = ""
            try:
                error_data = e.response.json()
                error_content = error_data.get("error", {}).get("message", "Unknown error")
            except:
                error_content = str(e)
            raise ProviderError(f"Custom provider API error: {error_content}")
        except httpx.RequestError as e:
            raise ProviderError(f"Request to custom provider failed: {e}")
        except json.JSONDecodeError as e:
            raise ProviderError(f"Invalid JSON response from custom provider: {e}")
        except Exception as e:
            raise ProviderError(f"Unexpected error with custom provider: {e}")
    
    def get_default_model(self) -> str:
        """Get default model for this provider."""
        return self._models[0] if self._models else "default"
    
    def validate_model(self, model: str) -> bool:
        """Validate if model is supported."""
        return model in self._models
    
    def build_request(self, context: ExecutionContext, content: Dict[str, Optional[str]]) -> LLMRequest:
        """Build OpenAI-compatible request."""
        messages = []
        
        # Add system message if present
        if content.get("system"):
            messages.append(LLMMessage(
                role=MessageRole.SYSTEM,
                content=content["system"]
            ))
        
        # Build user message (combine context and user if both present)
        user_content_parts = []
        
        if content.get("context"):
            user_content_parts.append(content["context"])
        
        if content.get("user"):
            user_content_parts.append(content["user"])
        
        if user_content_parts:
            user_content = "\n\n".join(user_content_parts)
            messages.append(LLMMessage(
                role=MessageRole.USER,
                content=user_content
            ))
        
        return LLMRequest(
            messages=messages,
            model=context.model,
            temperature=context.extra_config.get("temperature"),
            max_tokens=context.extra_config.get("max_tokens")
        )