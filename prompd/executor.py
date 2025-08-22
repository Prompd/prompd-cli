"""Execution engine for prompd files."""

import asyncio
from pathlib import Path
from typing import Dict, Any, Optional, List

from jinja2 import Environment, Template, TemplateSyntaxError

from prompd.models import ExecutionContext, PrompdFile, LLMRequest, LLMResponse
from prompd.parser import PrompdParser
from prompd.config import PrompDConfig, ParameterManager
from prompd.providers import registry, ProviderConfig
from prompd.providers.custom import CustomProvider
from prompd.exceptions import PrompDError, ProviderError, ConfigurationError, SubstitutionError


class PrompDExecutor:
    """Main execution engine for prompd files."""
    
    def __init__(self, config: Optional[PrompDConfig] = None):
        self.config = config or PrompDConfig.load()
        self.parser = PrompdParser()
        self.param_manager = ParameterManager(self.config)
        
        # Load custom providers
        self._load_custom_providers()
        
        # Jinja2 environment for variable substitution
        self.jinja_env = Environment(
            variable_start_string='{',
            variable_end_string='}',
            block_start_string='{%',
            block_end_string='%}',
            comment_start_string='{#',
            comment_end_string='#}',
        )
        
    def _load_custom_providers(self):
        """Load custom providers from config into the registry."""
        for provider_name, provider_config in self.config.custom_providers.items():
            if not provider_config.get('enabled', True):
                continue
                
            # Create a custom provider class for this specific provider
            class DynamicCustomProvider(CustomProvider):
                def __init__(self, config: ProviderConfig):
                    super().__init__(
                        config=config,
                        name=provider_name,
                        models=provider_config['models'],
                        base_url=provider_config['base_url']
                    )
            
            # Register the custom provider if not already registered
            if not registry.is_registered(provider_name):
                registry.register(DynamicCustomProvider)
    
    async def execute(
        self,
        prompd_file: Path,
        provider: str,
        model: str,
        cli_params: Optional[List[str]] = None,
        param_files: Optional[List[Path]] = None,
        api_key: Optional[str] = None,
        extra_config: Optional[Dict[str, Any]] = None
    ) -> LLMResponse:
        """
        Execute a prompd file with given parameters.
        
        Args:
            prompd_file: Path to .prompd file
            provider: LLM provider name
            model: Model name
            cli_params: CLI parameters as list of "key=value" strings
            param_files: List of parameter files to load
            api_key: Override API key
            extra_config: Additional configuration
            
        Returns:
            LLM response
            
        Raises:
            PrompDError: If execution fails
        """
        try:
            # Parse prompd file
            prompd = self.parser.parse_file(prompd_file)
            
            # Resolve parameters
            resolved_params = await self._resolve_parameters(
                prompd, cli_params, param_files
            )
            
            # Validate required parameters
            self.param_manager.validate_required_parameters(
                resolved_params, 
                [param.dict() for param in prompd.metadata.parameters]
            )
            
            # Get structured content with references resolved
            content = self.parser.get_structured_content(prompd, resolved_params)
            
            # Perform variable substitution
            substituted_content = await self._substitute_variables(content, resolved_params)
            
            # Create execution context
            context = ExecutionContext(
                prompd=prompd,
                parameters=resolved_params,
                provider=provider,
                model=model,
                api_key=api_key or self.config.get_api_key(provider),
                extra_config=extra_config or {}
            )
            
            # Execute with provider
            return await self._execute_with_provider(context, substituted_content)
            
        except Exception as e:
            if isinstance(e, PrompDError):
                raise
            else:
                raise PrompDError(f"Execution failed: {e}")
    
    async def _resolve_parameters(
        self,
        prompd: PrompdFile,
        cli_params: Optional[List[str]],
        param_files: Optional[List[Path]]
    ) -> Dict[str, Any]:
        """Resolve parameters from all sources."""
        
        # Get defaults from prompd file
        prompd_defaults = {}
        for param_def in prompd.metadata.parameters:
            if param_def.default is not None:
                prompd_defaults[param_def.name] = param_def.default
        
        # Parse CLI parameters
        parsed_cli_params = None
        if cli_params:
            parsed_cli_params = self.param_manager.parse_cli_parameters(cli_params)
        
        # Resolve with precedence
        resolved = self.param_manager.resolve_parameters(
            cli_params=parsed_cli_params,
            param_files=param_files,
            prompd_defaults=prompd_defaults
        )
        
        # Type conversion based on parameter definitions
        typed_params = {}
        param_defs = {p.name: p for p in prompd.metadata.parameters}
        
        for name, value in resolved.items():
            if name in param_defs:
                typed_params[name] = self._convert_parameter_type(
                    value, param_defs[name]
                )
            else:
                typed_params[name] = value
        
        return typed_params
    
    def _convert_parameter_type(self, value: Any, param_def) -> Any:
        """Convert parameter value to correct type."""
        from prompd.models import ParameterType
        
        if param_def.type == ParameterType.INTEGER:
            return int(value)
        elif param_def.type == ParameterType.FLOAT:
            return float(value)
        elif param_def.type == ParameterType.BOOLEAN:
            if isinstance(value, bool):
                return value
            return str(value).lower() in ['true', 'yes', '1', 'on']
        elif param_def.type == ParameterType.ARRAY:
            if isinstance(value, list):
                return value
            elif isinstance(value, str):
                return [v.strip() for v in value.split(',')]
            return [value]
        elif param_def.type == ParameterType.OBJECT:
            if isinstance(value, dict):
                return value
            elif isinstance(value, str):
                try:
                    import json
                    return json.loads(value)
                except json.JSONDecodeError:
                    return value
            return value
        else:  # string or unknown
            return str(value)
    
    async def _substitute_variables(
        self, 
        content: Dict[str, Optional[str]], 
        parameters: Dict[str, Any]
    ) -> Dict[str, Optional[str]]:
        """Substitute variables in content."""
        
        substituted = {}
        
        for content_type, text in content.items():
            if text is None:
                substituted[content_type] = None
            else:
                try:
                    template = self.jinja_env.from_string(text)
                    substituted[content_type] = template.render(parameters)
                except TemplateSyntaxError as e:
                    raise SubstitutionError(
                        f"Template syntax error in {content_type} section: {e}"
                    )
                except Exception as e:
                    raise SubstitutionError(
                        f"Variable substitution failed in {content_type} section: {e}"
                    )
        
        return substituted
    
    async def _execute_with_provider(
        self, 
        context: ExecutionContext, 
        content: Dict[str, Optional[str]]
    ) -> LLMResponse:
        """Execute request with LLM provider."""
        
        # Get provider class
        try:
            provider_class = registry.get_provider_class(context.provider)
        except Exception as e:
            raise ProviderError(f"Provider '{context.provider}' not available: {e}")
        
        # Create provider config
        # For custom providers, check if there's a custom API key in the config
        api_key = context.api_key
        if not api_key and context.provider in self.config.custom_providers:
            custom_config = self.config.custom_providers[context.provider]
            api_key = custom_config.get('api_key') or self.config.get_api_key(context.provider)
        elif not api_key:
            api_key = self.config.get_api_key(context.provider)
            
        provider_config = ProviderConfig(
            api_key=api_key,
            timeout=self.config.timeout,
            max_retries=self.config.max_retries,
            **self.config.provider_configs.get(context.provider, {})
        )
        
        # Create provider instance
        provider = provider_class(provider_config)
        
        # Validate model
        if not provider.validate_model(context.model):
            available_models = provider.supported_models[:5]  # Show first 5
            raise ProviderError(
                f"Model '{context.model}' not supported by {context.provider}. "
                f"Available models include: {', '.join(available_models)}"
            )
        
        # Build request
        request = provider.build_request(context, content)
        
        # Execute request
        try:
            response = await provider.execute(request)
            return response
        except Exception as e:
            if isinstance(e, ProviderError):
                raise
            else:
                raise ProviderError(f"Provider execution failed: {e}")
    
    def get_available_providers(self) -> List[str]:
        """Get list of available providers."""
        return registry.get_available_providers()
    
    def get_provider_models(self, provider: str) -> List[str]:
        """Get available models for a provider."""
        try:
            # Check if it's a custom provider first
            if provider in self.config.custom_providers:
                return self.config.custom_providers[provider].get('models', [])
                
            # Otherwise get from registry
            provider_class = registry.get_provider_class(provider)
            temp_provider = provider_class(ProviderConfig())
            return temp_provider.supported_models
        except Exception:
            return []


# Convenience function for simple execution
async def execute_prompd(
    file_path: str,
    provider: str = "openai", 
    model: str = "gpt-4",
    **kwargs
) -> LLMResponse:
    """
    Convenience function to execute a prompd file.
    
    Args:
        file_path: Path to .prompd file
        provider: LLM provider name
        model: Model name
        **kwargs: Additional parameters
        
    Returns:
        LLM response
    """
    executor = PrompDExecutor()
    return await executor.execute(
        prompd_file=Path(file_path),
        provider=provider,
        model=model,
        **kwargs
    )