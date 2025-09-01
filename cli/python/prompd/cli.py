"""Command-line interface for Prompd."""

import sys
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any, List

import click
from rich.console import Console
from rich.table import Table
from rich.syntax import Syntax
from rich.panel import Panel

from prompd.parser import PrompdParser
from prompd.validator import PrompDValidator
from prompd.executor import PrompDExecutor
from prompd.config import PrompDConfig
from prompd.exceptions import PrompDError, ValidationError, ParseError, ProviderError, ConfigurationError
from prompd.compiler import PrompdCompiler
from prompd.registry import RegistryClient, validate_pdpkg
from prompd import __version__ as PROMPD_VERSION

# Configure console with proper encoding handling for Windows
try:
    console = Console(file=sys.stdout, force_terminal=True, width=120)
except:
    # Fallback to basic console if Rich fails
    console = Console(file=sys.stdout, legacy_windows=True, width=120)


@click.group()
@click.version_option(version="0.3.0", prog_name="prompd")
def cli():
    """Prompd - CLI for structured prompt definitions."""
    pass


def _run_impl(ctx, file: Path, provider: Optional[str], model: Optional[str], param: tuple, param_file: tuple, 
              api_key: Optional[str], output: Optional[str], format: str, version: Optional[str], verbose: bool, show_usage: bool):
    import asyncio
    import tempfile

    try:
        # Handle version checkout if specified
        actual_file = file
        temp_file = None
        
        if version:
            # Create a temporary file with the specified version
            with tempfile.NamedTemporaryFile(mode='w', suffix='.prompd', delete=False, encoding='utf-8') as tmp:
                temp_file = Path(tmp.name)
                
                # Get the file content at that version
                if _is_valid_semver(version):
                    tag_name = f"{file.stem}-v{version}"
                    # Check if tag exists
                    tag_check = subprocess.run(
                        ["git", "tag", "-l", tag_name],
                        capture_output=True,
                        text=True
                    )
                    version_ref = tag_name if tag_check.stdout.strip() else version
                else:
                    version_ref = version
                
                # Convert Windows paths to forward slashes for git
                git_path = str(file).replace('\\', '/')
                result = subprocess.run(
                    ["git", "show", f"{version_ref}:{git_path}"],
                    capture_output=True,
                    text=True,
                    check=True
                )
                
                tmp.write(result.stdout)
                actual_file = temp_file
                
                if verbose:
                    console.print(f"[dim]Using version {version} of {file}[/dim]")
        
        # Parse meta alias flags of form --meta:{section} <value>
        # Any section name is accepted. We'll pass through as 'meta:{section}' for executor handling.
        metadata_overrides: Dict[str, str] = {}
        try:
            extra_args = list(ctx.args) if hasattr(ctx, 'args') else []
            i = 0
            while i < len(extra_args):
                token = extra_args[i]
                if isinstance(token, str) and token.startswith("--meta:"):
                    section = token.split(":", 1)[1]
                    # Grab the next arg as the value if present
                    if i + 1 < len(extra_args):
                        val = extra_args[i+1]
                        # Pass through as meta:{section} for executor to process dynamically
                        metadata_overrides[f"meta:{section}"] = str(val)
                        i += 2
                        continue
                i += 1
        except Exception:
            # Best-effort; ignore parsing errors
            pass

        # Create executor
        executor = PrompDExecutor()
        
        # Resolve defaults for provider/model when omitted
        try:
            cfg = PrompDConfig.load()
            # Provider defaulting
            if not provider:
                provider = cfg.default_provider
                if not provider:
                    # Pick first provider with an API key
                    for cand in ['openai', 'anthropic', 'ollama']:
                        if cand == 'ollama':
                            provider = cand
                            break
                        if cfg.get_api_key(cand):
                            provider = cand
                            break
                if verbose and provider:
                    console.print(f"[dim]Using default provider: {provider}[/dim]")
            # Model defaulting
            if not model:
                model = cfg.default_model
                if not model and provider:
                    # Provider-specific sensible defaults
                    if provider == 'openai':
                        model = 'gpt-4o'
                    elif provider == 'anthropic':
                        model = 'claude-3-haiku-20240307'
                    elif provider == 'ollama':
                        model = 'llama2'
                if verbose and model:
                    console.print(f"[dim]Using default model: {model}[/dim]")
        except Exception:
            pass

        # Convert parameters
        cli_params = list(param) if param else None
        param_files = [Path(p) for p in param_file] if param_file else None
        
        # Execute
        response = asyncio.run(executor.execute(
            prompd_file=actual_file,
            provider=provider,
            model=model,
            cli_params=cli_params,
            param_files=param_files,
            api_key=api_key,
            metadata_overrides=metadata_overrides if metadata_overrides else None
        ))
        
        # Clean up temp file if created
        if temp_file and temp_file.exists():
            temp_file.unlink()
        
        # Output result based on format
        if format == "json":
            import json
            result = {
                "response": response.content,
                "provider": provider,
                "model": model,
                "file": str(file)
            }
            if response.usage:
                result["usage"] = response.usage
            
            json_output = json.dumps(result, indent=2, ensure_ascii=False)
            
            if output:
                with open(output, "w", encoding="utf-8") as f:
                    f.write(json_output)
                try:
                    console.print(f"[green]OK[/green] JSON response written to {output}")
                except UnicodeEncodeError:
                    print(f"OK - JSON response written to {output}")
            else:
                print(json_output)
        else:
            # Text format (default)
            if output:
                with open(output, "w", encoding="utf-8") as f:
                    f.write(response.content)
                try:
                    console.print(f"[green]OK[/green] Response written to {output}")
                except UnicodeEncodeError:
                    print(f"OK - Response written to {output}")
            else:
                try:
                    console.print(Panel(
                        response.content, 
                        title=f"Response from {provider}/{model}",
                        border_style="green"
                    ))
                except UnicodeEncodeError:
                    # Fallback for Windows console encoding issues
                    print(f"\n--- Response from {provider}/{model} ---")
                    print(response.content)
                    print("-" * 50)
                
                if (verbose or show_usage) and response.usage:
                    try:
                        console.print(f"\n[dim]Usage: {response.usage}[/dim]")
                    except UnicodeEncodeError:
                        print(f"\nUsage: {response.usage}")
            
    except ConfigurationError as e:
        try:
            console.print(f"[red]Configuration Error:[/red] {e}")
        except UnicodeEncodeError:
            print(f"Configuration Error: {e}")
        sys.exit(1)
    except ProviderError as e:
        try:
            console.print(f"[red]Provider Error:[/red] {e}")
        except UnicodeEncodeError:
            print(f"Provider Error: {e}")
        sys.exit(1)
    except PrompDError as e:
        try:
            console.print(f"[red]Error:[/red] {e}")
        except UnicodeEncodeError:
            print(f"Error: {e}")
        sys.exit(1)
    except Exception as e:
        try:
            console.print(f"[red]Unexpected error:[/red] {e}")
            if verbose:
                import traceback
                console.print(traceback.format_exc())
        except UnicodeEncodeError:
            print(f"Unexpected error: {e}")
            if verbose:
                import traceback
                print(traceback.format_exc())
        sys.exit(1)






@cli.command(name="run", context_settings=dict(ignore_unknown_options=True))
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--provider", required=False, help="LLM provider (openai, anthropic, ollama). Defaults from config if omitted")
@click.option("--model", required=False, help="Model name. Defaults from config/provider if omitted")
@click.option("--param", "-p", multiple=True, help="Parameter in format key=value")
@click.option("--param-file", "-f", type=click.Path(exists=True, path_type=Path), 
              multiple=True, help="JSON parameter file")
@click.option("--api-key", help="API key override")
@click.option("--output", "-o", type=click.Path(), help="Output file path")
@click.option("--format", type=click.Choice(["text", "json"]), default="text", help="Output format")
@click.option("--version", help="Execute a specific version (e.g., '1.2.3', 'HEAD', commit hash)")
@click.option("--verbose", "-v", is_flag=True, help="Verbose output")
@click.option("--show-usage", is_flag=True, help="Show token usage statistics")
@click.pass_context
def run(ctx, file: Path, provider: Optional[str], model: Optional[str], param: tuple, param_file: tuple, 
        api_key: Optional[str], output: Optional[str], format: str, version: Optional[str], verbose: bool, show_usage: bool):
    """Run a .prompd file with an LLM provider (supports --meta:* flags)."""
    return _run_impl(ctx, file, provider, model, param, param_file, api_key, output, format, version, verbose, show_usage)
