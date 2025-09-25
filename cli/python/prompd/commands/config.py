"""Configuration management commands for prompd CLI."""

import click
import yaml
import json
from pathlib import Path
from typing import Dict, Any, Optional, List

from prompd.exceptions import PrompdError
from prompd.config import PrompdConfig


@click.group()
def config():
    """Configuration management commands."""
    pass


@config.group()
def registry():
    """Registry configuration commands."""
    pass


@config.group()
def provider():
    """Provider configuration commands."""
    pass


@config.command()
def show():
    """Show all configuration."""
    try:
        config_obj = PrompdConfig.load()
        config_dict = {
            'defaults': {
                'provider': config_obj.default_provider or 'not set',
                'model': config_obj.default_model or 'not set',
                'registry': config_obj.default_registry or 'not set'
            },
            'custom_providers': config_obj.custom_providers,
            'registries': config_obj.registries,
            'api_keys': {name: '***' if key else None for name, key in config_obj.api_keys.items()},
            'settings': {
                'timeout': config_obj.timeout,
                'max_retries': config_obj.max_retries,
                'verbose': config_obj.verbose
            }
        }

        click.echo(yaml.dump(config_dict, default_flow_style=False, sort_keys=False))

    except Exception as e:
        raise PrompdError(f"Failed to show configuration: {e}")


@config.command()
@click.pass_context
def registries(ctx):
    """List configured registries (alias for 'registry list')."""
    ctx.invoke(registry_list)


@config.command()
@click.pass_context
def providers(ctx):
    """List configured providers (alias for 'provider list')."""
    ctx.invoke(provider_list)


# Registry Commands
@registry.command('list')
def registry_list():
    """List all configured registries."""
    try:
        config_obj = PrompdConfig.load()

        if not config_obj.registries:
            click.echo("No registries configured.")
            return

        click.echo("Configured registries:")
        for name, registry_config in config_obj.registries.items():
            default_marker = " (default)" if name == config_obj.default_registry else ""
            click.echo(f"  {name}{default_marker}")
            click.echo(f"    URL: {registry_config.get('url', 'N/A')}")
            api_key_status = "configured" if registry_config.get('api_key') else "not configured"
            click.echo(f"    API Key: {api_key_status}")

    except Exception as e:
        raise PrompdError(f"Failed to list registries: {e}")


@registry.command('add')
@click.argument('name')
@click.argument('url')
@click.option('--api-key', help='Registry authentication API key')
@click.option('--set-default', is_flag=True, help='Set as default registry')
def registry_add(name: str, url: str, api_key: Optional[str], set_default: bool):
    """Add a new registry configuration."""
    try:
        config_obj = PrompdConfig.load()

        # Add registry
        config_obj.add_registry(name, url, api_key)

        # Set as default if requested or if it's the first registry
        if set_default or not config_obj.default_registry:
            config_obj.default_registry = name

        config_obj.save()

        click.echo(f"Registry '{name}' added successfully.")
        if set_default or not config_obj.default_registry:
            click.echo(f"Set '{name}' as default registry.")

    except Exception as e:
        raise PrompdError(f"Failed to add registry: {e}")


@registry.command('remove')
@click.argument('name')
def registry_remove(name: str):
    """Remove a registry configuration."""
    try:
        config_obj = PrompdConfig.load()

        if name not in config_obj.registries:
            raise PrompdError(f"Registry '{name}' not found.")

        config_obj.remove_registry(name)

        config_obj.save()

        click.echo(f"Registry '{name}' removed successfully.")

    except Exception as e:
        raise PrompdError(f"Failed to remove registry: {e}")


@registry.command('set-default')
@click.argument('name')
def registry_set_default(name: str):
    """Set the default registry."""
    try:
        config_obj = PrompdConfig.load()

        if name not in config_obj.registries:
            raise PrompdError(f"Registry '{name}' not found.")

        config_obj.default_registry = name
        config_obj.save()

        click.echo(f"Set '{name}' as default registry.")

    except Exception as e:
        raise PrompdError(f"Failed to set default registry: {e}")


