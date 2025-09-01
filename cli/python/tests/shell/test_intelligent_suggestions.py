#!/usr/bin/env python3
"""Test intelligent command suggestions"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Intelligent Command Suggestions")
    print("="*50)
    
    shell = PrompdShell()
    
    # Test various scenarios that should trigger suggestions
    test_cases = [
        # Provider-related suggestions
        ("Provider: use openai", "use openai"),
        ("Provider: switch to anthropic", "switch to anthropic"), 
        ("Provider: what provider", "what provider"),
        
        # Command typos and alternatives  
        ("Typo: ls", "ls"),
        ("Typo: dir", "dir"),
        ("Alternative: pwd", "pwd"),
        ("Alternative: switch", "switch"),
        
        # Partial command matches
        ("Partial: comp", "comp"),
        ("Partial: prov", "prov"),
        
        # Test confirmation flow
        ("Follow-up: yes", "yes"),
    ]
    
    print("Testing suggestion system:")
    print("-" * 50)
    
    for description, command in test_cases:
        print(f"\n[TEST] {description}")
        print(f"chat> {command}")
        print("-" * 30)
        
        try:
            shell.handle_chat_input(command)
        except Exception as e:
            print(f"ERROR: {e}")
        
        print()
    
    print("="*50)
    print("Intelligent suggestion system test complete!")
    print()
    print("Features tested:")
    print("  * Provider command suggestions") 
    print("  * Common typo corrections (ls, dir, pwd)")
    print("  * Partial command completion")
    print("  * Yes/no confirmation flow")
    print("  * Context-aware suggestions")
    print("="*50)