@cli.command()
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--verbose", "-v", is_flag=True, help="Show detailed validation results")
@click.option("--git", is_flag=True, help="Include git history consistency checks")
@click.option("--version-only", is_flag=True, help="Only validate version-related aspects")
def validate(file: Path, verbose: bool, git: bool, version_only: bool):
    """Validate a .prompd file syntax and structure."""
    try:
        validator = PrompDValidator()
        
        if version_only:
            # Only check version consistency
            issues = validator.validate_version_consistency(file, check_git=git)
        else:
            # Full validation
            issues = validator.validate_file(file)
            if git:
                # Add git consistency checks
                git_issues = validator.validate_version_consistency(file, check_git=True)
                issues.extend(git_issues)
        
        if not issues:
            console.print(f"[green]OK[/green] {file} is valid")
        else:
            # Group issues by level
            errors = [i for i in issues if i.get("level") == "error"]
            warnings = [i for i in issues if i.get("level") == "warning"]
            info = [i for i in issues if i.get("level") == "info"]
            
            if errors:
                console.print(f"[red]ERRORS[/red] ({len(errors)}):")
                for issue in errors:
                    console.print(f"  [red]-[/red] {issue['message']}")
            
            if warnings:
                console.print(f"[yellow]WARNINGS[/yellow] ({len(warnings)}):")
                for issue in warnings:
                    console.print(f"  [yellow]-[/yellow] {issue['message']}")
            
            if info and verbose:
                console.print(f"[blue]INFO[/blue] ({len(info)}):")
                for issue in info:
                    console.print(f"  [blue]-[/blue] {issue['message']}")
            
            sys.exit(1 if errors else 0)
            
    except Exception as e:
        console.print(f"[red]Error validating file:[/red] {e}")
        sys.exit(1)


@cli.command("list")
@click.option("--path", "-p", type=click.Path(exists=True, path_type=Path), 
              default=Path("."), help="Directory to search for .prompd files")
@click.option("--detailed", "-d", is_flag=True, help="Show detailed information")
def list_prompts(path: Path, detailed: bool):
    """List available .prompd files."""
    try:
        prompd_files = list(Path(path).glob("**/*.prompd"))
        
        if not prompd_files:
            console.print(f"No .prompd files found in {path}")
            return
        
        if detailed:
            for prompd_file in prompd_files:
                try:
                    parser = PrompdParser()
                    prompd = parser.parse_file(prompd_file)
                    metadata = prompd.metadata
                    
                    console.print(Panel(
                        f"[bold]{metadata.name or prompd_file.stem}[/bold]\n"
                        f"[dim]File:[/dim] {prompd_file}\n"
                        f"[dim]Description:[/dim] {metadata.description or 'No description'}\n"
                        f"[dim]Version:[/dim] {metadata.version or 'N/A'}\n"
                        f"[dim]Variables:[/dim] {', '.join(p.name for p in metadata.parameters)}",
                        border_style="blue"
                    ))
                except Exception as e:
                    console.print(f"[red]Error reading {prompd_file}:[/red] {e}")
        else:
            table = Table(title=f"Prompd Files in {path}")
            table.add_column("Name", style="cyan")
            table.add_column("File", style="green")
            table.add_column("Description")
            
            for prompd_file in prompd_files:
                try:
                    parser = PrompdParser()
                    prompd = parser.parse_file(prompd_file)
                    metadata = prompd.metadata
                    table.add_row(
                        metadata.name or prompd_file.stem,
                        str(prompd_file),
                        (metadata.description or "")[:60] + "..."
                        if len(metadata.description or "") > 60 else (metadata.description or "")
                    )
                except Exception:
                    table.add_row(prompd_file.stem, str(prompd_file), "[red]Error reading file[/red]")
            
            console.print(table)
            
    except Exception as e:
        console.print(f"[red]Error listing files:[/red] {e}")
        sys.exit(1)


@cli.group()
def mcp():
    """Model Context Protocol (MCP) utilities."""
    pass


@mcp.command("serve")
@click.argument("path", type=click.Path(exists=True, path_type=Path))
@click.option("--host", default="0.0.0.0", help="Bind host", show_default=True)
@click.option("--port", type=int, default=3333, help="Bind port", show_default=True)
@click.option("--oauth-client-id", default=None, help="OAuth client id")
@click.option("--auth-url", default=None, help="OAuth authorization URL")
@click.option("--token-url", default=None, help="OAuth token URL")
@click.option("--scopes", default=None, help="OAuth scopes (comma separated)")
def mcp_serve(path: Path, host: str, port: int, oauth_client_id: str, auth_url: str, token_url: str, scopes: str):
    """Serve a .prompd or .pdflow over HTTP with simple MCP-style endpoints."""
    try:
        try:
            from prompd.mcp_server import serve_app
        except Exception as imp_err:
            console.print("[red]FastAPI/uvicorn not installed.[/red] Install with: [cyan]pip install fastapi uvicorn[/cyan]")
            console.print(f"[dim]{imp_err}[/dim]")
            sys.exit(1)

        scope_list = [s.strip() for s in scopes.split(',')] if scopes else None
        serve_app(
            file_path=path,
            host=host,
            port=port,
            oauth={
                'client_id': oauth_client_id,
                'auth_url': auth_url,
                'token_url': token_url,
                'scopes': scope_list
            }
        )
    except Exception as e:
        console.print(f"[red]Failed to start MCP server:[/red] {e}")
        sys.exit(1)


@mcp.command("dockerize")
@click.option("--dockerfile", default="Dockerfile.prompd-mcp", help="Output Dockerfile name", show_default=True)
@click.option("--compose", default="docker-compose.prompd-mcp.yml", help="Output docker-compose file name", show_default=True)
@click.option("--port", type=int, default=3333, help="Container port to expose", show_default=True)
def mcp_dockerize(dockerfile: str, compose: str, port: int):
    """Scaffold Docker + Compose files to serve a .prompd/.pdflow via MCP."""
    try:
        from textwrap import dedent
        dockerfile_content = dedent(f"""
        # Prompd MCP server image
        FROM python:3.11-slim
        WORKDIR /app
        # Install Prompd with MCP extras from PyPI (requires published package)
        RUN pip install --no-cache-dir "prompd[mcp]"
        # Default env; override at runtime
        ENV PROMPD_DEFAULT_PROVIDER=openai \\
            PROMPD_DEFAULT_MODEL=gpt-3.5-turbo
        EXPOSE {port}
        # Serve any mounted file under /data; override the path with docker run args or compose command
        CMD ["prompd", "mcp", "serve", "/data/prompt.prompd", "--host", "0.0.0.0", "--port", "{port}"]
        """)

        compose_content = dedent(f"""
        version: "3.9"
        services:
          prompd-mcp:
            build:
              context: .
              dockerfile: {dockerfile}
            environment:
              - OPENAI_API_KEY=${{OPENAI_API_KEY}}
              - ANTHROPIC_API_KEY=${{ANTHROPIC_API_KEY}}
              - PROMPD_DEFAULT_PROVIDER=${{PROMPD_DEFAULT_PROVIDER:-openai}}
              - PROMPD_DEFAULT_MODEL=${{PROMPD_DEFAULT_MODEL:-gpt-3.5-turbo}}
            volumes:
              - ./prompds:/data
            ports:
              - "{port}:{port}"
            # Example override: serve a different file
            # command: ["prompd", "mcp", "serve", "/data/workflow.pdflow", "--host", "0.0.0.0", "--port", "{port}"]
        """)

        Path(dockerfile).write_text(dockerfile_content, encoding="utf-8")
        Path(compose).write_text(compose_content, encoding="utf-8")
        console.print(f"[green]OK[/green] Wrote {dockerfile} and {compose}")
        console.print("Build + run:")
        console.print(f"  [dim]docker build -f {dockerfile} -t prompd-mcp .[/dim]")
        console.print(f"  [dim]docker run -p {port}:{port} -v $PWD/prompds:/data -e OPENAI_API_KEY=sk-... prompd-mcp[/dim]")
        console.print("Or via compose:")
        console.print(f"  [dim]docker compose -f {compose} up --build[/dim]")
    except Exception as e:
        console.print(f"[red]Failed to scaffold Docker files:[/red] {e}")
        sys.exit(1)

@cli.command("shell")
@click.option("--simple", is_flag=True, help="Use the simple REPL (no AI chat UI)")
def shell_command(simple: bool):
    """Start the interactive Prompd shell (REPL)."""
    try:
        if simple:
            from prompd.interactive_simple import SimplePrompdREPL
            SimplePrompdREPL().start()
        else:
            from prompd.shell import PrompdShell
            PrompdShell().start()
    except Exception as e:
        try:
            console.print(f"[red]Error launching shell:[/red] {e}")
        except Exception:
            print(f"Error launching shell: {e}")
        sys.exit(1)


@cli.command("chat")
def chat_command():
    """Start the Prompd shell directly in chat mode."""
    try:
        from prompd.shell import PrompdShell
        sh = PrompdShell()
        sh.enter_chat_mode()
        sh.start()
    except Exception as e:
        try:
            console.print(f"[red]Error launching chat:[/red] {e}")
        except Exception:
            print(f"Error launching chat: {e}")
        sys.exit(1)

