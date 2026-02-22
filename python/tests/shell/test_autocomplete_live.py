#!/usr/bin/env python3
"""Test live autocomplete functionality"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Live Autocomplete Test")
    print("=" * 30)
    print("Autocomplete should now work! Try these:")
    print("  - Type 'com' and press TAB (should complete to 'compile')")
    print("  - Type 'co' and press TAB (should show 'compile')")
    print("  - Type 'pro' and press TAB (should complete to 'provider')")
    print("  - Type 'cooking' and press TAB (should complete to 'cooking-recipes.prmd')")
    print("  - Type 'provider ' and then 'o' + TAB (should show 'openai' and 'ollama')")
    print()
    print("Type 'exit' to quit when done testing.")
    print("=" * 30)
    
    shell = PrompdShell()
    shell.start()