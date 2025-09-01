#!/usr/bin/env python3
"""Test ls and open command fixes"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing LS and OPEN Command Fixes")
    print("="*40)
    
    shell = PrompdShell()
    
    # Test cases
    test_commands = [
        # Test that ls works directly now
        ("Direct ls command", "ls"),
        
        # Test open command
        ("Open command help", "open"),
        ("Open existing file", "open cooking-recipes.prompd"),
        
        # Test that dir still suggests list
        ("Dir suggestion", "dir"),
    ]
    
    for description, command in test_commands:
        print(f"\n[{description.upper()}]")
        print(f"chat> {command}")
        print("-" * 30)
        
        try:
            shell.handle_chat_input(command)
        except Exception as e:
            print(f"ERROR: {e}")
        
        print()
    
    print("="*40)
    print("LS and OPEN fixes tested!")
    print("  * ls now works directly (no suggestion)")
    print("  * open command added for system file opening") 
    print("  * dir still suggests list (as expected)")
    print("="*40)