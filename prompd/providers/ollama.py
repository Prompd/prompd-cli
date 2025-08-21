"""Ollama local LLM provider implementation."""

import json
from typing import Dict, Any, Optional, List
import httpx

from prompd.providers.base import BaseProvider, ProviderConfig
from prompd.models import LLMRequest, LLMResponse, LLMMessage, MessageRole, ExecutionContext
from prompd.exceptions import ProviderError


class OllamaProvider(BaseProvider):
    """Ollama local LLM provider."""
    
    @property
    def name(self) -> str:
        return "ollama"
    
    @property
    def supported_models(self) -> List[str]:
        # Ollama models are dynamic, so we provide common ones
        return [
            "llama2",
            "llama2:13b",
            "llama2:70b",
            "codellama",
            "mistral",
            "mixtral",
            "phi",
            "gemma"
        ]
    
    async def execute(self, request: LLMRequest) -> LLMResponse:
        """Execute request against Ollama API."""
        base_url = self.config.base_url or "http://localhost:11434"
        url = f"{base_url}/api/chat"
        
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
        
        # Ollama uses "stream": false for non-streaming
        payload["stream"] = False
        
        # Add extra parameters to options
        if request.extra_params:
            payload["options"] = request.extra_params
        
        # Make API request
        headers = {
            "Content-Type": "application/json",
            **self.config.extra_headers
        }
        
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                
                data = response.json()
                
                # Extract response content
                content = data["message"]["content"]
                
                return LLMResponse(
                    content=content,
                    model=data.get("model"),
                    usage={
                        "eval_count": data.get("eval_count", 0),
                        "eval_duration": data.get("eval_duration", 0),
                        "total_duration": data.get("total_duration", 0)
                    },
                    metadata={"raw_response": data}
                )
                
        except httpx.HTTPStatusError as e:
            error_detail = ""
            try:
                error_data = e.response.json()
                error_detail = error_data.get("error", "")
            except:
                error_detail = e.response.text
            
            raise ProviderError(f"Ollama API error: {e.response.status_code} - {error_detail}")
        except httpx.ConnectError:
            raise ProviderError(
                "Failed to connect to Ollama. Is Ollama running? "
                "Visit https://ollama.ai for installation instructions."
            )
        except Exception as e:
            raise ProviderError(f"Ollama request failed: {e}")
    
    def build_request(self, context: ExecutionContext, content: Dict[str, Optional[str]]) -> LLMRequest:
        """Build Ollama-specific request."""
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
        
        # Add response format instructions to user message if present
        if content.get("response"):
            user_content_parts.append(f"Response format:\n{content['response']}")
        
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
            extra_params={k: v for k, v in context.extra_config.items() 
                         if k != "temperature"}
        )
    
    def validate_model(self, model: str) -> bool:
        """Ollama allows any model name, so we're more permissive."""
        return True  # Ollama can pull models dynamically
    
    def get_default_model(self) -> str:
        """Get default Ollama model."""
        return "llama2"