@registry.command('show')
@click.argument('name', required=False)
def registry_show(name: Optional[str]):
    """Show registry details."""
    try:
        config_obj = PrompdConfig.load()

        if name:
            if name not in config_obj.registries:
                raise PrompdError(f"Registry '{name}' not found.")
            registries_to_show = {name: config_obj.registries[name]}
        else:
            registries_to_show = config_obj.registries

        for reg_name, reg_config in registries_to_show.items():
            default_marker = " (default)" if reg_name == config_obj.default_registry else ""
            click.echo(f"Registry: {reg_name}{default_marker}")
            click.echo(f"  URL: {reg_config.get('url', 'N/A')}")
            api_key_status = "configured" if reg_config.get('api_key') else "not configured"
            click.echo(f"  API Key: {api_key_status}")
            click.echo()

    except Exception as e:
        raise PrompdError(f"Failed to show registry: {e}")


# Provider Commands
@provider.command('list')
def provider_list():
    """List all configured providers."""
    try:
        config_obj = PrompdConfig.load()

        click.echo("Built-in providers:")
        from prompd.providers import registry as provider_registry
        builtin_providers = provider_registry.get_available_providers()

        for provider_name in sorted(builtin_providers):
            try:
                provider_class = provider_registry.get_provider_class(provider_name)
                temp_provider = provider_class({})
                models = temp_provider.supported_models[:3]  # Show first 3 models
                models_str = ', '.join(models) + ('...' if len(temp_provider.supported_models) > 3 else '')
                click.echo(f"  {provider_name}: {models_str}")
            except Exception:
                click.echo(f"  {provider_name}: (models unavailable)")

        if config_obj.custom_providers:
            click.echo("\nCustom providers:")
            for name, provider_config in config_obj.custom_providers.items():
                enabled = "(enabled)" if provider_config.get('enabled', True) else "(disabled)"
                models = provider_config.get('models', [])
                models_str = ', '.join(models[:3]) + ('...' if len(models) > 3 else '')
                click.echo(f"  {name} {enabled}: {models_str}")

        # Show API key status
        click.echo("\nAPI key status:")
        for provider_name in sorted(builtin_providers):
            key_status = "configured" if config_obj.get_api_key(provider_name) else "not configured"
            click.echo(f"  {provider_name}: {key_status}")

        for name in config_obj.custom_providers.keys():
            key_status = "configured" if config_obj.get_api_key(name) else "not configured"
            click.echo(f"  {name}: {key_status}")

    except Exception as e:
        raise PrompdError(f"Failed to list providers: {e}")


@provider.command('add')
@click.argument('name')
@click.argument('url')
@click.argument('models', nargs=-1, required=True)
@click.option('--api-key', help='API key for the provider')
@click.option('--enabled/--disabled', default=True, help='Enable or disable the provider')
def provider_add(name: str, url: str, models: tuple, api_key: Optional[str], enabled: bool):
    """Add a custom provider configuration."""
    try:
        config_obj = PrompdConfig.load()

        # Add custom provider
        config_obj.custom_providers[name] = {
            'base_url': url,
            'models': list(models),
            'enabled': enabled
        }

        # Set API key if provided
        if api_key:
            config_obj.api_keys[name] = api_key

        config_obj.save()

        click.echo(f"Custom provider '{name}' added successfully.")
        click.echo(f"  URL: {url}")
        click.echo(f"  Models: {', '.join(models)}")
        click.echo(f"  Enabled: {enabled}")

    except Exception as e:
        raise PrompdError(f"Failed to add provider: {e}")


@provider.command('remove')
@click.argument('name')
def provider_remove(name: str):
    """Remove a custom provider configuration."""
    try:
        config_obj = PrompdConfig.load()

        if name not in config_obj.custom_providers:
            raise PrompdError(f"Custom provider '{name}' not found.")

        del config_obj.custom_providers[name]

        # Remove API key if present
        if name in config_obj.api_keys:
            del config_obj.api_keys[name]

        config_obj.save()

        click.echo(f"Custom provider '{name}' removed successfully.")

    except Exception as e:
        raise PrompdError(f"Failed to remove provider: {e}")


@provider.command('setkey')
@click.argument('name')
@click.argument('api_key')
def provider_setkey(name: str, api_key: str):
    """Set API key for a provider."""
    try:
        config_obj = PrompdConfig.load()

        # Check if provider exists (builtin or custom)
        from prompd.providers import registry as provider_registry
        builtin_providers = provider_registry.get_available_providers()

        if name not in builtin_providers and name not in config_obj.custom_providers:
            raise PrompdError(f"Provider '{name}' not found. Add it first with 'prompd config provider add'.")

        config_obj.api_keys[name] = api_key
        config_obj.save()

        click.echo(f"API key set for provider '{name}'.")

    except Exception as e:
        raise PrompdError(f"Failed to set API key: {e}")