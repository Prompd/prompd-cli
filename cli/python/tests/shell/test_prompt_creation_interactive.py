#!/usr/bin/env python3
"""Test prompt creation in interactive shell mode"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Prompt Creation in Interactive Shell")
    print("="*50)
    
    shell = PrompdShell()
    
    test_commands = [
        "create a new prompt for cooking recipes",
        "yes, create cooking-recipes.prompd"
    ]
    
    for cmd in test_commands:
        print(f"\nchat> {cmd}")
        result = shell.handle_chat_input(cmd)
        print(result)
    
    # Check if file was created
    created_file = shell.current_dir / "cooking-recipes.prompd"
    if created_file.exists():
        print(f"\nSUCCESS: File created successfully!")
        
        # Test compilation message
        print(f"\nTesting compilation suggestion:")
        print(f"shell> list")
        shell.handle_shell_command("list")
    else:
        print(f"\nERROR: File not created")
    
    print("\nInteractive shell test complete!")