@cli.command("compile", context_settings=dict(ignore_unknown_options=True, allow_extra_args=True))
@click.argument("source", type=str)
@click.option("--to", "output_format", default="markdown", help="Output format (markdown | provider-json [openai|anthropic] | provider-json:openai)")
@click.option("--to-markdown", is_flag=True, help="Shorthand for --to markdown")
@click.option("--to-provider-json", type=click.Choice(["openai", "anthropic"]), help="Shorthand for --to provider-json <provider>")
@click.option("-p", "--param", multiple=True, help="Parameter in format key=value (repeat for multiple)")
@click.option("--params-file", type=click.Path(exists=True, path_type=Path), multiple=True, help="Load parameters from JSON file (repeatable)")
@click.option("-o", "--output", type=click.Path(), help="Write compiled output to file")
@click.option("-v", "--verbose", is_flag=True, help="Verbose output")
@click.pass_context
def compile_command(ctx, source: str, output_format: str, to_markdown: bool, to_provider_json: Optional[str], param: tuple, params_file: tuple, output: Optional[str], verbose: bool):
    """Compile a .prompd file or package reference to a target format.
    
    Supports package references like:
    - @namespace/package@version/path/to/file.prompd
    - @prompd.io/security@1.0.0/prompts/audit.prompd
    - package@version/file.prompd
    """
    try:
        # Check if source is a package reference with path
        source_path = Path(source)
        
        # Pattern to detect package references: @namespace/package@version/path or package@version/path
        package_pattern = r'^(@[\w.-]+/[\w.-]+|[\w.-]+)@([\w.-]+)/(.+\.prompd)$'
        import re
        match = re.match(package_pattern, source)
        
        if match:
            # This is a package reference with file path
            package_ref = f"{match.group(1)}@{match.group(2)}"
            file_path_in_package = match.group(3)
            
            if verbose:
                console.print(f"[cyan]Resolving package:[/cyan] {package_ref}")
                console.print(f"[cyan]File path:[/cyan] {file_path_in_package}")
            
            # Resolve the package
            from .package_resolver import PackageResolver
            resolver = PackageResolver()
            
            try:
                # Resolve package to local path
                package_path = resolver.resolve_package(package_ref)
                
                # Construct full file path
                source_path = package_path / file_path_in_package
                
                if not source_path.exists():
                    console.print(f"[red]File not found in package:[/red] {file_path_in_package}")
                    console.print(f"[yellow]Package location:[/yellow] {package_path}")
                    sys.exit(1)
                
                if verbose:
                    console.print(f"[green]Resolved to:[/green] {source_path}")
                
            except Exception as e:
                console.print(f"[red]Failed to resolve package:[/red] {e}")
                sys.exit(1)
        elif not source_path.exists():
            # Try as a direct package reference without file path
            if '@' in source and '/' not in source.split('@')[-1]:
                # Might be just a package reference, try to resolve it
                from .package_resolver import PackageResolver
                resolver = PackageResolver()
                
                try:
                    package_path = resolver.resolve_package(source)
                    # Look for main file in manifest
                    manifest_file = package_path / 'manifest.json'
                    if manifest_file.exists():
                        import json
                        with open(manifest_file) as f:
                            manifest = json.load(f)
                        main_file = manifest.get('main')
                        if main_file:
                            source_path = package_path / main_file
                            if verbose:
                                console.print(f"[green]Using main file:[/green] {main_file}")
                except:
                    pass
            
            if not source_path.exists():
                console.print(f"[red]File not found:[/red] {source}")
                sys.exit(1)
        
        # Merge parameters from files and CLI
        parameters: Dict[str, Any] = {}
        if params_file:
            import json
            for pf in params_file:
                try:
                    data = json.loads(Path(pf).read_text(encoding='utf-8'))
                    if isinstance(data, dict):
                        parameters.update(data)
                except Exception as e:
                    console.print(f"[red]Error loading params file {pf}:[/red] {e}")
                    sys.exit(1)

        if param:
            for kv in param:
                if '=' not in kv:
                    console.print(f"[red]Invalid parameter:[/red] {kv}. Use key=value")
                    sys.exit(1)
                k, v = kv.split('=', 1)
                parameters[k] = v

        # Resolve requested output format, supporting legacy + shorthand forms
        if to_markdown:
            output_format = "markdown"
        elif to_provider_json:
            output_format = f"provider-json:{to_provider_json}"
        else:
            # Accept space-separated option after provider-json, e.g. "--to provider-json openai"
            try:
                extra = list(getattr(ctx, 'args', []) or [])
            except Exception:
                extra = []
            if output_format.strip().lower() == "provider-json" and extra:
                next_tok = extra[0]
                if next_tok and not next_tok.startswith('-'):
                    output_format = f"provider-json:{next_tok}"
                    # consume the token to avoid confusing other parsing
                    try:
                        ctx.args = extra[1:]
                    except Exception:
                        pass

        if verbose:
            try:
                console.print(f"[dim]Compiling {source} → {output_format} with params: {list(parameters.keys())}[/dim]")
            except Exception:
                pass

        compiler = PrompdCompiler()
        result = compiler.compile(
            source=source,
            output_format=output_format,
            parameters=parameters,
            output_file=Path(output) if output else None
        )

        if output:
            try:
                console.print(f"[green]OK[/green] Compiled output written to {output}")
            except Exception:
                print(f"OK - Compiled output written to {output}")
        else:
            print(result)

    except Exception as e:
        try:
            console.print(f"[red]Error compiling:[/red] {e}")
        except Exception:
            print(f"Error compiling: {e}")
        sys.exit(1)

@cli.group()
def provider():
    """Manage LLM providers."""
    pass


@provider.command("list")
def list_providers():
    """List available LLM providers and their models."""
    try:
        config = PrompDConfig.load()
        executor = PrompDExecutor()
        available_providers = executor.get_available_providers()
        
        if not available_providers:
            console.print("[yellow]No providers available[/yellow]")
            return
        
        for provider_name in available_providers:
            models = executor.get_provider_models(provider_name)
            
            # Check if it's a custom provider
            is_custom = provider_name in config.custom_providers
            provider_type = "Custom" if is_custom else "Built-in"
            
            console.print(Panel(
                f"[bold]{provider_name}[/bold] ({provider_type})\n"
                f"Models: {', '.join(models[:5])}"
                f"{' ...' if len(models) > 5 else ''}",
                title="Provider",
                border_style="green" if is_custom else "blue"
            ))
            
    except Exception as e:
        console.print(f"[red]Error listing providers:[/red] {e}")
        sys.exit(1)


@provider.command("add")
@click.argument("name")
@click.argument("base_url")
@click.argument("models", nargs=-1, required=True)
@click.option("--api-key", help="API key for the provider")
@click.option("--type", "provider_type", default="openai-compatible", 
              type=click.Choice(["openai-compatible"]), help="Provider type")
def add_provider(name: str, base_url: str, models: tuple, api_key: Optional[str], provider_type: str):
    """Add a custom LLM provider.
    
    NAME: Provider name (e.g., 'local-ollama')
    BASE_URL: API endpoint URL (e.g., 'http://localhost:11434/v1')
    MODELS: Space-separated list of model names
    """
    try:
        config = PrompDConfig.load()
        
        # Check if provider already exists
        if name in config.custom_providers:
            console.print(f"[yellow]Provider '{name}' already exists. Use 'prompd provider remove {name}' first.[/yellow]")
            return
        
        # Add the provider
        config.add_custom_provider(
            name=name,
            base_url=base_url,
            models=list(models),
            api_key=api_key,
            provider_type=provider_type
        )
        
        # Save config
        config.save()
        
        console.print(f"[green]OK[/green] Added custom provider '{name}'")
        console.print(f"  Base URL: {base_url}")
        console.print(f"  Models: {', '.join(models)}")
        if api_key:
            console.print(f"  API Key: {'*' * (len(api_key) - 4)}{api_key[-4:]}")
        
    except Exception as e:
        console.print(f"[red]Error adding provider:[/red] {e}")
        sys.exit(1)


@provider.command("remove")
@click.argument("name")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation")
def remove_provider(name: str, yes: bool):
    """Remove a custom LLM provider."""
    try:
        config = PrompDConfig.load()
        
        if name not in config.custom_providers:
            console.print(f"[red]Provider '{name}' not found[/red]")
            sys.exit(1)
        
        if not yes:
            provider_info = config.custom_providers[name]
            console.print(f"About to remove provider: [bold]{name}[/bold]")
            console.print(f"  Base URL: {provider_info.get('base_url')}")
            console.print(f"  Models: {', '.join(provider_info.get('models', []))}")
            
            if not click.confirm("Are you sure?"):
                console.print("Cancelled.")
                return
        
        # Remove the provider
        config.remove_custom_provider(name)
        config.save()
        
        console.print(f"[green]OK[/green] Removed provider '{name}'")
        
    except Exception as e:
        console.print(f"[red]Error removing provider:[/red] {e}")
        sys.exit(1)


