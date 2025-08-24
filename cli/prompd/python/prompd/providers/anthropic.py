"""Anthropic Claude provider implementation."""

import json
from typing import Dict, Any, Optional, List
import httpx

from prompd.providers.base import BaseProvider, ProviderConfig
from prompd.models import LLMRequest, LLMResponse, LLMMessage, MessageRole, ExecutionContext
from prompd.exceptions import ProviderError


class AnthropicProvider(BaseProvider):
    """Anthropic Claude API provider."""
    
    @property
    def name(self) -> str:
        return "anthropic"
    
    @property
    def supported_models(self) -> List[str]:
        return [
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022", 
            "claude-3-opus-20240229",
            "claude-3-sonnet-20240229",
            "claude-3-haiku-20240307"
        ]
    
    async def execute(self, request: LLMRequest) -> LLMResponse:
        """Execute request against Anthropic API."""
        api_key = self.get_api_key()
        if not api_key:
            raise ProviderError("Anthropic API key not provided")
        
        base_url = self.config.base_url or "https://api.anthropic.com/v1"
        url = f"{base_url}/messages"
        
        # Separate system messages from user/assistant messages
        system_content = ""
        messages = []
        
        for msg in request.messages:
            if msg.role == MessageRole.SYSTEM:
                system_content += msg.content + "\n"
            else:
                messages.append({
                    "role": msg.role.value,
                    "content": msg.content
                })
        
        # Build request payload
        payload = {
            "model": request.model or self.get_default_model(),
            "max_tokens": request.max_tokens or 1024,
            "messages": messages
        }
        
        # Add system message if present
        if system_content.strip():
            payload["system"] = system_content.strip()
        
        # Add optional parameters
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        
        # Add extra parameters
        payload.update(request.extra_params)
        
        # Make API request
        headers = {
            "x-api-key": api_key,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            **self.config.extra_headers
        }
        
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                
                data = response.json()
                
                # Extract response content
                content = data["content"][0]["text"]
                
                return LLMResponse(
                    content=content,
                    model=data.get("model"),
                    usage=data.get("usage"),
                    metadata={"raw_response": data}
                )
                
        except httpx.HTTPStatusError as e:
            error_detail = ""
            try:
                error_data = e.response.json()
                error_detail = error_data.get("error", {}).get("message", "")
            except:
                error_detail = e.response.text
            
            raise ProviderError(f"Anthropic API error: {e.response.status_code} - {error_detail}")
        except Exception as e:
            raise ProviderError(f"Anthropic request failed: {e}")
    
    def build_request(self, context: ExecutionContext, content: Dict[str, Optional[str]]) -> LLMRequest:
        """Build Anthropic-specific request."""
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
            max_tokens=context.extra_config.get("max_tokens", 1024),
            temperature=context.extra_config.get("temperature"),
            extra_params={k: v for k, v in context.extra_config.items() 
                         if k not in ["max_tokens", "temperature"]}
        )