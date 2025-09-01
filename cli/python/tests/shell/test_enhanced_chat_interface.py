#!/usr/bin/env python3
"""Test the enhanced Claude Code-like chat interface"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Enhanced Chat Interface Test")
    print("=" * 50)
    print("This will launch the enhanced chat interface that looks like Claude Code!")
    print()
    print("New features:")
    print("  - Clean interface with clear screen on chat start")  
    print("  - 'You:' and 'Assistant:' message formatting")
    print("  - Conversation history with timestamps")
    print("  - Typing indicator with spinner")
    print("  - Special chat commands: /exit, /clear, /help")
    print("  - Provider status display")
    print("  - Enhanced help and suggestions")
    print()
    print("To test:")
    print("  1. Type 'chat' to enter chat mode")
    print("  2. Try asking questions like 'what files are here?'")
    print("  3. Try /help to see chat commands")
    print("  4. Try /clear to clear history")
    print("  5. Try /exit to return to shell")
    print("  6. Type 'exit' to quit entirely")
    print()
    input("Press Enter to start the enhanced shell...")
    
    shell = PrompdShell()
    shell.start()