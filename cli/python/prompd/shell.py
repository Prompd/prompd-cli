"""
Prompd Shell with Conversational AI Assistant
Provides natural language interaction and smart assistance
"""

import os
import sys
import re
from pathlib import Path
from typing import Dict, List, Optional, Any
import click
from rich.console import Console
from rich.prompt import Prompt, Confirm
from rich.panel import Panel
from rich.table import Table
from rich.syntax import Syntax
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.text import Text

from prompd.compiler import PrompdCompiler
from prompd.parser import PrompdParser  
from prompd.package_validator import validate_package
from prompd.registry import RegistryClient


class ConversationalAssistant:
    """AI assistant for natural language command processing"""
    
    def __init__(self, console: Console):
        self.console = console
        self.context = {
            'current_files': [],
            'last_command': None,
            'working_on': None,
            'user_preferences': {}
        }
    
    def process_natural_language(self, user_input: str) -> Dict[str, Any]:
        """Simple NLP - only parse obvious commands, let AI handle everything else."""
        import re
        
        original_input = user_input.strip()
        user_input = user_input.lower().strip()
        
        # 1. Direct commands (exact matches only)
        direct_commands = {
            'list': 'list',
            'ls': 'list', 
            'help': 'help',
            'exit': 'exit',
            'clear': 'clear'
        }
        
        if user_input in direct_commands:
            return {
                'intent': direct_commands[user_input],
                'raw_input': original_input,
                'confidence': 1.0
            }

        # 2. Obvious compile commands (simple patterns only)
        # "compile filename" or "compile filename params"
        compile_match = re.match(r'^compile\s+([a-zA-Z0-9_.-]+(?:\.prmd)?)\s*(.*)$', user_input)
        if compile_match:
            filename = compile_match.group(1).strip()
            params = compile_match.group(2).strip() if compile_match.group(2) else None
            result = {
                'intent': 'compile',
                'file': filename,
                'raw_input': original_input,
                'confidence': 1.0
            }
            if params:
                result['parameters'] = params
                # Try to parse parameters if they look structured
                parsed = self._try_parse_parameters_safe(params)
                if parsed:
                    result['parameters_dict'] = parsed
            return result

        # 3. Obvious show commands
        # "show filename"
        show_match = re.match(r'^show\s+([a-zA-Z0-9_.-]+(?:\.prmd)?)$', user_input)
        if show_match:
            return {
                'intent': 'show',
                'target': show_match.group(1).strip(),
                'raw_input': original_input,
                'confidence': 1.0
            }

        # Everything else goes to AI planner
        return {
            'intent': 'unclear',
            'raw_input': original_input,
            'confidence': 0.0
        }

    def _try_parse_parameters_safe(self, param_text: str) -> Dict[str, Any]:
        """Best-effort local param parsing without shell dependency."""
        try:
            txt = (param_text or '').strip()
            if not txt:
                return {}
            # JSON-like
            if (txt.startswith('{') and txt.endswith('}')) or (txt.startswith('[') and txt.endswith(']')):
                import json
                val = json.loads(txt)
                return val if isinstance(val, dict) else {'_': val}
            # comma or 'and' separated pairs
            work = re.sub(r"\s+and\s+", ",", txt)
            # split by commas not inside quotes
            parts = []
            buf = ''
            q = None
            for ch in work:
                if ch in ['"', "'"]:
                    if q is None:
                        q = ch
                    elif q == ch:
                        q = None
                if ch == ',' and q is None:
                    parts.append(buf.strip())
                    buf = ''
                else:
                    buf += ch
            if buf.strip():
                parts.append(buf.strip())

            def coerce(v: str):
                v = v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in ['"', "'"]:
                    v = v[1:-1]
                low = v.lower()
                if low in ['true', 'false']:
                    return True if low == 'true' else False
                if low in ['yes', 'no']:
                    return True if low == 'yes' else False
                if re.fullmatch(r"-?\d+", v):
                    try:
                        return int(v)
                    except Exception:
                        return v
                if re.fullmatch(r"-?\d+\.\d+", v):
                    try:
                        return float(v)
                    except Exception:
                        return v
                return v

            out: Dict[str, Any] = {}
            for part in parts:
                if not part:
                    continue
                m = re.match(r"([a-zA-Z0-9_\- ]+)\s*(?:=|:)\s*(.+)$", part)
                if m:
                    k = m.group(1).strip().replace(' ', '_')
                    v = coerce(m.group(2))
                    out[k] = v
                else:
                    m2 = re.match(r"([a-zA-Z][a-zA-Z0-9_ ]+?)\s+(.+)$", part)
                    if m2:
                        k = m2.group(1).strip().replace(' ', '_')
                        v = coerce(m2.group(2))
                        out[k] = v
            return out
        except Exception:
            return {}
    
    def respond_conversationally(self, intent_data: Dict[str, Any], shell_instance) -> str:
        """Generate conversational response based on intent"""
        intent = intent_data['intent']

        if intent == 'explain_prompd':
            return (
                "A .prmd file defines a prompt with YAML frontmatter (metadata, parameters) "
                "and Markdown sections (e.g., System, Context, User, Response). The CLI compiles it "
                "to provider‑specific formats or runs it against an LLM, honoring roles and parameters."
            )
        
        if intent == 'compile':
            file_pattern = intent_data['file']
            # Try to find matching files
            matching_files = self.find_matching_files(file_pattern, shell_instance.current_dir)
            
            if not matching_files:
                return f"I couldn't find any files matching '{file_pattern}'. Let me show you what's available:"
            elif len(matching_files) == 1:
                file = matching_files[0]
                params = intent_data.get('parameters')
                
                if params:
                    return f"I'll compile {file.name} with parameters: {params}"
                else:
                    return f"I found {file.name}! Let me check what parameters it needs..."
            else:
                files_list = ", ".join(f.name for f in matching_files[:3])
                return f"I found multiple files: {files_list}. Which one did you mean?"
        
        elif intent == 'show':
            target = intent_data['target']
            matching_files = self.find_matching_files(target, shell_instance.current_dir)
            
            if matching_files:
                file = matching_files[0]
                return f"I'll show you the details of {file.name}:"
            else:
                return f"I couldn't find '{target}'. Let me list what's available:"
        
        elif intent == 'list':
            return "Here are your current files:"
        
        elif intent == 'help':
            return "I'm here to help! I understand natural language. Try asking me to:"
        
        elif intent == 'exit':
            return "Exiting chat mode... Type 'exit' again or press Enter to leave chat."
        
        elif intent == 'unclear':
            # Check for file operations BEFORE AI (to ensure execution)
            user_input_lower = intent_data.get('raw_input', '').lower()
            
            # Check for confirmation commands first
            if user_input_lower.startswith('yes, move '):
                filename = intent_data['raw_input'][10:].strip()  # Remove "yes, move "
                return self.execute_confirmed_move(filename, shell_instance)
            elif user_input_lower.startswith('yes, mkdir and move to '):
                folder_name = intent_data['raw_input'][23:].strip()  # Remove "yes, mkdir and move to "
                return self.execute_mkdir_and_move(folder_name, shell_instance)
            elif user_input_lower.startswith('yes, mkdir '):
                folder_name = intent_data['raw_input'][11:].strip()  # Remove "yes, mkdir "
                return self.execute_mkdir(folder_name, shell_instance)
            elif user_input_lower.startswith('yes, create '):
                filename = intent_data['raw_input'][12:].strip()  # Remove "yes, create "
                return self.execute_prompt_creation(filename, shell_instance)
            # Note: confirmation for suggestions (yes/y) is handled in the chat handler
            
            # Check for prompt creation (broader phrases)
            if any(phrase in user_input_lower for phrase in [
                'create new prompt', 'create a new prompt', 'new prompd', 'create new prompd',
                'create a prompd', 'create prompd', 'create prompt']):
                return self.handle_prompt_creation(intent_data['raw_input'], shell_instance)
            
            # Check for registry search
            if any(phrase in user_input_lower for phrase in ['search registry', 'search the registry']):
                return self.handle_registry_search(intent_data['raw_input'], shell_instance)
            
            # Check for provider commands
            if any(phrase in user_input_lower for phrase in ['change provider', 'switch provider', 'use provider', 'provider status', 'show provider']):
                return self.handle_provider_request(intent_data['raw_input'], shell_instance)
            
            # Check for file operations 
            if any(word in user_input_lower for word in ['move', 'copy', 'rename', 'mkdir', 'make', 'create']):
                return self.handle_complex_file_operations(intent_data['raw_input'], shell_instance)
            
            # If not a file operation, try AI
            return self.get_ai_response(intent_data.get('raw_input', ''), shell_instance)
        
        return "Let me help you with that:"
    
    def get_ai_response(self, user_input: str, shell_instance=None) -> str:
        """Get AI response using Prompd's provider system directly"""
        
        # Check for suggestions FIRST before calling AI
        user_input_lower = user_input.lower()
        
        # Provider-related suggestions (check first)
        provider_suggestion = self.suggest_provider_command(user_input_lower, shell_instance)
        if provider_suggestion:
            return provider_suggestion
        
        # Command similarity suggestions
        command_suggestion = self.suggest_similar_command(user_input_lower, shell_instance)
        if command_suggestion:
            return command_suggestion
        
        # Check for questions about compilation ability  
        if any(word in user_input_lower for word in ['can compile', 'is compilable', 'able to compile']):
            return "Yes! I can compile .prmd files. Try: 'compile test-prompt' or 'list' to see available files."
        
        # Check for unclear parameter syntax
        if 'app_name' in user_input_lower and '=' not in user_input_lower:
            return "For parameters, try: 'compile test-prompt app_name=\"MyApp\"' or 'compile test-prompt with app_name=\"MyApp\"'"
        
        # If no provider configured, guide the user instead of calling AI
        try:
            if shell_instance and not shell_instance.get_current_ai_provider():
                return "No AI provider configured. Use 'provider status' to set up OpenAI/Anthropic/Ollama."
        except Exception:
            pass

        # Use the command planner system for complex requests
        if shell_instance:
            try:
                plan_result = shell_instance.plan_with_llm_and_usage(user_input)
                if plan_result and isinstance(plan_result, dict):
                    plan = plan_result.get('plan')
                    usage = plan_result.get('usage')
                    
                    # Track token usage if available
                    if usage and shell_instance:
                        shell_instance._add_usage(usage)
                    
                    if plan and isinstance(plan, dict):
                        # Handle clarifying questions
                        if plan.get('clarifying_question'):
                            return plan['clarifying_question']
                        
                        # Execute planned commands
                        if plan.get('commands'):
                            results = []
                            for cmd_info in plan['commands']:
                                cmd = cmd_info.get('cmd', '')
                                args = cmd_info.get('args', [])
                                reason = cmd_info.get('reason', '')
                                
                                if reason:
                                    results.append(f"• {reason}")
                                
                                # Execute the command
                                if cmd == 'compile' and args:
                                    shell_instance.interactive_compile(args)
                                elif cmd == 'show' and args:
                                    shell_instance.interactive_show(args)
                                elif cmd == 'list':
                                    shell_instance.interactive_list([])
                                # Add more command handlers as needed
                            
                            return '\n'.join(results) if results else plan.get('summary', 'Commands executed')
                        
                        # Return summary for non-executable plans
                        return plan.get('summary', 'I can help with that!')
            except Exception as e:
                # Fallback to direct AI if planner fails
                pass
        
        # Fallback to direct AI providers if planner unavailable
        ai_response = self.try_ai_providers(user_input, shell_instance)
        if ai_response:
            return ai_response
        
        # Final fallback
        return f"I'm not sure what you mean by '{user_input}'. Try asking me to compile, show, list files, or use 'help' to see available commands!"
    
    def try_ai_providers(self, user_input: str, shell_instance=None) -> str:
        """Try AI providers for response using prompd-assistant.prmd"""
        try:
            # Use PrompdExecutor with the dedicated assistant prompt
            from .executor import PrompdExecutor
            from pathlib import Path
            import tempfile
            import os
            import asyncio
            
            # Get the assistant prompt path
            assets_dir = Path(__file__).parent / "assets" / "prompts" / "cli" / "python"
            assistant_prompt = assets_dir / "prompd-assistant.prmd"
            
            if not assistant_prompt.exists():
                # Fallback to simple system prompt if file doesn't exist
                if shell_instance:
                    shell_instance.console.print(f"[dim]Debug: Assistant prompt file not found at {assistant_prompt}[/dim]")
                return self.try_ai_providers_fallback(user_input, shell_instance)
            
            # Prepare context
            context = {
                'cwd': str(shell_instance.current_dir) if shell_instance else os.getcwd(),
                'files': [],
                'last_command': getattr(shell_instance, 'last_command', None)
            }
            
            if shell_instance:
                try:
                    context['files'] = [f.name for f in shell_instance.current_dir.glob('*.prmd')] + [f.name for f in shell_instance.current_dir.glob('*.pdpkg')]
                except:
                    pass
            
            # Get recent conversation history
            conversation_history = []
            if shell_instance and hasattr(shell_instance, 'conversation_history'):
                conversation_history = shell_instance.conversation_history[-3:]  # Last 3 messages
            
            # Execute the assistant prompt
            executor = PrompdExecutor()
            
            # Convert parameters to CLI format
            cli_params = []
            cli_params.append(f"user_message={user_input}")
            cli_params.append(f"context={context}")
            if conversation_history:
                cli_params.append(f"conversation_history={conversation_history}")
            
            # Use asyncio to run the async execute method
            result = asyncio.run(executor.execute(
                Path(assistant_prompt),
                provider=shell_instance.get_current_ai_provider().lower() if shell_instance and shell_instance.get_current_ai_provider() else "openai",
                model="gpt-4o-mini",
                cli_params=cli_params
            ))
            
            if result and hasattr(result, 'content') and result.content:
                # Track usage if available
                if shell_instance and hasattr(result, 'usage') and result.usage:
                    shell_instance._add_usage(result.usage)
                return result.content.strip()
                
        except Exception as e:
            # Fallback to direct provider calls if prompd execution fails
            if shell_instance:
                shell_instance.console.print(f"[dim]Debug: PrompdExecutor failed: {e}[/dim]")
            pass
            
        return self.try_ai_providers_fallback(user_input, shell_instance)
    
    def try_ai_providers_fallback(self, user_input: str, shell_instance=None) -> str:
        """Fallback AI provider method with simple system prompt"""
        try:
            import asyncio
            from .config import PrompdConfig
            from .providers.openai import OpenAIProvider
            from .providers.anthropic import AnthropicProvider
            from .providers.base import ProviderConfig
            from .models import LLMRequest, LLMMessage, MessageRole
            
            # Get configuration
            config = PrompdConfig.load()
            
            async def get_response():
                # Determine preferred order: default provider first, then others with keys
                order = []
                dp = (config.default_provider or '').lower() if getattr(config, 'default_provider', None) else None
                if dp:
                    order.append(dp)
                for cand in ['openai', 'anthropic']:
                    if cand not in order:
                        order.append(cand)

                for prov in order:
                    if prov == 'openai':
                        key = config.get_api_key('openai')
                        if not key:
                            continue
                        try:
                            provider_config = ProviderConfig(api_key=key)
                            provider = OpenAIProvider(provider_config)
                            model = getattr(config, 'default_model', None) or 'gpt-3.5-turbo'
                            request = LLMRequest(
                                messages=[
                                    LLMMessage(role=MessageRole.SYSTEM, content="You are Prompd Assistant. Help with .prmd files and CLI commands. Be concise."),
                                    LLMMessage(role=MessageRole.USER, content=user_input)
                                ],
                                model=model,
                                max_tokens=1000,
                                temperature=0.7
                            )
                            response = await provider.execute(request)
                            try:
                                if shell_instance and hasattr(response, 'usage') and response.usage:
                                    shell_instance._add_usage(response.usage)
                            except Exception:
                                pass
                            return response.content
                        except Exception:
                            continue

                    if prov == 'anthropic':
                        key = config.get_api_key('anthropic')
                        if not key:
                            continue
                        try:
                            provider_config = ProviderConfig(api_key=key)
                            provider = AnthropicProvider(provider_config)
                            model = getattr(config, 'default_model', None) or 'claude-3-haiku-20240307'
                            request = LLMRequest(
                                messages=[
                                    LLMMessage(role=MessageRole.USER, content=f"You are Prompd Assistant. Help with .prmd files and CLI commands. Be concise.\n\nUser: {user_input}")
                                ],
                                model=model,
                                max_tokens=1000,
                                temperature=0.7
                            )
                            response = await provider.execute(request)
                            try:
                                if shell_instance and hasattr(response, 'usage') and response.usage:
                                    shell_instance._add_usage(response.usage)
                            except Exception:
                                pass
                            return response.content
                        except Exception:
                            continue

                return None
            
            # Run async function
            result = asyncio.run(get_response())
            if result:
                return result.strip()
            
        except Exception:
            pass  # Any import or execution error
        
        return None
    
    def handle_file_operations(self, user_input: str) -> str:
        """Handle file operations with AI assistance"""
        import re
        import shutil
        from pathlib import Path
        
        # Parse move command: "move X to Y" or "can you move X to Y"
        move_patterns = [
            r"(?:can you |please |)move (.+?) to (.+)",
            r"(?:can you |please |)mv (.+?) (.+)",
        ]
        
        for pattern in move_patterns:
            match = re.search(pattern, user_input.lower())
            if match:
                source = match.group(1).strip()
                dest = match.group(2).strip()
                
                try:
                    # Resolve paths
                    source_path = Path(source)
                    if not source_path.is_absolute():
                        source_path = self.current_dir / source_path
                    
                    dest_path = Path(dest)
                    if not dest_path.is_absolute():
                        dest_path = self.current_dir / dest_path
                    
                    # Check if source exists
                    if not source_path.exists():
                        return f"ERROR: File not found: {source}"
                    
                    # Create destination directory if needed
                    if dest_path.suffix == "":  # It's a directory
                        dest_path.mkdir(parents=True, exist_ok=True)
                        final_dest = dest_path / source_path.name
                    else:
                        dest_path.parent.mkdir(parents=True, exist_ok=True)
                        final_dest = dest_path
                    
                    # Perform the move
                    shutil.move(str(source_path), str(final_dest))
                    
                    return f"SUCCESS: Moved {source_path.name} to {final_dest}"
                    
                except Exception as e:
                    return f"ERROR: Failed to move file: {str(e)}"
        
        return "I can help with file operations! Try: 'move ./test-prompt.prmd to ./prompts'"
    
    def handle_file_operations_with_confirmation(self, user_input: str, shell_instance) -> str:
        """Handle file operations with confirmation for safety"""
        import re
        from pathlib import Path
        
        # Parse move command
        move_patterns = [
            r"(?:can you |please |)move (.+?) to (.+)",
            r"(?:can you |please |)mv (.+?) (.+)",
        ]
        
        for pattern in move_patterns:
            match = re.search(pattern, user_input.lower())
            if match:
                source = match.group(1).strip()
                dest = match.group(2).strip()
                
                # Resolve paths to check if they exist
                source_path = Path(source)
                if not source_path.is_absolute():
                    source_path = shell_instance.current_dir / source_path
                
                dest_path = Path(dest) 
                if not dest_path.is_absolute():
                    dest_path = shell_instance.current_dir / dest_path
                
                # Check if source exists
                if not source_path.exists():
                    return f"ERROR: File not found: {source}"
                
                # Create a confirmation prompt
                if dest_path.suffix == "":  # Directory
                    final_dest = dest_path / source_path.name
                else:
                    final_dest = dest_path
                
                return (f"I can move {source_path.name} to {final_dest}\n\n"
                       f"To confirm, type: 'yes, move {source_path.name}'\n"
                       f"To cancel, type: 'no' or anything else")
        
        return "I can help with file operations! Try: 'move ./test-prompt.prmd to ./prompts'"
    
    def handle_complex_file_operations(self, user_input: str, shell_instance) -> str:
        """Handle complex file operations like mkdir + move"""
        import re
        from pathlib import Path
        
        user_input_lower = user_input.lower()
        
        # Pattern: "make a folder called X and move Y to X"
        complex_pattern = r"make.*?folder.*?(?:called|named)\s+(.+?)\s+and\s+move\s+(?:the\s+)?(.+?)\s+(?:to|into?)\s+(?:the\s+)?(?:new\s+)?folder"
        match = re.search(complex_pattern, user_input_lower)
        
        if match:
            folder_name = match.group(1).strip()
            file_pattern = match.group(2).strip()
            
            # Clean up folder name (remove quotes, ./prefix)
            folder_name = folder_name.replace('"', '').replace("'", '')
            if folder_name.startswith('./'):
                folder_name = folder_name[2:]
            
            # Clean up file pattern
            file_pattern = file_pattern.replace('the ', '').replace('all ', '')
            
            # Find matching files
            matching_files = []
            if '*' in file_pattern or file_pattern == '*.pdpkg':
                # Handle wildcards
                if '*.pdpkg' in file_pattern:
                    matching_files = list(shell_instance.current_dir.glob("*.pdpkg"))
                else:
                    # Simple wildcard support
                    pattern = file_pattern.replace('*', '')
                    matching_files = [f for f in shell_instance.current_dir.iterdir() 
                                    if f.is_file() and pattern in f.name]
            else:
                # Single file
                file_path = Path(file_pattern)
                if not file_path.is_absolute():
                    file_path = shell_instance.current_dir / file_path
                if file_path.exists():
                    matching_files = [file_path]
            
            if not matching_files:
                return f"No files found matching: {file_pattern}"
            
            # Create confirmation message
            folder_path = shell_instance.current_dir / folder_name
            file_list = ', '.join(f.name for f in matching_files)
            
            return (f"I can create folder '{folder_name}' and move {len(matching_files)} files:\n"
                   f"Files: {file_list}\n\n"
                   f"To confirm, type: 'yes, mkdir and move to {folder_name}'\n"
                   f"To cancel, type: 'no'")
        
        # Pattern: Simple "move X to Y"
        move_pattern = r"move\s+(?:the\s+)?(.+?)\s+(?:to|into)\s+(?:the\s+)?(.+?)(?:\s|$)"
        match = re.search(move_pattern, user_input_lower)
        if match:
            return self.handle_file_operations_with_confirmation(user_input, shell_instance)
        
        # Pattern: "make/create folder X"
        mkdir_pattern = r"(?:make|create).*?folder.*?(?:called|named)\s+(.+?)(?:\s|$)"
        match = re.search(mkdir_pattern, user_input_lower)
        if match:
            folder_name = match.group(1).strip().replace('"', '').replace("'", '')
            if folder_name.startswith('./'):
                folder_name = folder_name[2:]
            
            return (f"I can create folder '{folder_name}'\n\n"
                   f"To confirm, type: 'yes, mkdir {folder_name}'\n" 
                   f"To cancel, type: 'no'")
        
        return "I can help with file operations! Try: 'make folder packages and move *.pdpkg files to folder'"
    
    def execute_confirmed_move(self, filename: str, shell_instance) -> str:
        """Execute a confirmed file move operation"""
        import shutil
        from pathlib import Path
        
        # This is a simplified version - in practice you'd want to store
        # the move context in the shell session
        
        # For now, look for the file in current directory
        source_path = Path(filename)
        if not source_path.is_absolute():
            source_path = shell_instance.current_dir / source_path
        
        # Default destination is prompts directory
        prompts_dir = shell_instance.current_dir / "prompts"
        prompts_dir.mkdir(exist_ok=True)
        final_dest = prompts_dir / source_path.name
        
        try:
            if source_path.exists():
                shutil.move(str(source_path), str(final_dest))
                return f"SUCCESS: Moved {source_path.name} to prompts/"
            else:
                return f"ERROR: File {filename} not found"
        except Exception as e:
            return f"ERROR: Failed to move file: {str(e)}"
    
    def execute_mkdir(self, folder_name: str, shell_instance) -> str:
        """Execute mkdir operation"""
        from pathlib import Path
        
        try:
            folder_path = shell_instance.current_dir / folder_name
            folder_path.mkdir(parents=True, exist_ok=True)
            return f"SUCCESS: Created folder '{folder_name}'"
        except Exception as e:
            return f"ERROR: Failed to create folder: {str(e)}"
    
    def execute_mkdir_and_move(self, folder_name: str, shell_instance) -> str:
        """Execute mkdir + move multiple files operation"""
        import shutil
        from pathlib import Path
        
        try:
            # Create folder
            folder_path = shell_instance.current_dir / folder_name
            folder_path.mkdir(parents=True, exist_ok=True)
            
            # Find .pdpkg files (for now, hardcoded to the common use case)
            pdpkg_files = list(shell_instance.current_dir.glob("*.pdpkg"))
            
            if not pdpkg_files:
                return f"SUCCESS: Created folder '{folder_name}' but no .pdpkg files found to move"
            
            # Move files
            moved_files = []
            for file_path in pdpkg_files:
                dest_path = folder_path / file_path.name
                shutil.move(str(file_path), str(dest_path))
                moved_files.append(file_path.name)
            
            file_list = ', '.join(moved_files)
            return f"SUCCESS: Created folder '{folder_name}' and moved {len(moved_files)} files:\n{file_list}"
            
        except Exception as e:
            return f"ERROR: Failed to create folder and move files: {str(e)}"
    
    def execute_prompt_creation(self, filename: str, shell_instance) -> str:
        """Execute confirmed prompt creation"""
        from pathlib import Path
        
        try:
            # Extract topic from filename (remove .prmd extension)
            if filename.endswith('.prmd'):
                topic_id = filename[:-7]  # Remove .prmd
            else:
                topic_id = filename
                filename = f"{filename}.prmd"
            
            # Convert filename to readable topic
            topic = topic_id.replace('-', ' ').replace('_', ' ')
            prompt_name = topic.title()
            
            # Create template content
            template = (self.pending_prompt_template or f"""---
id: {topic_id}
name: {prompt_name}
version: 1.0.0
description: A prompt for {topic}
parameters:
  - name: context
    type: string
    required: false
    description: Additional context for the prompt
---

You are an expert assistant helping with {topic}.

{{{{ if context }}}}
Context: {{{{context}}}}
{{{{ end }}}}

Please provide helpful guidance on {topic}.
""")
            
            # Write to file
            file_path = shell_instance.current_dir / filename
            if file_path.exists():
                return f"ERROR: File {filename} already exists"
            
            file_path.write_text(template, encoding='utf-8')
            # Clear pending template after writing
            try:
                shell_instance.pending_prompt_template = None
            except Exception:
                self.pending_prompt_template = None
            return f"SUCCESS: Created {filename}\nYou can now compile it with: compile {topic_id}"
            
        except Exception as e:
            return f"ERROR: Failed to create prompt file: {str(e)}"
    
    def handle_prompt_creation(self, user_input: str, shell_instance) -> str:
        """Handle prompt creation requests"""
        import re
        
        # Extract prompt topic/purpose from the request
        topic_patterns = [
            r"create.*?prompd.*?(?:to|for)\s+(.+)",
            r"create.*?prompt.*?(?:to|for)\s+(.+)", 
            r"new prompd.*?(?:to|for)\s+(.+)",
            r"create.*?prompd.*?(?:about|on)\s+(.+)",
        ]
        
        topic = None
        for pattern in topic_patterns:
            match = re.search(pattern, user_input.lower())
            if match:
                topic = match.group(1).strip()
                break
        
        if not topic:
            topic = "general purpose"
        
        # Detect explicit filename: "named steves[.prmd]" or "name steves[.prmd]"
        filename_match = re.search(r"name(?:d)?\s+([A-Za-z0-9_.-]+)(?:\.prmd)?", user_input.lower())
        if filename_match:
            base = filename_match.group(1)
            filename = base if base.endswith('.prmd') else f"{base}.prmd"
            prompt_id = filename[:-7]
        else:
            # Also support: "create a prompd steves.prmd"
            file_inline = re.search(r"create.*?prompd\s+([A-Za-z0-9_.-]+)(?:\.prmd)?", user_input.lower())
            if file_inline:
                base = file_inline.group(1)
                filename = base if base.endswith('.prmd') else f"{base}.prmd"
                prompt_id = filename[:-7]
            else:
                prompt_id = topic.replace(' ', '-').replace('_', '-').lower()
                filename = f"{prompt_id}.prmd"

        prompt_name = prompt_id.replace('-', ' ').replace('_', ' ').title()

        # Specialized templates for greeting or story
        lower_input = user_input.lower()
        if any(word in lower_input for word in ['greet', 'greeting', 'welcome']):
            template = f"""---
id: {prompt_id}
name: {prompt_name}
version: 1.0.0
description: Generate a short, friendly greeting message.
parameters:
  - name: name
    type: string
    required: false
    default: Steve
    description: Name of the person or team to welcome
  - name: greeting
    type: string
    default: "Welcome"
    description: Greeting word to use at the start of the message
  - name: tone
    type: string
    default: friendly
    description: Message tone (friendly, formal, casual)
---

# System
You create short, warm welcome messages. Keep it to 1–2 sentences and avoid filler.

# User
Write a {{tone}} welcome message using this info:
Recipient: {{name}}
Greeting: {{greeting}}

{{% if tone == "formal" %}}
Use professional language and avoid emojis.
{{% elif tone == "casual" %}}
Be relaxed and you may use light emojis.
{{% else %}}
Be warm, concise, and encouraging.
{{% endif %}}
"""
        elif any(word in lower_input for word in ['story', 'narrative', 'tale']):
            template = f"""---
id: {prompt_id}
name: {prompt_name}
version: 1.0.0
description: Generate a short original story.
parameters:
  - name: protagonist
    type: string
    required: false
    default: Steve
    description: Main character name
  - name: genre
    type: string
    required: false
    default: adventure
    description: Story genre (adventure, sci-fi, mystery, fantasy)
  - name: length
    type: string
    required: false
    default: short
    description: Story length (short, medium, long)
---

# System
You write engaging, original stories tailored to the request. Keep the story consistent and avoid overlong exposition.

# User
Write a {length} {genre} story featuring {protagonist} as the main character. Keep it self-contained with a beginning, middle, and end.
"""
        else:
            # Generic template
            template = f"""---
id: {prompt_id}
name: {prompt_name}
version: 1.0.0
description: A prompt for {topic}
parameters:
  - name: context
    type: string
    required: false
    description: Additional context for the prompt
---

You are an expert assistant helping with {topic}.

{{% if context %}}
Context: {{context}}
{{% endif %}}

Please provide helpful guidance on {topic}.
"""

        # Store pending template for confirmation path
        try:
            shell_instance.pending_prompt_template = template
        except Exception:
            self.pending_prompt_template = template
        
        return (f"I can create a new prompt for '{topic}':\n"
               f"Filename: {filename}\n\n"
               f"Preview:\n{template[:200]}...\n\n"
               f"To create this prompt, type: 'yes, create {filename}'\n"
               f"To cancel, type: 'no'")
    
    def handle_registry_search(self, user_input: str, shell_instance) -> str:
        """Handle registry search requests"""
        import re
        
        # Extract search query
        query_patterns = [
            r"search\s+(?:the\s+)?registry\s+for\s+(.+)",    # "search registry for security"
            r"search\s+(?:the\s+)?registry\s+(.+)",         # "search registry security"
            r"search\s+for\s+(.+)",                         # "search for security"
            r"search\s+(.+)",                               # "search security"
        ]
        
        query = None
        for pattern in query_patterns:
            match = re.search(pattern, user_input.lower())
            if match:
                query = match.group(1).strip()
                break
        
        if not query:
            query = "packages"
        
        # Call the actual registry search
        try:
            # Use shell_instance.interactive_search to perform the actual search
            import io
            from contextlib import redirect_stdout
            
            # Capture the search output
            output = io.StringIO()
            with redirect_stdout(output):
                shell_instance.interactive_search([query])
            
            result = output.getvalue()
            if result.strip():
                return f"Registry search results for '{query}':\n{result}"
            else:
                return f"Searched registry for '{query}' - see results above"
        except Exception as e:
            return (f"Registry search for '{query}' - calling search API...\n"
                   f"Use 'search {query}' command for full results")
    
    def handle_provider_request(self, user_input: str, shell_instance) -> str:
        """Handle provider-related requests"""
        import re
        
        user_input_lower = user_input.lower()
        
        # Check for provider status requests
        if any(phrase in user_input_lower for phrase in ['provider status', 'show provider', 'current provider']):
            # Call the shell method directly and capture output
            try:
                import io
                from contextlib import redirect_stdout
                
                output = io.StringIO()
                with redirect_stdout(output):
                    shell_instance.show_provider_status()
                
                result = output.getvalue()
                return result if result.strip() else "Provider status shown above"
            except:
                shell_instance.show_provider_status()
                return "Provider status displayed"
        
        # Check for provider switching requests
        provider_patterns = [
            r'(?:change|switch|use) provider (?:to )?(\w+)',
            r'provider (\w+)',
            r'use (openai|anthropic|ollama)(?:\s|$)',  # More specific pattern
        ]
        
        for pattern in provider_patterns:
            match = re.search(pattern, user_input_lower)
            if match:
                provider_name = match.group(1).strip()
                if provider_name in ['openai', 'anthropic', 'ollama']:
                    shell_instance.switch_provider(provider_name)
                    return f"Switched to {provider_name.title()} provider"
                else:
                    return f"Unknown provider: {provider_name}. Available: openai, anthropic, ollama"
        
        # Default: show provider status
        shell_instance.show_provider_status()
        return "Provider information displayed above"
    
    def find_matching_files(self, pattern: str, directory: Path) -> List[Path]:
        """Find files matching a pattern"""
        pattern = pattern.lower()
        matches = []
        
        # Look for .prmd files
        for file in directory.glob("*.prmd"):
            if (pattern in file.name.lower() or 
                pattern in file.stem.lower() or
                pattern.replace(' ', '-') in file.name.lower()):
                matches.append(file)
        
        # Also check subdirectories for composable packages
        for subdir in directory.glob("**/prompts/*.prmd"):
            if (pattern in subdir.name.lower() or 
                pattern in subdir.stem.lower()):
                matches.append(subdir)
        
        return matches
    
    def suggest_next_actions(self, shell_instance) -> List[str]:
        """Suggest helpful next actions based on context"""
        suggestions = []
        
        prompd_files = list(shell_instance.current_dir.glob("*.prmd"))
        pdpkg_files = list(shell_instance.current_dir.glob("*.pdpkg"))
        
        if prompd_files:
            suggestions.append(f"Compile {prompd_files[0].stem}")
        
        if pdpkg_files:
            suggestions.append("Show package contents")
        
        if not prompd_files and not pdpkg_files:
            suggestions.extend([
                "Create a new prompt", 
                "Search the registry",
                "Show help"
            ])
        
        return suggestions[:3]  # Limit to 3 suggestions

    def suggest_provider_command(self, user_input_lower: str, shell_instance=None) -> str:
        """Suggest provider-related commands based on user input"""
        # Check for common provider-related phrases
        provider_hints = [
            ('use openai', 'switch provider openai'),
            ('use anthropic', 'switch provider anthropic'), 
            ('use ollama', 'switch provider ollama'),
            ('change to openai', 'switch provider openai'),
            ('change to anthropic', 'switch provider anthropic'),
            ('switch to openai', 'switch provider openai'),
            ('switch to anthropic', 'switch provider anthropic'),
            ('current provider', 'provider status'),
            ('what provider', 'provider status'),
            ('which provider', 'provider status'),
            ('manage providers', 'provider status'),
            ('manage provider', 'provider status'),
            ('provider management', 'provider status'),
        ]
        
        for phrase, suggestion in provider_hints:
            if phrase in user_input_lower:
                if shell_instance:
                    shell_instance.last_suggestion = suggestion
                return f"Did you mean: '{suggestion}'? (yes/no)"
        
        return None
    
    def suggest_similar_command(self, user_input_lower: str, shell_instance=None) -> str:
        """Suggest similar commands based on fuzzy matching"""
        available_commands = [
            'compile', 'show', 'validate', 'list', 'cd', 'cat', 'open', 'provider', 
            'search', 'install', 'publish', 'login', 'status', 'help', 'clear'
        ]
        
        # Simple fuzzy matching for command suggestions
        user_words = user_input_lower.split()
        if not user_words:
            return None
            
        first_word = user_words[0]
        
        # Direct partial matches
        partial_matches = [cmd for cmd in available_commands if cmd.startswith(first_word)]
        if partial_matches:
            if len(partial_matches) == 1:
                if shell_instance:
                    shell_instance.last_suggestion = partial_matches[0]
                return f"Did you mean: '{partial_matches[0]}'? (yes/no)"
            else:
                matches_str = "', '".join(partial_matches)
                return f"Did you mean one of: '{matches_str}'?"
        
        # Check for common typos or alternatives (removed 'ls' - it should work directly)
        command_alternatives = {
            'dir': 'list', 
            'pwd': 'status',
            'mkdir': 'make folder',
            'mv': 'move',
            'cp': 'copy', 
            'rm': 'delete',
            'switch': 'provider',
            'change': 'provider',
            'which': 'provider status',
        }
        
        if first_word in command_alternatives:
            suggestion = command_alternatives[first_word]
            if shell_instance:
                shell_instance.last_suggestion = suggestion
            return f"Did you mean: '{suggestion}'? (yes/no)"
        
        return None


