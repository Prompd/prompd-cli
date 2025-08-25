"""Configuration management for prompd."""

import json
import os
from pathlib import Path
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field

import yaml
from dotenv import load_dotenv

from prompd.models import ParameterValue
from prompd.exceptions import ConfigurationError


@dataclass
class PrompDConfig:
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
    
    # Execution settings
    timeout: int = 30
    max_retries: int = 3
    verbose: bool = False
    
    def __post_init__(self):
        self.config_file = self.config_dir / "config.yaml"
    
    @classmethod
    def load(cls) -> "PrompDConfig":
        """Load configuration from files and environment."""
        config = cls()
        
        # Load environment variables
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
                    
            except Exception as e:
                raise ConfigurationError(f"Failed to load config file: {e}")
        
        # Load API keys from environment
        config._load_api_keys_from_env()
        
        return config
    
    def _load_api_keys_from_env(self):
        """Load API keys from environment variables."""
        env_keys = {
            'openai': 'OPENAI_API_KEY',
            'anthropic': 'ANTHROPIC_API_KEY',
            'ollama': 'OLLAMA_API_KEY',
        }
        
        for provider, env_var in env_keys.items():
            value = os.getenv(env_var)
            if value and provider not in self.api_keys:
                self.api_keys[provider] = value
    
    def get_api_key(self, provider: str) -> Optional[str]:
        """Get API key for a provider."""
        # Check explicit key first
        if provider in self.api_keys:
            return self.api_keys[provider]
        
        # Check environment variables
        env_var = f"{provider.upper()}_API_KEY"
        return os.getenv(env_var)
    
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
            "custom_providers": self.custom_providers
        }
        
        try:
            with open(self.config_file, 'w') as f:
                yaml.dump(config_data, f, default_flow_style=False)
        except Exception as e:
            raise ConfigurationError(f"Failed to save config: {e}")


class ParameterManager:
    """Manages parameter resolution with precedence hierarchy."""
    
    def __init__(self, config: Optional[PrompDConfig] = None):
        self.config = config or PrompDConfig.load()
    
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