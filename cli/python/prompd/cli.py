"""Command-line interface for Prompd."""

import sys
import subprocess
import json
from pathlib import Path
from typing import Optional, Dict, Any, List

import click
from rich.console import Console
from rich.table import Table
from rich.syntax import Syntax
from rich.panel import Panel

# Lazy imports - moved to function level for faster startup
# Heavy modules like executor, registry, compiler are imported only when needed
from prompd import __version__ as PROMPD_VERSION
from prompd.exceptions import ConfigurationError, PrompdError, ProviderError

# Configure console with proper encoding handling for Windows
import platform
try:
    if platform.system() == "Windows":
        # Force UTF-8 encoding on Windows to handle all characters properly
        console = Console(file=sys.stdout, legacy_windows=True, width=120, force_terminal=True)
    else:
        console = Console(file=sys.stdout, force_terminal=True, width=120)
except:
    # Fallback to basic console if Rich fails
    console = Console(file=sys.stdout, legacy_windows=True, width=120)


@click.group()
@click.version_option(version=PROMPD_VERSION, prog_name="prompd")
def cli():
    """Prompd - CLI for structured prompt definitions."""
    pass


# Register config command with registry and provider subcommands
from prompd.commands.config import config
cli.add_command(config)


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
            with tempfile.NamedTemporaryFile(mode='w', suffix='.prmd', delete=False, encoding='utf-8') as tmp:
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
        from prompd.executor import PrompdExecutor
        from prompd.config import PrompdConfig
        executor = PrompdExecutor()

        # Resolve defaults for provider/model when omitted
        try:
            cfg = PrompdConfig.load()
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
    except PrompdError as e:
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
@click.argument("source")  # Accept string to allow package references
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
def run(ctx, source: str, provider: Optional[str], model: Optional[str], param: tuple, param_file: tuple,
        api_key: Optional[str], output: Optional[str], format: str, version: Optional[str], verbose: bool, show_usage: bool):
    """Run a .prmd file or package reference with an LLM provider.

    Supports package references like:
    - @namespace/package@version/path/to/file.prmd
    - @prompd/public-examples@1.0.0/prompts/basic-inheritance.prmd
    - package@version/file.prmd

    Also supports --meta:* flags for dynamic section injection.
    """
    # Check if source is a package reference with path
    import re
    package_pattern = r'^(@[\w.-]+/[\w.-]+|[\w.-]+)@([\w.-]+)/(.+\.prmd)$'
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
            file = package_path / file_path_in_package

            if not file.exists():
                console.print(f"[red]File not found in package:[/red] {file_path_in_package}")
                console.print(f"[yellow]Package location:[/yellow] {package_path}")
                sys.exit(1)

        except Exception as e:
            console.print(f"[red]Failed to resolve package:[/red] {e}")
            sys.exit(1)
    else:
        # Regular file path
        file = Path(source)
        if not file.exists():
            console.print(f"[red]File not found:[/red] {source}")
            sys.exit(1)

    return _run_impl(ctx, file, provider, model, param, param_file, api_key, output, format, version, verbose, show_usage)
@cli.command()
@click.argument("source")  # Accept string to allow package references
@click.option("--verbose", "-v", is_flag=True, help="Show detailed validation results")
@click.option("--git", is_flag=True, help="Include git history consistency checks")
@click.option("--version-only", is_flag=True, help="Only validate version-related aspects")
@click.option("--check-overrides", is_flag=True, help="Validate section overrides against parent template")
def validate(source: str, verbose: bool, git: bool, version_only: bool, check_overrides: bool):
    """Validate a .prmd file or package reference syntax and structure.

    Supports package references like:
    - @namespace/package@version/path/to/file.prmd
    - @prompd/public-examples@1.0.0/prompts/basic-inheritance.prmd
    """
    # Check if source is a package reference with path
    import re
    package_pattern = r'^(@[\w.-]+/[\w.-]+|[\w.-]+)@([\w.-]+)/(.+\.prmd)$'
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
            file = package_path / file_path_in_package

            if not file.exists():
                console.print(f"[red]File not found in package:[/red] {file_path_in_package}")
                console.print(f"[yellow]Package location:[/yellow] {package_path}")
                sys.exit(1)

        except Exception as e:
            console.print(f"[red]Failed to resolve package:[/red] {e}")
            sys.exit(1)
    else:
        # Regular file path
        file = Path(source)
        if not file.exists():
            console.print(f"[red]File not found:[/red] {source}")
            sys.exit(1)

    try:
        from prompd.validator import PrompdValidator
        validator = PrompdValidator()
        
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

        # Check override validation if requested
        override_warnings = []
        if check_overrides:
            try:
                from prompd.parser import PrompdParser
                parser = PrompdParser()
                prompd = parser.parse_file(file)

                # Check if file has inheritance and overrides
                if prompd.metadata and hasattr(prompd.metadata, 'inherits') and prompd.metadata.inherits:
                    if hasattr(prompd.metadata, 'override') and prompd.metadata.override:
                        # Resolve parent file path
                        parent_path = prompd.metadata.inherits
                        base_dir = file.parent

                        # Handle relative paths
                        if not Path(parent_path).is_absolute():
                            parent_file = base_dir / parent_path
                        else:
                            parent_file = Path(parent_path)

                        if parent_file.exists():
                            # Validate overrides against parent
                            override_warnings = parser.validate_overrides_against_parent(file, parent_file)

                            if verbose and override_warnings:
                                console.print(f"\n[yellow]Override Validation Results:[/yellow]")
                                for warning in override_warnings:
                                    console.print(f"  [yellow]![/yellow] {warning}")

                            # Add as warnings to issues
                            for warning in override_warnings:
                                issues.append({
                                    "level": "warning",
                                    "message": f"Override validation: {warning}"
                                })
                        else:
                            issues.append({
                                "level": "error",
                                "message": f"Parent template not found: {parent_file}"
                            })
                    else:
                        if verbose:
                            console.print(f"\n[blue]Override Check:[/blue] File inherits from {prompd.metadata.inherits} but has no overrides")
                else:
                    if verbose:
                        console.print(f"\n[blue]Override Check:[/blue] File does not use inheritance")

            except Exception as e:
                issues.append({
                    "level": "error",
                    "message": f"Override validation failed: {e}"
                })

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
              default=Path("."), help="Directory to search for .prmd files")