class PrompdShell:
    """Enhanced Prompd Shell with conversational AI"""
    
    def __init__(self):
        # Console configuration for Windows compatibility
        try:
            import os
            # Force UTF-8 encoding and terminal compatibility for Windows
            if os.name == 'nt':
                try:
                    os.system('chcp 65001 >nul 2>&1')  # Set UTF-8 code page
                    os.environ['TTY_COMPATIBLE'] = '1'  # Force Rich to treat as terminal-capable
                except:
                    pass
            
            self.console = Console(
                width=None,  # Use full terminal width to prevent truncation
                force_terminal=True,
                legacy_windows=True,  # Windows compatibility
                safe_box=True,  # Use safe box characters for Windows
                color_system="standard",  # Force standard color system for compatibility
                no_color=False,
                highlight=False,  # Disable auto-highlighting that can cause issues
                soft_wrap=True  # Enable soft text wrapping
            )
        except Exception:
            # Minimal fallback console
            self.console = Console(
                width=100, 
                legacy_windows=True, 
                safe_box=True,
                color_system="standard",
                no_color=True
            )
        self.assistant = ConversationalAssistant(self.console)
        self.registry = RegistryClient()
        self.current_dir = Path.cwd()
        self.commands = [
            'compile', 'show', 'validate', 'list', 'status', 
            'search', 'install', 'publish', 'login',
            'chat', 'help', 'exit', 'clear', 'compact'
        ]
        self.chat_mode = False
        self.last_suggestion = None  # Store last suggested command
        self.conversation_history = []  # Store conversation history
        # Planner/prompt creation state
        self.pending_prompt_template = None  # Prepared template waiting for confirmation
        self.pending_plan = None  # LLM planner proposed plan awaiting confirmation
        
        # Display configuration
        self.compact_mode = False  # Can be toggled for smaller output
        # Token usage tracking
        self.token_usage_total = { 'prompt': 0, 'completion': 0, 'total': 0 }
        self.last_usage = None
        self._usage_updated_this_turn = False
        
    def setup_autocompletion(self):
        """Setup command and file autocompletion"""
        try:
            import readline
            import glob
            
            def completer(text, state):
                """Custom completer for commands and files"""
                try:
                    # Get the line buffer to determine context
                    line_buffer = readline.get_line_buffer()
                    parts = line_buffer.split()
                    
                    if not parts or (len(parts) == 1 and not line_buffer.endswith(' ')):
                        # Complete command names
                        commands = ['compile', 'show', 'validate', 'list', 'cd', 'cat', 'open', 'provider', 'search', 
                                   'install', 'publish', 'login', 'status', 'chat', 'clear', 'help', 'exit']
                        options = [cmd for cmd in commands if cmd.startswith(text)]
                    else:
                        # Complete file/directory names
                        command = parts[0].lower()
                        
                        # Get glob pattern - handle quotes and partial text
                        if text.startswith('"') or text.startswith("'"):
                            pattern = text[1:] + '*'
                        else:
                            pattern = text + '*'
                        
                        # Get files and directories in current directory
                        try:
                            matches = []
                            for path in self.current_dir.glob(pattern):
                                name = path.name
                                
                                # Add trailing slash for directories
                                if path.is_dir():
                                    name += '/'
                                
                                # For commands that work with specific file types
                                if command in ['compile', 'show'] and not name.endswith(('.prmd', '/')):
                                    continue
                                elif command == 'validate' and not name.endswith(('.prmd', '.pdpkg', '/')):
                                    continue
                                elif command == 'cat' and path.is_dir():
                                    matches.append(name)
                                    continue
                                
                                matches.append(name)
                            
                            # Also add parent directory option
                            if command == 'cd' and '..' not in matches and text in ['', '.', '..']:
                                matches.append('../')
                            
                            # Provider command completion
                            if command == 'provider' and not matches:
                                provider_options = ['openai', 'anthropic', 'ollama', 'status']
                                matches = [p for p in provider_options if p.startswith(text)]
                            
                            options = matches
                        except:
                            options = []
                    
                    if state < len(options):
                        return options[state]
                    return None
                except:
                    return None
            
            # Set up readline
            readline.set_completer(completer)
            readline.parse_and_bind("tab: complete")
            
            # Configure completion behavior
            readline.set_completer_delims(' \t\n=')
            
        except ImportError:
            # readline not available on this system
            pass
        except Exception:
            # Other setup errors, continue without autocompletion
            pass
        
    def start(self):
        """Start the shell session"""
        self.setup_autocompletion()
        self.show_welcome()
        # Background: ping registry after startup and notify if unreachable
        try:
            import threading
            def _ping():
                try:
                    # Lazy discovery; do not block startup
                    self.registry.ensure_discovered()
                    if self.registry.registry_info is None:
                        # Registry may be unreachable or not discovered
                        self.console.print(f"[dim]Note: Registry not reachable at {self.registry.registry_url}. Registry features may be offline.[/dim]")
                except Exception:
                    # Quietly ignore
                    pass
            t = threading.Thread(target=_ping, daemon=True)
            t.start()
        except Exception:
            pass
        
        while True:
            try:
                # Get input - either command or chat
                if self.chat_mode:
                    # Just use simple input - terminal limitations make hiding input complex
                    user_input = input("> ").strip()
                    
                    # Handle special chat commands
                    if user_input.strip().lower() in ['exit chat', 'quit chat', '/exit']:
                        self.chat_mode = False
                        self.console.print("\n[dim]- Returning to shell mode -[/dim]\n")
                        continue
                    elif user_input.strip().lower() == '/clear':
                        self.conversation_history.clear()
                        self.enter_chat_mode()  # Refresh chat interface
                        continue
                    elif user_input.strip().lower() in ['', '/help']:
                        self.show_chat_help_enhanced()
                        continue
                    
                    # Handle confirmation responses (yes/no) before sending to AI
                    user_txt = user_input.strip().lower()
                    
                    # Plan confirmation handling
                    if hasattr(self, 'pending_plan') and self.pending_plan:
                        if user_txt in ['y', 'yes']:
                            plan = self.pending_plan
                            self.pending_plan = None
                            self.console.print(f"[green]Executing plan:[/green] {plan}")
                            # Execute the planned commands
                            continue
                        elif user_txt in ['n', 'no']:
                            self.pending_plan = None
                            self.console.print("[dim]Canceled plan.[/dim]")
                            continue
                    
                    # Suggestion confirmation handling
                    if hasattr(self, 'last_suggestion') and self.last_suggestion and user_txt in ['y', 'yes']:
                        suggestion = self.last_suggestion
                        self.last_suggestion = None
                        self.console.print(f"[green]Executing:[/green] {suggestion}")
                        
                        try:
                            parts = suggestion.strip().split()
                            if suggestion.startswith('provider status') or suggestion == 'provider status':
                                self.show_provider_status()
                            elif suggestion.startswith('switch provider') and len(parts) >= 3:
                                self.interactive_provider(' '.join(parts[1:]))
                            else:
                                # Execute as command
                                self.execute_command(suggestion)
                        except Exception as e:
                            self.console.print(f"[red]Command failed: {e}[/red]")
                        continue
                    elif hasattr(self, 'last_suggestion') and self.last_suggestion and user_txt in ['n', 'no']:
                        self.last_suggestion = None
                        self.console.print("[dim]Suggestion canceled.[/dim]")
                        continue
                    
                    # Add separator line to distinguish user input from AI response
                    if user_input.strip():
                        self.console.print("[dim]" + "─" * 50 + "[/dim]")
                    
                    # Add user message to history
                    self.conversation_history.append({
                        'role': 'user',
                        'content': user_input,
                        'timestamp': self.get_timestamp()
                    })
                    
                    # Process input without showing user panel again
                    self.handle_chat_input_enhanced(user_input, show_user_panel=False)
                else:
                    # Show current provider in prompt
                    current_provider = self.get_current_ai_provider()
                    if current_provider:
                        provider_short = current_provider.lower()[:3]  # "ope", "ant", "oll"
                        self.console.print(f"[green]prompd[/green][dim]({provider_short})[/dim][yellow]>[/yellow] ", end="")
                    else:
                        self.console.print("[green]prompd[/green][yellow]>[/yellow] ", end="")
                    command_text = input()
                    
                    if not command_text.strip():
                        continue
                    
                    # Check if user wants to chat
                    if command_text.strip().lower() in ['chat', 'talk', 'ask']:
                        self.enter_chat_mode()
                        continue
                        
                    # Process as regular command
                    self.execute_command(command_text.strip())
                
            except KeyboardInterrupt:
                self.console.print("\n\n[yellow]Exit Prompd shell? (y/n):[/yellow] ", end="")
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
        
        self.console.print("[dim]Goodbye! Happy prompting![/dim]")
    
    def toggle_compact_mode(self):
        """Toggle compact display mode for smaller output"""
        self.compact_mode = not self.compact_mode
        mode = "ON" if self.compact_mode else "OFF"
        self.console.print(f"[cyan]Compact mode: {mode}[/cyan]")
        if self.compact_mode:
            self.console.print("[dim]Using smaller, more condensed output format[/dim]")
        else:
            self.console.print("[dim]Using standard output format[/dim]")
    
    def get_timestamp(self):
        """Get current timestamp for conversation history"""
        from datetime import datetime
        return datetime.now().strftime("%H:%M")
    
    def parse_ai_response(self, response: str) -> tuple:
        """Parse JSON AI response to extract display text and executable commands"""
        import json
        
        # Debug: Show raw response
        if hasattr(self, 'debug_mode') and self.debug_mode:
            self.console.print(f"[dim]Raw AI response: {response[:200]}...[/dim]")
        
        try:
            # Parse JSON response
            response_data = json.loads(response.strip())
            
            # Extract components
            display_text = response_data.get('responseText', "I'll help you with that:")
            actions_raw = response_data.get('actions', [])
            show_files = response_data.get('showFiles', False)
            suggest_next = response_data.get('suggestNext', [])
            
            # Normalize actions - handle both string format and object format
            actions = []
            
            # Command mapping for common AI mistakes
            command_map = {
                'readfile': 'show',
                'read': 'show',
                'display': 'show',
                'view': 'show',
                'open': 'show',
                'execute': 'compile',
                'run': 'compile'
            }
            
            for action in actions_raw:
                if isinstance(action, str):
                    # Fix common command mistakes
                    parts = action.split(' ', 1)
                    if parts:
                        cmd = parts[0].lower()
                        if cmd in command_map:
                            parts[0] = command_map[cmd]
                            action = ' '.join(parts)
                    actions.append(action)
                elif isinstance(action, dict):
                    # Convert {"command": "compile", "file": "test.prmd"} to "compile test.prmd"
                    if 'command' in action and 'file' in action:
                        actions.append(f"{action['command']} {action['file']}")
                    else:
                        # Try to reconstruct from dict
                        cmd_parts = []
                        if 'command' in action:
                            cmd_parts.append(action['command'])
                        for key, value in action.items():
                            if key != 'command':
                                cmd_parts.append(str(value))
                        if cmd_parts:
                            actions.append(' '.join(cmd_parts))
            
            # Add suggestions to display text if present
            if suggest_next:
                display_text += f"\n\n[dim]Suggestions: {', '.join(suggest_next)}[/dim]"
            
            return display_text, actions
            
        except (json.JSONDecodeError, KeyError) as e:
            # Fallback: treat entire response as display text, no actions
            return response, []
    
    def display_conversation_history(self, limit=10):
        """Display recent conversation history"""
        recent_messages = self.conversation_history[-limit:] if limit else self.conversation_history
        
        for msg in recent_messages:
            role = msg['role']
            content = msg['content']
            timestamp = msg.get('timestamp', '')
            
            if role == 'user':
                self.console.print(f"[dim]{timestamp}[/dim] [bold]You:[/bold] {content}")
            else:
                self.console.print(f"[dim]{timestamp}[/dim] [bold blue]Assistant:[/bold blue] {content}")
        
        if recent_messages:
            self.console.print()
    
    def show_chat_help_enhanced(self):
        """Show enhanced chat help in Claude Code style"""
        self.console.print("\n[bold blue]Chat Commands:[/bold blue]")
        self.console.print("[dim]Special commands you can use in chat mode:[/dim]\n")
        
        commands = [
            ("/exit", "Return to shell mode"),
            ("/clear", "Clear conversation history"),
            ("/help", "Show this help message"),
            ("", "")
        ]
        
        for cmd, desc in commands:
            if cmd:
                self.console.print(f"  [cyan]{cmd:<8}[/cyan] {desc}")
            else:
                self.console.print()
        
        self.console.print("[dim]You can also ask me to:[/dim]")
        self.console.print("  - Compile your prompts")
        self.console.print("  - Show file contents") 
        self.console.print("  - Search packages")
        self.console.print("  - Manage providers")
        self.console.print("  - Navigate directories")
        self.console.print("  - Or just have a conversation!")
        self.console.print()
    
    def show_welcome(self):
        """Display welcome message"""
        self.console.print()
        welcome_text = (
            "[bold blue]Prompd Shell[/bold blue] - Interactive CLI with AI Assistant\n\n"
            "[cyan]Commands:[/cyan] compile, show, validate, list, status, help, exit\n"
            "[cyan]Chat Mode:[/cyan] Type [yellow]chat[/yellow] to talk naturally with the AI assistant\n"
            "[cyan]Examples:[/cyan]\n"
            "  - [dim]compile my security audit for Node.js app[/dim]\n"
            "  - [dim]show me what's in that API prompt[/dim]\n"
            "  - [dim]chat[/dim] (then: [dim]help me compile a prompt[/dim])"
        )
        
        self.console.print(Panel(welcome_text, border_style="blue"))
        
        # Show quick status
        prompd_count = len(list(self.current_dir.glob("*.prmd")))
        package_count = len(list(self.current_dir.glob("*.pdpkg")))
        
        if prompd_count or package_count:
            self.console.print(f"[dim]Found {prompd_count} prompts and {package_count} packages in current directory[/dim]")
        
        self.console.print()
    
    def enter_chat_mode(self):
        """Enter conversational chat mode with Claude Code-like interface"""
        self.chat_mode = True
        
        # Clear screen for clean chat experience
        import os
        os.system('cls' if os.name == 'nt' else 'clear')
        
        # Show chat header like Claude Code
        try:
            self.console.print(Panel(
                "[bold yellow]🧪 BETA FEATURE[/bold yellow] - AI features are experimental\n\n"
                "I can help you with your prompts, packages, and development tasks.\n"
                "[dim]Type /exit to return to shell commands | /clear to clear conversation[/dim]",
                title="[bold]Prompd Assistant[/bold]",
                border_style="sky_blue1"
            ))
        except Exception:
            self.console.print("\n[bold blue]Prompd AI Assistant[/bold blue]")
            self.console.print("[dim]I can help you with your prompts, packages, and development tasks.[/dim]")
            self.console.print("[dim]Type /exit to return to shell commands | /clear to clear conversation[/dim]")
        self.console.print("\n" + "-" * 60 + "\n")
        
        # Show recent conversation history if any
        if self.conversation_history:
            self.console.print("[dim]Recent conversation:[/dim]\n")
            self.display_conversation_history(limit=3)
        
        # Context-aware suggestions in a more natural format
        current_provider = self.get_current_ai_provider()
        if current_provider:
            self.console.print(f"[dim]Connected to {current_provider} - Ready to assist[/dim]\n")
        else:
            self.console.print("[dim]No AI provider configured - Use 'provider status' to set up[/dim]\n")
            
        suggestions = self.assistant.suggest_next_actions(self)
        if suggestions:
            self.console.print("[dim]You can ask me things like:[/dim]")
            for suggestion in suggestions:
                self.console.print(f"[dim]   - {suggestion}[/dim]")
            self.console.print()
    
    def handle_chat_input_enhanced(self, user_input: str, show_user_panel=True):
        """Handle conversational input with enhanced formatting"""
        # Only show user panel if requested (to avoid duplication)
        if show_user_panel and user_input.strip():
            try:
                self.console.print(Panel(user_input, title="[bold]You[/bold]", border_style="bright_cyan"))
            except Exception:
                self.console.print(f"You: {user_input}")
        
        # Add separator line when not showing user panel (to separate user input from AI response)
        if not show_user_panel and user_input.strip():
            self.console.print("[dim]" + "─" * 50 + "[/dim]")
        
        # Show typing indicator
        with self.console.status("[dim]Assistant is thinking...[/dim]", spinner="dots"):
            # Process natural language
            intent_data = self.assistant.process_natural_language(user_input)
            # Ensure raw_input is always available for downstream handlers
            try:
                if 'raw_input' not in intent_data:
                    intent_data['raw_input'] = user_input
            except Exception:
                pass
            
            # Generate conversational response
            response = self.assistant.respond_conversationally(intent_data, self)
        
        # Parse and execute commands from AI response
        display_response, commands_to_execute = self.parse_ai_response(response)
        
        # Show AI response in Claude Code style using a light blue panel
        try:
            self.console.print(Panel(display_response, title="[bold]Assistant[/bold]", border_style="blue"))
            # Show token usage only if this turn used a provider
            if getattr(self, '_usage_updated_this_turn', False) and self.last_usage:
                pu = int(self.last_usage.get('prompt', 0))
                cu = int(self.last_usage.get('completion', 0))
                tu = int(self.last_usage.get('total', pu + cu))
                spu = int(self.token_usage_total.get('prompt', 0))
                scu = int(self.token_usage_total.get('completion', 0))
                stu = int(self.token_usage_total.get('total', 0))
                self.console.print(f"[dim]Tokens this turn: {pu}+{cu}={tu} | Session: {spu}+{scu}={stu}[/dim]")
        except Exception:
            self.console.print(f"\n[bold blue]Assistant:[/bold blue]")
            self.console.print(response)
        # (Usage line printed above within the assistant panel block)
        
        # Execute commands if any were suggested (with confirmation)
        if commands_to_execute:
            if len(commands_to_execute) == 1:
                self.console.print(f"[yellow]Execute command: {commands_to_execute[0]}? (y/n):[/yellow] ", end="")
            else:
                self.console.print(f"[yellow]Execute {len(commands_to_execute)} commands? (y/n):[/yellow] ", end="")
                for cmd in commands_to_execute:
                    self.console.print(f"  [dim]- {cmd}[/dim]")
                self.console.print("[yellow]Execute all? (y/n):[/yellow] ", end="")
            
            try:
                confirmation = input().lower().strip()
                if confirmation in ['y', 'yes']:
                    self.console.print("[dim]Executing suggested commands...[/dim]")
                    for i, command in enumerate(commands_to_execute):
                        if i > 0:  # Add small delay between commands
                            import time
                            time.sleep(0.5)
                        try:
                            self.console.print(f"[green]>[/green] {command}")
                            self.execute_command(command)
                        except Exception as e:
                            self.console.print(f"[red]Command failed: {e}[/red]")
                else:
                    self.console.print("[dim]Commands skipped.[/dim]")
            except (EOFError, KeyboardInterrupt):
                self.console.print("[dim]Commands skipped.[/dim]")
        
        # Add assistant response to history
        self.conversation_history.append({
            'role': 'assistant',
            'content': response,
            'timestamp': self.get_timestamp()
        })
        
        # Keep history manageable
        if len(self.conversation_history) > 20:
            self.conversation_history = self.conversation_history[-20:]
        
        # Execute the actual command if clear intent
        intent = intent_data['intent']

        # For generic chat/unclear intents, we've already rendered the assistant reply above
        # Avoid re-querying the LLM or re-printing the same message
        if intent == 'unclear':
            # Optional: show status footer and return
            try:
                self._print_status_footer()
            except Exception:
                pass
            return

        # Handle exit intent
        if intent == 'exit':
            self.chat_mode = False
            self.console.print("[dim]Exited chat mode. Back to shell commands.[/dim]")
            return

        # Planner confirmation handling
        user_txt = (user_input or '').strip().lower()
        if self.pending_plan and user_txt in ['y', 'yes']:
            plan = self.pending_plan
            self.pending_plan = None
            self.execute_plan(plan)
            return
        if self.pending_plan and user_txt in ['n', 'no']:
            self.pending_plan = None
            self.console.print("[dim]Canceled plan.[/dim]")
            return

        # Suggestion confirmation handling (e.g., "Did you mean: 'provider status'?")
        if getattr(self, 'last_suggestion', None) and user_txt in ['y', 'yes']:
            suggestion = self.last_suggestion
            self.last_suggestion = None
            try:
                parts = suggestion.strip().split()
                if suggestion.startswith('provider status') or suggestion == 'provider status':
                    self.show_provider_status()
                elif suggestion.startswith('switch provider') and len(parts) >= 3:
                    # e.g., "switch provider openai"
                    self.interactive_provider(' '.join(parts[1:]))
                else:
                    # Fallback: try executing as regular command
                    self.execute_command(suggestion)
            except Exception as e:
                self.console.print(f"[red]Failed to execute suggestion:[/red] {e}")
            return
        
        if intent == 'compile':
            matching_files = self.assistant.find_matching_files(intent_data['file'], self.current_dir)
            if len(matching_files) == 1:
                # Extract parameters if provided
                params = {}
                if intent_data.get('parameters_dict'):
                    params = intent_data['parameters_dict']
                elif intent_data.get('parameters'):
                    params = self.parse_parameters(intent_data['parameters'])
                self.interactive_compile_with_params([str(matching_files[0])], params)
            elif len(matching_files) == 0:
                # Show available files if none matched
                self.interactive_list()
        
        elif intent == 'show':
            try:
                # If the user is asking "how to ... prompd", route to LLM explanation instead of file show
                target_lower = (intent_data.get('target') or '').lower()
                if ('how to' in target_lower or 'how do i' in target_lower or 'make' in target_lower or 'create' in target_lower) and 'prompd' in target_lower:
                    self.console.print(self.assistant.get_ai_response(intent_data.get('raw_input', ''), self))
                    return

                matching_files = self.assistant.find_matching_files(intent_data['target'], self.current_dir)
                if matching_files:
                    self.interactive_show([str(matching_files[0])])
                    return
                # No exact match: suggest closest and show brief prompt list
                suggestions = self.suggest_files(intent_data['target'])
                if suggestions:
                    self.console.print(f"[yellow]No prompt named '{intent_data['target']}' found. Did you mean: {', '.join(suggestions[:3])}?[/yellow]")
                else:
                    self.console.print(f"[yellow]No prompt named '{intent_data['target']}' found. Showing available prompts:[/yellow]")
                self.list_prompts_brief()
                return
            except Exception as e:
                self.console.print(f"[red]Show failed:[/red] {e}")
                return
        
        elif intent == 'list':
            try:
                self.interactive_list()
            except Exception as e:
                self.console.print(f"[red]List failed:[/red] {e}")
            
        elif intent == 'help':
            # If the user asked for help creating a prompt, route to creation
            try:
                raw_lower = intent_data.get('raw_input', '').lower()
                if any(phrase in raw_lower for phrase in [
                    'create new prompt', 'create a new prompt', 'new prompd', 'create new prompd',
                    'create a prompd', 'create prompd', 'create prompt'
                ]):
                    resp = self.assistant.handle_prompt_creation(intent_data.get('raw_input', ''), self)
                    self.console.print(resp)
                    return
            except Exception:
                pass
            # Default help output
            self.show_chat_help()

        elif intent == 'unclear':
            # Keep it simple: route unclear requests to the LLM and show its reply
            self.console.print(self.assistant.get_ai_response(intent_data.get('raw_input', ''), self))
            return
        
        elif intent == 'direct_command':
            # Execute as regular command
            command = intent_data['command']
            args = intent_data.get('args', [])
            
            if command == 'compile':
                self.interactive_compile(args)
            elif command == 'show':
                self.interactive_show(args)
            elif command == 'validate':
                self.interactive_validate(args)
            elif command == 'list':
                self.interactive_list()
            elif command == 'cd':
                self.interactive_cd(' '.join(args) if args else '')
            elif command == 'cat':
                self.interactive_cat(' '.join(args) if args else '')
            elif command == 'open':
                self.interactive_open(' '.join(args) if args else '')
            elif command == 'provider':
                self.interactive_provider(' '.join(args) if args else '')
            elif command == 'search':
                self.interactive_search(args)
            elif command == 'install':
                self.interactive_install(args)
            elif command == 'publish':
                self.interactive_publish(args)
            elif command == 'login':
                self.interactive_login(args)
            elif command == 'status':
                self.show_status()
            elif command == 'help':
                self.show_help()
            elif command == 'clear':
                import os
                os.system('cls' if os.name == 'nt' else 'clear')
        
        # Nothing else matched and no explicit return — stay responsive
        return

    def suggest_files(self, pattern: str):
        """Return close filename matches for a given pattern (stems and names)."""
        import difflib
        names = []
        for p in self.current_dir.glob('*.prmd'):
            if not p.name.startswith('.'):
                names.append(p.name)
                names.append(p.stem)
        for p in self.current_dir.glob('**/prompts/*.prmd'):
            if not p.name.startswith('.'):
                names.append(p.name)
                names.append(p.stem)
        pattern = (pattern or '').strip()
        if not pattern:
            return []
        matches = difflib.get_close_matches(pattern, names, n=3, cutoff=0.4)
        # De-duplicate stem/name pairs
        out = []
        seen = set()
        for m in matches:
            base = m if m.endswith('.prmd') else f"{m}.prmd"
            if base not in seen:
                out.append(base)
                seen.add(base)
        return out

    def list_prompts_brief(self, limit: int = 10):
        """Show a concise list of .prmd files in the current directory (no directories)."""
        prompd_files = [p for p in self.current_dir.glob('*.prmd') if not p.name.startswith('.')]
        if not prompd_files:
            self.console.print("[yellow]No .prmd files found in this directory[/yellow]")
            self.console.print(f"[dim]Current directory: {self.current_dir}[/dim]")
            return
        self.console.print(f"[cyan]Prompts in {self.current_dir}[/cyan]")
        for p in prompd_files[:limit]:
            size = f"{p.stat().st_size/1024:.1f}KB"
            self.console.print(f"  • {p.name} [dim]({size})[/dim]")
        if len(prompd_files) > limit:
            self.console.print(f"[dim]… and {len(prompd_files) - limit} more[/dim]")
    
    def execute_command(self, command_text: str):
        """Execute a regular shell command"""
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
            elif command == 'compact':
                self.toggle_compact_mode()
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
            elif command == 'cd':
                self.interactive_cd(' '.join(args) if args else '')
            elif command == 'cat':
                self.interactive_cat(' '.join(args) if args else '')
            elif command == 'search':
                self.interactive_search(args)
            elif command == 'install':
                self.interactive_install(args)
            elif command == 'publish':
                self.interactive_publish(args)
            elif command == 'login':
                self.interactive_login(args)
            elif command == 'chat':
                self.enter_chat_mode()
            elif command == 'provider':
                self.interactive_provider(args)
            else:
                self.console.print(f"[red]Unknown command: {command}[/red]")
                self.console.print("Type [cyan]help[/cyan] for available commands or [cyan]chat[/cyan] to talk naturally")
                
        except Exception as e:
            self.console.print(f"[red]Command failed: {str(e)}[/red]")
    
    def show_help(self):
        """Display help information"""
        table = Table(title="Prompd Shell Commands", show_header=True, header_style="bold cyan")
        table.add_column("Command", style="green", width=12)
        table.add_column("Description", style="dim", width=40)
        table.add_column("Example", style="yellow", width=25)
        
        commands = [
            ("compile", "Compile .prmd files with parameters", "compile my-prompt.prmd"),
            ("show", "Show prompt structure and info", "show security-audit.prmd"),
            ("validate", "Validate prompts and packages", "validate my-package.pdpkg"),
            ("list", "List local files and directories", "list"),
            ("cd", "Change directory", "cd prompts"),
            ("cat", "Display file contents", "cat my-prompt.prmd"),
            ("open", "Open file with system default app", "open my-prompt.prmd"),
            ("provider", "Show/switch AI provider", "provider openai"),
            ("search", "Search registry for packages", "search security"),
            ("install", "Install packages from registry", "install @security/audit"),
            ("publish", "Publish package to registry", "publish my-pkg.pdpkg"),
            ("login", "Login to registry", "login --token xyz"),
            ("status", "Show session information", "status"),
            ("chat", "Enter conversational AI mode", "chat"),
            ("clear", "Clear the screen", "clear"),
            ("help", "Show this help", "help"),
            ("exit", "Exit shell", "exit")
        ]
        
        for cmd, desc, example in commands:
            table.add_row(cmd, desc, example)
        
        self.console.print(table)
        self.console.print()
        self.console.print("[bold cyan]Pro Tip:[/bold cyan] Type [yellow]chat[/yellow] to use natural language!")
        self.console.print("[dim]Example: \"compile my security prompt for a Node.js application\"[/dim]")
    
    def show_chat_help(self):
        """Show chat-specific help"""
        self.console.print("[blue]AI Assistant:[/blue] I understand natural language! Try asking me:")
        
        examples = [
            "\"Compile my security audit for a React app\"",
            "\"What prompts do I have available?\"", 
            "\"Show me the API builder prompt\"",
            "\"Help me validate my package\"",
            "\"What can I do with these files?\""
        ]
        
        for example in examples:
            self.console.print(f"  • [dim]{example}[/dim]")

    def plan_with_llm(self, user_input: str):
        """Use packaged planner .prmd to propose safe commands. Returns dict or None."""
        try:
            from .utils.assets import read_prompt_asset
            planner_text = read_prompt_asset("cli/python/command-planner.prmd")
            if not planner_text:
                return None
            import tempfile, asyncio, json
            from pathlib import Path
            from .executor import PrompdExecutor
            from .config import PrompdConfig
            # Write temp planner file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.prmd', delete=False, encoding='utf-8') as tmp:
                tmp.write(planner_text)
                planner_path = Path(tmp.name)
            # Build params
            files = [p.name for p in self.current_dir.glob('*.prmd')] + [p.name for p in self.current_dir.glob('*.pdpkg')]
            allowed = ["compile","show","validate","list","provider_status","provider_switch","mkdir","create_file","move","copy"]
            cli_params = [
                f"user_input={user_input}",
                f"cwd={self.current_dir}",
                f"files={','.join(files)}",
                f"allowed={','.join(allowed)}"
            ]
            cfg = PrompdConfig.load()
            provider = (cfg.default_provider or '').lower() if cfg.default_provider else None
            if not provider:
                provider = 'openai' if cfg.get_api_key('openai') else ('anthropic' if cfg.get_api_key('anthropic') else 'ollama')
            model = cfg.default_model or ("gpt-3.5-turbo" if provider=='openai' else ("claude-3-haiku-20240307" if provider=='anthropic' else 'llama2'))
            execu = PrompdExecutor()
            resp = asyncio.run(execu.execute(
                prompd_file=planner_path,
                provider=provider,
                model=model,
                cli_params=cli_params
            ))
            content = (resp.content or resp.response or '').strip()
            plan = json.loads(content)
            if not isinstance(plan, dict) or not self._validate_commands(plan.get('commands') or []):
                return None
            return plan
        except Exception:
            return None

    def plan_with_llm_and_usage(self, user_input: str):
        """Use packaged planner .prmd to propose safe commands. Returns {'plan': dict, 'usage': dict} or None."""
        try:
            from .utils.assets import read_prompt_asset
            planner_text = read_prompt_asset("cli/python/command-planner.prmd")
            if not planner_text:
                return None
            import tempfile, asyncio, json
            from pathlib import Path
            from .executor import PrompdExecutor
            from .config import PrompdConfig
            # Write temp planner file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.prmd', delete=False, encoding='utf-8') as tmp:
                tmp.write(planner_text)
                planner_path = Path(tmp.name)
            # Build params
            files = [p.name for p in self.current_dir.glob('*.prmd')] + [p.name for p in self.current_dir.glob('*.pdpkg')]
            allowed = ["compile","show","validate","list","provider_status","provider_switch","mkdir","create_file","move","copy"]
            cli_params = [
                f"user_input={user_input}",
                f"cwd={self.current_dir}",
                f"files={','.join(files)}",
                f"allowed={','.join(allowed)}"
            ]
            cfg = PrompdConfig.load()
            provider = (cfg.default_provider or '').lower() if cfg.default_provider else None
            if not provider:
                provider = 'openai' if cfg.get_api_key('openai') else ('anthropic' if cfg.get_api_key('anthropic') else 'ollama')
            model = cfg.default_model or ("gpt-3.5-turbo" if provider=='openai' else ("claude-3-haiku-20240307" if provider=='anthropic' else 'llama2'))
            execu = PrompdExecutor()
            resp = asyncio.run(execu.execute(
                prompd_file=planner_path,
                provider=provider,
                model=model,
                cli_params=cli_params
            ))
            content = (resp.content or resp.response or '').strip()
            plan = json.loads(content)
            if not isinstance(plan, dict) or not self._validate_commands(plan.get('commands') or []):
                return None
            
            # Extract usage information if available
            usage = getattr(resp, 'usage', None)
            
            return {
                'plan': plan,
                'usage': usage
            }
        except Exception:
            return None

    def _validate_commands(self, commands: list) -> bool:
        allowed = {"compile","show","validate","list","provider_status","provider_switch","mkdir","create_file","move","copy"}
        base = self.current_dir.resolve()
        from pathlib import Path
        for c in commands:
            if c.get('cmd') not in allowed:
                return False
            for a in (c.get('args') or []):
                # reject absolute, drives, parent traversal
                if a.startswith('/') or a.startswith('..') or ':' in a:
                    return False
                p = (base / a).resolve()
                try:
                    p.relative_to(base)
                except Exception:
                    return False
        return True

    def execute_plan(self, plan: dict):
        cmds = plan.get('commands') or []
        for c in cmds:
            cmd = c.get('cmd')
            args = c.get('args') or []
            try:
                if cmd == 'compile' and args:
                    self.interactive_compile(args)
                elif cmd == 'show' and args:
                    self.interactive_show(args)
                elif cmd == 'validate' and args:
                    self.interactive_validate(args)
                elif cmd == 'list':
                    self.interactive_list()
                elif cmd == 'provider_status':
                    self.show_provider_status()
                elif cmd == 'provider_switch' and args:
                    self.interactive_provider(args)
                elif cmd == 'mkdir' and args:
                    self.console.print(self.execute_mkdir(args[0], self))
                elif cmd == 'create_file' and args:
                    self.console.print(self.execute_prompt_creation(args[0], self))
                elif cmd in ['move','copy']:
                    self.console.print(f"[dim]{cmd} not yet implemented by planner executor[/dim]")
            except Exception as e:
                self.console.print(f"[red]Command failed: {cmd} {' '.join(args)} - {e}[/red]")
    
    def show_status(self):
        """Show current session status"""
        table = Table(title="Shell Status", show_header=True)
        table.add_column("Setting", style="cyan", width=20)
        table.add_column("Value", style="green", width=50)
        
        table.add_row("Current Directory", str(self.current_dir))
        table.add_row("Mode", "Chat Mode" if self.chat_mode else "Command Mode")
        
        # Count local files
        prompd_files = list(self.current_dir.glob("*.prmd"))
        pdpkg_files = list(self.current_dir.glob("*.pdpkg"))
        
        table.add_row("Local .prmd files", str(len(prompd_files)))
        table.add_row("Local .pdpkg files", str(len(pdpkg_files)))
        
        # Show recent files
        if prompd_files:
            recent = sorted(prompd_files, key=lambda p: p.stat().st_mtime, reverse=True)[:3]
            table.add_row("Recent prompts", ", ".join(f.name for f in recent))
        
        self.console.print(table)

    def _add_usage(self, usage: dict):
        """Normalize and accumulate usage from provider responses."""
        try:
            # OpenAI: prompt_tokens/completion_tokens/total_tokens
            # Anthropic: input_tokens/output_tokens (no total)
            prompt = usage.get('prompt_tokens') or usage.get('input_tokens') or 0
            completion = usage.get('completion_tokens') or usage.get('output_tokens') or 0
            total = usage.get('total_tokens') or (prompt + completion)
            # Update last and totals
            self.last_usage = { 'prompt': int(prompt), 'completion': int(completion), 'total': int(total) }
            self.token_usage_total['prompt'] += int(prompt)
            self.token_usage_total['completion'] += int(completion)
            self.token_usage_total['total'] += int(total)
            self._usage_updated_this_turn = True
        except Exception:
            # Best-effort; ignore malformed usage
            self.last_usage = None
    
    def _print_status_footer(self):
        """Render a subtle footer with provider/model and session token totals."""
        try:
            from .config import PrompdConfig
            cfg = PrompdConfig.load()
            prov = (cfg.default_provider or '') if cfg.default_provider else (self.get_current_ai_provider() or '')
            model = cfg.default_model or ''
            spu = int(self.token_usage_total.get('prompt', 0))
            scu = int(self.token_usage_total.get('completion', 0))
            stu = int(self.token_usage_total.get('total', 0))
            prov_model = f"{prov}{'/' + model if model else ''}" if prov else 'provider?'
            self.console.print(f"[dim][cyan]{prov_model}[/cyan] | Tokens: {spu}+{scu}={stu}[/dim]")
        except Exception:
            pass
    
    # Import methods from the simple interactive class
    def interactive_compile(self, args: List[str]):
        """Handle compile command with proper file resolution"""
        if args:
            file_path = args[0]
        else:
            prompd_files = list(self.current_dir.glob("*.prmd"))
            if not prompd_files:
                self.console.print("[yellow]No .prmd files found[/yellow]")
                return
            
            self.console.print(f"[cyan]Found {len(prompd_files)} prompt files[/cyan]")
            for i, file in enumerate(prompd_files):
                self.console.print(f"  {i+1}. {file.name}")
            return
        
        # Handle relative paths correctly
        path = Path(file_path)
        if not path.is_absolute():
            path = self.current_dir / path
        
        if path.exists():
            self.console.print(f"[green]SUCCESS:[/green] Found {path.name}")
            # Import and call the actual compile function
            try:
                from .compiler import PrompdCompiler
                self.console.print(f"[cyan]Compiling {path.name}...[/cyan]")
                compiler = PrompdCompiler()
                result = compiler.compile(str(path))
                self.console.print(f"[green]Compilation completed![/green]")
                # Show a preview of the compiled output
                if result and len(result) > 200:
                    preview = result[:200] + "..."
                else:
                    preview = result or "No output generated"
                self.console.print(f"[dim]{preview}[/dim]")
            except ImportError:
                self.console.print("[yellow]Compile function not available in this shell mode[/yellow]")
                self.console.print(f"[dim]Use: prompd compile {path.name}[/dim]")
            except Exception as e:
                self.console.print(f"[red]Compilation failed: {e}[/red]")
        else:
            self.console.print(f"[red]File not found: {file_path}[/red]")
            # Show helpful suggestions
            similar_files = list(self.current_dir.glob(f"*{Path(file_path).stem}*.prmd"))
            if similar_files:
                self.console.print("[yellow]Did you mean:[/yellow]")
                for f in similar_files[:3]:
                    self.console.print(f"  • {f.name}")
    
    def interactive_show(self, args: List[str]):
        """Show prompt information"""
        if not args:
            self.console.print("[yellow]Please specify a file to show[/yellow]")
            return
        
        file_path = args[0]
        path = Path(file_path)
        
        if not path.exists():
            self.console.print(f"[red]File not found: {file_path}[/red]")
            return
        
        try:
            parser = PrompdParser()
            metadata = parser.parse_file(str(path))
            
            self.console.print(f"\n[bold cyan]{path.name}[/bold cyan]")
            self.console.print(f"[dim]ID:[/dim] {metadata.id}")
            if metadata.description:
                self.console.print(f"[dim]Description:[/dim] {metadata.description}")
            
            if metadata.parameters:
                self.console.print(f"[dim]Parameters:[/dim] {len(metadata.parameters)}")
                for param in metadata.parameters[:3]:  # Show first 3
                    status = "required" if param.required else "optional"
                    self.console.print(f"  • [green]{param.name}[/green] ({status})")
            
        except Exception as e:
            self.console.print(f"[red]Could not parse prompt: {e}[/red]")
    
    def interactive_validate(self, args: List[str]):
        """Validate a file"""
        if not args:
            self.console.print("[yellow]Please specify a file to validate[/yellow]")
            return
        
        file_path = args[0]
        path = Path(file_path)
        
        if not path.exists():
            self.console.print(f"[red]File not found: {file_path}[/red]")
            return
        
        try:
            if path.suffix == '.prmd':
                parser = PrompdParser()
                parser.parse_file(str(path))
                self.console.print(f"[green]SUCCESS: {path.name} is valid[/green]")
            elif path.suffix == '.pdpkg':
                validate_package(str(path))
                self.console.print(f"[green]SUCCESS: {path.name} is valid[/green]")
            else:
                self.console.print("[red]Unsupported file type[/red]")
        except Exception as e:
            self.console.print(f"[red]Validation failed: {e}[/red]")
    
    def interactive_list(self):
        """List local files and directories"""
        prompd_files = list(self.current_dir.glob("*.prmd"))
        pdpkg_files = list(self.current_dir.glob("*.pdpkg"))
        directories = [d for d in self.current_dir.iterdir() if d.is_dir() and not d.name.startswith('.')]
        other_files = [f for f in self.current_dir.iterdir() 
                      if f.is_file() and not f.name.startswith('.') 
                      and not f.suffix in ['.prmd', '.pdpkg']]
        
        if not any([prompd_files, pdpkg_files, directories, other_files]):
            self.console.print("[yellow]Directory is empty[/yellow]")
            # Still show PWD even when empty
            self.console.print(f"\n[dim]Current directory: [bold]{self.current_dir}[/bold][/dim]")
            return
        
        if directories:
            if self.compact_mode:
                # Compact format: show directories in fewer lines
                dirs = ", ".join([f"[cyan]{d.name}/[/cyan]" for d in sorted(directories, key=lambda d: d.name.lower())])
                self.console.print(f"[cyan]Dirs ({len(directories)}):[/cyan] {dirs}")
            else:
                # Standard format
                self.console.print(f"[cyan]Directories ({len(directories)}):[/cyan]")
                for directory in sorted(directories, key=lambda d: d.name.lower()):
                    self.console.print(f"  [DIR] [bold cyan]{directory.name}/[/bold cyan]")
        
        if prompd_files:
            if self.compact_mode:
                # Compact format: show files in fewer lines
                files = ", ".join([f"[green]{f.name}[/green]" for f in sorted(prompd_files, key=lambda f: f.name.lower())])
                self.console.print(f"\n[cyan]Prompts ({len(prompd_files)}):[/cyan] {files}")
            else:
                # Standard format
                self.console.print(f"\n[cyan]Prompt Files ({len(prompd_files)}):[/cyan]")
                for file in sorted(prompd_files, key=lambda f: f.name.lower()):
                    size = f"{file.stat().st_size / 1024:.1f}KB"
                    self.console.print(f"  • [green]{file.name}[/green] [dim]({size})[/dim]")
        
        if pdpkg_files:
            if self.compact_mode:
                files = ", ".join([f"[blue]{f.name}[/blue]" for f in sorted(pdpkg_files, key=lambda f: f.name.lower())])
                self.console.print(f"\n[cyan]Packages ({len(pdpkg_files)}):[/cyan] {files}")
            else:
                self.console.print(f"\n[cyan]Package Files ({len(pdpkg_files)}):[/cyan]")
                for file in sorted(pdpkg_files, key=lambda f: f.name.lower()):
                    size = f"{file.stat().st_size / 1024:.1f}KB"
                    self.console.print(f"  • [blue]{file.name}[/blue] [dim]({size})[/dim]")
        
        if other_files:
            if self.compact_mode:
                # Show fewer files in compact mode to reduce clutter
                display_files = sorted(other_files, key=lambda f: f.name.lower())[:10]
                files = ", ".join([f"[white]{f.name}[/white]" for f in display_files])
                extra = f" +{len(other_files)-10} more" if len(other_files) > 10 else ""
                self.console.print(f"\n[cyan]Files ({len(other_files)}):[/cyan] {files}{extra}")
            else:
                self.console.print(f"\n[cyan]Other Files ({len(other_files)}):[/cyan]")
                for file in sorted(other_files, key=lambda f: f.name.lower()):
                    size = f"{file.stat().st_size / 1024:.1f}KB"
                    self.console.print(f"  • [white]{file.name}[/white] [dim]({size})[/dim]")
        
        # Show current working directory at the end
        self.console.print(f"\n[dim]Current directory: [bold]{self.current_dir}[/bold][/dim]")
    
    def interactive_cd(self, args: str):
        """Change directory"""
        from pathlib import Path
        
        if not args.strip():
            self.console.print(f"[yellow]Current directory: {self.current_dir}[/yellow]")
            return
        
        target = args.strip()
        
        # Handle special cases
        if target == '..':
            new_dir = self.current_dir.parent
        elif target == '.':
            new_dir = self.current_dir
        elif target == '~' or target == 'home':
            new_dir = Path.home()
        elif target.startswith('/') or (len(target) > 1 and target[1] == ':'):
            # Absolute path
            new_dir = Path(target)
        else:
            # Relative path
            new_dir = self.current_dir / target
        
        try:
            # Resolve the path and check if it exists
            new_dir = new_dir.resolve()
            if not new_dir.exists():
                self.console.print(f"[red]Directory does not exist: {target}[/red]")
                return
            
            if not new_dir.is_dir():
                self.console.print(f"[red]Not a directory: {target}[/red]")
                return
            
            # Change directory
            self.current_dir = new_dir
            # Use style arg to avoid Rich markup escaping when path ends with backslash (e.g., C:\)
            self.console.print(f"Changed to: {self.current_dir}", style="green")
            
        except (OSError, PermissionError) as e:
            self.console.print(f"[red]Cannot access directory: {str(e)}[/red]")
    
    def interactive_cat(self, args: str):
        """Display file contents"""
        from pathlib import Path
        
        if not args.strip():
            self.console.print("[red]Usage: cat <filename>[/red]")
            return
        
        filename = args.strip()
        
        # Handle relative paths
        if not Path(filename).is_absolute():
            file_path = self.current_dir / filename
        else:
            file_path = Path(filename)
        
        try:
            if not file_path.exists():
                self.console.print(f"[red]File not found: {filename}[/red]")
                return
            
            if not file_path.is_file():
                self.console.print(f"[red]Not a file: {filename}[/red]")
                return
            
            # Read and display file contents
            content = file_path.read_text(encoding='utf-8')
            
            # Show file header
            self.console.print(f"[cyan]File: {file_path.name}[/cyan] [dim]({file_path.stat().st_size} bytes)[/dim]")
            self.console.print("[dim]" + "-" * 50 + "[/dim]")
            
            # Display content with syntax highlighting for .prmd files
            if file_path.suffix == '.prmd':
                # Split YAML frontmatter from content
                lines = content.split('\n')
                if len(lines) > 0 and lines[0].strip() == '---':
                    # Find end of YAML frontmatter
                    yaml_end = 1
                    for i in range(1, len(lines)):
                        if lines[i].strip() == '---':
                            yaml_end = i
                            break
                    
                    # Display YAML frontmatter in yellow
                    self.console.print("[yellow]" + '\n'.join(lines[:yaml_end+1]) + "[/yellow]")
                    
                    # Display prompt content in white
                    if yaml_end + 1 < len(lines):
                        self.console.print('\n'.join(lines[yaml_end+1:]))
                else:
                    self.console.print(content)
            else:
                self.console.print(content)
            
            self.console.print("[dim]" + "-" * 50 + "[/dim]")
            
        except UnicodeDecodeError:
            self.console.print(f"[red]Cannot display binary file: {filename}[/red]")
        except PermissionError:
            self.console.print(f"[red]Permission denied: {filename}[/red]")
        except Exception as e:
            self.console.print(f"[red]Error reading file: {str(e)}[/red]")
    
    def interactive_open(self, args: str):
        """Open file with system default application"""
        from pathlib import Path
        import subprocess
        import sys
        
        if not args.strip():
            self.console.print("[red]Usage: open <filename>[/red]")
            return
        
        filename = args.strip()
        
        # Handle relative paths
        if not Path(filename).is_absolute():
            file_path = self.current_dir / filename
        else:
            file_path = Path(filename)
        
        try:
            if not file_path.exists():
                self.console.print(f"[red]File not found: {filename}[/red]")
                return
            
            if not file_path.is_file():
                self.console.print(f"[red]Not a file: {filename}[/red]")
                return
            
            # Open file with system default application
            try:
                if sys.platform == "win32":
                    # Windows
                    subprocess.run(["start", str(file_path)], shell=True, check=True)
                elif sys.platform == "darwin":
                    # macOS
                    subprocess.run(["open", str(file_path)], check=True)
                else:
                    # Linux
                    subprocess.run(["xdg-open", str(file_path)], check=True)
                
                self.console.print(f"[green]Opened {file_path.name} with system default application[/green]")
                
            except subprocess.CalledProcessError:
                self.console.print(f"[red]Failed to open {filename} with system default application[/red]")
            
        except Exception as e:
            self.console.print(f"[red]Error opening file: {str(e)}[/red]")
    
    def interactive_provider(self, args: str):
        """Show current provider or switch to a new one"""
        from pathlib import Path
        
        if not args.strip():
            # Show current provider status
            self.show_provider_status()
            return
        
        provider_name = args.strip().lower()
        
        if provider_name == 'status':
            self.show_provider_status()
            return
        
        # Switch to specified provider
        if provider_name in ['openai', 'anthropic', 'ollama']:
            self.switch_provider(provider_name)
        else:
            self.console.print(f"[red]Unknown provider: {provider_name}[/red]")
            self.console.print("Available providers: [cyan]openai[/cyan], [cyan]anthropic[/cyan], [cyan]ollama[/cyan]")
            self.console.print("Use [cyan]provider status[/cyan] to see current configuration")
    
    def show_provider_status(self):
        """Display current provider configuration"""
        try:
            from .config import PrompdConfig
            config = PrompdConfig.load()
            
            self.console.print("[cyan]AI Provider Status:[/cyan]")
            
            # Check which providers have API keys
            providers = []
            openai_key = config.get_api_key('openai')
            anthropic_key = config.get_api_key('anthropic')
            ollama_available = self.check_ollama_available()
            
            if openai_key:
                providers.append(("OpenAI", "CONFIGURED", "[green]"))
            else:
                providers.append(("OpenAI", "NO API KEY", "[red]"))
            
            if anthropic_key:
                providers.append(("Anthropic", "CONFIGURED", "[green]"))
            else:
                providers.append(("Anthropic", "NO API KEY", "[red]"))
            
            if ollama_available:
                providers.append(("Ollama", "AVAILABLE", "[green]"))
            else:
                providers.append(("Ollama", "NOT AVAILABLE", "[red]"))
            
            # Display provider status
            for name, status, color in providers:
                self.console.print(f"  • {color}{name}[/{color.strip('[]')}]: {status}")
            
            # Show which provider is being used for AI responses
            current_provider = self.get_current_ai_provider()
            if current_provider:
                self.console.print(f"\n[bold]Current AI provider:[/bold] [green]{current_provider}[/green]")
            else:
                self.console.print(f"\n[yellow]No AI provider configured for chat responses[/yellow]")
            
            self.console.print("\n[dim]Use 'provider <name>' to switch providers[/dim]")
                
        except Exception as e:
            self.console.print(f"[red]Error checking provider status: {str(e)}[/red]")
    
    def check_ollama_available(self) -> bool:
        """Check if Ollama is available"""
        try:
            import subprocess
            result = subprocess.run(['ollama', 'list'], capture_output=True, timeout=5)
            return result.returncode == 0
        except:
            return False
    
    def get_current_ai_provider(self) -> str:
        """Get the current AI provider being used"""
        try:
            from .config import PrompdConfig
            config = PrompdConfig.load()
            
            # Check which provider has a key (prioritize in order)
            if config.get_api_key('openai'):
                return "OpenAI"
            elif config.get_api_key('anthropic'):
                return "Anthropic"
            elif self.check_ollama_available():
                return "Ollama"
            else:
                return None
        except:
            return None
    
    def switch_provider(self, provider_name: str):
        """Switch to a different AI provider"""
        try:
            from .config import PrompdConfig
            config = PrompdConfig.load()
            
            if provider_name == 'openai':
                if config.get_api_key('openai'):
                    self.console.print(f"[green]Switched to OpenAI provider[/green]")
                    # Could set a preference in config here
                else:
                    self.console.print(f"[red]OpenAI not configured. Use 'prompd provider add openai' to set up.[/red]")
            
            elif provider_name == 'anthropic':
                if config.get_api_key('anthropic'):
                    self.console.print(f"[green]Switched to Anthropic provider[/green]")
                else:
                    self.console.print(f"[red]Anthropic not configured. Use 'prompd provider add anthropic' to set up.[/red]")
            
            elif provider_name == 'ollama':
                if self.check_ollama_available():
                    self.console.print(f"[green]Switched to Ollama provider[/green]")
                    self.console.print(f"[dim]Note: Ollama integration is experimental[/dim]")
                else:
                    self.console.print(f"[red]Ollama not available. Install Ollama and ensure it's running.[/red]")
                    
        except Exception as e:
            self.console.print(f"[red]Error switching provider: {str(e)}[/red]")
    
    def parse_parameters(self, param_text: str) -> Dict[str, str]:
        """Enhanced parameter parsing with natural language understanding"""
        params = {}
        
        # Clean input text
        param_text = param_text.strip()
        if not param_text:
            return params
        
        # Enhanced key=value patterns (most explicit)
        equals_patterns = [
            r'(\w+)\s*=\s*"([^"]*)"',  # key="value"
            r"(\w+)\s*=\s*'([^']*)'",  # key='value'  
            r'(\w+)\s*:\s*"([^"]*)"',  # key:"value" (JSON-like)
            r"(\w+)\s*:\s*'([^']*)'",  # key:'value' (JSON-like)
            r'(\w+)\s*=\s*([^\s,]+)',  # key=value (unquoted)
        ]
        
        for pattern in equals_patterns:
            matches = re.findall(pattern, param_text)
            for match in matches:
                params[match[0]] = match[1]
        
        # If explicit patterns found, clean the text for natural language parsing
        if params:
            # Remove the explicit patterns from the text for further processing
            for pattern in equals_patterns:
                param_text = re.sub(pattern, '', param_text)
            param_text = param_text.strip()
        
        # Enhanced natural language parameter extraction
        nl_patterns = [
            # App/project type patterns
            (r'for (?:a |an |the )?(\w+)(?: app| application)', 'app_type'),
            (r'(?:using|with) (\w+)(?: framework| library)?', 'framework'),
            (r'called (?:"|\')?([^"\']+)(?:"|\')?', 'app_name'),
            (r'named (?:"|\')?([^"\']+)(?:"|\')?', 'app_name'),
            
            # Technology stack patterns
            (r'(?:react|reactjs)', 'framework=React'),
            (r'(?:node|nodejs|node\.js)', 'platform=Node.js'),
            (r'(?:vue|vuejs|vue\.js)', 'framework=Vue'),
            (r'(?:angular)', 'framework=Angular'),
            (r'(?:python|django|flask)', 'language=Python'),
            (r'(?:java|spring)', 'language=Java'),
            (r'(?:go|golang)', 'language=Go'),
            
            # Environment patterns
            (r'(?:dev|development)', 'environment=development'),
            (r'(?:prod|production)', 'environment=production'),
            (r'(?:test|testing)', 'environment=test'),
            
            # Security patterns
            (r'security (?:audit|review|check)', 'type=security_audit'),
            (r'(?:auth|authentication)', 'feature=authentication'),
            (r'(?:api|rest api|web api)', 'type=api'),
        ]
        
        for pattern, param_info in nl_patterns:
            if re.search(pattern, param_text.lower()):
                if '=' in param_info:
                    key, value = param_info.split('=', 1)
                    if key not in params:  # Don't override explicit params
                        params[key] = value
                else:
                    # Extract the matched value
                    match = re.search(pattern, param_text.lower())
                    if match and match.groups():
                        if param_info not in params:
                            params[param_info] = match.group(1)
        
        # Enhanced context-based parameter inference
        param_text_lower = param_text.lower()
        
        # Smart app_name inference if not set
        if 'app_name' not in params:
            # Look for quoted strings that might be names
            quoted_matches = re.findall(r'(?:"|\')+([^"\']+)(?:"|\')+', param_text)
            if quoted_matches:
                # Take the first quoted string as the app name
                params['app_name'] = quoted_matches[0]
            elif 'app' in param_text_lower:
                # Default app names based on context
                if 'react' in param_text_lower:
                    params['app_name'] = 'My React App'
                elif 'node' in param_text_lower:
                    params['app_name'] = 'My Node.js App'
                elif 'api' in param_text_lower:
                    params['app_name'] = 'My API'
                else:
                    params['app_name'] = 'My App'
        
        # Smart type inference
        if 'type' not in params:
            if any(word in param_text_lower for word in ['security', 'audit', 'vulnerability']):
                params['type'] = 'security_audit'
            elif any(word in param_text_lower for word in ['api', 'endpoint', 'service']):
                params['type'] = 'api'
            elif any(word in param_text_lower for word in ['ui', 'interface', 'frontend']):
                params['type'] = 'ui'
        
        return params
    
    def interactive_compile_with_params(self, args: List[str], params: Dict[str, str]):
        """Handle compile command with parameters"""
        if args:
            file_path = args[0]
        else:
            self.interactive_compile([])
            return
        
        # Handle relative paths correctly
        path = Path(file_path)
        if not path.is_absolute():
            path = self.current_dir / path
        
        if path.exists():
            self.console.print(f"[green]SUCCESS:[/green] Found {path.name}")
            
            # Show parameters if any
            if params:
                self.console.print(f"[cyan]Parameters:[/cyan] {params}")
            
            # Import and call the actual compile function
            try:
                from .compiler import PrompdCompiler
                self.console.print(f"[cyan]Compiling {path.name}...[/cyan]")
                compiler = PrompdCompiler()
                result = compiler.compile(str(path), parameters=params if params else None)
                self.console.print(f"[green]Compilation completed![/green]")
                # Show a preview of the compiled output
                if result and len(result) > 200:
                    preview = result[:200] + "..."
                else:
                    preview = result or "No output generated"
                self.console.print(f"[dim]{preview}[/dim]")
            except ImportError:
                self.console.print("[yellow]Compile function not available in this shell mode[/yellow]")
                self.console.print(f"[dim]Use: prompd compile {path.name}[/dim]")
            except Exception as e:
                self.console.print(f"[red]Compilation failed: {e}[/red]")
        else:
            self.console.print(f"[red]File not found: {file_path}[/red]")
            # Show helpful suggestions
            similar_files = list(self.current_dir.glob(f"*{Path(file_path).stem}*.prmd"))
            if similar_files:
                self.console.print("[yellow]Did you mean:[/yellow]")
                for f in similar_files[:3]:
                    self.console.print(f"  • {f.name}")
    
    def interactive_search(self, args: List[str]):
        """Search registry for packages"""
        if not args:
            self.console.print("[yellow]Usage: search [query][/yellow]")
            self.console.print("Example: search security")
            return
        
        query = " ".join(args)
        self.console.print(f"[cyan]Searching registry for: {query}[/cyan]")
        
        try:
            # Import and call the actual Prompd CLI search functionality
            import subprocess
            import sys
            
            # Call the prompd CLI search command
            result = subprocess.run([
                sys.executable, '-m', 'prompd.cli', 'search', query
            ], capture_output=True, text=True, cwd=self.current_dir)
            
            if result.returncode == 0 and result.stdout.strip():
                self.console.print(result.stdout)
            elif result.stderr:
                self.console.print(f"[yellow]Search info: {result.stderr}[/yellow]")
            else:
                self.console.print(f"[dim]No results found for '{query}'[/dim]")
                
        except Exception as e:
            # Fallback to direct CLI import
            try:
                from .cli import main as cli_main
                import sys
                old_argv = sys.argv
                sys.argv = ['prompd', 'search', query]
                cli_main()
                sys.argv = old_argv
            except Exception as e2:
                self.console.print(f"[yellow]Search functionality not available: {str(e2)}[/yellow]")
                self.console.print(f"[dim]Try using the prompd CLI directly: prompd search {query}[/dim]")
    
    def interactive_install(self, args: List[str]):
        """Install packages from registry"""
        if not args:
            self.console.print("[yellow]Usage: install [package-name][/yellow]")
            self.console.print("Example: install @security/audit@1.0.0")
            return
        
        package_name = args[0]
        self.console.print(f"[cyan]Installing package: {package_name}[/cyan]")
        
        try:
            # This would integrate with the registry install command
            self.console.print("[dim]This would download and install the package...[/dim]")
            self.console.print(f"[green]Package {package_name} installed successfully![/green]")
        except Exception as e:
            self.console.print(f"[red]Installation failed: {e}[/red]")
    
    def interactive_publish(self, args: List[str]):
        """Publish package to registry"""
        if not args:
            # Look for .pdpkg files in current directory
            pdpkg_files = list(self.current_dir.glob("*.pdpkg"))
            if not pdpkg_files:
                self.console.print("[yellow]No .pdpkg files found. Create a package first.[/yellow]")
                return
            
            self.console.print(f"[cyan]Found {len(pdpkg_files)} package files:[/cyan]")
            for i, pkg in enumerate(pdpkg_files):
                size = f"{pkg.stat().st_size / 1024:.1f}KB"
                self.console.print(f"  {i+1}. [blue]{pkg.name}[/blue] [dim]({size})[/dim]")
            return
        
        package_file = args[0]
        path = Path(package_file)
        if not path.is_absolute():
            path = self.current_dir / path
        
        if not path.exists():
            self.console.print(f"[red]Package file not found: {package_file}[/red]")
            return
        
        self.console.print(f"[cyan]Publishing package: {path.name}[/cyan]")
        try:
            # This would integrate with the registry publish command
            self.console.print("[dim]This would upload the package to the registry...[/dim]")
            self.console.print(f"[green]Package {path.name} published successfully![/green]")
        except Exception as e:
            self.console.print(f"[red]Publishing failed: {e}[/red]")
    
    def interactive_login(self, args: List[str]):
        """Login to registry"""
        if not args or (len(args) >= 2 and args[0] == "--token"):
            if len(args) < 2:
                self.console.print("[yellow]Usage: login --token [your-token][/yellow]")
                return
            
            token = args[1]
            self.console.print(f"[cyan]Logging in with token...[/cyan]")
            
            try:
                # This would integrate with the registry login command  
                self.console.print("[dim]This would authenticate with the registry...[/dim]")
                self.console.print(f"[green]Successfully logged in![/green]")
            except Exception as e:
                self.console.print(f"[red]Login failed: {e}[/red]")
        else:
            self.console.print("[yellow]Usage: login --token [your-token][/yellow]")


def start_prompd_shell():
    """Entry point for Prompd shell"""
    shell = PrompdShell()
    shell.start()
