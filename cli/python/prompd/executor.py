"""Execution engine for prompd files."""

import asyncio
from pathlib import Path
from typing import Dict, Any, Optional, List

from jinja2 import Environment, Template, TemplateSyntaxError

from prompd.models import ExecutionContext, PrompdFile, LLMRequest, LLMResponse
from prompd.parser import PrompdParser
from prompd.config import PrompdConfig, ParameterManager
from prompd.providers import registry, ProviderConfig
from prompd.providers.custom import CustomProvider
from prompd.exceptions import PrompdError, ProviderError, ConfigurationError, SubstitutionError


class PrompdExecutor:
    """Main execution engine for prompd files."""
    
    def __init__(self, config: Optional[PrompdConfig] = None):
        self.config = config or PrompdConfig.load()
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
        extra_config: Optional[Dict[str, Any]] = None,
        metadata_overrides: Optional[Dict[str, str]] = None
    ) -> LLMResponse:
        """
        Execute a prompd file with given parameters.
        
        Args:
            prompd_file: Path to .prmd file
            provider: LLM provider name
            model: Model name
            cli_params: CLI parameters as list of "key=value" strings
            param_files: List of parameter files to load
            api_key: Override API key
            extra_config: Additional configuration
            
        Returns:
            LLM response
            
        Raises:
            PrompdError: If execution fails
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

            # Handle dynamic metadata overrides BEFORE resolving structured content
            # Keys may include 'meta:<section>' (preferred) or legacy 'custom:<section>' / 'custom'
            pending_append_to_context: List[str] = []
            std_overrides: Dict[str, str] = {}
            if metadata_overrides:
                for key in list(metadata_overrides.keys()):
                    raw_value = metadata_overrides[key]
                    # Normalize and map synonyms
                    def _norm_section(name: str) -> str:
                        name = (name or '').strip().lower().replace(' ', '-')
                        if name == 'assistant':
                            return 'system'
                        if name == 'task':
                            return 'user'
                        return name

                    if key.startswith('meta:') or key.startswith('custom:'):
                        section_name = _norm_section(key.split(':', 1)[1])
                        resolved_val = self._resolve_custom_value(raw_value, base_file=prompd_file)
                        if section_name in ('system', 'user', 'context', 'response'):
                            # Defer to standard section override later
                            std_overrides[section_name] = resolved_val
                        else:
                            # Replace existing section if present; else append into context later
                            if section_name in prompd.sections:
                                prompd.sections[section_name] = resolved_val
                            else:
                                pending_append_to_context.append(f"## {section_name}\n\n{resolved_val}")
                        # Remove handled key to avoid double-application
                        del metadata_overrides[key]
                    elif key == 'custom':
                        resolved_val = self._resolve_custom_value(raw_value, base_file=prompd_file)
                        pending_append_to_context.append(resolved_val)
                        del metadata_overrides[key]

            # Get structured content with references resolved
            content = self.parser.get_structured_content(prompd, resolved_params)

            # Append any pending custom content into context
            if pending_append_to_context:
                combined = "\n\n".join(pending_append_to_context)
                if content.get('context'):
                    content['context'] = f"{content['context']}\n\n{combined}"
                else:
                    content['context'] = combined
            
            # Apply standard section overrides (system/user/context/response)
            if std_overrides:
                for k, v in std_overrides.items():
                    content[k] = v

            # Apply any remaining metadata overrides (back-compat direct keys)
            if metadata_overrides:
                for key, value in metadata_overrides.items():
                    if key in content:
                        content[key] = value
            
            # Use the full compilation pipeline instead of basic template substitution
            from .compiler import PrompdCompiler
            compiler = PrompdCompiler()
            
            # Compile to provider JSON format to get properly processed content
            compiled_json_str = compiler.compile(
                source=prompd_file,
                output_format=f"provider-json:{provider}",
                parameters=resolved_params
            )
            
            # Parse the compiled JSON to extract the message content
            import json
            try:
                compiled_data = json.loads(compiled_json_str)
                if "messages" in compiled_data and compiled_data["messages"]:
                    # Extract the user message content from the compiled JSON
                    user_message = compiled_data["messages"][0]["content"]
                    substituted_content = {
                        "user": user_message,
                        "system": None,  # System message handling can be added if needed
                        "context": None,
                        "response": None
                    }
                else:
                    raise PrompdError("Compiled output contains no messages")
            except (json.JSONDecodeError, KeyError) as e:
                raise PrompdError(f"Failed to parse compiled output: {e}")
            
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
            if isinstance(e, PrompdError):
                raise
            else:
                raise PrompdError(f"Execution failed: {e}")

    def _resolve_custom_value(self, raw: str, base_file: Path) -> str:
        """
        Resolve a custom override value which may be:
        - A file path (reads file content)
        - A directory path (reads all text files in directory)
        - A glob pattern (reads all matching files)
        - Inline text (returned as-is)
        """
        import glob as glob_module

        try:
            text = str(raw)

            # Handle relative paths
            if text.startswith('./') or text.startswith('../'):
                candidate = (base_file.parent / text).resolve()
            else:
                candidate = Path(text)

            # Check if it's a directory
            if candidate.exists() and candidate.is_dir():
                return self._read_directory_contents(candidate)

            # Check if it's a file
            if candidate.exists() and candidate.is_file():
                return candidate.read_text(encoding='utf-8')

            # Check if it's a glob pattern
            if '*' in text or '?' in text or '[' in text:
                # Resolve glob pattern relative to base file directory
                if text.startswith('./') or text.startswith('../'):
                    glob_pattern = str(base_file.parent / text)
                else:
                    glob_pattern = text

                matching_files = glob_module.glob(glob_pattern, recursive=True)
                if matching_files:
                    return self._read_multiple_files(matching_files)
        except Exception:
            pass

        return str(raw)

    def _read_directory_contents(self, directory: Path) -> str:
        """Read all text files in a directory and combine them."""
        contents = []

        # Read all common text file extensions
        text_extensions = {'.txt', '.md', '.prmd', '.json', '.yaml', '.yml', '.py', '.js', '.ts', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp'}

        for file_path in sorted(directory.iterdir()):
            if file_path.is_file() and file_path.suffix.lower() in text_extensions:
                try:
                    file_content = file_path.read_text(encoding='utf-8')
                    # Add file header for context
                    contents.append(f"### File: {file_path.name}\n\n{file_content}")
                except Exception:
                    # Skip files that can't be read
                    continue

        return '\n\n'.join(contents) if contents else ''

    def _read_multiple_files(self, file_paths: List[str]) -> str:
        """Read multiple files and combine their contents."""
        contents = []

        for file_path_str in sorted(file_paths):
            file_path = Path(file_path_str)
            if file_path.is_file():
                try:
                    file_content = file_path.read_text(encoding='utf-8')
                    # Add file header for context
                    contents.append(f"### File: {file_path.name}\n\n{file_content}")
                except Exception:
                    # Skip files that can't be read
                    continue

        return '\n\n'.join(contents) if contents else ''
    
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
    model: str = "gpt-4o-mini",
    **kwargs
) -> LLMResponse:
    """
    Convenience function to execute a prompd file.
    
    Args:
        file_path: Path to .prmd file
        provider: LLM provider name
        model: Model name
        **kwargs: Additional parameters
        
    Returns:
        LLM response
    """
    executor = PrompdExecutor()
    return await executor.execute(
        prompd_file=Path(file_path),
        provider=provider,
        model=model,
        **kwargs
    )
