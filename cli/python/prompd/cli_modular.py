"""Modular command-line interface for Prompd."""

import sys
from pathlib import Path
from typing import Optional

import click
from rich.console import Console

from prompd import __version__ as PROMPD_VERSION
from prompd.commands import provider, git_group, version, package, registry
from prompd.shell import InteractiveShell

# Configure console with proper encoding handling
try:
    console = Console(file=sys.stdout, force_terminal=True, width=120)
except:
    console = Console(file=sys.stdout, legacy_windows=True, width=120)


@click.group()
@click.version_option(version=PROMPD_VERSION, prog_name="prompd")
def cli():
    """Prompd - CLI for structured prompt definitions."""
    pass


@cli.command()
@click.argument("file", type=click.Path(exists=True))
@click.option("--verbose", "-v", is_flag=True, help="Show detailed validation results")
@click.option("--git", is_flag=True, help="Validate git integration")
@click.option("--version-only", is_flag=True, help="Only validate version format")
def validate(file, verbose, git, version_only):
    """Validate a .prmd file syntax and structure."""
    from prompd.validator import PrompDValidator
    from prompd.exceptions import ValidationError
    from pathlib import Path
    import sys
    
    try:
        file_path = Path(file)
        validator = PrompDValidator()
        
        if version_only:
            # Only check version consistency
            issues = validator.validate_version_consistency(file_path, check_git=git)
        else:
            # Full validation
            issues = validator.validate_file(file_path)
        
        # Separate errors and warnings
        errors = [issue for issue in issues if issue.get('level') == 'error']
        warnings = [issue for issue in issues if issue.get('level') == 'warning']
        
        if not errors:
            console.print(f"[green]OK {file_path.name} is valid[/green]")
            
            if warnings and verbose:
                console.print(f"\n[yellow]Warnings ({len(warnings)}):[/yellow]")
                for warning in warnings:
                    console.print(f"  [yellow]•[/yellow] {warning.get('message', warning)}")
        else:
            console.print(f"[red]✗ {file_path.name} is invalid[/red]")
            
            console.print(f"\n[red]Errors ({len(errors)}):[/red]")
            for error in errors:
                console.print(f"  [red]•[/red] {error.get('message', error)}")
            
            sys.exit(1)
    
    except ValidationError as e:
        console.print(f"[red]Validation failed: {e}[/red]")
        sys.exit(1)
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@cli.command("shell")
def interactive_shell():
    """Start interactive AI-powered shell."""
    try:
        shell = InteractiveShell()
        shell.run()
    except KeyboardInterrupt:
        console.print("\n[dim]Shell session ended[/dim]")
    except Exception as e:
        console.print(f"[red]Shell error: {e}[/red]")
        sys.exit(1)


@cli.command("chat")
def chat_mode():
    """Start direct chat mode."""
    try:
        shell = InteractiveShell()
        shell.run_chat_mode()
    except KeyboardInterrupt:
        console.print("\n[dim]Chat session ended[/dim]")
    except Exception as e:
        console.print(f"[red]Chat error: {e}[/red]")
        sys.exit(1)


@cli.command()
@click.argument('query', required=True)
@click.option('--limit', default=20, help='Maximum number of results')
@click.option('--registry', help='Registry to search in')
def search(query, limit, registry):
    """Search packages in registry."""
    from prompd.cli import search as _search_impl
    return _search_impl(query, limit, registry)


@cli.command()
@click.option('--token', help='API token for authentication')
@click.option('--username', help='Username for credential authentication')  
@click.option('--password', help='Password for credential authentication')
@click.option('--registry', help='Registry to login to')
def login(token, username, password, registry):
    """Login to package registry."""
    from prompd.cli import login as _login_impl
    return _login_impl(token, username, password, registry)


# Core commands that were missing
@cli.command(name="run", context_settings=dict(ignore_unknown_options=True))
@click.argument("file", type=click.Path(exists=True))
@click.option("--provider", required=False, help="LLM provider (openai, anthropic, ollama). Defaults from config if omitted")
@click.option("--model", "-m", help="Model to use for generation")
@click.option("-p", "--param", multiple=True, help="Parameter in key=value format (e.g., -p name=John -p age=25)")
@click.option("--param-file", "--params-file", multiple=True, help="JSON/YAML file with parameters")
@click.option("--api-key", help="API key override for this request")
@click.option("-o", "--output", help="Output file path (stdout if omitted)")
@click.option("--format", "format", default="text", type=click.Choice(["text", "json", "yaml"]),
              help="Output format")
