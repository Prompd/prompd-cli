"""Registry management commands."""

from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.panel import Panel

console = Console()


@click.group()
def registry():
    """Registry management commands."""
    pass


@registry.command('info')
@click.argument('package_name', required=True)
@click.option('--registry', help='Registry to query')
def registry_info(package_name: str, registry: Optional[str]):
    """Get detailed package information."""
    try:
        from prompd.registry import RegistryClient
        
        client = RegistryClient(registry_name=registry)
        info = client.get_package_info(package_name)
        
        console.print(Panel(
            f"[bold cyan]{info.get('name')}[/bold cyan] v{info.get('version')}\n\n"
            f"[bold]Description:[/bold] {info.get('description', 'No description')}\n"
            f"[bold]Author:[/bold] {info.get('author', 'Unknown')}\n"
            f"[bold]License:[/bold] {info.get('license', 'Unknown')}\n"
            f"[bold]Homepage:[/bold] {info.get('homepage', 'None')}\n"
            f"[bold]Downloads:[/bold] {info.get('downloads', 0):,}\n"
            f"[bold]Latest Version:[/bold] {info.get('latest', info.get('version'))}\n"
            f"[bold]Repository:[/bold] {info.get('repository', 'None')}",
            title=f"Package: {package_name}"
        ))
        
        # Show available versions
        if 'versions' in info and info['versions']:
            versions = info['versions'][:5]  # Show latest 5 versions
            version_list = ", ".join([f"v{v}" for v in versions])
            console.print(f"\n[bold]Recent Versions:[/bold] {version_list}")
            if len(info['versions']) > 5:
                console.print(f"[dim](and {len(info['versions']) - 5} more versions)[/dim]")
        
    except Exception as e:
        console.print(f"[red]Error getting package info: {e}[/red]")


@registry.command('list')
@click.option('--limit', default=20, help='Number of packages to list')
@click.option('--scope', help='Filter by scope (e.g., @prompd.io)')
def registry_list(limit: int, scope: Optional[str]):
    """List packages in the registry."""
    try:
        from prompd.registry import RegistryClient
        from rich.table import Table
        
        client = RegistryClient()
        
        # Use search with wildcard or scope
        if scope:
            query = f"scope:{scope}"
        else:
            query = "*"
            
        packages = client.search(query, limit)
        
        if not packages:
            console.print("[yellow]No packages found in registry[/yellow]")
            return
        
        table = Table(title=f"Registry Packages{f' (scope: {scope})' if scope else ''}")
        table.add_column("Package", style="cyan")
        table.add_column("Version", style="green")
        table.add_column("Description", style="yellow", max_width=50)
        table.add_column("Downloads", style="red")
        
        for pkg in packages:
            name = pkg.get('name', 'Unknown')
            version = pkg.get('version', 'Unknown')
            desc = pkg.get('description', 'No description')
            downloads = pkg.get('downloads', 0)
            
            # Truncate long descriptions
            if len(desc) > 50:
                desc = desc[:47] + "..."
            
            table.add_row(name, version, desc, str(downloads))
        
        console.print(table)
        
    except Exception as e:
        console.print(f"[red]Error listing packages: {e}[/red]")


@registry.command('status')
def registry_status():
    """Show registry status and health."""
    try:
        from prompd.registry import RegistryClient
        import requests
        
        client = RegistryClient()
        
        # Check registry health
        health_url = f"{client.registry_url}/health"
        response = requests.get(health_url, timeout=5)
        
        if response.status_code == 200:
            health_status = "🟢 Online"
        else:
            health_status = "🔴 Issues detected"
        
        # Get registry info
        try:
            import requests
            registry_info_url = f"{client.registry_url}/.well-known/registry.json"
            registry_response = requests.get(registry_info_url, timeout=5)
            registry_data = registry_response.json()
            
            info_content = f"""
[bold cyan]Registry Status[/bold cyan]

[bold]URL:[/bold] {client.registry_url}
[bold]Status:[/bold] {health_status}
[bold]Name:[/bold] {registry_data.get('name', 'Unknown')}
[bold]Version:[/bold] {registry_data.get('version', 'Unknown')}
[bold]Description:[/bold] {registry_data.get('description', 'No description')}

[bold]Statistics:[/bold]
• Packages: {registry_data.get('stats', {}).get('packages', 'Unknown'):,}
• Versions: {registry_data.get('stats', {}).get('versions', 'Unknown'):,}
• Last Updated: {registry_data.get('stats', {}).get('lastUpdated', 'Unknown')}

[bold]Capabilities:[/bold]
• Formats: {', '.join(registry_data.get('capabilities', {}).get('formats', []))}
• Features: {', '.join(registry_data.get('capabilities', {}).get('features', []))}
"""
        except Exception:
            info_content = f"""
[bold cyan]Registry Status[/bold cyan]

[bold]URL:[/bold] {client.registry_url}
[bold]Status:[/bold] {health_status}
[bold]Details:[/bold] Unable to fetch registry information
"""
        
        console.print(Panel(info_content.strip(), title="Registry Status"))
        
    except Exception as e:
        console.print(f"[red]Error checking registry status: {e}[/red]")