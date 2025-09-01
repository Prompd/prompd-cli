# Shell Tests

This directory contains comprehensive tests for the enhanced Prompd Shell with conversational AI capabilities.

## Test Categories

### Core Functionality Tests
- `test_compile.py` - Basic compile command testing
- `test_list_command.py` - Directory listing functionality
- `test_navigation.py` - Directory navigation (cd command)
- `test_registry_commands.py` - Registry integration tests
- `test_validation.py` - Package and prompt validation

### Enhanced Shell Features
- `test_enhanced_chat_interface.py` - Claude Code-like chat interface
- `test_compact_mode.py` - Compact display mode functionality
- `test_autocomplete.py` - Tab completion system
- `test_ls_and_open.py` - File listing and opening commands
- `test_list_with_pwd.py` - PWD display in list output

### Conversational AI Tests
- `test_ai_*.py` - Various AI integration and execution tests
- `test_chat_*.py` - Chat mode functionality and commands
- `test_conversational_provider.py` - Provider management in chat
- `test_intelligent_suggestions.py` - Smart command suggestions
- `test_provider_functionality.py` - AI provider switching

### Parameter & Command Parsing
- `test_parameter_parsing.py` - Parameter extraction from natural language
- `test_fixed_commands.py` - Fixed compile and search command parsing
- `test_improved_parsing.py` - Enhanced natural language processing
- `new_parse_parameters.py` - Parameter parsing helper functions

### Comprehensive Integration Tests
- `test_final_enhanced_shell.py` - Complete feature demonstration
- `test_complete_enhanced_shell.py` - Full enhanced shell testing
- `test_comprehensive_chat.py` - End-to-end chat functionality

## Running Tests

### Individual Test Files
```bash
# Run from the python CLI directory
cd /c/git/github/Logikbug/prompd-cli/cli/python
python tests/shell/test_compact_mode.py
```

### All Shell Tests
```bash
# Run all shell tests
python -m pytest tests/shell/ -v
```

### Interactive Tests
Some tests like `test_autocomplete_live.py` and `test_enhanced_chat_interface.py` are interactive and need to be run manually to test the user experience.

## Test Features Covered

### ✅ Core Shell Functionality
- Command execution and parsing
- File and directory operations
- Package management integration
- Registry search and operations

### ✅ Enhanced UI/UX Features
- Claude Code-style chat interface
- Compact display mode for smaller screens
- Tab autocompletion with pyreadline3
- PWD display in directory listings
- Intelligent command suggestions with confirmation

### ✅ Conversational AI Integration
- Natural language command processing
- Multi-provider support (OpenAI, Anthropic, Ollama)
- Provider switching and status display
- Context-aware responses and suggestions
- Conversation history with timestamps

### ✅ Parameter Processing
- Space-tolerant parameter parsing (task_type = value)
- Multiple parameter formats supported
- Quoted and unquoted value handling
- Natural language search query extraction

### ✅ Windows Compatibility
- Unicode handling for Windows console
- pyreadline3 integration for autocompletion
- Cross-platform file operations
- Proper path resolution

## Notes

- All tests use the shell import: `from prompd.shell import PrompdShell`
- Tests are designed to work without external dependencies when possible
- Interactive tests provide manual verification of user experience features
- Tests cover both command mode and chat mode functionality