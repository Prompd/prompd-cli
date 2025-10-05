"""Configuration management for prompd."""

import json
import os
from pathlib import Path
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field

import yaml

from prompd.exceptions import ConfigurationError


@dataclass
class PrompdConfig:
    """Global configuration for prompd."""
    
    # Default paths
    config_dir: Path = field(default_factory=lambda: Path.home() / ".prompd")
    config_file: Path = field(init=False)
    
    # Provider settings
    default_provider: Optional[str] = None
    default_model: Optional[str] = None
    
    # API settings
    api_keys: Dict[str, str] = field(default_factory=dict)
    provider_configs: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    
    # Custom providers
    custom_providers: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    
    # Registry settings
    registry: Dict[str, Any] = field(default_factory=dict)
    
    # Package scopes -> registry mapping
    scopes: Dict[str, str] = field(default_factory=dict)
    
    # Execution settings
    timeout: int = 30
    max_retries: int = 3
    verbose: bool = False
    
    def __post_init__(self):
        self.config_file = self.config_dir / "config.yaml"

    @property
    def registries(self) -> Dict[str, Dict[str, Any]]:
        """Get registries configuration."""
        return self.registry.get('registries', {})

    @property
    def default_registry(self) -> Optional[str]:
        """Get default registry name."""
        return self.registry.get('default')

    @default_registry.setter
    def default_registry(self, value: Optional[str]):
        """Set default registry name."""
        if 'registries' not in self.registry:
            self.registry['registries'] = {}
        self.registry['default'] = value

    def add_registry(self, name: str, url: str, api_key: Optional[str] = None):
        """Add a registry configuration."""
        if 'registries' not in self.registry:
            self.registry['registries'] = {}
        self.registry['registries'][name] = {'url': url}
        if api_key:
            self.registry['registries'][name]['api_key'] = api_key

    def remove_registry(self, name: str):
        """Remove a registry configuration."""
        if 'registries' in self.registry and name in self.registry['registries']:
            del self.registry['registries'][name]
            if self.registry.get('default') == name:
                self.registry['default'] = None
    
    @classmethod
    def load(cls) -> "PrompdConfig":
        """Load configuration from files and environment."""
        config = cls()
        
        # Load environment variables
        from dotenv import load_dotenv
        load_dotenv()
        
        # Load from config file if exists
        if config.config_file.exists():
            try:
                with open(config.config_file, 'r') as f:
                    data = yaml.safe_load(f) or {}
                
                # Update config fields
                if 'default_provider' in data:
                    config.default_provider = data['default_provider']
                if 'default_model' in data:
                    config.default_model = data['default_model']
                if 'timeout' in data:
                    config.timeout = data['timeout']
                if 'max_retries' in data:
                    config.max_retries = data['max_retries']
                if 'verbose' in data:
                    config.verbose = data['verbose']
                if 'api_keys' in data:
                    config.api_keys.update(data['api_keys'])
                if 'provider_configs' in data:
                    config.provider_configs.update(data['provider_configs'])
                if 'custom_providers' in data:
                    config.custom_providers.update(data['custom_providers'])
                if 'registry' in data:
                    config.registry.update(data['registry'])
                if 'scopes' in data:
                    config.scopes.update(data['scopes'])
                    
            except Exception as e:
                raise ConfigurationError(f"Failed to load config file: {e}")
        
        # Load API keys from environment
        config._load_api_keys_from_env()
        
        # Ensure default registries are available
        config.ensure_default_registries()
        
        # Migrate old config structure if needed
        config.migrate_legacy_config()
        
        return config
    
    def _load_api_keys_from_env(self):
        """Load API keys from environment variables."""
        env_keys = {
            'openai': 'OPENAI_API_KEY',
            'anthropic': 'ANTHROPIC_API_KEY',
            'groq': 'GROQ_API_KEY',
            'ollama': 'OLLAMA_API_KEY',
        }
        
        for provider, env_var in env_keys.items():
            value = os.getenv(env_var)
            if value and provider not in self.api_keys:
                self.api_keys[provider] = value
    
    def get_api_key(self, provider: str) -> Optional[str]:
        """Get API key for a provider."""
        # 1. Check explicit config api_keys first
        if provider in self.api_keys:
            return self.api_keys[provider]
        
        # 2. Check custom provider api_key
        if provider in self.custom_providers:
            custom_api_key = self.custom_providers[provider].get('api_key')
            if custom_api_key:
                return custom_api_key
        
        # 3. Fallback to environment variables
        env_var = f"{provider.upper()}_API_KEY"
        return os.getenv(env_var)
    
    def get_registry_api_key(self) -> Optional[str]:
        """Get registry API key."""
        # 1. Check dedicated registry section first
        if 'api_key' in self.registry:
            return self.registry['api_key']

        # 2. Fallback to legacy token field (for backwards compatibility)
        if 'token' in self.registry:
            return self.registry['token']

        # 3. Fallback to legacy prompd key in api_keys (for backwards compatibility)
        if 'prompd' in self.api_keys:
            return self.api_keys['prompd']

        # 4. Environment variable fallback
        return os.getenv('PROMPD_API_TOKEN')

    def set_registry_api_key(self, api_key: str):
        """Set registry API key."""
        self.registry['api_key'] = api_key
        # Remove legacy fields if they exist (cleanup)
        if 'token' in self.registry:
            del self.registry['token']
        if 'prompd' in self.api_keys:
            del self.api_keys['prompd']
    
    def get_registry_url(self) -> str:
        """Get registry URL from configured registries."""
        # Get default registry name
        default_registry = self.registry.get('default', 'prompdhub')
        registries = self.registry.get('registries', {})

        # Return URL from default registry, or fallback to prompdhub
        if default_registry in registries:
            return registries[default_registry].get('url', 'https://registry.prompdhub.ai')

        # Final fallback to prompdhub production URL
        return 'https://registry.prompdhub.ai'
    
    def resolve_registry_for_package(self, package_name: str) -> str:
        """Resolve which registry to use for a package."""
        # Extract scope from package name (@scope/package)
        if package_name.startswith('@') and '/' in package_name:
            scope = package_name.split('/')[0]  # @company
            
            # Check if scope has a configured registry
            if scope in self.scopes:
                registry_name = self.scopes[scope]
                if registry_name in self.registry.get('registries', {}):
                    return registry_name
        
        # Fallback to default registry
        return self.registry.get('default', 'prompdhub')
    
    def add_scope_mapping(self, scope: str, registry_name: str):
        """Map a package scope to a registry."""
        if not scope.startswith('@'):
            scope = f'@{scope}'
        self.scopes[scope] = registry_name
    
    def remove_scope_mapping(self, scope: str):
        """Remove a scope mapping."""
        if not scope.startswith('@'):
            scope = f'@{scope}'
        if scope in self.scopes:
            del self.scopes[scope]
    
    def ensure_default_registries(self):
        """Ensure prompdhub registry is always available."""
        if 'registries' not in self.registry:
            self.registry['registries'] = {}
        
        # Always ensure prompdhub is available (unless explicitly removed)
        if 'prompdhub' not in self.registry['registries']:
            self.registry['registries']['prompdhub'] = {
                'url': 'https://registry.prompdhub.ai',
                'api_key': None,
                'username': None
            }
        
        # Set prompdhub as default if no default is set
        if not self.registry.get('default'):
            self.registry['default'] = 'prompdhub'
    
    def migrate_legacy_config(self):
        """Migrate old single-registry config to new multi-registry structure."""
        needs_save = False

        # Migrate 'token' to 'api_key' in all registries
        if 'registries' in self.registry:
            for registry_name, registry_config in self.registry['registries'].items():
                if 'token' in registry_config and 'api_key' not in registry_config:
                    registry_config['api_key'] = registry_config['token']
                    del registry_config['token']
                    needs_save = True

        # Check for legacy prompd token in api_keys
        if 'prompd' in self.api_keys:
            legacy_token = self.api_keys['prompd']
            
            # Move to registry structure
            if 'registries' not in self.registry:
                self.registry['registries'] = {}
            
            # If prompdhub doesn't have an api_key yet, use the legacy one
            if 'prompdhub' in self.registry['registries'] and not self.registry['registries']['prompdhub'].get('api_key'):
                self.registry['registries']['prompdhub']['api_key'] = legacy_token
                needs_save = True
            
            # Remove from api_keys
            del self.api_keys['prompd']
            needs_save = True
        
        # Check for old registry.json file and migrate
        old_registry_file = self.config_dir / "registry.json"
        if old_registry_file.exists():
            try:
                import json
                with open(old_registry_file, 'r') as f:
                    old_data = json.load(f)
                
                # Migrate old registry data to new structure
                if 'registries' not in self.registry:
                    self.registry['registries'] = {}
                
                # Create a registry entry from old data
                old_url = old_data.get('registry_url', 'https://registry.prompdhub.ai')
                # Determine registry name based on URL
                if 'localhost' in old_url or '127.0.0.1' in old_url:
                    registry_name = 'local'
                else:
                    registry_name = 'prompdhub'
                
                if registry_name not in self.registry['registries']:
                    self.registry['registries'][registry_name] = {
                        'url': old_url,
                        'api_key': old_data.get('api_token'),
                        'username': old_data.get('username')
                    }
                    needs_save = True
                
                # Remove old file
                old_registry_file.unlink()
                
            except Exception:
                # If migration fails, just continue
                pass
        
        if needs_save:
            self.save()
    
    def add_custom_provider(self, name: str, base_url: str, models: List[str], 
                          api_key: Optional[str] = None, provider_type: str = "openai-compatible"):
        """Add a custom LLM provider."""
        self.custom_providers[name] = {
            "base_url": base_url,
            "models": models,
            "api_key": api_key,
            "type": provider_type,
            "enabled": True
        }
        if api_key:
            self.api_keys[name] = api_key
    
    def remove_custom_provider(self, name: str):
        """Remove a custom LLM provider."""
        if name in self.custom_providers:
            del self.custom_providers[name]
        if name in self.api_keys:
            del self.api_keys[name]
    
    def list_custom_providers(self) -> Dict[str, Dict[str, Any]]:
        """List all custom providers."""
        return self.custom_providers.copy()
    
    def save(self):
        """Save configuration to file."""
        self.config_dir.mkdir(exist_ok=True)
        
        config_data = {
            "default_provider": self.default_provider,
            "default_model": self.default_model,
            "timeout": self.timeout,
            "max_retries": self.max_retries,
            "verbose": self.verbose,
            "api_keys": self.api_keys,
            "provider_configs": self.provider_configs,
            "custom_providers": self.custom_providers,
            "registry": self.registry,
            "scopes": self.scopes
        }
        
        try:
            with open(self.config_file, 'w') as f:
                yaml.dump(config_data, f, default_flow_style=False)
        except Exception as e:
            raise ConfigurationError(f"Failed to save config: {e}")