@provider.command("show")
@click.argument("name")
def show_provider(name: str):
    """Show details for a specific provider."""
    try:
        config = PrompDConfig.load()
        executor = PrompDExecutor()
        
        # Check if it's a custom provider
        if name in config.custom_providers:
            provider_info = config.custom_providers[name]
            console.print(Panel(
                f"[bold cyan]{name}[/bold cyan] (Custom Provider)\n\n"
                f"[bold]Base URL:[/bold] {provider_info['base_url']}\n"
                f"[bold]Type:[/bold] {provider_info.get('type', 'openai-compatible')}\n"
                f"[bold]Enabled:[/bold] {provider_info.get('enabled', True)}\n"
                f"[bold]API Key:[/bold] {'Set' if provider_info.get('api_key') else 'Not set'}\n\n"
                f"[bold]Models:[/bold]\n" + 
                '\n'.join(f"  • {model}" for model in provider_info.get('models', [])),
                border_style="green"
            ))
        else:
            # Check if it's a built-in provider
            available_providers = executor.get_available_providers()
            if name not in available_providers:
                console.print(f"[red]Provider '{name}' not found[/red]")
                sys.exit(1)
            
            models = executor.get_provider_models(name)
            has_api_key = bool(config.get_api_key(name))
            
            console.print(Panel(
                f"[bold cyan]{name}[/bold cyan] (Built-in Provider)\n\n"
                f"[bold]API Key:[/bold] {'Set' if has_api_key else 'Not set'}\n\n"
                f"[bold]Models:[/bold]\n" + 
                '\n'.join(f"  • {model}" for model in models[:10]) +
                (f"\n  ... and {len(models) - 10} more" if len(models) > 10 else ""),
                border_style="blue"
            ))
        
    except Exception as e:
        console.print(f"[red]Error showing provider:[/red] {e}")
        sys.exit(1)


@provider.command("setkey")
@click.argument("provider_name")
@click.argument("api_key")
def set_api_key(provider_name: str, api_key: str):
    """Set API key for a provider."""
    try:
        config = PrompDConfig.load()
        
        # Set the API key
        if not hasattr(config, 'api_keys') or config.api_keys is None:
            config.api_keys = {}
        
        config.api_keys[provider_name] = api_key
        config.save()
        
        console.print(f"[green]✓[/green] API key set for {provider_name}")
        
    except Exception as e:
        console.print(f"[red]Error setting API key:[/red] {e}")
        sys.exit(1)


@provider.command("removekey")
@click.argument("provider_name")
def remove_api_key(provider_name: str):
    """Remove API key for a provider."""
    try:
        config = PrompDConfig.load()
        
        if hasattr(config, 'api_keys') and config.api_keys and provider_name in config.api_keys:
            del config.api_keys[provider_name]
            config.save()
            console.print(f"[green]✓[/green] API key removed for {provider_name}")
        else:
            console.print(f"[yellow]No API key configured for {provider_name}[/yellow]")
        
    except Exception as e:
        console.print(f"[red]Error removing API key:[/red] {e}")
        sys.exit(1)


# Keep the old providers command for backward compatibility
@cli.command()
def providers():
    """List available LLM providers and their models."""
    console.print("[dim]Note: Use 'prompd provider list' for more detailed view[/dim]\n")
    
    # Call the new command
    from click.testing import CliRunner
    runner = CliRunner()
    runner.invoke(list_providers)


@cli.command()
@click.argument("file", type=click.Path(exists=True, path_type=Path))
def show(file: Path):
    """Show the structure and parameters of a .prompd file."""
    try:
        parser = PrompdParser()
        prompd = parser.parse_file(file)
        metadata = prompd.metadata
        
        console.print(Panel(f"[bold cyan]{metadata.name}[/bold cyan]", 
                           subtitle=f"Version: {metadata.version or 'N/A'}"))
        
        if metadata.description:
            console.print(f"\n[bold]Description:[/bold] {metadata.description}\n")
        
        if metadata.parameters:
            table = Table(title="Parameters")
            table.add_column("Name", style="cyan")
            table.add_column("Type", style="green")
            table.add_column("Required", style="yellow")
            table.add_column("Default")
            table.add_column("Description")
            
            for param in metadata.parameters:
                table.add_row(
                    param.name,
                    param.type.value,
                    "Yes" if param.required else "No",
                    str(param.default or "")[:20],
                    param.description[:40] if param.description else ""
                )
            console.print(table)
        
        # Show content structure
        content_info = []
        if metadata.system:
            content_info.append(f"System: {metadata.system}")
        if metadata.context:
            content_info.append(f"Context: {metadata.context}")
        if metadata.user:
            content_info.append(f"User: {metadata.user}")
        if metadata.response:
            content_info.append(f"Response: {metadata.response}")
        
        if content_info:
            console.print(f"\n[bold]Content Structure:[/bold]")
            for info in content_info:
                console.print(f"  • {info}")
        
        # Show sections found in file
        if prompd.sections:
            console.print(f"\n[bold]Available Sections:[/bold]")
            for section_name in prompd.sections:
                console.print(f"  • #{section_name}")
        
        if metadata.requires:
            console.print(f"\n[bold]Requirements:[/bold] {', '.join(metadata.requires)}")
            
    except Exception as e:
        console.print(f"[red]Error reading file:[/red] {e}")
        sys.exit(1)


@cli.group()
def git():
    """Git operations for .prompd files."""
    pass


@git.command("add")
@click.argument("files", nargs=-1, required=True, type=click.Path(exists=True, path_type=Path))
@click.option("--verbose", "-v", is_flag=True, help="Show git output")
def git_add(files: tuple, verbose: bool):
    """Add .prompd files to git staging area."""
    try:
        for file_path in files:
            file_path = Path(file_path)
            if not file_path.suffix == ".prompd":
                console.print(f"[yellow]Skipping non-.prompd file:[/yellow] {file_path}")
                continue
            
            result = subprocess.run(
                ["git", "add", str(file_path)], 
                capture_output=True, 
                text=True, 
                check=True
            )
            
            console.print(f"[green]OK[/green] Added {file_path}")
            if verbose and result.stdout:
                console.print(f"[dim]{result.stdout}[/dim]")
                
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Error adding files:[/red] {e.stderr}")
        sys.exit(1)


@git.command("remove")
@click.argument("files", nargs=-1, required=True, type=click.Path(exists=True, path_type=Path))
@click.option("--cached", is_flag=True, help="Only remove from index, keep in working directory")
@click.option("--verbose", "-v", is_flag=True, help="Show git output")
def git_remove(files: tuple, cached: bool, verbose: bool):
    """Remove .prompd files from git tracking."""
    try:
        for file_path in files:
            file_path = Path(file_path)
            if not file_path.suffix == ".prompd":
                console.print(f"[yellow]Skipping non-.prompd file:[/yellow] {file_path}")
                continue
            
            cmd = ["git", "rm"]
            if cached:
                cmd.append("--cached")
            cmd.append(str(file_path))
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True
            )
            
            action = "Removed from index" if cached else "Removed"
            console.print(f"[green]OK[/green] {action}: {file_path}")
            if verbose and result.stdout:
                console.print(f"[dim]{result.stdout}[/dim]")
                
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Error removing files:[/red] {e.stderr}")
        sys.exit(1)


@git.command("status")
@click.option("--path", "-p", type=click.Path(exists=True, path_type=Path), 
              help="Check status for specific path")
def git_status(path: Optional[Path]):
    """Show git status for .prompd files."""
    try:
        cmd = ["git", "status", "--short"]
        if path:
            cmd.append(str(path))
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True
        )
        
        if not result.stdout:
            console.print("[green]No changes to .prompd files[/green]")
            return
        
        # Filter for .prompd files
        prompd_changes = []
        for line in result.stdout.strip().split('\n'):
            if '.prompd' in line:
                prompd_changes.append(line)
        
        if prompd_changes:
            console.print("[bold]Git status for .prompd files:[/bold]")
            for change in prompd_changes:
                status_code = change[:2]
                file_path = change[3:]
                
                # Color code based on status
                if 'M' in status_code:
                    status_color = "yellow"
                    status_text = "Modified"
                elif 'A' in status_code:
                    status_color = "green"
                    status_text = "Added"
                elif 'D' in status_code:
                    status_color = "red"
                    status_text = "Deleted"
                elif '?' in status_code:
                    status_color = "blue"
                    status_text = "Untracked"
                else:
                    status_color = "white"
                    status_text = status_code
                
                console.print(f"  [{status_color}]{status_text:10}[/{status_color}] {file_path}")
        else:
            console.print("[dim]No .prompd file changes[/dim]")
            
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Error checking status:[/red] {e.stderr}")
        sys.exit(1)


@git.command("commit")
@click.option("--message", "-m", required=True, help="Commit message")
@click.option("--all", "-a", is_flag=True, help="Automatically stage all modified .prompd files")
def git_commit(message: str, all: bool):
    """Commit staged .prompd files."""
    try:
        if all:
            # First add all modified .prompd files
            result = subprocess.run(
                ["git", "status", "--porcelain"],
                capture_output=True,
                text=True,
                check=True
            )
            
            for line in result.stdout.strip().split('\n'):
                if line and '.prompd' in line and line[0] == ' ' and line[1] == 'M':
                    file_path = line[3:]
                    subprocess.run(["git", "add", file_path], check=True)
                    console.print(f"[dim]Auto-staging: {file_path}[/dim]")
        
        # Commit
        result = subprocess.run(
            ["git", "commit", "-m", message],
            capture_output=True,
            text=True,
            check=True
        )
        
        console.print(f"[green]OK[/green] Committed changes")
        if result.stdout:
            # Extract commit hash and stats
            lines = result.stdout.strip().split('\n')
            for line in lines:
                if 'file' in line and 'changed' in line:
                    console.print(f"[dim]{line}[/dim]")
                    
    except subprocess.CalledProcessError as e:
        if "nothing to commit" in e.stdout:
            console.print("[yellow]Nothing to commit[/yellow]")
        else:
            console.print(f"[red]Error committing:[/red] {e.stderr}")
        sys.exit(1)


