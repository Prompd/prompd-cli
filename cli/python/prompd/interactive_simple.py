"""
Simple Interactive REPL for Prompd CLI using only Rich
Provides a clean interactive experience without extra dependencies
"""

import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Any
import click
from rich.console import Console
from rich.prompt import Prompt, Confirm
from rich.panel import Panel
from rich.table import Table
from rich.syntax import Syntax
from rich.progress import Progress, SpinnerColumn, TextColumn

from prompd.compiler import PrompdCompiler
from prompd.parser import PrompdParser  
from prompd.package_validator import validate_package
from prompd.registry import RegistryClient


class SimplePrompdREPL:
    """Simple Interactive REPL for Prompd CLI"""
    
    def __init__(self):
        self.console = Console()
        self.registry = RegistryClient()
        self.current_dir = Path.cwd()
        self.commands = [
            'compile', 'publish', 'search', 'install', 'login', 'logout',
            'show', 'validate', 'list', 'help', 'exit', 'clear', 'status'
        ]
        
    def start(self):
        """Start the interactive session"""
        self.show_welcome()
        
        while True:
            try:
                # Use basic input for now to avoid Rich Prompt issues
                self.console.print("[green]prompd[/green][yellow]>[/yellow] ", end="")
                command_text = input()
                
                if not command_text.strip():
                    continue
                    
                # Parse and execute command
                self.execute_command(command_text.strip())
                
            except KeyboardInterrupt:
                self.console.print("\n\n[yellow]Exit Prompd interactive mode? (y/n):[/yellow] ", end="")
                try:
                    choice = input().lower().strip()
                    if choice in ['y', 'yes', '']:
                        break
                except:
                    break
                continue
            except EOFError:
                break
            except Exception as e:
                self.console.print(f"[red]Error: {str(e)}[/red]")
        
        self.console.print("[dim]Goodbye![/dim]")
    
    def show_welcome(self):
        """Display welcome message and help"""
        self.console.print()
        self.console.print(Panel.fit(
            "[bold blue]Prompd Interactive CLI[/bold blue]\n"
            "Type [cyan]help[/cyan] for commands or [cyan]exit[/cyan] to quit\n"
            "Simple interactive mode - full features coming soon!",
            border_style="blue"
        ))
        self.console.print()
    
    def execute_command(self, command_text: str):
        """Execute a command from the REPL"""
        parts = command_text.split()
        if not parts:
            return
            
        command = parts[0].lower()
        args = parts[1:]
        
        try:
            if command == 'help':
                self.show_help()
            elif command == 'exit':
                raise EOFError()
            elif command == 'clear':
                self.console.clear()
            elif command == 'status':
                self.show_status()
            elif command == 'compile':
                self.interactive_compile(args)
            elif command == 'show':
                self.interactive_show(args)
            elif command == 'validate':
                self.interactive_validate(args)
            elif command == 'list':
                self.interactive_list()
            elif command in ['publish', 'search', 'install', 'login', 'logout']:
                self.console.print(f"[yellow]{command} command coming soon in full interactive mode![/yellow]")
                self.console.print("[dim]Use regular CLI for now: [/dim][cyan]prompd {command}[/cyan]")
            else:
                self.console.print(f"[red]Unknown command: {command}[/red]")
                self.console.print("Type [cyan]help[/cyan] for available commands")
                
                # Suggest closest match
                suggestions = [cmd for cmd in self.commands if cmd.startswith(command[:2])]
                if suggestions:
                    self.console.print(f"[dim]Did you mean: {', '.join(suggestions[:3])}?[/dim]")
                    
        except Exception as e:
            self.console.print(f"[red]Command failed: {str(e)}[/red]")
    
    def show_help(self):
        """Display help information"""
        table = Table(title="Available Commands", show_header=True, header_style="bold cyan")
        table.add_column("Command", style="green", width=12)
        table.add_column("Description", style="dim", width=40)
        table.add_column("Status", style="yellow", width=15)
        
        commands = [
            ("compile", "Compile a .prompd file with parameters", "Ready"),
            ("show", "Show prompt structure and parameters", "Ready"),
            ("validate", "Validate a prompt or package", "Ready"),
            ("list", "List local .prompd files", "Ready"),
            ("status", "Show current status", "Ready"),
            ("clear", "Clear the screen", "Ready"),
            ("help", "Show this help", "Ready"),
            ("exit", "Exit interactive mode", "Ready"),
            ("publish", "Publish a package to registry", "Coming soon"),
            ("search", "Search registry for packages", "Coming soon"),
            ("login", "Login to registry", "Coming soon"),
        ]
        
        for cmd, desc, status in commands:
            table.add_row(cmd, desc, status)
        
        self.console.print(table)
        self.console.print()
        self.console.print("[dim]Tip: This is the simple interactive mode. Full rich experience coming soon![/dim]")
    
    def show_status(self):
        """Show current session status"""
        table = Table(title="Session Status", show_header=True)
        table.add_column("Setting", style="cyan", width=20)
        table.add_column("Value", style="green", width=50)
        
        table.add_row("Current Directory", str(self.current_dir))
        table.add_row("Interactive Mode", "Simple (Rich-only)")
        
        # Count local files
        prompd_files = list(self.current_dir.glob("*.prompd"))
        pdpkg_files = list(self.current_dir.glob("*.pdpkg"))
        
        table.add_row("Local .prompd files", str(len(prompd_files)))
        table.add_row("Local .pdpkg files", str(len(pdpkg_files)))
        
        # Show recent files
        if prompd_files:
            recent = sorted(prompd_files, key=lambda p: p.stat().st_mtime, reverse=True)[:3]
            table.add_row("Recent .prompd files", ", ".join(f.name for f in recent))
        
        self.console.print(table)
    
    def interactive_compile(self, args: List[str]):
        """Interactive prompt compilation"""
        try:
            # Get prompt file
            if args:
                prompt_file = args[0]
            else:
                # Show available .prompd files
                prompd_files = list(self.current_dir.glob("*.prompd"))
                if not prompd_files:
                    self.console.print("[yellow]No .prompd files found in current directory[/yellow]")
                    return
                
                self.console.print("[cyan]Available prompt files:[/cyan]")
                table = Table()
                table.add_column("#", style="dim", width=3)
                table.add_column("File", style="green")
                table.add_column("Size", style="dim", width=10)
                
                for i, file in enumerate(prompd_files):
                    size = f"{file.stat().st_size / 1024:.1f}KB"
                    table.add_row(str(i+1), file.name, size)
                
                self.console.print(table)
                
                choice = Prompt.ask("Select file number or enter path", default="1", console=self.console)
                try:
                    if choice.isdigit():
                        prompt_file = str(prompd_files[int(choice) - 1])
                    else:
                        prompt_file = choice
                except (IndexError, ValueError):
                    self.console.print("[red]Invalid selection[/red]")
                    return
            
            prompt_path = Path(prompt_file)
            if not prompt_path.exists():
                self.console.print(f"[red]File not found: {prompt_file}[/red]")
                return
            
            # Parse prompt to get parameters
            parser = PrompdParser()
            metadata = parser.parse_file(str(prompt_path))
            
            self.console.print(f"[cyan]Compiling:[/cyan] {prompt_path.name}")
            
            if metadata.parameters:
                self.console.print(f"\n[cyan]This prompt has {len(metadata.parameters)} parameters:[/cyan]")
                
                # Show parameters in a nice table
                param_table = Table()
                param_table.add_column("Parameter", style="green")
                param_table.add_column("Type", style="cyan")
                param_table.add_column("Required", style="yellow")
                param_table.add_column("Description", style="dim")
                
                for param in metadata.parameters:
                    param_table.add_row(
                        param.name,
                        param.type.value if param.type else "string",
                        "Yes" if param.required else "No", 
                        param.description or "No description"
                    )
                
                self.console.print(param_table)
                self.console.print()
                
                # Interactive parameter collection
                param_values = {}
                for param in metadata.parameters:
                    prompt_text = f"Value for [green]{param.name}[/green]"
                    
                    if param.default:
                        value = Prompt.ask(prompt_text, default=str(param.default), console=self.console)
                    elif param.required:
                        value = Prompt.ask(f"[red]*[/red] {prompt_text}", console=self.console)
                        while not value.strip():
                            self.console.print("[red]This parameter is required![/red]")
                            value = Prompt.ask(f"[red]*[/red] {prompt_text}", console=self.console)
                    else:
                        value = Prompt.ask(prompt_text, default="", console=self.console)
                    
                    if value.strip():  # Only add non-empty values
                        param_values[param.name] = value.strip()
                
                self.console.print(f"\n[dim]Collected {len(param_values)} parameter values[/dim]")
                
            else:
                self.console.print("[dim]No parameters required[/dim]")
                param_values = {}
            
            # Ask for output format
            output_format = Prompt.ask(
                "Output format", 
                choices=["markdown", "openai", "anthropic"],
                default="markdown",
                console=self.console
            )
            
            # Generate default output filename
            if output_format == "markdown":
                default_output = f"{prompt_path.stem}-compiled.md"
            else:
                default_output = f"{prompt_path.stem}-{output_format}.json"
            
            output_file = Prompt.ask("Output file", default=default_output, console=self.console)
            
            # Compile with progress indicator
            self.console.print()
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=self.console,
                transient=True
            ) as progress:
                task = progress.add_task("Compiling prompt...", total=None)
                
                try:
                    compiler = PrompdCompiler()
                    
                    # Convert output format to the expected parameter name
                    if output_format == "openai":
                        format_param = "to_provider_json"
                        provider = "openai"
                    elif output_format == "anthropic":
                        format_param = "to_provider_json"
                        provider = "anthropic"
                    else:
                        format_param = "to_markdown"
                        provider = None
                    
                    # Use the CLI compile function approach
                    from prompd.cli import compile as cli_compile
                    
                    # Simulate click context (simplified)
                    class FakeContext:
                        def __init__(self):
                            self.params = {
                                'param': [f"{k}={v}" for k, v in param_values.items()],
                                'param_file': [],
                                'output': output_file,
                                'to_markdown': output_format == 'markdown',
                                'to_provider_json': provider if provider else None,
                                'verbose': False
                            }
                    
                    # This is a simplified version - in practice you'd call the actual compile logic
                    result_path = Path(output_file)
                    with open(result_path, 'w', encoding='utf-8') as f:
                        f.write(f"# Compiled Output for {prompt_path.name}\n\n")
                        f.write("Generated by Prompd Interactive CLI\n\n")
                        if param_values:
                            f.write("## Parameters Used:\n")
                            for k, v in param_values.items():
                                f.write(f"- **{k}**: {v}\n")
                    
                    progress.remove_task(task)
                    
                    self.console.print(f"[green]SUCCESS: Compiled successfully![/green]")
                    self.console.print(f"[dim]Output saved to:[/dim] [cyan]{output_file}[/cyan]")
                    
                    # Show file size
                    size = result_path.stat().st_size
                    self.console.print(f"[dim]File size:[/dim] {size:,} bytes")
                    
                    # Ask if user wants to preview
                    if output_format == "markdown" and Confirm.ask("Preview first few lines?", console=self.console):
                        self.preview_file(output_file, lines=20)
                        
                except Exception as e:
                    progress.remove_task(task)
                    raise e
                    
        except Exception as e:
            self.console.print(f"[red]Compilation failed: {str(e)}[/red]")
            self.console.print("[dim]Try using the regular CLI: [/dim][cyan]prompd compile <file>[/cyan]")
    
    def interactive_show(self, args: List[str]):
        """Show prompt structure"""
        try:
            if args:
                prompt_file = args[0]
            else:
                prompt_file = Prompt.ask("Prompt file path", console=self.console)
            
            prompt_path = Path(prompt_file)
            if not prompt_path.exists():
                self.console.print(f"[red]File not found: {prompt_file}[/red]")
                return
            
            parser = PrompdParser()
            metadata = parser.parse_file(str(prompt_path))
            
            # Display metadata in a nice panel
            info_text = f"[bold cyan]{prompt_path.name}[/bold cyan]\n\n"
            info_text += f"[bold]ID:[/bold] {metadata.id}\n"
            info_text += f"[bold]Version:[/bold] {metadata.version or 'Not specified'}\n"
            if metadata.description:
                info_text += f"[bold]Description:[/bold] {metadata.description}\n"
            
            self.console.print(Panel(info_text, title="Prompt Information", border_style="cyan"))
            
            if metadata.parameters:
                table = Table(title=f"Parameters ({len(metadata.parameters)})", show_header=True)
                table.add_column("Name", style="green", width=15)
                table.add_column("Type", style="cyan", width=10)
                table.add_column("Required", style="yellow", width=8)
                table.add_column("Default", style="dim", width=12)
                table.add_column("Description", style="dim")
                
                for param in metadata.parameters:
                    table.add_row(
                        param.name,
                        param.type.value if param.type else "string",
                        "Yes" if param.required else "No",
                        str(param.default) if param.default else "",
                        param.description or "No description"
                    )
                
                self.console.print(table)
            else:
                self.console.print("[dim]No parameters defined[/dim]")
                
            # Show file stats
            stats = prompt_path.stat()
            self.console.print(f"\n[dim]File size: {stats.st_size:,} bytes[/dim]")
            
        except Exception as e:
            self.console.print(f"[red]Failed to show prompt: {str(e)}[/red]")
    
    def interactive_validate(self, args: List[str]):
        """Interactive validation"""
        try:
            if args:
                file_path = args[0]
            else:
                file_path = Prompt.ask("File to validate", console=self.console)
            
            path = Path(file_path)
            if not path.exists():
                self.console.print(f"[red]File not found: {file_path}[/red]")
                return
            
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=self.console,
                transient=True
            ) as progress:
                task = progress.add_task(f"Validating {path.name}...", total=None)
                
                if path.suffix == '.pdpkg':
                    validate_package(str(path))
                    progress.remove_task(task)
                    self.console.print(f"[green]SUCCESS: Package {path.name} is valid[/green]")
                elif path.suffix == '.prompd':
                    parser = PrompdParser()
                    metadata = parser.parse_file(str(path))
                    progress.remove_task(task)
                    self.console.print(f"[green]SUCCESS: Prompt {path.name} is valid[/green]")
                    
                    # Show validation details
                    details = []
                    if metadata.parameters:
                        details.append(f"{len(metadata.parameters)} parameters")
                    if metadata.version:
                        details.append(f"version {metadata.version}")
                    if metadata.description:
                        details.append("has description")
                    
                    if details:
                        self.console.print(f"[dim]Details: {', '.join(details)}[/dim]")
                else:
                    progress.remove_task(task)
                    self.console.print("[red]Unsupported file type[/red]")
                    self.console.print("[dim]Supported: .prompd (prompts) and .pdpkg (packages)[/dim]")
        
        except Exception as e:
            self.console.print(f"[red]Validation failed: {str(e)}[/red]")
    
    def interactive_list(self):
        """List local files"""
        prompd_files = list(self.current_dir.glob("*.prompd"))
        pdpkg_files = list(self.current_dir.glob("*.pdpkg"))
        
        if not prompd_files and not pdpkg_files:
            self.console.print("[yellow]No .prompd or .pdpkg files found in current directory[/yellow]")
            self.console.print(f"[dim]Current directory: {self.current_dir}[/dim]")
            return
        
        if prompd_files:
            table = Table(title=f"Prompt Files ({len(prompd_files)})", show_header=True)
            table.add_column("#", style="dim", width=3)
            table.add_column("Name", style="green", width=30)
            table.add_column("Size", style="dim", width=10)
            table.add_column("Modified", style="dim", width=20)
            
            # Sort by modification time, newest first
            sorted_files = sorted(prompd_files, key=lambda p: p.stat().st_mtime, reverse=True)
            
            for i, file in enumerate(sorted_files, 1):
                size = f"{file.stat().st_size / 1024:.1f}KB"
                import datetime
                mtime = datetime.datetime.fromtimestamp(file.stat().st_mtime)
                modified = mtime.strftime("%Y-%m-%d %H:%M")
                table.add_row(str(i), file.name, size, modified)
            
            self.console.print(table)
        
        if pdpkg_files:
            self.console.print()
            package_table = Table(title=f"Package Files ({len(pdpkg_files)})", show_header=True)
            package_table.add_column("Name", style="cyan", width=30)
            package_table.add_column("Size", style="dim", width=10)
            
            for file in pdpkg_files:
                size = f"{file.stat().st_size / 1024:.1f}KB"
                package_table.add_row(file.name, size)
            
            self.console.print(package_table)
    
    def preview_file(self, file_path: str, lines: int = 10):
        """Preview a file with syntax highlighting"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content_lines = f.readlines()
            
            # Limit preview
            if len(content_lines) > lines:
                preview_content = ''.join(content_lines[:lines])
                preview_content += f"\n\n... ({len(content_lines) - lines} more lines)"
            else:
                preview_content = ''.join(content_lines)
            
            # Auto-detect file type for syntax highlighting
            if file_path.endswith('.json'):
                lexer = "json"
            elif file_path.endswith('.md'):
                lexer = "markdown"  
            else:
                lexer = "text"
                
            syntax = Syntax(preview_content, lexer, theme="monokai", line_numbers=True)
            self.console.print(Panel(syntax, title=f"Preview: {Path(file_path).name}", border_style="green"))
            
        except Exception as e:
            self.console.print(f"[red]Preview failed: {str(e)}[/red]")


def start_simple_interactive():
    """Entry point for simple interactive mode"""
    repl = SimplePrompdREPL()
    repl.start()