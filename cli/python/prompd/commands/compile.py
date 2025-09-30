"""Implementation of the `prompd compile` command."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import click

from prompd.commands.common import console


@click.command(name="compile", context_settings=dict(ignore_unknown_options=True, allow_extra_args=True))
@click.argument("source", type=str)
@click.option(
    "--to",
    "output_format",
    default="markdown",
    help="Output format (markdown | provider-json [openai|anthropic] | provider-json:openai)",
)
@click.option("--to-markdown", is_flag=True, help="Shorthand for --to markdown")
@click.option(
    "--to-provider-json",
    type=click.Choice(["openai", "anthropic"]),
    help="Shorthand for --to provider-json <provider>",
)
@click.option("-p", "--param", multiple=True, help="Parameter in format key=value (repeat for multiple)")
@click.option(
    "-f",
    "--params-file",
    type=click.Path(exists=True, path_type=Path),
    multiple=True,
    help="Load parameters from JSON file (repeatable)",
)
@click.option("-o", "--output", type=click.Path(), help="Write compiled output to file")
@click.option("-v", "--verbose", is_flag=True, help="Verbose output")
@click.pass_context
def compile_command(
    ctx,
    source: str,
    output_format: str,
    to_markdown: bool,
    to_provider_json: Optional[str],
    param: Tuple[str, ...],
    params_file: Tuple[Path, ...],
    output: Optional[str],
    verbose: bool,
):
    """Compile a .prmd file or package reference to a target format."""
    try:
        source_path = Path(source)
        package_pattern = r"^(@[\w.-]+/[\w.-]+|[\w.-]+)@([\w.-]+)/(.+\.prmd)$"
        match = re.match(package_pattern, source)

        if match:
            package_ref = f"{match.group(1)}@{match.group(2)}"
            file_path_in_package = match.group(3)

            if verbose:
                console.print(f"[cyan]Resolving package:[/cyan] {package_ref}")
                console.print(f"[cyan]File path:[/cyan] {file_path_in_package}")

            from prompd.package_resolver import PackageResolver

            resolver = PackageResolver()
            try:
                package_path = resolver.resolve_package(package_ref)
                source_path = package_path / file_path_in_package

                if not source_path.exists():
                    console.print(f"[red]File not found in package:[/red] {file_path_in_package}")
                    console.print(f"[yellow]Package location:[/yellow] {package_path}")
                    raise SystemExit(1)

                if verbose:
                    console.print(f"[green]Resolved to:[/green] {source_path}")
            except Exception as exc:
                console.print(f"[red]Failed to resolve package:[/red] {exc}")
                raise SystemExit(1)
        elif not source_path.exists():
            if "@" in source and "/" not in source.split("@")[-1]:
                from prompd.package_resolver import PackageResolver

                resolver = PackageResolver()
                try:
                    package_path = resolver.resolve_package(source)
                    manifest_file = package_path / "manifest.json"
                    if manifest_file.exists():
                        with open(manifest_file, "r", encoding="utf-8") as mf:
                            manifest = json.load(mf)
                        main_file = manifest.get("main")
                        if main_file:
                            source_path = package_path / main_file
                            if verbose:
                                console.print(f"[green]Using main file:[/green] {main_file}")
                except Exception:
                    pass

            if not source_path.exists():
                console.print(f"[red]File not found:[/red] {source}")
                raise SystemExit(1)

        parameters: Dict[str, Any] = {}
        if params_file:
            for pf in params_file:
                try:
                    data = json.loads(Path(pf).read_text(encoding="utf-8"))
                    if isinstance(data, dict):
                        parameters.update(data)
                except Exception as exc:
                    console.print(f"[red]Error loading params file {pf}:[/red] {exc}")
                    raise SystemExit(1)

        if param:
            for kv in param:
                if "=" not in kv:
                    console.print(f"[red]Invalid parameter:[/red] {kv}. Use key=value")
                    raise SystemExit(1)
                key, value = kv.split("=", 1)

                try:
                    if value.strip().startswith(("{", "[")):
                        parameters[key] = json.loads(value)
                    elif value.lower() in ("true", "false"):
                        parameters[key] = value.lower() == "true"
                    elif value.replace(".", "").replace("-", "").isdigit() and value.count(".") <= 1:
                        parameters[key] = float(value) if "." in value else int(value)
                    else:
                        parameters[key] = value
                except json.JSONDecodeError:
                    parameters[key] = value

        if to_markdown:
            output_format = "markdown"
        elif to_provider_json:
            output_format = f"provider-json:{to_provider_json}"
        else:
            extra = list(getattr(ctx, "args", []) or [])
            if output_format.strip().lower() == "provider-json" and extra:
                next_tok = extra[0]
                if next_tok and not next_tok.startswith("-"):
                    output_format = f"provider-json:{next_tok}"
                    try:
                        ctx.args = extra[1:]
                    except Exception:
                        pass

        if verbose:
            try:
                console.print(
                    f"[dim]Compiling {source} -> {output_format} with params: {list(parameters.keys())}[/dim]"
                )
            except Exception:
                pass

        from prompd.compiler import PrompdCompiler

        compiler = PrompdCompiler()
        result = compiler.compile(
            source=source,
            output_format=output_format,
            parameters=parameters,
            output_file=Path(output) if output else None,
            verbose=verbose,
        )

        if output:
            try:
                console.print(f"[green]OK[/green] Compiled output written to {output}")
            except Exception:
                print(f"OK - Compiled output written to {output}")
        else:
            print(result)
    except SystemExit:
        raise
    except Exception as exc:
        try:
            console.print(f"[red]Error compiling:[/red] {exc}")
        except Exception:
            print(f"Error compiling: {exc}")
        raise SystemExit(1)


__all__ = ["compile_command"]
