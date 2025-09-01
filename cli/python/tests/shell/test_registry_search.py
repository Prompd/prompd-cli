#!/usr/bin/env python3
"""Test registry search functionality"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Registry Search Functionality")
    print("="*50)
    
    shell = PrompdShell()
    
    # Test registry search from chat mode
    print("Testing chat mode registry search:")
    print("-" * 30)
    
    test_searches = [
        "search the registry for security",
        "search registry security",
        "search the registry"
    ]
    
    for search_cmd in test_searches:
        print(f"\nchat> {search_cmd}")
        result = shell.handle_chat_input(search_cmd)
        print()
    
    # Test direct search command
    print("\nTesting direct search command:")
    print("-" * 30)
    print("shell> search security")
    shell.interactive_search(["security"])
    
    print("\n" + "="*50)
    print("Registry search functionality test complete!")