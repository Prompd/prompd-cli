"""Implementation of the `prompd run` command."""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Dict, Optional, Tuple

import click

from prompd.commands.common import console, is_valid_semver
from prompd.exceptions import ConfigurationError, PrompdError, ProviderError


def _parse_metadata_overrides(ctx) -> Dict[str, str]:
    """Parse dynamic --meta:* flags from Click's context arguments."""
    metadata_overrides: Dict[str, str] = {}
    try:
        extra_args = list(ctx.args) if hasattr(ctx, "args") else []
        i = 0
        while i < len(extra_args):
            token = extra_args[i]
            if isinstance(token, str) and token.startswith("--meta:"):
                section = token.split(":", 1)[1]
                if i + 1 < len(extra_args):
                    val = extra_args[i + 1]
                    metadata_overrides[f"meta:{section}"] = str(val)
                    i += 2
                    continue
            i += 1
    except Exception:
        # Best-effort; ignore parsing errors
        pass
    return metadata_overrides


def _resolve_defaults(provider: Optional[str], model: Optional[str], verbose: bool) -> Tuple[Optional[str], Optional[str]]:
    """Resolve default provider/model values from configuration when omitted."""
    try:
        from prompd.config import PrompdConfig

        cfg = PrompdConfig.load()

        if not provider:
            provider = cfg.default_provider
            if not provider:
                for cand in ["openai", "anthropic", "ollama"]:
                    if cand == "ollama":
                        provider = cand
                        break
                    if cfg.get_api_key(cand):
                        provider = cand
                        break
            if verbose and provider:
                console.print(f"[dim]Using default provider: {provider}[/dim]")

        if not model:
            model = cfg.default_model
            if not model and provider:
                if provider == "openai":
                    model = "gpt-4o"
                elif provider == "anthropic":
                    model = "claude-3-haiku-20240307"
                elif provider == "ollama":
                    model = "llama2"
            if verbose and model:
                console.print(f"[dim]Using default model: {model}[/dim]")
    except Exception:
        pass

    return provider, model


def _run_impl(
    ctx,
    file: Path,
    provider: Optional[str],
    model: Optional[str],
    param: Tuple[str, ...],
    param_file: Tuple[Path, ...],
    api_key: Optional[str],
    output: Optional[str],
    output_format: str,
    version: Optional[str],
    verbose: bool,
    show_usage: bool,
):
    import asyncio
    import json
    import tempfile

    actual_file = file
    temp_file: Optional[Path] = None

    try:
        if version:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".prmd", delete=False, encoding="utf-8") as tmp:
                temp_file = Path(tmp.name)

                if is_valid_semver(version):
                    tag_name = f"{file.stem}-v{version}"
                    tag_check = subprocess.run(
                        ["git", "tag", "-l", tag_name],
                        capture_output=True,
                        text=True,
                    )
                    version_ref = tag_name if tag_check.stdout.strip() else version
                else:
                    version_ref = version

                git_path = str(file).replace("\\", "/")
                result = subprocess.run(
                    ["git", "show", f"{version_ref}:{git_path}"],
                    capture_output=True,
                    text=True,
                    check=True,
                )

                tmp.write(result.stdout)
                actual_file = temp_file

                if verbose:
                    console.print(f"[dim]Using version {version} of {file}[/dim]")

        metadata_overrides = _parse_metadata_overrides(ctx)

        from prompd.executor import PrompdExecutor

        provider, model = _resolve_defaults(provider, model, verbose)

        cli_params = list(param) if param else None
        param_files = [Path(p) for p in param_file] if param_file else None

        response = asyncio.run(
            PrompdExecutor().execute(
                prompd_file=actual_file,
                provider=provider,
                model=model,
                cli_params=cli_params,
                param_files=param_files,
                api_key=api_key,
                metadata_overrides=metadata_overrides or None,
            )
        )

        if temp_file and temp_file.exists():
            temp_file.unlink()

        if output_format == "json":
            result = {
                "response": response.content,
                "provider": provider,
                "model": model,
                "file": str(file),
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
            if output:
                with open(output, "w", encoding="utf-8") as f:
                    f.write(response.content)
                try:
                    console.print(f"[green]OK[/green] Response written to {output}")
                except UnicodeEncodeError:
                    print(f"OK - Response written to {output}")
            else:
                from rich.panel import Panel

                try:
                    console.print(
                        Panel(
                            response.content,
                            title=f"Response from {provider}/{model}",
                            border_style="green",
                        )
                    )
                except UnicodeEncodeError:
                    print(f"\n--- Response from {provider}/{model} ---")
                    print(response.content)
                    print("-" * 50)

                if (verbose or show_usage) and response.usage:
                    try:
                        console.print(f"\n[dim]Usage: {response.usage}[/dim]")
                    except UnicodeEncodeError:
                        print(f"\nUsage: {response.usage}")
    except ConfigurationError as exc:
        try:
            console.print(f"[red]Configuration Error:[/red] {exc}")
        except UnicodeEncodeError:
            print(f"Configuration Error: {exc}")
        raise SystemExit(1)
    except ProviderError as exc:
        try:
            console.print(f"[red]Provider Error:[/red] {exc}")
        except UnicodeEncodeError:
            print(f"Provider Error: {exc}")
        raise SystemExit(1)
    except PrompdError as exc:
        try:
            console.print(f"[red]Error:[/red] {exc}")
        except UnicodeEncodeError:
            print(f"Error: {exc}")
        raise SystemExit(1)
    except Exception as exc:
        try:
            console.print(f"[red]Unexpected error:[/red] {exc}")
            if verbose:
                import traceback

                console.print(traceback.format_exc())
        except UnicodeEncodeError:
            print(f"Unexpected error: {exc}")
            if verbose:
                import traceback

                print(traceback.format_exc())
        raise SystemExit(1)


@click.command(name="run", context_settings=dict(ignore_unknown_options=True))
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--provider", required=False, help="LLM provider (openai, anthropic, ollama). Defaults from config if omitted")
@click.option("--model", required=False, help="Model name. Defaults from config/provider if omitted")
@click.option("--param", "-p", multiple=True, help="Parameter in format key=value")
@click.option(
    "--param-file",
    "-f",
    type=click.Path(exists=True, path_type=Path),
    multiple=True,
    help="JSON parameter file",
)
@click.option("--api-key", help="API key override")
@click.option("--output", "-o", type=click.Path(), help="Output file path")
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["text", "json"]),
    default="text",
    help="Output format",
)
@click.option("--version", help="Execute a specific version (e.g., '1.2.3', 'HEAD', commit hash)")
@click.option("--verbose", "-v", is_flag=True, help="Verbose output")
@click.option("--show-usage", is_flag=True, help="Show token usage statistics")
@click.pass_context
def run(
    ctx,
    file: Path,
    provider: Optional[str],
    model: Optional[str],
    param: Tuple[str, ...],
    param_file: Tuple[str, ...],
    api_key: Optional[str],
    output: Optional[str],
    output_format: str,
    version: Optional[str],
    verbose: bool,
    show_usage: bool,
):
    """Run a .prmd file with an LLM provider (supports --meta:* flags)."""
    return _run_impl(
        ctx,
        file,
        provider,
        model,
        param,
        param_file,
        api_key,
        output,
        output_format,
        version,
        verbose,
        show_usage,
    )


__all__ = ["run"]