@click.option("--version", "version", help="Version reference to use (for versioned files)")
@click.option("--verbose", "-v", is_flag=True, help="Show detailed execution information")
@click.option("--show-usage", is_flag=True, help="Display token usage statistics after execution")
def run(ctx, file, provider, model, param, param_file, api_key, output, format, version, verbose, show_usage):
    """Run a .prmd file with an LLM provider (supports --meta:* flags)."""
    from prompd.cli import _run_impl
    from pathlib import Path
    return _run_impl(ctx, Path(file), provider, model, param, param_file, api_key, output, format, version, verbose, show_usage)


@cli.command("compile", context_settings=dict(ignore_unknown_options=True, allow_extra_args=True))
@click.argument("source", type=str)
@click.option("--to", "output_format", default="markdown", help="Output format (markdown | provider-json [openai|anthropic] | provider-json:openai)")
@click.option("--to-markdown", is_flag=True, help="Compile to markdown (legacy)")
@click.option("--to-provider-json", type=str, help="Compile to provider JSON (legacy)")
@click.option("-p", "--param", multiple=True, help="Parameter in key=value format")
@click.option("--params-file", multiple=True, help="JSON/YAML file with parameters")
@click.option("-o", "--output", help="Output file path")
@click.option("--verbose", "-v", is_flag=True, help="Show detailed compilation info")
def compile_command(ctx, source, output_format, to_markdown, to_provider_json, param, params_file, output, verbose):
    """Compile a .prmd file or package reference to a target format.
    
    Supports package references like:
      @namespace/package@version
      @namespace/package
      local.prmd
      
    Examples:
      prompd compile myfile.prmd --to markdown
      prompd compile @security/audit@2.0.0 --to provider-json:openai
      prompd compile workflow.prmd -p env=prod --output compiled.md
    """
    from prompd.cli import compile_command as _compile_impl
    return _compile_impl(ctx, source, output_format, to_markdown, to_provider_json, param, params_file, output, verbose)


@cli.command("list")
@click.option("--path", "-p", type=click.Path(exists=True), 
              default=".", help="Directory to search for .prmd files")
@click.option("--recursive", "-r", is_flag=True, help="Search recursively in subdirectories")
@click.option("--name-only", is_flag=True, help="Only show file names")
def list_files(path, recursive, name_only):
    """List .prmd files in a directory."""
    from pathlib import Path
    from rich.table import Table
    import datetime
    
    try:
        path_obj = Path(path)
        
        # Find .prmd files
        if recursive:
            prmd_files = list(path_obj.rglob("*.prmd"))
        else:
            prmd_files = list(path_obj.glob("*.prmd"))
        
        if not prmd_files:
            console.print(f"[yellow]No .prmd files found in {path_obj}[/yellow]")
            return
        
        if name_only:
            for file_path in sorted(prmd_files):
                console.print(file_path.name)
            return
        
        # Display as table
        table = Table(title=f".prmd files in {path_obj}")
        table.add_column("File", style="cyan")
        table.add_column("Size", style="yellow", justify="right")
        table.add_column("Modified", style="green")
        
        for file_path in sorted(prmd_files):
            try:
                stat = file_path.stat()
                size_bytes = stat.st_size
                
                # Format file size
                if size_bytes < 1024:
                    size_str = f"{size_bytes} B"
                elif size_bytes < 1024 * 1024:
                    size_str = f"{size_bytes / 1024:.1f} KB"
                else:
                    size_str = f"{size_bytes / (1024 * 1024):.1f} MB"
                
                # Format modification time
                mod_time = datetime.datetime.fromtimestamp(stat.st_mtime)
                time_str = mod_time.strftime("%Y-%m-%d %H:%M")
                
                # Relative path
                rel_path = file_path.relative_to(path_obj)
                
                table.add_row(str(rel_path), size_str, time_str)
                
            except OSError:
                # Skip files we can't stat
                continue
        
        console.print(table)
        
    except Exception as e:
        console.print(f"[red]Error listing files: {e}[/red]")
        import sys
        sys.exit(1)


