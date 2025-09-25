"""
Conversational AI Assistant for natural language command processing.
Extracted from shell.py for better modularity.
"""

import os
import sys
import re
from pathlib import Path
from typing import Dict, List, Optional, Any
from rich.console import Console

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
            from ..executor import PrompdExecutor
            from pathlib import Path
            import tempfile
            import os
            import asyncio
            
            # Get the assistant prompt path
            assets_dir = Path(__file__).parent.parent / "assets" / "prompts" / "cli" / "python"
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
            from ..config import PrompdConfig
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


