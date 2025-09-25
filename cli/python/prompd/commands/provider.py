"""Provider management commands."""

import subprocess
import sys
from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from ..config import PrompdConfig
from ..exceptions import PrompdError
from ..security import SecurityError, validate_version_string

console = Console()


@click.group()
def provider():
    """Manage LLM providers (add custom endpoints, API keys, etc)."""
    pass


@provider.command("list")
def list_providers():
    """List all configured providers."""
    config = PrompdConfig()
    
    if not config.providers:
        console.print("[yellow]No custom providers configured[/yellow]")
        console.print("\n[dim]Available built-in providers: openai, anthropic, ollama, groq, together[/dim]")
        return
    
    table = Table(title="Custom Providers")
    table.add_column("Name", style="cyan")
    table.add_column("URL", style="green")
    table.add_column("Models", style="yellow")
    table.add_column("API Key", style="red")
    
    for name, provider_config in config.providers.items():
        api_key_status = "✓ Set" if provider_config.get('api_key') else "✗ Not set"
        models = ", ".join(provider_config.get('models', []))
        table.add_row(
            name,
            provider_config.get('url', 'N/A'),
            models[:50] + "..." if len(models) > 50 else models,
            api_key_status
        )
    
    console.print(table)


@provider.command("add")
@click.argument('name')
@click.argument('url') 
@click.argument('models', nargs=-1)
@click.option('--api-key', help='API key for the provider')
def add_provider(name: str, url: str, models: tuple, api_key: Optional[str]):
    """Add a custom LLM provider.
    
    Examples:
        prompd provider add groq https://api.groq.com/openai/v1 llama-3.1-8b mixtral-8x7b
        prompd provider add local-ollama http://localhost:11434/v1 llama3.2 qwen2.5
        prompd provider add lm-studio http://localhost:1234/v1 local-model
    """
    try:
        config = PrompdConfig()
        
        # Basic validation
        if not name.replace('-', '').replace('_', '').isalnum():
            console.print("[red]Provider name must be alphanumeric (with - and _ allowed)[/red]")
            return
        
        if not url.startswith(('http://', 'https://')):
            console.print("[red]Provider URL must start with http:// or https://[/red]")
            return
        
        if not models:
            console.print("[red]At least one model must be specified[/red]")
            return
        
        # Add provider
        config.providers[name] = {
            'url': url,
            'models': list(models)
        }
        
        if api_key:
            config.providers[name]['api_key'] = api_key
        
        config.save()
        
        console.print(f"[green]✓[/green] Added provider '{name}'")
        console.print(f"  URL: {url}")
        console.print(f"  Models: {', '.join(models)}")
        
        if api_key:
            console.print(f"  API Key: {'*' * 20}")
        else:
            console.print(f"  [yellow]Note:[/yellow] You can set an API key with: prompd provider setkey {name} <key>")
            
    except Exception as e:
        console.print(f"[red]Error adding provider: {e}[/red]")


@provider.command("remove")
@click.argument('name')
def remove_provider(name: str):
    """Remove a custom provider."""
    config = PrompdConfig()
    
    if name not in config.providers:
        console.print(f"[yellow]Provider '{name}' not found[/yellow]")
        return
    
    del config.providers[name]
    config.save()
    
    console.print(f"[green]✓[/green] Removed provider '{name}'")


@provider.command("show")
@click.argument('name')
def show_provider(name: str):
    """Show detailed information about a provider."""
    config = PrompdConfig()
    
    if name not in config.providers:
        console.print(f"[yellow]Provider '{name}' not found[/yellow]")
        return
    
    provider_config = config.providers[name]
    
    panel_content = f"""
[bold cyan]Provider:[/bold cyan] {name}
[bold cyan]URL:[/bold cyan] {provider_config.get('url', 'N/A')}
[bold cyan]Models:[/bold cyan] {', '.join(provider_config.get('models', []))}
[bold cyan]API Key:[/bold cyan] {'Set' if provider_config.get('api_key') else 'Not set'}
"""
    
    console.print(Panel(panel_content.strip(), title=f"Provider: {name}"))


@provider.command("setkey")
@click.argument('provider_name')
@click.argument('api_key')
def setkey(provider_name: str, api_key: str):
    """Set API key for a provider."""
    config = PrompdConfig()
    
    # Check if it's a built-in provider
    builtin_providers = ['openai', 'anthropic', 'ollama', 'groq', 'together']
    
    if provider_name in builtin_providers:
        # Set in api_keys section for built-in providers
        config.api_keys[provider_name] = api_key
    elif provider_name in config.providers:
        # Set in custom provider config
        config.providers[provider_name]['api_key'] = api_key
    else:
        console.print(f"[red]Provider '{provider_name}' not found[/red]")
        console.print("Use 'prompd provider list' to see available providers")
        return
    
    config.save()
    console.print(f"[green]✓[/green] API key set for provider '{provider_name}'")


@provider.command("removekey")
@click.argument('provider_name')
def removekey(provider_name: str):
    """Remove API key for a provider."""
    config = PrompdConfig()
    
    removed = False
    
    # Check built-in providers
    if provider_name in config.api_keys:
        del config.api_keys[provider_name]
        removed = True
    
    # Check custom providers
    if provider_name in config.providers and 'api_key' in config.providers[provider_name]:
        del config.providers[provider_name]['api_key']
        removed = True
    
    if not removed:
        console.print(f"[yellow]No API key found for provider '{provider_name}'[/yellow]")
        return
    
    config.save()
    console.print(f"[green]✓[/green] API key removed for provider '{provider_name}'")