class ParameterManager:
    """Manages parameter resolution with precedence hierarchy."""
    
    def __init__(self, config: Optional[PrompdConfig] = None):
        self.config = config or PrompdConfig.load()
    
    def resolve_parameters(
        self,
        cli_params: Optional[Dict[str, str]] = None,
        param_files: Optional[List[Path]] = None,
        prompd_defaults: Optional[Dict[str, Any]] = None,
        env_prefix: str = "PROMPD_PARAM_"
    ) -> Dict[str, Any]:
        """
        Resolve parameters from all sources with precedence.
        
        Precedence (highest to lowest):
        1. CLI parameters
        2. Parameter files
        3. Environment variables
        4. Prompd file defaults
        
        Args:
            cli_params: Parameters from CLI (--param key=value)
            param_files: Parameter files to load
            prompd_defaults: Default values from prompd file
            env_prefix: Prefix for environment variable lookup
            
        Returns:
            Resolved parameters dictionary
        """
        resolved = {}
        
        # 4. Start with prompd defaults (lowest precedence)
        if prompd_defaults:
            resolved.update(prompd_defaults)
        
        # 3. Environment variables
        env_params = self._load_env_parameters(env_prefix)
        resolved.update(env_params)
        
        # 2. Parameter files
        if param_files:
            for param_file in param_files:
                file_params = self._load_parameter_file(param_file)
                resolved.update(file_params)
        
        # 1. CLI parameters (highest precedence)
        if cli_params:
            resolved.update(cli_params)
        
        return resolved
    
    def _load_env_parameters(self, prefix: str) -> Dict[str, Any]:
        """Load parameters from environment variables."""
        params = {}
        
        for key, value in os.environ.items():
            if key.startswith(prefix):
                param_name = key[len(prefix):].lower()
                params[param_name] = value
        
        return params
    
    def _load_parameter_file(self, file_path: Path) -> Dict[str, Any]:
        """
        Load parameters from file (JSON with optional metadata).
        
        Supports both formats:
        - Simple: {"key": "value"}
        - With metadata: {"key": {"value": "...", "type": "string"}}
        """
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
        except Exception as e:
            raise ConfigurationError(f"Failed to load parameter file {file_path}: {e}")
        
        params = {}
        
        for key, value in data.items():
            if isinstance(value, dict) and 'value' in value:
                # Metadata format: {"key": {"value": "...", "type": "string"}}
                from prompd.models import ParameterValue
                param_value = ParameterValue.from_dict(value)
                params[key] = param_value.value
            else:
                # Simple format: {"key": "value"}
                params[key] = value
        
        return params
    
    def parse_cli_parameters(self, param_strings: List[str]) -> Dict[str, str]:
        """
        Parse CLI parameter strings.
        
        Args:
            param_strings: List of "key=value" strings
            
        Returns:
            Dictionary of parsed parameters
        """
        params = {}
        
        for param_str in param_strings:
            if '=' not in param_str:
                raise ConfigurationError(f"Invalid parameter format: {param_str}. Use key=value")
            
            key, value = param_str.split('=', 1)
            params[key.strip()] = value.strip()
        
        return params
    
    def validate_required_parameters(
        self,
        resolved_params: Dict[str, Any],
        parameter_definitions: List[Dict[str, Any]]
    ) -> None:
        """
        Validate that all required parameters are provided.
        
        Args:
            resolved_params: Resolved parameter values
            parameter_definitions: Parameter definitions from prompd metadata
            
        Raises:
            ConfigurationError: If required parameters are missing
        """
        missing_params = []
        
        for param_def in parameter_definitions:
            name = param_def.get('name')
            required = param_def.get('required', False)
            has_default = 'default' in param_def
            
            if required and not has_default and name not in resolved_params:
                missing_params.append(name)
        
        if missing_params:
            raise ConfigurationError(
                f"Missing required parameters: {', '.join(missing_params)}"
            )