@git.command("checkout")
@click.argument("file", type=click.Path(path_type=Path))
@click.argument("version")
@click.option("--output", "-o", type=click.Path(), help="Output to different file instead of overwriting")
def git_checkout(file: Path, version: str, output: Optional[str]):
    """Checkout a specific version of a .prompd file.
    
    VERSION can be:
    - A semantic version (e.g., '1.2.3')
    - A git tag name
    - A commit hash
    - 'HEAD' for latest committed version
    - 'HEAD~1' for previous commit, etc.
    """
    try:
        file = Path(file)
        if not file.suffix == ".prompd":
            console.print(f"[red]Error:[/red] {file} is not a .prompd file")
            sys.exit(1)
        
        # Try to resolve as semantic version tag first
        if _is_valid_semver(version):
            tag_name = f"{file.stem}-v{version}"
            # Check if tag exists
            tag_check = subprocess.run(
                ["git", "tag", "-l", tag_name],
                capture_output=True,
                text=True
            )
            if tag_check.stdout.strip():
                version_ref = tag_name
            else:
                version_ref = version
        else:
            version_ref = version
        
        # Get the file content at that version
        # Convert Windows paths to forward slashes for git
        git_path = str(file).replace('\\', '/')
        result = subprocess.run(
            ["git", "show", f"{version_ref}:{git_path}"],
            capture_output=True,
            text=True,
            check=True
        )
        
        if output:
            # Write to specified output file
            output_path = Path(output)
            output_path.write_text(result.stdout, encoding='utf-8')
            console.print(f"[green]OK[/green] Checked out {file} @ {version} to {output_path}")
        else:
            # Overwrite current file
            file.write_text(result.stdout, encoding='utf-8')
            console.print(f"[green]OK[/green] Checked out {file} @ {version}")
            console.print("[yellow]Note:[/yellow] Working directory has been modified. Use 'git diff' to see changes.")
            
    except subprocess.CalledProcessError as e:
        if "does not exist" in e.stderr:
            console.print(f"[red]Error:[/red] Version '{version}' not found for {file}")
            console.print("[dim]Try 'prompd version history' to see available versions[/dim]")
        else:
            console.print(f"[red]Error checking out version:[/red] {e.stderr}")
        sys.exit(1)


@cli.group()
def version():
    """Version management commands."""
    pass


@version.command("bump")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.argument("bump_type", type=click.Choice(["major", "minor", "patch"]))
@click.option("--message", "-m", help="Commit message")
@click.option("--dry-run", is_flag=True, help="Show what would be done without making changes")
def version_bump(file: Path, bump_type: str, message: Optional[str], dry_run: bool):
    """Bump version in a .prompd file and create git tag."""
    try:
        parser = PrompdParser()
        prompd = parser.parse_file(file)
        
        current_version = prompd.metadata.version or "0.0.0"
        new_version = _bump_version(current_version, bump_type)
        
        if dry_run:
            console.print(f"[dim]Would bump {file} from {current_version} to {new_version}[/dim]")
            return
        
        # Update version in file
        _update_version_in_file(file, new_version)
        
        # Git operations
        commit_msg = message or f"Bump {file.name} to {new_version}"
        _git_commit_and_tag(file, new_version, commit_msg)
        
        console.print(f"[green]OK[/green] Bumped {file.name} from {current_version} to {new_version}")
        
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


@version.command("history")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--limit", "-n", type=int, default=10, help="Number of versions to show")
def version_history(file: Path, limit: int):
    """Show version history for a .prompd file."""
    try:
        tags = _get_git_tags(file, limit)
        
        if not tags:
            console.print(f"[yellow]No version tags found for {file}[/yellow]")
            return
        
        table = Table(title=f"Version History for {file}")
        table.add_column("Version", style="cyan")
        table.add_column("Date", style="green")
        table.add_column("Commit", style="yellow")
        table.add_column("Message")
        
        for tag_info in tags:
            table.add_row(
                tag_info["tag"],
                tag_info["date"],
                tag_info["commit"][:8],
                tag_info["message"][:60]
            )
        
        console.print(table)
        
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


@version.command("diff")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.argument("version1")
@click.argument("version2", required=False)
def version_diff(file: Path, version1: str, version2: Optional[str]):
    """Show differences between versions of a .prompd file."""
    try:
        version2 = version2 or "HEAD"
        diff_output = _git_diff_versions(file, version1, version2)
        
        if not diff_output:
            console.print(f"[green]No differences between {version1} and {version2}[/green]")
            return
        
        syntax = Syntax(diff_output, "diff", theme="monokai", line_numbers=True)
        console.print(Panel(syntax, title=f"Diff: {version1} → {version2}"))
        
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


@version.command("validate")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--git", is_flag=True, help="Validate against git history")
def version_validate(file: Path, git: bool):
    """Validate version consistency."""
    try:
        parser = PrompdParser()
        prompd = parser.parse_file(file)
        
        current_version = prompd.metadata.version
        if not current_version:
            console.print(f"[yellow]WARNING[/yellow] No version specified in {file}")
            return
        
        # Validate semantic version format
        if not _is_valid_semver(current_version):
            console.print(f"[red]ERROR[/red] Invalid semantic version: {current_version}")
            sys.exit(1)
        
        if git:
            # Check if version matches latest git tag
            latest_tag = _get_latest_git_tag(file)
            if latest_tag and latest_tag != current_version:
                console.print(f"[yellow]WARNING[/yellow] Version mismatch:")
                console.print(f"  File version: {current_version}")
                console.print(f"  Latest git tag: {latest_tag}")
        
        console.print(f"[green]OK[/green] Version {current_version} is valid")
        
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


@version.command("suggest")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--changes", help="Description of changes made")
def version_suggest(file: Path, changes: Optional[str]):
    """Suggest appropriate version bump based on changes."""
    try:
        parser = PrompdParser()
        validator = PrompDValidator()
        prompd = parser.parse_file(file)
        
        current_version = prompd.metadata.version or "0.0.0"
        suggestion = validator.suggest_version_bump(current_version, changes or "")
        
        console.print(Panel(
            f"[bold cyan]Current Version:[/bold cyan] {suggestion['suggestions']['current']}\\n\\n"
            f"[bold green]Suggested Bump:[/bold green] {suggestion['recommended']} -> "
            f"{suggestion['suggestions'][suggestion['recommended']]}\\n\\n"
            f"[bold]All Options:[/bold]\\n"
            f"  - Patch: {suggestion['suggestions']['patch']} (bug fixes)\\n"
            f"  - Minor: {suggestion['suggestions']['minor']} (new features)\\n"
            f"  - Major: {suggestion['suggestions']['major']} (breaking changes)\\n\\n"
            f"[dim]{suggestion['reason']}[/dim]",
            title="Version Bump Suggestions"
        ))
        
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


def _bump_version(version: str, bump_type: str) -> str:
    """Bump semantic version."""
    parts = version.split(".")
    if len(parts) != 3:
        raise ValueError(f"Invalid semantic version: {version}")
    
    major, minor, patch = map(int, parts)
    
    if bump_type == "major":
        major += 1
        minor = 0
        patch = 0
    elif bump_type == "minor":
        minor += 1
        patch = 0
    elif bump_type == "patch":
        patch += 1
    
    return f"{major}.{minor}.{patch}"


def _is_valid_semver(version: str) -> bool:
    """Check if version follows semantic versioning."""
    import re
    pattern = r"^(\d+)\.(\d+)\.(\d+)$"
    return bool(re.match(pattern, version))


def _update_version_in_file(file_path: Path, new_version: str):
    """Update version field in .prompd file."""
    content = file_path.read_text(encoding='utf-8')
    
    # Parse YAML frontmatter
    import re
    if content.startswith('---\n'):
        # Find the end of frontmatter
        end_match = re.search(r'\n---\n', content[4:])
        if end_match:
            yaml_end = end_match.end() + 4
            frontmatter = content[4:yaml_end-5]  # Remove --- delimiters
            markdown_content = content[yaml_end:]
            
            # Update version in frontmatter
            import yaml
            metadata = yaml.safe_load(frontmatter) or {}
            metadata['version'] = new_version
            
            # Write back
            updated_content = f"---\n{yaml.dump(metadata, default_flow_style=False)}---\n{markdown_content}"
            file_path.write_text(updated_content, encoding='utf-8')


def _git_commit_and_tag(file_path: Path, version: str, message: str):
    """Create git commit and tag."""
    try:
        # Add file to git
        subprocess.run(["git", "add", str(file_path)], check=True, capture_output=True)
        
        # Commit
        subprocess.run(["git", "commit", "-m", message], check=True, capture_output=True)
        
        # Create tag
        tag_name = f"{file_path.stem}-v{version}"
        subprocess.run(["git", "tag", tag_name], check=True, capture_output=True)
        
    except subprocess.CalledProcessError as e:
        raise Exception(f"Git operation failed: {e.stderr.decode()}")


