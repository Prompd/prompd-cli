#!/usr/bin/env python3
"""Simple test for command suggestions"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Simple Suggestion Test")
    print("="*40)
    
    shell = PrompdShell()
    
    # Test specific cases
    test_cases = [
        "use openai",      # Should suggest "switch provider openai"
        "ls",              # Should suggest "list"
        "comp",            # Should suggest "compile"
    ]
    
    for command in test_cases:
        print(f"\nchat> {command}")
        print("-" * 30)
        shell.handle_chat_input(command)
        print(f"Last suggestion stored: {shell.last_suggestion}")
        
        # Test yes response
        if shell.last_suggestion:
            print(f"\nchat> yes")
            print("-" * 30)  
            shell.handle_chat_input("yes")
    
    print("\n" + "="*40)
    print("Simple suggestion test complete!")