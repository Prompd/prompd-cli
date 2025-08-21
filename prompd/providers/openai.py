"""OpenAI provider implementation."""

import json
from typing import Dict, Any, Optional, List
import httpx
from pydantic import BaseModel

from prompd.providers.base import BaseProvider, ProviderConfig
from prompd.models import LLMRequest, LLMResponse, LLMMessage, MessageRole, ExecutionContext
from prompd.exceptions import ProviderError


class OpenAIProvider(BaseProvider):
    """OpenAI API provider."""
    
    @property
    def name(self) -> str:
        return "openai"
    
    @property
    def supported_models(self) -> List[str]:
        return [
            "gpt-4",
            "gpt-4-turbo",
            "gpt-4o",
            "gpt-3.5-turbo",
            "gpt-4o-mini"
        ]
    
    async def execute(self, request: LLMRequest) -> LLMResponse:
        """Execute request against OpenAI API."""
        api_key = self.get_api_key()
        if not api_key:
            raise ProviderError("OpenAI API key not provided")
        
        base_url = self.config.base_url or "https://api.openai.com/v1"
        url = f"{base_url}/chat/completions"
        
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
        if request.response_format:
            payload["response_format"] = request.response_format
        
        # Add extra parameters
        payload.update(request.extra_params)
        
        # Make API request
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            **self.config.extra_headers
        }
        
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                
                data = response.json()
                
                # Extract response content
                content = data["choices"][0]["message"]["content"]
                
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
            
            raise ProviderError(f"OpenAI API error: {e.response.status_code} - {error_detail}")
        except Exception as e:
            raise ProviderError(f"OpenAI request failed: {e}")
    
    def build_request(self, context: ExecutionContext, content: Dict[str, Optional[str]]) -> LLMRequest:
        """Build OpenAI-specific request."""
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
        
        # Handle response format
        response_format = None
        if content.get("response"):
            # Try to parse as JSON schema
            try:
                response_format = {
                    "type": "json_schema",
                    "json_schema": json.loads(content["response"])
                }
            except json.JSONDecodeError:
                # Not JSON - could be instructions, add to user message
                if messages and messages[-1].role == MessageRole.USER:
                    messages[-1].content += f"\n\nResponse format:\n{content['response']}"
        
        return LLMRequest(
            messages=messages,
            model=context.model,
            response_format=response_format,
            extra_params=context.extra_config
        )