def _get_git_tags(file_path: Path, limit: int) -> List[Dict[str, str]]:
    """Get git tags related to a file."""
    try:
        # Get tags with commit info
        result = subprocess.run([
            "git", "log", "--tags", "--simplify-by-decoration", "--pretty=format:%d|%H|%ai|%s",
            "-n", str(limit), "--", str(file_path)
        ], capture_output=True, text=True, check=True)
        
        tags = []
        for line in result.stdout.split('\n'):
            if line.strip():
                parts = line.split('|', 3)
                if len(parts) == 4 and 'tag:' in parts[0]:
                    # Extract tag name
                    import re
                    tag_match = re.search(r'tag: ([^,)]+)', parts[0])
                    if tag_match:
                        tags.append({
                            'tag': tag_match.group(1).strip(),
                            'commit': parts[1],
                            'date': parts[2][:10],  # Just the date part
                            'message': parts[3]
                        })
        
        return tags
        
    except subprocess.CalledProcessError:
        return []


def _get_latest_git_tag(file_path: Path) -> Optional[str]:
    """Get latest git tag for a file."""
    tags = _get_git_tags(file_path, 1)
    return tags[0]['tag'] if tags else None


def _git_diff_versions(file_path: Path, version1: str, version2: str) -> str:
    """Get git diff between versions."""
    try:
        result = subprocess.run([
            "git", "diff", f"{file_path.stem}-v{version1}", f"{file_path.stem}-v{version2}",
            "--", str(file_path)
        ], capture_output=True, text=True, check=True)
        
        return result.stdout
        
    except subprocess.CalledProcessError as e:
        raise Exception(f"Git diff failed: {e.stderr.decode()}")


# ================================================================================
# PACKAGE MANAGEMENT COMMANDS (NEW NPM-STYLE ARCHITECTURE)
# ================================================================================

@cli.command()
@click.option('--token', help='API token for authentication')
@click.option('--username', help='Username for credential authentication')  
@click.option('--password', help='Password for credential authentication')
@click.option('--registry', help='Registry to login to')
def login(token: Optional[str], username: Optional[str], password: Optional[str], registry: Optional[str]):
    """Login to package registry."""
    try:
        from .registry import RegistryClient
        
        client = RegistryClient(registry_name=registry)
        
        if token:
            result = client.login_with_token(token)
        elif username and password:
            result = client.login_with_credentials(username, password)
        else:
            # Interactive login
            import getpass
            username = click.prompt('Username')
            password = getpass.getpass('Password: ')
            result = client.login_with_credentials(username, password)
        
        console.print(f"[green]✓[/green] Logged in to {client.registry_name} as {result.get('username', 'user')}")
        
    except Exception as e:
        console.print(f"[red]Login failed:[/red] {e}")
        sys.exit(1)


@cli.command()
@click.option('--registry', help='Registry to logout from')
def logout(registry: Optional[str]):
    """Logout from package registry."""
    try:
        from .registry import RegistryClient
        
        client = RegistryClient(registry_name=registry)
        client.logout()
        
        console.print(f"[green]✓[/green] Logged out from {client.registry_name}")
        
    except Exception as e:
        console.print(f"[red]Logout failed:[/red] {e}")
        sys.exit(1)


@cli.command()
@click.argument('packages', nargs=-1, required=False)
@click.option('-g', '--global', 'global_install', is_flag=True, help='Install packages globally')
@click.option('--dev', is_flag=True, help='Add to development dependencies')
@click.option('--registry', help='Registry to install from')
def install(packages: tuple, global_install: bool, dev: bool, registry: Optional[str]):
    """Install packages from registry (npm-style).
    
    Without arguments: installs all dependencies from manifest.json
    With arguments: installs specified packages and updates manifest.json
    """
    try:
        from .package_resolver import PackageResolver
        import json
        import asyncio
        from concurrent.futures import ThreadPoolExecutor
        from rich.progress import Progress, TaskID
        from rich.table import Table
        from rich.live import Live
        
        manifest_path = Path.cwd() / 'manifest.json'
        
        # If no packages specified, install from manifest.json
        if not packages:
            if not manifest_path.exists():
                console.print("[yellow]No manifest.json found and no packages specified[/yellow]")
                console.print("[dim]Run 'prompd install <package>' to create a new project[/dim]")
                return
            
            # Load manifest and install all dependencies
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
            
            dependencies = manifest.get('dependencies', {})
            dev_dependencies = manifest.get('devDependencies', {})
            
            if not dependencies and not dev_dependencies:
                console.print("[yellow]No dependencies found in manifest.json[/yellow]")
                return
            
            # Create resolver
            resolver = PackageResolver(
                registry_urls=[registry] if registry else None,
                global_mode=global_install
            )
            
            # Prepare all packages to install
            all_packages = []
            for package_name, version in dependencies.items():
                package_ref = f"{package_name}@{version}" if version != "latest" else package_name
                all_packages.append((package_ref, False))  # (package, is_dev)
            
            for package_name, version in dev_dependencies.items():
                package_ref = f"{package_name}@{version}" if version != "latest" else package_name
                all_packages.append((package_ref, True))  # (package, is_dev)
            
            # Install packages in parallel
            console.print(f"[bold]Installing {len(all_packages)} packages in parallel...[/bold]\n")
            
            def install_single_package(package_info):
                package_ref, is_dev = package_info
                try:
                    if global_install:
                        package_path = resolver.install_package(package_ref, force_global=True, save_to_lock=False)
                    else:
                        resolver.add_dependency(package_ref, dev=is_dev, global_install=False)
                        package_path = resolver.resolve_package(package_ref)
                    return (package_ref, is_dev, True, str(package_path))
                except Exception as e:
                    return (package_ref, is_dev, False, str(e))
            
            # Use ThreadPoolExecutor for parallel downloads
            with ThreadPoolExecutor(max_workers=5) as executor:
                results = list(executor.map(install_single_package, all_packages))
            
            # Display results
            success_count = sum(1 for _, _, success, _ in results if success)
            for package_ref, is_dev, success, result in results:
                dev_tag = " (dev)" if is_dev else ""
                if success:
                    console.print(f"[green]OK[/green] {package_ref}{dev_tag}")
                else:
                    console.print(f"[red]FAILED[/red] {package_ref}{dev_tag}: {result}")
            
            console.print(f"\n[green]Successfully installed {success_count}/{len(all_packages)} packages[/green]")
            return
        
        # Installing specific packages
        # Create or update manifest.json
        if not manifest_path.exists():
            # Create new manifest.json (like npm does)
            manifest = {
                "name": Path.cwd().name.lower().replace(' ', '-'),
                "version": "1.0.0",
                "description": "",
                "dependencies": {},
                "devDependencies": {}
            }
            console.print(f"[green]Created manifest.json for {manifest['name']}[/green]")
        else:
            # Load existing manifest
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
            
            # Ensure dependencies sections exist
            if 'dependencies' not in manifest:
                manifest['dependencies'] = {}
            if 'devDependencies' not in manifest:
                manifest['devDependencies'] = {}
        
        # Create resolver
        resolver = PackageResolver(
            registry_urls=[registry] if registry else None,
            global_mode=global_install
        )
        
        # Install packages in parallel if multiple
        if len(packages) > 1:
            console.print(f"[bold]Installing {len(packages)} packages in parallel...[/bold]\n")
            
            def install_single_package(package_ref):
                try:
                    # Parse package reference to get name and version
                    if '@' in package_ref and not package_ref.startswith('@'):
                        package_name, package_version = package_ref.rsplit('@', 1)
                    else:
                        # Handle scoped packages like @prompd.io/package@version
                        parts = package_ref.split('@')
                        if len(parts) == 3:  # @scope/name@version
                            package_name = f"@{parts[1]}"
                            package_version = parts[2]
                        elif len(parts) == 2 and parts[0] == '':  # @scope/name
                            package_name = package_ref
                            package_version = "latest"
                        else:
                            package_name = package_ref
                            package_version = "latest"
                    
                    if global_install:
                        # Global installation
                        package_path = resolver.install_package(package_ref, force_global=True, save_to_lock=False)
                    else:
                        # Local installation with dependency management
                        resolver.add_dependency(package_ref, dev=dev, global_install=False)
                        package_path = resolver.resolve_package(package_ref)
                        
                        # Update manifest.json
                        if dev:
                            manifest['devDependencies'][package_name] = package_version
                        else:
                            manifest['dependencies'][package_name] = package_version
                    
                    return (package_ref, package_name, package_version, True, str(package_path))
                except Exception as e:
                    return (package_ref, None, None, False, str(e))
            
            # Use ThreadPoolExecutor for parallel downloads
            with ThreadPoolExecutor(max_workers=5) as executor:
                results = list(executor.map(install_single_package, packages))
            
            # Display results
            success_count = sum(1 for _, _, _, success, _ in results if success)
            for package_ref, _, _, success, result in results:
                if success:
                    console.print(f"[green]OK[/green] {package_ref}")
                    console.print(f"  Location: {result}")
                else:
                    console.print(f"[red]FAILED[/red] {package_ref}: {result}")
            
            if success_count == len(packages):
                console.print(f"\n[green]All {len(packages)} packages installed successfully[/green]")
            else:
                console.print(f"\n[yellow]Installed {success_count}/{len(packages)} packages[/yellow]")
        else:
            # Single package installation
            package_ref = packages[0]
            console.print(f"Installing {package_ref}{'globally' if global_install else 'locally'}...")
            
            # Parse package reference to get name and version
            if '@' in package_ref and not package_ref.startswith('@'):
                package_name, package_version = package_ref.rsplit('@', 1)
            else:
                # Handle scoped packages like @prompd.io/package@version
                parts = package_ref.split('@')
                if len(parts) == 3:  # @scope/name@version
                    package_name = f"@{parts[1]}"
                    package_version = parts[2]
                elif len(parts) == 2 and parts[0] == '':  # @scope/name
                    package_name = package_ref
                    package_version = "latest"
                else:
                    package_name = package_ref
                    package_version = "latest"
            
            if global_install:
                # Global installation
                package_path = resolver.install_package(package_ref, force_global=True, save_to_lock=False)
            else:
                # Local installation with dependency management
                resolver.add_dependency(package_ref, dev=dev, global_install=False)
                package_path = resolver.resolve_package(package_ref)
                
                # Update manifest.json
                if dev:
                    manifest['devDependencies'][package_name] = package_version
                else:
                    manifest['dependencies'][package_name] = package_version
            
            console.print(f"[green]OK[/green] Installed {package_ref}")
            console.print(f"  Location: {package_path}")
        
        # Save updated manifest.json (only for local installs)
        if not global_install:
            with open(manifest_path, 'w', encoding='utf-8') as f:
                json.dump(manifest, f, indent=2)
            console.print(f"\n[dim]Updated manifest.json and .prompd/lock.json[/dim]")
        
    except Exception as e:
        console.print(f"[red]Installation failed:[/red] {e}")
        sys.exit(1)


