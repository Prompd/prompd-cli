#!/usr/bin/env python3
"""Test navigation and file viewing functionality"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Navigation and File Viewing")
    print("="*50)
    
    shell = PrompdShell()
    
    print("Current directory:")
    shell.interactive_cd("")  # Show current directory
    
    print("\nListing current directory:")
    shell.interactive_list()
    
    print("\nChanging to prompts directory:")
    shell.interactive_cd("prompts")
    
    print("\nListing prompts directory:")
    shell.interactive_list()
    
    print("\nDisplaying test-prompt.prmd:")
    shell.interactive_cat("test-prompt.prmd")
    
    print("\nChanging back to parent directory:")
    shell.interactive_cd("..")
    
    print("\nDisplaying a created prompt file:")
    shell.interactive_cat("cooking-recipes.prmd")
    
    print("\n" + "="*50)
    print("Navigation and file viewing test complete!")