@cli.command()
@click.argument("file", type=click.Path(exists=True))
def show(file):
    """Show the structure and parameters of a .prmd file."""
    # Import and use the original implementation from cli.py
    import sys
    sys.path.insert(0, '.')
    from prompd.cli import show as show_orig
    from pathlib import Path
    return show_orig(Path(file))


@cli.command()
@click.option('--registry', help='Registry to logout from')
def logout(registry):
    """Logout from package registry."""
    from prompd.cli import logout as _logout_impl
    return _logout_impl(registry)


@cli.command()
def providers():
    """List available LLM providers and their models."""
    console.print("[dim]Note: Use 'prompd provider list' for more detailed view[/dim]\n")
    
    from prompd.config import PrompDConfig
    from rich.table import Table
    
    config = PrompDConfig.load()
    
    # Built-in providers
    builtin_providers = {
        'openai': ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
        'anthropic': ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
        'ollama': ['llama3.2', 'qwen2.5', 'mistral', 'codellama'],
        'groq': ['llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
        'together': ['meta-llama/Llama-3-8b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1']
    }
    
    table = Table(title="Available LLM Providers")
    table.add_column("Provider", style="cyan")
    table.add_column("Type", style="yellow")
    table.add_column("Models", style="green")
    table.add_column("API Key", style="red")
    
    # Add built-in providers
    for provider, models in builtin_providers.items():
        api_key_status = "✓ Set" if config.api_keys.get(provider) else "✗ Not set"
        model_list = ", ".join(models[:3])
        if len(models) > 3:
            model_list += f" (+{len(models) - 3} more)"
        table.add_row(provider, "Built-in", model_list, api_key_status)
    
    # Add custom providers
    for name, provider_config in config.providers.items():
        api_key_status = "✓ Set" if provider_config.get('api_key') else "✗ Not set"
        models = ", ".join(provider_config.get('models', [])[:3])
        if len(provider_config.get('models', [])) > 3:
            models += f" (+{len(provider_config.get('models', [])) - 3} more)"
        table.add_row(name, "Custom", models, api_key_status)
    
    console.print(table)


# Add missing commands from original CLI
@cli.command()
@click.argument('packages', nargs=-1, required=False)
@click.option('-g', '--global', 'global_install', is_flag=True, help='Install packages globally')
@click.option('--dev', is_flag=True, help='Install as dev dependency')
@click.option('--registry', help='Registry to install from')
def install(packages, global_install, dev, registry):
    """Install packages from registry."""
    from prompd.cli import install as _install_impl
    return _install_impl(packages, global_install, dev, registry)

@cli.command()
@click.argument('packages', nargs=-1, required=True)
@click.option('-g', '--global', 'global_uninstall', is_flag=True, help='Uninstall packages globally')
@click.option('--dev', is_flag=True, help='Remove from dev dependencies')
def uninstall(packages, global_uninstall, dev):
    """Uninstall packages."""
    from prompd.cli import uninstall as _uninstall_impl
    return _uninstall_impl(packages, global_uninstall, dev)

@cli.command()
@click.argument('package_file', type=click.Path(exists=True))
@click.option('--registry', help='Registry to publish to')
@click.option('--namespace', help='Namespace for the package')
@click.option('--dry-run', is_flag=True, help='Show what would be published without uploading')
def publish(package_file, registry, namespace, dry_run):
    """Publish package to registry."""
    from prompd.cli import publish as _publish_impl
    from pathlib import Path
    return _publish_impl(Path(package_file), registry, namespace, dry_run)

@cli.command()
@click.argument('package_name', required=True)
@click.option('--registry', help='Registry to query')
def versions(package_name, registry):
    """List available versions of a package."""
    from prompd.cli import versions as _versions_impl
    return _versions_impl(package_name, registry)

@cli.command("shell")
@click.option("--simple", is_flag=True, help="Use the simple REPL (no AI chat UI)")
def shell_command(simple):
    """Start the interactive Prompd shell (REPL). [AI features in BETA]"""
    from prompd.cli import shell_command as _shell_impl
    return _shell_impl(simple)

@cli.command("chat")
def chat_command():
    """Start the Prompd shell directly in chat mode. [BETA FEATURE]"""
    from prompd.cli import chat_command as _chat_impl
    return _chat_impl()

# Add MCP group
@click.group()
def mcp():
    """Model Context Protocol (MCP) utilities."""
    pass

@mcp.command('serve')
@click.argument('path', type=click.Path(exists=True))
@click.option('--host', default='0.0.0.0', help='Host to bind to')
@click.option('--port', default=3333, help='Port to bind to')
@click.option('--oauth-client-id', help='OAuth client ID')
@click.option('--auth-url', help='OAuth authorization URL')
@click.option('--token-url', help='OAuth token URL')
@click.option('--scopes', help='OAuth scopes')
def mcp_serve(path, host, port, oauth_client_id, auth_url, token_url, scopes):
    """Serve a .prmd or .pdflow over HTTP with simple MCP-style endpoints."""
    from prompd.cli import mcp_serve as _mcp_serve_impl
    from pathlib import Path
    return _mcp_serve_impl(Path(path), host, port, oauth_client_id, auth_url, token_url, scopes)

@mcp.command('dockerize')
@click.option('--dockerfile', default='Dockerfile.mcp', help='Dockerfile name')
@click.option('--compose', default='docker-compose.mcp.yml', help='Compose file name')
@click.option('--port', default=3333, help='Port for service')
def mcp_dockerize(dockerfile, compose, port):
    """Scaffold Docker + Compose files to serve a .prmd/.pdflow via MCP."""
    from prompd.cli import mcp_dockerize as _mcp_dockerize_impl
    return _mcp_dockerize_impl(dockerfile, compose, port)

cli.add_command(mcp)

# Add cache group
@click.group()
def cache():
    """Package cache management commands."""
    pass

@cache.command('list')
@click.option('--global-only', is_flag=True, help='Show only global cache')
@click.option('--local-only', is_flag=True, help='Show only local cache')
def list_cache(global_only, local_only):
    """List cached packages."""
    from prompd.cli import list_cache as _list_cache_impl
    return _list_cache_impl(global_only, local_only)

@cache.command('clean')
@click.option('--global', 'clean_global', is_flag=True, help='Clean global cache')
@click.option('--local', 'clean_local', is_flag=True, help='Clean local cache')
@click.option('--all', 'clean_all', is_flag=True, help='Clean both caches')
def clean_cache(clean_global, clean_local, clean_all):
    """Clean package cache."""
    from prompd.cli import clean_cache as _clean_cache_impl
    return _clean_cache_impl(clean_global, clean_local, clean_all)

cli.add_command(cache)

# Add dependency commands
@cli.command('deps')
@click.argument('package', required=False)
@click.option('--tree', is_flag=True, help='Show dependency tree')
def deps_command(package, tree):
    """Show dependency information for a package or project."""
    from prompd.cli import deps_command as _deps_impl
    return _deps_impl(package, tree)

@cli.command('deps-install')
@click.argument('package')
@click.option('--save', is_flag=True, help='Save to dependencies')
@click.option('--save-dev', is_flag=True, help='Save to dev dependencies')
@click.option('--target', help='Target directory')
@click.option('--parallel', is_flag=True, help='Install dependencies in parallel')
def deps_install(package, save, save_dev, target, parallel):
    """Install package with all dependencies."""
    from prompd.cli import install_dependencies as _deps_install_impl
    return _deps_install_impl(package, save, save_dev, target, parallel)

@cli.command('deps-update')
@click.option('--dry-run', is_flag=True, help='Show what would be updated')
@click.option('--latest', is_flag=True, help='Update to latest versions')
def deps_update(dry_run, latest):
    """Update project dependencies."""
    from prompd.cli import deps_update as _deps_update_impl
    return _deps_update_impl(dry_run, latest)

# Add namespace groups
@click.group(name='namespace')
def namespace():
    """Manage namespaces for organizations."""
    pass

@click.group(name='ns')
def ns():
    """Alias for namespace commands."""
    pass

cli.add_command(namespace)
cli.add_command(ns)

# Add the modular command groups
cli.add_command(provider)
cli.add_command(git_group)  # This will be registered as 'git'
cli.add_command(version)
cli.add_command(package)
cli.add_command(registry)


if __name__ == "__main__":
    cli()