@cli.command()
@click.argument('packages', nargs=-1, required=True)
@click.option('-g', '--global', 'global_uninstall', is_flag=True, help='Uninstall packages globally')
@click.option('--dev', is_flag=True, help='Remove from development dependencies')
def uninstall(packages: tuple, global_uninstall: bool, dev: bool):
    """Uninstall packages."""
    try:
        from .package_resolver import PackageResolver
        
        resolver = PackageResolver(global_mode=global_uninstall)
        
        for package_name in packages:
            console.print(f"Uninstalling {package_name}{'globally' if global_uninstall else 'locally'}...")
            
            if global_uninstall:
                # For global uninstalls, we need version - show available versions
                cached_packages = resolver.global_cache.list_packages()
                matching = [p for p in cached_packages if p.name == package_name or f"@{p.namespace}/{p.name}" == package_name]
                
                if not matching:
                    console.print(f"[yellow]Package {package_name} not found in global cache[/yellow]")
                    continue
                
                if len(matching) > 1:
                    console.print(f"[yellow]Multiple versions found. Please specify version:[/yellow]")
                    for p in matching:
                        console.print(f"  {p.to_string()}")
                    continue
                
                removed = resolver.uninstall_package(matching[0].to_string(), force_global=True)
            else:
                # Local uninstall with dependency management
                resolver.remove_dependency(package_name, dev=dev, global_uninstall=False)
                removed = True
            
            if removed:
                console.print(f"[green]OK[/green] Uninstalled {package_name}")
            else:
                console.print(f"[yellow]Package {package_name} not found[/yellow]")
        
    except Exception as e:
        console.print(f"[red]Uninstall failed:[/red] {e}")
        sys.exit(1)


@cli.command()
@click.argument('query', required=True)
@click.option('--limit', default=20, help='Maximum number of results')
@click.option('--registry', help='Registry to search in')
def search(query: str, limit: int, registry: Optional[str]):
    """Search packages in registry."""
    try:
        from .registry import RegistryClient
        
        client = RegistryClient(registry_name=registry)
        results = client.search(query, limit=limit)
        
        if not results:
            console.print(f"[yellow]No packages found matching '{query}'[/yellow]")
            return
        
        console.print(f"\n[bold]Found {len(results)} packages:[/bold]\n")
        
        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("Package", style="cyan")
        table.add_column("Version", style="green")
        table.add_column("Description", style="white")
        table.add_column("Downloads", justify="right", style="yellow")
        
        for pkg in results:
            # Use fullName (includes scope) or fallback to name
            package_name = pkg.get('fullName', pkg.get('name', 'Unknown'))
            # Use latestVersion (backend field) not latest_version
            version = pkg.get('latestVersion', pkg.get('latest_version', 'Unknown'))
            # Use downloads30d (backend field) or fallback to downloads
            downloads = pkg.get('downloads30d', pkg.get('downloads', 0))
            
            table.add_row(
                package_name,
                version,
                pkg.get('description', '')[:50] + ('...' if len(pkg.get('description', '')) > 50 else ''),
                str(downloads)
            )
        
        console.print(table)
        
    except Exception as e:
        console.print(f"[red]Search failed:[/red] {e}")
        sys.exit(1)


@cli.command()
@click.argument('package_file', type=click.Path(exists=True, path_type=Path))
@click.option('--registry', help='Registry to publish to')
@click.option('--dry-run', is_flag=True, help='Show what would be published without actually doing it')
def publish(package_file: Path, registry: Optional[str], dry_run: bool):
    """Publish package to registry."""
    try:
        from .registry import RegistryClient
        
        if dry_run:
            console.print(f"[yellow]DRY RUN: Would publish {package_file}[/yellow]")
            return
        
        client = RegistryClient(registry_name=registry)
        result = client.publish_package(package_file)
        
        console.print(f"[green]SUCCESS[/green] Published {result.get('name')}@{result.get('version')}")
        console.print(f"  Registry: {client.registry_name}")
        if 'package_url' in result:
            console.print(f"  URL: {result['package_url']}")
        
    except Exception as e:
        console.print(f"[red]Publish failed:[/red] {e}")
        sys.exit(1)


@cli.command()
@click.argument('package_name', required=True)
@click.option('--registry', help='Registry to query')
def versions(package_name: str, registry: Optional[str]):
    """List available versions of a package."""
    try:
        from .registry import RegistryClient
        
        client = RegistryClient(registry_name=registry)
        versions_list = client.get_package_versions(package_name)
        
        if not versions_list:
            console.print(f"[yellow]No versions found for {package_name}[/yellow]")
            return
        
        console.print(f"\n[bold]Available versions for {package_name}:[/bold]\n")
        
        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("Version", style="green")
        table.add_column("Published", style="blue")
        table.add_column("Tags", style="yellow")
        
        for version_info in versions_list:
            table.add_row(
                version_info.get('version', 'Unknown'),
                version_info.get('published_at', 'Unknown')[:10],  # Just date
                ', '.join(version_info.get('tags', []))
            )
        
        console.print(table)
        
    except Exception as e:
        console.print(f"[red]Failed to get versions:[/red] {e}")
        sys.exit(1)


@cli.group()
def cache():
    """Package cache management commands."""
    pass


@cache.command('list')
@click.option('--global-only', is_flag=True, help='Show only global cache')
@click.option('--local-only', is_flag=True, help='Show only local cache')
def list_cache(global_only: bool, local_only: bool):
    """List cached packages."""
    try:
        from .package_resolver import PackageResolver
        
        resolver = PackageResolver()
        
        if local_only:
            packages_dict = {'local': resolver.project_cache.list_packages(), 'global': []}
        elif global_only:
            packages_dict = {'local': [], 'global': resolver.global_cache.list_packages()}
        else:
            packages_dict = resolver.list_cached_packages()
        
        if packages_dict['local']:
            console.print("\n[bold cyan]Local Project Cache (./.prompd/cache/):[/bold cyan]")
            for pkg in packages_dict['local']:
                console.print(f"  {pkg.to_string()}")
        
        if packages_dict['global']:
            console.print("\n[bold green]Global Cache (~/.cache/prompd/):[/bold green]")
            for pkg in packages_dict['global']:
                console.print(f"  {pkg.to_string()}")
        
        if not packages_dict['local'] and not packages_dict['global']:
            console.print("[yellow]No cached packages found[/yellow]")
        
    except Exception as e:
        console.print(f"[red]Failed to list cache:[/red] {e}")
        sys.exit(1)


@cache.command('clean')
@click.option('--global', 'clean_global', is_flag=True, help='Clean global cache')
@click.option('--local', 'clean_local', is_flag=True, help='Clean local cache')
@click.option('--all', 'clean_all', is_flag=True, help='Clean both caches')
def clean_cache(clean_global: bool, clean_local: bool, clean_all: bool):
    """Clean package cache."""
    try:
        from .package_resolver import PackageResolver
        
        resolver = PackageResolver()
        
        if clean_all:
            clean_global = clean_local = True
        elif not clean_global and not clean_local:
            clean_local = True  # Default to local
        
        resolver.clear_cache(clear_global=clean_global, clear_local=clean_local)
        
        cleaned = []
        if clean_local:
            cleaned.append("local")
        if clean_global:
            cleaned.append("global")
        
        console.print(f"[green]✓[/green] Cleaned {' and '.join(cleaned)} cache(s)")
        
    except Exception as e:
        console.print(f"[red]Failed to clean cache:[/red] {e}")
        sys.exit(1)


