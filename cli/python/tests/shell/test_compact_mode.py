#!/usr/bin/env python3
"""Test compact mode functionality"""

import sys
import os

# Add the prompd module to path
sys.path.insert(0, r'C:\git\github\Logikbug\prompd-cli\cli\python')

from prompd.shell import PrompdShell

if __name__ == "__main__":
    print("Testing Compact Mode for Smaller Display")
    print("=" * 50)
    
    shell = PrompdShell()
    
    print("1. NORMAL MODE (default):")
    print("chat> list")
    print("-" * 30)
    shell.interactive_list()
    
    print("\n\n2. TOGGLE TO COMPACT MODE:")
    print("chat> compact")
    print("-" * 30)
    shell.toggle_compact_mode()
    
    print("\n3. COMPACT MODE LIST:")
    print("chat> list")
    print("-" * 30)
    shell.interactive_list()
    
    print("\n\n4. TOGGLE BACK TO NORMAL:")
    print("chat> compact")
    print("-" * 30)
    shell.toggle_compact_mode()
    
    print("\n" + "=" * 50)
    print("COMPACT MODE FEATURES:")
    print("- 'compact' command toggles between normal and compact display")
    print("- Compact mode shows files/dirs in comma-separated lists")
    print("- Reduces screen space usage significantly")
    print("- Limits other files to first 10 in compact mode")
    print("- Perfect for smaller terminal windows!")
    print("=" * 50)