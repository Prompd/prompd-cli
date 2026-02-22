#!/usr/bin/env python3
"""Test conversational provider functionality"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Conversational Provider Functionality")
    print("="*50)
    
    shell = PrompdShell()
    
    # Test various conversational provider commands
    test_commands = [
        "provider status",                      # Direct command
        "show provider",                        # Natural language
        "change provider to anthropic",         # Natural language switching
        "switch provider openai",              # Natural language switching
        "use ollama",                          # Short form
        "provider",                            # Just show status
        "provider invalid_name"                # Error handling
    ]
    
    for cmd in test_commands:
        print(f"\nchat> {cmd}")
        print("-" * 30)
        shell.handle_chat_input(cmd)
        print()
    
    print("="*50)
    print("Conversational provider functionality test complete!")