@cli.group()
def registry():
    """Registry management commands."""
    pass


@registry.command('info')
@click.argument('package_name', required=True)
@click.option('--registry', help='Registry to query')
def registry_info(package_name: str, registry: Optional[str]):
    """Get detailed package information."""
    try:
        from .registry import RegistryClient
        
        client = RegistryClient(registry_name=registry)
        info = client.get_package_info(package_name)
        
        console.print(Panel(
            f"[bold cyan]{info.get('name')}[/bold cyan] v{info.get('version')}\n\n"
            f"[bold]Description:[/bold] {info.get('description', 'No description')}\n"
            f"[bold]Author:[/bold] {info.get('author', 'Unknown')}\n"
            f"[bold]License:[/bold] {info.get('license', 'Unknown')}\n"
            f"[bold]Homepage:[/bold] {info.get('homepage', 'None')}\n"
            f"[bold]Downloads:[/bold] {info.get('downloads', 0):,}\n"
            f"[bold]Published:[/bold] {info.get('published_at', 'Unknown')}\n\n"
            f"[bold]Tags:[/bold] {', '.join(info.get('tags', []))}\n"
            f"[bold]Dependencies:[/bold] {len(info.get('dependencies', {}))}\n",
            title=f"Package Information",
            border_style="blue"
        ))
        
        if info.get('dependencies'):
            console.print("\n[bold]Dependencies:[/bold]")
            for dep, version in info.get('dependencies', {}).items():
                console.print(f"  {dep}: {version}")
        
    except Exception as e:
        console.print(f"[red]Failed to get package info:[/red] {e}")
        sys.exit(1)


@cli.command('deps')
@click.argument('package', required=False)
@click.option('--tree', is_flag=True, help='Show dependency tree')
@click.option('--conflicts', is_flag=True, help='Show version conflicts')
@click.option('--dev', is_flag=True, help='Include dev dependencies')
@click.option('--peer', is_flag=True, help='Include peer dependencies')
@click.option('--depth', default=3, help='Maximum tree depth to display')
def dependencies(package: Optional[str], tree: bool, conflicts: bool, dev: bool, peer: bool, depth: int):
    """Analyze package dependencies."""
    from .dependency_resolver import DependencyResolver
    
    console = Console()
    
    # Use current directory package if not specified
    if not package:
        config_file = Path.cwd() / '.prompd' / 'config.yaml'
        if config_file.exists():
            import yaml
            with open(config_file) as f:
                config = yaml.safe_load(f)
                package = f"{config.get('name', 'unknown')}@{config.get('version', 'latest')}"
        else:
            console.print("[red]No package specified and no .prompd/config.yaml found[/red]")
            sys.exit(1)
    
    try:
        resolver = DependencyResolver()
        
        with console.status(f"[bold green]Resolving dependencies for {package}..."):
            resolved = resolver.resolve(package, dev_dependencies=dev, peer_dependencies=peer)
        
        if tree:
            # Show dependency tree
            tree_str = resolver.get_dependency_tree()
            console.print(Panel(tree_str, title="Dependency Tree", border_style="green"))
        
        if conflicts:
            # Show conflicts
            conflicts_list = resolver.find_conflicts()
            if conflicts_list:
                console.print("\n[bold red]Version Conflicts Found:[/bold red]")
                for conflict in conflicts_list:
                    console.print(f"\n  {conflict['package']}:")
                    console.print(f"    Resolved: {conflict['resolved_version']}")
                    for c in conflict['conflicts']:
                        console.print(f"    - {c['requester']} requires {c['constraint']}")
            else:
                console.print("[green]No version conflicts found[/green]")
        
        if not tree and not conflicts:
            # Default: show summary
            console.print(f"\n[bold]Dependencies for {package}:[/bold]")
            console.print(f"Total packages: {len(resolved)}")
            
            # Group by depth
            by_depth = {}
            for node in resolved.values():
                if node.depth not in by_depth:
                    by_depth[node.depth] = []
                by_depth[node.depth].append(node)
            
            for d in sorted(by_depth.keys())[:depth]:
                if d == 0:
                    console.print(f"\n[bold]Root package:[/bold]")
                else:
                    console.print(f"\n[bold]Depth {d} dependencies:[/bold]")
                
                for node in by_depth[d]:
                    console.print(f"  - {node.name}@{node.resolved_version}")
        
    except Exception as e:
        console.print(f"[red]Dependency resolution failed:[/red] {e}")
        sys.exit(1)


@cli.command('deps-install')
@click.argument('package')
@click.option('--save', is_flag=True, help='Save to dependencies')
@click.option('--save-dev', is_flag=True, help='Save to dev dependencies')
@click.option('--target', type=click.Path(), help='Installation directory')
@click.option('--parallel/--sequential', default=True, help='Parallel installation')
def install_dependencies(package: str, save: bool, save_dev: bool, target: Optional[str], parallel: bool):
    """Install package with all dependencies."""
    from .dependency_resolver import DependencyResolver
    
    console = Console()
    
    try:
        resolver = DependencyResolver()
        
        # Resolve dependencies
        with console.status(f"[bold green]Resolving dependencies for {package}..."):
            resolved = resolver.resolve(package, dev_dependencies=save_dev)
        
        console.print(f"[green]Resolved {len(resolved)} packages[/green]")
        
        # Install all dependencies
        target_dir = Path(target) if target else Path.cwd() / '.prompd' / 'packages'
        
        with console.status(f"[bold green]Installing {len(resolved)} packages..."):
            installed = resolver.install_all(target_dir, parallel=parallel)
        
        console.print(f"[green]Successfully installed {len(installed)} packages to {target_dir}[/green]")
        
        # Generate lock file
        lock_data = resolver.generate_lock_file()
        lock_file = Path.cwd() / '.prompd' / 'lock.json'
        lock_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(lock_file, 'w') as f:
            json.dump(lock_data, f, indent=2)
        
        console.print(f"[green]Lock file saved to {lock_file}[/green]")
        
        # Update project config if --save or --save-dev
        if save or save_dev:
            from .package_resolver import PackageResolver
            resolver_inst = PackageResolver()
            config = resolver_inst.get_project_config()
            
            ref = PackageReference.parse(package)
            dep_name = ref.to_string().split('@')[0]
            
            if save:
                config.dependencies[dep_name] = ref.version
            elif save_dev:
                config.dev_dependencies[dep_name] = ref.version
            
            resolver_inst.save_project_config(config)
            console.print(f"[green]Updated project configuration[/green]")
        
    except Exception as e:
        console.print(f"[red]Installation failed:[/red] {e}")
        sys.exit(1)


@cli.command('deps-update')
@click.option('--dry-run', is_flag=True, help='Show what would be updated')
@click.option('--latest', is_flag=True, help='Update to latest versions')
def update_dependencies(dry_run: bool, latest: bool):
    """Update all dependencies to latest compatible versions."""
    from .dependency_resolver import DependencyResolver
    from .package_resolver import PackageResolver
    
    console = Console()
    
    try:
        # Load current project config
        resolver_inst = PackageResolver()
        config = resolver_inst.get_project_config()
        
        if not config.dependencies:
            console.print("[yellow]No dependencies to update[/yellow]")
            return
        
        updates = []
        
        for dep_name, current_version in config.dependencies.items():
            # Check for newer versions
            try:
                package_info = resolver_inst.registries[resolver_inst.registry_urls[0]].get_package_info(dep_name)
                available_versions = package_info.get('versions', {}).keys()
                
                if latest:
                    # Get absolute latest version
                    latest_version = max(available_versions)
                else:
                    # Get latest compatible version
                    from .dependency_resolver import VersionConstraint
                    constraint = VersionConstraint.parse(current_version)
                    compatible = [v for v in available_versions if constraint.matches(v)]
                    latest_version = max(compatible) if compatible else current_version
                
                if latest_version != current_version:
                    updates.append({
                        'package': dep_name,
                        'current': current_version,
                        'new': latest_version
                    })
            except Exception as e:
                console.print(f"[yellow]Could not check {dep_name}: {e}[/yellow]")
        
        if not updates:
            console.print("[green]All dependencies are up to date[/green]")
            return
        
        # Show updates
        console.print("\n[bold]Available updates:[/bold]")
        for update in updates:
            console.print(f"  {update['package']}: {update['current']} → {update['new']}")
        
        if not dry_run:
            # Apply updates
            for update in updates:
                config.dependencies[update['package']] = update['new']
            
            resolver_inst.save_project_config(config)
            console.print(f"\n[green]Updated {len(updates)} dependencies in config[/green]")
            console.print("[yellow]Run 'prompd deps-install' to install updated versions[/yellow]")
        else:
            console.print("\n[yellow]Dry run - no changes made[/yellow]")
        
    except Exception as e:
        console.print(f"[red]Update check failed:[/red] {e}")
        sys.exit(1)


def main():
    """Main entry point."""
    cli()


if __name__ == "__main__":
    main()
