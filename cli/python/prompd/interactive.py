"""
Interactive REPL for Prompd CLI
Provides a rich interactive experience for prompt compilation and package management
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
from prompt_toolkit import PromptSession
from prompt_toolkit.completion import WordCompleter, PathCompleter, Completer, Completion
from prompt_toolkit.auto_suggest import AutoSuggestFromHistory
from prompt_toolkit.shortcuts import confirm
from prompt_toolkit.formatted_text import HTML

from prompd.compiler import PrompdCompiler
from prompd.parser import PrompdParser  
from prompd.package_validator import validate_package
from prompd.registry import RegistryClient
from prompd.models import PrompdMetadata


class PrompdCompleter(Completer):
    """Smart completion for Prompd commands and files"""
    
    def __init__(self):
        self.commands = [
            'compile', 'publish', 'search', 'install', 'login', 'logout',
            'show', 'validate', 'list', 'help', 'exit', 'clear', 'status'
        ]
        self.path_completer = PathCompleter(
            only_directories=False,
            file_filter=lambda path: path.suffix in ['.prmd', '.pdpkg', '.json']
        )
    
    def get_completions(self, document, complete_event):
        text = document.text_before_cursor
        words = text.split()
        
        if not words or (len(words) == 1 and not text.endswith(' ')):
            # Complete command names
            for cmd in self.commands:
                if cmd.startswith(text.lower()):
                    yield Completion(cmd, start_position=-len(text))
        elif words[0] in ['compile', 'show', 'validate']:
            # Complete .prmd files for these commands
            for completion in self.path_completer.get_completions(document, complete_event):
                yield completion
        elif words[0] in ['publish', 'install']:
            # Complete .pdpkg files for these commands
            for completion in self.path_completer.get_completions(document, complete_event):
                if completion.text.endswith('.pdpkg'):
                    yield completion


class PrompdREPL:
    """Interactive REPL for Prompd CLI"""
    
    def __init__(self):
        self.console = Console()
        self.session = PromptSession(
            completer=PrompdCompleter(),
            auto_suggest=AutoSuggestFromHistory(),
            complete_while_typing=True,
            mouse_support=True,
            enable_history_search=True
        )
        self.registry = RegistryClient()
        self.current_dir = Path.cwd()
        self.session_context = {}
        
    def start(self):
        """Start the interactive session"""
        self.show_welcome()
        
        while True:
            try:
                # Get command from user
                command_text = self.session.prompt(
                    HTML('<ansigreen>prompd</ansigreen><ansiyellow>></ansiyellow> '),
                    complete_while_typing=True
                )
                
                if not command_text.strip():
                    continue
                    
                # Parse and execute command
                self.execute_command(command_text.strip())
                
            except KeyboardInterrupt:
                if Confirm.ask("\n\nExit Prompd interactive mode?", default=True):
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
            "Use [yellow]Tab[/yellow] for completion and [yellow]↑↓[/yellow] for history",
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
            elif command == 'publish':
                self.interactive_publish(args)
            elif command == 'search':
                self.interactive_search(args)
            elif command == 'show':
                self.interactive_show(args)
            elif command == 'validate':
                self.interactive_validate(args)
            elif command == 'list':
                self.interactive_list(args)
            elif command == 'login':
                self.interactive_login()
            elif command == 'logout':
                self.interactive_logout()
            else:
                self.console.print(f"[red]Unknown command: {command}[/red]")
                self.console.print("Type [cyan]help[/cyan] for available commands")
        except Exception as e:
            self.console.print(f"[red]Command failed: {str(e)}[/red]")
    
    def show_help(self):
        """Display help information"""
        table = Table(title="Available Commands", show_header=True, header_style="bold cyan")
        table.add_column("Command", style="green")
        table.add_column("Description", style="dim")
        table.add_column("Example", style="yellow")
        
        commands = [
            ("compile", "Compile a .prmd file with parameters", "compile my-prompt.prmd"),
            ("publish", "Publish a package to registry", "publish my-package.pdpkg"),
            ("search", "Search registry for packages", "search security"),
            ("show", "Show prompt structure and parameters", "show prompt.prmd"),
            ("validate", "Validate a prompt or package", "validate prompt.prmd"),
            ("list", "List local .prmd files", "list"),
            ("login", "Login to registry", "login"),
            ("logout", "Logout from registry", "logout"),
            ("status", "Show current status", "status"),
            ("clear", "Clear the screen", "clear"),
            ("help", "Show this help", "help"),
            ("exit", "Exit interactive mode", "exit")
        ]
        
        for cmd, desc, example in commands:
            table.add_row(cmd, desc, example)
        
        self.console.print(table)
        self.console.print()
        self.console.print("[dim]Tip: Use Tab for completion and ↑↓ for command history[/dim]")
    
    def show_status(self):
        """Show current session status"""
        table = Table(title="Session Status")
        table.add_column("Setting", style="cyan")
        table.add_column("Value", style="green")
        
        table.add_row("Current Directory", str(self.current_dir))
        table.add_row("Registry URL", self.registry.base_url if hasattr(self.registry, 'base_url') else "Not configured")
        table.add_row("Logged In", "Yes" if self.registry.is_authenticated() else "No")
        
        # Count local files
        prompd_files = list(self.current_dir.glob("*.prmd"))
        pdpkg_files = list(self.current_dir.glob("*.pdpkg"))
        
        table.add_row("Local .prmd files", str(len(prompd_files)))
        table.add_row("Local .pdpkg files", str(len(pdpkg_files)))
        
        self.console.print(table)
    
    def interactive_compile(self, args: List[str]):
        """Interactive prompt compilation"""
        # Get prompt file
        if args:
            prompt_file = args[0]
        else:
            # Show available .prmd files
            prompd_files = list(self.current_dir.glob("*.prmd"))
            if not prompd_files:
                self.console.print("[yellow]No .prmd files found in current directory[/yellow]")
                return
            
            self.console.print("[cyan]Available prompt files:[/cyan]")
            for i, file in enumerate(prompd_files):
                self.console.print(f"  {i+1}. {file.name}")
            
            choice = Prompt.ask("Select file number or enter path", default="1")
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
        
        try:
            # Parse prompt to get parameters
            parser = PrompdParser()
            metadata = parser.parse_file(str(prompt_path))
            
            if metadata.parameters:
                self.console.print(f"\n[cyan]Parameters for {prompt_path.name}:[/cyan]")
                
                # Interactive parameter collection
                param_values = {}
                for param in metadata.parameters:
                    prompt_text = f"{param.name}"
                    if param.description:
                        prompt_text += f" ({param.description})"
                    
                    if param.default:
                        value = Prompt.ask(prompt_text, default=str(param.default))
                    elif param.required:
                        value = Prompt.ask(f"[red]*[/red] {prompt_text}")
                    else:
                        value = Prompt.ask(prompt_text, default="")
                    
                    if value:  # Only add non-empty values
                        param_values[param.name] = value
                
                # Ask for output format
                output_format = Prompt.ask(
                    "Output format", 
                    choices=["markdown", "openai", "anthropic"],
                    default="markdown"
                )
                
                # Ask for output file
                default_output = f"{prompt_path.stem}-compiled.md"
                if output_format != "markdown":
                    default_output = f"{prompt_path.stem}-{output_format}.json"
                
                output_file = Prompt.ask("Output file", default=default_output)
                
                # Compile with progress indicator
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[progress.description]{task.description}"),
                    console=self.console
                ) as progress:
                    task = progress.add_task("Compiling prompt...", total=None)
                    
                    try:
                        compiler = PrompdCompiler()
                        result = compiler.compile(
                            str(prompt_path),
                            parameters=param_values,
                            output_format=output_format,
                            output_file=output_file
                        )
                        progress.remove_task(task)
                        
                        self.console.print(f"[green]✓[/green] Compiled successfully!")
                        self.console.print(f"[dim]Output: {output_file}[/dim]")
                        
                        # Ask if user wants to preview
                        if output_format == "markdown" and Confirm.ask("Preview output?", default=False):
                            self.preview_file(output_file)
                        
                    except Exception as e:
                        progress.remove_task(task)
                        raise e
            else:
                self.console.print("[yellow]No parameters required for this prompt[/yellow]")
                # Simple compilation without parameters
                compiler = PrompdCompiler()
                result = compiler.compile(str(prompt_path), parameters={}, output_format="markdown")
                self.console.print(f"[green]✓[/green] Compiled successfully!")
        
        except Exception as e:
            self.console.print(f"[red]Compilation failed: {str(e)}[/red]")
    
    def interactive_publish(self, args: List[str]):
        """Interactive package publishing"""
        if not self.registry.is_authenticated():
            self.console.print("[yellow]Not logged in. Please login first.[/yellow]")
            if Confirm.ask("Login now?"):
                self.interactive_login()
                if not self.registry.is_authenticated():
                    return
            else:
                return
        
        # Get package file
        if args:
            package_file = args[0]
        else:
            pdpkg_files = list(self.current_dir.glob("*.pdpkg"))
            if not pdpkg_files:
                self.console.print("[yellow]No .pdpkg files found in current directory[/yellow]")
                return
            
            self.console.print("[cyan]Available package files:[/cyan]")
            for i, file in enumerate(pdpkg_files):
                self.console.print(f"  {i+1}. {file.name}")
            
            choice = Prompt.ask("Select file number or enter path", default="1")
            try:
                if choice.isdigit():
                    package_file = str(pdpkg_files[int(choice) - 1])
                else:
                    package_file = choice
            except (IndexError, ValueError):
                self.console.print("[red]Invalid selection[/red]")
                return
        
        package_path = Path(package_file)
        if not package_path.exists():
            self.console.print(f"[red]File not found: {package_file}[/red]")
            return
        
        # Validate package first
        self.console.print("[dim]Validating package...[/dim]")
        try:
            validate_package(str(package_path))
            self.console.print("[green]✓[/green] Package validation passed")
        except Exception as e:
            self.console.print(f"[red]Package validation failed: {str(e)}[/red]")
            return
        
        # Confirm publication
        if not Confirm.ask(f"Publish {package_path.name} to registry?"):
            return
        
        # Publish with progress
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=self.console
        ) as progress:
            task = progress.add_task("Publishing package...", total=None)
            
            try:
                result = self.registry.publish_package(str(package_path))
                progress.remove_task(task)
                self.console.print(f"[green]✓[/green] Package published successfully!")
                
            except Exception as e:
                progress.remove_task(task)
                self.console.print(f"[red]Publication failed: {str(e)}[/red]")
    
    def interactive_search(self, args: List[str]):
        """Interactive registry search"""
        if args:
            query = " ".join(args)
        else:
            query = Prompt.ask("Search query")
        
        if not query:
            return
        
        try:
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=self.console
            ) as progress:
                task = progress.add_task(f"Searching for '{query}'...", total=None)
                results = self.registry.search_packages(query)
                progress.remove_task(task)
            
            if results:
                table = Table(title=f"Search Results for '{query}'")
                table.add_column("Package", style="green")
                table.add_column("Version", style="cyan")
                table.add_column("Description", style="dim")
                
                for result in results:
                    table.add_row(
                        result.get('name', 'Unknown'),
                        result.get('version', 'Unknown'),
                        result.get('description', 'No description')
                    )
                
                self.console.print(table)
            else:
                self.console.print(f"[yellow]No packages found matching '{query}'[/yellow]")
                
        except Exception as e:
            self.console.print(f"[red]Search failed: {str(e)}[/red]")
    
    def interactive_show(self, args: List[str]):
        """Show prompt structure"""
        if args:
            prompt_file = args[0]
        else:
            prompt_file = Prompt.ask("Prompt file path")
        
        prompt_path = Path(prompt_file)
        if not prompt_path.exists():
            self.console.print(f"[red]File not found: {prompt_file}[/red]")
            return
        
        try:
            parser = PrompdParser()
            metadata = parser.parse_file(str(prompt_path))
            
            # Display metadata
            self.console.print(f"\n[bold cyan]{prompt_path.name}[/bold cyan]")
            self.console.print(f"[dim]ID:[/dim] {metadata.id}")
            if metadata.description:
                self.console.print(f"[dim]Description:[/dim] {metadata.description}")
            
            if metadata.parameters:
                table = Table(title="Parameters")
                table.add_column("Name", style="green")
                table.add_column("Type", style="cyan")
                table.add_column("Required", style="yellow")
                table.add_column("Default", style="dim")
                table.add_column("Description", style="dim")
                
                for param in metadata.parameters:
                    table.add_row(
                        param.name,
                        param.type.value if param.type else "string",
                        "Yes" if param.required else "No",
                        str(param.default) if param.default else "",
                        param.description or ""
                    )
                
                self.console.print(table)
            else:
                self.console.print("[dim]No parameters[/dim]")
        
        except Exception as e:
            self.console.print(f"[red]Failed to parse prompt: {str(e)}[/red]")
    
    def interactive_validate(self, args: List[str]):
        """Interactive validation"""
        if args:
            file_path = args[0]
        else:
            file_path = Prompt.ask("File to validate")
        
        path = Path(file_path)
        if not path.exists():
            self.console.print(f"[red]File not found: {file_path}[/red]")
            return
        
        try:
            if path.suffix == '.pdpkg':
                validate_package(str(path))
                self.console.print(f"[green]✓[/green] Package {path.name} is valid")
            elif path.suffix == '.prmd':
                parser = PrompdParser()
                parser.parse_file(str(path))
                self.console.print(f"[green]✓[/green] Prompt {path.name} is valid")
            else:
                self.console.print("[red]Unsupported file type. Use .prmd or .pdpkg files[/red]")
        
        except Exception as e:
            self.console.print(f"[red]Validation failed: {str(e)}[/red]")
    
    def interactive_list(self, args: List[str]):
        """List local files"""
        prompd_files = list(self.current_dir.glob("*.prmd"))
        pdpkg_files = list(self.current_dir.glob("*.pdpkg"))
        
        if prompd_files or pdpkg_files:
            table = Table(title=f"Files in {self.current_dir}")
            table.add_column("Name", style="green")
            table.add_column("Type", style="cyan")
            table.add_column("Size", style="dim")
            
            for file in prompd_files:
                size = f"{file.stat().st_size / 1024:.1f} KB"
                table.add_row(file.name, "Prompt", size)
            
            for file in pdpkg_files:
                size = f"{file.stat().st_size / 1024:.1f} KB"
                table.add_row(file.name, "Package", size)
            
            self.console.print(table)
        else:
            self.console.print("[yellow]No .prmd or .pdpkg files found in current directory[/yellow]")
    
    def interactive_login(self):
        """Interactive login"""
        self.console.print("[cyan]Registry Login[/cyan]")
        token = Prompt.ask("API Token", password=True)
        
        try:
            self.registry.login(token)
            self.console.print("[green]✓[/green] Login successful!")
        except Exception as e:
            self.console.print(f"[red]Login failed: {str(e)}[/red]")
    
    def interactive_logout(self):
        """Interactive logout"""
        try:
            self.registry.logout()
            self.console.print("[green]✓[/green] Logged out successfully")
        except Exception as e:
            self.console.print(f"[red]Logout failed: {str(e)}[/red]")
    
    def preview_file(self, file_path: str):
        """Preview a file with syntax highlighting"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Limit preview to first 50 lines
            lines = content.split('\n')
            if len(lines) > 50:
                content = '\n'.join(lines[:50]) + '\n\n... (truncated)'
            
            syntax = Syntax(content, "markdown", theme="monokai", line_numbers=True)
            self.console.print(Panel(syntax, title=f"Preview: {file_path}", border_style="green"))
            
        except Exception as e:
            self.console.print(f"[red]Preview failed: {str(e)}[/red]")


def start_interactive():
    """Entry point for interactive mode"""
    repl = PrompdREPL()
    repl.start()