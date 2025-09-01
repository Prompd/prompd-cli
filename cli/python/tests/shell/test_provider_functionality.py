#!/usr/bin/env python3
"""Test provider display and switching functionality"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Provider Functionality")
    print("="*50)
    
    shell = PrompdShell()
    
    print("Testing provider status:")
    print("-" * 30)
    shell.interactive_provider("")
    
    print("\nTesting provider switching:")
    print("-" * 30)
    
    # Test switching to different providers
    providers_to_test = ["openai", "anthropic", "ollama", "invalid"]
    
    for provider in providers_to_test:
        print(f"\nTesting: provider {provider}")
        shell.interactive_provider(provider)
    
    print("\nTesting provider status again:")
    print("-" * 30)
    shell.interactive_provider("status")
    
    print("\n" + "="*50)
    print("Provider functionality test complete!")