#!/usr/bin/env python3
"""Test chat mode command execution"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Chat Mode Command Execution")
    print("="*50)
    
    shell = PrompdShell()
    
    # Test various commands from chat mode
    test_commands = [
        "list",                                    # Basic list command
        "cd prompts",                             # Change directory
        "list",                                   # List in new directory
        "cat test-prompt.prompd",                # Display file contents  
        "cd ..",                                  # Go back
        "show cooking-recipes.prompd",           # Show command
        "compile cooking-recipes with context='Italian cuisine'",  # Compile with params
        "help"                                   # Help command
    ]
    
    for cmd in test_commands:
        print(f"\nchat> {cmd}")
        print("-" * 30)
        shell.handle_chat_input(cmd)
        print()
    
    print("="*50)
    print("Chat mode command execution test complete!")