@click.option("--detailed", "-d", is_flag=True, help="Show detailed information")
@click.option("--recursive", "-r", is_flag=True, help="Search recursively in subdirectories")
def list_prompts(path: Path, detailed: bool, recursive: bool):
    """List available .prmd files."""
    try:
        from prompd.parser import PrompdParser
        # Use recursive glob only if --recursive is specified
        if recursive:
            prompd_files = list(Path(path).glob("**/*.prmd"))
        else:
            prompd_files = list(Path(path).glob("*.prmd"))
        
        if not prompd_files:
            console.print(f"No .prmd files found in {path}")
            return
        
        if detailed:
            parser = PrompdParser()
            for prompd_file in prompd_files:
                try:
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

            parser = PrompdParser()
            for prompd_file in prompd_files:
                try:
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
    """Serve a .prmd or .pdflow over HTTP with simple MCP-style endpoints."""
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
@click.option("--dockerfile", default="Dockerfile.prmd-mcp", help="Output Dockerfile name", show_default=True)
@click.option("--compose", default="docker-compose.prmd-mcp.yml", help="Output docker-compose file name", show_default=True)
@click.option("--port", type=int, default=3333, help="Container port to expose", show_default=True)
def mcp_dockerize(dockerfile: str, compose: str, port: int):
    """Scaffold Docker + Compose files to serve a .prmd/.pdflow via MCP."""
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
        CMD ["prompd", "mcp", "serve", "/data/prompt.prmd", "--host", "0.0.0.0", "--port", "{port}"]
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
    """Start the interactive Prompd shell (REPL). [AI features in BETA]"""
    try:
        # if simple:
        #     from prompd.interactive_simple import SimplePrompdREPL
        #     SimplePrompdREPL().start()
        # else:
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
    """Start the Prompd shell directly in chat mode. [BETA FEATURE]"""
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
@click.option("-f", "--params-file", type=click.Path(exists=True, path_type=Path), multiple=True, help="Load parameters from JSON file (repeatable)")
@click.option("-o", "--output", type=click.Path(), help="Write compiled output to file")
@click.option("-v", "--verbose", is_flag=True, help="Verbose output")
@click.pass_context
def compile_command(ctx, source: str, output_format: str, to_markdown: bool, to_provider_json: Optional[str], param: tuple, params_file: tuple, output: Optional[str], verbose: bool):
    """Compile a .prmd file or package reference to a target format.
    
    Supports package references like:
    - @namespace/package@version/path/to/file.prmd
    - @prompd.io/security@1.0.0/prompts/audit.prmd
    - package@version/file.prmd
    """
    try:
        # Check if source is a package reference with path
        source_path = Path(source)
        
        # Pattern to detect package references: @namespace/package@version/path or package@version/path
        package_pattern = r'^(@[\w.-]+/[\w.-]+|[\w.-]+)@([\w.-]+)/(.+\.prmd)$'
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
        
        # Parse meta alias flags of form --meta:{section} <value>
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
                        # Store the section name without the meta: prefix
                        metadata_overrides[section] = str(val)
                        i += 2
                        continue
                i += 1
        except Exception:
            # Best-effort; ignore parsing errors
            pass

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
            import json
            for kv in param:
                if '=' not in kv:
                    console.print(f"[red]Invalid parameter:[/red] {kv}. Use key=value")
                    sys.exit(1)
                k, v = kv.split('=', 1)

                # Try to parse as JSON for complex objects, fallback to string
                try:
                    # If it looks like JSON (starts with { or [), try parsing it
                    if v.strip().startswith(('{', '[')):
                        parameters[k] = json.loads(v)
                    # Handle boolean values
                    elif v.lower() in ('true', 'false'):
                        parameters[k] = v.lower() == 'true'
                    # Handle numeric values
                    elif v.isdigit() or (v.replace('.', '').replace('-', '').isdigit() and v.count('.') <= 1):
                        if '.' in v:
                            parameters[k] = float(v)
                        else:
                            parameters[k] = int(v)
                    # Default to string
                    else:
                        parameters[k] = v
                except json.JSONDecodeError:
                    # If JSON parsing fails, treat as string
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
                console.print(f"[dim]Compiling {source} -> {output_format} with params: {list(parameters.keys())}[/dim]")
            except Exception:
                pass

        from prompd.compiler import PrompdCompiler
        from prompd.executor import PrompdExecutor

        # If we have metadata overrides, we need to resolve them and merge into parameters
        if metadata_overrides:
            executor = PrompdExecutor()
            for key, value in metadata_overrides.items():
                # Resolve the value (could be file/directory/glob pattern)
                resolved_value = executor._resolve_custom_value(value, base_file=source_path)
                # Merge into parameters with the meta: prefix as the key
                parameters[key] = resolved_value

        compiler = PrompdCompiler()
        result = compiler.compile(
            source=source,
            output_format=output_format,
            parameters=parameters,
            output_file=Path(output) if output else None,
            verbose=verbose
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



# Removed provider commands - moved to prompd.commands.config

# Old provider commands removed (lines 715-918)
# All provider functionality now available via:
# - prompd config provider list
# - prompd config provider add
# - prompd config provider remove
# - prompd config provider setkey
# - prompd config providers (alias)

# Keep the old providers command for backward compatibility
# All provider functionality moved to prompd.commands.config

# Legacy providers command removed - use 'prompd config provider list' or 'prompd config providers'


@cli.command()
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--sections", is_flag=True, help="Show available section IDs for override reference")
@click.option("--verbose", is_flag=True, help="Show detailed section information")
def show(file: Path, sections: bool, verbose: bool):
    """Show the structure and parameters of a .prmd file."""
    try:
        from prompd.parser import PrompdParser
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
                console.print(f"  -{info}")
        
        # Handle sections display
        if sections:
            try:
                # Extract detailed section information
                section_summary = parser.get_section_summary(file)

                if section_summary:
                    # Create sections table
                    sections_table = Table(title="Available Sections for Override")
                    sections_table.add_column("Section ID", style="cyan", min_width=20)
                    sections_table.add_column("Heading Text", style="green", min_width=30)
                    if verbose:
                        sections_table.add_column("Content Length", style="yellow", justify="right")

                    for section_id, heading_text, content_length in section_summary:
                        if verbose:
                            sections_table.add_row(section_id, heading_text, f"{content_length:,} chars")
                        else:
                            sections_table.add_row(section_id, heading_text)

                    console.print(f"\n")
                    console.print(sections_table)

                    # Show usage example
                    console.print(f"\n[bold]Override Usage Example:[/bold]")
                    console.print("[dim]override:[/dim]")
                    if section_summary:
                        example_id = section_summary[0][0]  # First section ID
                        console.print(f"[dim]  {example_id}: \"./custom-{example_id}.md\"[/dim]")
                        console.print(f"[dim]  another-section: null  # Remove section[/dim]")

                else:
                    console.print(f"\n[yellow]No sections found in {file.name}[/yellow]")
                    console.print("[dim]Note: Only markdown headings (# Header) create sections[/dim]")

            except Exception as e:
                console.print(f"\n[red]Error extracting sections:[/red] {e}")
        else:
            # Show basic sections found in file (legacy behavior)
            if prompd.sections:
                console.print(f"\n[bold]Available Sections:[/bold]")
                for section_name in prompd.sections:
                    console.print(f"  -#{section_name}")

            # Show inheritance information if present
            if metadata and hasattr(metadata, 'inherits') and metadata.inherits:
                console.print(f"\n[bold]Inherits from:[/bold] {metadata.inherits}")

                # Show override information if present
                if hasattr(metadata, 'override') and metadata.override:
                    console.print(f"\n[bold]Section Overrides:[/bold]")
                    for section_id, override_path in metadata.override.items():
                        if override_path is None:
                            console.print(f"  -[red]{section_id}[/red]: [removed]")
                        else:
                            console.print(f"  -[cyan]{section_id}[/cyan]: {override_path}")

        if metadata.requires:
            console.print(f"\n[bold]Requirements:[/bold] {', '.join(metadata.requires)}")

    except Exception as e:
        console.print(f"[red]Error reading file:[/red] {e}")
        sys.exit(1)


@cli.command()
@click.argument('target', type=str)
@click.option('--detailed', '-d', is_flag=True, help='Show detailed information')
@click.option('--sections', '-s', is_flag=True, help='Show section content previews')
@click.option('--history', '-h', is_flag=True, help='Show version/git history')
@click.option('--registry', '-r', help='Registry to query (for package references)')
@click.option('--verbose', '-v', is_flag=True, help='Enable verbose logging')
def explain(target: str, detailed: bool, sections: bool, history: bool, registry: Optional[str], verbose: bool):
    """Explain detailed information about a .prmd file, package, or registry package.

    Examples:
      prompd explain examples/src/prompts/base-prompt.prmd
      prompd explain examples/src/prompts/team-project-planner.prmd -dsh
      prompd explain examples/dist/public-examples.pdpkg -d
      prompd explain @prompd.io/public-examples
    """
    if verbose:
        console.print("[dim]Verbose logging enabled[/dim]")

    target_path = Path(target)

    # Detect target type
    if target.startswith('@') or ('/' in target and not target_path.exists()):
        if verbose:
            console.print(f"[dim]Detected: Registry package reference[/dim]")
        _explain_registry_package(target, registry, detailed, verbose)
    elif target.endswith('.pdpkg'):
        if verbose:
            console.print(f"[dim]Detected: Package file (.pdpkg)[/dim]")
        _explain_package_file(target_path, detailed, verbose)
    elif target.endswith('.prmd'):
        if verbose:
            console.print(f"[dim]Detected: Prompd file (.prmd)[/dim]")
        _explain_prmd_file(target_path, detailed, sections, history, verbose)
    else:
        console.print("[red]Unknown target type. Use .prmd file, .pdpkg package, or @namespace/package[/red]")
        sys.exit(1)


def _explain_prmd_file(file_path: Path, detailed: bool, show_sections: bool, show_history: bool, verbose: bool):
    """Explain a .prmd file."""
    if verbose:
        console.print(f"[dim]Parsing file: {file_path}[/dim]")

    try:
        # Parse file
        from prompd.parser import PrompdParser
        parser = PrompdParser()
        prompd = parser.parse_file(file_path)
        metadata = prompd.metadata

        if verbose:
            console.print(f"[dim]Found {len(metadata.parameters or [])} parameters[/dim]")
            console.print(f"[dim]Found {len(prompd.sections)} sections[/dim]")

        # Build output
        output = f"{file_path.name}\n\n"
        output += "[bold cyan]Metadata:[/bold cyan]\n"
        output += f"  Name:        {metadata.name}\n"
        output += f"  Version:     {metadata.version}\n"
        output += f"  Description: {metadata.description or 'None'}\n"

        # Show additional metadata only in detailed mode
        if detailed:
            if hasattr(metadata, 'author') and metadata.author:
                output += f"  Author:      {metadata.author}\n"
            if hasattr(metadata, 'license') and metadata.license:
                output += f"  License:     {metadata.license}\n"
            if hasattr(metadata, 'inherits') and metadata.inherits:
                output += f"  Inherits:    {metadata.inherits}\n"
        elif hasattr(metadata, 'inherits') and metadata.inherits:
            # Always show inherits
            output += f"\nInherits: {metadata.inherits}\n"

        # Parameters
        if metadata.parameters:
            param_count = len(metadata.parameters)
            output += f"\n[bold cyan]Parameters ({param_count}):[/bold cyan]\n"

            for param in metadata.parameters:
                required = param.required
                marker = "*" if required else " "
                req_text = "required" if required else "optional"

                # Basic display
                default_text = f" - Default: {param.default}" if param.default is not None and not detailed else ""
                output += f"  {marker} {param.name} ({param.type.value}, {req_text}){default_text}\n"

                # Detailed display
                if detailed:
                    if param.description:
                        output += f"    Description: {param.description}\n"
                    if param.default is not None:
                        output += f"    Default: {param.default}\n"
                    if hasattr(param, 'pattern') and param.pattern:
                        output += f"    Pattern: {param.pattern}\n"
                    if hasattr(param, 'enum') and param.enum:
                        output += f"    Enum: {', '.join(param.enum)}\n"
                    output += "\n"

        # Context files
        if hasattr(metadata, 'contexts') and metadata.contexts:
            context_count = len(metadata.contexts)
            output += f"\n[bold cyan]Contexts ({context_count}):[/bold cyan]\n"
            for ctx in metadata.contexts:
                output += f"  - {ctx}\n"

        # Overrides
        if hasattr(metadata, 'override') and metadata.override:
            override_count = len(metadata.override)
            output += f"\n[bold cyan]Overrides ({override_count}):[/bold cyan]\n"
            for section_id, override_path in metadata.override.items():
                if override_path is None:
                    output += f"  - {section_id} -> [removed]\n"
                else:
                    output += f"  - {section_id} -> {override_path}\n"

        # Sections
        if prompd.sections:
            if not detailed and not show_sections:
                # Basic display - just list section names
                all_section_names = list(prompd.sections.keys())
                output += f"\n[bold cyan]Sections:[/bold cyan] {', '.join(all_section_names)} ({len(all_section_names)} total)\n"
            else:
                # Detailed display - show all sections with content info
                output += f"\n[bold cyan]Sections ({len(prompd.sections)}):[/bold cyan]\n"
                for section_id, content in prompd.sections.items():
                    # Content is a string directly
                    lines = len(content.split('\n'))
                    output += f"  - {section_id} ({lines} lines)\n"
                    if show_sections:
                        preview = content[:100].replace('\n', ' ')
                        if len(content) > 100:
                            preview += "..."
                        output += f"    {preview}\n"

        # Git history (if requested)
        if show_history:
            if verbose:
                console.print("[dim]Checking git history...[/dim]")

            try:
                import subprocess
                # Get git tags for this file
                basename = file_path.stem
                result = subprocess.run(
                    ['git', 'tag', '-l', f'{basename}-v*'],
                    capture_output=True, text=True, check=True, cwd=file_path.parent
                )
                tags = [t.strip() for t in result.stdout.split('\n') if t.strip()]

                if verbose and tags:
                    console.print(f"[dim]Found {len(tags)} version tags[/dim]")

                if tags:
                    output += f"\n[bold cyan]Git History ({len(tags)} versions):[/bold cyan]\n"
                    for tag in sorted(tags, reverse=True)[:10]:  # Show last 10
                        # Get commit info for tag
                        commit_info = subprocess.run(
                            ['git', 'log', '-1', '--format=%cd - %s', '--date=short', tag],
                            capture_output=True, text=True, cwd=file_path.parent
                        )
                        if commit_info.stdout:
                            output += f"  {tag} ({commit_info.stdout.strip()})\n"
                else:
                    output += "\n[dim]No version tags found[/dim]\n"
            except Exception as e:
                if verbose:
                    console.print(f"[dim]Git history unavailable: {e}[/dim]")
                output += "\n[dim]Git history unavailable[/dim]\n"

        # File stats (only in detailed mode)
        if detailed:
            stats = file_path.stat()
            size_kb = stats.st_size / 1024
            with open(file_path, 'r', encoding='utf-8') as f:
                line_count = len(f.readlines())

            from datetime import datetime
            mod_time = datetime.fromtimestamp(stats.st_mtime).strftime('%Y-%m-%d %H:%M:%S')

            output += f"\n[bold cyan]File Stats:[/bold cyan]\n"
            output += f"  Size: {size_kb:.2f} KB\n"
            output += f"  Lines: {line_count}\n"
            output += f"  Last modified: {mod_time}\n"

        console.print(Panel(output.strip(), title=f"Prompd File: {file_path.name}"))

    except Exception as e:
        console.print(f"[red]Error explaining file: {e}[/red]")
        if verbose:
            import traceback
            console.print(f"[dim]{traceback.format_exc()}[/dim]")
        sys.exit(1)


def _explain_package_file(package_path: Path, detailed: bool, verbose: bool):
    """Explain a .pdpkg package file."""
    import zipfile

    if verbose:
        console.print(f"[dim]Opening package: {package_path}[/dim]")

    try:
        # Open and inspect package
        with zipfile.ZipFile(package_path, 'r') as zf:
            # Read manifest
            try:
                manifest_data = zf.read('manifest.json')
                manifest = json.loads(manifest_data)
                if verbose:
                    console.print(f"[dim]Parsed manifest.json[/dim]")
            except KeyError:
                console.print("[red]Invalid package: manifest.json not found[/red]")
                sys.exit(1)

            # Get file list
            file_list = zf.namelist()
            total_size = sum(zf.getinfo(f).file_size for f in file_list)

            if verbose:
                console.print(f"[dim]Found {len(file_list)} files, total size {total_size / 1024:.1f} KB[/dim]")

            # Build output
            output = f"{package_path.name}\n\n"
            output += "[bold cyan]Package Metadata:[/bold cyan]\n"
            output += f"  Name:        {manifest.get('name', 'Unknown')}\n"
            output += f"  Version:     {manifest.get('version', 'Unknown')}\n"
            output += f"  Description: {manifest.get('description', 'None')}\n"

            if detailed:
                output += f"  Author:      {manifest.get('author', 'Unknown')}\n"
                output += f"  License:     {manifest.get('license', 'Unknown')}\n"
                if manifest.get('homepage'):
                    output += f"  Homepage:    {manifest.get('homepage')}\n"

            # Contents
            output += f"\n[bold cyan]Contents ({len(file_list)} files):[/bold cyan]\n"

            # Group by type
            prompd_files = [f for f in file_list if f.endswith('.prmd')]
            readme_files = [f for f in file_list if f.lower().endswith('.md')]
            manifest_files = [f for f in file_list if f == 'manifest.json']
            other_files = [f for f in file_list if f not in prompd_files + readme_files + manifest_files]

            # Show files
            max_display = 10 if not detailed else len(file_list)
            displayed = 0

            for prompd_file in prompd_files[:max_display - displayed]:
                size = zf.getinfo(prompd_file).file_size
                output += f"  {prompd_file} ({size / 1024:.1f} KB)\n"
                displayed += 1

            for readme_file in readme_files[:max(1, max_display - displayed)]:
                size = zf.getinfo(readme_file).file_size
                output += f"  {readme_file} ({size / 1024:.1f} KB)\n"
                displayed += 1

            if detailed and other_files:
                for other_file in other_files[:max_display - displayed]:
                    size = zf.getinfo(other_file).file_size
                    output += f"  {other_file} ({size / 1024:.1f} KB)\n"
                    displayed += 1

            # Show truncation message
            remaining = len(file_list) - displayed
            if remaining > 0:
                output += f"  [dim]... (and {remaining} more files)[/dim]\n"

            # Dependencies
            deps = manifest.get('dependencies', {})
            if deps:
                output += f"\n[bold cyan]Dependencies ({len(deps)}):[/bold cyan]\n"
                for dep_name, dep_version in deps.items():
                    output += f"  {dep_name}@{dep_version}\n"
            else:
                output += f"\n[bold cyan]Dependencies:[/bold cyan] 0\n"

            output += f"\n[bold cyan]Package Size:[/bold cyan] {total_size / 1024:.1f} KB\n"

            console.print(Panel(output.strip(), title=f"Package: {package_path.name}"))

            # Offer to show README
            readme_file = next((f for f in file_list if f.lower() == 'readme.md'), None)
            if readme_file:
                from rich.prompt import Confirm
                show_readme = Confirm.ask("\nView README?", default=False)
                if show_readme:
                    readme_content = zf.read(readme_file).decode('utf-8')
                    from rich.markdown import Markdown
                    console.print("\n")
                    console.print(Markdown(readme_content))

    except Exception as e:
        console.print(f"[red]Error explaining package: {e}[/red]")
        if verbose:
            import traceback
            console.print(f"[dim]{traceback.format_exc()}[/dim]")
        sys.exit(1)


def _explain_registry_package(package_name: str, registry: Optional[str], detailed: bool, verbose: bool):
    """Explain a registry package - reuses registry info command logic."""
    if verbose:
        console.print(f"[dim]Querying registry for: {package_name}[/dim]")

    try:
        from prompd.registry import RegistryClient

        client = RegistryClient(registry_name=registry)

        if verbose:
            console.print(f"[dim]Using registry: {client.registry_url}[/dim]")

        info = client.get_package_info(package_name)

        if verbose:
            console.print(f"[dim]Received package info[/dim]")

        # Enhanced output based on registry info command
        output = f"{info.get('name')} (from registry)\n\n"
        output += "[bold cyan]Package Information:[/bold cyan]\n"
        output += f"  Name:        {info.get('name')}\n"
        output += f"  Latest:      {info.get('version')}\n"
        output += f"  Description: {info.get('description', 'No description')}\n"

        if detailed:
            output += f"  Author:      {info.get('author', 'Unknown')}\n"
            output += f"  License:     {info.get('license', 'Unknown')}\n"

            if info.get('homepage'):
                output += f"  Homepage:    {info.get('homepage')}\n"
            if info.get('repository'):
                output += f"  Repository:  {info.get('repository')}\n"

        output += f"  Downloads:   {info.get('downloads', 0):,}\n"
        if info.get('publishedAt'):
            output += f"  Published:   {info.get('publishedAt')}\n"

        # Tags
        if info.get('tags'):
            output += f"\nTags: {', '.join(info.get('tags'))}\n"

        # Available versions
        if 'versions' in info and info['versions']:
            version_list = info['versions']
            display_count = 10 if detailed else 5
            versions = version_list[:display_count]

            output += f"\n[bold cyan]Available Versions ({len(version_list)} total):[/bold cyan]\n"
            for v in versions:
                version_str = v.get('version') if isinstance(v, dict) else v
                date_str = f" - {v.get('publishedAt', '')}" if isinstance(v, dict) and detailed else ""
                output += f"  {version_str}{date_str}\n"

            if len(version_list) > display_count:
                output += f"  [dim](and {len(version_list) - display_count} more)[/dim]\n"

        # Dependencies
        if info.get('dependencies'):
            deps = info['dependencies']
            output += f"\n[bold cyan]Dependencies ({len(deps)}):[/bold cyan]\n"
            for dep_name, dep_version in deps.items():
                output += f"  {dep_name}@{dep_version}\n"
        else:
            output += f"\n[bold cyan]Dependencies:[/bold cyan] 0\n"

        output += f"\n[bold cyan]Install:[/bold cyan]\n"
        output += f"  prompd install {package_name}@{info.get('version')}\n"

        console.print(Panel(output.strip(), title=f"Registry Package: {package_name}"))

        # Offer to show README if available
        if info.get('readme'):
            from rich.prompt import Confirm
            show_readme = Confirm.ask("\nView README?", default=False)
            if show_readme:
                from rich.markdown import Markdown
                console.print("\n")
                console.print(Markdown(info['readme']))
        elif detailed and verbose:
            console.print("[dim]No README available for this package[/dim]")

    except Exception as e:
        if verbose:
            console.print(f"[dim]Error details: {str(e)}[/dim]")
            import traceback
            console.print(f"[dim]{traceback.format_exc()}[/dim]")
        console.print(f"[red]Error getting package info: {e}[/red]")
        sys.exit(1)


@cli.group()
def git():
    """Git operations for .prmd files."""
    pass


@git.command("add")
@click.argument("files", nargs=-1, required=True, type=click.Path(exists=True, path_type=Path))
@click.option("--verbose", "-v", is_flag=True, help="Show git output")
def git_add(files: tuple, verbose: bool):
    """Add .prmd files to git staging area."""
    try:
        for file_path in files:
            file_path = Path(file_path)
            if not file_path.suffix == ".prmd":
                console.print(f"[yellow]Skipping non-.prmd file:[/yellow] {file_path}")
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
    """Remove .prmd files from git tracking."""
    try:
        for file_path in files:
            file_path = Path(file_path)
            if not file_path.suffix == ".prmd":
                console.print(f"[yellow]Skipping non-.prmd file:[/yellow] {file_path}")
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
    """Show git status for .prmd files."""
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
            console.print("[green]No changes to .prmd files[/green]")
            return
        
        # Filter for .prmd files
        prompd_changes = []
        for line in result.stdout.strip().split('\n'):
            if '.prmd' in line:
                prompd_changes.append(line)
        
        if prompd_changes:
            console.print("[bold]Git status for .prmd files:[/bold]")
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
            console.print("[dim]No .prmd file changes[/dim]")
            
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Error checking status:[/red] {e.stderr}")
        sys.exit(1)


@git.command("commit")
@click.option("--message", "-m", required=True, help="Commit message")
@click.option("--all", "-a", is_flag=True, help="Automatically stage all modified .prmd files")
def git_commit(message: str, all: bool):
    """Commit staged .prmd files."""
    try:
        from prompd.security import validate_git_file_path, validate_git_message, SecurityError
        if all:
            # First add all modified .prmd files
            result = subprocess.run(
                ["git", "status", "--porcelain"],
                capture_output=True,
                text=True,
                check=True
            )
            
            for line in result.stdout.strip().split('\n'):
                if line and '.prmd' in line and line[0] == ' ' and line[1] == 'M':
                    file_path = line[3:]
                    try:
                        safe_path = validate_git_file_path(file_path)
                        subprocess.run(["git", "add", safe_path], check=True)
                        console.print(f"[dim]Auto-staging: {safe_path}[/dim]")
                    except SecurityError as e:
                        console.print(f"[red]Security warning: Skipping unsafe file path: {e}[/red]")
                        continue
        
        # Commit with validated message
        try:
            safe_message = validate_git_message(message)
        except SecurityError as e:
            console.print(f"[red]Error: Invalid commit message: {e}[/red]")
            raise click.Abort()
        
        result = subprocess.run(
            ["git", "commit", "-m", safe_message],
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
    """Checkout a specific version of a .prmd file.
    
    VERSION can be:
    - A semantic version (e.g., '1.2.3')
    - A git tag name
    - A commit hash
    - 'HEAD' for latest committed version
    - 'HEAD~1' for previous commit, etc.
    """
    try:
        file = Path(file)
        if not file.suffix == ".prmd":
            console.print(f"[red]Error:[/red] {file} is not a .prmd file")
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
    """Bump version in a .prmd file and create git tag."""
    
    from cli.python.prompd.parser import PrompdParser
    
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
    """Show version history for a .prmd file."""
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
    """Show differences between versions of a .prmd file."""
    try:
        version2 = version2 or "HEAD"
        diff_output = _git_diff_versions(file, version1, version2)
        
        if not diff_output:
            console.print(f"[green]No differences between {version1} and {version2}[/green]")
            return
        
        syntax = Syntax(diff_output, "diff", theme="monokai", line_numbers=True)
        console.print(Panel(syntax, title=f"Diff: {version1} -> {version2}"))
        
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


@version.command("validate")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--git", is_flag=True, help="Validate against git history")
def version_validate(file: Path, git: bool):
    """Validate version consistency."""
    
    from cli.python.prompd.parser import PrompdParser
    
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
    
    from cli.python.prompd.parser import PrompdParser
    from cli.python.prompd.validator import PrompdValidator
    try:
        parser = PrompdParser()
        validator = PrompdValidator()
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
    """Update version field in .prmd file."""
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
        from prompd.security import validate_git_file_path, validate_git_message, validate_version_string, SecurityError
        # Validate inputs for security
        safe_path = validate_git_file_path(str(file_path))
        safe_message = validate_git_message(message)
        safe_version = validate_version_string(version)
        
        # Add file to git
        subprocess.run(["git", "add", safe_path], check=True, capture_output=True)
        
        # Commit
        subprocess.run(["git", "commit", "-m", safe_message], check=True, capture_output=True)
        
        # Create tag (validate tag name components)
        safe_stem = validate_git_file_path(file_path.stem)
        tag_name = f"{safe_stem}-v{safe_version}"
        subprocess.run(["git", "tag", tag_name], check=True, capture_output=True)
        
    except SecurityError as e:
        raise Exception(f"Security validation failed: {e}")
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
@click.option('-k', '--api-key', help='API key for authentication')
@click.option('-u', '--username', help='Username for credential authentication')
@click.option('--password', help='Password for credential authentication')
@click.option('--registry', help='Registry to login to')
def login(api_key: Optional[str], username: Optional[str], password: Optional[str], registry: Optional[str]):
    """Login to package registry."""
    try:
        from .registry import RegistryClient
        
        client = RegistryClient(registry_name=registry)

        if api_key:
            result = client.login_with_token(api_key)
        elif username and password:
            result = client.login_with_credentials(username, password)
        else:
            # Interactive login
            import getpass
            username = click.prompt('Username')
            password = getpass.getpass('Password: ')
            result = client.login_with_credentials(username, password)
        
        console.print(f"[green]Success:[/green] Logged in to {client.registry_name} as {result.get('username', 'user')}")
        
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
        
        console.print(f"[green]Success:[/green] Logged out from {client.registry_name}")
        
    except Exception as e:
        console.print(f"[red]Logout failed:[/red] {e}")
        sys.exit(1)


@cli.command()
@click.argument('packages', nargs=-1, required=False)
@click.option('-g', '--global', 'global_install', is_flag=True, help='Install packages globally')
@click.option('--save', is_flag=True, default=True, help='Save to dependencies (default behavior)')
@click.option('--save-dev', is_flag=True, help='Save to development dependencies')
@click.option('--registry', help='Registry to install from')
def install(packages: tuple, global_install: bool, save: bool, save_dev: bool, registry: Optional[str]):
    """Install packages from registry.

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

        # Determine dependency type - save_dev takes precedence over save
        dev = save_dev

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
            # Create new manifest.json
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
            console.print(f"Installing {package_ref} {'globally' if global_install else 'locally'}...")
            
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
@click.option('--save-dev', is_flag=True, help='Remove from development dependencies')
def uninstall(packages: tuple, global_uninstall: bool, save_dev: bool):
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
                resolver.remove_dependency(package_name, dev=save_dev, global_uninstall=False)
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
@click.option('-l', '--limit', default=20, help='Maximum number of results')
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

            # Try multiple version field names from registry response
            version = (pkg.get('latestVersion') or
                      pkg.get('latest_version') or
                      pkg.get('version') or
                      pkg.get('currentVersion') or
                      'Unknown')

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
@click.option('-ns', '--namespace', help='Namespace to publish to (overrides current namespace context)')
@click.option('-n', '--dry-run', is_flag=True, help='Show what would be published without actually doing it')
def publish(package_file: Path, registry: Optional[str], namespace: Optional[str], dry_run: bool):
    """Publish package to registry."""
    try:
        import zipfile
        import json
        from .registry import RegistryClient

        if dry_run:
            console.print(f"[yellow]DRY RUN: Would publish {package_file}[/yellow]")
            return

        # Extract package information from manifest before upload
        package_name = "unknown"
        package_version = "unknown"
        try:
            with zipfile.ZipFile(package_file, 'r') as zf:
                if 'manifest.json' in zf.namelist():
                    # Ensure proper encoding handling
                    manifest_bytes = zf.read('manifest.json')
                    manifest_text = manifest_bytes.decode('utf-8', errors='replace')
                    manifest_data = json.loads(manifest_text)
                    package_name = manifest_data.get('id', manifest_data.get('name', 'unknown'))
                    package_version = manifest_data.get('version', 'unknown')

                    # If namespace is provided and package doesn't have a scope, add it
                    if namespace and not package_name.startswith('@'):
                        package_name = f"{namespace}/{package_name}"
        except Exception as e:
            # Silently fall back to unknown values if parsing fails
            pass

        console.print(f"[blue]Publishing {package_name}@{package_version}...[/blue]")
        console.print(f"[dim]Package: {package_file}[/dim]")

        client = RegistryClient(registry_name=registry)

        # Show registry info
        console.print(f"[dim]Registry: {client.registry_name} ({client.registry_url})[/dim]")

        # Show current namespace context
        current_ns = client.get_current_namespace()
        if namespace:
            console.print(f"[dim]Namespace: {namespace} (override)[/dim]")
        elif current_ns:
            console.print(f"[dim]Namespace: {current_ns} (current)[/dim]")
        else:
            console.print(f"[dim]Namespace: none (will use package scope or registry default)[/dim]")

        # Add upload progress
        file_size = package_file.stat().st_size
        console.print(f"[dim]Size: {file_size:,} bytes[/dim]")
        console.print("[yellow]Uploading...[/yellow]")

        # Handle namespace specification
        if namespace:
            # Override current namespace context for this publish
            result = client.publish_package(package_file, target_namespace=namespace)
        else:
            # Use current namespace context or default behavior
            result = client.publish_package(package_file)

        # Extract actual published info from registry response or use our pre-extracted values
        published_name = result.get('package', {}).get('fullName') or result.get('name') or package_name
        published_version = result.get('package', {}).get('version') or result.get('version') or package_version

        console.print(f"[green]SUCCESS[/green] Published {published_name}@{published_version}")
        console.print(f"  Registry: {client.registry_name}")
        if 'package_url' in result:
            console.print(f"  URL: {result['package_url']}")
        elif 'url' in result:
            console.print(f"  URL: {result['url']}")

    except Exception as e:
        console.print(f"[red]Publish failed:[/red] {e}")
        sys.exit(1)


# ================================================================================
# NAMESPACE MANAGEMENT COMMANDS
# ================================================================================

@cli.group(name='namespace')
def namespace():
    """Manage namespaces for organizations."""
    pass


# Add the 'ns' alias as a separate group
@cli.group(name='ns')
def ns():
    """Alias for namespace commands."""
    pass


# Add commands to ns group that delegate to namespace commands
@ns.command('list')
@click.option('--registry', help='Registry to query')
@click.option('--show-permissions', '-p', is_flag=True, help='Show detailed permissions for each namespace')
def ns_list(registry: Optional[str], show_permissions: bool):
    """List accessible namespaces."""
    return namespace_list(registry, show_permissions)


@ns.command('current')
@click.option('--registry', help='Registry to query')
def ns_current(registry: Optional[str]):
    """Show current namespace context."""
    # Call the actual namespace_current function directly
    return namespace_current(registry)


@ns.command('use')
@click.argument('namespace_name')
@click.option('--registry', help='Registry to use')
def ns_use(namespace_name: str, registry: Optional[str]):
    """Switch to a different namespace context."""
    return namespace_use(namespace_name, registry)


@ns.command('create')
@click.argument('namespace_name')
@click.option('--registry', help='Registry to use')
@click.option('--description', help='Namespace description')
def ns_create(namespace_name: str, registry: Optional[str], description: Optional[str]):
    """Create a new namespace."""
    return namespace_create(namespace_name, registry, description)


@namespace.command('list')
@click.option('--registry', help='Registry to query')
@click.option('--show-permissions', '-p', is_flag=True, help='Show detailed permissions for each namespace')
def namespace_list(registry: Optional[str], show_permissions: bool):
    """List accessible namespaces."""
    try:
        from .registry import RegistryClient
        
        client = RegistryClient(registry_name=registry)
        namespaces = client.list_user_namespaces()
        
        if not namespaces:
            console.print("[yellow]No namespaces available[/yellow]")
            console.print("\nTo get started:")
            console.print("-Free users can publish to @public automatically")
            console.print("-Create a team namespace: [cyan]prompd namespace create @my-company[/cyan]")
            return
        
        # Get current namespace context
        current_ns = client.get_current_namespace()
        
        console.print(f"[bold]Available namespaces ({len(namespaces)} total):[/bold]")
        
        from rich.table import Table
        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("NAMESPACE", style="cyan")
        table.add_column("PACKAGES", justify="right")
        table.add_column("DOWNLOADS", justify="right")
        table.add_column("ROLE", style="green")
        if show_permissions:
            table.add_column("PERMISSIONS", style="dim")
        table.add_column("STATUS", justify="center")
        
        for ns in namespaces:
            status = "[bold green]CURRENT[/bold green]" if ns['name'] == current_ns else ""
            if ns.get('verified'):
                status += " [OK]" if status else "[OK]"
            
            permissions_str = ""
            if show_permissions:
                perms = ns.get('permissions', {})
                perm_list = []
                if perms.get('canPublish'): perm_list.append('publish')
                if perms.get('canManage'): perm_list.append('manage')
                if perms.get('canInvite'): perm_list.append('invite')
                if perms.get('canDelete'): perm_list.append('delete')
                permissions_str = ', '.join(perm_list) or 'read'
            
            row = [
                ns['name'],
                str(ns.get('packageCount', 0)),
                str(ns.get('downloadCount', 0)),
                ns.get('role', 'read').upper(),
            ]
            if show_permissions:
                row.append(permissions_str)
            row.append(status)
            
            table.add_row(*row)
        
        console.print(table)
        
        if current_ns:
            console.print(f"\n[dim]Current namespace context: [cyan]{current_ns}[/cyan][/dim]")
        else:
            console.print("\n[dim]No current namespace context set[/dim]")
        
        console.print("\n[dim]Switch namespace: [cyan]prompd ns use <namespace>[/cyan][/dim]")
        
    except Exception as e:
        console.print(f"[red]Failed to list namespaces:[/red] {e}")
        sys.exit(1)


@namespace.command('current')
@click.option('--registry', help='Registry to query')
def namespace_current(registry: Optional[str]):
    """Show current namespace context."""
    try:
        from .registry import RegistryClient
        
        client = RegistryClient(registry_name=registry)
        current_ns = client.get_current_namespace()
        
        if current_ns:
            # Get namespace details
            details = client.get_namespace_details(current_ns)
            console.print(f"[bold]Current namespace:[/bold] [cyan]{current_ns}[/cyan]")
            
            if details:
                console.print(f"  Description: {details.get('description', 'No description')}")
                console.print(f"  Packages: {details.get('packageCount', 0)}")
                console.print(f"  Downloads: {details.get('downloadCount', 0)}")
                console.print(f"  Role: {details.get('role', 'unknown').upper()}")
                if details.get('verified'):
                    console.print("  Status: [green]Verified [OK][/green]")
        else:
            console.print("[yellow]No current namespace context set[/yellow]")
            console.print("\nSet a namespace context:")
            console.print("  [cyan]prompd ns use @public[/cyan]     # Use public namespace")
            console.print("  [cyan]prompd ns use @my-company[/cyan] # Use your team namespace")
        
    except Exception as e:
        console.print(f"[red]Failed to get current namespace:[/red] {e}")
        sys.exit(1)


@namespace.command('use')
@click.argument('namespace_name', required=True)
@click.option('--registry', help='Registry to use')
def namespace_use(namespace_name: str, registry: Optional[str]):
    """Switch to a different namespace context."""
    try:
        from .registry import RegistryClient
        
        # Normalize namespace name
        if not namespace_name.startswith('@'):
            namespace_name = '@' + namespace_name
        
        client = RegistryClient(registry_name=registry)

        # Just set the namespace context
        # In a real system, the registry will validate access when you try to publish
        client.set_current_namespace(namespace_name)
        
        console.print(f"[green]Success:[/green] Switched to namespace [cyan]{namespace_name}[/cyan]")
        console.print("\n[dim]Future publishes will use this namespace unless overridden with the -ns flag[/dim]")
        
    except Exception as e:
        console.print(f"[red]Failed to switch namespace:[/red] {e}")
        sys.exit(1)


@namespace.command('create')
@click.argument('namespace_name', required=True)
@click.option('--description', '-d', help='Description for the namespace')
@click.option('--organization', '-o', help='Organization ID to create namespace under')
@click.option('--visibility', type=click.Choice(['public', 'private']), default='public', help='Namespace visibility')
@click.option('--registry', help='Registry to create namespace in')
def namespace_create(namespace_name: str, description: Optional[str], organization: Optional[str], 
                    visibility: str, registry: Optional[str]):
    """Create a new namespace."""
    try:
        from .registry import RegistryClient
        
        # Normalize namespace name
        if not namespace_name.startswith('@'):
            namespace_name = '@' + namespace_name
        
        client = RegistryClient(registry_name=registry)
        
        # Prepare namespace data
        namespace_data = {
            'name': namespace_name,
            'visibility': visibility
        }
        
        if description:
            namespace_data['description'] = description
        if organization:
            namespace_data['organizationId'] = organization
        
        console.print(f"[bold]Creating namespace:[/bold] [cyan]{namespace_name}[/cyan]")
        
        result = client.create_namespace(namespace_data)
        
        if result.get('requiresVerification'):
            console.print(f"[yellow]Namespace requires verification[/yellow]")
            console.print(f"Reason: {result.get('reason')}")
            console.print(f"Request ID: {result.get('requestId')}")
            console.print("\nCheck verification status: [cyan]prompd ns verify-status @namespace[/cyan]")
        else:
            console.print(f"[green]Success:[/green] Namespace [cyan]{namespace_name}[/cyan] created successfully")
            
            # Automatically switch to the new namespace
            client.set_current_namespace(namespace_name)
            console.print(f"[dim]Automatically switched to namespace context[/dim]")
        
    except Exception as e:
        console.print(f"[red]Failed to create namespace:[/red] {e}")
        sys.exit(1)


# ================================================================================
# NS ALIAS COMMANDS
# ================================================================================

@ns.command('list')
@click.option('--registry', help='Registry to query')
@click.option('--show-permissions', '-p', is_flag=True, help='Show detailed permissions for each namespace')
def ns_list(registry: Optional[str], show_permissions: bool):
    """List accessible namespaces."""
    # Call the original function
    namespace_list(registry, show_permissions)


@ns.command('current')
@click.option('--registry', help='Registry to query')
def ns_current(registry: Optional[str]):
    """Show current namespace context."""
    # Call the original function
    namespace_current(registry)


@ns.command('use')
@click.argument('namespace_name', required=True)
@click.option('--registry', help='Registry to use')
def ns_use(namespace_name: str, registry: Optional[str]):
    """Switch to a different namespace context."""
    # Call the original function
    namespace_use(namespace_name, registry)


@ns.command('create')
@click.argument('namespace_name', required=True)
@click.option('--description', '-d', help='Description for the namespace')
@click.option('--organization', '-o', help='Organization ID to create namespace under')
@click.option('--visibility', type=click.Choice(['public', 'private']), default='public', help='Namespace visibility')
@click.option('--registry', help='Registry to create namespace in')
def ns_create(namespace_name: str, description: Optional[str], organization: Optional[str], 
             visibility: str, registry: Optional[str]):
    """Create a new namespace."""
    # Call the original function
    namespace_create(namespace_name, description, organization, visibility, registry)


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


@cache.command('clear')
@click.option('--global', 'clear_global', is_flag=True, help='Clear global cache')
@click.option('--local', 'clear_local', is_flag=True, help='Clear local cache')
@click.option('--all', 'clear_all', is_flag=True, help='Clear both caches')
def clear_cache(clear_global: bool, clear_local: bool, clear_all: bool):
    """Clear package cache."""
    try:
        from .package_resolver import PackageResolver
        
        resolver = PackageResolver()
        
        if clear_all:
            clear_global = clear_local = True
        elif not clear_global and not clear_local:
            clear_local = True  # Default to local

        resolver.clear_cache(clear_global=clear_global, clear_local=clear_local)

        cleared = []
        if clear_local:
            cleared.append("local")
        if clear_global:
            cleared.append("global")

        console.print(f"[green]Success:[/green] Cleared {' and '.join(cleared)} cache(s)")

    except Exception as e:
        console.print(f"[red]Failed to clear cache:[/red] {e}")
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
        import json
        
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
            from cli.python.prompd.parser import PrompdParser
            from .package_resolver import PackageResolver
            from cli.python.prompd.package_resolver import PackageReference
            
            resolver_inst = PackageResolver()
            config = resolver_inst.get_or_create_project_config()
            
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
        config = resolver_inst.get_or_create_project_config()
        
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
            console.print(f"  {update['package']}: {update['current']} -> {update['new']}")
        
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


# Package operations - imports moved to function level for faster startup


@cli.group()
def package():
    """Package management commands."""
    pass


@package.command('create')
@click.argument('source', type=click.Path(exists=True, path_type=Path))
@click.argument('output_path', type=click.Path(path_type=Path), required=False)
@click.option('-n', '--name', help='Package name (overrides manifest.json)')
@click.option('-V', '--version', help='Package version (overrides manifest.json)')
@click.option('-d', '--description', help='Package description (overrides manifest.json)')
@click.option('-a', '--author', help='Package author (overrides manifest.json)')
def package_create(source: Path, output_path: Optional[Path], name: Optional[str], version: Optional[str], description: Optional[str], author: Optional[str]):
    """Create a .pdpkg package from a directory. Uses manifest.json if present, smart defaults otherwise."""
    try:
        from prompd.registry import create_pdpkg, validate_pdpkg
        # Source must be a directory (no longer support .pdproj files)
        if not source.is_dir():
            console.print("[red]ERROR[/red] Source must be a directory")
            sys.exit(1)

        source_dir = source

        # Check for existing manifest.json in the directory
        manifest_path = source_dir / 'manifest.json'
        manifest_data = {}

        if manifest_path.exists():
            # Load existing manifest.json
            try:
                import json
                with open(manifest_path, 'r', encoding='utf-8') as f:
                    manifest_data = json.load(f)
                console.print(f"[dim]Found existing manifest.json[/dim]")
            except (json.JSONDecodeError, Exception) as e:
                console.print(f"[yellow]Warning: Could not read manifest.json: {e}[/yellow]")
                manifest_data = {}

        # Generate smart defaults with CLI overrides taking precedence
        proj_name = name or manifest_data.get('name', source_dir.name.lower().replace(' ', '-').replace('_', '-'))
        proj_version = version or manifest_data.get('version', '1.0.0')
        proj_description = description or manifest_data.get('description', f'Package created from {source_dir.name}')
        proj_author = author or manifest_data.get('author', 'unknown')

        # Default output path
        if not output_path:
            output_path = source_dir / f"{proj_name}-{proj_version}.pdpkg"
        
        # Ensure output has .pdpkg extension
        if not output_path.suffix:
            output_path = output_path.with_suffix('.pdpkg')
        elif output_path.suffix != '.pdpkg':
            output_path = output_path.with_suffix('.pdpkg')
        
        # Start with existing manifest data (if any) and update with new values
        manifest = manifest_data.copy() if manifest_data else {}

        # Update core fields (CLI overrides or loaded values)
        manifest['name'] = proj_name
        manifest['version'] = proj_version
        manifest['description'] = proj_description

        # Set defaults for fields that weren't in the existing manifest
        if 'license' not in manifest:
            manifest['license'] = 'MIT'
        if 'tags' not in manifest:
            manifest['tags'] = []
        if 'dependencies' not in manifest:
            manifest['dependencies'] = {}
        if 'keywords' not in manifest:
            manifest['keywords'] = []

        if proj_author:
            manifest['author'] = proj_author

        # Find .prmd and .pdflow files (ensure they are actual files, not directories)
        prompd_files = [f for f in source_dir.glob('**/*.prmd') if f.is_file()]
        pdflow_files = [f for f in source_dir.glob('**/*.pdflow') if f.is_file()]

        # Only auto-set main/files if not already in manifest
        if prompd_files and 'main' not in manifest:
            # Set main file (first .prmd file found)
            main_file = str(prompd_files[0].relative_to(source_dir)).replace('\\', '/')
            manifest['main'] = main_file

        # Only auto-set files array if not already in manifest
        if prompd_files and 'files' not in manifest:
            # If there are additional .prmd files, add them to files array
            if len(prompd_files) > 1:
                additional_files = [str(f.relative_to(source_dir)).replace('\\', '/') for f in prompd_files[1:]]
                manifest['files'] = additional_files

        if pdflow_files and 'workflows' not in manifest:
            manifest['workflows'] = [str(f.relative_to(source_dir)).replace('\\', '/') for f in pdflow_files]
        
        # Create package
        create_pdpkg(source_dir, output_path, manifest)
        
        console.print(f"[bold green]Package created successfully![/bold green]")
        console.print(f"   Package: [cyan]{output_path}[/cyan]")
        console.print(f"   Size: {output_path.stat().st_size / 1024:.1f} KB")
        
        # Validate the created package
        validate_pdpkg(output_path)
        console.print("[green]Package validation passed[/green]")
        
    except Exception as e:
        console.print(f"[bold red]Package creation failed:[/bold red] {e}")
        sys.exit(1)


@package.command('validate')
@click.argument('package_path', type=click.Path(exists=True, path_type=Path))
def package_validate(package_path: Path):
    """Validate a .pdpkg package archive."""
    try:
        from prompd.package_validator import validate_package
        # Check file extension - only accept package archives
        if not package_path.name.endswith('.pdpkg'):
            console.print(f"[red]ERROR[/red] [bold red]Invalid package format![/bold red]")
            console.print(f"   File: {package_path.name}")
            console.print("   Expected: .pdpkg archive file")
            console.print("   Note: .prmd files are individual prompts, not packages")
            console.print("   Use 'prompd validate' to validate individual .prmd files")
            sys.exit(1)
        
        console.print(f"[blue]INFO[/blue] Validating package: [cyan]{package_path.name}[/cyan]")
        
        result = validate_package(package_path)
        
        if result.is_valid:
            console.print("[green]SUCCESS[/green] [bold green]Package validation passed![/bold green]")
            
            # Show package info if available
            if result.package_info:
                info = result.package_info
                console.print(f"   Package: [cyan]{info.get('name', 'unknown')}[/cyan]")
                console.print(f"   Version: [green]{info.get('version', 'unknown')}[/green]")
                console.print(f"   Description: {info.get('description', 'No description')}")
                
                if 'parameters' in info:
                    console.print(f"   Parameters: {len(info['parameters'])}")
        else:
            console.print("[red]ERROR[/red] [bold red]Package validation failed![/bold red]")
            
            for error in result.errors:
                console.print(f"   - [red]{error}[/red]")
        
        # Show warnings if any
        if result.warnings:
            console.print("\n[yellow]WARNINGS:[/yellow]")
            for warning in result.warnings:
                console.print(f"   - [yellow]{warning}[/yellow]")
        
        if not result.is_valid:
            sys.exit(1)
        
    except Exception as e:
        console.print(f"[red]ERROR[/red] [bold red]Validation failed:[/bold red] {e}")
        sys.exit(1)


# Alias for package create
@cli.command('pack')
@click.argument('source', type=click.Path(exists=True, path_type=Path))
@click.argument('output_path', type=click.Path(path_type=Path), required=False)
@click.option('-n', '--name', help='Package name (overrides manifest.json)')
@click.option('-V', '--version', help='Package version (overrides manifest.json)')
@click.option('-d', '--description', help='Package description (overrides manifest.json)')
@click.option('-a', '--author', help='Package author (overrides manifest.json)')
def pack_alias(source: Path, output_path: Optional[Path], name: Optional[str], version: Optional[str], description: Optional[str], author: Optional[str]):
    """Create a .pdpkg package from a directory (alias for 'package create')."""
    # Call the same logic as package create directly
    package_create.callback(source, output_path, name, version, description, author)


@cli.command("create")
@click.argument("file", type=click.Path(path_type=Path))
@click.option("-i", "--interactive", is_flag=True, help="Interactive mode with prompts")
@click.option("-n", "--name", help="Prompt name")
@click.option("-d", "--description", help="Prompt description")
@click.option("-a", "--author", help="Author name")
@click.option("-v", "--version", default="1.0.0", help="Version (default: 1.0.0)")
@click.option("-t", "--template", type=click.Choice(['basic', 'analysis', 'security', 'code-review', 'creative']),
              help="Use a predefined template")
def create_command(file: Path, interactive: bool, name: str, description: str,
                  author: str, version: str, template: str):
    """Create a new .prmd file"""
    from prompd.commands.create import create_prmd_file

    try:
        create_prmd_file(
            file_path=file,
            interactive=interactive,
            name=name,
            description=description,
            author=author,
            version=version,
            template=template
        )
        console.print(f"[green]OK[/green] Created {file}")
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


@cli.command()
@click.argument('path', default='.', type=click.Path(path_type=Path))
@click.option('--name', help='Project name (default: directory name)')
@click.option('--version', default='1.0.0', help='Initial version (default: 1.0.0)')
@click.option('--description', help='Project description')
@click.option('--author', help='Project author')
def init(path: Path, name: Optional[str], version: str, description: Optional[str], author: Optional[str]):
    """Initialize a new Prompd project with manifest.json."""
    from rich.console import Console

    console = Console()

    # Resolve the path
    project_dir = path.resolve()

    # Create directory if it doesn't exist
    if not project_dir.exists():
        project_dir.mkdir(parents=True, exist_ok=True)
        console.print(f"[green]OK[/green] Created directory: {project_dir}")

    # Check if manifest.json already exists
    manifest_path = project_dir / 'manifest.json'
    if manifest_path.exists():
        console.print(f"[yellow]Warning:[/yellow] manifest.json already exists in {project_dir}")
        if not click.confirm("Overwrite existing manifest.json?"):
            console.print("[red]Aborted[/red]")
            return

    # Generate smart defaults
    default_name = name or project_dir.name.lower().replace(' ', '-').replace('_', '-')
    default_description = description or f"Prompd project: {default_name}"
    default_author = author or "unknown"

    # Create manifest.json
    manifest_data = {
        "name": default_name,
        "version": version,
        "description": default_description,
        "author": default_author,
        "files": [
            "*.prmd",
            "*.md",
            "templates/",
            "docs/",
            "examples/"
        ],
        "ignore": [
            "*.log",
            "*.tmp",
            ".env*"
        ],
        "dependencies": {},
        "devDependencies": {}
    }

    # Write manifest.json
    import json
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest_data, f, indent=2, ensure_ascii=False)

    console.print(f"[green]OK[/green] Created manifest.json")
    console.print(f"[green]OK[/green] Initialized Prompd project: {default_name}")

    # Create a sample .prmd file if none exists
    sample_prmd = project_dir / 'example.prmd'
    if not any(project_dir.glob('*.prmd')):
        sample_content = f"""---
name: {default_name}-example
version: {version}
description: Example prompt for {default_name}
parameters:
  name:
    type: string
    required: true
    description: Name to greet
---

# Example Prompt

Hello {{{{ name }}}}! Welcome to {default_name}.

This is an example .prmd file to get you started.

## Usage
```bash
prompd run example.prmd --provider openai --model gpt-4o -p name="World"
```
"""

        with open(sample_prmd, 'w', encoding='utf-8') as f:
            f.write(sample_content)

        console.print(f"[green]OK[/green] Created example.prmd")

    console.print(f"\n[bold]Project initialized![/bold]")
    console.print(f"  Directory: {project_dir}")
    console.print(f"  Name: {default_name}")
    console.print(f"  Version: {version}")
    console.print(f"\n[dim]Next steps:[/dim]")
    console.print(f"  cd {project_dir.name if project_dir != Path.cwd() else '.'}")
    console.print(f"  prompd validate example.prmd")
    console.print(f"  prompd pack . -o {default_name}-{version}.pdpkg")


def main():
    """Main entry point."""
    cli()


if __name__ == "__main__":
    main()
